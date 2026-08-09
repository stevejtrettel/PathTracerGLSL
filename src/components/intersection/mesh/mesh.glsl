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
//
// RAIL v2 ADDRESSING (fable-data-rail): ALL meshes share one channel per role; every
// query takes baked base offsets — vbase (vertex texels: vertices/normals/uvs), tbase
// (triangle texels: indices), nbase (node texels: nodes). Ids STORED in texels stay
// mesh-LOCAL; only the fetches add the bases.

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
    uint vbase, uint tbase,
    uint offset, uint count, bool useSmooth, vec3 ro, vec3 rd,
    inout float tmax, inout vec3 nLocal, inout vec2 uvOut, inout bool found
) {
    for (uint i = offset; i < offset + count; i++) {
        uvec3 tri = uvec3(texelFetch(idxTex, data_texel1d(tbase + i), 0).xyz);
        vec3 a = mesh_pos(posTex, vbase + tri.x);
        vec3 b = mesh_pos(posTex, vbase + tri.y);
        vec3 c = mesh_pos(posTex, vbase + tri.z);
        vec3 bary, gnorm; float t;
        if (mesh_tri_test(ro, rd, a, b, c, bary, gnorm, t) && t > EPSILON && t < tmax) {
            tmax = t;
            found = true;
            nLocal = useSmooth
                ? bary.x * mesh_nrm(nrmTex, vbase + tri.x) + bary.y * mesh_nrm(nrmTex, vbase + tri.y) + bary.z * mesh_nrm(nrmTex, vbase + tri.z)
                : gnorm;
            // Shading-normal consistency (the Veach problem): near a silhouette the interpolated
            // smooth normal can face the OPPOSITE side of the ray from the geometry, which makes
            // the dispatcher's front/back test misclassify → black facets. Orient the shading
            // normal to the geometric normal's ray-side. No-op for flat (nLocal == gnorm).
            if (dot(rd, nLocal) * dot(rd, gnorm) < 0.0) nLocal = -nLocal;
            uvOut = bary.x * mesh_uv(uvTex, vbase + tri.x) + bary.y * mesh_uv(uvTex, vbase + tri.y) + bary.z * mesh_uv(uvTex, vbase + tri.z);
        }
    }
}

// Any-hit occlusion in [offset, offset+count): first triangle strictly before maxDist blocks.
bool mesh_any_range(sampler2D posTex, sampler2D idxTex, uint vbase, uint tbase, uint offset, uint count, vec3 ro, vec3 rd, float maxDist) {
    for (uint i = offset; i < offset + count; i++) {
        uvec3 tri = uvec3(texelFetch(idxTex, data_texel1d(tbase + i), 0).xyz);
        vec3 a = mesh_pos(posTex, vbase + tri.x);
        vec3 b = mesh_pos(posTex, vbase + tri.y);
        vec3 c = mesh_pos(posTex, vbase + tri.z);
        vec3 bary, gnorm; float t;
        if (mesh_tri_test(ro, rd, a, b, c, bary, gnorm, t) && t > EPSILON && t < maxDist) return true;
    }
    return false;
}

// ── Brute force: the whole soup as one range (v0) ────────────────────────────────────────────
bool mesh_nearest_local(
    sampler2D posTex, sampler2D idxTex, sampler2D nrmTex, sampler2D uvTex,
    uint vbase, uint tbase,
    uint triCount, bool useSmooth, vec3 ro, vec3 rd,
    inout float tmax, out vec3 nLocal, out vec2 uvOut
) {
    bool found = false; vec3 nl = vec3(0.0); vec2 uo = vec2(0.0);
    mesh_test_range(posTex, idxTex, nrmTex, uvTex, vbase, tbase, 0u, triCount, useSmooth, ro, rd, tmax, nl, uo, found);
    nLocal = nl; uvOut = uo; return found;
}

bool mesh_any_local(sampler2D posTex, sampler2D idxTex, uint vbase, uint tbase, uint triCount, vec3 ro, vec3 rd, float maxDist) {
    return mesh_any_range(posTex, idxTex, vbase, tbase, 0u, triCount, ro, rd, maxDist);
}

// ── BVH: a fixed-stack DFS around the shared leaf (v1). data_texel1d/bvh_aabb_hit/BVH_STACK_DEPTH
//    come from the included rail/accel files. Node layout: 2 RGBA32F texels/node (min.xyz+A, max.xyz+B);
//    A >= 0 → LEAF (count=A, offset=B);  A < 0 → INTERNAL (axis=-A-1, rightChild=B, left=i+1). ──

