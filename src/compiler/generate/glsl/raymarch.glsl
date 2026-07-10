// Raymarching Scene Infrastructure — the SDF geometry backend behind scene_intersect.
// Provides: scene_normal(), sdf_intersect(inout Hit), sdf_intersect_any(float maxDist)
// Depends on: scene_march_bound() (generated, unsigned), scene_sdf_dist() (generated, signed —
//             normals need the sign), ambient_geodesic(), ambient_frame()
// The generated scene_intersect/scene_intersect_any dispatcher (intersection.ts) calls these and
// performs the once-per-hit region classification (§4.2) — the marcher only reports geometry + owner.

#ifndef MAX_MARCH_STEPS
#define MAX_MARCH_STEPS 128
#endif
#define MARCH_EPSILON 0.0001
#define NORMAL_EPSILON 0.001

vec3 scene_normal(vec3 p) {
    vec2 e = vec2(NORMAL_EPSILON, 0.0);

    vec3 n = vec3(
        scene_sdf_dist(p + e.xyy) - scene_sdf_dist(p - e.xyy),
        scene_sdf_dist(p + e.yxy) - scene_sdf_dist(p - e.yxy),
        scene_sdf_dist(p + e.yyx) - scene_sdf_dist(p - e.yyx)
    );

    return normalize(n);
}

// March bounded by the running nearest (hit.t); on a closer surface fill the hit's GEOMETRY
// (p/frame/owner/uv — region_from/to are classified by the dispatcher, §4.2) and return true,
// else leave hit untouched. Marches the UNSIGNED bound min|sdf_i| so interior rays (dielectric
// transmission) and nested geometry work: inside a big region, |signed min| is NOT a safe step
// toward an inner surface — the per-object unsigned min is.
bool sdf_intersect(Ray ray, inout Hit hit) {
    float t = EPSILON;   // near bound (self-intersection handled by the ray_spawn origin offset)
    int region = -1;

    for (int i = 0; i < MAX_MARCH_STEPS; i++) {
        vec3 p = ambient_geodesic(ray.origin, ray.direction, t);
        float bound = scene_march_bound(p, region);   // region = nearest surface's owner (arg-min)

        if (bound < MARCH_EPSILON) {
            hit.t = t;
            hit.p = p;
            hit.frame = ambient_frame(p, scene_normal(p));   // geometric outward; dispatcher orients (§4.1)
            hit.region_owner = region;
            hit.uv = vec2(p.x * 0.1, p.z * 0.1);
            return true;
        }

        if (t > hit.t) {
            break;
        }

        t += bound;
    }

    return false;
}

bool sdf_intersect_any(Ray ray, float maxDist) {
    int region = -1;

    float t = EPSILON;

    for (int i = 0; i < MAX_MARCH_STEPS; i++) {
        vec3 p = ambient_geodesic(ray.origin, ray.direction, t);
        float bound = scene_march_bound(p, region);   // unsigned: valid from inside media/solids too

        if (bound < MARCH_EPSILON) {
            return true;
        }

        if (t > maxDist) {
            break;
        }

        t += bound;
    }

    return false;
}
