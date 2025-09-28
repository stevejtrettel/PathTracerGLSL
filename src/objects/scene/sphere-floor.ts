import type { ModuleDescriptor } from "../../engine/types";

/**
 * Cornell-box-like scene with floor and two spheres
 * One sphere is emissive (light source), the other is diffuse
 */
const sphereFloorScene: ModuleDescriptor = {
    id: { kind: 'scene', name: 'cornell-spheres', version: '1.0.0' },

    fragment: {
        constants: `
            #define MAT_FLOOR 1
            #define MAT_SPHERE_DIFFUSE 2  
            #define MAT_SPHERE_LIGHT 3
            #define MAX_MARCH_STEPS 128
            #define MARCH_EPSILON 0.001
        `,

        functions: `
            // SDF for sphere
            float sdf_sphere(vec3 p, vec3 center, float radius) {
                return length(p - center) - radius;
            }
            
            // SDF for plane (y = height)
            float sdf_plane(vec3 p, float height) {
                return p.y - height;
            }
            
            // Combined scene SDF with material tracking
            float scene_sdf(vec3 p, out int material) {
                // Floor at y = -2
                float floor = sdf_plane(p, -2.0);
                float min_dist = floor;
                material = MAT_FLOOR;
                
                // Diffuse sphere (left, on floor)
                vec3 sphere1_pos = vec3(-1.5, -1.0, 0.0);
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
                        
                        // Generate UV coords (simple projection for now)
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
                
                // Simplified marching for shadow rays
                for (int i = 0; i < MAX_MARCH_STEPS / 2; i++) {  // Fewer steps for shadows
                    vec3 p = ambient_geodesic(ray.origin, ray.direction, t);
                    float dist = scene_sdf(p, material);
                    
                    if (dist < MARCH_EPSILON) {
                        return true; // Hit something
                    }
                    
                    if (t > min(ray.tmax, max_distance)) {
                        break;
                    }
                    
                    t += dist * 1.3; // Larger steps for shadow rays
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
                    // Gray floor
                    props.albedo = vec3(0.7, 0.7, 0.7);
                    props.emission = vec3(0.0, 0.0, 0.0);
                    
                } else if (mat_id == MAT_SPHERE_DIFFUSE) {
                    // Red diffuse sphere
                    props.albedo = vec3(0.9, 0.1, 0.1);
                    props.emission = vec3(0.0, 0.0, 0.0);
                    
                } else if (mat_id == MAT_SPHERE_LIGHT) {
                    // White emissive sphere (light source)
                    props.albedo = vec3(0.0, 0.0, 0.0);  // No reflection, pure emitter
                    props.emission = vec3(20.0, 20.0, 20.0);  // Bright white light
                    props.emission_strength = 1.0;
                    
                } else {
                    // Air/background
                    props.albedo = vec3(0.0, 0.0, 0.0);
                    props.emission = vec3(0.0, 0.0, 0.0);
                }
                
                return props;
            }
        `
    },

    exports: ['scene_intersect', 'scene_material_properties', 'scene_intersect_any']
};

export { sphereFloorScene };
