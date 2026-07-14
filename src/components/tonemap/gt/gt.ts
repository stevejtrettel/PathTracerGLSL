// components/tonemap/gt/gt.ts — Gran Turismo (Uchimura) filmic tone-curve descriptor.
import type { TonemapDescriptor } from '../index.js';
import glsl from './gt.glsl?raw';

export const gtDescriptor: TonemapDescriptor = {
    type: 'gt',
    glsl,
    origin: 'components/tonemap/gt/gt.glsl',
    curveFn: 'gt_curve',
    encodesToDisplay: true,
};
