// Direct Transport
// Single-bounce shading, no light tracing
// Depends on: scene_intersect, environment_radiance, interaction_surface_shade

vec3 transport_trace(Ray ray) {
    Hit hit;
    if (!scene_intersect(ray, hit)) {
        return environment_radiance(ray.direction);
    }

    vec3 wo = -ray.direction;
    vec3 wi = vec3(0.0);

    return interaction_surface_shade(wi, wo, hit);
}
