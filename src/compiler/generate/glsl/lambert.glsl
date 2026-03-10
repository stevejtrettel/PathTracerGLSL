// Lambert Diffuse BRDF
// Cosine-weighted hemisphere sampling with energy conservation
// Provides: interaction_surface_shade(), interaction_surface_scatter(), interaction_surface_pdf(), interaction_surface_emit()
// Depends on: MaterialProperties, ambient_dot(), random2(), Frame

Spectrum interaction_surface_shade(Direction wi, Direction wo, Hit hit, MaterialProperties props) {
    float cos_theta = max(0.0, ambient_dot(wi, hit.frame.n, hit.p));
    Spectrum brdf = props.albedo / PI;
    return brdf * cos_theta;
}

Direction interaction_surface_scatter(Direction wo, Hit hit, MaterialProperties props, out float pdf) {
    vec2 xi = random2();

    float cos_theta = sqrt(xi.y);
    float sin_theta = sqrt(1.0 - xi.y);
    float phi = 2.0 * PI * xi.x;

    vec3 local_wi = vec3(
        sin_theta * cos(phi),
        sin_theta * sin(phi),
        cos_theta
    );

    Direction wi = hit.frame.t * local_wi.x +
                  hit.frame.b * local_wi.y +
                  hit.frame.n * local_wi.z;

    pdf = cos_theta / PI;

    return wi;
}

float interaction_surface_pdf(Direction wi, Direction wo, Hit hit, MaterialProperties props) {
    float cos_theta = max(0.0, ambient_dot(wi, hit.frame.n, hit.p));
    return cos_theta / PI;
}

Spectrum interaction_surface_emit(MaterialProperties props) {
    return props.emission * props.emission_strength;
}
