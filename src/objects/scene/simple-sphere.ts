import type { ModuleDescriptor } from '../../../engine/types.js';

/**
 * Simple sphere scene with material properties
 * Phase 4: Establishes Scene as material data provider
 */
const simpleSphereScene: ModuleDescriptor = {
    id: { kind: 'scene', name: 'simple-sphere', version: '1.0.0' },

    fragment: {
        constants: `
            // Material properties structure - owned by Scene
            struct MaterialProperties {
                vec3 albedo;    // Base color
            };
        `,

        functions: `
            bool scene_intersect(Ray ray, out Hit hit) {
                // Sphere at origin, radius 1.0
                vec3 oc = ray.origin;
                float a = dot(ray.direction, ray.direction);
                float b = 2.0 * dot(oc, ray.direction);
                float c = dot(oc, oc) - 1.0;
                float discriminant = b * b - 4.0 * a * c;
                
                if (discriminant < 0.0) return false;
                
                float t1 = (-b - sqrt(discriminant)) / (2.0 * a);
                float t2 = (-b + sqrt(discriminant)) / (2.0 * a);
                
                float t = (t1 > ray.tmin && t1 < ray.tmax) ? t1 : t2;
                if (t < ray.tmin || t > ray.tmax) return false;
                
                hit.t = t;
                hit.p = ambient_geodesic(ray.origin, ray.direction, t);
                hit.n = normalize(hit.p);
                hit.material_to = 1;  // Sphere has material ID 1
                
                return true;
            }
            
            MaterialProperties scene_material_properties(int mat_id, Point p) {
                MaterialProperties props;
                
                if (mat_id == 1) {
                    // Red sphere
                    props.albedo = vec3(0.8, 0.2, 0.2);
                } else {
                    // Background/air
                    props.albedo = vec3(0.0, 0.0, 0.0);
                }
                
                return props;
            }
        `
    },

    exports: ['scene_intersect', 'scene_material_properties']
};

export { simpleSphereScene };
