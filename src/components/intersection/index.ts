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

import { bvhWalkLines } from '../accel/bvh/bvh.js';

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
    /** This engine walks the INTEGER cwbvh node channel (exact linkage: gates
     *  `data_nodesq` + the cwbvh helper include — fable-accel-cwbvh §6). */
    nodesqTexture?: boolean;
    /** The batch walk skeleton — rail v2: fixed channel uniforms + the batch's baked
     *  ledger slot (tlasBase into `nodes`; cwbvh bases when the engine uses them).
     *  Visits placements (index var `i`), running the `leaf` lines per placement,
     *  pruned by `bound` (hit.t or maxDist). `count` is the batch's instance count —
     *  linear bakes it as the loop-bound LITERAL (define-cleanup Aug 8: a define
     *  consumed only by generated code was pure indirection); tlas ignores it (bounds
     *  live in the node texture). Leaf lines arrive at RELATIVE indent (0 = leaf
     *  scope); the walk pads them to its own nesting depth, so each occupant's dump
     *  indents like hand-written code. */
    walk(slot: { tlasBase: number; cwbvhNodesBase: number; cwbvhRecordsBase: number }, count: number, bound: string, leaf: string[]): string[];
}

export const DEFAULT_INSTANCE_ACCEL = 'tlas';

