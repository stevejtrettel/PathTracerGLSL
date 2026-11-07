// TS twin of glsl/core/shading_normal.glsl (bump mapping), line for line, over twins of the
// Lambert (lambert.glsl) and GGX (ggx.glsl with f0 = 1, F ≡ 1; microfacet.glsl's D, G1 and
// VNDF) models — change one, change both. World frame: the true surface normal ng = +z; the
// base shading frame is ambient_frame(ng) (euclidean.glsl). Checks:
//   1. flip guarantee: wo above the base normal ⇒ wo above the shading normal, both σ;
//   2. χ² of the masked sampler against the masked pdf (with a rejected cell), the triple
//      weight·pdf = f·|cos| and sample.pdf = pdf, for Lambert and GGX;
//   3. directional albedo ≤ 1 under perturbation (Lambert ρ = 1, GGX f0 = 1);
//   4. estimator equality: BSDF, uniform-sphere NEE and power-MIS estimates of a tilted Lambert
//      plane under a unit sky, with radiance 2 below the surface, all give ρ(1 + cos θ)/2,
//      flipped or not; without the mask or the flip they read the values bump-tilt names;
//   5. the σ rule: the same surface seen from the other side has the opposite shading normal;
//   6. the finite-difference error law the README states, in float32.
import { describe, it, expect } from 'vitest';

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: V3): V3 => mul(a, 1 / Math.hypot(...a));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const NG: V3 = [0, 0, 1];

interface Frame { t: V3; b: V3; n: V3 }

