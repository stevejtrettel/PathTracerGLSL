// Raymarching Scene Infrastructure
// Provides: scene_normal(), scene_intersect(), scene_intersect_any()
// Depends on: scene_sdf() (generated), scene_sdf_dist() (generated), ambient_geodesic(), ambient_frame()

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

bool scene_intersect(Ray ray, out Hit hit) {
    float t = ray.tmin;
    int region = -1;

    for (int i = 0; i < MAX_MARCH_STEPS; i++) {
        vec3 p = ambient_geodesic(ray.origin, ray.direction, t);
        float dist = scene_sdf(p, region);   // region = the owner (arg-min object)

        if (dist < MARCH_EPSILON) {
            hit.t = t;
            hit.p = p;
            hit.frame = ambient_frame(p, scene_normal(p));
            hit.region_to = region;      // far side = owner (single-region solids, §4.3)
            hit.region_from = -1;        // ambient — no transmission yet (item 2); §4.2 classification later
            hit.uv = vec2(p.x * 0.1, p.z * 0.1);
            return true;
        }

        if (t > ray.tmax) {
            break;
        }

        t += dist;
    }

    return false;
}

bool scene_intersect_any(Ray ray, float max_distance) {
    float t = ray.tmin;
    float limit = min(ray.tmax, max_distance);

    for (int i = 0; i < MAX_MARCH_STEPS; i++) {
        vec3 p = ambient_geodesic(ray.origin, ray.direction, t);
        float dist = scene_sdf_dist(p);

        if (dist < MARCH_EPSILON) {
            return true;
        }

        if (t > limit) {
            break;
        }

        t += dist;
    }

    return false;
}
