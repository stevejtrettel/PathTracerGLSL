// Triangle-mesh engine — the intersection family's second occupant (impl-plan-meshes).
// Provides: mesh_texel1d, mesh_nearest_local, mesh_any_local (the shared LEAF over the
//           triangle soup). The generated per-mesh wrappers (features/intersection.ts)
//           conjugate the world ray into the mesh's LOCAL frame, call these, and assemble
//           the world-space Hit — so this file is placement-agnostic.
// Depends on: MESH_TEX_WIDTH (numeric knob, emitted), the data-texture layout the packer
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

// Linear texel index → 2D coordinate (data textures are laid out row-major at a fixed width).
ivec2 mesh_texel1d(uint i) {
    return ivec2(int(i % uint(MESH_TEX_WIDTH)), int(i / uint(MESH_TEX_WIDTH)));
}

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
vec3 mesh_pos(sampler2D posTex, uint vi)  { return texelFetch(posTex, mesh_texel1d(vi), 0).xyz; }
vec3 mesh_nrm(sampler2D nrmTex, uint vi)  { return texelFetch(nrmTex, mesh_texel1d(vi), 0).xyz; }
vec2 mesh_uv (sampler2D uvTex,  uint vi)  { return texelFetch(uvTex,  mesh_texel1d(vi), 0).xy;  }

// Nearest triangle in [0, triCount), bounded by tmax (the running nearest, world == local t).
// On a closer hit: updates tmax and outputs the LOCAL shading normal (smooth-interpolated when
// useSmooth, else the flat geometric normal) + the interpolated uv. Returns whether it hit.
bool mesh_nearest_local(
    sampler2D posTex, sampler2D idxTex, sampler2D nrmTex, sampler2D uvTex,
    uint triCount, bool useSmooth,
    vec3 ro, vec3 rd,
    inout float tmax, out vec3 nLocal, out vec2 uvOut
) {
    bool found = false;
    for (uint i = 0u; i < triCount; i++) {
        uvec3 tri = uvec3(texelFetch(idxTex, mesh_texel1d(i), 0).xyz);
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
            uvOut = bary.x * mesh_uv(uvTex, tri.x) + bary.y * mesh_uv(uvTex, tri.y) + bary.z * mesh_uv(uvTex, tri.z);
        }
    }
    return found;
}

// Any-hit occlusion in [0, triCount): first triangle strictly before maxDist blocks. Local ray.
bool mesh_any_local(sampler2D posTex, sampler2D idxTex, uint triCount, vec3 ro, vec3 rd, float maxDist) {
    for (uint i = 0u; i < triCount; i++) {
        uvec3 tri = uvec3(texelFetch(idxTex, mesh_texel1d(i), 0).xyz);
        vec3 a = mesh_pos(posTex, tri.x);
        vec3 b = mesh_pos(posTex, tri.y);
        vec3 c = mesh_pos(posTex, tri.z);
        vec3 bary, gnorm; float t;
        if (mesh_tri_test(ro, rd, a, b, c, bary, gnorm, t) && t > EPSILON && t < maxDist) return true;
    }
    return false;
}
