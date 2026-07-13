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
        emitters: p.emitters.samplable,
        emittersPdf: p.emitters.lightingPdf,
        rr: p.estimator.russianRoulette,
    };
}
export type Flags = ReturnType<typeof flags>;
