// Spot-light descriptor — co-located with spot.glsl. Authored as {position, direction,
// angle (outer cone HALF-angle, radians), falloffStart? (inner half-angle where the
// smooth band begins — defaults to 0.8·angle; a hard edge is both ugly and
// smoothstep-undefined, so falloffStart < angle is Validator-enforced), emission
// (radiant intensity, B2's one word)}. Registry rows store the COSINES — kind 'angle'
// (similarity-INVARIANT: neither rotation nor scale changes an angle), the kind that
// exists because neither `length` (scales) nor `direction` (vec3) describes them.
// NO deltaQuery fact: spot emission is anisotropic (see spot.glsl header).

import type { LightKindDescriptor } from '../../descriptors.js';
import { unitVec3 } from '../../geometry/index.js';
import { radiantScalar } from '../index.js';
import lightSpotGLSL from './spot.glsl?raw';

export const spotLightDescriptor: LightKindDescriptor = {
    kind: 'spot',
    glsl: lightSpotGLSL,
    delta: true,   // not hittable: no region, LIGHT_DELTA, no pdf function
    authoredParams: [
        { name: 'position', shape: 'vec3', required: true },
        { name: 'direction', shape: 'vec3', required: true },
        { name: 'angle', shape: 'number', required: true },
        { name: 'falloffStart', shape: 'number', required: false },
    ],
    params: [
        { name: 'position', shape: 'vec3', semantic: 'geometric', kind: 'point' },
        { name: 'direction', shape: 'vec3', semantic: 'geometric', kind: 'direction' },
        { name: 'cos_falloff_start', shape: 'number', semantic: 'geometric', kind: 'angle' },
        { name: 'cos_falloff_end', shape: 'number', semantic: 'geometric', kind: 'angle' },
        { name: 'intensity', shape: 'vec3', semantic: 'radiometric' },   // W/sr on-axis, precomputed product
    ],
    // pbrt-v4 SpotLight power: Φ = 2π·I·[(1−cosStart) + (cosStart−cosEnd)/2]
    // (the smoothstep band integrates to half its width).
    power(v) {
        const cs = v.cos_falloff_start as number;
        const ce = v.cos_falloff_end as number;
        return Math.max(1e-8, 2 * Math.PI * ((1 - cs) + (cs - ce) / 2) * radiantScalar(v.intensity as number[]));
    },
    // Desugar (A3): delta — registry entry only, no region. falloffStart defaults to
    // 0.8·angle (a 20% smooth band — the photographic default; pbrt's is 5° at 30°).
    toValues: (a, product) => {
        const angle = a.angle as number;
        const start = (a.falloffStart as number | undefined) ?? 0.8 * angle;
        return {
            position: a.position as number[],
            direction: unitVec3(a.direction as number[]),
            cos_falloff_start: Math.cos(start),
            cos_falloff_end: Math.cos(angle),
            intensity: product,
        };
    },
    validateAuthored(a) {
        const msgs: string[] = [];
        const angle = a.angle as number;
        if (!(angle > 0) || angle >= Math.PI) msgs.push('spot angle (outer cone half-angle, radians) must be in (0, π)');
        const start = a.falloffStart as number | undefined;
        if (start !== undefined && (!(start > 0) || start >= angle)) {
            msgs.push('spot falloffStart must be in (0, angle) — a hard edge (falloffStart = angle) is smoothstep-undefined; use a thin band instead');
        }
        const dir = a.direction as number[];
        if (Math.hypot(dir[0], dir[1], dir[2]) < 1e-8) msgs.push('spot direction must be a nonzero vector');
        return msgs;
    },
};
