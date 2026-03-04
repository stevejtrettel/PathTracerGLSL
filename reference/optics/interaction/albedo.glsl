// Albedo Visualization
// Returns surface albedo directly (no shading)
// Depends on: scene_material_properties

vec3 interaction_surface_shade(vec3 wi, vec3 wo, Hit hit) {
    MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
    Spectrum result = props.albedo;
    return result;
}
