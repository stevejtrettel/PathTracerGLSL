// compiler/plan/dataTenants.ts — THE scene→ledger adapter (fable-data-rail §4/§7).
//
// One function turns a SceneDescription into the ledger's tenant counts — called by the
// Planner (to bake region bases) AND the App (to pack payloads), so the two sides feed
// planDataLayout identical inputs by construction. Lives compiler-side because it needs
// compiler predicates (the samplable-emitter test); the ledger itself stays pure in
// components/data. Geometry-slot convention (encoded HERE, nowhere else): standalone
// meshes in sceneMeshes order, THEN mesh prototypes in batch-ordinal order.

import type { SceneDescription, MeshObject } from '../types.js';
import { isMeshObject, isPrimitiveObject, hasConstantNonzeroEmission } from '../types.js';
import { isDrivenTransform } from '../../components/geometry/similarity.js';
import { PRIMITIVES, resolveBackend } from '../../components/geometry/index.js';
import { sceneMeshes } from '../../components/intersection/mesh/mesh.js';
import { sceneInstanceBatches, instanceAttributeRows } from '../../components/intersection/instancing/instancing.js';
import { ANALYTIC_RECORD_TEXELS, LEAF_ANALYTIC, LEAF_MESH, LEAF_BATCH } from '../../components/intersection/index.js';
import type { DataTenants } from '../../components/data/ledger.js';

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
    /** The scene table, or null when no eligible objects exist. */
    table: SceneTable | null;
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

    const batchTenants = batches.map((b) => ({
        instanceCount: b.placements.length,
        attrTexels: instanceAttributeRows(scene.materials[b.prototype.material]?.model ?? '', b.attributes ?? {}).length * b.placements.length,
    }));

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
        if (isDrivenTransform(o.transform)) return;
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
        table,
    };
}
