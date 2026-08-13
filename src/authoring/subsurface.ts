// authoring/subsurface.ts — the subsurface albedo inversion (docs/fable-subsurface.md §4, §8).
//
// WHAT THIS IS FOR. A scattering medium is described to the renderer by σ_s and σ_a, and those
// are not authorable quantities for a translucent object. Light leaving a dense medium has
// bounced hundreds of times, so the colour you SEE is a saturating function of the fraction that
// survives one bounce: α = 0.99 is a grey object and α = 0.999 is a white one. Nobody can dial
// that by hand. This file inverts the relationship, so a material can be authored as "the colour
// I want, and how far light travels inside" and come out as the coefficients the compiler reads.
//
// WHERE IT SITS. The authoring layer, deliberately — the same shape as flattenGroups(): compose
// at definition time, hand the compiler its ordinary flat vocabulary. `MediumDescription` gains
// no field, the Validator gains no rule, no component or GLSL changes. The DIRECT route (author
// σ_s and σ_a outright) is untouched and remains the right tool when you want to state the
// physics rather than a target appearance.
//
// THE MATHS (docs/fable-subsurface.md §4). `s` is van de Hulst's SIMILARITY PARAMETER, the one
// number that combines α and the phase anisotropy g. It exists because a dense forward-scattering
// medium and a thinner even-scattering one look nearly the same after many bounces — which is
// exactly why the inversion has to take g as an input, and why the older isotropic-only fits
// silently change an object's colour when g moves.
//
//     forward   s = sqrt((1 − α)/(1 − α·g))
//               C = (1 − s)(1 − 0.139 s)/(1 + 1.17 s)
//
//     inverse   s = 4.09712 + 4.20863·C − sqrt(9.59217 + 41.6808·C + 17.7126·C²)
//               α = (1 − s²)/(1 − g·s²)
//
// then σ_t = 1/radius, σ_s = α·σ_t, σ_a = (1 − α)·σ_t. This is the inversion specified by
// OpenPBR and implemented in Cycles, so our numbers are comparable with production's.
//
// WHAT WE DELIBERATELY DID NOT COPY (docs/fable-subsurface.md §5, owner-decided):
//   • No hidden per-channel radius default. OpenPBR ships (1.0, 0.5, 0.25) so that one radius
//     dial produces skin's reddish bleed; that bakes a colour shift into a parameter which looks
//     neutral. Radius here defaults to EQUAL across channels and per-channel values are typed
//     out. (Arnold suggests roughly (1.0, 0.35, 0.2) for skin, if you want that look.)
//   • No similarity-theory substitution. g is passed through to the phase function unchanged and
//     used at every bounce at every depth. Cycles switches to isotropic scattering after bounce 9
//     and other implementations quietly reduce g with compensation; we do the correct scattering
//     the whole time.
//   • Anisotropy is NOT folded into the length. Cycles' legacy mapping used σ_t = (1/radius)/(1−g),
//     which changes what `radius` means and is why they must ship two incompatible modes forever.
//     Folding g into α via s keeps `radius` meaning one thing.
//
// CONSTANT-ONLY, BY CONSTRUCTION. The inversion is CPU arithmetic evaluated once here, so its
// inputs are plain numbers — a {param} radius cannot be inverted live. Retuning means re-authoring
// (the house rule: precompute the HOW, ship numbers). If you need a live dial, drive σ_s/σ_a
// directly on the medium instead.

import type { MediumDescription, Vec3 } from '../compiler/types.js';

/** Highest α we will emit. A pure-white target asks for a medium that never absorbs, whose walk
 *  cannot terminate by absorption at all; this is the clamp Cycles uses for the same reason.
 *  Exported because the endpoint behaviour below is a gated fact, not an implementation detail. */
export const MAX_SINGLE_SCATTER_ALBEDO = 0.999999;

// ── TWO ENDPOINT BEHAVIOURS, measured and declared rather than papered over ──────────────────
//
// Both come from `α = (1 − s²)/(1 − g·s²)` being a ratio of small numbers near the ends of the
// colour range, and both are harmless. They are written down because they are the kind of thing
// that looks like a bug six months later.
//
// NEAR BLACK, the fit's residual is amplified by 1/(1 − g). Exactly, s(0) = 0.99999714 where the
// true value is 1, so a black target yields α ≈ 5.7e-6 at g = 0 instead of 0 — and that residual
// scales as 1/(1 − g), reaching α ≈ 5.7e-4 at g = 0.99. A medium that returns 0.06% of light per
// bounce is visually indistinguishable from one that returns none, so this is inconsequential; it
// is NOT special-cased, because a special case at C = 0 would hide the same effect at C = 0.01
// where no special case helps. If a truly perfect absorber is ever wanted, author σ_s = 0 directly.
//
// NEAR WHITE, the clamp binds earlier than you would guess as scattering turns forward: at
// g = 0.99 every target above roughly C = 0.99 saturates to MAX_SINGLE_SCATTER_ALBEDO and becomes
// indistinguishable. That is a real authoring limit — a very bright AND very forward-scattering
// medium cannot be dialled finely — and it is the correct behaviour, since the alternative is a
// medium whose walk absorption can never end.

/** The phase function's usable anisotropy range. |g| = 1 makes the Henyey–Greenstein denominator
 *  vanish and poisons the frame with NaN, so the Validator caps |g| at 0.99 — mirrored here so
 *  the error arrives at the authoring call with the reason attached, not later. */
