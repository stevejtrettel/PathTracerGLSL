// The TS twin of sheen.glsl, in the local frame (n = +z, identity Frame, ambient_dot = dot),
// line for line: change one, change both. sheen_r comes from the descriptor's own derivation,
// the one definition the shader's mp.sheen_r is computed from.
//
// Checks:
//   1. The fits: E is clamped into [0, 1] (the raw fit dips below 0), its maximum is 0.745, and
//      the GLSL constants are MaterialX's digits.
//   2. The LTC sampler's own density (a⁻¹·|M·w₀|²)²·w_z/π is the density the model evaluates,
//      D = (w_z/π)·(a⁻¹/|M⁻¹·w|²)², and D integrates to 1 over the hemisphere.
//   3. χ² of the full mixture sampler against N·∫pdf per bin, wo on either side and at an
//      arbitrary azimuth.
//   4. The triple: weight·pdf = eval·cos; pdf(sample.wi) = sample.pdf; eval and pdf vanish
//      across the surface.
//   5. Rotating the tangent frame about n changes nothing (the model needs no tangent field).
//   6. Energy: ∫ f·cos dω = W·c·E(μ_o) + (1 − W·E(μ_o))·ρ, by quadrature of eval and by the mean
//      sample weight; with c = ρ every sample weight is ρ exactly (the furnace).
//   7. W = 0 is Lambert.
//   8. The values the sheen-fuzz witness reads.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sheenDescriptor } from './sheen.js';

type V3 = [number, number, number];

/** The material's resolved fields: albedo ρ and sheen_color c per channel, sheen_weight W,
 *  sheen_r (derived from sheen_roughness). */
interface MP { albedo: number[]; sheenColor: number[]; sheenWeight: number; sheenR: number }
function material(albedo: number[], sheenColor: number[], sheenWeight: number, sheenRoughness: number): MP {
    const r = sheenDescriptor.derived!.find((d) => d.name === 'sheen_r')!;
    return { albedo, sheenColor, sheenWeight, sheenR: r.fn({ sheen_roughness: sheenRoughness }) as number };
}

// ── The twin ──

const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

/** The fit to the fuzz lobe's directional albedo, before the clamp. */
function sheenEFit(mu: number, r: number): number {
    const s = r * (0.0206607 + 1.58491 * r) / (0.0379424 + r * (1.32227 + r));
    const m = r * (-0.193854 + r * (-1.14885 + r * (1.7932 - 0.95943 * r * r))) / (0.046391 + r);
    const o = r * (0.000654023 + (-0.0207818 + 0.119681 * r) * r) / (1.26264 + r * (-1.92021 + r));
    const d = (mu - m) / s;
    return Math.exp(-0.5 * d * d) / (s * Math.sqrt(2 * Math.PI)) + o;
}
function sheenE(mu: number, r: number): number {
    return clamp(sheenEFit(mu, r), 0.0, 1.0);
}
function sheenAinv(mu: number, r: number): number {
    return (2.58126 * mu + 0.813703 * r) * r / (1.0 + 0.310327 * mu * mu + 2.60994 * mu * r);
}
function sheenBinv(mu: number, r: number): number {
    return Math.sqrt(1.0 - mu) * (r - 1.0) * r * r * r / (0.0000254053 + 1.71228 * mu - 1.71506 * mu * r + 1.34174 * r * r);
}

interface Lobe { az: [number, number]; a: number; b: number; p: number }

function sheenLobe(wol: V3, mp: MP): Lobe {
    const muO = clamp(wol[2], 1e-6, 1.0);
    const l2 = wol[0] * wol[0] + wol[1] * wol[1];
    const az: [number, number] = l2 > 0.0 ? [wol[0] / Math.sqrt(l2), wol[1] / Math.sqrt(l2)] : [1.0, 0.0];
    return { az, a: sheenAinv(muO, mp.sheenR), b: sheenBinv(muO, mp.sheenR), p: mp.sheenWeight * sheenE(muO, mp.sheenR) };
}

