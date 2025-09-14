/**
 * Purpose: Minimal developer that tone-maps the Film's 'radiance' channel to the screen (sRGB).
 * Public contract: DeveloperDescriptor { provides:['develop'], requiresChannels:['radiance'], glsl }
 * Inputs: sampler2D g_dev_radiance (Engine binds Film's semantic 'radiance' channel), vec2 v_uv from the fullscreen pass.
 * Outputs: Display-encoded color to the default framebuffer.
 * Lifecycle: One draw per frame; stateless.
 * Invariants: Developer never references engine internals; it sees only semantic channels via g_dev_* uniforms.
 * v1: Linear → sRGB with optional exposure. v2: Swap for Filmic/ACES; ABI stays the same.
 */

import type {
    DeveloperDescriptor,
    UniformDecl,
} from '../../core/contracts/Descriptors';

// Optional parameter: photographic exposure in stops (0 = no change).
const uniforms: UniformDecl[] = [
    { name: 'exposure', type: 'float', cadence: 'per_frame' },
];

const glsl = `
  // Engine-injected semantic channel for Film output:
  //   uniform sampler2D g_dev_radiance;
  //
  // Module-declared uniform (assembler prefixes this name using the module id).
  uniform float exposure;

  // Linear → sRGB forward transfer function (piecewise).
  vec3 linearToSRGB(vec3 x) {
    vec3 a = 12.92 * x;
    vec3 b = 1.055 * pow(max(x, vec3(0.0)), vec3(1.0/2.4)) - 0.055;
    bvec3 cut = lessThanEqual(x, vec3(0.0031308));
    return vec3(cut.x ? a.x : b.x,
                cut.y ? a.y : b.y,
                cut.z ? a.z : b.z);
  }

  // Developer entrypoint. The assembled fragment will call:
  //   vec4 color = develop(v_uv);
  vec4 develop(vec2 v_uv) {
    // Read Film's semantic 'radiance' channel (rgba16f).
    vec3 hdr = texture(g_dev_radiance, v_uv).rgb;

    // Apply exposure in photographic stops: scale by 2^exposure.
    vec3 scaled = hdr * exp2(exposure);

    // Convert to sRGB and clamp to [0,1] for display. Alpha = 1.
    vec3 srgb = clamp(linearToSRGB(scaled), 0.0, 1.0);
    return vec4(srgb, 1.0);
  }
` as const;

export const LinearSRGB: DeveloperDescriptor = {
    id: 'developer.linear-srgb',
    version: '1.0.2',
    provides: [{ name: 'develop', stage: 'fragment' }],
    requiresChannels: ['radiance'],
    uniforms,
    glsl,
};

export default LinearSRGB;
