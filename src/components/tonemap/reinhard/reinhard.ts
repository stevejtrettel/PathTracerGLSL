// components/tonemap/reinhard/reinhard.ts — the Reinhard tone-curve descriptor.
import type { TonemapDescriptor } from '../index.js';
import glsl from './reinhard.glsl?raw';

export const reinhardDescriptor: TonemapDescriptor = {
    type: 'reinhard',
    glsl,
    origin: 'components/tonemap/reinhard/reinhard.glsl',
    curveFn: 'reinhard_curve',
    encodesToDisplay: true,
};
