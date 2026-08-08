// Raymarching Scene Infrastructure — the SDF geometry backend behind scene_intersect.
// Provides: scene_normal(), sdf_intersect(inout Hit), sdf_intersect_any(float maxDist)
// Depends on: scene_march_bound() (generated, unsigned), scene_object_sdf() (generated, per-owner
//             signed field), scene_object_uv() (generated, per-owner chart), ambient_geodesic(), ambient_frame()
// The generated scene_intersect/scene_intersect_any dispatcher (intersection.ts) calls these and
// performs the once-per-hit region classification (§4.2) — the marcher only reports geometry + owner.

// Static-file-internal numeric knobs (like PI in math.glsl) — plain defines: the
// compiler never overrides these (the old #ifndef guard was dead; define-cleanup
// Aug 8). Making one compiler-ownable later = emit it + delete the line here.
#define MAX_MARCH_STEPS 512
#define MARCH_EPSILON 0.0001
#define NORMAL_EPSILON 0.001

// Acceptance threshold grows with travel distance (pixel-footprint scaling: a fixed 1e-4 at
// t = 40 resolves geometry far below one pixel and just burns steps) but stays CAPPED at half
// of EPS_INTERFACE, so the §4.2 classification probes always clear the accepted residual.
#define MARCH_EPSILON_MAX 0.0005
float march_epsilon(float t) { return min(MARCH_EPSILON_MAX, MARCH_EPSILON * (1.0 + t)); }

// Gradient of the OWNER's own signed field — never the global min, which a containing region's
// deeply-negative sdf hijacks on nested surfaces (the R-SUBMERGED rounded-cube bug).
vec3 scene_normal(vec3 p, int region) {
    vec2 e = vec2(NORMAL_EPSILON, 0.0);

    vec3 n = vec3(
        scene_object_sdf(p + e.xyy, region) - scene_object_sdf(p - e.xyy, region),
        scene_object_sdf(p + e.yxy, region) - scene_object_sdf(p - e.yxy, region),
        scene_object_sdf(p + e.yyx, region) - scene_object_sdf(p - e.yyx, region)
    );

    return normalize(n);
}

// Commit an accepted march point as the hit's GEOMETRY (region_from/to are classified by
// the dispatcher, §4.2) — ONE body for the in-loop accept and the stall-exhaustion accept,
// so the two acceptance paths cannot drift.
void raymarch_commit(inout Hit hit, float t, vec3 p, int region) {
    hit.t = t;
    hit.p = p;
    hit.frame = ambient_frame(p, scene_normal(p, region));   // owner's outward normal; dispatcher orients (§4.1)
    hit.region_owner = region;
    hit.element = 0;   // SDF objects have no sub-elements (Hit.element contract)
    hit.uv = scene_object_uv(p, region);   // per-owner chart (fable-imagery P1); planar fallback for uncharted owners
}

// March bounded by the running nearest (hit.t); on a closer surface fill the hit's GEOMETRY
// (p/frame/owner/uv — region_from/to are classified by the dispatcher, §4.2) and return true,
// else leave hit untouched. Marches the UNSIGNED bound min|sdf_i| so interior rays (dielectric
// transmission) and nested geometry work: inside a big region, |signed min| is NOT a safe step
// toward an inner surface — the per-object unsigned min is.
bool sdf_intersect(Ray ray, inout Hit hit) {
    float t = EPSILON;   // near bound (self-intersection handled by the ray_spawn origin offset)
    int region = -1;
    float bound = 1e20;

    for (int i = 0; i < MAX_MARCH_STEPS; i++) {
        vec3 p = ambient_geodesic(ray.origin, ray.direction, t);
        bound = scene_march_bound(p, region);   // region = nearest surface's owner (arg-min)

        // Accept only if CLOSER than the running nearest: the march is blind to analytic
        // surfaces, so without `t < hit.t` a step can sail through an analytic object and
        // commit an SDF surface BEHIND it, clobbering the closer hit (review finding).
        if (bound < march_epsilon(t) && t < hit.t) {
            raymarch_commit(hit, t, p, region);
            return true;
        }

        if (t > hit.t) {
            return false;   // searched past the running nearest: genuine miss
        }

        t += bound;
    }

    // Budget exhausted. A STALL (bound still small) means the ray is pinned against geometry at
    // grazing incidence — commit the graze as a hit: reporting a miss here paints the
    // BACKGROUND through the silhouette (the black-edge artifact; the ray had no budget left to
    // find the surface behind either). Sub-pixel bias, correct color. A non-stalled exhaustion
    // (long flight through a big scene) remains a miss.
    // Window sizing: face-grazing rays advance by ~their height h per step, so rays with
    // h ≲ face_length / MAX_MARCH_STEPS stall — the window must cover that band. The residual
    // off-surface distance only threatens §4.2 classification on EXIT hits (interior side must
    // stay within EPS_INTERFACE of the surface for the outside probe to clear); entry-side
    // grazes tolerate any δ. 16ε ≈ 8e-3 covers the band at 512 steps for unit-scale faces.
    if (bound < 16.0 * march_epsilon(t) && t < hit.t) {
        raymarch_commit(hit, t, ambient_geodesic(ray.origin, ray.direction, t), region);
        return true;
    }
    return false;
}

bool sdf_intersect_any(Ray ray, float maxDist) {
    int region = -1;

    float t = EPSILON;

    for (int i = 0; i < MAX_MARCH_STEPS; i++) {
        vec3 p = ambient_geodesic(ray.origin, ray.direction, t);
        float bound = scene_march_bound(p, region);   // unsigned: valid from inside media/solids too

        // Reached the light distance BEFORE testing for an occluder: geometry at or beyond
        // the light must never shadow the point. A near-ceiling lamp (light y=1.9, ceiling
        // y=2.0) is the witness — the straight-up shadow ray overshoots the light and its
        // next step lands on the ceiling (bound≈0) at t≈2.0 > maxDist≈1.9; accepting that as
        // an occluder self-shadows the floor directly under the light (jagged dark blob).
        if (t > maxDist) {
            return false;   // cleared the light distance: unoccluded
        }

        if (bound < march_epsilon(t)) {
            return true;    // occluder strictly before the light
        }

        t += bound;
    }

    // Budget exhausted while still inside the search interval: pinned against geometry at
    // grazing. Conservatively OCCLUDED — the old `return false` here LEAKED light through
    // contact edges (the inverse of the primary-ray black-edge artifact). Over-darkening a
    // grazed shadow ray is the physically-safe failure direction.
    return true;
}
