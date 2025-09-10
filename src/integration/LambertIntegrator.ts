import type { Plugin, GLSLChunk, Role, Stage } from "../core/types";
import { ChunkNames } from "../core/types";

const SRC = /* glsl */`
// integrator.integrate — sphere tracing + simple Lambert lighting

// finite-difference normal from scene.sdf
vec3 estimateNormal(Point p){
  const float e = 1e-3;
  float dx = map(p + Point(e,0,0)) - map(p - Point(e,0,0));
  float dy = map(p + Point(0,e,0)) - map(p - Point(0,0,e));
  float dz = map(p + Point(0,0,e)) - map(p - Point(0,0,e));
  return normalize(vec3(dx, dy, dz));
}

vec3 sky(vec3 dir){
  // simple horizon gradient
  float t = 0.5 * (dir.y + 1.0);
  return mix(vec3(0.7,0.8,1.0), vec3(0.4,0.6,1.0), t);
}

vec3 integrate(vec2 fragCoord){
  vec2 uv  = fragCoord / u_resolution;   // [0,1]^2
  Ray ray  = generateRay(uv);

  const float EPS  = 1e-3;
  const float TMIN = 1e-3;
  const float TMAX = 100.0;
  float t = 0.0;
  bool hit = false;

  // classic sphere tracing
  for (int i = 0; i < 128; ++i) {
    Point q = ray.o + ray.d * t;
    float d = map(q);
    if (d < EPS) {
      if (t > TMIN) { hit = true; break; }
      t += EPS;   // nudge off the surface
    } else {
      t += d;
    }
    if (t > TMAX) break;
  }

  if (!hit) return sky(ray.d);

  Point p = ray.o + ray.d * t;
  vec3 n = estimateNormal(p);

  // fixed sun direction for now; uniforms later if you want
  vec3 L = normalize(vec3(0.5, 1.0, 0.3));
  float ndotl = max(dot(n, L), 0.0);

  // simple gray albedo + ambient
  vec3 base = vec3(0.8);
  vec3 ambient = vec3(0.1);
  return ambient + base * ndotl;
}
`;

export default class LambertIntegrator implements Plugin {
    readonly role: Role = "integrator";
    readonly namespace = "integrator.lambert";
    uniforms() { return []; }
    chunks(): GLSLChunk[] {
        const stage: Stage = "frag";
        return [{
            name:   ChunkNames.IntegratorIntegrate,
            stage,
            source: SRC,
            deps: [
                ChunkNames.GeometryTypes,
                ChunkNames.GeometryOps,
                ChunkNames.CameraGenerateRay,
                ChunkNames.SceneSDF,
            ],
        }];
    }
}
