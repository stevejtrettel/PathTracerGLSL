import type { Plugin, GLSLChunk, Role, Stage } from "../../core/types";
import { ChunkNames } from "../../core/types";

const SRC = /* glsl */`
// integrator.integrate — debug: visualize camera ray direction
vec3 integrate(vec2 fragCoord){
  vec2 uv = fragCoord / u_resolution;   // [0,1]^2
  Ray ray = generateRay(uv);
  // color = 0.5*(dir+1) to map [-1,1] -> [0,1]
  return 0.5 * (normalize(ray.d) + 1.0);
}
`;

export default class RayDirDebug implements Plugin {
    readonly role: Role = "integrator";
    readonly namespace = "integrator.debug.raydir";
    uniforms() { return []; }
    chunks(): GLSLChunk[] {
        const stage: Stage = "frag";
        return [{
            name:   ChunkNames.IntegratorIntegrate,
            stage,
            source: SRC,
            deps: [ChunkNames.GeometryTypes, ChunkNames.GeometryOps, ChunkNames.CameraGenerateRay],
        }];
    }
}
