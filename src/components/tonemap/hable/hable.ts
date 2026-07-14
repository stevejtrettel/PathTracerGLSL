// components/tonemap/hable/hable.ts — Uncharted 2 (Hable) filmic tone-curve descriptor.
import type { TonemapDescriptor } from '../index.js';
import glsl from './hable.glsl?raw';

export const hableDescriptor: TonemapDescriptor = {
    type: 'hable',
    glsl,
    origin: 'components/tonemap/hable/hable.glsl',
    curveFn: 'hable_curve',
    encodesToDisplay: true,
};
