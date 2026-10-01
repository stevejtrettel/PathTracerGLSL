// app/capture.ts — saving pictures (docs/claude-outputs-accumulation.md §5). A save names WHAT
// to save: one picture, in one of the formats that picture declares. App.save, the declared lists
// of production renders, and the tiled renderer all capture through App.capture and encode
// through the same file writers.

import type { PictureFormat } from '../compiler/types.js';

/** Own the declaration across rendering and encoding awaits. */
export function snapshotSaves(requests: readonly SaveRequest[]): SaveRequest[] {
    return requests.map(({ picture, format }) => ({ picture, format }));
}

/** One picture to save, in one format. */
export interface SaveRequest {
    picture: string;
    format: PictureFormat;
}

/** A captured picture, bottom row first (the readPixels order): its raw float RGBA for 'hdr',
 *  or its 8-bit RGBA drawn through its view mapping for 'png'. */
export type Captured =
    | { format: 'hdr'; pixels: Float32Array }
    | { format: 'png'; pixels: Uint8Array };

/** Check a whole list against the pictures a renderer keeps (name → the formats it declares)
 *  before anything is rendered: an unknown picture, or a format the picture does not declare
 *  (for example a signed picture as '.hdr', which cannot store negatives), is an error. */
export function validateSaves(pictures: Record<string, PictureFormat[]>, requests: readonly SaveRequest[]): void {
    for (const { picture, format } of requests) {
        const formats = pictures[picture];
        if (formats === undefined) {
            throw new Error(`Cannot save '${picture}': this renderer keeps ${Object.keys(pictures).join(', ') || 'no pictures'}`);
        }
        if (!formats.includes(format)) {
            throw new Error(`Cannot save '${picture}' as ${format}: it can be saved as ${formats.join(', ')}`);
        }
    }
}
