// tests/helpers/halfspace.test.ts — gates for the halfspace reference twin.
//
// This file exists because halfspace.ts is about to become the EXPECTED VALUE of GPU witnesses.
// A reference that is not itself checked is not a reference, it is a second opinion. So every
// claim it makes is pinned here against something it did not compute:
//
//   • the single-scattering limits, derived on paper below — the ω → 0 behaviour of both albedos
//     comes out of a one-bounce integral that needs no H-function at all;
//   • Chandrasekhar's moment identity ∫₀¹H(µ)dµ = (2/ω)(1 − √(1−ω)) — a closed-form property of
//     the solved H, so it checks the FIXED POINT rather than the albedo formulas built on it;
//   • the conservative endpoint (ω = 1 reflects everything);
//   • the Monte-Carlo walk against the closed form at g = 0, which is the only place the two
//     tiers overlap and therefore the only place each can audit the other.

import { describe, it, expect } from 'vitest';
import {
    isotropicHalfspace,
    planeAlbedo,
    sphericalAlbedo,
    mcHalfspaceAlbedo,
} from './halfspace.js';

/**
 * THE SINGLE-SCATTERING LIMITS, derived rather than quoted. As ω → 0 only one-bounce paths
 * survive, and for isotropic scattering (phase = 1/4π) the halfspace BRDF is
 * f(µ, µ₀) = (ω/4π)·1/(µ + µ₀), so
 *
 *     A_p(µ)/ω → ½·[1 − µ·ln((1+µ)/µ)]        ⇒ at µ = 1:  ½(1 − ln2) = 0.15342641
 *     A_s/ω    → ∫₀¹ µ[1 − µ ln((1+µ)/µ)] dµ  = ½ − 0.29543 = 0.20456864
 *
 * with ∫₀¹µ²ln((1+µ)/µ)dµ = (2ln2)/3 − 5/18 + 1/9 = 0.29543136 exactly.
 */
const SINGLE_SCATTER_PLANE_NORMAL = 0.5 * (1 - Math.LN2);
const SINGLE_SCATTER_SPHERICAL = 0.5 - ((2 * Math.LN2) / 3 - 5 / 18 + 1 / 9);

describe('the H-function solve', () => {
    it('satisfies Chandrasekhar’s zeroth-moment identity ∫H dµ = (2/ω)(1 − √(1−ω))', () => {
        // A closed-form property of H itself — independent of everything the albedos do with it,
        // so this is the test that catches a wrong quadrature or a mis-iterated fixed point.
        for (const omega of [0.1, 0.3, 0.5, 0.757527, 0.9, 0.976, 0.99, 0.999]) {
            const hs = isotropicHalfspace(omega);
            // Integrate H on a fine grid the solve did not use (Simpson, 2001 points).
            const n = 2000;
            let acc = 0;
            for (let i = 0; i <= n; i++) {
                const mu = i / n;
                const wgt = i === 0 || i === n ? 1 : i % 2 ? 4 : 2;
                acc += wgt * hs.H(mu);
            }
            acc *= 1 / (3 * n);
            const identity = (2 / omega) * (1 - Math.sqrt(1 - omega));
            expect(acc, `ω = ${omega}`).toBeCloseTo(identity, 7);
        }
    });

    it('is H(0) = 1 and increasing in µ', () => {
        const hs = isotropicHalfspace(0.9);
        expect(hs.H(0)).toBeCloseTo(1, 12);
        let prev = hs.H(0);
        for (let i = 1; i <= 20; i++) {
            const h = hs.H(i / 20);
            expect(h, `µ = ${i / 20}`).toBeGreaterThan(prev);
            prev = h;
        }
    });

    it('rejects an ω outside [0, 1) rather than returning a plausible number', () => {
        expect(() => isotropicHalfspace(1.0001)).toThrow(/must lie/);
        expect(() => isotropicHalfspace(-0.1)).toThrow(/must lie/);
        // ω = 1 exactly is refused BY NAME, with the reason — it is the singular conservative
        // case, and the refusal is what stops a silently under-converged H from being trusted.
        expect(() => isotropicHalfspace(1)).toThrow(/singular conservative case/);
    });

    it('still solves at the highest ω the authoring layer can produce', () => {
        // MAX_SINGLE_SCATTER_ALBEDO = 0.999999 is the clamp in src/authoring/subsurface.ts, so
        // the iteration cap has to clear it; iterations scale as ~1/√(1−ω).
        expect(() => isotropicHalfspace(0.999999)).not.toThrow();
    }, 30_000);
});

