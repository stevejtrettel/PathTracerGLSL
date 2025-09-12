// src/plugins/integrators/NormalsIntegrator.ts
import type { Plugin, GLSLChunk, Role, Stage } from "../../core/types";
import { ChunkNames } from "../../core/types";

const INTEGRATOR_SRC = /* glsl */`
// integrator.integrate — ray/scene intersect + normal visualization

vec3 sky(vec3 dir){
  float t = 0.5 * (dir.y + 1.0);
  return mix(vec3(0.7,0.8,1.0), vec3(0.4,0.6,1.0), t);
}

vec3 integrate(vec2 fragCoord){
  // film uv → primary ray
  vec2 uv  = (fragCoord + 0.5) / u_resolution; // [0,1]^2
  Ray  ray = generateRay(uv);

  const float TMIN = 1e-3;
  const float TMAX = 100.0;

  Hit h = scene_intersect(ray, TMIN, TMAX);
  if (!h.hit) return sky(ray.d);

  Point p = ray.o + ray.d * h.t;
  Dir   n = scene_normal(p, h);

  // visualize normal in 0..1 range
  return 0.5 * (n + vec3(1.0));
}
`;

export default class NormalsIntegrator implements Plugin {
    readonly role: Role = "integrator";
    readonly namespace = "integrator.normals";

    uniforms() { return []; }

    chunks(): GLSLChunk[] {
        const stage: Stage = "frag";
        return [{
            name:   ChunkNames.IntegratorIntegrate,
            stage,
            source: INTEGRATOR_SRC,
            deps: [
                ChunkNames.GeometryTypes,
                ChunkNames.CameraGenerateRay,
                ChunkNames.SceneTypes,      // ← add this
                ChunkNames.SceneIntersect,
                ChunkNames.SceneNormal, // required by this viz
            ],
        }];
    }
}
