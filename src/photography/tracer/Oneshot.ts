/**
 * Research Path Tracer — Tracer: OneShot (v1)
 *
 * Purpose
 *   Minimal direct-light tracer. Shoots one primary ray, intersects the world,
 *   and shades with a single directional "sun" using Lambertian cosine.
 *   No shadow rays, no ambient/sky; miss = black.
 *
 * Public ABI (v1)
 *   provides:
 *     - vec4 tracePixel(vec2 v_uv)
 *   requires:
 *     - Ray generateRay(vec2 v_uv)                 // from Camera
 *     - bool intersectScene(Ray, out vec3, out vec3) // from World
 *     - vec3 shadeSurface(vec3 pos, vec3 n, vec3 wo) // from World (returns albedo or BRDF base color)
 *
 * Uniforms (unprefixed; assembler rewrites)
 *   - sunDir      : vec3   (world-space sun direction; safe if zero-length)
 *   - sunTint     : vec3   (linear RGB tint for the sun)
 *   - sunStrength : float  (scalar intensity multiplier)
 *   - exposureEV  : float  (scales final color by 2^EV)
 *
 * Invariants
 *   - No #ifdefs, one concrete variant.
 *   - Uses safe normalization and length checks to avoid NaNs → black frames.
 */

import type { ModuleDescriptorBase, UniformDecl } from '../../core/contracts/Descriptors';

const uniforms: UniformDecl[] = [
    { name: 'sunDir',      type: 'vec3',  cadence: 'per_frame' },
    { name: 'sunTint',     type: 'vec3',  cadence: 'per_frame' },
    { name: 'sunStrength', type: 'float', cadence: 'per_frame' },
    { name: 'exposureEV',  type: 'float', cadence: 'per_frame' },
];

const glsl = `
  // Camera + World ABI
  Ray generateRay(vec2 v_uv);
  bool intersectScene(Ray ray, out vec3 hitPos, out vec3 normal);
  vec3 shadeSurface(vec3 pos, vec3 n, vec3 wo);

  // Tracer uniforms (assembler will prefix)
  uniform vec3  sunDir;
  uniform vec3  sunTint;
  uniform float sunStrength;
  uniform float exposureEV;

  // Helpers
  vec3 safeNormalize(vec3 v){
    float m2 = dot(v,v);
    return (m2 <= 1e-12) ? vec3(0.0,1.0,0.0) : v * inversesqrt(m2);
  }

  vec4 tracePixel(vec2 v_uv){
    Ray ray = generateRay(v_uv);

    vec3 p, n;
    bool hit = intersectScene(ray, p, n);

    vec3 color = vec3(0.0);
    if (hit) {
      // Simple Lambertian: albedo * max(n·L, 0) * sunTint * sunStrength
      float lenS = length(sunDir);
      float nl = 0.0;
      if (lenS > 1e-6) {
        nl = max(dot(n, sunDir / lenS), 0.0);
      }
      vec3 albedo = shadeSurface(p, n, -ray.dir);
      color = albedo * sunTint * (nl * sunStrength);
    }

    color *= exp2(exposureEV);
    return vec4(color, 1.0);
  }
` as const;

const OneShotTracer: ModuleDescriptorBase = {
    id: 'tracer.oneshot',
    version: '1.0.0',
    provides: [{ name: 'tracePixel', stage: 'fragment' }],
    requires: ['generateRay', 'intersectScene', 'shadeSurface'],
    uniforms,
    glsl,
};

export default OneShotTracer;
