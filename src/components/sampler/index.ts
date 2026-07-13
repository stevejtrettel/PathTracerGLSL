// components/sampler/index.ts
// Sub-pixel sampler registry (pick-one family — slot carved in the components move,
// fable-components §3). An occupant owns the WHOLE sample stream: seed layout, the
// generator, and the [0,1) output mapping — swapping occupants replaces the file, not
// call sites.
//
// CALL-SURFACE CONTRACT (pinned, contracts §2.11): every occupant provides exactly
//   void  rng_init(uvec2 pixel, uint sampleCount, uint resetSalt);
//   float random();      // in [0, 1)
//   vec2  random2();
// The loop and all components draw ONLY through this surface. Known second occupant:
// Owen–Sobol (built once and reverted — the deferred record is the memory entry
// rng-owen-sobol-tried-reverted; its re-arrival gets a strategy knob on this registry).

import pcg4dGLSL from './pcg4d.glsl?raw';

export interface SamplerDescriptor {
    id: string;
    /** ?raw source providing the rng_init/random/random2 call surface. */
    glsl: string;
}

export const SAMPLERS: Record<string, SamplerDescriptor> = {
    pcg4d: { id: 'pcg4d', glsl: pcg4dGLSL },
};
