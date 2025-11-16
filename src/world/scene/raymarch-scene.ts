import type { ModuleDescriptor } from "../../engine/types";
import sceneGeometry from './examples/menger-sponge.glsl?raw';

const sceneRaymarch: ModuleDescriptor = {
    id: { kind: 'scene', name: 'scene-raymarch', version: '1.0.0' },

    fragment: {
        constants: `
            #define MAX_MARCH_STEPS 256
            #define MARCH_EPSILON 0.0001
        `,

        functions: `
            // ========== IMPORTED GEOMETRY ==========
            ${sceneGeometry}
            
            // ========== EXACT SAME MARCHING AS BEFORE ==========
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
                
                // EXACTLY THE ORIGINAL MARCHING
                for (int i = 0; i < MAX_MARCH_STEPS; i++) {
                    vec3 p = ambient_geodesic(ray.origin, ray.direction, t);
                    float dist = scene_sdf(p, material);
                    
                    if (dist < MARCH_EPSILON) {
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
                    
                    t += dist; // EXACTLY AS BEFORE
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
                    
                    t += 0.95*dist;  // EXACTLY AS BEFORE
                }
                
                return false;
            }
        `
    },

    exports: ['scene_intersect', 'scene_material_properties', 'scene_intersect_any']
};



export {sceneRaymarch};
