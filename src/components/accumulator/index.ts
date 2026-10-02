// Accumulator registry (estimator pick-one family — the progressive-integration axis).
// An accumulator occupant = one folder (the static update rule that folds a traced sample
// into a picture) + one line below. The accumulation main() is generated from the planned
// picture list and calls these rules (generate/features/accumulation.ts).
//
// Descriptors declare FACTS about one occupant — including which ping-pong INPUTS it
// reads, so the feature declares exactly those samplers (exact linkage: oneshot reads
// neither and its programs carry no dead u_previous) — and the statistics it can record
// alongside its pictures (variance, for the running mean). Composition (MRT structure,
// the variance export target) stays Planner decisions. Origins are DERIVED from the keys.

import type { PictureFacts } from '../../compiler/types.js';
import averageGLSL from './average/average.glsl?raw';
import varianceGLSL from './variance/variance.glsl?raw';
import oneshotGLSL from './oneshot/oneshot.glsl?raw';

/** A statistic a mode can record alongside its pictures, switched on by the strategy field
 *  of the same name (`accumulation: { type: 'average', variance: true }`). It never changes
 *  the mode's pictures. Its GLSL lives in the folder named by its key. */
export interface AccumulatorStatistic {
    /** ?raw source defining `update`. */
    glsl: string;
    /** The GLSL function that updates this statistic's picture:
     *  `vec3 f(vec3 previous, vec3 mainPrevious, vec3 mainNew, vec3 x, int n)` — its previous
     *  value, the main picture's previous and new values, the sample, and the samples so far. */
    update: string;
    /** The picture this statistic adds. */
    picture: PictureFacts;
}

export interface AccumulatorDescriptor {
    /** Registry key — `estimator.accumulation.type` (Validator-gated; 'exponential'
     *  stays reserved-rejected until built). */
    type: string;
    /** ?raw source defining `update`. */
    glsl: string;
    /** The GLSL function that updates the main picture: `vec3 f(vec3 previous, vec3 x, int n)`
     *  for a mode that reads history, `vec3 f(vec3 x)` for one that does not. */
    update: string;
    /** Reads each picture's previous-frame value (its `previous` sampler). */
    readsPrevious: boolean;
    /** The statistics this mode supports, keyed by their strategy field. */
    statistics: Record<string, AccumulatorStatistic>;
}

export const ACCUMULATORS: Record<string, AccumulatorDescriptor> = {
    // Welford's update is the running mean's companion: only the equal-weight mean has it.
    average: {
        type: 'average', glsl: averageGLSL, update: 'average_update', readsPrevious: true,
        statistics: {
            variance: {
                glsl: varianceGLSL, update: 'variance_update',
                // Shown and saved like radiance: exposure scales it linearly (by k, not k²).
                picture: { name: 'variance', output: 'fragMoment', previous: 'u_previousMoment', display: 'u_variance', view: 'tonemap', formats: ['hdr', 'png'] },
            },
        },
    },
    oneshot: { type: 'oneshot', glsl: oneshotGLSL, update: 'oneshot_update', readsPrevious: false, statistics: {} },
};

/** The statistic a strategy's accumulation switches on (at most one), or null. */
export function requestedStatistic(accumulation: { type: string; [key: string]: unknown }): string | null {
    const mode = ACCUMULATORS[accumulation.type];
    if (mode === undefined) return null;
    return Object.keys(mode.statistics).find((name) => accumulation[name] === true) ?? null;
}
