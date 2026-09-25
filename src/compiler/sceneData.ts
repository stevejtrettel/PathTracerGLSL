// compiler/sceneData.ts — the SCENE-DATA PLAN: everything the App needs to build the shared
// scene-data textures, computed from the Planner's own results. The App executes it
// (app/sceneData.ts) and decides nothing about the scene: every value that depends on the
// scene description — folded object parameters, light rows and powers, region→material ids,
// record order — is computed here, once, by the same code the generated programs were built
// from. What is left to the App is the expensive, data-sized work: building BVHs over meshes,
// instance clouds and lights, and writing the bytes.

import type { SceneDescription, MeshObject, PackedPlacements } from './types.js';
import type { RenderPlan, PlannedPrimitiveObject } from './plan/types.js';
import { isAttributeValue } from './plan/types.js';
import type { DataLayout, MeshSlot, MeshLightSlot, BatchSlot, SceneTableSlot, LightTreeSlot } from '../components/data/ledger.js';
import { similarityFromTransform, similarityApplyPoint, rigidInverse, type Similarity } from '../components/geometry/similarity.js';
import { primitive, primitiveBounds } from '../components/geometry/index.js';
import { transformAABB, type AABB } from '../components/accel/bvh/bvh.js';
import { sceneMeshes } from '../components/intersection/mesh/mesh.js';
import { sceneInstanceBatches, type AttributeRowSpec, type ParamsRecordSpec } from '../components/intersection/instancing/instancing.js';
import { ANALYTIC_RECORD_TEXELS, LEAF_ANALYTIC, LEAF_MESH, LEAF_SDF } from '../components/intersection/index.js';
import { LIGHT_KINDS, radiantScalar } from '../components/lights/index.js';
import { lightTableLayout, packLightTable } from '../components/lights/table.js';
import { EMISSION_KEY } from '../components/materials/index.js';
import { recordPack, sdfRecordPack } from './generate/records.js';
import { resolveLightValues } from './generate/features/lighting.js';

/** Where a world-space box comes from: known now, or the root box of a BVH the App builds
 *  (a mesh geometry slot's BLAS under a placement, or an instance batch's TLAS). */
export type BoxSource =
    | { box: AABB }
    | { geometry: number; placement: Similarity }
    | { batch: number };

export interface SceneDataPlan {
    /** Every region's base and every channel's size. */
    layout: DataLayout;
    /** Mesh geometry, one entry per slot in slot order: standalone meshes (scene order), then
     *  mesh prototypes (batch order). Each gets its vertex data and a BLAS. */
    geometry: Array<{ mesh: MeshObject; slot: MeshSlot }>;
    /** Samplable mesh emitters: a world-position bake and an area CDF over their triangles. */
    meshLights: Array<{ geometry: number; placement: Similarity; slot: MeshLightSlot }>;
    /** Instance batches in batch order: placement records + a TLAS each. */
    batches: Array<{
        slot: BatchSlot;
        /** The prototype's local box: a geometry slot's BLAS root, or its primitive bounds. */
        localBox: { geometry: number } | { box: AABB };
        placements: Similarity[] | PackedPlacements;
        attributes?: AttributeRowSpec[];
        /** Present on the params tier (1-texel folded-parameter records). */
        paramsRecord?: ParamsRecordSpec;
        /** Build the CWBVH too (some renderer reads it). */
        buildCwbvh: boolean;
    }>;
    /** The object table (present when some renderer uses table dispatch). */
    sceneTable?: {
        slot: SceneTableSlot;
        /** The analytic + boxed-SDF record region, packed, record order. */
        records: Float32Array;
        /** Leaves in canonical order; the TLAS permutes them, and the leaf list follows it. */
        leaves: Array<{ kind: number; ref: number; box: BoxSource }>;
    };
    /** The light tree (present when some renderer selects lights with it). */
    lightTree?: {
        slot: LightTreeSlot;
        /** The registry lights' table rows, packed (light-id order). */
        table: Float32Array;
        /** The registry lights' boxes and powers (light-id order). */
        lights: Array<{ box: BoxSource; power: number }>;
        /** Light-eligible batches: their instances are lights after the registry ones, in
         *  record order. Boxes and powers come from the packed sphere records (center, r). */
        batchLights: Array<{ batch: number; count: number; emission: { constant: number } | { attribute: { slot: number; rows: number } } }>;
    };
    /** Region→material ids, four per texel (present with the object table). */
    regionMaterials?: { base: number; texels: number; ids: number[] };
}

/** Build the scene-data plan from a strategy's RenderPlan. Every strategy of a scene compiled
 *  together plans the same scene data (same layout, same objects and lights), so any one of
 *  them serves. */
