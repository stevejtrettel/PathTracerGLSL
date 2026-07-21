// compiler/plan/dataTenants.ts — THE scene→ledger adapter (fable-data-rail §4/§7).
//
// One function turns a SceneDescription into the ledger's tenant counts — called by the
// Planner (to bake region bases) AND the App (to pack payloads), so the two sides feed
// planDataLayout identical inputs by construction. Lives compiler-side because it needs
// compiler predicates (the samplable-emitter test); the ledger itself stays pure in
// components/data. Geometry-slot convention (encoded HERE, nowhere else): standalone
// meshes in sceneMeshes order, THEN mesh prototypes in batch-ordinal order.

import type { SceneDescription, MeshObject } from '../types.js';
import { isMeshObject, hasConstantNonzeroEmission } from '../types.js';
import { isDrivenTransform } from '../../components/geometry/similarity.js';
import { sceneMeshes } from '../../components/intersection/mesh/mesh.js';
import { sceneInstanceBatches, instanceAttributeRows } from '../../components/intersection/instancing/instancing.js';
import type { DataTenants } from '../../components/data/ledger.js';

export interface SceneDataTenants {
    tenants: DataTenants;
    /** Geometry-slot index per BATCH ordinal (null = analytic/SDF prototype, no slot). */
    batchGeometrySlot: Array<number | null>;
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

    return { tenants: { meshes: geo, batches: batchTenants, meshLights }, batchGeometrySlot };
}
