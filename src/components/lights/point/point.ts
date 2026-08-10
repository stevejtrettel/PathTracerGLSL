// Point-light descriptor — co-located with point.glsl (struct-alignment batch).
// Rows + facts only; the lighting feature constructs PointLight from values.

import type { LightKindDescriptor } from '../../descriptors.js';
import { radiantScalar } from '../power.js';
import lightPointGLSL from './point.glsl?raw';

export const pointLightDescriptor: LightKindDescriptor = {
    kind: 'point',
    glsl: lightPointGLSL,
    delta: true,   // not hittable: no region, LIGHT_DELTA, no pdf function
    // ISOTROPIC delta: the equiangular delta query may read these rows directly
    // (intensity is direction-independent — the anisotropy contrast is spot).
    deltaQuery: { positionRow: 'position', intensityRow: 'intensity' },
    // Authored input (besides kind/emission): the position.
    authoredParams: [
        { name: 'position', shape: 'vec3', required: true, kind: 'point' },
    ],
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
    // Light-tree leaf box (fable-light-bvh §5): a point light is its position.
    treeBounds(v) {
        const p = v.position as [number, number, number];
        return { min: [p[0], p[1], p[2]], max: [p[0], p[1], p[2]] };
    },
};
