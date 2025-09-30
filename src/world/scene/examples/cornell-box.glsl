// Material constants
// Just pull out EXACTLY what was there before
#define MAT_FLOOR 1
#define MAT_LEFT_WALL 2
#define MAT_RIGHT_WALL 3
#define MAT_BACK_WALL 4
#define MAT_CEILING 5
#define MAT_SPHERE_DIFFUSE 6
#define MAT_SPHERE_LIGHT 7

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

    // Left wall at x = -4
    float left_wall = sdf_plane(p, vec3(1.0, 0.0, 0.0), 4.0);
    if (left_wall < min_dist) {
        min_dist = left_wall;
        material = MAT_LEFT_WALL;
    }

    // Right wall at x = 4
    float right_wall = sdf_plane(p, vec3(-1.0, 0.0, 0.0), 4.0);
    if (right_wall < min_dist) {
        min_dist = right_wall;
        material = MAT_RIGHT_WALL;
    }

    // Back wall at z = -4
    float back_wall = sdf_plane(p, vec3(0.0, 0.0, 1.0), 4.0);
    if (back_wall < min_dist) {
        min_dist = back_wall;
        material = MAT_BACK_WALL;
    }

    // Ceiling at y = 4
    float ceiling = sdf_plane(p, vec3(0.0, -1.0, 0.0), 4.0);
    if (ceiling < min_dist) {
        min_dist = ceiling;
        material = MAT_CEILING;
    }

    // Diffuse sphere (left, on floor)
    vec3 sphere1_pos = vec3(-1.5, -0.5, 0.0);
    float sphere1 = sdf_sphere(p, sphere1_pos, 1.0);
    if (sphere1 < min_dist) {
        min_dist = sphere1;
        material = MAT_SPHERE_DIFFUSE;
    }

    // Emissive sphere (right, floating)
    vec3 sphere2_pos = vec3(2.0, 1.0, 0.0);
    float sphere2 = sdf_sphere(p, sphere2_pos, 0.5);
    if (sphere2 < min_dist) {
        min_dist = sphere2;
        material = MAT_SPHERE_LIGHT;
    }

    return min_dist;

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
        props.albedo = vec3(0.9, 0.9, 0.3);
        props.emission = vec3(0.0);

    } else if (mat_id == MAT_LEFT_WALL) {
        props.albedo = vec3(0.63, 0.065, 0.05);  // Red
        props.emission = vec3(0.0);

    } else if (mat_id == MAT_RIGHT_WALL) {
        props.albedo = vec3(0.14, 0.45, 0.091);  // Green
        props.emission = vec3(0.0);

    } else if (mat_id == MAT_BACK_WALL) {
        props.albedo = vec3(0.2,0.2,0.8);  // Blue
        props.emission = vec3(0.0);

    } else if (mat_id == MAT_CEILING) {
        props.albedo = vec3(0.73, 0.73, 0.73);  // White
        props.emission = vec3(0.0);

    } else if (mat_id == MAT_SPHERE_DIFFUSE) {
        props.albedo = vec3(0.9, 0.9, 0.9);  // White sphere
        props.emission = vec3(0.0);
        props.roughness=0.1;

    } else if (mat_id == MAT_SPHERE_LIGHT) {
        props.albedo = vec3(0.5);
        props.emission = vec3(20);

    } else {
        props.albedo = vec3(0.0);
        props.emission = vec3(0.0);
    }

    return props;
}
