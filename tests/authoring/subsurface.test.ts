// tests/authoring/subsurface.test.ts — gates for the subsurface albedo inversion
// (docs/fable-subsurface.md §8 Step 1). This is CPU arithmetic evaluated once at definition time,
// so unit tests ARE the correct gate: there is no GLSL to compile and no GPU behaviour to observe.
//
// What these tests are actually defending:
//   1. the fitted inverse really inverts the forward relation (round trip);
//   2. the α step is the exact algebra it claims to be (checked against the forward formula);
//   3. anisotropy moves α in the physically right direction and by the right amount — this is the
//      property the older isotropic-only fits lack, and the reason we adopted this inversion;
//   4. the authored inputs that would produce a NaN frame or a non-terminating walk are rejected
//      AT the authoring call with the reason attached;
//   5. — added Aug 2026 — that the α it produces ACTUALLY REFLECTS THE AUTHORED COLOUR, checked
//      against an exact solution of the transport problem rather than against the fit's own
//      algebra. Tests 1-3 only ever asked whether the fit is self-consistent; they would all pass
//      if the fit were a fit to the wrong quantity. See "what the authored colour IS" below.

import { describe, it, expect } from 'vitest';
import {
    subsurfaceMedium,
    alphaFromColor,
    similarityParameter,
    similarityFromColor,
    colorFromSimilarity,
    MAX_SINGLE_SCATTER_ALBEDO,
} from '../../src/authoring/subsurface.js';
import { sphericalAlbedo, planeAlbedo, mcHalfspaceAlbedo } from '../helpers/halfspace.js';
import type { Vec3 } from '../../src/compiler/types.js';

/** The colours the doc's verification table covers, plus the endpoints. */
const COLORS = [0, 0.05, 0.3, 0.5, 0.7, 0.8, 0.9, 0.95, 0.99, 1];
const ANISOTROPIES = [-0.99, -0.5, -0.2, 0, 0.2, 0.5, 0.8, 0.99];

describe('the fit inverts the forward relation', () => {
    it('round-trips C → s → C to ~1e-5 across the range', () => {
        for (const C of COLORS) {
            const back = colorFromSimilarity(similarityFromColor(C));
            expect(Math.abs(back - C), `C = ${C}`).toBeLessThan(2e-5);
        }
    });

    it('reproduces the s values recorded in docs/fable-subsurface.md §4', () => {
        // If the fit coefficients are ever edited, this is the test that notices.
        const table: [number, number][] = [
            [0.30, 0.49242], [0.50, 0.29714], [0.80, 0.09701], [0.95, 0.02224],
        ];
        for (const [C, s] of table) {
            expect(similarityFromColor(C), `C = ${C}`).toBeCloseTo(s, 4);
        }
    });

    it('is monotone: a brighter target needs a smaller similarity parameter', () => {
        for (let i = 1; i < COLORS.length; i++) {
            expect(similarityFromColor(COLORS[i])).toBeLessThan(similarityFromColor(COLORS[i - 1]));
        }
    });
});

