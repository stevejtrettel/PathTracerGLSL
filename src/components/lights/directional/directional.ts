// Directional (distant) light descriptor — co-located with directional.glsl
// (impl-plan-directional-beam T1: the reserved input word becomes the registered kind).
// Authored as {direction, emission}. `emission` authors IRRADIANCE E (W/m², measured
// ⊥ to the direction) — the B2 ladder's delta-direction rung; `direction` is the
// PROPAGATION direction (spot's convention — the way light travels).

import type { LightKindDescriptor } from '../../descriptors.js';
import { unitVec3 } from '../../geometry/index.js';
import { radiantScalar } from '../power.js';
import lightDirectionalGLSL from './directional.glsl?raw';

export const directionalLightDescriptor: LightKindDescriptor = {
    kind: 'directional',
    glsl: lightDirectionalGLSL,
    delta: true,   // not hittable: no region, LIGHT_DELTA, no pdf function
    // NO deltaQuery fact: anisotropic delta with no position row at all — there is no
    // point to place the equiangular pivot at (the Validator's structural rejection).
    authoredParams: [
        { name: 'direction', shape: 'vec3', required: true, kind: 'direction', constraint: { kind: 'min-length', value: 1e-8 } },
    ],
    params: [
        { name: 'direction', shape: 'vec3', semantic: 'geometric', kind: 'direction' },
        { name: 'irradiance', shape: 'vec3', semantic: 'radiometric' },   // E (W/m²), precomputed product
    ],
    // pbrt DistantLight power: Φ = E·π·R²_world — the one kind that reads the
    // Planner-stamped powerCtx (a VARIANCE-ONLY selection fact; the fallback matches
    // the stamp site's unboundable-scene constant).
    power(v, ctx) {
        const r = ctx?.worldRadius ?? 10;
        return Math.max(1e-8, Math.PI * r * r * radiantScalar(v.irradiance as number[]));
    },
    // Desugar (A3): delta — registry entry only, no region.
    toValues: (a, product) => ({ direction: unitVec3(a.direction as number[]), irradiance: product }),
};
