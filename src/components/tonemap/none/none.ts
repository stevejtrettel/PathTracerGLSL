// components/tonemap/none/none.ts — the identity (raw passthrough) tonemap descriptor.
import type { TonemapDescriptor } from '../index.js';
import glsl from './none.glsl?raw';

export const noneDescriptor: TonemapDescriptor = {
    type: 'none',
    glsl,
    curveFn: 'none_curve',
    // Raw path: no sRGB encode, exposure forced to 1.0 — the §11 probe view.
    encodesToDisplay: false,
};
