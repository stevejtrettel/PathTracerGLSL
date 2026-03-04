// Direct Lighting Transport
// One-bounce with explicit light sampling and shadow rays
// Depends on: scene_intersect, scene_intersect_any, scene_material_properties,
//             ambient_geodesic, ambient_parallel_transport, lighting_sample,
//             interaction_surface_shade, environment_radiance

#define EPSILON 0.001

Radiance transport_trace(Ray ray) {
    Hit hit;
    if (!scene_intersect(ray, hit)) {
        return environment_radiance(ray.direction);
    }

    MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
    Radiance objColor = Radiance(props.albedo*0.05);

    LightSample ls = lighting_sample(hit.p);

    Ray shadow_ray;
    shadow_ray.origin = ambient_geodesic(hit.p, hit.n, EPSILON);
    shadow_ray.direction = ls.wi;
    shadow_ray.tmin = EPSILON;
    shadow_ray.tmax = ls.distance - EPSILON;

    if (scene_intersect_any(shadow_ray, ls.distance - EPSILON)) {
        return objColor;
    }

    Direction wo = ambient_parallel_transport(ray.origin, hit.p, -ray.direction);
    Spectrum shading = interaction_surface_shade(ls.wi, wo, hit);

    Radiance diffuseLighting = shading * ls.radiance;

    return objColor + diffuseLighting;
}