function sheenRatio(wil: V3, l: Lobe): number {
    const w: V3 = [l.az[0] * wil[0] + l.az[1] * wil[1], -l.az[1] * wil[0] + l.az[0] * wil[1], wil[2]];
    const o: V3 = [l.a * w[0] + l.b * w[2], l.a * w[1], w[2]];
    const k = l.a / (o[0] * o[0] + o[1] * o[1] + o[2] * o[2]);
    return k * k;
}

function sheenEval(wi: V3, wo: V3, mp: MP): number[] {
    if (wi[2] * wo[2] <= 0.0) return mp.albedo.map(() => 0);
    const side = wo[2] < 0.0 ? -1.0 : 1.0;
    const wil: V3 = [wi[0] * side, wi[1] * side, wi[2] * side];
    const wol: V3 = [wo[0] * side, wo[1] * side, wo[2] * side];
    const l = sheenLobe(wol, mp);
    const x = l.p * sheenRatio(wil, l), y = 1.0 - l.p;
    return mp.albedo.map((rho, c) => (mp.sheenColor[c] * x + rho * y) * (1.0 / Math.PI));
}

interface Sample { wi: V3; weight: number[]; pdf: number }

function sheenSample(wo: V3, mp: MP, uc: number, u: [number, number]): Sample {
    const side = wo[2] < 0.0 ? -1.0 : 1.0;
    const wol: V3 = [wo[0] * side, wo[1] * side, wo[2] * side];
    const l = sheenLobe(wol, mp);
    const cosT = Math.sqrt(u[1]);
    const sinT = Math.sqrt(Math.max(0.0, 1.0 - u[1]));
    const phi = 2 * Math.PI * u[0];
    let wil: V3 = [sinT * Math.cos(phi), sinT * Math.sin(phi), cosT];
    if (uc < l.p) {
        const v: V3 = [(wil[0] - wil[2] * l.b) / l.a, wil[1] / l.a, wil[2]];
        const n = Math.hypot(v[0], v[1], v[2]);
        const w: V3 = [v[0] / n, v[1] / n, v[2] / n];
        wil = [l.az[0] * w[0] - l.az[1] * w[1], l.az[1] * w[0] + l.az[0] * w[1], w[2]];
    }
    const x = l.p * sheenRatio(wil, l), y = 1.0 - l.p;
    return {
        wi: [wil[0] * side, wil[1] * side, wil[2] * side],
        weight: mp.albedo.map((rho, c) => (mp.sheenColor[c] * x + rho * y) / (x + y)),
        pdf: wil[2] * (x + y) * (1.0 / Math.PI),
    };
}

function sheenPdf(wi: V3, wo: V3, mp: MP): number {
    if (wi[2] * wo[2] <= 0.0) return 0.0;
    const side = wo[2] < 0.0 ? -1.0 : 1.0;
    const wil: V3 = [wi[0] * side, wi[1] * side, wi[2] * side];
    const wol: V3 = [wo[0] * side, wo[1] * side, wo[2] * side];
    const l = sheenLobe(wol, mp);
    return wil[2] * (l.p * sheenRatio(wil, l) + 1.0 - l.p) * (1.0 / Math.PI);
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

/** ∫ g dω over the cell cosθ ∈ [c0, c1], φ ∈ [f0, f1] by an m×m midpoint rule (dω = dcosθ dφ). */
function cellIntegral(g: (w: V3) => number, c0: number, c1: number, f0: number, f1: number, m: number): number {
    let acc = 0;
    for (let i = 0; i < m; i++) {
        const c = c0 + (c1 - c0) * (i + 0.5) / m;
        for (let j = 0; j < m; j++) acc += g(dirOf(c, f0 + (f1 - f0) * (j + 0.5) / m));
    }
    return acc * (c1 - c0) * (f1 - f0) / (m * m);
}

/** The fuzz lobe's density D = (w_z/π)·g alone, for wo in the upper hemisphere. */
function fuzzD(wi: V3, wo: V3, r: number): number {
    if (wi[2] <= 0) return 0;
    const l = sheenLobe(wo, material([0], [1], 1, r));
    return wi[2] / Math.PI * sheenRatio(wi, l);
}

/** ∫ g dω over the hemisphere, per component, in (cosθ, φ) with cosθ = 1 − t², which resolves
 *  grazing lobes; n×n midpoints. */
function hemisphereIntegral(g: (w: V3) => number[], n: number): number[] {
    let acc: number[] = [];
    for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const c = 1 - t * t;
        for (let j = 0; j < n; j++) {
            const v = g(dirOf(c, 2 * Math.PI * (j + 0.5) / n));
            if (acc.length === 0) acc = v.map(() => 0);
            v.forEach((x, k) => { acc[k] += x * 2 * t; });
        }
    }
    return acc.map((x) => x * (2 * Math.PI) / (n * n));
}

