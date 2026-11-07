// The TS twin of plastic.glsl, in the local frame (n = +z, identity Frame, ambient_dot = dot),
// line for line: change one, change both. K comes from the descriptor's own derivation
// (diffuseFresnelReflectance), the one definition the shader's mp.coat_fdr is baked from.
//
// Checks:
//   1. The Fresnel identity 1 − K(η) = (1 − D(1/η))/η², with D(η) = ∫₀¹ F(μ; η)·2μ dμ. It
//      catches a wrong quadrature or a wrong η convention. The GPU furnace cannot see a K
//      error below ~1e-3, so this is the only gate on K's accuracy.
//   2. χ² of the sampler against N·∫pdf per bin, with the delta lobe as one more cell whose
//      expected count is N·P_spec.
//   3. The triple: weight·pdf = eval·cos on the diffuse lobe; pdf(sample.wi) = sample.pdf;
//      delta samples carry pdf 0, LOBE_DELTA and the mirror direction.
//   4. Reciprocity of the diffuse lobe.
//   5. Energy: the directional albedo A(μ) = F + (1 − F)·R(1 − K)/(1 − R·K) against both a
//      quadrature of eval (plus the delta lobe's F) and the mean sample weight; R = 1 gives 1.
//   6. η = 1 reduces to Lambert.

import { describe, it, expect } from 'vitest';
import { diffuseFresnelReflectance, plasticDescriptor } from './plastic.js';

type V3 = [number, number, number];

/** dielectric_fresnel: eta = n_i / n_t, cos_i ≥ 0. Returns 1 under total internal reflection. */
function dielectricFresnel(cosI: number, eta: number): number {
    const sin2t = eta * eta * (1.0 - cosI * cosI);
    if (sin2t >= 1.0) return 1.0;
    const cosT = Math.sqrt(1.0 - sin2t);
    const rPar = (cosI - eta * cosT) / (cosI + eta * cosT);
    const rPerp = (eta * cosI - cosT) / (eta * cosI + cosT);
    return 0.5 * (rPar * rPar + rPerp * rPerp);
}

/** The material's resolved fields: albedo R (per channel), coat_eta η, coat_fdr K. */
interface MP { albedo: number[]; coatEta: number; coatFdr: number }
function material(albedo: number[], coatEta: number): MP {
    const fdr = plasticDescriptor.derived!.find((d) => d.name === 'coat_fdr')!;
    return { albedo, coatEta, coatFdr: fdr.fn({ albedo, coat_eta: coatEta }) as number };
}
const average = (s: number[]) => s.reduce((a, b) => a + b, 0) / s.length;

// ── The twin ──

function plasticDiffuse(cosI: number, cosO: number, mp: MP): number[] {
    const invEta = 1.0 / mp.coatEta;
    const through = (1.0 - dielectricFresnel(cosI, invEta)) * (1.0 - dielectricFresnel(cosO, invEta));
    return mp.albedo.map((r) => r / (1.0 - r * mp.coatFdr) * (through * invEta * invEta / Math.PI));
}

function plasticSpecularProb(cosO: number, mp: MP): number {
    const F = dielectricFresnel(cosO, 1.0 / mp.coatEta);
    const total = F + (1.0 - F) * average(mp.albedo);
    return total > 0.0 ? F / total : 0.0;
}

function plasticEval(wi: V3, wo: V3, mp: MP): number[] {
    const cosI = wi[2], cosO = wo[2];
    if (cosI * cosO <= 0.0) return mp.albedo.map(() => 0);
    return plasticDiffuse(Math.abs(cosI), Math.abs(cosO), mp);
}

interface Sample { wi: V3; weight: number[]; pdf: number; delta: boolean }

function plasticSample(wo: V3, mp: MP, uc: number, u: [number, number]): Sample {
    const side = wo[2] < 0.0 ? -1.0 : 1.0;
    const cosO = Math.abs(wo[2]);
    const pSpec = plasticSpecularProb(cosO, mp);
    if (uc < pSpec) {
        const F = dielectricFresnel(cosO, 1.0 / mp.coatEta);
        return { wi: [-wo[0], -wo[1], wo[2]], weight: mp.albedo.map(() => F / pSpec), pdf: 0.0, delta: true };
    }
    const cosI = Math.sqrt(u[1]);
    const sinI = Math.sqrt(Math.max(0.0, 1.0 - u[1]));
    const phi = 2 * Math.PI * u[0];
    const pDiff = 1.0 - pSpec;
    return {
        wi: [sinI * Math.cos(phi), sinI * Math.sin(phi), side * cosI],
        weight: plasticDiffuse(cosI, cosO, mp).map((f) => f * (Math.PI / pDiff)),
        pdf: pDiff * cosI * (1.0 / Math.PI),
        delta: false,
    };
}

