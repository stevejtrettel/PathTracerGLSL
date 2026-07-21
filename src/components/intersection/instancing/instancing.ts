// components/intersection/instancing/instancing.ts — the placement-list multiplier
// (impl-plan-instancing). NOT an engine of its own: an instanced batch is the driven ray-into-local
// wrapper looped over a placement texture, against a shared prototype (a mesh BLAS or an analytic
// closed form). This file owns the TS both compiler and app depend on:
//   - sceneInstanceBatches(objects) — THE batch-ordinal truth: the scene's instanced batches in
//     scene order. Planner (extern declaration) and App (upload) both iterate THIS list, so the
//     ordinal↔object assignment can never diverge (the audit's A5 replay hazard) — including when
//     a batch is Validator-rejected (it still holds its ordinal on both sides).
//   - instanceExternNames(ordinal) — the extern texture names for a batch (placement texture + the
//     prototype's mesh BLAS textures, when the prototype is a mesh).
//   - packPlacements / packInstanceBatch — the per-instance rigid-frame pairs + the batch TLAS,
//     on the data rail (components/data_textures.ts). Build core from accel/bvh (no imports from
//     the mesh sibling — both leaves stand on the same substrates). Pure TS (components purity;
//     the instanced-kind predicate is restated locally, type-only compiler imports).

import type { InstancedObject, ObjectDescription } from '../../../compiler/types.js';
import type { Similarity } from '../../geometry/similarity.js';
import { rigidInverse, similarityApplyPoint } from '../../geometry/similarity.js';
import { allocTexels, type PackedTexture } from '../../data_textures.js';
import { buildBVHNodes, packNodes, transformAABB, type AABB } from '../../accel/bvh/bvh.js';
import { MATERIAL_MODELS } from '../../materials/index.js';

/** The scene's instanced batches in scene order — index IS the batch ordinal (see header). */
export function sceneInstanceBatches(objects: readonly ObjectDescription[]): InstancedObject[] {
    return objects.filter((o): o is InstancedObject => 'kind' in o && o.kind === 'instanced');
}

/** One attribute row's pack spec: the row shape + N authored entries (scene order;
 *  Spectrum rows accept scalar broadcast per entry). */
export interface AttributeRowSpec {
    shape: 'float' | 'vec3';
    values: ReadonlyArray<number | [number, number, number]>;
}

/** THE slot-order truth for a batch's attribute rows (fable-instance-attributes): the
 *  prototype material model's schema rows, in SCHEMA order, filtered to the authored keys.
 *  The Planner (slot minting → the generated fetches) and the App (texture packing) both
 *  call THIS, so the texel layout cannot drift between compile and upload. */
export function instanceAttributeRows(model: string, attributes: Record<string, unknown>): Array<{ source: string; shape: 'float' | 'vec3' }> {
    const props = MATERIAL_MODELS[model]?.properties ?? [];
    return props
        .filter((f) => f.storage === 'field' && f.source in attributes)
        .map((f) => ({ source: f.source, shape: f.glslType === 'Spectrum' ? 'vec3' as const : 'float' as const }));
}

export interface InstanceExternNames {
    /** The per-instance placement texture (2 texels/instance: q_inv, (t_rigid, s)) — in TLAS order. */
    placements: string;
    /** The per-batch TLAS node texture (2 texels/node — a BVH over the instance world boxes). */
    tlas: string;
    /** The per-instance ATTRIBUTE texture (A texels/instance, slot order — in TLAS order;
     *  fable-instance-attributes). Present only when the batch authored attributes. */
    attrs: string;
    /** The prototype's mesh BLAS textures (used only when the prototype is a mesh). */
    position: string;
    index: string;
    normal: string;
    uv: string;
    bvh: string;
}