bool mesh_nearest_bvh(
    sampler2D posTex, sampler2D idxTex, sampler2D nrmTex, sampler2D uvTex, sampler2D bvhTex,
    uint vbase, uint tbase, uint nbase,
    bool useSmooth, vec3 ro, vec3 rd,
    inout float tmax, out vec3 nLocal, out vec2 uvOut
) {
    bool found = false; vec3 nl = vec3(0.0); vec2 uo = vec2(0.0);
    int stack[BVH_STACK_DEPTH];
    int ptr = 0;
    stack[0] = 0;                                  // root
    while (ptr >= 0) {
        int ni = stack[ptr]; ptr--;
        vec4 n0 = texelFetch(bvhTex, data_texel1d(nbase + uint(ni * 2)), 0);
        vec4 n1 = texelFetch(bvhTex, data_texel1d(nbase + uint(ni * 2 + 1)), 0);
        if (!bvh_aabb_hit(n0.xyz, n1.xyz, ro, rd, tmax)) continue;   // prune by running nearest
        if (n0.w >= 0.0) {
            mesh_test_range(posTex, idxTex, nrmTex, uvTex, vbase, tbase, uint(n1.w), uint(n0.w), useSmooth, ro, rd, tmax, nl, uo, found);
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

// ── Containment point queries (fable-mesh-containment) — LOCAL space, closed meshes only. ──

// Direction for the first-hit-facing inside test: FIXED and slightly irrational, so a ray
// through a vertex/edge is an authoring coincidence, not a per-frame flicker.
const vec3 MESH_INSIDE_DIR = vec3(0.5320544, 0.7396997, 0.4114743);

// First-hit facing (amended §1): from local p, the NEAREST triangle along the fixed ray is a
// back-face iff p is inside — valid because the Validator PROVED watertightness + consistent
// winding. A standard tmax-pruned nearest walk tracking only the geometric side of the
// nearest hit (dot(dir, gnorm) > 0 = exit face = inside). No hit anywhere → outside.
bool mesh_inside_bvh(sampler2D posTex, sampler2D idxTex, sampler2D bvhTex, uint vbase, uint tbase, uint nbase, vec3 p) {
    float tmax = 1.0e20;
    float sideDot = 0.0;   // dot(dir, gnorm) at the running-nearest hit; 0 = no hit yet
    int stack[BVH_STACK_DEPTH];
    int ptr = 0;
    stack[0] = 0;
    while (ptr >= 0) {
        int ni = stack[ptr]; ptr--;
        vec4 n0 = texelFetch(bvhTex, data_texel1d(nbase + uint(ni * 2)), 0);
        vec4 n1 = texelFetch(bvhTex, data_texel1d(nbase + uint(ni * 2 + 1)), 0);
        if (!bvh_aabb_hit(n0.xyz, n1.xyz, p, MESH_INSIDE_DIR, tmax)) continue;
        if (n0.w >= 0.0) {
            uint off = uint(n1.w), cnt = uint(n0.w);
            for (uint i = off; i < off + cnt; i++) {
                uvec3 tri = uvec3(texelFetch(idxTex, data_texel1d(tbase + i), 0).xyz);
                vec3 a = mesh_pos(posTex, vbase + tri.x);
                vec3 b = mesh_pos(posTex, vbase + tri.y);
                vec3 c = mesh_pos(posTex, vbase + tri.z);
                vec3 bary, gnorm; float t;
                // t > 0.0 (not EPSILON): the probe point is already EPS_INTERFACE off any
                // surface by the caller's discipline; skipping near hits would misclassify
                // probes standing just inside a face.
                if (mesh_tri_test(p, MESH_INSIDE_DIR, a, b, c, bary, gnorm, t) && t > 0.0 && t < tmax) {
                    tmax = t;
                    sideDot = dot(MESH_INSIDE_DIR, gnorm);
                }
            }
        } else {
            int axis = int(-n0.w - 1.0);
            int L = ni + 1, R = int(n1.w);
            bool nearFirst = MESH_INSIDE_DIR[axis] >= 0.0;
            if (ptr + 2 < BVH_STACK_DEPTH) {
                stack[++ptr] = nearFirst ? R : L;
                stack[++ptr] = nearFirst ? L : R;
            }
        }
    }
    return sideDot > 0.0;   // exit face first ⇒ inside
}

// Squared distance from p to an AABB (0 inside) — the branch-and-bound prune bound.
float mesh_box_dist2(vec3 bmin, vec3 bmax, vec3 p) {
    vec3 d = max(max(bmin - p, vec3(0.0)), p - bmax);
    return dot(d, d);
}

// Closest point on triangle abc to p (Ericson, Real-Time Collision Detection §5.1.5),
// returned as squared distance.
float mesh_point_tri_dist2(vec3 p, vec3 a, vec3 b, vec3 c) {
    vec3 ab = b - a, ac = c - a, ap = p - a;
    float d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0.0 && d2 <= 0.0) { vec3 q = p - a; return dot(q, q); }
    vec3 bp = p - b;
    float d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0.0 && d4 <= d3) { vec3 q = p - b; return dot(q, q); }
    float vc = d1 * d4 - d3 * d2;
    if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) { vec3 q = ap - ab * (d1 / (d1 - d3)); return dot(q, q); }
    vec3 cp = p - c;
    float d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0.0 && d5 <= d6) { vec3 q = p - c; return dot(q, q); }
    float vb = d5 * d2 - d1 * d6;
    if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) { vec3 q = ap - ac * (d2 / (d2 - d6)); return dot(q, q); }
    float va = d3 * d6 - d5 * d4;
    if (va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0) {
        vec3 q = bp - (c - b) * ((d4 - d3) / ((d4 - d3) + (d5 - d6)));
        return dot(q, q);
    }
    float denom = 1.0 / (va + vb + vc);
    vec3 closest = a + ab * (vb * denom) + ac * (vc * denom);
    vec3 q = p - closest;
    return dot(q, q);
}

