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
    /** This engine walks the nodes channel (exact linkage: gates `data_nodes`). */
    nodeTexture: boolean;
    /** The nearest-hit call for one mesh wrapper — rail v2: fixed channel uniforms +
     *  the mesh's baked ledger slot; ro/rd are LOCAL-frame GLSL exprs. */
    nearestCall(slot: { vbase: number; tbase: number; nbase: number }, opts: { smooth: boolean; triCount: number; ro: string; rd: string }): string;
    /** The any-hit (occlusion) call: first triangle strictly before maxDist blocks. */
    anyCall(slot: { vbase: number; tbase: number; nbase: number }, opts: { triCount: number; ro: string; rd: string }): string;
}

export const DEFAULT_MESH_TRAVERSAL = 'bvh';

export const MESH_TRAVERSALS: Record<string, MeshTraversalDescriptor> = {
    brute: {
        nodeTexture: false,
        nearestCall: (s, o) => `mesh_nearest_local(u_data_vertices, u_data_indices, u_data_normals, u_data_uvs, ${s.vbase}u, ${s.tbase}u, ${o.triCount}u, ${o.smooth}, ${o.ro}, ${o.rd}, hit.t, nLocal, uv)`,
        anyCall: (s, o) => `mesh_any_local(u_data_vertices, u_data_indices, ${s.vbase}u, ${s.tbase}u, ${o.triCount}u, ${o.ro}, ${o.rd}, maxDist)`,
    },
    bvh: {
        nodeTexture: true,
        nearestCall: (s, o) => `mesh_nearest_bvh(u_data_vertices, u_data_indices, u_data_normals, u_data_uvs, u_data_nodes, ${s.vbase}u, ${s.tbase}u, ${s.nbase}u, ${o.smooth}, ${o.ro}, ${o.rd}, hit.t, nLocal, uv)`,
        anyCall: (s, o) => `mesh_any_bvh(u_data_vertices, u_data_indices, u_data_nodes, ${s.vbase}u, ${s.tbase}u, ${s.nbase}u, ${o.ro}, ${o.rd}, maxDist)`,
    },
};

/** Instance traversal engines — occupants of `estimator.instanceAccel` (impl-plan-tlas).
 *  Same bias-free contract; the estimator-swap witness is instance-twin's equality arm. */
export interface InstanceAccelDescriptor {
    /** This engine walks the nodes channel (exact linkage: gates `data_nodes`). */
    tlasTexture: boolean;
    /** The batch walk skeleton — rail v2: fixed channel uniforms + the batch's baked
     *  ledger slot (tlasBase into `nodes`). Visits placements (index var `i`), running
     *  the `leaf` lines per placement, pruned by `bound` (hit.t or maxDist). `count`
     *  is the batch's instance count — linear bakes it as the loop-bound LITERAL
     *  (define-cleanup Aug 8: a define consumed only by generated code was pure
     *  indirection); tlas ignores it (bounds live in the node texture). */
    walk(slot: { tlasBase: number }, count: number, bound: string, leaf: string[]): string[];
}

export const DEFAULT_INSTANCE_ACCEL = 'tlas';

export const INSTANCE_ACCELS: Record<string, InstanceAccelDescriptor> = {
    /** Linear scan over every placement (the A/B baseline) — reads the (TLAS-order, but
     *  order-independent) placement texture. */
    linear: {
        tlasTexture: false,
        walk: (_s, count, _bound, leaf) => [
            `    for (int i = 0; i < ${count}; i++) {`,
            ...leaf,
            '    }',
        ],
    },
    /** Stack-DFS over the batch TLAS (a BVH over the instance WORLD boxes) with the
     *  world ray; leaves loop their placement range. Node format: accel/bvh (A<0
     *  internal / A>=0 leaf count+offset). */
    tlas: {
        tlasTexture: true,
        walk: (s, _count, bound, leaf) => [
            '    int stack[BVH_STACK_DEPTH]; int ptr = 0; stack[0] = 0;',
            '    while (ptr >= 0) {',
            '        int ni = stack[ptr]; ptr--;',
            `        vec4 n0 = texelFetch(u_data_nodes, data_texel1d(uint(${s.tlasBase} + ni * 2)), 0);`,
            `        vec4 n1 = texelFetch(u_data_nodes, data_texel1d(uint(${s.tlasBase} + ni * 2 + 1)), 0);`,
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

/** Object dispatch regimes — occupants of `estimator.objectDispatch` (fable-object-tables).
 *  Bias-free by contract; the bazaar equality witness is the gate. The regimes differ
 *  structurally throughout the intersection feature, so the registry carries membership +
 *  default (the Validator's enum source), not emitters. */
export interface ObjectDispatchDescriptor { }

export const DEFAULT_OBJECT_DISPATCH = 'unrolled';

export const OBJECT_DISPATCHES: Record<string, ObjectDispatchDescriptor> = {
    /** The research regime: params baked into GLSL, named symbols, linear arms. */
    unrolled: {},
    /** The scale regime: typed records + ONE scene TLAS; residual arm for driven/unbounded. */
    table: {},
};

// ── Scene-table wire format (fable-object-tables §2/§3) — shared by the adapter (sizes),
//    the Planner/feature (baked bases + generated readers), and the App (packing). ──

/** Fixed analytic record stride: 1 header texel (primKindCode, regionId, 0, 0) + up to
 *  4 payload texels (quad, the widest registered kind, needs 13 floats). A new primitive
 *  whose rows exceed 16 payload floats is a compile-time error in the record generator —
 *  raise the stride deliberately, never silently. */
export const ANALYTIC_RECORD_TEXELS = 5;

/** Scene-TLAS leaf kinds (the leaf-list texel's .x). */
export const LEAF_ANALYTIC = 0;
export const LEAF_MESH = 1;
export const LEAF_BATCH = 2;
