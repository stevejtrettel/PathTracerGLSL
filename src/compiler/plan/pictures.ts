// compiler/plan/pictures.ts
// The per-pixel pictures a program keeps (docs/claude-outputs-accumulation.md §1–§2): the main
// picture its measurement reports, then the statistic its accumulation records. Every picture
// is one attachment of the `accumulation` double buffer, and every reference to a picture's
// storage — pass outputs and inputs, exports, the display, the PNG recipe — is built from this
// list and pictureBuffer().

import { ACCUMULATORS, requestedStatistic, type PictureFacts } from '../../components/accumulator/index.js';
import type { ProgramDescription, PlannedPicture } from './types.js';

/** The accumulation double buffer every picture is an attachment of. */
export const ACCUMULATION_BUFFER = 'accumulation';

/** The main picture of each measurement response. */
const RESPONSE_PICTURES: Record<ProgramDescription['measurement']['response'], PictureFacts> = {
    radiance: { name: 'radiance', output: 'fragColor', previous: 'u_previous' },
};

/** The program's pictures, in order, each with its attachment. */
export function planPictures(program: ProgramDescription): PlannedPicture[] {
    const accumulation = program.estimator.accumulation;
    const mode = ACCUMULATORS[accumulation.type];
    const statistic = requestedStatistic(accumulation);
    const facts: PictureFacts[] = [
        RESPONSE_PICTURES[program.measurement.response],
        ...(statistic === null ? [] : [mode.statistics[statistic].picture]),
    ];
    return facts.map((f, attachment) => ({ ...f, previous: mode.readsPrevious ? f.previous : null, attachment }));
}

/**
 * Where a picture's newest value lives. During the frame — after the path-tracer pass writes
 * it, before the postFrame swap — it is in `_current`; that is what the display reads. After
 * the frame the swap has flipped the pair, so the freshly written frame is in `_previous`;
 * exports and the PNG recipe read there, and so does the next frame's path-tracer pass, for
 * which it is last frame's value. Reading `_current` after the frame would return frame N−1.
 */
export function pictureBuffer(picture: PlannedPicture, which: 'current' | 'previous'): { bufferId: string; attachment: number } {
    return { bufferId: `${ACCUMULATION_BUFFER}_${which}`, attachment: picture.attachment };
}

/** A buffer as a pass-input reference: `id`, or `id:N` for a later attachment. */
export function bufferRef(buffer: { bufferId: string; attachment: number }): string {
    return buffer.attachment > 0 ? `${buffer.bufferId}:${buffer.attachment}` : buffer.bufferId;
}
