// Sphere area-light descriptor — co-located with light_sphere.glsl (module-anatomy §2).
// Sampled via the visible cone; inside-the-sphere the sampler punts (deferred fallback).

import type { LightKindDescriptor } from '../../descriptors.js';
import { formatFloat, formatSpectrum, formatVec3 } from '../../glsl-format.js';
import { emittedScalar } from '../index.js';
import lightSphereGLSL from './sphere.glsl?raw';

export const sphereLightDescriptor: LightKindDescriptor = {
    kind: 'sphere',
    glsl: lightSphereGLSL,
    delta: false,

    // pbrt PowerLightSampler: π·4πr²·Le.
    power(l) {
        return Math.max(1e-8, Math.PI * 4 * Math.PI * l.radius! * l.radius! * emittedScalar(l.color, l.intensity));
    },

    emitSampleCall(l, xiExpr) {
        const Le = formatSpectrum(l.color.map((c) => c * l.intensity)); // radiometric (§2.5)
        return `sphere_light_sample(${formatVec3(l.position!)}, ${formatFloat(l.radius!)}, ${Le}, p, ${xiExpr})`;
    },

    // Cone pdf depends only on p (same formula as the sampler — the §6.1 byte-match
    // invariant); inside the sphere returns 0, matching the sampler's punt.
    emitPdfArm(l, selectExpr) {
        return [
            `        vec3 to_c = ${formatVec3(l.position!)} - p;`,
            '        float dc2 = dot(to_c, to_c);',
            `        if (dc2 <= ${formatFloat(l.radius! * l.radius!)}) return 0.0;   // inside: sampler punts too`,
            `        float cos_max = sqrt(max(0.0, 1.0 - ${formatFloat(l.radius! * l.radius!)} / dc2));`,
            `        return ${selectExpr} / (TWO_PI * max(1e-8, 1.0 - cos_max));`,
        ];
    },
};
