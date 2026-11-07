// The §11.3 pdf–histogram harness, GGX instance (fable-compiler-contracts §11.3,
// fable-validation-scenes §6 H). This TS twin is a line-for-line transcription of
// ggx.glsl's model math; the shared machinery it calls (glsl/core/microfacet.glsl:
// D, Smith G₁, VNDF and the F-free reflection lobe microfacet_reflect_*, the stdlib every
// microfacet occupant links) has its twin, and the harness, in components/materials/microfacetTwin.ts —
// change one, change both. Three checks per (inclination × roughness) config from the spec grid:
//   1. χ² histogram: sampled wi frequencies vs ∫pdf over each bin (32×16 hemispherical
//      grid + a rejected-sample cell). Expected counts use adaptive per-bin refinement —
//      plain midpoint×Δω under-resolves the roughness-0.1 lobe and fails spuriously.
//   2. Triple consistency: weight·pdf ≈ eval·|cosθi| per sample (exact algebraically —
//      the VNDF cancellation; §11.3's "nearly free to assert").
//   3. sample.pdf ≡ ggx_pdf(wi, wo) — the sampler/query agreement MIS depends on.
// The GPU debug-strategy form of this harness (validation-scenes §6) remains deferred;
// glslang + the veach-mis witness own the GLSL side.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { conductorGain, energyTable, schlickAverage } from '../microfacet_energy/build.js';
import { microfacetEnergyData } from '../microfacet_energy/data.js';
import {
    type V3, type TwinSample, alphaOf, dirOf, lcg, reflectEval, reflectPdf, reflectSample, samplerConsistency,
} from '../microfacetTwin.js';

// ── The model (local frame: n = +z); the lobe twin is components/materials/microfacetTwin.ts ──

// Scalar f0 (monochrome spectrum) — F multiplies weight and eval identically.
function schlick(f0: number, cosOH: number): number {
    return f0 + (1.0 - f0) * Math.pow(1.0 - Math.abs(cosOH), 5.0);
}

// ggx: the lobe times Schlick's F at the lobe's half-vector cosine.
function ggxEval(wi: V3, wo: V3, roughness: number, f0: number): number {
    const l = reflectEval(wi, wo, alphaOf(roughness));
    if (l.f === 0.0) return 0.0;
    return schlick(f0, l.cosH) * l.f;
}

function ggxPdf(wi: V3, wo: V3, roughness: number): number {
    return reflectPdf(wi, wo, alphaOf(roughness));
}

function ggxSample(woIn: V3, roughness: number, f0: number, u1: number, u2: number): TwinSample {
    const l = reflectSample(woIn, alphaOf(roughness), u1, u2);
    return { wi: l.wi, weight: schlick(f0, l.cosH) * l.weight, pdf: l.pdf, rejected: l.pdf === 0 };
}

// ── The spec grid (validation-scenes §6): cosθo ∈ {0.9, 0.5, 0.1} × r ∈ {0.1, 0.4, 0.8} ──

const INCLINATIONS = [0.9, 0.5, 0.1];
const ROUGHNESSES = [0.1, 0.4, 0.8];
const F0 = 0.7;
const N = 1 << 18;                     // per config; 9 configs ⇒ 2.36M ≥ the spec's 2²⁰ total

describe('GGX §11.3 pdf–histogram consistency (TS twin of ggx.glsl)', () => {
    for (const cosO of INCLINATIONS) {
        for (const r of ROUGHNESSES) {
            it(`cosθo=${cosO} roughness=${r}: histogram matches pdf (χ²), triple + pdf agreement`, () => {
                const wo = dirOf(cosO, 0);
                const c = samplerConsistency(N, lcg(1234567 + cosO * 1000 + r * 100),
                    (u1, u2) => ggxSample(wo, r, F0, u1, u2),
                    (wi) => ggxEval(wi, wo, r, F0) * Math.abs(wi[2]),
                    (wi) => ggxPdf(wi, wo, r));
                // 2 & 3 — exact identities up to float noise (h reconstruction in the pdf).
                expect(c.worstTriple).toBeLessThan(1e-4);
                expect(c.worstPdfAgree).toBeLessThan(1e-3);
                // 1 — χ² against integrated expected counts, small-E bins pooled.
                expect(c.chi2, `χ²=${c.chi2.toFixed(1)} over ${c.cells} cells (crit ${c.crit.toFixed(1)})`).toBeLessThan(c.crit);
            });
        }
    }

    it('reciprocity: eval(wi,wo) = eval(wo,wi)', () => {
        const rand = lcg(42);
        for (let i = 0; i < 1000; i++) {
            const a = dirOf(rand(), 2 * Math.PI * rand());
            const b = dirOf(rand(), 2 * Math.PI * rand());
            const r = 0.05 + 0.9 * rand();
            const f = ggxEval(a, b, r, F0), g = ggxEval(b, a, r, F0);
            expect(Math.abs(f - g)).toBeLessThan(1e-9 * Math.max(1, f));
        }
    });
});

