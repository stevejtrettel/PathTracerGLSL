// components/tonemap/agx/agx.ts — AgX neutral tone-curve descriptor.
import type { TonemapDescriptor } from '../index.js';
import glsl from './agx.glsl?raw';

export const agxDescriptor: TonemapDescriptor = {
    type: 'agx',
    glsl,
    origin: 'components/tonemap/agx/agx.glsl',
    curveFn: 'agx_curve',
    encodesToDisplay: true,
};
