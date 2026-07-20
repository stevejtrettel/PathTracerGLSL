// Triangle-mesh engine — the intersection family's second occupant (impl-plan-meshes).
// Provides: mesh_nearest_local/mesh_any_local (the shared LEAF over the triangle soup) +
//           mesh_nearest_bvh/mesh_any_bvh (the BLAS walk). Depends on data_texel1d
//           (glsl/core/data_texture.glsl) + bvh_aabb_hit/BVH_STACK_DEPTH (accel/bvh/bvh.glsl),
//           both included before it. The generated per-mesh wrappers (features/intersection.ts)
//           conjugate the world ray into the mesh's LOCAL frame, call these, and assemble
//           the world-space Hit — so this file is placement-agnostic.
// Depends on: DATA_TEX_WIDTH (the rail width, emitted), the data-texture layout the packer
//             (mesh.ts) produces — ALL FOUR are RGBA32F (vertex indices ≤ 16M are exact in
//             f32, so the index texture stays float and needs no usampler2D): position
//             (xyz/vertex), index (ijk/tri, read as float→uint), normal (xyz/vertex),
//             uv (xy/vertex). All four ALWAYS present (the packer fills geometric-safe
//             defaults) so the leaf takes fixed sampler args.
//
// v0 is BRUTE FORCE: mesh_nearest_local scans [0, triCount). The BVH upgrade (v1) wraps a
// node walk around the SAME leaf triangle test — only the scanned ranges change.
//
// Local ray convention (ray-into-local, t-preserving): the wrapper passes ro/rd = the world
// ray mapped by the INVERSE similarity WITHOUT re-normalizing rd, so the local parameter t
// equals the world t (p_world = ambient_geodesic(world_o, world_d, t)). See the derivation in
// impl-plan-meshes §6. Normals come back in LOCAL space; the wrapper rotates them to world.

// This file owns the TRIANGLE leaf + the mesh BLAS walk; addressing (data_texel1d) and
// generic walk support (bvh_aabb_hit) come from the rail/accel files included before it.

// Möller–Trumbore (transcribed from three-mesh-bvh bvh_ray_functions), returning barycentrics
// (in A,B,C order) + the geometric normal + the hit's signed side. Local space.
bool mesh_tri_test(vec3 ro, vec3 rd, vec3 a, vec3 b, vec3 c,
                   out vec3 bary, out vec3 gnorm, out float t) {
    vec3 e1 = b - a;
    vec3 e2 = c - a;
    gnorm = cross(e1, e2);
    float det = -dot(rd, gnorm);
    // Reject degenerate/parallel; both faces are hittable (side handled by the dispatcher).
    if (abs(det) < 1e-12) return false;
    float invdet = 1.0 / det;
    vec3 ao = ro - a;
    vec3 dao = cross(ao, rd);
    float u = dot(e2, dao) * invdet;
    float v = -dot(e1, dao) * invdet;
    t = dot(ao, gnorm) * invdet;
    float w = 1.0 - u - v;
    bary = vec3(w, u, v);   // A, B, C
    const float E = 1e-6;   // small tolerance so shared edges do not leak
    return u >= -E && v >= -E && w >= -E;
}

// Fetch a vertex position / normal / uv by vertex index.
vec3 mesh_pos(sampler2D posTex, uint vi)  { return texelFetch(posTex, data_texel1d(vi), 0).xyz; }
vec3 mesh_nrm(sampler2D nrmTex, uint vi)  { return texelFetch(nrmTex, data_texel1d(vi), 0).xyz; }
vec2 mesh_uv (sampler2D uvTex,  uint vi)  { return texelFetch(uvTex,  data_texel1d(vi), 0).xy;  }

// ── The shared triangle LEAF ─────────────────────────────────────────────────────────────
// Both traversals (brute force AND the BVH) run these over a range [offset, offset+count) of the
// index texture — ONE triangle test, so the two engines can never drift (impl-plan-mesh-bvh §4).

// Nearest triangle in [offset, offset+count), bounded by tmax. On a closer hit: updates tmax +
// the LOCAL shading normal (smooth when useSmooth, else flat geometric) + interpolated uv + found.
void mesh_test_range(
    sampler2D posTex, sampler2D idxTex, sampler2D nrmTex, sampler2D uvTex,
    uint offset, uint count, bool useSmooth, vec3 ro, vec3 rd,
    inout float tmax, inout vec3 nLocal, inout vec2 uvOut, inout bool found
) {
    for (uint i = offset; i < offset + count; i++) {
        uvec3 tri = uvec3(texelFetch(idxTex, data_texel1d(i), 0).xyz);
        vec3 a = mesh_pos(posTex, tri.x);
        vec3 b = mesh_pos(posTex, tri.y);
        vec3 c = mesh_pos(posTex, tri.z);
        vec3 bary, gnorm; float t;
        if (mesh_tri_test(ro, rd, a, b, c, bary, gnorm, t) && t > EPSILON && t < tmax) {
            tmax = t;
            found = true;
            nLocal = useSmooth
                ? bary.x * mesh_nrm(nrmTex, tri.x) + bary.y * mesh_nrm(nrmTex, tri.y) + bary.z * mesh_nrm(nrmTex, tri.z)
                : gnorm;
            // Shading-normal consistency (the Veach problem): near a silhouette the interpolated
            // smooth normal can face the OPPOSITE side of the ray from the geometry, which makes
            // the dispatcher's front/back test misclassify → black facets. Orient the shading
            // normal to the geometric normal's ray-side. No-op for flat (nLocal == gnorm).
            if (dot(rd, nLocal) * dot(rd, gnorm) < 0.0) nLocal = -nLocal;
            uvOut = bary.x * mesh_uv(uvTex, tri.x) + bary.y * mesh_uv(uvTex, tri.y) + bary.z * mesh_uv(uvTex, tri.z);
        }
    }
}