// Branch-and-bound closest-triangle distance: stack DFS, near child first by box distance,
// pruning nodes farther than the running best. Runs ONLY for points proven inside (the lazy
// split) — it supplies the |d| that innermost-wins ranks nested containers by.
float mesh_closest_bvh(sampler2D posTex, sampler2D idxTex, sampler2D bvhTex, uint vbase, uint tbase, uint nbase, vec3 p) {
    float best2 = 1.0e30;
    int stack[BVH_STACK_DEPTH];
    int ptr = 0;
    stack[0] = 0;
    while (ptr >= 0) {
        int ni = stack[ptr]; ptr--;
        vec4 n0 = texelFetch(bvhTex, data_texel1d(nbase + uint(ni * 2)), 0);
        vec4 n1 = texelFetch(bvhTex, data_texel1d(nbase + uint(ni * 2 + 1)), 0);
        if (mesh_box_dist2(n0.xyz, n1.xyz, p) >= best2) continue;
        if (n0.w >= 0.0) {
            uint off = uint(n1.w), cnt = uint(n0.w);
            for (uint i = off; i < off + cnt; i++) {
                uvec3 tri = uvec3(texelFetch(idxTex, data_texel1d(tbase + i), 0).xyz);
                best2 = min(best2, mesh_point_tri_dist2(p,
                    mesh_pos(posTex, vbase + tri.x), mesh_pos(posTex, vbase + tri.y), mesh_pos(posTex, vbase + tri.z)));
            }
        } else {
            int L = ni + 1, R = int(n1.w);
            // Push far child first so the near one is popped (and shrinks best2) first.
            vec4 l0 = texelFetch(bvhTex, data_texel1d(nbase + uint(L * 2)), 0);
            vec4 l1 = texelFetch(bvhTex, data_texel1d(nbase + uint(L * 2 + 1)), 0);
            vec4 r0 = texelFetch(bvhTex, data_texel1d(nbase + uint(R * 2)), 0);
            vec4 r1 = texelFetch(bvhTex, data_texel1d(nbase + uint(R * 2 + 1)), 0);
            bool leftNear = mesh_box_dist2(l0.xyz, l1.xyz, p) <= mesh_box_dist2(r0.xyz, r1.xyz, p);
            if (ptr + 2 < BVH_STACK_DEPTH) {
                stack[++ptr] = leftNear ? R : L;
                stack[++ptr] = leftNear ? L : R;
            }
        }
    }
    return sqrt(best2);
}

bool mesh_any_bvh(sampler2D posTex, sampler2D idxTex, sampler2D bvhTex, uint vbase, uint tbase, uint nbase, vec3 ro, vec3 rd, float maxDist) {
    int stack[BVH_STACK_DEPTH];
    int ptr = 0;
    stack[0] = 0;
    while (ptr >= 0) {
        int ni = stack[ptr]; ptr--;
        vec4 n0 = texelFetch(bvhTex, data_texel1d(nbase + uint(ni * 2)), 0);
        vec4 n1 = texelFetch(bvhTex, data_texel1d(nbase + uint(ni * 2 + 1)), 0);
        if (!bvh_aabb_hit(n0.xyz, n1.xyz, ro, rd, maxDist)) continue;
        if (n0.w >= 0.0) {
            if (mesh_any_range(posTex, idxTex, vbase, tbase, uint(n1.w), uint(n0.w), ro, rd, maxDist)) return true;
        } else if (ptr + 2 < BVH_STACK_DEPTH) {
            stack[++ptr] = ni + 1;
            stack[++ptr] = int(n1.w);
        }
    }
    return false;
}
