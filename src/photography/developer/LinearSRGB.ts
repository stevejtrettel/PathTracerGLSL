/**
 * Purpose: Minimal developer that tone-maps the Film's 'radiance' channel to the screen (sRGB).
 * Public contract: DeveloperDescriptor { provides:['develop'], requiresChannels:['radiance'], glsl }
 * Inputs: sampler2D g_dev_radiance (Engine binds any Film's 'radiance' to this uniform), vec2 v_uv from fullscreen pass.
 * Outputs: Display-encoded color to the default framebuffer.
 * Lifecycle: One draw per frame; stateless.
 * Invariants: Developer never references engine internals; it sees only semantic channels via g_dev_* uniforms.
 */


