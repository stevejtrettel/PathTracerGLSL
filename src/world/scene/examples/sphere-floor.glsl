// Material constants
#define MAT_FLOOR 1
#define MAT_BACK_WALL 2
#define MAT_SPHERE 3

float sdf_sphere(vec3 p, vec3 center, float radius) {
    return length(p - center) - radius;
}

float sdf_plane(vec3 p, vec3 normal, float offset) {
    return dot(p, normal) + offset;
}



// Main SDF function
float scene_sdf(vec3 p, out int material) {


    // Start with floor at y = -2
    float floor = sdf_plane(p, vec3(0.0, 1.0, 0.0), 2.0);
    float min_dist = floor;
    material = MAT_FLOOR;

    // Back wall at z = -4
    float back_wall = sdf_plane(p, vec3(0.0, 0.0, 1.0), 4.0);
    if (back_wall < min_dist) {
        min_dist = back_wall;
        material = MAT_BACK_WALL;
    }


    // Diffuse sphere (left, on floor)
    vec3 sphere1_pos = vec3(-1.5, -0.5, 0.0);
    float sphere1 = sdf_sphere(p, sphere1_pos, 1.0);
    if (sphere1 < min_dist) {
        min_dist = sphere1;
        material = MAT_SPHERE;
    }

    return min_dist;

}

// Material properties
MaterialProperties scene_material_properties(int mat_id, Point p) {
    MaterialProperties props;

    // Initialize all properties
    props.roughness = 0.8;
    props.metallic = 0.0;
    props.ior = 1.5;
    props.emission_strength = 1.0;
    props.light_id = -1;

    if (mat_id == MAT_FLOOR) {
        props.albedo = vec3(0.2, 0.2, 0.2);
        props.emission = vec3(0.0);

    }
    else if (mat_id == MAT_BACK_WALL) {
        props.albedo = vec3(0.2, 0.2, 0.2);
        props.emission = vec3(0.0);
        props.roughness=1.;

    }
    else if (mat_id == MAT_SPHERE) {
        props.albedo = vec3(0.9, 0.3, 0.3);  // White sphere
        props.emission = vec3(0.0);
        props.roughness=1.;

    }  else {
        props.albedo = vec3(0.0);
        props.emission = vec3(0.0);
    }

    return props;
}