describe('the exact albedos', () => {
    it('reproduces the single-scattering limits as ω → 0', () => {
        const omega = 1e-6;
        expect(planeAlbedo(omega, 1) / omega).toBeCloseTo(SINGLE_SCATTER_PLANE_NORMAL, 5);
        expect(sphericalAlbedo(omega) / omega).toBeCloseTo(SINGLE_SCATTER_SPHERICAL, 5);
    });

    it('reproduces the single-scattering ANGULAR profile as ω → 0', () => {
        // ½[1 − µ ln((1+µ)/µ)] across the whole curve, not just at normal — this is what makes
        // the µ-dependence (the thing the old witness design got wrong) a gated fact.
        const omega = 1e-6;
        for (const mu of [0.2, 0.4, 0.6, 0.8, 1.0]) {
            const paper = 0.5 * (1 - mu * Math.log((1 + mu) / mu));
            expect(planeAlbedo(omega, mu) / omega, `µ = ${mu}`).toBeCloseTo(paper, 5);
        }
    });

    it('reflects everything in the conservative case', () => {
        // Exact by degeneracy: the √(1−ω) prefactor is zero and H is finite.
        expect(planeAlbedo(1, 1)).toBe(1);
        expect(planeAlbedo(1, 0.2)).toBe(1);
        expect(sphericalAlbedo(1)).toBe(1);
    });

    it('approaches the conservative limit with the classical constants', () => {
        // The interesting half: ω = 1 is short-circuited, so something has to check that the
        // short-circuit is the CONTINUOUS limit and not a value pasted over a divergence.
        //
        // Both albedos lose their light as √(1−ω), with coefficients that are known numbers:
        //
        //   (1 − A_p(µ=1))/√(1−ω) → H(1) at ω = 1  = 2.907990  (Chandrasekhar's tabulated value)
        //   (1 − A_s)/√(1−ω)      → 2·α₁ at ω = 1  = 4/√3      (the conservative moment α₁ = 2/√3)
        //
        // Neither constant is computed by this module, so this is a genuine external check on
        // the solve in the regime that matters most for bright subsurface media.
        // The residual at finite ω is itself O(√(1−ω)) — measured 1.8·√(1−ω) relative — so the
        // test asserts BOTH proximity at the tightest ω we can reach and that the gap shrinks at
        // that rate. The rate is the real statement: proximity alone could be a coincidence.
        const H1_CONSERVATIVE = 2.907990;
        const TWO_ALPHA1_CONSERVATIVE = 4 / Math.sqrt(3);

        const ratios = (omega: number) => {
            const k = Math.sqrt(1 - omega);
            return {
                plane: (1 - planeAlbedo(omega, 1)) / k,
                spherical: (1 - sphericalAlbedo(omega)) / k,
            };
        };

        const near = ratios(0.999999);           // = MAX_SINGLE_SCATTER_ALBEDO
        expect(Math.abs(near.plane / H1_CONSERVATIVE - 1)).toBeLessThan(0.003);
        expect(Math.abs(near.spherical / TWO_ALPHA1_CONSERVATIVE - 1)).toBeLessThan(0.003);

        // Ten times closer to conservative ⇒ ten times closer to the limit.
        const far = ratios(0.9999);
        const shrinkP = (H1_CONSERVATIVE - far.plane) / (H1_CONSERVATIVE - near.plane);
        const shrinkS = (TWO_ALPHA1_CONSERVATIVE - far.spherical) / (TWO_ALPHA1_CONSERVATIVE - near.spherical);
        expect(shrinkP).toBeGreaterThan(8);
        expect(shrinkS).toBeGreaterThan(8);
    }, 30_000);

    it('is brighter at grazing than at normal — a scattering halfspace is NOT Lambertian', () => {
        // The physical fact the slab witness was originally built in ignorance of. The spread is
        // largest at low albedo, where single scattering dominates.
        for (const omega of [0.3, 0.757527, 0.976]) {
            let prev = planeAlbedo(omega, 1);
            for (const mu of [0.8, 0.6, 0.4, 0.2]) {
                const a = planeAlbedo(omega, mu);
                expect(a, `ω = ${omega}, µ = ${mu}`).toBeGreaterThan(prev);
                prev = a;
            }
        }
        // …and the spherical albedo lies between the two extremes, as a cosine-weighted average
        // of the curve must.
        const omega = 0.757527;
        expect(sphericalAlbedo(omega)).toBeGreaterThan(planeAlbedo(omega, 1));
        expect(sphericalAlbedo(omega)).toBeLessThan(planeAlbedo(omega, 0.05));
    });

    it('is monotone in ω, in both albedos', () => {
        const grid = [0.05, 0.2, 0.4, 0.6, 0.8, 0.9, 0.95, 0.99];
        for (let i = 1; i < grid.length; i++) {
            expect(planeAlbedo(grid[i], 1)).toBeGreaterThan(planeAlbedo(grid[i - 1], 1));
            expect(sphericalAlbedo(grid[i])).toBeGreaterThan(sphericalAlbedo(grid[i - 1]));
        }
    });
});