export const INSTANCE_ACCELS: Record<string, InstanceAccelDescriptor> = {
    /** Linear scan over every placement (the A/B baseline) — reads the (TLAS-order, but
     *  order-independent) placement texture. */
    linear: {
        tlasTexture: false,
        walk: (_s, count, _bound, leaf) => [
            `    for (int i = 0; i < ${count}; i++) {`,
            ...leaf.map((l) => '        ' + l),
            '    }',
        ],
    },
    /** Stack-DFS over the batch TLAS (a BVH over the instance WORLD boxes) with the
     *  world ray; leaves loop their placement range. Node format: accel/bvh (A<0
     *  internal / A>=0 leaf count+offset). The skeleton is THE shared emitter
     *  (bvhWalkLines — the scene-table walks ride the same one). */
    tlas: {
        tlasTexture: true,
        walk: (s, _count, bound, leaf) => bvhWalkLines(s.tlasBase, bound, [
            'for (int j = 0; j < cnt; j++) {',
            '    int i = off + j;',
            ...leaf.map((l) => '    ' + l),
            '}',
        ]),
    },
    /** Compressed wide (8-ary) BVH walk — the scalar Alg. 1 port (fable-accel-cwbvh
     *  §5; TS blueprint cwbvh.ts cwbvhNearestRef, bit layout pinned by the round-trip
     *  vitest). Node = 5 RGBA32UI texels on the INTEGER channel; leaf items ride the
     *  batch's cwbvh-order records region. Octant-ordered next-child via find-MSB;
     *  per-node ray transform → one-FMA quantized slabs; uvec2 stack entries; bounded
     *  data-dependent loop (the ANGLE D3D unroller rule); no structs on the hot path
     *  (the Adreno precision rule). */
    cwbvh: {
        tlasTexture: false,
        nodesqTexture: true,
        walk: (s, _count, bound, leaf) => [
            '    vec3 rdc = ray.direction;   // NaN guard: q·(1/0) with q=0 is NaN and silently kills pruning',
            '    rdc.x = abs(rdc.x) < 1e-20 ? (rdc.x < 0.0 ? -1e-20 : 1e-20) : rdc.x;',
            '    rdc.y = abs(rdc.y) < 1e-20 ? (rdc.y < 0.0 ? -1e-20 : 1e-20) : rdc.y;',
            '    rdc.z = abs(rdc.z) < 1e-20 ? (rdc.z < 0.0 ? -1e-20 : 1e-20) : rdc.z;',
            '    uint octinv = 7u - ((rdc.x < 0.0 ? 1u : 0u) | (rdc.y < 0.0 ? 2u : 0u) | (rdc.z < 0.0 ? 4u : 0u));',
            '    vec3 inv = 1.0 / rdc;',
            '    uvec2 stack[CWBVH_STACK_DEPTH]; int ptr = -1;',
            '    // Root as a single-child pseudo-group at slot 0 (imask bit 0 → popc addressing yields 0).',
            '    uint gBase = 0u; uint gHits = 1u << (octinv & 7u); uint gImask = 1u;',
            '    for (int guard = 0; guard < 65536; guard++) {',
            '        if (gHits == 0u) { if (ptr < 0) break; gBase = stack[ptr].x; gHits = stack[ptr].y & 0xFFu; gImask = stack[ptr].y >> 8; ptr--; continue; }',
            '        int bit = cwbvh_findMSB24(gHits);',
            '        gHits &= ~(1u << uint(bit));',
            '        uint slot = (uint(bit) ^ octinv) & 7u;',
            '        uint child = gBase + cwbvh_popc8(gImask & ((1u << slot) - 1u));',
            '        if (gHits != 0u && ptr + 1 < CWBVH_STACK_DEPTH) { ptr++; stack[ptr] = uvec2(gBase, gHits | (gImask << 8)); }',
            `        uvec4 n0 = texelFetch(u_data_nodesq, data_texel1d(${s.cwbvhNodesBase}u + child * 5u), 0);`,
            `        uvec4 n1 = texelFetch(u_data_nodesq, data_texel1d(${s.cwbvhNodesBase}u + child * 5u + 1u), 0);`,
            `        uvec4 n2 = texelFetch(u_data_nodesq, data_texel1d(${s.cwbvhNodesBase}u + child * 5u + 2u), 0);`,
            `        uvec4 n3 = texelFetch(u_data_nodesq, data_texel1d(${s.cwbvhNodesBase}u + child * 5u + 3u), 0);`,
            `        uvec4 n4 = texelFetch(u_data_nodesq, data_texel1d(${s.cwbvhNodesBase}u + child * 5u + 4u), 0);`,
            '        vec3 p = vec3(uintBitsToFloat(n0.x), uintBitsToFloat(n0.y), uintBitsToFloat(n0.z));',
            '        // dq = 2^e / d (the exponent bytes shifted into fp32 position — exact power-of-two scale).',
            '        vec3 dq = vec3(uintBitsToFloat((n0.w & 0xFFu) << 23), uintBitsToFloat(((n0.w >> 8) & 0xFFu) << 23), uintBitsToFloat(((n0.w >> 16) & 0xFFu) << 23)) * inv;',
            '        uint imask = (n0.w >> 24) & 0xFFu;',
            '        vec3 oq = (p - ray.origin) * inv;',
            '        uint hits = 0u; uint leafBits = 0u;',
            '        for (uint sl = 0u; sl < 8u; sl++) {',
            '            uint m = ((sl < 4u ? n1.z : n1.w) >> (8u * (sl & 3u))) & 0xFFu;',
            '            if (m == 0u) continue;',
            '            uint sh = 8u * (sl & 3u);',
            '            float qlx = float(((sl < 4u ? n2.x : n2.y) >> sh) & 0xFFu);',
            '            float qly = float(((sl < 4u ? n2.z : n2.w) >> sh) & 0xFFu);',
            '            float qlz = float(((sl < 4u ? n3.x : n3.y) >> sh) & 0xFFu);',
            '            float qhx = float(((sl < 4u ? n3.z : n3.w) >> sh) & 0xFFu);',
            '            float qhy = float(((sl < 4u ? n4.x : n4.y) >> sh) & 0xFFu);',
            '            float qhz = float(((sl < 4u ? n4.z : n4.w) >> sh) & 0xFFu);',
            '            float lox = qlx * dq.x + oq.x; float hix = qhx * dq.x + oq.x;',
            '            float loy = qly * dq.y + oq.y; float hiy = qhy * dq.y + oq.y;',
            '            float loz = qlz * dq.z + oq.z; float hiz = qhz * dq.z + oq.z;',
            '            float tn = max(max(min(lox, hix), min(loy, hiy)), max(min(loz, hiz), 0.0));',
            `            float tf = min(min(max(lox, hix), max(loy, hiy)), min(max(loz, hiz), ${bound})) * BVH_TFAR_PAD;`,
            '            if (tf < tn) continue;',
            '            if ((m & 0xE0u) == 0x20u && (m & 0x1Fu) >= 24u) hits |= 1u << ((((m & 0x1Fu) - 24u) ^ octinv) & 7u);',
            '            else leafBits |= (m >> 5) << (m & 0x1Fu);',
            '        }',
            '        while (leafBits != 0u) {',
            '            int lb = cwbvh_findMSB24(leafBits);',
            '            leafBits &= ~(1u << uint(lb));',
            '            int i = int(n1.y) + lb;',
            ...leaf.map((l) => '            ' + l),
            '        }',
            '        if (hits != 0u) { gBase = n1.x; gHits = hits; gImask = imask; } else { gHits = 0u; }',
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

/** Above this many MARCHED objects, the default flips to 'table' (measured Aug 10 2026,
 *  impl-plan-sdf-as-shape T6). Every marched object's arm carries its own march loop,
 *  which the compiler inlines and specialises, and the cost is superlinear in the number
 *  of copies. Time to ready:
 *
 *    hardware (M1 Pro / Metal)   8 obj 0.9s │ 32 obj 7.9s │ 128 obj NEVER FINISHED
 *    software (SwiftShader)      8 obj 1.4s │ 12 obj >90s │ 32 obj >90s
 *
 *  The table regime is flat by comparison (code per shape TYPE, objects as data): 150
 *  objects in 1.0s. The threshold is set from the SOFTWARE cliff, which falls between 8
 *  and 12 — that renderer is what the numeric witness gate runs on, so a default that is
 *  merely fine on hardware would make the gate unusable. 9 is the first count past the
 *  measured-good 8.
 *
 *  Closed-form objects carry no loop and do not drive this — hence "marched", not
 *  "objects". An EXPLICIT strategy always wins: research scenes may still ask for
 *  'unrolled' at any size, and the Validator warns rather than refuses. */
export const MARCHED_TABLE_THRESHOLD = 9;

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
/** Boxed-SDF leaves (fable-sdf-accel / impl-plan-sdf-accel T2): the leaf's record is
 *  folded params + the §6.1 rigid-residual tail (q_inv texel, (t_rigid, 1) texel —
 *  positional, immediately after the params floats), riding the same 5-texel stride
 *  and records region as the analytic entries. Leaf-size-1 scene TLAS ⇒ the march
 *  interval IS the node box. */
export const LEAF_SDF = 3;
