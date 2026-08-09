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
// (No entry-distance out param until a walk consumes one — front-to-back leaf
// ordering would reintroduce it; every current walk orders by axis sign alone.)
bool bvh_aabb_hit(vec3 bmin, vec3 bmax, vec3 ro, vec3 rd, float tmax) {
    vec3 inv = 1.0 / rd;
    vec3 t0 = (bmin - ro) * inv;
    vec3 t1 = (bmax - ro) * inv;
    vec3 tsm = min(t0, t1), tbg = max(t0, t1);
    float tn = max(max(tsm.x, tsm.y), tsm.z);
    float tf = min(min(tbg.x, tbg.y), tbg.z);
    float tenter = max(tn, 0.0);
    return tf >= tenter && tenter < tmax;
}
