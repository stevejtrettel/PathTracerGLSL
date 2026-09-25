// app/sceneData.ts — builds the shared scene-data textures: meshes and their BVHs, instance
// batches and their TLASes, mesh-light tables, and the optional structures (CWBVH, object
// table, light tree, region→material ids) that the scene's renderers read. Pure apart from
// optional worker offloading (with a synchronous fallback), so it runs in tests.

import { packMesh, sceneMeshes, type PackedMesh } from '../components/intersection/mesh/mesh.js';
import { sceneInstanceBatches, instanceAttributeRows, placementCount, type AttributeRowSpec, type PackedInstanceBatch } from '../components/intersection/instancing/instancing.js';
import { packInstanceBatchOffThread } from './utils/instancePack.js';
import { similarityFromTransform, similarityApplyPoint, rigidInverse } from '../components/geometry/similarity.js';
import { canonicalizePrimitiveParameters, primitiveBounds, foldPlacementIntoParameters, primitive, classifyPlacement } from '../components/geometry/index.js';
import { buildBVHNodes, rootBoxOf, transformAABB, type AABB } from '../components/accel/bvh/bvh.js';
import { recordPack, sdfRecordPack } from '../compiler/generate/records.js';
import { ANALYTIC_RECORD_TEXELS, LEAF_ANALYTIC, LEAF_MESH, LEAF_SDF } from '../components/intersection/index.js';
import { packMeshLight } from '../components/lights/mesh/mesh.js';
import { isMeshObject, isBlackbody, type MeshObject, type PrimitiveObject, type SceneDescription, type DataReads } from '../compiler/types.js';
import { dataTenantsOf, lightRosterOf, meshIsSamplableEmitter, regionMaterialsOf } from '../compiler/plan/dataTenants.js';
import { buildLightTreeOffThread } from './utils/lightTreePack.js';
import { lightTableLayout, packLightTable } from '../components/lights/table.js';
import { LIGHT_KINDS, radiantScalar } from '../components/lights/index.js';
import { EMISSION_KEY } from '../components/materials/index.js';
import { foldBlackbody } from '../components/lights/blackbody.js';
import { resolveLightValues } from '../compiler/generate/features/lighting.js';
import { planDataLayout, nodeTexelBound, assertFits, type MeshSlot } from '../components/data/ledger.js';
import { allocChannel, allocChannelU32, writeTexels, writeTexelsU32, writeVec3s, writeVec2s, writeScalars, writeUvec3s, type PackedChannel, type PackedChannelU32 } from '../components/data/pack.js';
import { DATA_CHANNELS, type DataChannel } from '../components/data/channels.js';
import { CWBVH_NODE_TEXELS, CWBVH_NODE_WORDS, cwbvhNodeTexelBound } from '../components/accel/cwbvh/cwbvh.js';

/** The packed channels to upload (only channels with data), plus the CWBVH's integer channel. */
export interface PackedSceneData {
    channels: Partial<Record<DataChannel, PackedChannel>>;
    nodesq: PackedChannelU32 | null;
}

/**
 * Pack the scene's data textures for the layout the renderers were compiled against — the
 * optional structures in `reads` (CompiledScene.dataReads) — at the ledger's region bases.
 * It makes the SAME dataTenantsOf + planDataLayout call, with the same `reads`, that the
 * Planner baked its offsets from, so bytes and offsets agree. Null when the scene has no data.
 * A pack CACHE (by object reference) means a prototype shared by batches — or used
 * standalone too — builds its BVH once.
 */