const MAX_ANISOTROPY = 0.99;

export interface SubsurfaceSpec {
    /**
     * The colour the object should READ as: its reflection albedo after all orders of multiple
     * scattering, per channel in [0, 1]. This is an appearance target, not a coefficient — 0 is a
     * pure absorber and 1 is a medium that never absorbs (clamped — see MAX_SINGLE_SCATTER_ALBEDO).
     */
    color: Vec3;
    /**
     * How far light travels inside, per channel, in scene units — the mean free path, so
     * σ_t = 1/radius. A single number means the same distance in all three channels. Chromatic
     * radii are what make skin look like skin: red carrying further than blue is the reddish
     * bleed at shadow terminators.
     */
    radius: number | Vec3;
    /**
     * Phase anisotropy g ∈ [−0.99, 0.99]: −1 fully backward, 0 even, +1 fully forward. Default 0.
     * Passed to the Henyey–Greenstein phase function unchanged. It also enters the inversion, so
     * changing it holds the observed colour fixed rather than shifting it — the whole reason for
     * using this inversion over an isotropic-only one.
     *
     * Note the cost, which is real and is the price of the correct phase function: holding the
     * colour fixed, a more forward-scattering medium needs a HIGHER α and therefore many more
     * bounces before absorption (≈ 106 at g = 0 rising to ≈ 527 at skin's g = 0.8). Budget for it.
     */
    anisotropy?: number;
}

/** van de Hulst's similarity parameter from α and g — the FORWARD direction, exported for tests
 *  and for anyone checking a round trip. */
export function similarityParameter(alpha: number, g: number): number {
    return Math.sqrt((1 - alpha) / (1 - alpha * g));
}

/** The observed multiple-scattering albedo from the similarity parameter — the FORWARD relation
 *  that `similarityFromColor` inverts. Exported so the round trip is testable. */
export function colorFromSimilarity(s: number): number {
    return ((1 - s) * (1 - 0.139 * s)) / (1 + 1.17 * s);
}

/** The fitted inverse of `colorFromSimilarity`. Accurate to ~1e-5 over C ∈ [0, 1]. */
export function similarityFromColor(color: number): number {
    return 4.09712 + 4.20863 * color
        - Math.sqrt(9.59217 + 41.6808 * color + 17.7126 * color * color);
}

/**
 * Single-scattering albedo α for a target multiple-scattering colour and a phase anisotropy —
 * the inversion's payload. Exact algebra given s: α = (1 − s²)/(1 − g·s²).
 */
export function alphaFromColor(color: number, g: number): number {
    // s is only ever used squared, so the fit's tiny negative excursion at color → 1 is harmless.
    const s2 = similarityFromColor(color) ** 2;
    const alpha = (1 - s2) / (1 - g * s2);
    return Math.min(Math.max(alpha, 0), MAX_SINGLE_SCATTER_ALBEDO);
}

/**
 * Build a scattering medium from an appearance target. Returns the plain `MediumDescription` the
 * compiler already understands — nothing downstream knows this function exists.
 *
 *     material: {
 *         model: 'rough_dielectric', ior: 1.4, roughness: 0.12,
 *         medium: subsurfaceMedium({ color: [0.85, 0.62, 0.5], radius: [0.5, 0.18, 0.1] }),
 *     }
 */
export function subsurfaceMedium(spec: SubsurfaceSpec): MediumDescription {
    const g = spec.anisotropy ?? 0;
    if (!Number.isFinite(g) || Math.abs(g) > MAX_ANISOTROPY) {
        throw new Error(
            `subsurfaceMedium: anisotropy ${g} is outside ±${MAX_ANISOTROPY} — the `
            + `Henyey–Greenstein phase function divides by a term that vanishes at |g| = 1 and `
            + `NaN-poisons the frame, so the Validator caps it there too `
            + `(docs/fable-subsurface.md §7)`);
    }

    const radius: Vec3 = typeof spec.radius === 'number'
        ? [spec.radius, spec.radius, spec.radius]
        : spec.radius;

    const sigma_s: Vec3 = [0, 0, 0];
    const sigma_a: Vec3 = [0, 0, 0];
    const channel = ['red', 'green', 'blue'];

    for (let c = 0; c < 3; c++) {
        const color = spec.color[c];
        if (!Number.isFinite(color) || color < 0 || color > 1) {
            throw new Error(
                `subsurfaceMedium: color.${channel[c]} = ${color} is outside [0, 1] — it is a `
                + `reflection albedo (the fraction of light the medium sends back), not a `
                + `radiance, so values above 1 would ask for a medium that creates energy`);
        }
        const r = radius[c];
        if (!Number.isFinite(r) || r <= 0) {
            throw new Error(
                `subsurfaceMedium: radius.${channel[c]} = ${r} must be finite and > 0 — it is a `
                + `mean free path in scene units and σ_t = 1/radius, so zero means infinitely `
                + `dense and has no meaning as authored input`);
        }

        // σ_t = 1/radius, then split by the inverted single-scattering albedo.
        const sigma_t = 1 / r;
        const alpha = alphaFromColor(color, g);
        sigma_s[c] = alpha * sigma_t;
        sigma_a[c] = (1 - alpha) * sigma_t;
    }

    // phase_g is emitted even when zero: `hg` reads it, and stating it makes the medium's
    // scattering model explicit at the authoring site rather than defaulted three layers down.
    return { sigma_s, sigma_a, phase_g: g };
}
