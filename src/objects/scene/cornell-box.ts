import type { ModuleDescriptor } from "../../engine/types";

/**
 * Cornell-box-like scene with floor, walls, and two spheres
 */
const cornellBoxScene: ModuleDescriptor = {
    id: { kind: 'scene', name: 'cornell-box', version: '1.0.0' },

    fragment: {
        constants: `
            #define MAT_FLOOR 1
            #define MAT_LEFT_WALL 2
            #define MAT_RIGHT_WALL 3
            #define MAT_BACK_WALL 4
            #define MAT_CEILING 5
            #define MAT_SPHERE_DIFFUSE 6  
            #define MAT_SPHERE_LIGHT 7
            #define MAX_MARCH_STEPS 128
            #define MARCH_EPSILON 0.001
        `,

        functions: `
            // SDF for sphere
            float sdf_sphere(vec3 p, vec3 center, float radius) {
                return length(p - center) - radius;
            }
            
            // SDF for plane
            float sdf_plane(vec3 p, vec3 normal, float offset) {
                return dot(p, normal) + offset;
            }
            
            // Combined scene SDF with material tracking
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
            }
            
            // Calculate normal using gradient of SDF
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
                
                // Ray marching
                for (int i = 0; i < MAX_MARCH_STEPS; i++) {
                    vec3 p = ambient_geodesic(ray.origin, ray.direction, t);
                    float dist = scene_sdf(p, material);
                    
                    if (dist < MARCH_EPSILON) {
                        // Hit something
                        hit.t = t;
                        hit.p = p;
                        hit.n = scene_normal(p);
                        hit.material_to = material;
                        hit.material_from = 0; // air
                        hit.uv = vec2(p.x * 0.1, p.z * 0.1);
                        
                        return true;
                    }
                    
                    if (t > ray.tmax) {
                        break;
                    }
                    
                    t += dist; // Step by distance to nearest surface
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
                    
                } else if (mat_id == MAT_SPHERE_LIGHT) {
                    props.albedo = vec3(0.5);
                    props.emission = vec3(20);
                    
                } else {
                    props.albedo = vec3(0.0);
                    props.emission = vec3(0.0);
                }
                
                return props;
            }
        `
    },

    exports: ['scene_intersect', 'scene_material_properties', 'scene_intersect_any']
};

export { cornellBoxScene };
