// components/pixel/index.ts
// Pixel-footprint registry (measurement pick-one — the reconstruction kernel h_j(u): where
// within the pixel a sample lands, and with what weight). `box` is the sole occupant
// (uniform footprint); tent/gaussian/mitchell slot in as one file + one line each. Carved
// as a registry but included unconditionally by the pixel feature (the sampler precedent) —
// a strategy knob arrives with the second occupant.

export interface PixelModelDescriptor {
    id: string;
    /** ?raw source providing `vec2 pixel_sample(vec2 coord, vec2 xi)`. */
    glsl: string;
    /** Provenance origin string for source maps. */
    origin: string;
}

import boxGLSL from './box/box.glsl?raw';

export const PIXEL_MODELS: Record<string, PixelModelDescriptor> = {
    box: { id: 'box', glsl: boxGLSL, origin: 'components/pixel/box/box.glsl' },
};
