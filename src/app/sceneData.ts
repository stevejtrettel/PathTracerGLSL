// app/sceneData.ts — builds the shared scene-data textures by executing the compiler's
// scene-data plan (compiler/sceneData.ts). The plan says what goes where; this file does the
// data-sized work the compiler deliberately does not: packing mesh vertex data and building
// BVHs over meshes, instance clouds, the object table and the lights (large builds run in
// workers, with a synchronous fallback, so this also runs in tests).

import { packMesh, type PackedMesh } from '../components/intersection/mesh/mesh.js';
import { placementCount, type PackedInstanceBatch } from '../components/intersection/instancing/instancing.js';
import { packInstanceBatchOffThread } from './utils/instancePack.js';
import { similarityApplyPoint } from '../components/geometry/similarity.js';
import { buildBVHNodes, rootBoxOf, transformAABB, type AABB } from '../components/accel/bvh/bvh.js';
import { packMeshLight } from '../components/lights/mesh/mesh.js';
import { buildLightTreeOffThread } from './utils/lightTreePack.js';
import { nodeTexelBound, assertFits } from '../components/data/ledger.js';
import { allocChannel, allocChannelU32, writeTexels, writeTexelsU32, writeVec3s, writeVec2s, writeScalars, writeUvec3s, type PackedChannel, type PackedChannelU32 } from '../components/data/pack.js';
import { DATA_CHANNELS, type DataChannel } from '../components/data/channels.js';
import { CWBVH_NODE_TEXELS, CWBVH_NODE_WORDS, cwbvhNodeTexelBound } from '../components/accel/cwbvh/cwbvh.js';
import type { SceneDataPlan, BoxSource } from '../compiler/sceneData.js';

/** The packed channels to upload (only channels with data), plus the CWBVH's integer channel. */
export interface PackedSceneData {
    channels: Partial<Record<DataChannel, PackedChannel>>;
    nodesq: PackedChannelU32 | null;
}