// ── euclidean.glsl ambient_frame ──
function ambientFrame(n: V3): Frame {
    const nn = norm(n);
    let t: V3 = Math.abs(nn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    t = norm(sub(t, mul(nn, dot(t, nn))));
    return { t, b: cross(nn, t), n: nn };
}

// ── shading_normal.glsl ──
/** shading_frame_perturbed: base normal n, σ (+1 when n is the owner's outward normal). */
function shadingFramePerturbed(n: V3, sigma: number, grad: V3, wo: V3): Frame {
    let np = sub(n, mul(grad, sigma));
    if (dot(wo, np) <= 0) np = sub(mul(n, 2 * dot(np, n)), np);
    return ambientFrame(np);
}
/** shading_side_consistent against the true normal ng = +z. */
const sideConsistent = (wi: V3, f: Frame) => dot(wi, NG) * dot(wi, f.n) > 0;

interface Sample { wi: V3; weight: number; pdf: number }
/** shading_masked */
const masked = (s: Sample, f: Frame): Sample => sideConsistent(s.wi, f) ? s : { wi: s.wi, weight: 0, pdf: 0 };

// ── lambert.glsl, in frame f (scalar albedo) ──
function lambertEval(wi: V3, wo: V3, f: Frame, rho: number) { return dot(wi, f.n) * dot(wo, f.n) <= 0 ? 0 : rho / Math.PI; }
function lambertPdf(wi: V3, wo: V3, f: Frame) { return Math.max(0, dot(wi, f.n) * Math.sign(dot(wo, f.n))) / Math.PI; }
function lambertSample(wo: V3, f: Frame, rho: number, u: [number, number]): Sample {
    const n = dot(wo, f.n) < 0 ? mul(f.n, -1) : f.n;
    const ct = Math.sqrt(u[1]), st = Math.sqrt(Math.max(0, 1 - u[1])), ph = 2 * Math.PI * u[0];
    const wi = norm(add(add(mul(f.t, st * Math.cos(ph)), mul(f.b, st * Math.sin(ph))), mul(n, ct)));
    return { wi, weight: rho, pdf: ct / Math.PI };
}

// ── ggx.glsl with f0 = 1 (F ≡ 1), microfacet.glsl D / G1 / VNDF, in frame f ──
const toLocal = (v: V3, f: Frame): V3 => [dot(v, f.t), dot(v, f.b), dot(v, f.n)];
const fromLocal = (v: V3, f: Frame): V3 => add(add(mul(f.t, v[0]), mul(f.b, v[1])), mul(f.n, v[2]));
function D(h: V3, a: number) { const t = h[2] * h[2] * (a * a - 1) + 1; return a * a / (Math.PI * t * t); }
function G1(v: V3, a: number) { const c = Math.abs(v[2]); return 2 * c / (c + Math.sqrt(a * a + (1 - a * a) * c * c)); }
function ggxEval(wi: V3, wo: V3, f: Frame, a: number) {
    const il = toLocal(wi, f), ol = toLocal(wo, f);
    if (il[2] * ol[2] <= 0) return 0;
    const h = norm(add(il, ol));
    return D(h, a) * G1(il, a) * G1(ol, a) / (4 * Math.abs(il[2]) * Math.abs(ol[2]));
}
function ggxPdf(wi: V3, wo: V3, f: Frame, a: number) {
    const il = toLocal(wi, f), ol = toLocal(wo, f);
    if (il[2] * ol[2] <= 0) return 0;
    const h = norm(add(il, ol));
    return G1(ol, a) * D(h, a) / (4 * Math.abs(ol[2]));
}
function vndf(wol: V3, a: number, u: [number, number]): V3 {
    const vh = norm([a * wol[0], a * wol[1], wol[2]]);
    const lensq = vh[0] * vh[0] + vh[1] * vh[1];
    const T1: V3 = lensq > 0 ? mul([-vh[1], vh[0], 0], 1 / Math.sqrt(lensq)) : [1, 0, 0];
    const T2 = cross(vh, T1);
    const r = Math.sqrt(u[0]), phi = 2 * Math.PI * u[1];
    const t1 = r * Math.cos(phi);
    let t2 = r * Math.sin(phi);
    const s = 0.5 * (1 + vh[2]);
    t2 = (1 - s) * Math.sqrt(Math.max(0, 1 - t1 * t1)) + s * t2;
    const nh = add(add(mul(T1, t1), mul(T2, t2)), mul(vh, Math.sqrt(Math.max(0, 1 - t1 * t1 - t2 * t2))));
    return norm([a * nh[0], a * nh[1], Math.max(1e-6, nh[2])]);
}
function ggxSample(wo: V3, f: Frame, a: number, u: [number, number]): Sample {
    let ol = toLocal(wo, f);
    const side = ol[2] < 0 ? -1 : 1;
    ol = mul(ol, side);
    const h = vndf(ol, a, u);
    const il = sub(mul(h, 2 * dot(ol, h)), ol);
    if (il[2] <= 0) return { wi: wo, weight: 0, pdf: 0 };
    return { wi: fromLocal(mul(il, side), f), weight: G1(il, a), pdf: G1(ol, a) * D(h, a) / (4 * Math.abs(ol[2])) };
}

// ── harness ──
function lcg(seed: number) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
}
function uniformSphere(rnd: () => number): V3 {
    const z = 1 - 2 * rnd(), r = Math.sqrt(Math.max(0, 1 - z * z)), ph = 2 * Math.PI * rnd();
    return [r * Math.cos(ph), r * Math.sin(ph), z];
}
const upperHemi = (rnd: () => number): V3 => { const w = uniformSphere(rnd); return [w[0], w[1], Math.abs(w[2])]; };
/** The base frame of the true surface, as the dispatcher builds it. */
const BASE = ambientFrame(NG);
/** Upper χ² quantile at α ≈ 0.001 (Wilson–Hilferty). */
const chi2Crit = (dof: number) => dof * Math.pow(1 - 2 / (9 * dof) + 3.09 * Math.sqrt(2 / (9 * dof)), 3);