describe('sheen: the fits (MaterialX mx_microfacet_sheen.glsl, Zeltner et al. 2022)', () => {
    it('E is clamped into [0, 1]: the raw fit dips below 0, and its maximum is 0.745', () => {
        let rawMin = Infinity, max = -Infinity, min = Infinity;
        for (let i = 0; i <= 50; i++) {
            for (let j = 0; j < 50; j++) {
                const mu = i / 50, r = 0.01 + 0.99 * j / 49;
                rawMin = Math.min(rawMin, sheenEFit(mu, r));
                const e = sheenE(mu, r);
                min = Math.min(min, e);
                max = Math.max(max, e);
            }
        }
        expect(rawMin).toBeLessThan(0);
        expect(rawMin).toBeGreaterThan(-1e-4);
        expect(min).toBe(0);
        expect(max).toBeGreaterThan(0.74);
        expect(max).toBeLessThan(0.75);
    });

    it('a⁻¹ > 0 and the denominators stay positive over μ ∈ [0, 1], r ∈ [0.01, 1]', () => {
        for (let i = 0; i <= 100; i++) {
            for (let j = 0; j <= 99; j++) {
                const mu = i / 100, r = 0.01 + 0.99 * j / 99;
                expect(sheenAinv(mu, r)).toBeGreaterThan(0);
                expect(0.0000254053 + 1.71228 * mu - 1.71506 * mu * r + 1.34174 * r * r).toBeGreaterThan(0);
                expect(Number.isFinite(sheenBinv(mu, r))).toBe(true);
            }
        }
    });

    it('sheen.glsl carries the MaterialX constants digit for digit', () => {
        const glsl = readFileSync(new URL('./sheen.glsl', import.meta.url), 'utf8');
        const body = (name: string) => {
            const start = glsl.indexOf(`float ${name}(`);
            return glsl.slice(start, glsl.indexOf('\n}', start));
        };
        const literals = (s: string) => (s.match(/\d+\.\d+/g) ?? []).filter((x) => !['0.0', '1.0', '0.5'].includes(x));
        expect(literals(body('sheen_E'))).toEqual([
            '0.0206607', '1.58491', '0.0379424', '1.32227',
            '0.193854', '1.14885', '1.7932', '0.95943', '0.046391',
            '0.000654023', '0.0207818', '0.119681', '1.26264', '1.92021',
        ]);
        expect(literals(body('sheen_ainv'))).toEqual(['2.58126', '0.813703', '0.310327', '2.60994']);
        expect(literals(body('sheen_binv'))).toEqual(['0.0000254053', '1.71228', '1.71506', '1.34174']);
    });

    it('sheen_r is sheen_roughness clamped to [0.01, 1], the range of the fits', () => {
        expect(material([0], [0], 1, 0).sheenR).toBe(0.01);
        expect(material([0], [0], 1, 0.5).sheenR).toBe(0.5);
        expect(material([0], [0], 1, 1).sheenR).toBe(1);
    });
});

