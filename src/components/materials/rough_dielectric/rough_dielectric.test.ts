// The §11.3 pdf–histogram harness, ROUGH DIELECTRIC instance (fable-rough-dielectric §2;
// the pattern is ggx.test.ts's, extended to a two-lobe BSDF over the whole SPHERE).
// This TS twin is a line-for-line transcription of rough_dielectric.glsl plus the shared
// machinery it calls (glsl/core/microfacet.glsl, dielectric_fresnel) in the local frame
// (identity Frame; ambient_dot = dot) — change one, change both.
//
// Four checks, each of which has caught a different class of transcription error in
// microfacet transmission historically:
//   1. χ² histogram over the FULL sphere: sampled wi frequencies vs ∫pdf per bin. The
//      bin grid puts an edge at cosθ = 0, because the two lobes meet there with a jump.
//   2. Triple consistency: weight·pdf ≈ eval·|cosθi| per sample, on BOTH lobes — this is
//      what pins the transmission Jacobian (a wrong `denom` shows up here immediately).
//   3. sample.pdf ≡ rough_dielectric_pdf(wi, wo): the sampler/query agreement MIS needs,
//      and the check that the half-vector RECOVERY inverts the sampling construction.
//   4. η²-aware reciprocity: f(wi,wo; η) = η² · f(−wo,−wi; 1/η), the BTDF's true symmetry
//      (the naive f(wi,wo) = f(wo,wi) is FALSE for transmission — asserting it would
//      have forced the η² factor out, which is exactly the F-ETA bug this house names).
//
// Both interface directions are exercised (η = 1/1.5 entering glass, η = 1.5 leaving it,
// where TIR truncates the transmission lobe) — the second is where a missing TIR branch
// or a wrong Fresnel argument shows up.

import { describe, it, expect } from 'vitest';

// ── The twin (local frame: n = +z, wo always in the UPPER hemisphere per §4.1) ──

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];

function microfacetD(h: V3, a: number): number {
    const t = h[2] * h[2] * (a * a - 1.0) + 1.0;
    return (a * a) / (Math.PI * t * t);
}
function microfacetG1(v: V3, a: number): number {
    const c = Math.abs(v[2]);
    return (2.0 * c) / (c + Math.sqrt(a * a + (1.0 - a * a) * c * c));
}
function alphaOf(roughness: number): number {
    return Math.max(1e-3, roughness * roughness);
}
/** dielectric_fresnel: eta = n_i / n_t, cos_i ≥ 0. Returns 1 under TIR. */
function dielectricFresnel(cosI: number, eta: number): number {
    const sin2t = eta * eta * (1.0 - cosI * cosI);
    if (sin2t >= 1.0) return 1.0;
    const cosT = Math.sqrt(1.0 - sin2t);
    const rPar = (cosI - eta * cosT) / (cosI + eta * cosT);
    const rPerp = (eta * cosI - cosT) / (eta * cosI + cosT);
    return 0.5 * (rPar * rPar + rPerp * rPerp);
}

/** rough_dielectric_half — the shared eval/pdf prologue. */
function half(wil: V3, wol: V3, eta: number): V3 | null {
    const etap = wil[2] > 0.0 ? 1.0 : 1.0 / eta;
    let m: V3 = [wil[0] * etap + wol[0], wil[1] * etap + wol[1], wil[2] * etap + wol[2]];
    if (dot(m, m) <= 0.0) return null;
    m = norm(m);
    if (m[2] < 0.0) m = neg(m);
    if (dot(m, wil) * wil[2] < 0.0 || dot(m, wol) * wol[2] < 0.0) return null;
    return m;
}

function evalBsdf(wi: V3, wo: V3, roughness: number, eta: number, tint = 1): number {
    if (wo[2] <= 0.0 || wi[2] === 0.0) return 0.0;
    if (eta === 1.0) return 0.0;
    const m = half(wi, wo, eta);
    if (m === null) return 0.0;
    const a = alphaOf(roughness);
    const cosOm = Math.min(1.0, Math.max(1e-6, Math.abs(dot(wo, m))));
    const F = dielectricFresnel(cosOm, eta);
    const DG = microfacetD(m, a) * microfacetG1(wo, a) * microfacetG1(wi, a);
    if (wi[2] > 0.0) return (DG * F) / (4.0 * wi[2] * wo[2]);
    let denom = dot(wi, m) + dot(wo, m) * eta;
    denom *= denom;
    const ft = DG * (1.0 - F) * Math.abs((dot(wi, m) * dot(wo, m)) / (wi[2] * wo[2] * denom));
    return tint * (ft * eta * eta);
}

