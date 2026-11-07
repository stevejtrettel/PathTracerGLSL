// The shared TS twin of the GGX reflection lobe (glsl/core/microfacet.glsl: D, Smith G₁, VNDF
// sampling and the F-free lobe microfacet_reflect_eval, _pdf, _sample) in the local frame
// (identity Frame; ambient_dot = dot), and the §11.3 pdf–histogram harness (fable-compiler-contracts
// §11.3, fable-validation-scenes §6 H) that every reflection-only microfacet model's twin test
// runs. Line-for-line transcription of the GLSL: change one, change both.

export type V3 = [number, number, number];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: V3): V3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

export function ggxD(h: V3, a: number): number {
    const t = h[2] * h[2] * (a * a - 1.0) + 1.0;
    return (a * a) / (Math.PI * t * t);
}
export function ggxG1(v: V3, a: number): number {
    const c = Math.abs(v[2]);
    return (2.0 * c) / (c + Math.sqrt(a * a + (1.0 - a * a) * c * c));
}
export function alphaOf(roughness: number): number {
    return Math.max(1e-3, roughness * roughness);
}
// The F-free reflection lobe (glsl/core/microfacet.glsl: microfacet_reflect_eval, _pdf, _sample).
// eval leaves cos_h and cos_o unset when it returns 0; NaN stands for unset here, so a caller
// that reads them without returning first poisons its result.
export interface LobeEval { f: number; cosH: number; cosO: number }
export function reflectEval(wi: V3, wo: V3, a: number): LobeEval {
    if (wi[2] * wo[2] <= 0.0) return { f: 0.0, cosH: NaN, cosO: NaN };
    const h = norm([wi[0] + wo[0], wi[1] + wo[1], wi[2] + wo[2]]);
    return {
        f: ggxD(h, a) * ggxG1(wi, a) * ggxG1(wo, a) / (4.0 * Math.abs(wi[2]) * Math.abs(wo[2])),
        cosH: Math.abs(dot(wo, h)),
        cosO: Math.abs(wo[2]),
    };
}

export function reflectPdf(wi: V3, wo: V3, a: number): number {
    if (wi[2] * wo[2] <= 0.0) return 0.0;
    const h = norm([wi[0] + wo[0], wi[1] + wo[1], wi[2] + wo[2]]);
    return (ggxG1(wo, a) * ggxD(h, a)) / (4.0 * Math.abs(wo[2]));
}

export interface LobeSample { wi: V3; weight: number; pdf: number; cosH: number; cosO: number }

export function reflectSample(woIn: V3, a: number, u1: number, u2: number): LobeSample {
    const side = woIn[2] < 0.0 ? -1.0 : 1.0;
    const wo: V3 = [woIn[0] * side, woIn[1] * side, woIn[2] * side];
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
    const h = norm([a * nh[0], a * nh[1], Math.max(1e-6, nh[2])]);
    const oh = dot(wo, h);
    const wil: V3 = [2.0 * oh * h[0] - wo[0], 2.0 * oh * h[1] - wo[1], 2.0 * oh * h[2] - wo[2]];
    const cosH = Math.abs(oh), cosO = wo[2];
    if (wil[2] <= 0.0) return { wi: woIn, weight: 0, pdf: 0, cosH, cosO };
    return {
        wi: [wil[0] * side, wil[1] * side, wil[2] * side],
        weight: ggxG1(wil, a),
        pdf: (ggxG1(wo, a) * ggxD(h, a)) / (4.0 * Math.abs(wo[2])),
        cosH, cosO,
    };
}


// ── Harness plumbing ───────────────────────────────────────────────────────────

// Deterministic LCG (no Math.random in tests — reproducible failures).
export function lcg(seed: number) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
}

const PHI_BINS = 32, COS_BINS = 16;

export function binOf(wi: V3): number {
    const row = Math.min(COS_BINS - 1, Math.floor(wi[2] * COS_BINS));
    const phi = Math.atan2(wi[1], wi[0]);                       // [-π, π]
    const col = Math.min(PHI_BINS - 1, Math.floor(((phi + Math.PI) / (2 * Math.PI)) * PHI_BINS));
    return row * PHI_BINS + col;
}

export function dirOf(cosT: number, phi: number): V3 {
    const s = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    return [s * Math.cos(phi), s * Math.sin(phi), cosT];
}

/** ∫ pdf dω over one (cosθ, φ) cell — adaptive midpoint with one-level lookahead
 *  (subdivide while coarse and refined disagree): the roughness-0.1 lobe is far
 *  narrower than a bin, so fixed midpoint×Δω would fail the χ² spuriously. */