describe('sheen: the fuzz lobe D', () => {
    const POINTS: [number, number][] = [[1, 0.5], [0.5, 0.5], [0.1, 0.3], [0.9, 0.05], [0.3, 1.0], [0.7, 0.01], [0.05, 0.2]];

    it('the sampler\'s own density (a⁻¹·|M·w₀|²)²·w_z/π equals D at the sampled direction (1e-9)', () => {
        const rand = rng(5);
        let worst = 0;
        for (const [mu, r] of POINTS) {
            const wo = dirOf(mu, 0);
            const l = sheenLobe(wo, material([0], [1], 1, r));
            for (let i = 0; i < 20000; i++) {
                const u = [rand(), rand()];
                const w0 = dirOf(Math.sqrt(u[1]), 2 * Math.PI * u[0]);
                const v: V3 = [(w0[0] - w0[2] * l.b) / l.a, w0[1] / l.a, w0[2]];
                const len2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
                const w: V3 = [v[0] / Math.sqrt(len2), v[1] / Math.sqrt(len2), v[2] / Math.sqrt(len2)];
                const samplerPdf = w[2] / Math.PI * (l.a * len2) ** 2;
                const d = fuzzD(w, wo, r);
                if (d > 0) worst = Math.max(worst, Math.abs(samplerPdf - d) / d);
            }
        }
        expect(worst).toBeLessThan(1e-9);
    });

    it('∫ D dω = 1 over the hemisphere (1e-3)', () => {
        for (const [mu, r] of POINTS.filter(([, r]) => r >= 0.05)) {
            const wo = dirOf(mu, 0);
            expect(Math.abs(hemisphereIntegral((w) => [fuzzD(w, wo, r)], 1000)[0] - 1), `μ_o=${mu} r=${r}`).toBeLessThan(1e-3);
        }
    });
});

