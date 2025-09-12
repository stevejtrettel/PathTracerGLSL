import type { Plugin, GLSLChunk, Role, Stage } from "../../core/types";
import { ChunkNames } from "../../core/types";

/** Sphere over ground — provides Intersect, Normal, Material */
export default class SceneSDFDemo implements Plugin {
    readonly role: Role = "scene";
    readonly namespace = "scene.demo";
    uniforms() { return []; }

    chunks(): GLSLChunk[] {
        const stage: Stage = "frag";
        return [
            {
                name: ChunkNames.SceneIntersect,
                stage,
                deps: [ChunkNames.GeometryTypes, ChunkNames.SceneTypes],
                source: /* glsl */`
        // --- marching constants (single source of truth for this scene) ---
        const float HIT_EPS      = 1e-3;
        const float STEP_MIN     = 1e-4;
        const float STEP_SAFETY  = 0.9;
        const int   MAX_STEPS    = 128;

        // --- Private SDF helpers ---
        float sdfSphere(Point p, float r) { return length(p) - r; }
        float sdfPlaneY(Point p) { return p.y; } // y=0

        // Local map result (unique name to avoid collisions across chunks)
        struct SceneLocalMap { float sd; int mat; };

        SceneLocalMap sceneLocal_map(Point p) {
          float sphere = sdfSphere(p - Point(0.0, 1.0, 0.0), 1.0);
          float ground = sdfPlaneY(p);
          if (sphere < ground) return SceneLocalMap(sphere, 1); // 1=sphere
          return SceneLocalMap(ground, 0);                      // 0=ground
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
                // depend on Intersect so SceneLocalMap + sceneLocal_map are visible
                deps: [ChunkNames.GeometryTypes, ChunkNames.SceneTypes, ChunkNames.SceneIntersect],
                source: /* glsl */`
        SceneLocalMap sceneLocal_map(Point p); // from Intersect

        // Tetrahedron gradient — steadier than axis central differences
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
            vec3  base = vec3(0.90, 0.20, 0.15);
            float rough = clamp(0.35, 0.001, 1.0);
            float metal = clamp(0.0,  0.0,   1.0);
            return Material(base, rough, metal, vec3(0.0));
          }
          vec3  base = vec3(0.65);
          float rough = clamp(0.8,  0.001, 1.0);
          float metal = clamp(0.0,  0.0,   1.0);
          return Material(base, rough, metal, vec3(0.0));
        }
        `
            },
        ];
    }
}