function plasticPdf(wi: V3, wo: V3, mp: MP): number {
    const cosI = wi[2], cosO = wo[2];
    if (cosI * cosO <= 0.0) return 0.0;
    return (1.0 - plasticSpecularProb(Math.abs(cosO), mp)) * Math.abs(cosI) * (1.0 / Math.PI);
}

// ── Harness ──

/** splitmix32: decorrelated consecutive draws (three per sample here). */
function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x9e3779b9) >>> 0;
        let z = s;
        z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
        z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
        return ((z ^ (z >>> 15)) >>> 0) / 4294967296;
    };
}

function dirOf(cosT: number, phi: number): V3 {
    const s = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    return [s * Math.cos(phi), s * Math.sin(phi), cosT];
}

/** χ² critical value via Wilson–Hilferty, z = 3.0902 ⇒ p ≈ 0.001. */
function chi2Crit(dof: number): number {
    const z = 3.0902;
    const t = 1 - 2 / (9 * dof) + z * Math.sqrt(2 / (9 * dof));
    return dof * t * t * t;
}

/** ∫₀¹ g(μ) dμ for g smooth except for a square-root kink at μc (0 when there is none) and
 *  equal to `below` on [0, μc): composite Simpson in μ = μc + (1 − μc)s², which smooths the
 *  kink. */
function integrateKinked(g: (mu: number) => number, mc: number, below: number): number {
    const n = 4000, h = 1 / n;
    const f = (s: number) => g(mc + (1 - mc) * s * s) * (1 - mc) * 2 * s;
    let acc = f(0) + f(1);
    for (let i = 1; i < n; i++) acc += (i % 2 ? 4 : 2) * f(i * h);
    return below * mc + acc * h / 3;
}

/** The closed-form directional albedo of the coat over the base, per channel. */
function albedoClosed(mu: number, mp: MP): number[] {
    const F = dielectricFresnel(mu, 1 / mp.coatEta);
    return mp.albedo.map((r) => F + (1 - F) * r * (1 - mp.coatFdr) / (1 - r * mp.coatFdr));
}

describe('plastic: the coat\'s internal diffuse reflectance K', () => {
    it('satisfies 1 − D(η) = (1 − D(1/η))/η² to 1e-12', () => {
        for (const eta of [0.6, 0.8, 1.2, 1.5, 2, 2.5]) {
            const lhs = 1 - diffuseFresnelReflectance(eta);
            const rhs = (1 - diffuseFresnelReflectance(1 / eta)) / (eta * eta);
            expect(Math.abs(lhs - rhs), `η = ${eta}`).toBeLessThan(1e-12);
        }
    });

    it('is 0 at η = 1 and 0.5963457597 at η = 1.5; the derived field is D(coat_eta)', () => {
        expect(diffuseFresnelReflectance(1)).toBeLessThan(1e-15);   // F(μ; 1) = 0 up to rounding
        expect(diffuseFresnelReflectance(1.5)).toBeCloseTo(0.5963457597, 9);
        expect(material([0.5], 1.5).coatFdr).toBe(diffuseFresnelReflectance(1.5));
    });
});

