// compiler/plan/dataTenants.ts — THE scene→ledger adapter (fable-data-rail §4/§7).
//
// One function turns a SceneDescription into the ledger's tenant counts — called by the
// Planner (to bake region bases) AND the App (to pack payloads), so the two sides feed
// planDataLayout identical inputs by construction. Lives compiler-side because it needs
// compiler predicates (the samplable-emitter test); the ledger itself stays pure in
// components/data. Geometry-slot convention (encoded HERE, nowhere else): standalone
// meshes in sceneMeshes order, THEN mesh prototypes in batch-ordinal order.

import type { SceneDescription, MeshObject, PrimitiveObject, InstancedObject } from '../types.js';
import { isMeshObject, isPrimitiveObject, hasConstantNonzeroEmission, isGlslExpression } from '../types.js';
import { isDrivenTransform, isIdentityRotation, similarityFromTransform } from '../../components/geometry/similarity.js';
import { PRIMITIVES, paramsRecordFloats, resolveBackend } from '../../components/geometry/index.js';
import { MATERIAL_MODELS } from '../../components/materials/index.js';
import { sceneMeshes } from '../../components/intersection/mesh/mesh.js';
import { sceneInstanceBatches, instanceAttributeRows, placementCount } from '../../components/intersection/instancing/instancing.js';
import { cwbvhNodeTexelBound } from '../../components/accel/cwbvh/cwbvh.js';
import { ANALYTIC_RECORD_TEXELS, LEAF_ANALYTIC, LEAF_MESH, LEAF_BATCH } from '../../components/intersection/index.js';
import type { DataTenants } from '../../components/data/ledger.js';

/** Does material `name` read Hit.uv? — i.e. is it a PROCEDURAL material: the checker model
 *  (readsUv capability) OR any material carrying a GLSL formula (fable-imagery P2 expression
 *  materials). COARSE by choice (owner Jul 21): a formula reading only `p` counts too, matching
 *  the materialsReadUv gate — correctness-safe, slightly over-eager. THE ONE "reads uv" notion,
 *  shared by the chart-EMISSION gate (materialsReadUv) and the rotation-tracking gate
 *  (keepsLocalFrame), so a uv-formula on a ROTATED shape can never silently fall back to an
 *  axis-aligned chart. Precise per-formula uv-detection is the noted follow-up. */
export function materialReadsUv(name: string, scene: SceneDescription): boolean {
    const mat = scene.materials[name];
    if (mat === undefined) return false;
    return (MATERIAL_MODELS[mat.model ?? '']?.capabilities.readsUv ?? false)
        || Object.values(mat).some(isGlslExpression);
}

/** A PATTERNED + rotated analytic shape keeps its own LOCAL frame (fable-imagery P1b): its
 *  material reads Hit.uv and it carries a rotation, so it is NOT folded (the chart needs the
 *  frame the fold would dissolve). Like a driven object it therefore cannot be TABLED (records
 *  assume folded params) and stays in the unrolled wrapper arm. THE ONE predicate both the
 *  table adapter (exclude) and the Planner (retain the similarity) read — so the two decisions
 *  cannot drift. */
export function keepsLocalFrame(obj: PrimitiveObject, scene: SceneDescription): boolean {
    if (PRIMITIVES[obj.type]?.uvChart !== true) return false;
    return materialReadsUv(obj.material, scene) && !isIdentityRotation(similarityFromTransform(obj.transform).rotation);
}

/** One scene-TLAS leaf (canonical pre-TLAS order; the App reorders by the tree). */
export interface SceneTableLeaf {
    /** LEAF_ANALYTIC | LEAF_MESH | LEAF_BATCH. */
    kind: number;
    /** analytic → record slot; mesh → mesh ordinal; batch → batch ordinal. */
    ref: number;
}

/** The scene table's ONE truth (fable-object-tables): which objects join, in what
 *  record order (SOLIDS FIRST — the containment loop iterates [0, solidCount)), with
 *  which primitive kind codes. Planner (baked literals + generated dispatch) and App
 *  (record packing + leaf boxes) both read THIS. */
export interface SceneTable {
    leaves: SceneTableLeaf[];
    /** Analytic table objects in RECORD order (solids first). sceneIndex = position in
     *  scene.objects ( ≡ the region id the Planner assigns). */
    analytic: Array<{ sceneIndex: number; type: string; solid: boolean }>;
    solidCount: number;
    /** Primitive kind → the record header's kind code (registry order over present kinds). */
    kindCodes: Map<string, number>;
}

export interface SceneDataTenants {
    tenants: DataTenants;
    /** Geometry-slot index per BATCH ordinal (null = analytic/SDF prototype, no slot). */
    batchGeometrySlot: Array<number | null>;
    /** Placement-record tier per BATCH ordinal (impl-plan-placement-fold stage 3 — the
     *  §6.1 stride amendment): 'params' = 1-texel folded-parameters record (world-space
     *  intersect, no conjugation), 'frame' = the 2-texel rigid record. THE ONE tier
     *  truth — Planner (prototype decision + ledger stride) and App (record packing)
     *  both read this array, so stride and payload cannot drift. */
    batchPlacementRecord: Array<'frame' | 'params'>;
    /** The scene table, or null when no eligible objects exist. */
    table: SceneTable | null;
}

