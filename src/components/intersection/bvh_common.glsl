// intersection/bvh_common.glsl — shared BVH-traversal support (impl-plan-tlas).
// The generic pieces every BVH walk needs, independent of leaf type — used by the mesh BLAS walk
// (mesh.glsl) AND the generated instance TLAS walk. Kept separate so an analytic-only instanced
// scene pulls these WITHOUT the triangle leaf (mesh.glsl). Provides: bvh_texel1d, bvh_aabb_hit,
// BVH_STACK_DEPTH. Depends on: MESH_TEX_WIDTH (the data-texture width, emitted).

// GLSL traversal stack depth — emitted by the feature from bvh.ts's BVH_STACK_DEPTH const; the
// #ifndef fallback keeps standalone glslang happy. The builder warns if a tree would exceed it.
#ifndef BVH_STACK_DEPTH
#define BVH_STACK_DEPTH 64
#endif

// Linear texel index → 2D coordinate (data textures are row-major at the fixed width).
ivec2 bvh_texel1d(uint i) {
    return ivec2(int(i % uint(MESH_TEX_WIDTH)), int(i / uint(MESH_TEX_WIDTH)));
}

// Node layout (a BVH node texture, 2 RGBA32F texels/node — impl-plan-mesh-bvh §3):
//   texel 2i = (min.xyz, A)   texel 2i+1 = (max.xyz, B)
//   A >= 0 → LEAF (count=A, offset=B);  A < 0 → INTERNAL (axis=-A-1, rightChild=B, left=i+1).

// Slab test (tavianator); returns whether the box interval meets [0, tmax], with the entry dist.
bool bvh_aabb_hit(vec3 bmin, vec3 bmax, vec3 ro, vec3 rd, float tmax, out float tenter) {
    vec3 inv = 1.0 / rd;
    vec3 t0 = (bmin - ro) * inv;
    vec3 t1 = (bmax - ro) * inv;
    vec3 tsm = min(t0, t1), tbg = max(t0, t1);
    float tn = max(max(tsm.x, tsm.y), tsm.z);
    float tf = min(min(tbg.x, tbg.y), tbg.z);
    tenter = max(tn, 0.0);
    return tf >= tenter && tenter < tmax;
}
