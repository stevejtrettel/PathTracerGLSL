// Accumulator registry (estimator pick-one family — the progressive-integration axis).
// An accumulator occupant = one folder (the main() that folds the traced sample into
// the accumulation target) + one line below (D3: the type→path if-chain in
// generate/features/accumulation.ts is dead — the hasLambert pattern's last twin).
//
// Descriptors declare FACTS about one occupant — including which ping-pong INPUTS it
// reads, so the feature declares exactly those samplers (exact linkage: oneshot reads
// neither and its programs carry no dead u_previous). Composition (MRT structure, the
// variance export target) stays Planner decisions. Origin is DERIVED from the key.

import averageGLSL from './average/average.glsl?raw';
import varianceGLSL from './variance/variance.glsl?raw';
import oneshotGLSL from './oneshot/oneshot.glsl?raw';

export interface AccumulatorDescriptor {
    /** Registry key — `estimator.accumulation.type` (Validator-gated; 'exponential'
     *  stays reserved-rejected until built). */
    type: string;
    /** ?raw source providing the accumulating main(). */
    glsl: string;
    /** Reads the previous-frame accumulation (u_previous). */
    readsPrevious: boolean;
    /** Reads the previous second moment (u_previousMoment — the variance MRT pair). */
    readsMoment: boolean;
}

export const ACCUMULATORS: Record<string, AccumulatorDescriptor> = {
    average: { type: 'average', glsl: averageGLSL, readsPrevious: true, readsMoment: false },
    variance: { type: 'variance', glsl: varianceGLSL, readsPrevious: true, readsMoment: true },
    oneshot: { type: 'oneshot', glsl: oneshotGLSL, readsPrevious: false, readsMoment: false },
};
