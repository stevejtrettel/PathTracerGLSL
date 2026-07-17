// Point-light descriptor — co-located with point.glsl (struct-alignment batch).
// Rows + facts only; the lighting feature constructs PointLight from values.

import type { LightKindDescriptor } from '../../descriptors.js';
import { radiantScalar } from '../index.js';
import lightPointGLSL from './point.glsl?raw';

export const pointLightDescriptor: LightKindDescriptor = {
    kind: 'point',
    glsl: lightPointGLSL,
    delta: true,   // not hittable: no region, LIGHT_DELTA, no pdf function
    params: [
        { name: 'position', shape: 'vec3', semantic: 'geometric', kind: 'point' },
        { name: 'intensity', shape: 'vec3', semantic: 'radiometric' },   // W/sr, precomputed product
    ],
    // pbrt PowerLightSampler: 4π·I (§6.1 conventions fold 1/d² into radiance).
    power(v) {
        return Math.max(1e-8, 4 * Math.PI * radiantScalar(v.intensity as number[]));
    },
    // Desugar (A3): delta — registry entry only, no region.
    toValues: (a, product) => ({ position: a.position as number[], intensity: product }),
};