describe('shading-normal perturbation (twin of shading_normal.glsl)', () => {
    it('1. the flip puts wo above the shading normal whenever it is above the base normal', () => {
        const rnd = lcg(1);
        let fails = 0, worst = Infinity;
        for (let i = 0; i < 400_000; i++) {
            const wo = upperHemi(rnd);
            const slope = Math.tan(Math.acos(rnd()) * 0.999), ph = 2 * Math.PI * rnd();
            const grad: V3 = [slope * Math.cos(ph), slope * Math.sin(ph), 0];
            const f = shadingFramePerturbed(BASE.n, rnd() < 0.5 ? 1 : -1, grad, wo);
            if (wo[2] <= 0) continue;
            const c = dot(wo, f.n);
            if (c <= 0) fails++;
            worst = Math.min(worst, c / wo[2]);
        }
        expect(fails).toBe(0);
        expect(worst).toBeGreaterThan(0);
    });

    describe('2. masked sampler ≡ masked pdf (χ², triple, pdf agreement)', () => {
        const configs = [
            { wo: norm([0.3, 0.1, 0.9]), slope: 0.8, roughness: 0.5 },
            { wo: norm([0.9, 0.0, 0.25]), slope: 1.5, roughness: 0.3 },   // flipped
        ];
        for (const model of ['lambert', 'ggx'] as const) {
            for (const cfg of configs) {
                it(`${model}, slope ${cfg.slope}`, () => {
                    const rnd = lcg(7);
                    const f = shadingFramePerturbed(BASE.n, 1, [cfg.slope, 0.2, 0], cfg.wo);
                    const a = cfg.roughness * cfg.roughness;
                    const sample = (u: [number, number]) => masked(model === 'lambert' ? lambertSample(cfg.wo, f, 1, u) : ggxSample(cfg.wo, f, a, u), f);
                    const evalM = (wi: V3) => sideConsistent(wi, f) ? (model === 'lambert' ? lambertEval(wi, cfg.wo, f, 1) : ggxEval(wi, cfg.wo, f, a)) : 0;
                    const pdfM = (wi: V3) => sideConsistent(wi, f) ? (model === 'lambert' ? lambertPdf(wi, cfg.wo, f) : ggxPdf(wi, cfg.wo, f, a)) : 0;

                    const NT = 16, NP = 16, N = 200_000;
                    const counts = new Float64Array(NT * NP);
                    let rejected = 0, tripleErr = 0, pdfErr = 0;
                    for (let i = 0; i < N; i++) {
                        const s = sample([rnd(), rnd()]);
                        if (s.pdf <= 0) { rejected++; continue; }
                        const ti = Math.min(NT - 1, Math.floor((1 - s.wi[2]) / 2 * NT));
                        const pi = Math.min(NP - 1, Math.floor((Math.atan2(s.wi[1], s.wi[0]) + Math.PI) / (2 * Math.PI) * NP));
                        counts[ti * NP + pi]++;
                        const fc = evalM(s.wi) * Math.abs(dot(s.wi, f.n));
                        tripleErr = Math.max(tripleErr, Math.abs(s.weight * s.pdf - fc) / fc);
                        pdfErr = Math.max(pdfErr, Math.abs(s.pdf - pdfM(s.wi)) / s.pdf);
                    }
                    let chi2 = 0, cells = 0, expRejected = N;
                    const SUB = 24;
                    for (let ti = 0; ti < NT; ti++) for (let pi = 0; pi < NP; pi++) {
                        let m = 0;
                        for (let i = 0; i < SUB; i++) for (let j = 0; j < SUB; j++) {
                            const ct = 1 - 2 * (ti + (i + 0.5) / SUB) / NT;
                            const ph = 2 * Math.PI * (pi + (j + 0.5) / SUB) / NP - Math.PI;
                            const st = Math.sqrt(Math.max(0, 1 - ct * ct));
                            m += pdfM([st * Math.cos(ph), st * Math.sin(ph), ct]) * (2 / NT / SUB) * (2 * Math.PI / NP / SUB);
                        }
                        const e = m * N;
                        expRejected -= e;
                        if (e > 5) { chi2 += (counts[ti * NP + pi] - e) ** 2 / e; cells++; }
                    }
                    if (expRejected > 5) { chi2 += (rejected - expRejected) ** 2 / expRejected; cells++; }
                    expect(rejected).toBeGreaterThan(0);   // the mask is live in every configuration
                    expect(chi2).toBeLessThan(chi2Crit(cells - 1));
                    expect(tripleErr).toBeLessThan(1e-9);
                    expect(pdfErr).toBeLessThan(1e-9);
                });
            }
        }
    });

    it('3. perturbation gains no energy (directional albedo ≤ 1)', () => {
        const rnd = lcg(3);
        let maxL = 0, maxG = 0;
        for (let k = 0; k < 200; k++) {
            const wo = upperHemi(rnd);
            const slope = 3 * rnd(), ph = 2 * Math.PI * rnd();
            const f = shadingFramePerturbed(BASE.n, 1, [slope * Math.cos(ph), slope * Math.sin(ph), 0], wo);
            const a = Math.max(1e-3, (0.05 + 0.9 * rnd()) ** 2);
            let sumL = 0, sumG = 0;
            const N = 4000;
            for (let i = 0; i < N; i++) {
                sumL += masked(lambertSample(wo, f, 1, [rnd(), rnd()]), f).weight;
                sumG += masked(ggxSample(wo, f, a, [rnd(), rnd()]), f).weight;
            }
            maxL = Math.max(maxL, sumL / N);
            maxG = Math.max(maxG, sumG / N);
        }
        expect(maxL).toBeLessThanOrEqual(1 + 1e-12);
        expect(maxG).toBeLessThanOrEqual(1 + 1e-12);
    });

    describe('4. BSDF, NEE and MIS estimates of the tilted plane', () => {
        // A unit sky above the surface and radiance L_BELOW below it, the way the bump-tilt
        // witness lays it out. The masked BSDF never reaches below the surface, so all three
        // estimators read the lune ρ(1 + cos θ)/2 whatever L_BELOW is. Without the mask the
        // lobe's directions below ng add ρ·L_BELOW·(1 − cos θ)/2; without the flip, a view
        // below n' gets the antipodal lune, all of it below the surface: ρ·L_BELOW·(1 + cos θ)/2.
        const rho = 0.4, slope = 1, L_BELOW = 2;
        const cosT = 1 / Math.sqrt(1 + slope * slope);
        const lune = rho * (1 + cosT) / 2;
        const grad: V3 = [slope, 0, 0];
        // Unflipped and flipped views (wo·(ng − grad) > 0 and ≤ 0).
        const views: V3[] = [norm([0, 0, 1]), norm([0.95, 0, 0.3]), norm([-0.9, 0.2, 0.4]), norm([0.6, -0.6, 0.2])];
        const flippedView = (wo: V3) => dot(wo, sub(NG, grad)) <= 0;
        const radiance = (wi: V3) => wi[2] > 0 ? 1 : L_BELOW;
        const pl = 1 / (4 * Math.PI);                  // uniform-sphere sky sampling

        /** The three estimates at view wo; `mask: false` / `flip: false` remove one step. */
        function estimates(wo: V3, seed: number, opts = { mask: true, flip: true }) {
            const f = opts.flip ? shadingFramePerturbed(BASE.n, 1, grad, wo) : ambientFrame(sub(BASE.n, grad));
            const keep = (wi: V3) => !opts.mask || sideConsistent(wi, f);
            const rnd = lcg(seed);
            const N = 200_000;
            let bsdf = 0, nee = 0, mis = 0;
            for (let i = 0; i < N; i++) {
                const s0 = lambertSample(wo, f, rho, [rnd(), rnd()]);
                const s = keep(s0.wi) ? s0 : { ...s0, weight: 0, pdf: 0 };
                if (s.weight > 0) {
                    bsdf += s.weight * radiance(s.wi);
                    // NEE samples the sky only (the region below is not a light): MIS weighs
                    // the BSDF hit by the power heuristic above the surface, by 1 below it.
                    mis += s.weight * radiance(s.wi) * (s.wi[2] > 0 ? s.pdf * s.pdf / (s.pdf * s.pdf + pl * pl) : 1);
                }
                const wi = uniformSphere(rnd);
                const fe = keep(wi) ? lambertEval(wi, wo, f, rho) : 0;
                if (fe > 0 && wi[2] > 0) {
                    const contrib = fe * Math.abs(dot(wi, f.n)) / pl;
                    const pb = lambertPdf(wi, wo, f);
                    nee += contrib;
                    mis += contrib * (pl * pl / (pl * pl + pb * pb));
                }
                // NEE's below-surface share arrives on BSDF rays (the region is path-found).
                if (s.weight > 0 && s.wi[2] <= 0) nee += s.weight * radiance(s.wi);
            }
            return { bsdf: bsdf / N, nee: nee / N, mis: mis / N };
        }

        it('agree with the lune ρ(1 + cos θ)/2, flipped or not', () => {
            expect(views.map(flippedView)).toEqual([false, true, false, true]);
            views.forEach((wo, k) => {
                const e = estimates(wo, 11 + k);
                expect(Math.abs(e.bsdf - lune)).toBeLessThan(0.003);
                expect(Math.abs(e.nee - lune)).toBeLessThan(0.006);
                expect(Math.abs(e.mis - lune)).toBeLessThan(0.003);
            });
        });

        it('read the stated failure values without the mask and without the flip', () => {
            const noMask = lune + rho * L_BELOW * (1 - cosT) / 2;
            const noFlip = lune * L_BELOW;
            views.forEach((wo, k) => {
                const m = estimates(wo, 21 + k, { mask: false, flip: true });
                for (const v of [m.bsdf, m.nee, m.mis]) expect(Math.abs(v - noMask)).toBeLessThan(0.008);
                if (!flippedView(wo)) return;
                const n = estimates(wo, 31 + k, { mask: true, flip: false });
                for (const v of [n.bsdf, n.nee, n.mis]) expect(Math.abs(v - noFlip)).toBeLessThan(0.008);
            });
        });
    });

    it('5. σ: the surface seen from the other side has the opposite shading normal', () => {
        const rnd = lcg(5);
        for (let i = 0; i < 10_000; i++) {
            const wo = uniformSphere(rnd);
            const grad: V3 = [3 * rnd() - 1.5, 3 * rnd() - 1.5, 0];
            const front = shadingFramePerturbed(BASE.n, 1, grad, wo);
            const back = shadingFramePerturbed(mul(BASE.n, -1), -1, grad, mul(wo, -1));
            for (let c = 0; c < 3; c++) expect(back.n[c]).toBeCloseTo(-front.n[c], 12);
        }
    });

    it('6. the finite-difference error law: (step/ℓ)²/2 + 2·|p|·2⁻²⁴/step, relative to max|∇h|', () => {
        const f32 = Math.fround;
        // h = A·sin(kx)·sin(ky)·sin(kz): features of size ℓ = 1/k.
        const A = 0.02, k = 40, ell = 1 / k;
        const h = (p: V3) => f32(A * f32(Math.sin(f32(k * p[0]))) * f32(Math.sin(f32(k * p[1]))) * f32(Math.sin(f32(k * p[2]))));
        const grad = (p: V3): V3 => [
            A * k * Math.cos(k * p[0]) * Math.sin(k * p[1]) * Math.sin(k * p[2]),
            A * k * Math.sin(k * p[0]) * Math.cos(k * p[1]) * Math.sin(k * p[2]),
            A * k * Math.sin(k * p[0]) * Math.sin(k * p[1]) * Math.cos(k * p[2]),
        ];
        const geodesic = (p: V3, d: V3, t: number): V3 => [f32(p[0] + f32(d[0] * t)), f32(p[1] + f32(d[1] * t)), f32(p[2] + f32(d[2] * t))];
        // bump_surface_gradient in float32
        const fd = (p: V3, F: Frame, step: number): V3 => {
            const dt = f32(h(geodesic(p, F.t, step)) - h(geodesic(p, F.t, -step)));
            const db = f32(h(geodesic(p, F.b, step)) - h(geodesic(p, F.b, -step)));
            const s = f32(0.5 / step);
            return [f32(f32(dt * F.t[0] + db * F.b[0]) * s), f32(f32(dt * F.t[1] + db * F.b[1]) * s), f32(f32(dt * F.t[2] + db * F.b[2]) * s)];
        };
        const law = (step: number, pmax: number) => (step / ell) ** 2 / 2 + 2 * pmax * 2 ** -24 / step;
        const rnd = lcg(9);
        for (const pmax of [1, 10]) {
            for (const step of [1e-2, 1e-3, 3e-4, 1e-5]) {
                let worst = 0;
                for (let i = 0; i < 20_000; i++) {
                    const p = mul([2 * rnd() - 1, 2 * rnd() - 1, 2 * rnd() - 1], pmax).map(f32) as V3;
                    const F = ambientFrame(upperHemi(rnd));
                    const g = grad(p), e = fd(p, F, step);
                    const et = dot(e, F.t) - dot(g, F.t), eb = dot(e, F.b) - dot(g, F.b);
                    worst = Math.max(worst, Math.hypot(et, eb) / (A * k));
                }
                expect(worst, `|p| ≤ ${pmax}, step ${step}`).toBeLessThan(law(step, pmax));
                expect(worst, `|p| ≤ ${pmax}, step ${step}: the law is tight`).toBeGreaterThan(law(step, pmax) / 4);
            }
        }
    });
});