/** Execute a scene-data plan. Null when the scene has no data to upload. */
export async function packSceneData(plan: SceneDataPlan): Promise<PackedSceneData | null> {
    const { layout } = plan;
    if (DATA_CHANNELS.every((c) => layout.totals[c] === 0) && layout.totals.nodesq === 0) return null;
    const ch = Object.fromEntries(DATA_CHANNELS.map((c) => [c, allocChannel(layout.totals[c])])) as Record<DataChannel, PackedChannel>;
    const chq = layout.totals.nodesq > 0 ? allocChannelU32(layout.totals.nodesq) : null;

    // Mesh geometry: vertex data + a BLAS per slot. A mesh object used in several slots (a
    // prototype shared by batches, or also used standalone) builds its BVH once.
    const packCache = new Map<object, PackedMesh>();
    const geometry: PackedMesh[] = plan.geometry.map(({ mesh, slot }) => {
        let p = packCache.get(mesh);
        if (p === undefined) { p = packMesh(mesh); packCache.set(mesh, p); }
        writeVec3s(ch.vertices, slot.vbase, mesh.positions, p.vertexCount);
        // Unauthored normals/uvs stay zero: the leaf reads them only for smooth shading / uv readers.
        if (mesh.normals !== undefined) writeVec3s(ch.normals, slot.vbase, mesh.normals, p.vertexCount);
        if (mesh.uvs !== undefined) writeVec2s(ch.uvs, slot.vbase, mesh.uvs, p.vertexCount);
        writeUvec3s(ch.indices, slot.tbase, p.reindexedTriangles, p.triCount);
        assertFits('mesh BLAS nodes', p.nodeCount * 2, nodeTexelBound(p.triCount));
        writeTexels(ch.nodes, slot.nbase, p.nodes.subarray(0, p.nodeCount * 8));
        return p;
    });

    // Samplable mesh emitters: world-space vertex positions and the triangle-area CDF.
    for (const { geometry: g, placement, slot } of plan.meshLights) {
        const p = geometry[g];
        const light = packMeshLight(plan.geometry[g].mesh, placement, p.reindexedTriangles);
        writeVec3s(ch.vertices, slot.wposBase, light.wpos, p.vertexCount);
        writeScalars(ch.records, slot.cdfBase, light.cdf, p.triCount);
    }

    // Instance batches: every batch's SAH build runs at once (in workers at cloud scale).
    const packedBatches: PackedInstanceBatch[] = await Promise.all(plan.batches.map((b) => packInstanceBatchOffThread(
        'geometry' in b.localBox ? geometry[b.localBox.geometry].rootBox : b.localBox.box,
        b.placements, b.attributes, b.paramsRecord, b.buildCwbvh)));
    const batchRoots: AABB[] = packedBatches.map((packed, i) => {
        const { slot } = plan.batches[i];
        const n = placementCount(plan.batches[i].placements);
        writeTexels(ch.records, slot.placementsBase, packed.placements);
        assertFits('instance TLAS nodes', packed.nodeCount * 2, nodeTexelBound(n));
        writeTexels(ch.nodes, slot.tlasBase, packed.nodes.subarray(0, packed.nodeCount * 8));
        if (packed.attributes !== undefined) writeTexels(ch.records, slot.attrsBase, packed.attributes);
        if (packed.cwbvh !== undefined && chq !== null) {
            assertFits('cwbvh nodes', packed.cwbvh.nodeCount * CWBVH_NODE_TEXELS, cwbvhNodeTexelBound(n));
            writeTexelsU32(chq, slot.cwbvhNodesBase, packed.cwbvh.nodes.subarray(0, packed.cwbvh.nodeCount * CWBVH_NODE_WORDS));
            writeTexels(ch.records, slot.cwbvhRecordsBase, packed.cwbvh.records);
        }
        return rootBoxOf(packed.nodes, packed.nodeCount);
    });

    const resolveBox = (source: BoxSource): AABB => {
        if ('box' in source) return source.box;
        if ('batch' in source) return batchRoots[source.batch];
        return transformAABB(geometry[source.geometry].rootBox, (pt) => similarityApplyPoint(source.placement, pt));
    };

    // The object table: records, a TLAS with exactly one object per leaf (the boxed-SDF leaf
    // marches over its node box, so node box = object box), and the leaf list in TLAS order.
    if (plan.sceneTable !== undefined) {
        const { slot, records, leaves } = plan.sceneTable;
        writeTexels(ch.records, slot.analyticBase, records);
        const tlas = buildBVHNodes(leaves.map((leaf) => resolveBox(leaf.box)), 1);
        assertFits('scene TLAS nodes', tlas.nodeCount * 2, nodeTexelBound(leaves.length));
        writeTexels(ch.nodes, slot.tlasBase, tlas.nodes.subarray(0, tlas.nodeCount * 8));
        const leafTexels = new Float32Array(leaves.length * 4);
        for (let i = 0; i < leaves.length; i++) {
            const leaf = leaves[tlas.order[i]];
            leafTexels[i * 4] = leaf.kind; leafTexels[i * 4 + 1] = leaf.ref;
        }
        writeTexels(ch.records, slot.leafListBase, leafTexels);
    }

    // The light tree: the registry lights' rows, then a tree over every light — registry
    // lights first, then each light-eligible batch's instances in record order.
    if (plan.lightTree !== undefined) {
        const { slot, table, lights, batchLights } = plan.lightTree;
        if (table.length > 0) writeTexels(ch.records, slot.tableBase, table);
        const total = lights.length + batchLights.reduce((a, b) => a + b.count, 0);
        const boxes = new Float64Array(6 * total);
        const powers = new Float64Array(total);
        lights.forEach((l, i) => {
            const b = resolveBox(l.box);
            boxes.set(b.min, 6 * i); boxes.set(b.max, 6 * i + 3);
            powers[i] = l.power;
        });
        let li = lights.length;
        for (const { batch, count, emission } of batchLights) {
            // Params-tier sphere records: (center.xyz, r). A sphere light's box is center ± r
            // and its power Φ = π·(4πr²)·Le, with Le the mean over channels of its emission.
            const recs = packedBatches[batch].placements;
            const attrs = packedBatches[batch].attributes;
            for (let k = 0; k < count; k++) {
                const cx = recs[4 * k], cy = recs[4 * k + 1], cz = recs[4 * k + 2], r = recs[4 * k + 3];
                boxes[6 * li] = cx - r; boxes[6 * li + 1] = cy - r; boxes[6 * li + 2] = cz - r;
                boxes[6 * li + 3] = cx + r; boxes[6 * li + 4] = cy + r; boxes[6 * li + 5] = cz + r;
                let le: number;
                if ('attribute' in emission && attrs !== undefined) {
                    const t = (k * emission.attribute.rows + emission.attribute.slot) * 4;
                    le = (attrs[t] + attrs[t + 1] + attrs[t + 2]) / 3;
                } else {
                    le = 'constant' in emission ? emission.constant : 0;
                }
                powers[li] = Math.max(1e-8, Math.PI * 4 * Math.PI * r * r * le);
                li++;
            }
        }
        const tree = await buildLightTreeOffThread(boxes, powers, total);
        assertFits('light tree nodes', tree.nodeCount * 2, nodeTexelBound(total));
        writeTexels(ch.nodes, slot.treeBase, tree.nodes.subarray(0, tree.nodeCount * 8));
        writeTexels(ch.records, slot.trailsBase, tree.trails);
    }

    // Region→material ids, four per texel.
    if (plan.regionMaterials !== undefined) {
        const { base, texels, ids } = plan.regionMaterials;
        assertFits('region-material ids', Math.ceil(ids.length / 4), texels);
        const data = new Float32Array(texels * 4);
        data.set(ids);
        writeTexels(ch.records, base, data);
    }

    const channels: Partial<Record<DataChannel, PackedChannel>> = {};
    for (const c of DATA_CHANNELS) {
        if (layout.totals[c] > 0) channels[c] = ch[c];
    }
    return { channels, nodesq: chq };
}
