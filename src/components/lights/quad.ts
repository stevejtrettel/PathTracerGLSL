// Quad area-light descriptor — co-located with light_quad.glsl (module-anatomy §2).
// ONE-SIDED (pinned deviation from the §6.2 two-sided aside — hit side and sample side
// must agree; see impl-plan-area-lights).

import type { LightKindDescriptor } from '../descriptors.js';
import type { PlannedLight } from '../../compiler/plan/types.js';
import { formatFloat, formatSpectrum, formatVec3 } from '../glsl-format.js';
import { quadNormal } from '../geometry/index.js';
import { emittedScalar } from './index.js';
import lightQuadGLSL from './quad.glsl?raw';

function quadArea(l: PlannedLight): number {
    const e1 = l.edge1!, e2 = l.edge2!;
    const cx = e1[1] * e2[2] - e1[2] * e2[1];
    const cy = e1[2] * e2[0] - e1[0] * e2[2];
    const cz = e1[0] * e2[1] - e1[1] * e2[0];
    return Math.hypot(cx, cy, cz);
}

export const quadLightDescriptor: LightKindDescriptor = {
    kind: 'quad',
    glsl: lightQuadGLSL,
    delta: false,

    // pbrt PowerLightSampler: one-sided quad π·A·Le (area-aware — pitfall 6: luminance-only
    // weighting mis-prioritizes a big dim panel vs a tiny bright one).
    power(l) {
        return Math.max(1e-8, Math.PI * quadArea(l) * emittedScalar(l.color, l.intensity));
    },

    emitSampleCall(l, xiExpr) {
        const Le = formatSpectrum(l.color.map((c) => c * l.intensity)); // radiometric (§2.5)
        const n = quadNormal(l.edge1!, l.edge2!);
        return `quad_light_sample(${formatVec3(l.corner!)}, ${formatVec3(l.edge1!)}, ${formatVec3(l.edge2!)}, ${formatVec3(n)}, ${formatFloat(quadArea(l))}, ${Le}, p, ${xiExpr})`;
    },

    // Solid-angle pdf from the hit geometry: select × d²/(A·cosθ_l); back side pdf = 0
    // (one-sided — mirrors the sampler exactly, the §6.1 byte-match invariant).
    emitPdfArm(l, selectExpr) {
        const n = quadNormal(l.edge1!, l.edge2!);
        return [
            `        float cos_l = dot(${formatVec3(n)}, -wi);`,
            '        if (cos_l <= 0.0) return 0.0;',
            '        vec3 d = light_hit.p - p;',
            `        return ${selectExpr} * dot(d, d) / (${formatFloat(quadArea(l))} * cos_l);`,
        ];
    },
};