// ── The F-free lobe's contract with the models that wrap it ─────────────────────────────
// A reflection-only microfacet model is F(cos_h) times the lobe, with an energy gain read at
// cos_o. Its eval and sample agree only if the lobe's sample reports, for the direction it
// drew, the same cos_h and cos_o its eval reports for that direction.

describe('F-free GGX reflection lobe (microfacet_reflect_*)', () => {
    it('sample and eval report the same Fresnel and gain arguments; dead samples weigh 0', () => {
        const rand = lcg(7);
        let live = 0, dead = 0;
        for (let i = 0; i < 20000; i++) {
            const side = rand() < 0.5 ? -1 : 1;
            const d = dirOf(0.02 + 0.98 * rand(), 2 * Math.PI * rand());
            const wo: V3 = [d[0], d[1], d[2] * side];
            const a = alphaOf(0.05 + 0.95 * rand());
            const s = reflectSample(wo, a, rand(), rand());
            if (s.pdf === 0) {
                dead++;
                expect(s.weight).toBe(0);
                expect(s.wi).toEqual(wo);
                expect(Number.isFinite(s.cosH) && Number.isFinite(s.cosO)).toBe(true);
                continue;
            }
            live++;
            expect(s.wi[2] * wo[2]).toBeGreaterThan(0);
            const e = reflectEval(s.wi, wo, a);
            expect(Math.abs(e.cosH - s.cosH)).toBeLessThan(1e-9);
            expect(Math.abs(e.cosO - s.cosO)).toBeLessThan(1e-12);
            expect(Math.abs(e.f * Math.abs(s.wi[2]) - s.weight * s.pdf)).toBeLessThan(1e-6 * e.f * Math.abs(s.wi[2]));
        }
        expect(live).toBeGreaterThan(0);
        expect(dead).toBeGreaterThan(0);
    });

    it('eval is 0 across the surface', () => {
        expect(reflectEval([0, 0.6, 0.8], [0, 0.6, -0.8], 0.3).f).toBe(0);
        expect(reflectPdf([0, 0.6, 0.8], [0, 0.6, -0.8], 0.3)).toBe(0);
    });

    it('ggx.glsl reaches D, G₁ and VNDF sampling only through the lobe', () => {
        const glsl = readFileSync(new URL('./ggx.glsl', import.meta.url), 'utf8');
        const code = glsl.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
        expect(code).not.toMatch(/microfacet_(D|G1|sample_vndf|to_local|from_local)\s*\(/);
        for (const fn of ['microfacet_reflect_eval', 'microfacet_reflect_pdf', 'microfacet_reflect_sample']) {
            expect(code).toContain(`${fn}(`);
        }
    });
});

// ── Energy compensation (measurement.microfacet 'energy-compensated') ──────────────────
// ggx.glsl multiplies eval and the sample weight by microfacet_conductor_gain(μₒ, α, F_avg)
// and leaves the pdf alone. The gain depends on ωₒ only, so the sampled distribution, and
// with it the χ² above, is unchanged. Whether the GLSL eval and sample apply the same gain
// is checked on the GPU by the ms-furnace witness (pt, pt-nee and pt-mis read eval and the
// sample weight in different proportions); a TS twin multiplies both by one gainOf and
// cannot see it. What the twin checks is the gain's value: the mean compensated weight of a
// white conductor, by sampling, is 1.

const table = energyTable(
    readFileSync(join(__dirname, '../microfacet_energy/data/energy.bin')),
    microfacetEnergyData.width, microfacetEnergyData.height);
const gainOf = (wo: V3, roughness: number, f0: number) => conductorGain(table, Math.abs(wo[2]), alphaOf(roughness), schlickAverage(f0));
function compensatedSample(wo: V3, roughness: number, f0: number, u1: number, u2: number): TwinSample {
    const s = ggxSample(wo, roughness, f0, u1, u2);
    return { ...s, weight: s.weight * gainOf(wo, roughness, f0) };
}

describe('GGX energy-compensated twin', () => {
    it('white furnace by sampling: the mean compensated weight of an f0 = 1 conductor is 1', () => {
        for (const cosO of [0.9, 0.5, 0.1]) for (const r of [0.4, 1.0]) {
            const wo = dirOf(cosO, 0);
            const rand = lcg(99 + cosO * 1000 + r * 100);
            const n = 1 << 16;
            let sum = 0;
            for (let i = 0; i < n; i++) sum += compensatedSample(wo, r, 1, rand(), rand()).weight;
            expect(Math.abs(sum / n - 1), `cosθo=${cosO} roughness=${r}: ${sum / n}`).toBeLessThan(0.015);   // Monte Carlo, 2¹⁶ samples
        }
    });
});