describe('plastic §11.3 consistency (TS twin of plastic.glsl)', () => {
    const N = 1 << 18;
    const COS_BINS = 10, PHI_BINS = 20;
    for (const [albedo, eta] of [[[0.5, 0.5, 0.5], 1.5], [[0.8, 0.5, 0.2], 1.5], [[0.5, 0.5, 0.5], 0.8]] as const) {
        for (const cosO of [0.9, 0.3, 0.05]) {
            it(`R=${albedo} η=${eta} cosθo=${cosO}: histogram with the delta cell matches pdf and P_spec (χ²)`, () => {
                const mp = material([...albedo], eta);
                const wo = dirOf(cosO, 0.4);
                const rand = rng(1234 + Math.round(cosO * 100) + Math.round(eta * 10) + Math.round(albedo[2] * 10));
                const counts = new Float64Array(COS_BINS * PHI_BINS);
                let deltas = 0;
                for (let i = 0; i < N; i++) {
                    const s = plasticSample(wo, mp, rand(), [rand(), rand()]);
                    if (s.delta) { deltas++; continue; }
                    const row = Math.min(COS_BINS - 1, Math.floor(s.wi[2] * COS_BINS));
                    const phi = Math.atan2(s.wi[1], s.wi[0]) + Math.PI;
                    const col = Math.min(PHI_BINS - 1, Math.floor(phi / (2 * Math.PI) * PHI_BINS));
                    counts[row * PHI_BINS + col]++;
                }
                // ∫ over a cell of P_diff·cosθ/π dω = P_diff·(c1² − c0²)/2·Δφ/π, exactly.
                const pDiff = plasticPdf(dirOf(1, 0), wo, mp) * Math.PI;
                let chi2 = 0, cells = 0;
                for (let row = 0; row < COS_BINS; row++) {
                    const c0 = row / COS_BINS, c1 = (row + 1) / COS_BINS;
                    const E = N * pDiff * (c1 * c1 - c0 * c0) / 2 * (2 * Math.PI / PHI_BINS) / Math.PI;
                    for (let col = 0; col < PHI_BINS; col++) {
                        const O = counts[row * PHI_BINS + col];
                        // Total reflection from outside (η < 1, grazing): P_diff = 0, so the
                        // diffuse lobe must never be drawn.
                        if (E === 0) { expect(O).toBe(0); continue; }
                        chi2 += (O - E) ** 2 / E;
                        cells++;
                    }
                }
                const Ed = N * plasticSpecularProb(cosO, mp);
                if (cells === 0) { expect(deltas).toBe(N); return; }
                chi2 += (deltas - Ed) ** 2 / Ed;
                cells++;
                expect(chi2, `χ² = ${chi2.toFixed(1)} over ${cells} cells`).toBeLessThan(chi2Crit(cells - 1));
            });
        }
    }

    it('triple: weight·pdf = eval·cos, pdf(wi) = sample.pdf; delta samples are the mirror with pdf 0', () => {
        const mp = material([0.8, 0.5, 0.2], 1.5);
        const rand = rng(99);
        let diffuse = 0, delta = 0, worstTriple = 0, worstPdf = 0, wrongSide = 0, badDelta = 0;
        for (let i = 0; i < 50000; i++) {
            const below = rand() < 0.5 ? -1 : 1;     // either side of the shading normal
            const wo = dirOf(below * (0.01 + 0.99 * rand()), 2 * Math.PI * rand());
            const s = plasticSample(wo, mp, rand(), [rand(), rand()]);
            if (Math.sign(s.wi[2]) !== Math.sign(wo[2])) wrongSide++;
            if (s.delta) {
                delta++;
                if (s.pdf !== 0 || s.wi[0] !== -wo[0] || s.wi[1] !== -wo[1] || s.wi[2] !== wo[2]) badDelta++;
                continue;
            }
            diffuse++;
            plasticEval(s.wi, wo, mp).forEach((fc, c) => {
                const ref = fc * Math.abs(s.wi[2]);
                worstTriple = Math.max(worstTriple, Math.abs(s.weight[c] * s.pdf - ref) / ref);
            });
            worstPdf = Math.max(worstPdf, Math.abs(plasticPdf(s.wi, wo, mp) - s.pdf) / s.pdf);
        }
        expect(wrongSide).toBe(0);
        expect(badDelta).toBe(0);
        expect(worstTriple).toBeLessThan(1e-12);
        expect(worstPdf).toBeLessThan(1e-12);
        expect(delta).toBeGreaterThan(1000);
        expect(diffuse).toBeGreaterThan(1000);
    });

    it('eval and pdf vanish across the surface', () => {
        const mp = material([0.8, 0.5, 0.2], 1.5);
        expect(plasticEval(dirOf(-0.5, 0), dirOf(0.5, 1), mp)).toEqual([0, 0, 0]);
        expect(plasticPdf(dirOf(-0.5, 0), dirOf(0.5, 1), mp)).toBe(0);
    });

    it('the diffuse lobe is reciprocal', () => {
        const mp = material([0.8, 0.5, 0.2], 1.5);
        const rand = rng(7);
        let worst = 0;
        for (let i = 0; i < 10000; i++) {
            const a = dirOf(rand(), 2 * Math.PI * rand()), b = dirOf(rand(), 2 * Math.PI * rand());
            const fba = plasticEval(b, a, mp);
            plasticEval(a, b, mp).forEach((x, c) => { worst = Math.max(worst, Math.abs(x - fba[c]) / Math.max(1, x)); });
        }
        expect(worst).toBeLessThan(1e-14);
    });
});

