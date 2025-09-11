import type { Plugin, GLSLChunk, Role, Stage } from "../core/types";
import { ChunkNames } from "../core/types";

const INTEGRATOR_SRC = /* glsl */`
// integrator.integrate — sphere tracing + normal viz

// Finite-difference normal
vec3 estimateNormal(Point p){
  const float e = 1e-3;
  float dx = map(p + Point(e,0,0)) - map(p - Point(e,0,0));
  float dy = map(p + Point(0,e,0)) - map(p - Point(0,e,0));
  float dz = map(p + Point(0,0,e)) - map(p - Point(0,0,e));
  return normalize(vec3(dx, dy, dz));
}

vec3 integrate(vec2 fragCoord){
  vec2 uv  = fragCoord / u_resolution;      // [0,1]^2
  Ray ray  = generateRay(uv);

  float t = 0.0;
  bool hit = false;
  const float EPS = 1e-3;
  const float TMAX = 100.0;

  // classic sphere tracing
  for (int i = 0; i < 128; ++i) {
    Point q = ray.o + ray.d * t;
    float d = map(q);
    if (d < EPS) { hit = true; break; }
    t += d;
    if (t > TMAX) break;
  }

  if (!hit) {
    // simple sky
    return vec3(0.7, 0.8, 1.0);
  }

  Point p = ray.o + ray.d * t;
  vec3 n = estimateNormal(p);
  // visualize normal as color
  return 0.5 * (n + 1.0);
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
                ChunkNames.GeometryOps,
                ChunkNames.CameraGenerateRay,
                ChunkNames.SceneSDF
            ],
        }];
    }
}