describe('alphaFromColor is the exact algebra given s', () => {
    it('closes the loop α → s → α through the forward similarity relation', () => {
        // similarityParameter is the forward map from (α, g); feeding it the α we produced must
        // return the s the fit produced. This is what makes α = (1 − s²)/(1 − g s²) exact rather
        // than another fit.
        for (const g of ANISOTROPIES) {
            for (const C of [0.05, 0.3, 0.5, 0.8, 0.95]) {
                const alpha = alphaFromColor(C, g);
                expect(similarityParameter(alpha, g), `C = ${C}, g = ${g}`)
                    .toBeCloseTo(similarityFromColor(C), 6);
            }
        }
    });

    it('agrees with the independently-derived Chiang fit at g = 0 to better than 0.2%', () => {
        // Two fits from different arguments; disagreement here means one of them was mistyped.
        const chiang = (A: number) =>
            1 - Math.exp(-5.09406 * A + 2.61188 * A * A - 4.31805 * A * A * A);
        for (const C of [0.3, 0.5, 0.7, 0.8, 0.9, 0.95]) {
            expect(alphaFromColor(C, 0) - chiang(C), `C = ${C}`).toBeLessThan(0.002);
            expect(chiang(C) - alphaFromColor(C, 0), `C = ${C}`).toBeLessThan(0.002);
        }
    });

    it('maps a black target to a near-pure absorber, within the declared amplification', () => {
        // The fit's residual at C = 0 is ~3e-6 in s, and α amplifies it by 1/(1 − g) — the
        // endpoint behaviour declared in the source. 5.7e-4 at g = 0.99 is the worst case, so a
        // bound of 1e-3 pins it without pretending the residual is zero.
        for (const g of ANISOTROPIES) {
            expect(alphaFromColor(0, g), `g = ${g}`).toBeLessThan(1e-3);
            expect(alphaFromColor(0, g), `g = ${g}`).toBeGreaterThanOrEqual(0);
        }
    });

    it('stays inside [0, 1] over the whole input range', () => {
        for (const g of ANISOTROPIES) {
            for (const C of COLORS) {
                const alpha = alphaFromColor(C, g);
                expect(alpha, `C = ${C}, g = ${g}`).toBeGreaterThanOrEqual(0);
                expect(alpha, `C = ${C}, g = ${g}`).toBeLessThanOrEqual(1);
            }
        }
    });

    it('clamps a pure-white target below 1 so the walk can still terminate', () => {
        // α = 1 exactly is a medium that never absorbs: nothing but the bounce budget could end
        // the walk, which is the truncation bias the termination work exists to remove.
        for (const g of ANISOTROPIES) {
            expect(alphaFromColor(1, g), `g = ${g}`).toBeLessThan(1);
            expect(alphaFromColor(1, g), `g = ${g}`).toBeGreaterThan(0.999);
        }
    });

    it('is non-decreasing in the target colour, and strictly increasing below the clamp', () => {
        for (const g of ANISOTROPIES) {
            for (let i = 1; i < COLORS.length; i++) {
                const lo = alphaFromColor(COLORS[i - 1], g);
                const hi = alphaFromColor(COLORS[i], g);
                expect(hi, `g = ${g}, C = ${COLORS[i]}`).toBeGreaterThanOrEqual(lo);
                // Equality is only allowed where the clamp has taken over — see the endpoint
                // note in the source: at high g the clamp binds above roughly C = 0.99.
                if (hi < MAX_SINGLE_SCATTER_ALBEDO) {
                    expect(hi, `g = ${g}, C = ${COLORS[i]}`).toBeGreaterThan(lo);
                }
            }
        }
    });

    it('pins where the clamp starts binding as scattering turns forward', () => {
        // A declared authoring limit, gated so it cannot drift silently: a very bright AND very
        // forward-scattering medium cannot be dialled finely.
        expect(alphaFromColor(0.99, 0.99)).toBe(MAX_SINGLE_SCATTER_ALBEDO);
        expect(alphaFromColor(0.99, 0)).toBeLessThan(MAX_SINGLE_SCATTER_ALBEDO);
        expect(alphaFromColor(1, 0)).toBe(MAX_SINGLE_SCATTER_ALBEDO);
    });
});

