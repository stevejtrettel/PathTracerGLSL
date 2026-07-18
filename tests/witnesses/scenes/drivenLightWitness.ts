// witnesses/scenes/drivenLightWitness.ts
// Driven-lights Stage A witness: driven-emission-equals-baked (impl-plan-driven-lights §A3).
//
// ONE Cornell scene with TWO ceiling quad lights: a CONSTANT panel (Le = 15) and a
// DRIVEN panel whose emission is `{param: 'lamp.power'}`. Driving the emission moves the
// power-weighted selection CDF, so this exercises the whole Stage-A machinery in one image:
//   - the driven light's struct is a `light_get_1()` ACCESSOR reading u_lamp_power (a const
//     can't be uniform-initialised);
//   - the hittable Le (material lookup) and the sampler's radiance read the SAME uniform
//     (pt ≡ pt-nee by construction);
//   - the selection CDF/select-pdf are CPU-recomputed and shipped as u_light_cdf/u_light_selpdf
//     (the GPU never accumulates or normalizes).
//
// The equality claim: rendered at the ValueParam DEFAULT, the image equals the scene with
// the SAME emission authored as a CONSTANT. Three parameter points:
//   θ  (default 8)  — the accessor + both CDF arrays + the region-Le agreement (LIGHT-DRIVEN);
//   θ′ (25, via initialParameters) — a value that RESHUFFLES the power ranking, i.e. the CDF
//      coupling made visible (LIGHT-DRIVEN-θ′);
//   0  (via initialParameters) — the dead light: zero CDF mass, never meaningfully selected,
//      costs nothing but the black panel is still present geometry (LIGHT-OFF).

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';
import { cornellBox } from './cornellBox.js';

// Constant ceiling panel (Le 15), emitting DOWN (cross(edge1,edge2) = (0,-1,0), one-sided pin).
const CONST_PANEL = { kind: 'quad' as const, corner: [-0.5, 1.98, -0.5] as [number, number, number], edge1: [1.0, 0.0, 0.0] as [number, number, number], edge2: [0.0, 0.0, 1.0] as [number, number, number], emission: 15.0 };
// The second (driven/baked) panel — a smaller side panel so it competes for selection mass.
const PANEL2_GEOM = { kind: 'quad' as const, corner: [-0.5, 1.98, 0.6] as [number, number, number], edge1: [0.6, 0.0, 0.0] as [number, number, number], edge2: [0.0, 0.0, 0.4] as [number, number, number] };

export const DEFAULT_POWER = 8.0;
export const LIGHT_THETA2 = { 'lamp.power': 25.0 };   // reshuffles the CDF (panel2 > default)
export const LIGHT_OFF = { 'lamp.power': 0.0 };        // the dead-light point

/** The DRIVEN arm: panel 2's emission is a {param} with the default as its baked value. */
export const drivenLightScene: SceneDescription = {
    ...cornellBox,
    id: 'light-driven',
    name: 'Cornell + driven ceiling panel (LIGHT-DRIVEN)',
    lights: [
        CONST_PANEL,
        { ...PANEL2_GEOM, emission: { param: 'lamp.power', default: DEFAULT_POWER, min: 0, max: 30 } },
    ],
};

/** A baked arm: panel 2's emission authored as a CONSTANT `power`. */
function bakedLightAt(power: number, id: string): SceneDescription {
    return {
        ...cornellBox,
        id,
        name: `Driven-light baked reference (${id})`,
        lights: [CONST_PANEL, { ...PANEL2_GEOM, emission: power }],
    };
}

export const drivenLightBaked = bakedLightAt(DEFAULT_POWER, 'light-driven-baked');
export const drivenLightBaked2 = bakedLightAt(LIGHT_THETA2['lamp.power'], 'light-driven-baked2');
export const drivenLightOffBaked = bakedLightAt(LIGHT_OFF['lamp.power'], 'light-off-baked');

export const drivenLightNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 8 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};

export const drivenLightMisStrategy: RenderStrategy = {
    ...drivenLightNeeStrategy,
    id: 'pt-mis',
    estimator: { ...drivenLightNeeStrategy.estimator, directLighting: 'mis' },
};