export function integrateCell(pdf: (wi: V3) => number, c0: number, c1: number, p0: number, p1: number, depth: number): number {
    const area = (c1 - c0) * (p1 - p0);
    const coarse = pdf(dirOf((c0 + c1) / 2, (p0 + p1) / 2)) * area;
    if (depth >= 10) return coarse;
    const cm = (c0 + c1) / 2, pm = (p0 + p1) / 2;
    const fine = (area / 4) * (
        pdf(dirOf((c0 + cm) / 2, (p0 + pm) / 2)) + pdf(dirOf((cm + c1) / 2, (p0 + pm) / 2)) +
        pdf(dirOf((c0 + cm) / 2, (pm + p1) / 2)) + pdf(dirOf((cm + c1) / 2, (pm + p1) / 2)));
    if (Math.abs(fine - coarse) <= 1e-4 * Math.abs(fine) + 1e-12) return fine;
    return (
        integrateCell(pdf, c0, cm, p0, pm, depth + 1) + integrateCell(pdf, cm, c1, p0, pm, depth + 1) +
        integrateCell(pdf, c0, cm, pm, p1, depth + 1) + integrateCell(pdf, cm, c1, pm, p1, depth + 1));
}

/** χ² critical value via Wilson–Hilferty, z = 3.0902 ⇒ p ≈ 0.001. */
export function chi2Crit(dof: number): number {
    const z = 3.0902;
    const t = 1 - 2 / (9 * dof) + z * Math.sqrt(2 / (9 * dof));
    return dof * t * t * t;
}

/** A model's sample, as the harness reads it. */
export interface TwinSample { wi: V3; weight: number; pdf: number; rejected: boolean }

/** The §11.3 checks for one outgoing direction, over n samples of a reflection-only model:
 *  1. χ² histogram: sampled wi frequencies vs ∫pdf over each bin (32×16 hemispherical grid +
 *     a rejected-sample cell; small-E bins pooled). Expected counts use adaptive per-bin
 *     refinement: plain midpoint×Δω under-resolves a roughness-0.1 lobe and fails spuriously.
 *  2. Triple consistency: weight·pdf ≈ eval·|cosθi| per sample (exact algebraically: the VNDF
 *     cancellation), on a deterministic 1-in-64 slice.
 *  3. sample.pdf ≡ pdf(wi, wo), the sampler/query agreement MIS depends on.
 *  sample, evalCos(wi) = eval(wi, wo)·|cos θi| and pdf(wi) = pdf(wi, wo) close over one wo. */
export function samplerConsistency(
    n: number, rand: () => number,
    sample: (u1: number, u2: number) => TwinSample,
    evalCos: (wi: V3) => number,
    pdf: (wi: V3) => number,
): { worstTriple: number; worstPdfAgree: number; chi2: number; crit: number; cells: number } {
    const counts = new Float64Array(PHI_BINS * COS_BINS);
    let rejects = 0;
    let worstTriple = 0, worstPdfAgree = 0;
    for (let i = 0; i < n; i++) {
        const s = sample(rand(), rand());
        if (s.rejected) { rejects++; continue; }
        counts[binOf(s.wi)]++;
        if ((i & 63) === 0) {
            const ev = evalCos(s.wi);
            const lhs = s.weight * s.pdf;
            worstTriple = Math.max(worstTriple, Math.abs(lhs - ev) / Math.max(ev, 1e-12));
            const q = pdf(s.wi);
            worstPdfAgree = Math.max(worstPdfAgree, Math.abs(q - s.pdf) / Math.max(s.pdf, 1e-12));
        }
    }
    let chi2 = 0, cells = 0, pooledE = 0, pooledO = 0, totalE = 0;
    for (let row = 0; row < COS_BINS; row++) {
        for (let col = 0; col < PHI_BINS; col++) {
            const E = n * integrateCell(pdf,
                row / COS_BINS, (row + 1) / COS_BINS,
                -Math.PI + (col * 2 * Math.PI) / PHI_BINS,
                -Math.PI + ((col + 1) * 2 * Math.PI) / PHI_BINS, 0);
            totalE += E;
            const O = counts[row * PHI_BINS + col];
            if (E < 5) { pooledE += E; pooledO += O; continue; }
            chi2 += ((O - E) * (O - E)) / E;
            cells++;
        }
    }
    const rejectE = Math.max(0, n - totalE);
    pooledE += rejectE < 5 ? rejectE : 0;
    pooledO += rejectE < 5 ? rejects : 0;
    if (rejectE >= 5) { chi2 += ((rejects - rejectE) ** 2) / rejectE; cells++; }
    if (pooledE >= 5) { chi2 += ((pooledO - pooledE) ** 2) / pooledE; cells++; }
    return { worstTriple, worstPdfAgree, chi2, crit: chi2Crit(cells - 1), cells };
}
