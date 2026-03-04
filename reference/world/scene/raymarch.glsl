// Raymarching Scene Infrastructure
// SDF raymarching with normal estimation and shadow ray testing
// Depends on: scene_sdf (from scene geometry), ambient_geodesic
// Expects scene geometry to define: float scene_sdf(vec3 p, out int material)

#define MAX_MARCH_STEPS 256
#define MARCH_EPSILON 0.0001

vec3 scene_normal(vec3 p) {
    int dummy_mat;
    vec2 e = vec2(0.001, 0.0);

    vec3 n = vec3(
        scene_sdf(p + e.xyy, dummy_mat) - scene_sdf(p - e.xyy, dummy_mat),
        scene_sdf(p + e.yxy, dummy_mat) - scene_sdf(p - e.yxy, dummy_mat),
        scene_sdf(p + e.yyx, dummy_mat) - scene_sdf(p - e.yyx, dummy_mat)
    );

    return normalize(n);
}

bool scene_intersect(Ray ray, out Hit hit) {
    float t = ray.tmin;
    int material = 0;

    for (int i = 0; i < MAX_MARCH_STEPS; i++) {
        vec3 p = ambient_geodesic(ray.origin, ray.direction, t);
        float dist = scene_sdf(p, material);

        if (dist < MARCH_EPSILON) {
            hit.t = t;
            hit.p = p;
            hit.n = scene_normal(p);
            hit.material_to = material;
            hit.material_from = 0;
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
    int material = 0;

    for (int i = 0; i < MAX_MARCH_STEPS; i++) {
        vec3 p = ambient_geodesic(ray.origin, ray.direction, t);
        float dist = scene_sdf(p, material);

        if (dist < MARCH_EPSILON) {
            return true;
        }

        if (t > min(ray.tmax, max_distance)) {
            break;
        }

        t += 0.95*dist;
    }

    return false;
}
