import type { Plugin, GLSLChunk, Role, Stage } from "../../core/types";
import { ChunkNames } from "../../core/types";

/** Three spheres + ground — mats: 0=ground, 1=red, 2=gold, 3=emissive */
export default class SceneThreeSpheres implements Plugin {
    readonly role: Role = "scene";
    readonly namespace = "scene.trispheres";
    uniforms() { return []; }

    chunks(): GLSLChunk[] {
        const stage: Stage = "frag";
        return [
            {
                name: ChunkNames.SceneIntersect,
                stage,
                deps: [ChunkNames.GeometryTypes, ChunkNames.SceneTypes],
                source: /* glsl */`
        // marching constants
        const float HIT_EPS      = 1e-3;
        const float STEP_MIN     = 1e-4;
        const float STEP_SAFETY  = 0.9;
        const int   MAX_STEPS    = 160;

        float sdfSphere(Point p, float r) { return length(p) - r; }
        float sdfPlaneY(Point p) { return p.y; }

        struct SceneLocalMap { float sd; int mat; };

        SceneLocalMap sceneLocal_map(Point p) {
          SceneLocalMap m = SceneLocalMap(sdfPlaneY(p), 0);
          float s1 = sdfSphere(p - Point(-1.4, 0.8, -0.6), 0.8);
          float s2 = sdfSphere(p - Point( 0.0, 0.7,  0.2), 0.7);
          float s3 = sdfSphere(p - Point( 1.5, 1.0, -0.3), 1.0);
          if (s1 < m.sd) m = SceneLocalMap(s1, 1);
          if (s2 < m.sd) m = SceneLocalMap(s2, 2);
          if (s3 < m.sd) m = SceneLocalMap(s3, 3);
          return m;
        }

        Hit scene_intersect(Ray r, float tMin, float tMax) {
          float t = tMin;
          for (int i = 0; i < MAX_STEPS; ++i) {
            if (t > tMax) break;
            Point p = r.o + r.d * t;
            SceneLocalMap m = sceneLocal_map(p);
            if (m.sd < HIT_EPS) return Hit(true, t, m.mat);
            t += max(m.sd * STEP_SAFETY, STEP_MIN);
          }
          return Hit(false, tMax, 0);
        }
        `
            },
            {
                name: ChunkNames.SceneNormal,
                stage,
                deps: [ChunkNames.GeometryTypes, ChunkNames.SceneTypes, ChunkNames.SceneIntersect],
                source: /* glsl */`
        SceneLocalMap sceneLocal_map(Point p);

        Dir scene_normal(Point p, Hit h) {
          float e = 1e-3;
          float a = sceneLocal_map(p + Point( e,  e,  e)).sd;
          float b = sceneLocal_map(p + Point( e, -e, -e)).sd;
          float c = sceneLocal_map(p + Point(-e,  e, -e)).sd;
          float d = sceneLocal_map(p + Point(-e, -e,  e)).sd;
          vec3 g = vec3(a + b - c - d,  a - b + c - d,  a - b - c + d);
          return normalize(Dir(g));
        }
        `
            },
            {
                name: ChunkNames.SceneMaterial,
                stage,
                deps: [ChunkNames.SceneTypes],
                source: /* glsl */`
        Material scene_material(int matId) {
          if (matId == 1) {
            vec3  base = vec3(0.92, 0.25, 0.18);
            float rough = clamp(0.40, 0.001, 1.0);
            float metal = clamp(0.0,  0.0,   1.0);
            return Material(base, rough, metal, vec3(0.0));
          }
          if (matId == 2) {
            vec3  base = vec3(1.00, 0.85, 0.57);
            float rough = clamp(0.15, 0.001, 1.0);
            float metal = clamp(1.0,  0.0,   1.0);
            return Material(base, rough, metal, vec3(0.0));
          }
          if (matId == 3) {
            vec3  base = vec3(0.95);
            float rough = clamp(0.90, 0.001, 1.0);
            float metal = clamp(0.0,  0.0,   1.0);
            return Material(base, rough, metal, vec3(1.0)); // emissive
          }
          vec3  base = vec3(0.60);
          float rough = clamp(0.80, 0.001, 1.0);
          float metal = clamp(0.0,  0.0,   1.0);
          return Material(base, rough, metal, vec3(0.0));
        }
        `
            },
        ];
    }
}
