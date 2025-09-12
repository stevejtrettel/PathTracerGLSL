// src/plugins/integrators/NormalsIntegrator.ts
import type { Plugin, GLSLChunk, Role, Stage, UniformDecl } from "../../core/types";
import { ChunkNames } from "../../core/types";

export default class NormalsIntegrator implements Plugin {
    readonly role: Role = "integrator";
    readonly namespace = "integrator.normals";

    uniforms(): UniformDecl[] { return []; }

    chunks(): GLSLChunk[] {
        const stage: Stage = "frag";
        const source = /* glsl */`
    // One-shot normals visualizer (no history, no RNG)
    // Requirements: camera.generateRay, scene_intersect, scene_normal

    vec3 sky_inline(vec3 dir){
      float t = 0.5 * (dir.y + 1.0);
      return mix(vec3(0.7,0.8,1.0), vec3(0.4,0.6,1.0), t);
    }

    vec3 integrate(vec2 fragCoord){
      vec2 uv  = (fragCoord + 0.5) / u_resolution;
      Ray  ray = generateRay(uv);

      Hit h = scene_intersect(ray, 0.001, 10000.0);   // <- floats, not ints
      if (!h.hit) return sky_inline(ray.d);

      Point p = ray.o + ray.d * h.t;
      Dir   n = scene_normal(p, h);                   // assumes scene provides Normal
      return 0.5 * (n + vec3(1.0));                   // map [-1,1] to [0,1]
    }`;

        return [{
            name:   ChunkNames.IntegratorIntegrate,
            stage,
            source,
            deps: [
                ChunkNames.GeometryTypes,       // Ray/Point/Dir structs
                ChunkNames.CameraGenerateRay,
                ChunkNames.SceneTypes,
                ChunkNames.SceneIntersect,
                ChunkNames.SceneNormal,         // require a normal routine
            ],
        }];
    }
}
