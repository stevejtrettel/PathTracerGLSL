// The TS twin of thin_dielectric.glsl, in the local frame (n = +z, identity Frame,
// ambient_dot = dot), line for line: change one, change both.
//
// Checks:
//   1. The closed form R_tot = 2R/(1 + R) equals the sum of the sheet's internal bounces,
//      R + T²R/(1 − R²), and R_tot + T_tot = 1, over cos ∈ [0, 1] and several η. The one R
//      serves both faces because the inner face reflects as much as the outer one (Stokes):
//      F(cos_t; η) = F(cos_i; 1/η) with cos_t the refracted cosine, checked here too.
//   2. The reflection frequency over 10⁶ draws of uc equals R_tot (binomial, 5σ).
//   3. Directions and weights: transmission is wi = −wo exactly, reflection is the mirror,
//      both weights are 1, both pdfs 0 with LOBE_DELTA; eval and pdf are 0.
//   4. Pinned values for η = 1.5, the thin-pane witness's expectations: T_tot = 0.923077 at
//      normal incidence and 0.836232 at cos 0.5; an inverted η is total internal reflection at
//      cos 0.5 (T_tot = 0), which is what the witness's tilted pane catches.
//   5. η = 1 is an invisible sheet (T_tot = 1 at every angle).

import { describe, it, expect } from 'vitest';
import { thinDielectricDescriptor } from './thin_dielectric.js';

type V3 = [number, number, number];

/** dielectric_fresnel (glsl/core/math.glsl): eta = n_i/n_t, cos_i ≥ 0; 1 under total
 *  internal reflection. */
function dielectricFresnel(cosI: number, eta: number): number {
    const sin2t = eta * eta * (1.0 - cosI * cosI);
    if (sin2t >= 1.0) return 1.0;
    const cosT = Math.sqrt(1.0 - sin2t);
    const rPar = (cosI - eta * cosT) / (cosI + eta * cosT);
    const rPerp = (eta * cosI - cosT) / (eta * cosI + cosT);
    return 0.5 * (rPar * rPar + rPerp * rPerp);
}

const normalize = (v: V3): V3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };

// ── The twin ──

/** The sheet's total reflectance R_tot = 2R/(1 + R) at cosine cosI (thin_dielectric_reflectance). */
function thinDielectricReflectance(cosI: number, sheetEta: number): number {
    const R = dielectricFresnel(cosI, 1.0 / sheetEta);
    return 2.0 * R / (1.0 + R);
}

interface Sample { wi: V3; weight: number; pdf: number; reflection: boolean; delta: boolean }

function thinDielectricSample(wo: V3, sheetEta: number, uc: number): Sample {
    const cosI = Math.min(Math.max(wo[2], 1e-6), 1.0);
    if (uc < thinDielectricReflectance(cosI, sheetEta)) {
        return { wi: normalize([-wo[0], -wo[1], 2.0 * cosI - wo[2]]), weight: 1, pdf: 0, reflection: true, delta: true };
    }
    return { wi: [-wo[0], -wo[1], -wo[2]], weight: 1, pdf: 0, reflection: false, delta: true };
}

// ── Helpers ──

/** mulberry32: a seeded uniform stream on [0, 1), so the frequency test is deterministic. */
function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const wo = (cos: number): V3 => [Math.sqrt(1 - cos * cos), 0, cos];
const ETAS = [1.0001, 1.33, 1.5, 2.4];
const COSINES = Array.from({ length: 41 }, (_, i) => i / 40);

describe('thin_dielectric descriptor', () => {
    it('one plain float row sheet_eta (no role, no region table), delta lobes on both sides, no index change', () => {
        expect(thinDielectricDescriptor.properties).toEqual([
            { name: 'sheet_eta', glslType: 'float', source: 'sheet_eta', default: 1.5, storage: 'field', constraint: { kind: 'positive' } },
        ]);
        expect(thinDielectricDescriptor.capabilities).toEqual({ nonDeltaLobes: false, transmission: false, support: 'sphere', emissive: false });
    });
});

