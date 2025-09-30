// Material constants
// Just pull out EXACTLY what was there before
#define MAT_FLOOR 1
#define MAT_LEFT_WALL 2
#define MAT_RIGHT_WALL 3
#define MAT_BACK_WALL 4
#define MAT_CEILING 5
#define MAT_FRONT_WALL 6
#define MAT_SPHERE_DIFFUSE 7


float sdf_sphere(vec3 p, vec3 center, float radius) {
    return length(p - center) - radius;
}

float sdf_plane(vec3 p, vec3 normal, float offset) {
    return dot(p, normal) + offset;
}

float maxcomp(in vec3 p) { return max(p.x, max(p.y, p.z)); }

float sdBox(vec3 p, vec3 b)
{
    vec3  di = abs(p) - b;
    float mc = maxcomp(di);
    return min(mc, length(max(di, 0.0)));
}

float _menger_core(vec3 p, int iters){
    if(length(p)>2.){
        return length(p)-1.9;
    }

    float d = sdBox(p, vec3(1.0));

    float s = 1.0;
    for (int m = 0; m < 8; ++m)
    {
        if(m>iters){break;}
        vec3 a = mod(p * s, 2.0) - 1.0;
        s *= 3.0;
        vec3 r = abs(1.0 - 3.0 * abs(a));

        float da = max(r.x, r.y);
        float db = max(r.y, r.z);
        float dc = max(r.z, r.x);
        float c = (min(da, min(db, dc)) - 1.0) / s;

        d = max(d, c);
    }

    return d;
}

float sdf_menger(vec3 p, vec3 center, float scale, int iters){
    vec3 q = (p - center) / scale;
    return _menger_core(q, iters) * scale;
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

    // Front wall at z = 10
    float front_wall = sdf_plane(p, vec3(0.0, 0.0, -1.0), 10.0);
    if (front_wall < min_dist) {
        min_dist = front_wall;
        material = MAT_FRONT_WALL;
    }

    // Ceiling at y = 4
    float ceiling = sdf_plane(p, vec3(0.0, -1.0, 0.0), 4.0);
    if (ceiling < min_dist) {
        min_dist = ceiling;
        material = MAT_CEILING;
    }

    // Diffuse object (replace sphere with Menger sponge)
    vec3 sponge_pos = vec3(0., -0.5, 0.0);
    float sponge = sdf_menger(p, sponge_pos, 1.0, 4);
    if (sponge < min_dist) {
        min_dist = sponge;
        material = MAT_SPHERE_DIFFUSE; // keep existing ID for materials
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
        props.albedo = vec3(0.9, 0.9, 0.3);
        props.emission = vec3(0.0);

    }

    else if (mat_id == MAT_LEFT_WALL) {
        props.albedo = vec3(0.63, 0.065, 0.05);  // Red
        props.emission = vec3(0.0);

    } else if (mat_id == MAT_RIGHT_WALL) {
        props.albedo = vec3(0.14, 0.45, 0.091);  // Green
        props.emission = vec3(0.0);

    } else if (mat_id == MAT_BACK_WALL) {
        props.albedo = vec3(0.2,0.2,0.8);  // Blue
        props.emission = vec3(0.0);

    } else if (mat_id == MAT_FRONT_WALL) {
        props.albedo = vec3(0.8,0.8,0.8);  // white
        props.emission = vec3(0.0);

    } else if (mat_id == MAT_CEILING) {
        props.albedo = vec3(0.73, 0.73, 0.73);  // White
        props.emission = vec3(0.0);

    } else if (mat_id == MAT_SPHERE_DIFFUSE) { // now the Menger sponge
        props.albedo = vec3(0.9, 0.9, 0.9);  // White
        props.emission = vec3(0.0);
        props.roughness=1.;

    }  else {
        props.albedo = vec3(0.0);
        props.emission = vec3(0.0);
    }

    return props;
}