function pdfBsdf(wi: V3, wo: V3, roughness: number, eta: number): number {
    if (wo[2] <= 0.0 || wi[2] === 0.0) return 0.0;
    if (eta === 1.0) return 0.0;
    const m = half(wi, wo, eta);
    if (m === null) return 0.0;
    const a = alphaOf(roughness);
    const cosOm = Math.min(1.0, Math.max(1e-6, Math.abs(dot(wo, m))));
    const F = dielectricFresnel(cosOm, eta);
    if (wi[2] > 0.0) return (F * microfacetG1(wo, a) * microfacetD(m, a)) / (4.0 * wo[2]);
    let denom = dot(wi, m) + dot(wo, m) * eta;
    denom *= denom;
    return ((1.0 - F) * microfacetG1(wo, a) * microfacetD(m, a) * cosOm / wo[2])
        * Math.abs(dot(wi, m)) / denom;
}

/** microfacet_sample_vndf (Heitz 2018) — wo must be in the upper hemisphere. */
function sampleVndf(wo: V3, a: number, u1: number, u2: number): V3 {
    const vh = norm([a * wo[0], a * wo[1], wo[2]]);
    const lensq = vh[0] * vh[0] + vh[1] * vh[1];
    const T1: V3 = lensq > 0.0 ? [-vh[1] / Math.sqrt(lensq), vh[0] / Math.sqrt(lensq), 0.0] : [1, 0, 0];
    const T2: V3 = [vh[1] * T1[2] - vh[2] * T1[1], vh[2] * T1[0] - vh[0] * T1[2], vh[0] * T1[1] - vh[1] * T1[0]];
    const rr = Math.sqrt(u1), phi = 2.0 * Math.PI * u2;
    const t1 = rr * Math.cos(phi);
    let t2 = rr * Math.sin(phi);
    const s_ = 0.5 * (1.0 + vh[2]);
    t2 = (1.0 - s_) * Math.sqrt(Math.max(0.0, 1.0 - t1 * t1)) + s_ * t2;
    const tz = Math.sqrt(Math.max(0.0, 1.0 - t1 * t1 - t2 * t2));
    const nh: V3 = [
        t1 * T1[0] + t2 * T2[0] + tz * vh[0],
        t1 * T1[1] + t2 * T2[1] + tz * vh[1],
        t1 * T1[2] + t2 * T2[2] + tz * vh[2],
    ];
    return norm([a * nh[0], a * nh[1], Math.max(1e-6, nh[2])]);
}

interface TwinSample { wi: V3; weight: number; pdf: number; rejected: boolean; delta?: boolean }

function sampleBsdf(wo: V3, roughness: number, eta: number, uc: number, u1: number, u2: number, tint = 1): TwinSample {
    const dead: TwinSample = { wi: wo, weight: 0, pdf: 0, rejected: true };
    if (wo[2] <= 0.0) return dead;
    // Index-matched interface: the delta pass-through (pdf 0 = the delta convention).
    if (eta === 1.0) return { wi: neg(wo), weight: tint, pdf: 0, rejected: false, delta: true };
    const a = alphaOf(roughness);
    const m = sampleVndf(wo, a, u1, u2);
    const cosOm = Math.min(1.0, Math.max(1e-6, dot(wo, m)));
    const F = dielectricFresnel(cosOm, eta);
    if (uc < F) {
        const oh = dot(wo, m);
        const wil: V3 = [2.0 * oh * m[0] - wo[0], 2.0 * oh * m[1] - wo[1], 2.0 * oh * m[2] - wo[2]];
        if (wil[2] <= 0.0) return dead;
        return {
            wi: wil,
            weight: microfacetG1(wil, a),
            pdf: (F * microfacetG1(wo, a) * microfacetD(m, a)) / (4.0 * wo[2]),
            rejected: false,
        };
    }
    const sin2t = eta * eta * (1.0 - cosOm * cosOm);
    const cosT = Math.sqrt(Math.max(0.0, 1.0 - sin2t));
    const k = eta * cosOm - cosT;
    const wil = norm([-eta * wo[0] + k * m[0], -eta * wo[1] + k * m[1], -eta * wo[2] + k * m[2]]);
    if (wil[2] >= 0.0) return dead;
    let denom = dot(wil, m) + dot(wo, m) * eta;
    denom *= denom;
    return {
        wi: wil,
        weight: tint * (microfacetG1(wil, a) * eta * eta),
        pdf: ((1.0 - F) * microfacetG1(wo, a) * microfacetD(m, a) * cosOm / wo[2])
            * Math.abs(dot(wil, m)) / denom,
        rejected: false,
    };
}

