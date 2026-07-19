// components/tonemap/aces/aces.ts — Narkowicz ACES filmic tone-curve descriptor.
import type { TonemapDescriptor } from '../index.js';
import glsl from './aces.glsl?raw';

export const acesDescriptor: TonemapDescriptor = {
    type: 'aces',
    glsl,
    curveFn: 'aces_curve',
    encodesToDisplay: true,
};