describe('sheen §11.3 consistency (TS twin of sheen.glsl)', () => {
    const N = 1 << 18;
    const COS_BINS = 10, PHI_BINS = 20, SUB = 24;
    for (const mu of [1, 0.5, 0.1]) {
        for (const r of [0.05, 0.3, 0.5, 1]) {
            for (const W of [0.3, 1]) {
                it(`μ_o=${mu} r=${r} W=${W}: the mixture histogram matches the pdf (χ²)`, () => {
                    const mp = material([0.5], [1], W, r);
                    const below = mu === 0.5 ? -1 : 1;   // one row of cases with wo below the frame
                    const wo = dirOf(below * mu, 0.7);
                    const rand = rng(4321 + Math.round(mu * 100) * 7 + Math.round(r * 100) * 13 + W * 10);
                    const counts = new Float64Array(COS_BINS * PHI_BINS);
                    let wrongSide = 0;
                    for (let i = 0; i < N; i++) {
                        const s = sheenSample(wo, mp, rand(), [rand(), rand()]);
                        if (s.wi[2] * below <= 0) { wrongSide++; continue; }
                        const c = Math.abs(s.wi[2]);
                        const row = Math.min(COS_BINS - 1, Math.floor(c * COS_BINS));
                        const phi = Math.atan2(s.wi[1], s.wi[0]) + Math.PI;
                        const col = Math.min(PHI_BINS - 1, Math.floor(phi / (2 * Math.PI) * PHI_BINS));
                        counts[row * PHI_BINS + col]++;
                    }
                    expect(wrongSide).toBe(0);
                    let chi2 = 0, cells = 0, pooledO = 0, pooledE = 0, total = 0;
                    const pdfAt = (w: V3) => sheenPdf([w[0], w[1], below * w[2]], wo, mp);
                    for (let row = 0; row < COS_BINS; row++) {
                        for (let col = 0; col < PHI_BINS; col++) {
                            const f0 = -Math.PI + col * 2 * Math.PI / PHI_BINS;
                            const E = N * cellIntegral(pdfAt, row / COS_BINS, (row + 1) / COS_BINS, f0, f0 + 2 * Math.PI / PHI_BINS, SUB);
                            const O = counts[row * PHI_BINS + col];
                            total += E;
                            if (E < 5) { pooledO += O; pooledE += E; continue; }
                            chi2 += (O - E) ** 2 / E;
                            cells++;
                        }
                    }
                    if (pooledE >= 5) { chi2 += (pooledO - pooledE) ** 2 / pooledE; cells++; }
                    expect(Math.abs(total - N) / N, 'the quadrature resolves the pdf').toBeLessThan(2e-3);
                    expect(chi2, `χ² = ${chi2.toFixed(1)} over ${cells} cells`).toBeLessThan(chi2Crit(cells - 1));
                });
            }
        }
    }

    it('triple: weight·pdf = eval·cos and pdf(wi) = sample.pdf, wo on either side', () => {
        const mp = material([0.8, 0.5, 0.2], [1, 0.9, 0.3], 0.8, 0.4);
        const rand = rng(99);
        let worstTriple = 0, worstPdf = 0, wrongSide = 0, fuzzDraws = 0;
        for (let i = 0; i < 50000; i++) {
            const below = rand() < 0.5 ? -1 : 1;
            const wo = dirOf(below * (0.01 + 0.99 * rand()), 2 * Math.PI * rand());
            const uc = rand();
            const s = sheenSample(wo, mp, uc, [rand(), rand()]);
            if (uc < sheenLobe([wo[0] * below, wo[1] * below, wo[2] * below], mp).p) fuzzDraws++;
            if (Math.sign(s.wi[2]) !== Math.sign(wo[2])) { wrongSide++; continue; }
            if (s.pdf === 0) continue;
            sheenEval(s.wi, wo, mp).forEach((fc, c) => {
                const ref = fc * Math.abs(s.wi[2]);
                worstTriple = Math.max(worstTriple, Math.abs(s.weight[c] * s.pdf - ref) / ref);
            });
            worstPdf = Math.max(worstPdf, Math.abs(sheenPdf(s.wi, wo, mp) - s.pdf) / s.pdf);
        }
        expect(wrongSide).toBe(0);
        expect(worstTriple).toBeLessThan(1e-12);
        expect(worstPdf).toBeLessThan(1e-12);
        expect(fuzzDraws).toBeGreaterThan(1000);
    });

    it('eval and pdf vanish across the surface', () => {
        const mp = material([0.8, 0.5, 0.2], [1, 1, 1], 1, 0.5);
        expect(sheenEval(dirOf(-0.5, 0), dirOf(0.5, 1), mp)).toEqual([0, 0, 0]);
        expect(sheenPdf(dirOf(-0.5, 0), dirOf(0.5, 1), mp)).toBe(0);
        expect(sheenEval(dirOf(0.5, 0), dirOf(-0.5, 1), mp)).toEqual([0, 0, 0]);
    });

    it('rotating the tangent frame about n leaves eval and pdf unchanged (no tangent field needed)', () => {
        const mp = material([0.8, 0.5, 0.2], [1, 0.9, 0.3], 1, 0.3);
        const rand = rng(17);
        let worst = 0;
        for (let i = 0; i < 20000; i++) {
            const wi = dirOf(rand(), 2 * Math.PI * rand()), wo = dirOf(0.02 + 0.98 * rand(), 2 * Math.PI * rand());
            const psi = 2 * Math.PI * rand();
            const rot = (v: V3): V3 => [Math.cos(psi) * v[0] - Math.sin(psi) * v[1], Math.sin(psi) * v[0] + Math.cos(psi) * v[1], v[2]];
            const f = sheenEval(wi, wo, mp), g = sheenEval(rot(wi), rot(wo), mp);
            f.forEach((x, c) => { worst = Math.max(worst, Math.abs(x - g[c]) / Math.max(1e-3, x)); });
            const p = sheenPdf(wi, wo, mp), q = sheenPdf(rot(wi), rot(wo), mp);
            worst = Math.max(worst, Math.abs(p - q) / Math.max(1e-3, p));
        }
        expect(worst).toBeLessThan(1e-9);
    });
});