/** The params-tier decision for one batch: shape facts (paramsRecordFloats — closed ∧
 *  analytic ∧ one texel) ∧ the scene-side uv gate (a uv-reading material's chart is
 *  genuinely rotated by per-instance orientations, so those batches keep the local
 *  frame — keepsLocalFrame's instancing sibling) ∧ no authored 'frame' pin. Decided
 *  from SHAPE and MATERIAL only, never from placement data — retune (repack) can
 *  never change the compiled stride. */
export function batchPlacementRecordOf(b: InstancedObject, scene: SceneDescription): 'frame' | 'params' {
    if (isMeshObject(b.prototype) || b.placementRecord === 'frame') return 'frame';
    if (paramsRecordFloats(b.prototype.type) === null) return 'frame';
    return materialReadsUv(b.prototype.material, scene) ? 'frame' : 'params';
}

/** The ONE samplable-mesh-emitter predicate (fable-mesh-lights): shared by the ledger's
 *  light regions, the Planner's light route, and the App's light-table packing. */
export function meshIsSamplableEmitter(scene: SceneDescription, mesh: MeshObject): boolean {
    const mat = scene.materials[mesh.material];
    return mat !== undefined && mat.sampleAsLight !== false
        && hasConstantNonzeroEmission(mat.emission) && !isDrivenTransform(mesh.transform);
}

export function dataTenantsOf(scene: SceneDescription): SceneDataTenants {
    const meshes = sceneMeshes(scene.objects);
    const batches = sceneInstanceBatches(scene.objects);

    const geo = meshes.map((m) => ({ vertexCount: m.positions.length / 3, triCount: m.indices.length / 3 }));
    const batchGeometrySlot: Array<number | null> = [];
    for (const b of batches) {
        if (isMeshObject(b.prototype)) {
            batchGeometrySlot.push(geo.length);
            geo.push({ vertexCount: b.prototype.positions.length / 3, triCount: b.prototype.indices.length / 3 });
        } else {
            batchGeometrySlot.push(null);
        }
    }

    const batchPlacementRecord = batches.map((b) => batchPlacementRecordOf(b, scene));
    // CWBVH eligibility (fable-accel-cwbvh §6 v1 pins): params-tier analytic batches
    // WITHOUT attributes. Regions allocated whenever eligible (the always-upload
    // precedent — ONE scene layout serves every strategy; a tlas-only session simply
    // never reads them).
    const batchTenants = batches.map((b, i) => {
        const n = placementCount(b.placements);
        const attrTexels = instanceAttributeRows(scene.materials[b.prototype.material]?.model ?? '', b.attributes ?? {}).length * n;
        const cwbvhEligible = batchPlacementRecord[i] === 'params' && attrTexels === 0;
        return {
            instanceCount: n,
            placementTexels: (batchPlacementRecord[i] === 'params' ? 1 : 2) as 1 | 2,
            attrTexels,
            cwbvhNodeTexels: cwbvhEligible ? cwbvhNodeTexelBound(n) : 0,
            cwbvhRecordTexels: cwbvhEligible ? n : 0,
        };
    });

    const meshLights = meshes
        .map((m, i) => ({ m, i }))
        .filter(({ m }) => meshIsSamplableEmitter(scene, m))
        .map(({ m, i }) => ({ meshOrdinal: i, vertexCount: m.positions.length / 3, triCount: m.indices.length / 3 }));

    // ── The scene TABLE (fable-object-tables): eligible = bounded, CONSTANT-placement
    // analytic objects + constant meshes + every batch. Driven/unbounded objects stay in
    // the residual unrolled arm; SDF objects stay in the marcher arm. Analytic records
    // order SOLIDS FIRST (the containment loop's range). Strategy-independent: allocated
    // and packed whether or not any strategy tables them.
    const analyticEligible: Array<{ sceneIndex: number; type: string; solid: boolean }> = [];
    scene.objects.forEach((o, i) => {
        if (!isPrimitiveObject(o)) return;
        if (isDrivenTransform(o.transform) || keepsLocalFrame(o, scene)) return;   // not folded → residual, never tabled
        if (resolveBackend(o.type, o.backend) !== 'analytic') return;
        const d = PRIMITIVES[o.type];
        if (d?.bounds === undefined) return;   // unbounded (plane) → residual
        analyticEligible.push({ sceneIndex: i, type: o.type, solid: d.thin !== true });
    });
    const analytic = [...analyticEligible.filter((a) => a.solid), ...analyticEligible.filter((a) => !a.solid)];
    const kindCodes = new Map<string, number>();
    for (const t of Object.keys(PRIMITIVES)) {
        if (analytic.some((a) => a.type === t)) kindCodes.set(t, kindCodes.size);
    }
    const leaves: SceneTableLeaf[] = [
        ...analytic.map((_, slot) => ({ kind: LEAF_ANALYTIC, ref: slot })),
        ...meshes.map((m, i) => ({ m, i })).filter(({ m }) => !isDrivenTransform(m.transform)).map(({ i }) => ({ kind: LEAF_MESH, ref: i })),
        ...batches.map((_, i) => ({ kind: LEAF_BATCH, ref: i })),
    ];
    const table: SceneTable | null = leaves.length > 0
        ? { leaves, analytic, solidCount: analytic.filter((a) => a.solid).length, kindCodes }
        : null;

    return {
        tenants: {
            meshes: geo, batches: batchTenants, meshLights,
            sceneTable: table !== null
                ? { leafCount: table.leaves.length, analyticTexels: table.analytic.length * ANALYTIC_RECORD_TEXELS }
                : null,
        },
        batchGeometrySlot,
        batchPlacementRecord,
        table,
    };
}