describe('thin_dielectric twin', () => {
    it('R_tot = 2R/(1 + R) is the sum of the internal bounces; R_tot + T_tot = 1', () => {
        for (const eta of ETAS) {
            for (const cos of COSINES) {
                const R = dielectricFresnel(cos, 1 / eta);
                const T = 1 - R;
                const rTot = thinDielectricReflectance(cos, eta);
                if (R < 1) expect(rTot).toBeCloseTo(R + T * T * R / (1 - R * R), 12);
                // The explicit series Σ_k: R, then T·R^{2k−1}·T for k ≥ 1.
                let series = R, term = T * R * T;
                for (let k = 0; k < 2000 && term > 1e-18; k++) { series += term; term *= R * R; }
                if (R < 1) expect(rTot).toBeCloseTo(series, 9);
                const tTot = (1 - R) / (1 + R);
                expect(rTot + tTot).toBeCloseTo(1, 14);
            }
        }
    });

    it('the inner face reflects as much as the outer one (Stokes), so one R serves both', () => {
        for (const eta of ETAS) {
            for (const cos of COSINES.filter((c) => c > 0)) {
                const sinT2 = (1 - cos * cos) / (eta * eta);
                const cosT = Math.sqrt(1 - sinT2);
                expect(dielectricFresnel(cosT, eta)).toBeCloseTo(dielectricFresnel(cos, 1 / eta), 12);
            }
        }
    });

    it('reflects with frequency R_tot over 10⁶ draws (5σ)', () => {
        const N = 1_000_000;
        for (const [eta, cos] of [[1.5, 1], [1.5, 0.5], [2.4, 0.2], [1.33, 0.05]] as const) {
            const next = rng(1234 + Math.round(eta * 100) + Math.round(cos * 1000));
            let reflected = 0;
            for (let i = 0; i < N; i++) if (thinDielectricSample(wo(cos), eta, next()).reflection) reflected++;
            const p = thinDielectricReflectance(cos, eta);
            expect(Math.abs(reflected / N - p), `eta ${eta} cos ${cos}`).toBeLessThan(5 * Math.sqrt(p * (1 - p) / N));
        }
    });

    it('transmits straight through, reflects in the mirror direction, with weight 1 and pdf 0', () => {
        for (const cos of [1, 0.7, 0.3, 0.05]) {
            const o = wo(cos);
            const t = thinDielectricSample(o, 1.5, 0.999999);
            expect(t.reflection).toBe(false);
            expect(t.wi).toEqual([-o[0], -o[1], -o[2]]);
            const r = thinDielectricSample(o, 1.5, 0);
            expect(r.reflection).toBe(true);
            expect(r.wi[0]).toBeCloseTo(-o[0], 14);
            expect(r.wi[1]).toBeCloseTo(-o[1], 14);
            expect(r.wi[2]).toBeCloseTo(o[2], 14);
            for (const s of [t, r]) {
                expect(s.weight).toBe(1);
                expect(s.pdf).toBe(0);
                expect(s.delta).toBe(true);
            }
        }
    });

    it('pins the thin-pane witness values for η = 1.5; an inverted η reads 0 at cos 0.5', () => {
        expect(1 - thinDielectricReflectance(1, 1.5)).toBeCloseTo(0.923077, 6);
        expect(1 - thinDielectricReflectance(0.5, 1.5)).toBeCloseTo(0.836232, 6);
        expect(dielectricFresnel(1, 1 / 1.5)).toBeCloseTo(0.04, 12);
        expect(1 - thinDielectricReflectance(0.5, 1 / 1.5)).toBe(0);
        // A single interface would read 1 − R = 0.96 at normal incidence.
        expect(1 - dielectricFresnel(1, 1 / 1.5)).toBeCloseTo(0.96, 12);
    });

    it('η = 1 is an invisible sheet', () => {
        // cos > 0: the sampler clamps cos_i to at least 1e-6, and at exactly 0 dielectric_fresnel
        // takes its total-internal-reflection branch.
        for (const cos of COSINES.filter((c) => c > 0)) expect(thinDielectricReflectance(cos, 1)).toBeCloseTo(0, 14);
    });
});
