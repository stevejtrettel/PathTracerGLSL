// The registry of spectrum kinds (contract: spectrumKind.ts; README.md). Kinds are tried in order; the
// last, `rgb`, claims whatever the named kinds do not: a number (gray, or one index at every
// wavelength), an RGB triple, a {param}, a GLSL expression or a per-instance attribute.

import type { SpectrumKind } from './spectrumKind.js';
import { rgbKind } from './rgb/rgb.js';
import { blackbodyKind } from './blackbody/blackbody.js';
import { cauchyKind } from './cauchy/cauchy.js';
import { sellmeierKind } from './sellmeier/sellmeier.js';
import { gaussianKind } from './gaussian/gaussian.js';

// Index formulas first, then blackbody: the order in which a program links their GLSL helpers.
const NAMED_KINDS: readonly SpectrumKind[] = [cauchyKind, sellmeierKind, blackbodyKind, gaussianKind];

/** Every kind, in lookup order: the first whose `is` accepts a value is its kind. */
export const SPECTRUM_KINDS: readonly SpectrumKind[] = [...NAMED_KINDS, rgbKind];

/** Every named kind whose keys the value carries; more than one is a malformed value. */
export function namedKindsClaiming(value: unknown): SpectrumKind[] {
    return NAMED_KINDS.filter(k => k.is(value));
}

/** The named kind that claims the value, if any. */
export function namedKindOf(value: unknown): SpectrumKind | undefined {
    return NAMED_KINDS.find(k => k.is(value));
}

export function kindOf(value: unknown): SpectrumKind {
    return SPECTRUM_KINDS.find(k => k.is(value))!;
}

export { rgbKind };

/** The kind with this id. */
export function kindById(id: string): SpectrumKind {
    const kind = SPECTRUM_KINDS.find(k => k.id === id);
    if (kind === undefined) throw new Error(`unknown spectrum kind '${id}'`);
    return kind;
}