// Any-hit occlusion in [offset, offset+count): first triangle strictly before maxDist blocks.
bool mesh_any_range(sampler2D posTex, sampler2D idxTex, uint offset, uint count, vec3 ro, vec3 rd, float maxDist) {
    for (uint i = offset; i < offset + count; i++) {
        uvec3 tri = uvec3(texelFetch(idxTex, data_texel1d(i), 0).xyz);
        vec3 a = mesh_pos(posTex, tri.x);
        vec3 b = mesh_pos(posTex, tri.y);
        vec3 c = mesh_pos(posTex, tri.z);
        vec3 bary, gnorm; float t;
        if (mesh_tri_test(ro, rd, a, b, c, bary, gnorm, t) && t > EPSILON && t < maxDist) return true;
    }
    return false;
}

// ── Brute force: the whole soup as one range (v0) ────────────────────────────────────────────
bool mesh_nearest_local(
    sampler2D posTex, sampler2D idxTex, sampler2D nrmTex, sampler2D uvTex,
    uint triCount, bool useSmooth, vec3 ro, vec3 rd,
    inout float tmax, out vec3 nLocal, out vec2 uvOut
) {
    bool found = false; vec3 nl = vec3(0.0); vec2 uo = vec2(0.0);
    mesh_test_range(posTex, idxTex, nrmTex, uvTex, 0u, triCount, useSmooth, ro, rd, tmax, nl, uo, found);
    nLocal = nl; uvOut = uo; return found;
}

bool mesh_any_local(sampler2D posTex, sampler2D idxTex, uint triCount, vec3 ro, vec3 rd, float maxDist) {
    return mesh_any_range(posTex, idxTex, 0u, triCount, ro, rd, maxDist);
}

// ── BVH: a fixed-stack DFS around the shared leaf (v1). data_texel1d/bvh_aabb_hit/BVH_STACK_DEPTH
//    come from the included rail/accel files. Node layout: 2 RGBA32F texels/node (min.xyz+A, max.xyz+B);
//    A >= 0 → LEAF (count=A, offset=B);  A < 0 → INTERNAL (axis=-A-1, rightChild=B, left=i+1). ──

bool mesh_nearest_bvh(
    sampler2D posTex, sampler2D idxTex, sampler2D nrmTex, sampler2D uvTex, sampler2D bvhTex,
    bool useSmooth, vec3 ro, vec3 rd,
    inout float tmax, out vec3 nLocal, out vec2 uvOut
) {
    bool found = false; vec3 nl = vec3(0.0); vec2 uo = vec2(0.0);
    int stack[BVH_STACK_DEPTH];
    int ptr = 0;
    stack[0] = 0;                                  // root
    while (ptr >= 0) {
        int ni = stack[ptr]; ptr--;
        vec4 n0 = texelFetch(bvhTex, data_texel1d(uint(ni * 2)), 0);
        vec4 n1 = texelFetch(bvhTex, data_texel1d(uint(ni * 2 + 1)), 0);
        float tenter;
        if (!bvh_aabb_hit(n0.xyz, n1.xyz, ro, rd, tmax, tenter)) continue;   // prune by running nearest
        if (n0.w >= 0.0) {
            mesh_test_range(posTex, idxTex, nrmTex, uvTex, uint(n1.w), uint(n0.w), useSmooth, ro, rd, tmax, nl, uo, found);
        } else {
            int axis = int(-n0.w - 1.0);
            int L = ni + 1, R = int(n1.w);
            bool nearFirst = rd[axis] >= 0.0;      // visit the near child first (tighter tmax sooner)
            if (ptr + 2 < BVH_STACK_DEPTH) {       // push far, then near (near popped first)
                stack[++ptr] = nearFirst ? R : L;
                stack[++ptr] = nearFirst ? L : R;
            }
        }
    }
    nLocal = nl; uvOut = uo; return found;
}

bool mesh_any_bvh(sampler2D posTex, sampler2D idxTex, sampler2D bvhTex, vec3 ro, vec3 rd, float maxDist) {
    int stack[BVH_STACK_DEPTH];
    int ptr = 0;
    stack[0] = 0;
    while (ptr >= 0) {
        int ni = stack[ptr]; ptr--;
        vec4 n0 = texelFetch(bvhTex, data_texel1d(uint(ni * 2)), 0);
        vec4 n1 = texelFetch(bvhTex, data_texel1d(uint(ni * 2 + 1)), 0);
        float tenter;
        if (!bvh_aabb_hit(n0.xyz, n1.xyz, ro, rd, maxDist, tenter)) continue;
        if (n0.w >= 0.0) {
            if (mesh_any_range(posTex, idxTex, uint(n1.w), uint(n0.w), ro, rd, maxDist)) return true;
        } else if (ptr + 2 < BVH_STACK_DEPTH) {
            stack[++ptr] = ni + 1;
            stack[++ptr] = int(n1.w);
        }
    }
    return false;
}