describe('the Monte-Carlo twin (the cross-check tier)', () => {
    // 3σ across ~10 assertions is the right band: tight enough to catch a real defect, loose
    // enough that a fixed seed cannot be a coin flip. The seed is pinned, so this is not flaky —
    // it either passes forever or the walk changed.
    const within3Sigma = (mc: { value: number; stderr: number }, exact: number, what: string) => {
        expect(mc.value, `${what}: exact ${exact.toFixed(5)}, mc ${mc.value.toFixed(5)} ± ${mc.stderr.toFixed(5)}`)
            .toBeGreaterThan(exact - 3 * mc.stderr);
        expect(mc.value, `${what}: exact ${exact.toFixed(5)}, mc ${mc.value.toFixed(5)} ± ${mc.stderr.toFixed(5)}`)
            .toBeLessThan(exact + 3 * mc.stderr);
    };

    it('agrees with the closed-form PLANE albedo at g = 0', () => {
        for (const omega of [0.757527, 0.911709, 0.976001]) {
            for (const mu of [1, 0.6, 0.3]) {
                const mc = mcHalfspaceAlbedo({ alpha: omega, g: 0, mu, samples: 200_000 });
                expect(mc.truncated, 'walk truncation must never fire at these albedos').toBe(0);
                within3Sigma(mc, planeAlbedo(omega, mu), `ω = ${omega}, µ = ${mu}`);
            }
        }
    }, 30_000);

    it('agrees with the closed-form SPHERICAL albedo at g = 0', () => {
        for (const omega of [0.757527, 0.911709, 0.976001]) {
            const mc = mcHalfspaceAlbedo({ alpha: omega, g: 0, mu: 'diffuse', samples: 200_000 });
            expect(mc.truncated).toBe(0);
            within3Sigma(mc, sphericalAlbedo(omega), `ω = ${omega}, diffuse`);
        }
    }, 30_000);

    it('is deterministic — the same spec returns the same number', () => {
        const a = mcHalfspaceAlbedo({ alpha: 0.9, g: 0.6, mu: 1, samples: 20_000 });
        const b = mcHalfspaceAlbedo({ alpha: 0.9, g: 0.6, mu: 1, samples: 20_000 });
        expect(a.value).toBe(b.value);
    });

    it('shows anisotropy suppressing the near-normal return at fixed α', () => {
        // Forward scattering sends less light straight back out, so at the SAME α a forward
        // medium is darker head-on. (Holding the authored COLOUR fixed instead raises α to
        // compensate — that is the inversion's job, gated in tests/authoring/subsurface.test.ts.)
        const alpha = 0.9;
        const back = mcHalfspaceAlbedo({ alpha, g: -0.6, mu: 1, samples: 200_000 }).value;
        const iso = mcHalfspaceAlbedo({ alpha, g: 0, mu: 1, samples: 200_000 }).value;
        const fwd = mcHalfspaceAlbedo({ alpha, g: 0.6, mu: 1, samples: 200_000 }).value;
        expect(back).toBeGreaterThan(iso);
        expect(iso).toBeGreaterThan(fwd);
    }, 30_000);
});
