/**
 * Research Path Tracer — Tracer: SkyOnly (v1)
 *
 * Purpose
 *   Minimal tracer that uses the camera’s primary ray (generateRay) to shade the sky:
 *   a vertical gradient plus an optional sun lobe. No world/scene intersection.
 *
 * Public ABI (v1)
 *   provides:
 *     - vec4 tracePixel(vec2 v_uv)
 *   requires:
 *     - Ray generateRay(vec2 v_uv)  // provided by a Camera module
 *
 * Uniforms (unprefixed; assembler rewrites with module prefix)
 *   - skyBottom  : vec3   (linear RGB at horizon)
 *   - skyTop     : vec3   (linear RGB at zenith)
 *   - sunDir     : vec3   (world-space direction towards sun; safe if zero)
 *   - sunTint    : vec3   (linear RGB scale for sun lobe)
 *   - sunSize    : float  (~angular size control; smaller = sharper)
 *   - exposureEV : float  (scales output by 2^EV)
 *
 * Invariants
 *   - No #ifdefs; one concrete variant.
 *   - Contains safeNormalize() and checks zero-length sunDir to avoid NaNs → black frames.
 */

import type { ModuleDescriptorBase, UniformDecl } from '../../core/contracts/Descriptors';

const uniforms: UniformDecl[] = [
    { name: 'skyBottom',  type: 'vec3',  cadence: 'per_frame' },
    { name: 'skyTop',     type: 'vec3',  cadence: 'per_frame' },
    { name: 'sunDir',     type: 'vec3',  cadence: 'per_frame' },
    { name: 'sunTint',    type: 'vec3',  cadence: 'per_frame' },
    { name: 'sunSize',    type: 'float', cadence: 'per_frame' },
    { name: 'exposureEV', type: 'float', cadence: 'per_frame' },
];



const glsl = `
  // Camera ABI: camera defines 'struct Ray' earlier; do not redeclare here.
  Ray generateRay(vec2 v_uv);

  // Tracer uniforms (assembler will prefix)
  uniform vec3  skyBottom;
  uniform vec3  skyTop;
  uniform vec3  sunDir;
  uniform vec3  sunTint;
  uniform float sunSize;
  uniform float exposureEV;

  // Helpers
  vec3 safeNormalize(vec3 v){
    float m2 = dot(v,v);
    return (m2 <= 1e-12) ? vec3(0.0,1.0,0.0) : v * inversesqrt(m2);
  }

  vec3 skyGradient(vec3 dir){
    float t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    t = smoothstep(0.0, 1.0, t);
    return mix(skyBottom, skyTop, t);
  }

  float sunLobe(vec3 dir, vec3 sDir, float size){
    float lenS = length(sDir);
    if (lenS <= 1e-6) return 0.0;  // sun disabled
    size = clamp(size, 1e-4, 10.0);
    float c = max(dot(safeNormalize(dir), sDir / lenS), 0.0);
    return pow(c, 1.0 / (size * size));
  }

  vec4 tracePixel(vec2 v_uv){
    Ray r = generateRay(v_uv);
    vec3 col = skyGradient(r.dir);
    col += sunTint * sunLobe(r.dir, sunDir, sunSize);
    col *= exp2(exposureEV);
    return vec4(col, 1.0);
  }
` as const;


const SkyOnlyTracer: ModuleDescriptorBase = {
    id: 'tracer.sky_only',
    version: '1.0.0',
    provides: [{ name: 'tracePixel', stage: 'fragment' }],
    requires: ['generateRay'],
    uniforms,
    glsl,
};

export default SkyOnlyTracer;
