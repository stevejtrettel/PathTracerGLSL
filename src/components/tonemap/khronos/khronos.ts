// components/tonemap/khronos/khronos.ts — Khronos PBR Neutral tone-curve descriptor.
import type { TonemapDescriptor } from '../index.js';
import glsl from './khronos.glsl?raw';

export const khronosDescriptor: TonemapDescriptor = {
    type: 'khronos',
    glsl,
    curveFn: 'khronos_curve',
    encodesToDisplay: true,
};
