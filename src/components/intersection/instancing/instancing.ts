// components/intersection/instancing/instancing.ts — the placement-list multiplier
// (impl-plan-instancing). NOT an engine of its own: an instanced batch is the driven ray-into-local
// wrapper looped over a placement texture, against a shared prototype (a mesh BLAS or an analytic
// closed form). This file owns the TS both compiler and app depend on:
//   - instanceExternNames(ordinal) — the extern texture names for a batch (placement texture + the
//     prototype's mesh BLAS textures, when the prototype is a mesh).
//   - packPlacements(similarities) — the per-instance rigid-frame pairs (q_inv, (t_rigid, s)) packed
//     2 RGBA32F texels/instance, on the SAME rail (MESH_TEX_WIDTH + bvh_texel1d) as mesh data.
// Pure TS (components purity).

import type { Similarity } from '../../geometry/similarity.js';
import { rigidInverse, similarityApplyPoint } from '../../geometry/similarity.js';
import { MESH_TEX_WIDTH, packNodes, type PackedTexture } from '../mesh/mesh.js';
import { buildBVHNodes, transformAABB, type AABB } from '../mesh/bvh.js';

export interface InstanceExternNames {
    /** The per-instance placement texture (2 texels/instance: q_inv, (t_rigid, s)) — in TLAS order. */
    placements: string;
    /** The per-batch TLAS node texture (2 texels/node — a BVH over the instance world boxes). */
    tlas: string;
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
export function packInstanceBatch(localBox: AABB, placements: Similarity[]): { placements: PackedTexture<Float32Array>; tlas: PackedTexture<Float32Array> } {
    // World AABB per instance = the prototype box transformed by that placement (8 corners).
    const boxes = placements.map((g) => transformAABB(localBox, (p) => similarityApplyPoint(g, p)));
    const { nodes, nodeCount, order } = buildBVHNodes(boxes);
    // Re-emit placements in TLAS-leaf order so leaves index contiguous ranges.
    const reordered = Array.from(order, (i) => placements[i]);
    return { placements: packPlacements(reordered), tlas: packNodes(nodes, nodeCount) };
}

/** Pack N world similarities into the placement texture: 2 RGBA32F texels per instance —
 *  texel 2i = q_inv (the inverse rotation quat), texel 2i+1 = (t_rigid = −Rᵀt, s). The shader
 *  reads these and conjugates the ray with the §6.1 placement ABI (placement_rigid/dir/normal). */
export function packPlacements(placements: Similarity[]): PackedTexture<Float32Array> {
    const n = placements.length;
    const texels = Math.max(1, n * 2);
    const w = MESH_TEX_WIDTH;
    const h = Math.max(1, Math.ceil(texels / w));
    const data = new Float32Array(w * h * 4);
    for (let i = 0; i < n; i++) {
        const { q, ts } = rigidInverse(placements[i]);
        data[i * 8 + 0] = q[0]; data[i * 8 + 1] = q[1]; data[i * 8 + 2] = q[2]; data[i * 8 + 3] = q[3];
        data[i * 8 + 4] = ts[0]; data[i * 8 + 5] = ts[1]; data[i * 8 + 6] = ts[2]; data[i * 8 + 7] = ts[3];
    }
    return { data, width: w, height: h };
}