export function instanceExternNames(ordinal: number): InstanceExternNames {
    return {
        placements: `instance_${ordinal}_placements`,
        tlas: `instance_${ordinal}_tlas`,
        attrs: `instance_${ordinal}_attrs`,
        position: `instance_${ordinal}_position`,
        index: `instance_${ordinal}_index`,
        normal: `instance_${ordinal}_normal`,
        uv: `instance_${ordinal}_uv`,
        bvh: `instance_${ordinal}_bvh`,
    };
}

/** Build a batch's TLAS: a BVH over the instance WORLD boxes (the prototype's local box
 *  transformed by each placement), reordering the placements into TLAS-leaf order. Returns the
 *  reordered placement texture + the TLAS node texture (impl-plan-tlas). The prototype-local box
 *  is the mesh BLAS root (rootBoxOf) or the analytic primitive's bounds(). */
export function packInstanceBatch(localBox: AABB, placements: Similarity[], attributeRows?: AttributeRowSpec[]): { placements: PackedTexture<Float32Array>; tlas: PackedTexture<Float32Array>; attributes?: PackedTexture<Float32Array> } {
    // World AABB per instance = the prototype box transformed by that placement (8 corners).
    const boxes = placements.map((g) => transformAABB(localBox, (p) => similarityApplyPoint(g, p)));
    const { nodes, nodeCount, order } = buildBVHNodes(boxes);
    // Re-emit placements — and the attribute rows — in TLAS-leaf order, from the SAME
    // permutation, so Hit.element (the leaf-order placement index) indexes both correctly.
    const reordered = Array.from(order, (i) => placements[i]);
    return {
        placements: packPlacements(reordered),
        tlas: packNodes(nodes, nodeCount),
        ...(attributeRows !== undefined && attributeRows.length > 0
            ? { attributes: packAttributes(order, attributeRows) }
            : {}),
    };
}

/** Pack per-instance attribute rows: A texels per instance (slot order), instances in the
 *  given (TLAS-leaf) order. vec3 rows store xyz (scalar entries broadcast); float rows
 *  store x. The reader is the generated scene_material_properties fetch:
 *  texel = element·A + slot (fable-instance-attributes). */
export function packAttributes(order: Uint32Array, rows: AttributeRowSpec[]): PackedTexture<Float32Array> {
    const n = order.length;
    const A = rows.length;
    const tex = allocTexels(n * A);
    for (let i = 0; i < n; i++) {
        for (let a = 0; a < A; a++) {
            const v = rows[a].values[order[i]];
            const t = (i * A + a) * 4;
            if (typeof v === 'number') {
                // Scalar: float rows read .x; Spectrum rows broadcast (the §2.5 discipline).
                tex.data[t + 0] = v;
                tex.data[t + 1] = rows[a].shape === 'vec3' ? v : 0;
                tex.data[t + 2] = rows[a].shape === 'vec3' ? v : 0;
            } else {
                tex.data[t + 0] = v[0]; tex.data[t + 1] = v[1]; tex.data[t + 2] = v[2];
            }
        }
    }
    return tex;
}

/** Pack N world similarities into the placement texture: 2 RGBA32F texels per instance —
 *  texel 2i = q_inv (the inverse rotation quat), texel 2i+1 = (t_rigid = −Rᵀt, s). The shader
 *  reads these and conjugates the ray with the §6.1 placement ABI (placement_rigid/dir/normal). */
export function packPlacements(placements: Similarity[]): PackedTexture<Float32Array> {
    const n = placements.length;
    const tex = allocTexels(n * 2);
    for (let i = 0; i < n; i++) {
        const { q, ts } = rigidInverse(placements[i]);
        tex.data[i * 8 + 0] = q[0]; tex.data[i * 8 + 1] = q[1]; tex.data[i * 8 + 2] = q[2]; tex.data[i * 8 + 3] = q[3];
        tex.data[i * 8 + 4] = ts[0]; tex.data[i * 8 + 5] = ts[1]; tex.data[i * 8 + 6] = ts[2]; tex.data[i * 8 + 7] = ts[3];
    }
    return tex;
}