export function sceneDataPlanOf(scene: SceneDescription, plan: RenderPlan): SceneDataPlan {
    const { tenants, layout } = plan.data;
    const meshObjects = sceneMeshes(scene.objects);
    const batchObjects = sceneInstanceBatches(scene.objects);
    const byRegion = new Map<number, PlannedPrimitiveObject>(plan.objects.map((o) => [o.index, o]));
    // A mesh emitter or table leaf has a CONSTANT placement (driven ones are excluded from both).
    const constantPlacement = (ordinal: number): Similarity => plan.meshes.find((m) => m.ordinal === ordinal)!.placement as Similarity;

    const geometry: SceneDataPlan['geometry'] = meshObjects.map((mesh, i) => ({ mesh, slot: layout.meshes[i] }));
    batchObjects.forEach((b, ordinal) => {
        const g = tenants.batchGeometrySlot[ordinal];
        if (g !== null) geometry[g] = { mesh: b.prototype as MeshObject, slot: layout.meshes[g] };
    });

    const meshLights = plan.lights
        .filter((l) => l.mesh !== undefined)
        .map((l) => ({ geometry: l.mesh!.ordinal, placement: constantPlacement(l.mesh!.ordinal), slot: layout.meshLights.get(l.mesh!.ordinal)! }));

    const batches: SceneDataPlan['batches'] = plan.instanceBatches.map((pb) => {
        const b = batchObjects[pb.ordinal];
        const slot = layout.batches[pb.ordinal];
        const proto = pb.prototype;
        return {
            slot,
            localBox: proto.backend === 'mesh'
                ? { geometry: tenants.batchGeometrySlot[pb.ordinal]! }
                : { box: primitiveBounds(proto.shapeType, proto.parameters)! },   // bounded: Validator-enforced
            placements: Array.isArray(b.placements) ? b.placements.map((t) => similarityFromTransform(t)) : b.placements,
            ...(pb.attributeRows !== undefined
                ? { attributes: pb.attributeRows.map((r) => ({ shape: r.shape, values: b.attributes![r.source] })) }
                : {}),
            ...(proto.backend === 'primitive' && proto.record === 'params'
                ? { paramsRecord: { type: proto.shapeType, parameters: proto.parameters } }
                : {}),
            buildCwbvh: slot.cwbvhNodesBase >= 0,
        };
    });

    const out: SceneDataPlan = { layout, geometry, meshLights, batches };

    const table = tenants.table;
    if (table !== null && layout.sceneTable !== undefined) {
        const records = new Float32Array((table.analytic.length + table.sdf.length) * ANALYTIC_RECORD_TEXELS * 4);
        const recordAt = (slot: number, data: number[]) => records.set(data, slot * ANALYTIC_RECORD_TEXELS * 4);
        table.analytic.forEach((a, slot) => {
            const o = byRegion.get(a.sceneIndex)!;
            recordAt(slot, [table.kindCodes.get(a.type)!, a.sceneIndex, 0, 0, ...recordPack(primitive(a.type), o.parameters)]);
        });
        // A boxed-SDF record carries its folded parameters and the inverse of its rigid
        // residual placement (the leaf march conjugates the ray by it once per visit).
        table.sdf.forEach((s, i) => {
            const o = byRegion.get(s.sceneIndex)!;
            const inv = rigidInverse(o.placement as Similarity);
            recordAt(table.analytic.length + i, [table.sdfKindCodes.get(s.type)!, s.sceneIndex, 0, 0, ...sdfRecordPack(primitive(s.type), o.parameters, inv.q, inv.ts)]);
        });
        const leaves = table.leaves.map((leaf): { kind: number; ref: number; box: BoxSource } => {
            if (leaf.kind === LEAF_ANALYTIC) {
                const a = table.analytic[leaf.ref];
                return { ...leaf, box: { box: primitiveBounds(a.type, byRegion.get(a.sceneIndex)!.parameters)! } };
            }
            if (leaf.kind === LEAF_MESH) return { ...leaf, box: { geometry: leaf.ref, placement: constantPlacement(leaf.ref) } };
            if (leaf.kind === LEAF_SDF) {
                const s = table.sdf[leaf.ref];
                const o = byRegion.get(s.sceneIndex)!;
                const residual = o.placement as Similarity;
                return { ...leaf, box: { box: transformAABB(primitiveBounds(s.type, o.parameters)!, (p) => similarityApplyPoint(residual, p)) } };
            }
            return { ...leaf, box: { batch: leaf.ref } };
        });
        out.sceneTable = { slot: layout.sceneTable, records, leaves };
    }

    if (layout.lightTree !== undefined) {
        const resolved = plan.lights.map((l) => ({ kind: l.kind, values: resolveLightValues(l) }));
        const table = resolved.length > 0 ? packLightTable(resolved, lightTableLayout(resolved.map((l) => l.kind))) : new Float32Array(0);
        const lights = resolved.map((l, i) => {
            const d = LIGHT_KINDS[l.kind];
            const tb = d.treeBounds!;   // the tree is allocated only when every kind declares it
            const box: BoxSource = tb === 'data'
                ? { geometry: plan.lights[i].mesh!.ordinal, placement: constantPlacement(plan.lights[i].mesh!.ordinal) }
                : { box: tb(l.values) };
            return { box, power: d.power(l.values) };
        });
        const batchLights = tenants.lightBatches.map(({ ordinal, count }) => {
            const pb = plan.instanceBatches.find((b) => b.ordinal === ordinal)!;
            const e = plan.materials[pb.materialId].values[EMISSION_KEY];
            // Per-instance emission rides the batch's attribute records; otherwise every
            // instance shares the material's constant emission (radiant scalar = channel mean).
            const emission = isAttributeValue(e)
                ? { attribute: { slot: e.attribute.slot, rows: e.attribute.count } }
                : { constant: Array.isArray(e) ? radiantScalar(e as number[]) : 0 };
            return { batch: ordinal, count, emission };
        });
        out.lightTree = { slot: layout.lightTree, table, lights, batchLights };
    }

    if (layout.regionMaterials !== undefined && tenants.tenants.regionMaterials !== null) {
        // Every region is one planned object, mesh or batch; ids in region order.
        const ids = [...plan.objects, ...plan.meshes, ...plan.instanceBatches]
            .sort((a, b) => a.index - b.index)
            .map((o) => o.materialId);
        out.regionMaterials = { base: layout.regionMaterials.base, texels: Math.ceil(tenants.tenants.regionMaterials.count / 4), ids };
    }

    return out;
}