export async function packSceneData(scene: SceneDescription, reads: DataReads): Promise<PackedSceneData | null> {
    const { tenants, batchGeometrySlot, batchPlacementRecord, table, lightBatches } = dataTenantsOf(scene, reads);
    // sceneTable joined the condition with the regionMaterials tenant (impl-plan-
    // region-materials): a tabled scene with no meshes/batches and a tree-ineligible
    // light roster still MUST upload its records — the previous condition silently
    // skipped that case.
    if (tenants.meshes.length === 0 && tenants.batches.length === 0 && tenants.lightTree === null && tenants.sceneTable === null) return null;
    const layout = planDataLayout(tenants);
    const ch: Record<(typeof DATA_CHANNELS)[number], PackedChannel> = {
        vertices: allocChannel(layout.totals.vertices),
        normals: allocChannel(layout.totals.normals),
        uvs: allocChannel(layout.totals.uvs),
        indices: allocChannel(layout.totals.indices),
        nodes: allocChannel(layout.totals.nodes),
        records: allocChannel(layout.totals.records),
    };
    // The integer CWBVH node channel (fable-accel-cwbvh §6) — allocated iff any
    // batch is cwbvh-eligible (the ledger's nodesq total).
    const chq = layout.totals.nodesq > 0 ? allocChannelU32(layout.totals.nodesq) : null;

    const packCache = new Map<MeshObject, PackedMesh>();
    const packCached = (m: MeshObject): PackedMesh => {
        let p = packCache.get(m);
        if (p === undefined) { p = packMesh(m); packCache.set(m, p); }
        return p;
    };
    // Write one mesh's payloads at its geometry slot (LOCAL ids stored; bases baked
    // compiler-side). Normals/uvs regions stay zero-filled when unauthored (the leaf
    // reads them only under useSmooth / a uv reader — the v0 pin, unchanged).
    const writeMesh = (mesh: MeshObject, slot: MeshSlot): PackedMesh => {
        const p = packCached(mesh);
        writeVec3s(ch.vertices, slot.vbase, mesh.positions, p.vertexCount);
        if (mesh.normals !== undefined) writeVec3s(ch.normals, slot.vbase, mesh.normals, p.vertexCount);
        if (mesh.uvs !== undefined) writeVec2s(ch.uvs, slot.vbase, mesh.uvs, p.vertexCount);
        writeUvec3s(ch.indices, slot.tbase, p.reindexedTriangles, p.triCount);
        assertFits('mesh BLAS nodes', p.nodeCount * 2, nodeTexelBound(p.triCount));
        writeTexels(ch.nodes, slot.nbase, p.nodes.subarray(0, p.nodeCount * 8));
        return p;
    };

    sceneMeshes(scene.objects).forEach((mesh, ordinal) => {
        const p = writeMesh(mesh, layout.meshes[ordinal]);
        // Samplable mesh emitter (fable-mesh-lights): the world-position bake rides the
        // vertices channel, the area CDF the records channel — regions the ledger
        // allocated iff the ONE adapter predicate (meshIsSamplableEmitter) said so.
        const lslot = layout.meshLights.get(ordinal);
        if (lslot !== undefined) {
            const light = packMeshLight(mesh, similarityFromTransform(mesh.transform), p.reindexedTriangles);
            writeVec3s(ch.vertices, lslot.wposBase, light.wpos, p.vertexCount);
            writeScalars(ch.records, lslot.cdfBase, light.cdf, p.triCount);
        }
    });

    const batchRoots: AABB[] = [];
    const batches = sceneInstanceBatches(scene.objects);
    // Prep serially (writeMesh's channel writes stay on-thread, in ordinal order),
    // launching each batch's pack as soon as its inputs are ready — a multi-cloud
    // scene runs its SAH builds in CONCURRENT workers instead of one after another.
    const packs: Array<Promise<PackedInstanceBatch>> = [];
    for (let ordinal = 0; ordinal < batches.length; ordinal++) {
        const batch = batches[ordinal];
        // The prototype's LOCAL box (mesh = BLAS root; analytic = primitive bounds) → the
        // batch TLAS over the instance world boxes.
        let localBox: AABB;
        if (isMeshObject(batch.prototype)) {
            localBox = writeMesh(batch.prototype, layout.meshes[batchGeometrySlot[ordinal]!]).rootBox;
        } else {
            const canon = canonicalizePrimitiveParameters(batch.prototype.type, batch.prototype.parameters);
            const box = primitiveBounds(batch.prototype.type, canon);
            // Unbounded prototypes are Validator-rejected (A1) — a fabricated box would
            // silently drop instances under the TLAS, so absence here is a hard error.
            if (box === null) {
                throw new Error(`instanced prototype '${batch.prototype.type}' declares no bounds() — unbounded primitives cannot be instanced (the Validator rejects this scene)`);
            }
            localBox = box;
        }
        // Two placement forms (fable-instance-clouds §4): authored Transform[] lowers to
        // Similarity[]; the packed struct-of-arrays passes straight through to the pack.
        const placements = Array.isArray(batch.placements)
            ? batch.placements.map((t) => similarityFromTransform(t))
            : batch.placements;
        const attrs: AttributeRowSpec[] | undefined = batch.attributes !== undefined
            ? instanceAttributeRows(scene.materials[batch.prototype.material]?.model ?? '', batch.attributes)
                .map((r) => ({ shape: r.shape, values: batch.attributes![r.source] }))
            : undefined;
        // Params tier (impl-plan-placement-fold stage 3): the adapter's ONE tier truth
        // — same array the Planner's stride/leaf-emission decisions read. The spec
        // carries the CANONICAL prototype values (the same canon the bounds read).
        const paramsRecord = batchPlacementRecord[ordinal] === 'params' && !isMeshObject(batch.prototype)
            ? { type: batch.prototype.type, parameters: canonicalizePrimitiveParameters(batch.prototype.type, batch.prototype.parameters) }
            : undefined;
        // Off the main thread (fable-instance-clouds §8 stage 2) — a 1M-instance SAH
        // build must not freeze the page; byte-identical output, sync fallback inside.
        // The CWBVH is built only when the ledger gave it a region, i.e. some renderer reads it.
        const buildCwbvh = layout.batches[ordinal].cwbvhNodesBase >= 0;
        packs.push(packInstanceBatchOffThread(localBox, placements, attrs, paramsRecord, buildCwbvh));
    }
    const packedBatches = await Promise.all(packs);
    packedBatches.forEach((packed, ordinal) => {
        const slot = layout.batches[ordinal];
        writeTexels(ch.records, slot.placementsBase, packed.placements);
        assertFits('instance TLAS nodes', packed.nodeCount * 2, nodeTexelBound(placementCount(batches[ordinal].placements)));
        writeTexels(ch.nodes, slot.tlasBase, packed.nodes.subarray(0, packed.nodeCount * 8));
        if (packed.attributes !== undefined) writeTexels(ch.records, slot.attrsBase, packed.attributes);
        // CWBVH payloads (fable-accel-cwbvh §6): built exactly when the ledger allocated
        // their regions (buildCwbvh above), so presence here ⇔ allocation.
        if (packed.cwbvh !== undefined && chq !== null && slot.cwbvhNodesBase >= 0) {
            assertFits('cwbvh nodes', packed.cwbvh.nodeCount * CWBVH_NODE_TEXELS, cwbvhNodeTexelBound(placementCount(batches[ordinal].placements)));
            writeTexelsU32(chq, slot.cwbvhNodesBase, packed.cwbvh.nodes.subarray(0, packed.cwbvh.nodeCount * CWBVH_NODE_WORDS));
            writeTexels(ch.records, slot.cwbvhRecordsBase, packed.cwbvh.records);
        }
        batchRoots.push(rootBoxOf(packed.nodes, packed.nodeCount));
    });

    // The scene TABLE (fable-object-tables): analytic records (folded via the SAME
    // canonicalize+fold chain the Planner bakes — bake ≡ ship), the leaf list in
    // TLAS-leaf order, and the scene TLAS itself.
    if (table !== null && layout.sceneTable !== undefined) {
        const S = layout.sceneTable;
        const meshList = sceneMeshes(scene.objects);
        // Folded values per analytic record (record order) + their world boxes.
        const foldedByRecord = table.analytic.map((a) => {
            const obj = scene.objects[a.sceneIndex];
            if (!('type' in obj)) throw new Error('scene table: analytic record points at a non-primitive');
            return foldPlacementIntoParameters(obj.type, obj.parameters, similarityFromTransform(obj.transform));
        });
        table.analytic.forEach((a, slot) => {
            const header = [table.kindCodes.get(a.type)!, a.sceneIndex, 0, 0];
            const payload = recordPack(primitive(a.type), foldedByRecord[slot]);
            writeTexels(ch.records, S.analyticBase + slot * ANALYTIC_RECORD_TEXELS, [...header, ...payload]);
        });
        // Boxed-SDF records (impl-plan-sdf-accel T2): classifyPlacement is the ONE
        // fold truth — T,s-folded params + the rigid residual as the §6.1 inverse
        // tail (the leaf march conjugates once per visit via placement_rigid/dir).
        // Slots follow the analytic block in the same region/stride.
        const sdfClassified = table.sdf.map((s) => {
            const obj = scene.objects[s.sceneIndex];
            if (!('type' in obj)) throw new Error('scene table: sdf record points at a non-primitive');
            return classifyPlacement(obj.type, obj.parameters, similarityFromTransform(obj.transform));
        });
        table.sdf.forEach((s, i) => {
            const slot = table.analytic.length + i;
            const cl = sdfClassified[i];
            const inv = rigidInverse(cl.residual);
            const header = [table.sdfKindCodes.get(s.type)!, s.sceneIndex, 0, 0];
            const payload = sdfRecordPack(primitive(s.type), cl.parameters, inv.q, inv.ts);
            writeTexels(ch.records, S.analyticBase + slot * ANALYTIC_RECORD_TEXELS, [...header, ...payload]);
        });
        // Leaf world boxes in the adapter's canonical leaf order.
        const leafBoxes: AABB[] = table.leaves.map((L) => {
            if (L.kind === LEAF_ANALYTIC) {
                const a = table.analytic[L.ref];
                return primitiveBounds(a.type, foldedByRecord[L.ref])!;   // bounded by eligibility
            }
            if (L.kind === LEAF_MESH) {
                const mesh = meshList[L.ref];
                const root = packCached(mesh).rootBox;
                return transformAABB(root, (pt) => similarityApplyPoint(similarityFromTransform(mesh.transform), pt));
            }
            if (L.kind === LEAF_SDF) {
                // bounds(folded params) through the rigid residual — 8 corners.
                const cl = sdfClassified[L.ref];
                const local = primitiveBounds(table.sdf[L.ref].type, cl.parameters)!;   // bounded by eligibility
                return transformAABB(local, (pt) => similarityApplyPoint(cl.residual, pt));
            }
            return batchRoots[L.ref];
        });
        // Leaf size 1 (fable-sdf-accel §2.1, landed at impl-plan-sdf-accel T1):
        // "node box = object box" is an INVARIANT — the LEAF_SDF arm's march
        // interval is the node box, so scene-TLAS leaves hold exactly one object.
        // Scene tables are tens of objects; the extra nodes are noise.
        const tlas = buildBVHNodes(leafBoxes, 1);
        assertFits('scene TLAS nodes', tlas.nodeCount * 2, nodeTexelBound(table.leaves.length));
        writeTexels(ch.nodes, S.tlasBase, tlas.nodes.subarray(0, tlas.nodeCount * 8));
        // Leaf list in TLAS-leaf order (the tree's permutation over the canonical list).
        const leafTexels = new Float32Array(table.leaves.length * 4);
        for (let i = 0; i < table.leaves.length; i++) {
            const L = table.leaves[tlas.order[i]];
            leafTexels[i * 4] = L.kind; leafTexels[i * 4 + 1] = L.ref;
        }
        writeTexels(ch.records, S.leafListBase, leafTexels);
    }

    // The light tree (fable-light-bvh §5/§7): table rows + tree nodes + bit trails
    // at the ledger's bases. Leaves span the GLOBAL light-index space — the
    // registry roster first (the Planner asserts plan.lights matches it kind-for-
    // kind), then each light-eligible batch's instances in RECORD order (the
    // packed params records: center.xyz, radius — the same rows the generated
    // arms read, so leaf k's box/Φ and leaf k's sampler agree by construction).
    if (layout.lightTree !== undefined) {
        const roster = lightRosterOf(scene);
        const resolved = roster.map((l) => ({ kind: l.kind, values: resolveLightValues(l) }));
        if (roster.length > 0) {
            writeTexels(ch.records, layout.lightTree.tableBase, packLightTable(resolved, lightTableLayout(roster.map((l) => l.kind))));
        }
        const total = roster.length + lightBatches.reduce((a, b) => a + b.count, 0);
        const lb = new Float64Array(6 * total);
        const pw = new Float64Array(total);
        // 'data'-form treeBounds (mesh): the box is PACK-side — the BLAS root box
        // under the constant placement. Roster route-3 order IS filtered sceneMeshes
        // order (the ONE census truth), so the k-th 'data' entry is the k-th
        // samplable mesh emitter.
        const meshEmitters = sceneMeshes(scene.objects).filter((m) => meshIsSamplableEmitter(scene, m));
        let meshIdx = 0;
        resolved.forEach((l, i) => {
            const d = LIGHT_KINDS[l.kind];
            const tb = d.treeBounds!;   // tenant eligibility guarantees the fact
            let b: AABB;
            if (tb === 'data') {
                const m = meshEmitters[meshIdx++];
                const sim = similarityFromTransform(m.transform);
                b = transformAABB(packCached(m).rootBox, (p) => similarityApplyPoint(sim, p));
            } else {
                b = tb(l.values);
            }
            lb.set(b.min, 6 * i); lb.set(b.max, 6 * i + 3);
            pw[i] = d.power(l.values);
        });
        let li = roster.length;
        for (const { ordinal, count } of lightBatches) {
            const proto = batches[ordinal].prototype as PrimitiveObject;
            const mat = scene.materials[proto.material];
            const emRaw = isBlackbody(mat.emission) ? foldBlackbody(mat.emission) : mat.emission;
            const em = typeof emRaw === 'number' ? [emRaw, emRaw, emRaw] : (emRaw as number[] | undefined);
            // PER-INSTANCE emission (fable-light-bvh §7.1): when the batch carries an
            // emission attribute, Φ reads each instance's color from the PACKED attrs
            // (leaf order — the same rows the generated arms fetch); else the material
            // constant. The sphere kind's formulas, inlined for the hot loop
            // (descriptor-cited: Φ = π·4π·r²·avg(Le); box = center ± r).
            const attrRows = instanceAttributeRows(mat.model ?? '', batches[ordinal].attributes ?? {});
            const emSlot = attrRows.findIndex((r) => r.source === EMISSION_KEY);
            const attrData = packedBatches[ordinal].attributes;
            const A = attrRows.length;
            const constLeAvg = em !== undefined ? radiantScalar(em) : 0;
            const recs = packedBatches[ordinal].placements;   // params tier: (cx, cy, cz, r)
            for (let k = 0; k < count; k++) {
                const cx = recs[4 * k], cy = recs[4 * k + 1], cz = recs[4 * k + 2], r = recs[4 * k + 3];
                lb[6 * li] = cx - r; lb[6 * li + 1] = cy - r; lb[6 * li + 2] = cz - r;
                lb[6 * li + 3] = cx + r; lb[6 * li + 4] = cy + r; lb[6 * li + 5] = cz + r;
                let leAvg = constLeAvg;
                if (emSlot >= 0 && attrData !== undefined) {
                    const t = (k * A + emSlot) * 4;
                    leAvg = (attrData[t] + attrData[t + 1] + attrData[t + 2]) / 3;
                }
                pw[li] = Math.max(1e-8, Math.PI * 4 * Math.PI * r * r * leAvg);
                li++;
            }
        }
        // Off the main thread at cloud scale (fable-light-bvh §7 — clebsch-glow's
        // 194k-leaf tree fired the trigger); small rosters build synchronously.
        const tree = await buildLightTreeOffThread(lb, pw, total);
        assertFits('light tree nodes', tree.nodeCount * 2, nodeTexelBound(total));
        writeTexels(ch.nodes, layout.lightTree.treeBase, tree.nodes.subarray(0, tree.nodeCount * 8));
        writeTexels(ch.records, layout.lightTree.trailsBase, tree.trails);
    }

    // The region→material id table (impl-plan-region-materials): four ids per
    // texel at the ledger base, from the ONE scene-side mirror the Planner asserts
    // against its own assignment (regionMaterialsOf — the light-roster pattern).
    if (layout.regionMaterials !== undefined) {
        const ids = regionMaterialsOf(scene);
        const texels = new Float32Array(Math.ceil(ids.length / 4) * 4);
        texels.set(ids);
        assertFits('region-material ids', Math.ceil(ids.length / 4), Math.ceil(ids.length / 4));
        writeTexels(ch.records, layout.regionMaterials.base, texels);
    }

    const channels: Partial<Record<DataChannel, PackedChannel>> = {};
    for (const c of DATA_CHANNELS) {
        if (layout.totals[c] > 0) channels[c] = ch[c];
    }
    return { channels, nodesq: chq };
}