describe('anisotropy enters the inversion — the property isotropic-only fits lack', () => {
    it('needs a higher α to hold the same colour as scattering turns forward', () => {
        // Physically: forward scattering wastes fewer bounces reversing direction, so the medium
        // must survive MORE bounces to return the same amount of light.
        for (const C of [0.3, 0.5, 0.8, 0.95]) {
            for (let i = 1; i < ANISOTROPIES.length; i++) {
                expect(alphaFromColor(C, ANISOTROPIES[i]), `C = ${C}`)
                    .toBeGreaterThan(alphaFromColor(C, ANISOTROPIES[i - 1]));
            }
        }
    });

    it('reproduces the walk-length figures in docs/fable-subsurface.md §6', () => {
        // Holding C = 0.8: the table that justifies absorption-based termination.
        const expected: [number, number][] = [
            [-0.5, 0.9859], [0, 0.9906], [0.5, 0.9953], [0.8, 0.9981], [0.9, 0.9991],
        ];
        for (const [g, alpha] of expected) {
            expect(alphaFromColor(0.8, g), `g = ${g}`).toBeCloseTo(alpha, 3);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THE AUTHORED COLOUR IS — the gates that check the fit against PHYSICS rather than against
// itself. Everything above this line tests that the inverse inverts the forward relation; none of
// it would notice if the forward relation described the wrong quantity. These do.
//
// tests/helpers/halfspace.ts solves the same semi-infinite halfspace exactly (Chandrasekhar's
// H-function, isotropic) and by independent Monte-Carlo simulation (any g).
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('the inversion delivers the albedo it promises (checked against exact transport)', () => {
    it('α(C) really has SPHERICAL albedo C, to van de Hulst’s own stated 0.002', () => {
        // THE central claim of src/authoring/subsurface.ts, and until now nothing tested it.
        // The bound is absolute, not relative, because that is the form the fit's accuracy takes:
        // measured worst deviation 0.0021 (at C = 0.05, where it is 2.4% RELATIVE but still two
        // thousandths of an albedo). van de Hulst quotes "at most 0.002 for any set of
        // parameters" and we reproduce that, which is a strong sign both the fit and the solve
        // are what they claim to be.
        for (const C of [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99]) {
            const measured = sphericalAlbedo(alphaFromColor(C, 0));
            expect(Math.abs(measured - C), `C = ${C}, measured A_s = ${measured.toFixed(5)}`)
                .toBeLessThan(0.0025);
        }
    });

    it('is most accurate exactly where translucent materials live', () => {
        // The fit's error collapses as the medium brightens — under 0.0008 above C = 0.6, which
        // is the range every marble/porcelain/skin authoring value sits in. Pinned so a future
        // "improvement" to the fit that trades the bright end for the dark end gets noticed.
        for (const C of [0.6, 0.7, 0.8, 0.9, 0.95]) {
            expect(Math.abs(sphericalAlbedo(alphaFromColor(C, 0)) - C), `C = ${C}`)
                .toBeLessThan(0.0008);
        }
    });
});

describe('anisotropy holds the colour fixed — the similarity claim, cross-checked by simulation', () => {
    // CROSS-CHECK TIER (tests/witnesses/README.md): no closed form exists for g ≠ 0, so the
    // reference here is an independent random walk with its own statistical error (σ ≈ 0.0013 at
    // 150k samples). A failure implicates the fit AND the walk, not the fit alone.
    it('lands on the authored colour at every anisotropy, not just at g = 0', () => {
        // This is the whole reason van de Hulst was chosen over the isotropic-only Chiang fit
        // (docs/fable-subsurface.md §4): turning the anisotropy dial must NOT change the colour.
        // The α values involved are wildly different — at C = 0.3 the fit asks for 0.676 at
        // g = −0.5 and 0.969 at g = 0.9 — and all of them must measure the same 0.3.
        //
        // Tolerance 0.010 absolute, against a measured worst of 0.0064 (g = −0.5, C = 0.3:
        // backward scattering at low albedo is where similarity theory is weakest, since few
        // enough bounces happen that the phase function has not yet washed out). Everywhere else
        // it is within 0.003.
        for (const g of [-0.5, 0, 0.6, 0.9]) {
            for (const C of [0.3, 0.5, 0.7]) {
                const mc = mcHalfspaceAlbedo({
                    alpha: alphaFromColor(C, g), g, mu: 'diffuse', samples: 150_000,
                });
                expect(mc.truncated, `g = ${g}, C = ${C}`).toBe(0);
                expect(Math.abs(mc.value - C), `g = ${g}, C = ${C}, measured ${mc.value.toFixed(4)} ± ${mc.stderr.toFixed(4)}`)
                    .toBeLessThan(0.010);
            }
        }
    }, 60_000);
});

describe('what the authored colour is NOT — the distinction a witness got wrong', () => {
    // These pin the failure mode that produced a broken GPU witness (docs/fable-subsurface.md
    // §8 Step 3): the authored C is a HEMISPHERICAL albedo, and a camera measures a DIRECTIONAL
    // one. They are not the same number and no amount of sample count closes the gap. Asserting
    // the gap is REAL — with its size — is what stops the same test being written again.
    it('a camera looking straight down does NOT read the authored colour', () => {
        // Measured deficits: −17.1% at C = 0.3, −12.5% at 0.5, −7.6% at 0.7. Shrinking with C,
        // because a bright medium's exit distribution approaches Lambertian while a dim one's is
        // dominated by strongly non-Lambertian single scattering.
        const deficits: [number, number][] = [[0.3, 0.171], [0.5, 0.125], [0.7, 0.076]];
        for (const [C, expected] of deficits) {
            const normal = planeAlbedo(alphaFromColor(C, 0), 1);
            expect((C - normal) / C, `C = ${C}`).toBeCloseTo(expected, 2);
        }
    });

    it('the directional reading is view-dependent, so no single view can gate the colour', () => {
        // A Lambertian surface reads its albedo from every angle. This does not — which is why
        // the fix was to expect the DIRECTIONAL value at a pinned angle (via an orthographic
        // camera) rather than to hunt for a viewing angle that happens to read C.
        const alpha = alphaFromColor(0.3, 0);
        expect(planeAlbedo(alpha, 0.2)).toBeGreaterThan(planeAlbedo(alpha, 1) * 1.25);
    });
});

describe('subsurfaceMedium output', () => {
    const sum = (m: { sigma_s?: unknown; sigma_a?: unknown }, c: number) =>
        (m.sigma_s as Vec3)[c] + (m.sigma_a as Vec3)[c];

    it('splits σ_t = 1/radius into σ_s + σ_a per channel', () => {
        const radius: Vec3 = [0.5, 0.18, 0.1];
        const m = subsurfaceMedium({ color: [0.85, 0.62, 0.5], radius });
        for (let c = 0; c < 3; c++) {
            expect(sum(m, c), `channel ${c}`).toBeCloseTo(1 / radius[c], 9);
        }
    });

    it('honours the single-scattering albedo it inverted', () => {
        const m = subsurfaceMedium({ color: [0.9, 0.9, 0.9], radius: 0.25, anisotropy: 0.4 });
        const alpha = alphaFromColor(0.9, 0.4);
        for (let c = 0; c < 3; c++) {
            expect((m.sigma_s as Vec3)[c] / sum(m, c), `channel ${c}`).toBeCloseTo(alpha, 9);
        }
    });

    it('treats a scalar radius as equal across channels — no hidden colour shift', () => {
        // The deliberate deviation from OpenPBR's (1.0, 0.5, 0.25) default: a neutral-looking
        // parameter must not tint the result (docs/fable-subsurface.md §5.3).
        const m = subsurfaceMedium({ color: [0.8, 0.8, 0.8], radius: 0.3 });
        const s = m.sigma_s as Vec3;
        const a = m.sigma_a as Vec3;
        expect(s[0]).toBeCloseTo(s[1], 12);
        expect(s[1]).toBeCloseTo(s[2], 12);
        expect(a[0]).toBeCloseTo(a[1], 12);
        expect(a[1]).toBeCloseTo(a[2], 12);
    });

    it('passes anisotropy through to phase_g unchanged', () => {
        // No similarity-theory substitution anywhere (docs/fable-subsurface.md §5.2).
        for (const g of ANISOTROPIES) {
            expect(subsurfaceMedium({ color: [0.8, 0.8, 0.8], radius: 1, anisotropy: g }).phase_g)
                .toBe(g);
        }
        expect(subsurfaceMedium({ color: [0.8, 0.8, 0.8], radius: 1 }).phase_g).toBe(0);
    });

    it('emits only the fields the compiler reads, and no others', () => {
        const m = subsurfaceMedium({ color: [0.8, 0.7, 0.6], radius: 0.4, anisotropy: 0.2 });
        expect(Object.keys(m).sort()).toEqual(['phase_g', 'sigma_a', 'sigma_s']);
    });

    it('is chromatic when the radius is: a longer red path is a denser-free-path red', () => {
        const m = subsurfaceMedium({ color: [0.85, 0.85, 0.85], radius: [0.5, 0.2, 0.1] });
        const s = m.sigma_s as Vec3;
        expect(s[0]).toBeLessThan(s[1]);      // longer free path ⇒ smaller σ
        expect(s[1]).toBeLessThan(s[2]);
    });
});

describe('subsurfaceMedium rejects inputs that would break the render', () => {
    it('rejects |anisotropy| beyond the phase function’s NaN guard', () => {
        for (const g of [1, -1, 0.995, -1.5, NaN, Infinity]) {
            expect(() => subsurfaceMedium({ color: [0.8, 0.8, 0.8], radius: 1, anisotropy: g }))
                .toThrow(/anisotropy/);
        }
        // …and accepts the Validator's own limit exactly.
        expect(() => subsurfaceMedium({ color: [0.8, 0.8, 0.8], radius: 1, anisotropy: 0.99 }))
            .not.toThrow();
    });

    it('rejects a colour outside [0, 1] and names the channel', () => {
        expect(() => subsurfaceMedium({ color: [0.8, 1.4, 0.8], radius: 1 }))
            .toThrow(/color\.green/);
        expect(() => subsurfaceMedium({ color: [-0.1, 0.8, 0.8], radius: 1 }))
            .toThrow(/color\.red/);
        expect(() => subsurfaceMedium({ color: [0.8, 0.8, NaN], radius: 1 }))
            .toThrow(/color\.blue/);
    });

    it('rejects a non-positive radius and names the channel', () => {
        expect(() => subsurfaceMedium({ color: [0.8, 0.8, 0.8], radius: 0 }))
            .toThrow(/radius\.red/);
        expect(() => subsurfaceMedium({ color: [0.8, 0.8, 0.8], radius: [0.5, -1, 0.5] }))
            .toThrow(/radius\.green/);
        expect(() => subsurfaceMedium({ color: [0.8, 0.8, 0.8], radius: [0.5, 0.5, Infinity] }))
            .toThrow(/radius\.blue/);
    });
});
