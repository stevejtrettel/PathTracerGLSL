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
        nulls: p.media.nullInterfaces,
        transmission: p.materials.models.some(modelTransmission),
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