describe('plastic energy: the directional albedo A(μ) = F + (1 − F)·R(1 − K)/(1 − R·K)', () => {
    const ALBEDOS = [[1, 1, 1], [0.5, 0.5, 0.5], [0.8, 0.5, 0.2]];

    it('equals F(μ) plus the quadrature of eval·cos, for η = 1.5 and η = 0.8', () => {
        for (const eta of [1.5, 0.8]) {
            // Light from outside sees 1/η; for η < 1 it is totally reflected below μc.
            const mc = eta < 1 ? Math.sqrt(1 - eta * eta) : 0;
            for (const albedo of ALBEDOS) {
                const mp = material(albedo, eta);
                for (const mu of [1, 0.7, 0.3, 0.05]) {
                    const wo = dirOf(mu, 0);
                    const F = dielectricFresnel(mu, 1 / eta);
                    const closed = albedoClosed(mu, mp);
                    albedo.forEach((_, c) => {
                        // f_d depends on wi only through μ_i: ∫ f cos dω = 2π ∫₀¹ f(μ_i)·μ_i dμ_i.
                        const quad = F + 2 * Math.PI * integrateKinked(
                            (m) => plasticEval(dirOf(m, 0), wo, mp)[c] * m, mc, 0);
                        expect(Math.abs(quad - closed[c]), `η=${eta} R=${albedo} μ=${mu} channel ${c}`).toBeLessThan(1e-9);
                    });
                }
            }
        }
    });

    it('equals the mean sample weight (within 3σ); R = 1 gives exactly the furnace value 1', () => {
        for (const albedo of ALBEDOS) {
            const mp = material(albedo, 1.5);
            for (const mu of [1, 0.7, 0.3, 0.05]) {
                const wo = dirOf(mu, 0.3);
                const rand = rng(31 + Math.round(mu * 100));
                const n = 200000;
                const sum = albedo.map(() => 0), sum2 = albedo.map(() => 0);
                for (let i = 0; i < n; i++) {
                    const s = plasticSample(wo, mp, rand(), [rand(), rand()]);
                    s.weight.forEach((w, c) => { sum[c] += w; sum2[c] += w * w; });
                }
                const closed = albedoClosed(mu, mp);
                albedo.forEach((r, c) => {
                    const mean = sum[c] / n;
                    const sigma = Math.sqrt(Math.max(0, sum2[c] / n - mean * mean) / n);
                    expect(Math.abs(mean - closed[c]), `R=${albedo} μ=${mu}: ${mean} vs ${closed[c]} (σ ${sigma})`)
                        .toBeLessThanOrEqual(3 * sigma + 1e-12);
                    if (r === 1) expect(closed[c]).toBeCloseTo(1, 14);
                });
            }
        }
    });

    it('the witness values at μ = 1, η = 1.5: R = 0.5 → 0.316071 (the linear form would read 0.520)', () => {
        const mp = material([0.8, 0.5, 0.2], 1.5);
        const a = albedoClosed(1, mp);
        expect(a[0]).toBeCloseTo(0.632833, 6);
        expect(a[1]).toBeCloseTo(0.316071, 6);
        expect(a[2]).toBeCloseTo(0.127997, 6);
    });
});

describe('plastic at η = 1 is Lambert', () => {
    it('K = 0, P_spec = 0 and f = R/π (up to rounding)', () => {
        const mp = material([0.8, 0.5, 0.2], 1);
        expect(mp.coatFdr).toBeLessThan(1e-15);
        expect(plasticSpecularProb(0.4, mp)).toBeLessThan(1e-15);
        plasticEval(dirOf(0.3, 1), dirOf(0.8, 2), mp).forEach((f, c) => expect(f).toBeCloseTo(mp.albedo[c] / Math.PI, 14));
    });

    it('a black base under an index-matched coat scatters nothing, with no 0/0', () => {
        // F(μ; 1) is 0 or a rounding residue, so either lobe may be chosen; both carry ~0.
        const mp = material([0, 0, 0], 1);
        for (const mu of [1, 0.7, 0.4, 0.1, 0.01]) {
            for (const uc of [0, 0.5, 0.999]) {
                const s = plasticSample(dirOf(mu, 0), mp, uc, [0.3, 0.6]);
                for (const w of s.weight) expect(Number.isFinite(w) && Math.abs(w) < 1e-15, `μ=${mu} uc=${uc}: ${w}`).toBe(true);
            }
        }
    });
});
