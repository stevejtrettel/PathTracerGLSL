// Accumulator registry (estimator pick-one family — the progressive-integration axis).
// An accumulator occupant = one folder (the main() that folds the traced sample into
// the accumulation target) + one line below (D3: the type→path if-chain in
// generate/features/accumulation.ts is dead — the hasLambert pattern's last twin).
//
// Descriptors declare FACTS about one occupant — including which ping-pong INPUTS it
// reads, so the feature declares exactly those samplers (exact linkage: oneshot reads
// neither and its programs carry no dead u_previous) — and the statistics it can record
// alongside its pictures (variance, for the running mean). Composition (MRT structure,
// the variance export target) stays Planner decisions. Origins are DERIVED from the keys.

import averageGLSL from './average/average.glsl?raw';
import varianceGLSL from './variance/variance.glsl?raw';
import oneshotGLSL from './oneshot/oneshot.glsl?raw';

/** A statistic a mode can record alongside its pictures, switched on by the strategy field
 *  of the same name (`accumulation: { type: 'average', variance: true }`). It never changes
 *  the mode's pictures. Its GLSL lives in the folder named by its key. */
export interface AccumulatorStatistic {
    /** ?raw source of the main() that updates the mode's pictures and this statistic. */
    glsl: string;
    /** Reads the previous second moment (u_previousMoment — the second MRT attachment). */
    readsMoment: boolean;
}

export interface AccumulatorDescriptor {
    /** Registry key — `estimator.accumulation.type` (Validator-gated; 'exponential'
     *  stays reserved-rejected until built). */
    type: string;
    /** ?raw source providing the accumulating main(). */
    glsl: string;
    /** Reads the previous-frame accumulation (u_previous). */
    readsPrevious: boolean;
    /** The statistics this mode supports, keyed by their strategy field. */
    statistics: Record<string, AccumulatorStatistic>;
}

export const ACCUMULATORS: Record<string, AccumulatorDescriptor> = {
    // Welford's update is the running mean's companion: only the equal-weight mean has it.
    average: { type: 'average', glsl: averageGLSL, readsPrevious: true, statistics: { variance: { glsl: varianceGLSL, readsMoment: true } } },
    oneshot: { type: 'oneshot', glsl: oneshotGLSL, readsPrevious: false, statistics: {} },
};

/** The statistic a strategy's accumulation switches on (at most one: each statistic's
 *  main() updates the mode's pictures too), or null. */
export function requestedStatistic(accumulation: { type: string; [key: string]: unknown }): string | null {
    const mode = ACCUMULATORS[accumulation.type];
    if (mode === undefined) return null;
    return Object.keys(mode.statistics).find((name) => accumulation[name] === true) ?? null;
}
