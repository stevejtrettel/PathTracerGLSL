// Beam-light descriptor — co-located with beam.glsl (impl-plan-directional-beam T2).
// Authored as {position (aperture center), direction (propagation), radius, emission}.
// `emission` authors IRRADIANCE E (W/m²) across the aperture — the B2 ladder's
// delta-direction rung, shared with `directional` (the class's other member).

import type { LightKindDescriptor } from '../../descriptors.js';
import { unitVec3 } from '../../geometry/index.js';
import { radiantScalar } from '../power.js';
import lightBeamGLSL from './beam.glsl?raw';

export const beamLightDescriptor: LightKindDescriptor = {
    kind: 'beam',
    glsl: lightBeamGLSL,
    delta: true,   // not hittable: no region, LIGHT_DELTA, no pdf function
    // NO deltaQuery fact: anisotropic delta (emission confined to one direction — an
    // equiangular pivot at the aperture would bias the estimate; spot's rejection path).
    authoredParams: [
        { name: 'position', shape: 'vec3', required: true, kind: 'point' },
        { name: 'direction', shape: 'vec3', required: true, kind: 'direction', constraint: { kind: 'min-length', value: 1e-8 } },
        { name: 'radius', shape: 'number', required: true, kind: 'length', constraint: { kind: 'positive' } },
    ],
    params: [
        { name: 'position', shape: 'vec3', semantic: 'geometric', kind: 'point' },
        { name: 'direction', shape: 'vec3', semantic: 'geometric', kind: 'direction' },
        { name: 'radius', shape: 'number', semantic: 'geometric', kind: 'length' },
        { name: 'irradiance', shape: 'vec3', semantic: 'radiometric' },   // E (W/m²), precomputed product
    ],
    // Beam power: Φ = E·π·r² (the aperture area — pure over rows, no scene context).
    power(v) {
        const r = v.radius as number;
        return Math.max(1e-8, Math.PI * r * r * radiantScalar(v.irradiance as number[]));
    },
    // Desugar (A3): delta — registry entry only, no region.
    toValues: (a, product) => ({
        position: a.position as number[],
        direction: unitVec3(a.direction as number[]),
        radius: a.radius as number,
        irradiance: product,
    }),
};