// ── Harness plumbing (ggx.test.ts's, over the sphere) ──────────────────────────

/** splitmix32 — deterministic, but with DECORRELATED consecutive draws. ggx.test.ts's
 *  plain LCG is fine for its 2-tuples; this model draws THREE uniforms per sample
 *  (uc, u.x, u.y) and an LCG's consecutive 3-tuples lie on lattice planes (Marsaglia),
 *  which a histogram test is precisely sensitive to. */
function lcg(seed: number) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x9e3779b9) >>> 0;
        let z = s;
        z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
        z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
        return ((z ^ (z >>> 15)) >>> 0) / 4294967296;
    };
}

const PHI_BINS = 24, COS_BINS = 16;      // cosθ ∈ [-1,1]: an EDGE at 0, where the lobes meet

function binOf(wi: V3): number {
    const row = Math.min(COS_BINS - 1, Math.floor(((wi[2] + 1) / 2) * COS_BINS));
    const phi = Math.atan2(wi[1], wi[0]);
    const col = Math.min(PHI_BINS - 1, Math.floor(((phi + Math.PI) / (2 * Math.PI)) * PHI_BINS));
    return row * PHI_BINS + col;
}

function dirOf(cosT: number, phi: number): V3 {
    const s = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    return [s * Math.cos(phi), s * Math.sin(phi), cosT];
}

/** ∫ pdf dω over one (cosθ, φ) cell — adaptive midpoint with one-level lookahead, over a
 *  FORCED minimum subdivision. The minimum is not caution: this pdf is discontinuous
 *  (the two lobes meet at the horizon, and TIR truncates the transmission lobe along a
 *  curve), and near a jump the coarse/fine pair can AGREE spuriously — both landing on
 *  the zero side — so pure adaptivity stops early and systematically under-integrates
 *  (measured: 96.19% vs a fine reference quadrature's 96.714%, which is a 10σ χ² lie at
 *  N = 2¹⁷). Refining to depth 3 unconditionally puts ≥ 64 probes in every cell first. */
const MIN_DEPTH = 3;
function integrateCell(pdf: (wi: V3) => number, c0: number, c1: number, p0: number, p1: number, depth: number): number {
    const area = (c1 - c0) * (p1 - p0);
    const coarse = pdf(dirOf((c0 + c1) / 2, (p0 + p1) / 2)) * area;
    if (depth >= 10) return coarse;
    const cm = (c0 + c1) / 2, pm = (p0 + p1) / 2;
    if (depth < MIN_DEPTH) {
        return (
            integrateCell(pdf, c0, cm, p0, pm, depth + 1) + integrateCell(pdf, cm, c1, p0, pm, depth + 1) +
            integrateCell(pdf, c0, cm, pm, p1, depth + 1) + integrateCell(pdf, cm, c1, pm, p1, depth + 1));
    }
    const fine = (area / 4) * (
        pdf(dirOf((c0 + cm) / 2, (p0 + pm) / 2)) + pdf(dirOf((cm + c1) / 2, (p0 + pm) / 2)) +
        pdf(dirOf((c0 + cm) / 2, (pm + p1) / 2)) + pdf(dirOf((cm + c1) / 2, (pm + p1) / 2)));
    if (Math.abs(fine - coarse) <= 1e-4 * Math.abs(fine) + 1e-12) return fine;
    return (
        integrateCell(pdf, c0, cm, p0, pm, depth + 1) + integrateCell(pdf, cm, c1, p0, pm, depth + 1) +
        integrateCell(pdf, c0, cm, pm, p1, depth + 1) + integrateCell(pdf, cm, c1, pm, p1, depth + 1));
}

/** χ² critical value via Wilson–Hilferty, z = 3.0902 ⇒ p ≈ 0.001. */
function chi2Crit(dof: number): number {
    const z = 3.0902;
    const t = 1 - 2 / (9 * dof) + z * Math.sqrt(2 / (9 * dof));
    return dof * t * t * t;
}

