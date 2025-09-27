import type {ModuleDescriptor} from "../../engine/types";



export const simpleSphereScene: ModuleDescriptor = {
    id: { kind: 'scene', name: 'simple-sphere', version: '1.0.0' },
    fragment: {
        functions: `
            float sphere_sdf(Point p) {
                return length(p) - 1.0;
            }
            
            Direction compute_normal(Point p) {
                return normalize(p);
            }
            

bool scene_intersect(Ray ray, out Hit hit) {
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
    return true;
}
        `
    },
    exports: ['scene_intersect']
};
