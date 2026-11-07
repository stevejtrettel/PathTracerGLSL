// components/transport/flags.ts
// The decisions the transport family reads — extracted ONCE from the link map (T2) and
// shared by the integrator, both techniques, and the combiner, so no part re-derives a
// decision (ProgramDescription is the complete link map; features cannot re-decide).

import type { ProgramDescription } from '../../compiler/plan/types.js';
import { modelTransmission } from '../materials/index.js';

export function flags(p: ProgramDescription) {
    const lighting = p.estimator.lighting;
    return {
        nee: lighting !== null,
        mis: lighting?.method === 'mis',
        media: p.media.present,
        scattering: p.media.scatteringArms,
        /** Some scattering medium settles absorption by WEIGHT rather than by the tracking
         *  lottery, so a per-collision survival probability is owed and the interior
         *  termination rule exists (docs/fable-subsurface.md §6). Gates BOTH the emitted
         *  roulette_interior body and its call site; medium_survival() is its source. */
        weightedAbsorption: p.media.weightedAbsorptionArms,
        /** Emissive media exist (impl-plan-medium-emission): the walk adds ms.radiance. */
        mediumEmission: p.media.emission,
        nulls: p.media.nullInterfaces,
        /** A deflecting (GRIN) medium exists (fable-variable-ior): the walk handles the
         *  ms.deflected outcome — spawn the bent exit ray, recompute current_medium. */
        deflecting: p.media.deflecting,
        dispersion: p.dispersion !== null && p.dispersion.regions.length > 0,
        transmission: p.materials.models.some(modelTransmission),
        /** Some material can be lit from below its shading normal (fable-rough-dielectric
         *  §3.1): light_query_surface asks material_two_sided at runtime instead of
         *  folding the constant `false`. A DECISION read from the link map, never
         *  re-derived here. */
        twoSided: p.materials.twoSidedShading,
        /** The ambient space is a quotient (components/quotient): pt-nee's emitter weight is 1 for
         *  an image NEE never samples, and the walk reduces the camera's start point and each
         *  medium event point into the fundamental domain. */
        quotient: p.measurement.quotient !== undefined,
        /** Some material's shading normal is perturbed (a bump): the walk replaces the hit's
         *  frame with material_shading_frame before anything reads it. */
        perturbed: p.materials.perturbed !== undefined,
        envSamplable: p.environmentSamplable,
        /** The env-vs-finite selection draw is live (u_envSelectProb exists); false in
         *  env-only programs, where BOTH selection sides fold to the constant 1. */
        envSelectLive: p.environmentSelectionLive,
        emitters: p.emitters.samplable,
        emittersPdf: p.emitters.lightingPdf,
        rr: p.estimator.russianRoulette,
        /** T2's medium placement (impl-plan-equiangular): per-segment equiangular vs
         *  at-the-scatter-vertex. Only ever true when nee ∧ scattering. */
        equiangular: lighting !== null && p.media.scatteringArms
            && p.estimator.mediumLightSampling === 'equiangular',
    };
}
export type Flags = ReturnType<typeof flags>;