// ── The spec grid, both interface directions ───────────────────────────────────

const INCLINATIONS = [0.9, 0.5, 0.1];
const ROUGHNESSES = [0.1, 0.4, 0.8];
/** η = n_i/n_t: entering glass (dense side ahead) and leaving it (TIR live). */
const ETAS: Array<[string, number]> = [['enter', 1 / 1.5], ['exit', 1.5]];
const N = 1 << 17;

describe('rough dielectric §11.3 pdf–histogram consistency (TS twin of rough_dielectric.glsl)', () => {
    for (const [etaName, eta] of ETAS) {
        for (const cosO of INCLINATIONS) {
            for (const r of ROUGHNESSES) {
                it(`${etaName} cosθo=${cosO} roughness=${r}: histogram matches pdf (χ²), triple + pdf agreement`, () => {
                    const wo = dirOf(cosO, 0);
                    const rand = lcg(987654 + Math.round(cosO * 1000) + Math.round(r * 100) + Math.round(eta * 10));
                    const counts = new Float64Array(PHI_BINS * COS_BINS);
                    let rejects = 0;
                    let worstTriple = 0, worstPdfAgree = 0, transmitted = 0;

                    for (let i = 0; i < N; i++) {
                        const s = sampleBsdf(wo, r, eta, rand(), rand(), rand());
                        if (s.rejected) { rejects++; continue; }
                        if (s.wi[2] < 0) transmitted++;
                        counts[binOf(s.wi)]++;
                        if ((i & 63) === 0) {
                            // The triple, on whichever lobe this sample took.
                            const ev = evalBsdf(s.wi, wo, r, eta) * Math.abs(s.wi[2]);
                            const lhs = s.weight * s.pdf;
                            worstTriple = Math.max(worstTriple, Math.abs(lhs - ev) / Math.max(ev, 1e-12));
                            const q = pdfBsdf(s.wi, wo, r, eta);
                            worstPdfAgree = Math.max(worstPdfAgree, Math.abs(q - s.pdf) / Math.max(s.pdf, 1e-12));
                        }
                    }

                    expect(worstTriple).toBeLessThan(1e-4);
                    expect(worstPdfAgree).toBeLessThan(1e-3);
                    // Both lobes must actually fire, or the χ² is testing half a model.
                    // (Under 'exit' at cosθo = 0.1 TIR is total — transmission is then
                    // correctly absent, which the Fresnel branch already guarantees.)
                    const tirTotal = etaName === 'exit' && dielectricFresnel(cosO, eta) === 1;
                    if (!tirTotal) expect(transmitted).toBeGreaterThan(0);

                    const pdfW = (wi: V3) => pdfBsdf(wi, wo, r, eta);
                    let chi2 = 0, cells = 0, pooledE = 0, pooledO = 0, totalE = 0;
                    for (let row = 0; row < COS_BINS; row++) {
                        for (let col = 0; col < PHI_BINS; col++) {
                            const E = N * integrateCell(pdfW,
                                -1 + (2 * row) / COS_BINS, -1 + (2 * (row + 1)) / COS_BINS,
                                -Math.PI + (col * 2 * Math.PI) / PHI_BINS,
                                -Math.PI + ((col + 1) * 2 * Math.PI) / PHI_BINS, 0);
                            totalE += E;
                            const O = counts[row * PHI_BINS + col];
                            if (E < 5) { pooledE += E; pooledO += O; continue; }
                            chi2 += ((O - E) * (O - E)) / E;
                            cells++;
                        }
                    }
                    const rejectE = Math.max(0, N - totalE);
                    pooledE += rejectE < 5 ? rejectE : 0;
                    pooledO += rejectE < 5 ? rejects : 0;
                    if (rejectE >= 5) { chi2 += ((rejects - rejectE) ** 2) / rejectE; cells++; }
                    if (pooledE >= 5) { chi2 += ((pooledO - pooledE) ** 2) / pooledE; cells++; }
                    expect(chi2, `χ²=${chi2.toFixed(1)} over ${cells} cells (crit ${chi2Crit(cells - 1).toFixed(1)})`)
                        .toBeLessThan(chi2Crit(cells - 1));
                });
            }
        }
    }

    it('η²-aware reciprocity: f(wi,wo; η) = η²·f(−wo,−wi; 1/η)', () => {
        // The BTDF is reciprocal only up to the radiance-compression factor. Swapping the
        // roles means viewing the SAME interface from the other side: wo' = −wi (now
        // upper), wi' = −wo (now lower), and the relative index inverts.
        const rand = lcg(31337);
        let checked = 0;
        for (let i = 0; i < 8000; i++) {
            const wo = dirOf(0.05 + 0.94 * rand(), 2 * Math.PI * rand());
            const wi = dirOf(-(0.05 + 0.94 * rand()), 2 * Math.PI * rand());   // below: transmission
            const r = 0.05 + 0.9 * rand();
            const eta = 1 / 1.5;
            const f = evalBsdf(wi, wo, r, eta);
            if (f <= 0) continue;
            const g = evalBsdf(neg(wo), neg(wi), r, 1 / eta);
            expect(Math.abs(f - eta * eta * g)).toBeLessThan(1e-9 * Math.max(1, f));
            checked++;
        }
        expect(checked).toBeGreaterThan(1000);
    });

    it('index-matched interface (η = 1): the BSDF is exactly the delta pass-through', () => {
        // At η = 1 the refracted direction is −wo for every microfacet and F = 0, so all the
        // mass sits on one direction. The microfacet sampling branch reaches that direction
        // with an infinite pdf: the Jacobian's denominator (wi·m + η wo·m)² vanishes. Under
        // MIS that became ∞/∞ = NaN and poisoned pixels (thin rough-glass sheets, glass in
        // index-matched glass). The fix treats it as a delta sample; this pins BOTH halves
        // of that: every sample is the pass-through, and eval/pdf are zero everywhere, so
        // the delta sample is the complete BSDF (nothing is lost or double-counted).
        const rand = lcg(2718);
        for (let i = 0; i < 2000; i++) {
            const wo = dirOf(0.02 + 0.97 * rand(), 2 * Math.PI * rand());
            const r = 0.05 + 0.9 * rand();
            const s = sampleBsdf(wo, r, 1.0, rand(), rand(), rand(), 0.8);
            expect(s.delta).toBe(true);
            expect(s.wi).toEqual(neg(wo));
            expect(s.weight).toBe(0.8);
            expect(s.pdf).toBe(0);
            const wi = dirOf(-1 + 2 * rand(), 2 * Math.PI * rand());
            expect(evalBsdf(wi, wo, r, 1.0)).toBe(0);
            expect(pdfBsdf(wi, wo, r, 1.0)).toBe(0);
        }
    });

    it('reflection lobe is plainly reciprocal (no η factor on that side)', () => {
        const rand = lcg(24680);
        for (let i = 0; i < 2000; i++) {
            const a = dirOf(0.05 + 0.94 * rand(), 2 * Math.PI * rand());
            const b = dirOf(0.05 + 0.94 * rand(), 2 * Math.PI * rand());
            const r = 0.05 + 0.9 * rand();
            const f = evalBsdf(a, b, r, 1 / 1.5), g = evalBsdf(b, a, r, 1 / 1.5);
            expect(Math.abs(f - g)).toBeLessThan(1e-9 * Math.max(1, f));
        }
    });

    it('eval COVERS the sampler support (the NEE-side check the triple cannot make)', () => {
        // The triple (weight·pdf = eval·|cos|) only ever visits directions the sampler
        // produced, so an eval that is wrongly ZERO somewhere the sampler can reach passes
        // it. NEE evaluates eval at LIGHT-chosen directions, so that hole would be a
        // one-sided energy loss visible only in scenes where a light sits across the
        // interface. Compare the two integrals of the SAME quantity:
        //   (A) ∫f|cos|dω by BSDF sampling = mean weight;  (B) the same by quadrature of eval.
        // Roughness is kept ≥ 0.3 deliberately: below that the lobe is narrower than a
        // quadrature cell and (B) under-resolves — the disagreement would be my grid, not
        // the model (measured: 19% at r = 0.1, 0.05% at r = 0.3 on the same code).
        for (const [name, eta] of [['enter', 1 / 1.5], ['exit', 1.5]] as const) {
            for (const cosO of [0.9, 0.5, 0.2]) {
                for (const r of [0.3, 0.6]) {
                    const wo = dirOf(cosO, 0);
                    const rand = lcg(4242);
                    let sw = 0;
                    const N = 1 << 16;
                    for (let i = 0; i < N; i++) {
                        const s = sampleBsdf(wo, r, eta, rand(), rand(), rand());
                        if (!s.rejected) sw += s.weight;
                    }
                    const A = sw / N;
                    const NC = 500, NP = 250;
                    let B = 0;
                    for (let i = 0; i < NC; i++) {
                        const c = -1 + (2 * (i + 0.5)) / NC;
                        let row = 0;
                        for (let j = 0; j < NP; j++) {
                            row += evalBsdf(dirOf(c, -Math.PI + (2 * Math.PI * (j + 0.5)) / NP), wo, r, eta) * Math.abs(c);
                        }
                        B += row * (2 / NC) * ((2 * Math.PI) / NP);
                    }
                    expect(Math.abs(A - B) / A, `${name} cosθo=${cosO} r=${r}: sampling ${A.toFixed(5)} vs eval quadrature ${B.toFixed(5)}`)
                        .toBeLessThan(0.01);
                }
            }
        }
    });

    it('W-ENERGY, CPU side: the ENERGY albedo is ≤ 1 and falls with roughness', () => {
        // The §6 truncation, quantified without a GPU — and precisely the table a
        // Turquin-style compensation would need. The furnace WITNESS measures a whole
        // sphere (many interfaces chained, plus TIR); this measures ONE interaction,
        // which is where the loss is generated. Recorded curve: rough_dielectric.md.
        //
        // MEASURE MATTERS. ∫f|cos|dω in the RADIANCE measure is not the energy fraction:
        // the transmission lobe carries η², which is a change of basic radiance, not a
        // loss (entering glass it reads ≈ 0.47 for a LOSSLESS interface, and leaving it
        // exceeds 1). Undo it on the transmitted part and the physical statement appears:
        // A ≤ 1, exactly 1 in the smooth limit, monotone in roughness on BOTH sides. The
        // radiance-measure quantity is NOT monotone on the exit side — roughness lets
        // light escape TIR, so it rises — which is why asserting on it would be asserting
        // on an artifact of the measure.
        for (const [name, eta] of [['enter', 1 / 1.5], ['exit', 1.5]] as const) {
            for (const cosO of [0.95, 0.7, 0.4, 0.15]) {
                let prev = Infinity;
                for (const r of [0.05, 0.2, 0.5, 0.7]) {
                    const wo = dirOf(cosO, 0);
                    const rand = lcg(777);
                    let R = 0, T = 0;
                    const N = 1 << 16;
                    for (let i = 0; i < N; i++) {
                        const s = sampleBsdf(wo, r, eta, rand(), rand(), rand());
                        if (s.rejected) continue;
                        if (s.wi[2] > 0) R += s.weight; else T += s.weight;
                    }
                    const A = (R + T / (eta * eta)) / N;
                    expect(A, `${name} cosθo=${cosO} r=${r}: energy albedo ${A.toFixed(4)} — a microfacet BSDF may never GAIN energy`)
                        .toBeLessThan(1.002);
                    expect(A, `${name} cosθo=${cosO}: the loss must grow with roughness (r=${r}, A=${A.toFixed(4)})`)
                        .toBeLessThan(prev * 1.002);
                    prev = A;
                }
            }
        }
    });

    it('the smooth limit concentrates: mean |wi − specular direction| shrinks with roughness', () => {
        // Not a witness (that is W-SMOOTH-LIMIT on the GPU) — the twin's cheap guard that
        // the α floor still produces a near-specular lobe rather than a degenerate one.
        const wo = dirOf(0.8, 0);
        const eta = 1 / 1.5;
        const spread = (r: number) => {
            const rand = lcg(555);
            let sum = 0, n = 0;
            for (let i = 0; i < 20000; i++) {
                const s = sampleBsdf(wo, r, eta, rand(), rand(), rand());
                if (s.rejected || s.wi[2] < 0) continue;      // reflection lobe only
                const mirrorDir: V3 = [-wo[0], -wo[1], wo[2]];
                sum += Math.hypot(s.wi[0] - mirrorDir[0], s.wi[1] - mirrorDir[1], s.wi[2] - mirrorDir[2]);
                n++;
            }
            return sum / Math.max(n, 1);
        };
        expect(spread(0.02)).toBeLessThan(spread(0.2));
        expect(spread(0.2)).toBeLessThan(spread(0.6));
    });
});
