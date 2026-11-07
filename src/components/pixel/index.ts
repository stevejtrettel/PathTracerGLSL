// components/pixel/index.ts
// Pixel-filter registry (measurement pick-one: the reconstruction kernel h_j(u), where within
// and around the pixel a sample lands). Each occupant importance-samples its kernel exactly, so
// every sample has weight 1. `measurement.pixel` picks one (default 'box'); the Validator
// gates the value against this registry. Adding a filter = one folder + one line here.

export interface PixelModelDescriptor {
    id: string;
    /** ?raw source providing `vec2 pixel_sample(vec2 coord, vec2 xi)`. */
    glsl: string;
    /** Provenance origin string for source maps. */
    origin: string;
}

import boxGLSL from './box/box.glsl?raw';
import gaussianGLSL from './gaussian/gaussian.glsl?raw';

/** The filter a strategy gets when it does not author `measurement.pixel`. */
export const DEFAULT_PIXEL_MODEL = 'box';

export const PIXEL_MODELS: Record<string, PixelModelDescriptor> = {
    box: { id: 'box', glsl: boxGLSL, origin: 'components/pixel/box/box.glsl' },
    gaussian: { id: 'gaussian', glsl: gaussianGLSL, origin: 'components/pixel/gaussian/gaussian.glsl' },
};
