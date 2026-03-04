// Glossy BRDF (Diffuse + Specular Mixture)
// Roughness-weighted blend of Lambert diffuse and mirror reflection
// Depends on: scene_material_properties, ambient_dot, random(), random2()

#ifndef PI
#define PI 3.14159265359
#endif

Spectrum interaction_surface_shade(Direction wi, Direction wo, Hit hit) {
    MaterialProperties props = scene_material_properties(hit.material_to, hit.p);

    float cos_theta = max(0.0, ambient_dot(wi, hit.n, hit.p));
    if (cos_theta <= 0.0) return vec3(0.0);

    vec3 result = vec3(0.0);

    vec3 reflected = reflect(-wo, hit.n);
    float alignment = dot(wi, reflected);

    if (alignment > 0.99 && props.roughness < 0.999) {
        float specular_weight = 1.0 - props.roughness;
        result += props.albedo * specular_weight * cos_theta;
    }

    float diffuse_weight = props.roughness;
    result += (props.albedo / PI) * diffuse_weight * cos_theta;

    return result;
}

Direction interaction_surface_scatter(Direction wo, Hit hit, out float pdf) {
    MaterialProperties props = scene_material_properties(hit.material_to, hit.p);

    float specular_prob = 1.0 - props.roughness;

    if (random() < specular_prob) {
        Direction wi = reflect(-wo, hit.n);

        float cos_theta = ambient_dot(wi, hit.n, hit.p);
        if (cos_theta <= 0.0) {
            pdf = 0.0001;
            return hit.n;
        }

        pdf = specular_prob;
        return wi;

    } else {
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

        pdf = props.roughness * (cos_theta / PI);
        return wi;
    }
}

float interaction_surface_pdf(Direction wi, Direction wo, Hit hit) {
    MaterialProperties props = scene_material_properties(hit.material_to, hit.p);

    float cos_theta = max(0.0, ambient_dot(wi, hit.n, hit.p));
    if (cos_theta <= 0.0) return 0.0001;

    float pdf = 0.0;

    vec3 reflected = reflect(-wo, hit.n);
    if (dot(wi, reflected) > 0.99) {
        pdf += (1.0 - props.roughness);
    }

    pdf += props.roughness * (cos_theta / PI);

    return max(pdf, 0.0001);
}

Spectrum interaction_surface_emit(Hit hit) {
    MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
    return props.emission * props.emission_strength;
}
