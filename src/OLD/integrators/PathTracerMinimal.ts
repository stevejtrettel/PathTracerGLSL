// src/plugins/integrators/PathTracerMinimal.ts
import type { Plugin, GLSLChunk, Role, Stage, UniformDecl } from "../core/types";
import { ChunkNames } from "../core/types";

export default class PathTracerMinimal implements Plugin {
    readonly role: Role = "integrator";
    readonly namespace = "integrator.path.minimal";
    readonly progressive = true; // tells Tracer to use history + presenter

    uniforms(): UniformDecl[] { return []; }

    chunks(): GLSLChunk[] {
        const stage: Stage = "frag";
        const source = /* glsl */`
// --- Minimal Progressive Path Tracer ------------------------------------
#define PI 3.141592653589793
const float TMIN = 1e-3;
const float TMAX = 1e4;
const int   MAX_BOUNCES = 4;

// NOTE: u_frameIndex, u_sampleCount, u_historyColor are injected by the engine.
// Do NOT redeclare them here.

// Simple sky
vec3 sky(vec3 dir) {
  float t = 0.5 * (dir.y + 1.0);
  return mix(vec3(0.7,0.8,1.0), vec3(0.4,0.6,1.0), t);
}

// Lightweight RNG
float hash13(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
vec2 rng2(vec2 pixel, int sampIdx, int bounce){
  float s = float(sampIdx + 73 * bounce);
  return vec2(
    hash13(vec3(pixel, s)),
    hash13(vec3(pixel + 17.0, s + 43.0))
  );
}

// Cosine hemisphere around n
void basis(in vec3 n, out vec3 t, out vec3 b){
  if (abs(n.z) < 0.999) t = normalize(cross(n, vec3(0,0,1)));
  else                  t = normalize(cross(n, vec3(0,1,0)));
  b = cross(t, n);
}
vec3 sampleCosineHemisphere(vec3 n, vec2 u){
  float r = sqrt(u.x);
  float phi = 2.0 * PI * u.y;
  float x = r * cos(phi);
  float y = r * sin(phi);
  float z = sqrt(max(0.0, 1.0 - u.x));
  vec3 t, b; basis(n, t, b);
  return normalize(x*t + y*b + z*n);
}

// Unbiased box accumulation with previous history
vec3 accumulate_box(vec3 current, vec3 history, int prevCount){
  float n = float(prevCount);
  return (history * n + current) / (n + 1.0);
}

// --- Required entrypoint --------------------------------------------------
vec3 integrate(vec2 fragCoord){
  vec2 pixel = fragCoord;

  // Subpixel jitter for AA
  vec2 j  = rng2(pixel, u_sampleCount, 0) - 0.5;
  vec2 uv = (pixel + j) / u_resolution;

  // Primary ray
  Ray ray = generateRay(uv);

  vec3 L = vec3(0.0); // radiance
  vec3 T = vec3(1.0); // throughput

  for (int bounce = 0; bounce < MAX_BOUNCES; ++bounce){
    Hit h = scene_intersect(ray, TMIN, TMAX);
    if (!h.hit){
      L += T * sky(ray.d);
      break;
    }

    Point    p = ray.o + ray.d * h.t;
    Dir      n = scene_normal(p, h);
    Material m = scene_material(h.mat);

    // Add emissive (if any)
    L += T * m.emission;

    // Lambertian bounce (cosine sampling => BRDF/pdf simplifies to albedo)
    vec2 u = rng2(pixel, u_sampleCount, bounce + 1);
    Dir wi = sampleCosineHemisphere(n, u);
    T *= m.baseColor;                 // cosine-weighted Lambert update
    ray = makeRay(p + n * TMIN, wi);
  }

  // Read previous history and accumulate
  ivec2 ip = ivec2(pixel);
  vec3 history = texelFetch(u_historyColor, ip, 0).rgb;
  return accumulate_box(L, history, u_sampleCount);
}
`;
        return [{
            name:   ChunkNames.IntegratorIntegrate,
            stage,
            source,
            deps: [
                ChunkNames.GeometryTypes,
                ChunkNames.CameraGenerateRay,
                ChunkNames.SceneTypes,
                ChunkNames.SceneIntersect,
                ChunkNames.SceneNormal,
                ChunkNames.SceneMaterial,
            ],
        }];
    }
}