describe('sheen energy: ∫ f·cos dω = W·c·E(μ_o) + (1 − W·E(μ_o))·ρ', () => {
    const closed = (mu: number, mp: MP) => {
        const p = mp.sheenWeight * sheenE(clamp(mu, 1e-6, 1), mp.sheenR);
        return mp.albedo.map((rho, c) => p * mp.sheenColor[c] + (1 - p) * rho);
    };

    it('by quadrature of eval·cos (1e-3)', () => {
        for (const [W, r] of [[1, 0.5], [0.5, 1], [1, 0.2]]) {
            const mp = material([0.8, 0.5, 0.2], [1, 0.6, 0.1], W, r);
            for (const mu of [1, 0.2]) {
                const wo = dirOf(mu, 0.4);
                const quad = hemisphereIntegral((w) => sheenEval(w, wo, mp).map((f) => f * w[2]), 700);
                closed(mu, mp).forEach((v, c) => {
                    expect(Math.abs(quad[c] - v), `W=${W} r=${r} μ=${mu} channel ${c}`).toBeLessThan(1e-3);
                });
            }
        }
    });

    it('by the mean sample weight (within 3σ)', () => {
        const mp = material([0.8, 0.5, 0.2], [1, 0.6, 0.1], 1, 0.4);
        for (const mu of [1, 0.6, 0.2, 0.05]) {
            const wo = dirOf(mu, 0.3);
            const rand = rng(31 + Math.round(mu * 100));
            const n = 200000;
            const sum = [0, 0, 0], sum2 = [0, 0, 0];
            for (let i = 0; i < n; i++) {
                const s = sheenSample(wo, mp, rand(), [rand(), rand()]);
                s.weight.forEach((w, c) => { sum[c] += w; sum2[c] += w * w; });
            }
            closed(mu, mp).forEach((v, c) => {
                const mean = sum[c] / n;
                const sigma = Math.sqrt(Math.max(0, sum2[c] / n - mean * mean) / n);
                expect(Math.abs(mean - v), `μ=${mu} channel ${c}: ${mean} vs ${v} (σ ${sigma})`).toBeLessThanOrEqual(3 * sigma + 1e-12);
            });
        }
    });

    it('with c = ρ every sample weight is ρ (the furnace has zero variance)', () => {
        const mp = material([0.4, 0.4, 0.4], [0.4, 0.4, 0.4], 1, 0.5);
        const rand = rng(3);
        let worst = 0;
        for (let i = 0; i < 20000; i++) {
            const wo = dirOf((rand() < 0.5 ? -1 : 1) * rand(), 2 * Math.PI * rand());
            for (const w of sheenSample(wo, mp, rand(), [rand(), rand()]).weight) worst = Math.max(worst, Math.abs(w - 0.4));
        }
        expect(worst).toBeLessThan(1e-14);
    });
});

describe('sheen at W = 0 is Lambert', () => {
    it('f = ρ/π, pdf = cos/π, weight = ρ', () => {
        const mp = material([0.8, 0.5, 0.2], [1, 1, 1], 0, 0.5);
        sheenEval(dirOf(0.3, 1), dirOf(0.8, 2), mp).forEach((f, c) => expect(f).toBeCloseTo(mp.albedo[c] / Math.PI, 15));
        expect(sheenPdf(dirOf(0.3, 1), dirOf(0.8, 2), mp)).toBeCloseTo(0.3 / Math.PI, 15);
        expect(sheenSample(dirOf(0.8, 2), mp, 0, [0.3, 0.6]).weight).toEqual(mp.albedo);
    });
});

describe('the values the sheen-fuzz witness reads', () => {
    it('E(0.2, 0.5) = 0.429541, E(0.2, 1) = 0.643234, E(0.5, 1) = 0.495697, E(0.5, 0.7) = 0.307095', () => {
        expect(sheenE(0.2, 0.5)).toBeCloseTo(0.429541, 6);
        expect(sheenE(0.2, 1)).toBeCloseTo(0.643234, 6);
        expect(sheenE(0.5, 1)).toBeCloseTo(0.495697, 6);
        expect(sheenE(0.5, 0.7)).toBeCloseTo(0.307095, 6);
    });
});
