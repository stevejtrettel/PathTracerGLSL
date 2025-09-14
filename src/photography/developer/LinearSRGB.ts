/**
 * Research Path Tracer — Developer: Linear → sRGB (v1)
 *
 * Purpose
 *   Minimal developer that tone-maps (none) and converts linear radiance to sRGB
 *   for display. Consumes semantic channel 'radiance' via a reserved uniform name.
 *
 * ABI (v1)
 *   provides:
 *     - vec4 develop(vec2 v_uv)
 *   requiresChannels:
 *     - ['radiance']  // engine binds that channel to the uniform below
 *
 * Uniforms (reserved; NOT prefixed)
 *   - g_dev_radiance : sampler2D   (engine-bound handle to any film's 'radiance')
 *
 * Notes
 *   - We intentionally do NOT list g_dev_radiance in the descriptor.uniforms array,
 *     so AssemblerLite will NOT rewrite/prefix it. It is a reserved developer symbol.
 *   - No #ifdefs; single concrete variant.
 */

import type { DeveloperDescriptor } from '../../core/contracts/Descriptors';

const glsl = `
  // Reserved developer binding: the engine binds film's 'radiance' here.
  uniform sampler2D g_dev_radiance;

  vec3 linearToSRGB(vec3 c){
    bvec3 cutoff = lessThanEqual(c, vec3(0.0031308));
    vec3 low  = 12.92 * c;
    vec3 high = 1.055 * pow(c, vec3(1.0/2.4)) - 0.055;
    return mix(high, low, vec3(cutoff));
  }

  vec4 develop(vec2 v_uv){
    vec3 lin = texture(g_dev_radiance, v_uv).rgb;
    vec3 srgb = linearToSRGB(max(lin, vec3(0.0)));
    return vec4(clamp(srgb, vec3(0.0), vec3(1.0)), 1.0);
  }
` as const;

const LinearSRGBDeveloper: DeveloperDescriptor = {
    id: 'developer.linear_srgb',
    version: '1.0.0',
    provides: [{ name: 'develop', stage: 'fragment' }],
    requiresChannels: ['radiance'],
    // Intentionally no 'uniforms' field — g_dev_radiance is reserved and unprefixed.
    glsl,
};

export default LinearSRGBDeveloper;
