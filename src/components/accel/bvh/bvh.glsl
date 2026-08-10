// accel/bvh/bvh.glsl — ray-walk support for BVH traversal (impl-plan-tlas; audit batch 3).
// The generic pieces every ray-query BVH walk needs, independent of leaf type — used by the
// mesh BLAS walk (intersection/mesh/mesh.glsl) AND the generated instance TLAS walk. Non-ray
// queries (a future light-BVH importance walk, majorant grids) write their own query GLSL next
// to their domain — build is shared, query is local. Provides: bvh_aabb_hit, BVH_STACK_DEPTH.
// Depends on: data_texel1d (glsl/core/data_texture.glsl, included before this file).

// GLSL traversal stack depth: BVH_STACK_DEPTH is ALWAYS emitted by the intersection
// feature (from bvh.ts's const, same needDataRail gate that includes this file) — no
// fallback here: we are writing a compiler, it emits the correct define or this file is
// absent (define-cleanup Aug 8; the old #ifndef was dead defensive code). The builder
// warns if a tree would exceed the depth.

// Node layout (a BVH node texture, 2 RGBA32F texels/node — impl-plan-mesh-bvh §3):
//   texel 2i = (min.xyz, A)   texel 2i+1 = (max.xyz, B)
//   A >= 0 → LEAF (count=A, offset=B);  A < 0 → INTERNAL (axis=-A-1, rightChild=B, left=i+1).

// Slab test (tavianator); returns whether the box interval meets [0, tmax].
// Takes the PRECOMPUTED inverse direction — callers hoist `1.0 / rd` once per walk
// (it was recomputed per node visit: three divides × every node, pure waste; the
// accel research batch, Aug 9 2026). The far plane is padded by ~2 ulps (Ize 2013,
// "Robust BVH Ray Traversal" §3): fp32 slab arithmetic can shrink the interval so
// that tf < tn by an ulp on a true hit (grazing the box edge / finely tessellated
// geometry) — the multiply guarantees the interval survives rounding. Conservative
// only: a spurious accept costs one extra leaf test; a spurious REJECT loses
// geometry. BVH_TFAR_PAD is emitted from bvh.ts's const (one source — the cwbvh
// walk's quantized slab test and the TS reference walk read the same number).
bool bvh_aabb_hit(vec3 bmin, vec3 bmax, vec3 ro, vec3 inv, float tmax) {
    vec3 t0 = (bmin - ro) * inv;
    vec3 t1 = (bmax - ro) * inv;
    vec3 tsm = min(t0, t1), tbg = max(t0, t1);
    float tn = max(max(tsm.x, tsm.y), tsm.z);
    float tf = min(min(tbg.x, tbg.y), tbg.z) * BVH_TFAR_PAD;
    float tenter = max(tn, 0.0);
    return tf >= tenter && tenter < tmax;
}

// The RANGE form — the entry/exit-distance consumer the bool form's old comment
// reserved (impl-plan-sdf-accel T1): same slab arithmetic, same pad, plus the box
// interval clamped to [0, ∞) at entry. The `LEAF_SDF` arm marches WITHIN
// [enter, exit] (leaf-size-1 scene TLAS ⇒ the node box IS the object box —
// fable-sdf-accel §2.1); `exit` carries the pad so the interval survives fp32
// rounding exactly like the bool test's far plane.
bool bvh_aabb_hit_range(vec3 bmin, vec3 bmax, vec3 ro, vec3 inv, float tmax, out float t_enter, out float t_exit) {
    vec3 t0 = (bmin - ro) * inv;
    vec3 t1 = (bmax - ro) * inv;
    vec3 tsm = min(t0, t1), tbg = max(t0, t1);
    float tn = max(max(tsm.x, tsm.y), tsm.z);
    float tf = min(min(tbg.x, tbg.y), tbg.z) * BVH_TFAR_PAD;
    t_enter = max(tn, 0.0);
    t_exit = tf;
    return tf >= t_enter && t_enter < tmax;
}
