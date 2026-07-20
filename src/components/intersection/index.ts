// components/intersection/index.ts — the intersection family registry (audit batch 4).
//
// Held since the family's founding ("deliberately held for the BVH/mesh backend");
// opened now that the mesh/instancing batches produced the family's first genuine
// one-of-N axes. NOTE the family's unusual shape: geometry BACKENDS are scene-derived
// capabilities that COMPOSE (ProgramDescription.intersection.backends — no registry, a
// fourth geometry class is a design event, not an occupant drop). What IS one-of-N is
// the TRAVERSAL choice per backend — these registries make "a new traversal engine =
// one descriptor + one registry line" true, and give the Validator its enum source.
//
// Descriptors are GLSL-emitting policy closures (the transport techniques/combiner
// precedent): they receive plain strings/numbers, reference no other descriptor and no
// plan. The static math they call lives in mesh.glsl (leaf + BLAS walk) and
// accel/bvh/bvh.glsl (slab test, stack depth).

/** Mesh traversal engines — occupants of `estimator.meshTraversal` (impl-plan-mesh-bvh).
 *  Bias-free by contract (estimator section): every occupant must produce the SAME
 *  converged image — the estimator-swap equality witness (mesh-quad-twin) is the gate. */
export interface MeshTraversalDescriptor {
    /** Declares the per-mesh node-texture extern (`mesh_N_bvh`) — exact linkage: only
     *  engines that read it bind it. */
    nodeTexture: boolean;
    /** The nearest-hit call for one mesh wrapper. `u` = the mesh's uniform prefix
     *  (`u_mesh_0`); ro/rd are LOCAL-frame GLSL exprs; writes hit.t/nLocal/uv. */
    nearestCall(u: string, opts: { smooth: boolean; triCount: number; ro: string; rd: string }): string;
    /** The any-hit (occlusion) call: first triangle strictly before maxDist blocks. */
    anyCall(u: string, opts: { triCount: number; ro: string; rd: string }): string;
}

export const DEFAULT_MESH_TRAVERSAL = 'bvh';

export const MESH_TRAVERSALS: Record<string, MeshTraversalDescriptor> = {
    brute: {
        nodeTexture: false,
        nearestCall: (u, o) => `mesh_nearest_local(${u}_position, ${u}_index, ${u}_normal, ${u}_uv, ${o.triCount}u, ${o.smooth}, ${o.ro}, ${o.rd}, hit.t, nLocal, uv)`,
        anyCall: (u, o) => `mesh_any_local(${u}_position, ${u}_index, ${o.triCount}u, ${o.ro}, ${o.rd}, maxDist)`,
    },
    bvh: {
        nodeTexture: true,
        nearestCall: (u, o) => `mesh_nearest_bvh(${u}_position, ${u}_index, ${u}_normal, ${u}_uv, ${u}_bvh, ${o.smooth}, ${o.ro}, ${o.rd}, hit.t, nLocal, uv)`,
        anyCall: (u, o) => `mesh_any_bvh(${u}_position, ${u}_index, ${u}_bvh, ${o.ro}, ${o.rd}, maxDist)`,
    },
};

/** Instance traversal engines — occupants of `estimator.instanceAccel` (impl-plan-tlas).
 *  Same bias-free contract; the estimator-swap witness is instance-twin's equality arm. */
export interface InstanceAccelDescriptor {
    /** Declares the per-batch TLAS node-texture extern (`instance_k_tlas`). */
    tlasTexture: boolean;
    /** Bakes the `INSTANCE_COUNT_k` define (the linear loop's bound). */
    countDefine: boolean;
    /** The batch walk skeleton: visit placements (index var `i`), running the `leaf`
     *  lines per placement, pruned by `bound` (hit.t or maxDist). The leaf body is the
     *  per-placement conjugate+intersect emitted by the intersection feature. */
    walk(ordinal: number, bound: string, leaf: string[]): string[];
}

export const DEFAULT_INSTANCE_ACCEL = 'tlas';

export const INSTANCE_ACCELS: Record<string, InstanceAccelDescriptor> = {
    /** Linear scan over every placement (the A/B baseline) — reads the (TLAS-order, but
     *  order-independent) placement texture. */
    linear: {
        tlasTexture: false,
        countDefine: true,
        walk: (o, _bound, leaf) => [
            `    for (int i = 0; i < INSTANCE_COUNT_${o}; i++) {`,
            ...leaf,
            '    }',
        ],
    },
    /** Stack-DFS over the batch TLAS (a BVH over the instance WORLD boxes) with the
     *  world ray; leaves loop their placement range. Node format: accel/bvh (A<0
     *  internal / A>=0 leaf count+offset). */
    tlas: {
        tlasTexture: true,
        countDefine: false,
        walk: (o, bound, leaf) => [
            '    int stack[BVH_STACK_DEPTH]; int ptr = 0; stack[0] = 0;',
            '    while (ptr >= 0) {',
            '        int ni = stack[ptr]; ptr--;',
            `        vec4 n0 = texelFetch(u_inst_${o}_tlas, data_texel1d(uint(ni * 2)), 0);`,
            `        vec4 n1 = texelFetch(u_inst_${o}_tlas, data_texel1d(uint(ni * 2 + 1)), 0);`,
            '        float tenter;',
            `        if (!bvh_aabb_hit(n0.xyz, n1.xyz, ray.origin, ray.direction, ${bound}, tenter)) continue;`,
            '        if (n0.w >= 0.0) {',
            '            int off = int(n1.w), cnt = int(n0.w);',
            '            for (int j = 0; j < cnt; j++) {',
            '                int i = off + j;',
            ...leaf,
            '            }',
            '        } else {',
            '            int axis = int(-n0.w - 1.0); int L = ni + 1; int R = int(n1.w);',
            '            bool nf = ray.direction[axis] >= 0.0;',
            '            if (ptr + 2 < BVH_STACK_DEPTH) { stack[++ptr] = nf ? R : L; stack[++ptr] = nf ? L : R; }',
            '        }',
            '    }',
        ],
    },
};
