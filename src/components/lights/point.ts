// Point-light descriptor — co-located with light_point.glsl (module-anatomy §2).

import type { LightKindDescriptor } from '../descriptors.js';
import { formatSpectrum, formatVec3 } from '../glsl-format.js';
import { emittedScalar } from './index.js';
import lightPointGLSL from './point.glsl?raw';

export const pointLightDescriptor: LightKindDescriptor = {
    kind: 'point',
    glsl: lightPointGLSL,
    delta: true,   // not hittable: no region, LIGHT_DELTA, no lighting_pdf arm

    // pbrt PowerLightSampler: 4π·I (§6.1 conventions fold 1/d² into radiance).
    power(l) {
        return Math.max(1e-8, 4 * Math.PI * emittedScalar(l.color, l.intensity));
    },

    emitSampleCall(l) {
        const Le = formatSpectrum(l.color.map((c) => c * l.intensity)); // radiometric (§2.5)
        return `point_light_sample(${formatVec3(l.position!)}, ${Le}, p)`;
    },
};
