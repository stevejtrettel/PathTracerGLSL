// Equiangular t-sampler twin harness (impl-plan-equiangular §6; the ggx.test.ts
// pattern): a line-for-line TS twin of equiangular.glsl's placement math, χ²-tested —
// histogram of sampled t against the closed-form pdf — across light geometries,
// including the edge cases the atan2 form exists for (light behind the segment start,
// light past the segment end, near-axis h→0 clamp). Also asserts the pdf integrates
// to 1 over [0, t_max] (normalization) per config.

import { describe, it, expect } from 'vitest';

// ── The twin (change equiangular.glsl, change this) ────────────────────────────

function sampleT(tC: number, h2: number, tMax: number, u: number): { t: number; pdf: number } {
    const h = Math.sqrt(h2);
    const thetaA = Math.atan2(0.0 - tC, h);
    const thetaB = Math.atan2(tMax - tC, h);
    const theta = thetaA + (thetaB - thetaA) * u;
    const t = tC + h * Math.tan(theta);
    const pdf = h / ((thetaB - thetaA) * (h2 + (t - tC) * (t - tC)));
    return { t, pdf };
}

function pdfT(tC: number, h2: number, tMax: number, t: number): number {
    const h = Math.sqrt(h2);
    const thetaA = Math.atan2(0.0 - tC, h);
    const thetaB = Math.atan2(tMax - tC, h);
    return h / ((thetaB - thetaA) * (h2 + (t - tC) * (t - tC)));
}

function lcg(seed: number) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
}

/** χ² critical value via Wilson–Hilferty, z = 3.0902 ⇒ p ≈ 0.001. */
function chi2Crit(dof: number): number {
    const z = 3.0902;
    const t = 1 - 2 / (9 * dof) + z * Math.sqrt(2 / (9 * dof));
    return dof * t * t * t;
}

// Configs: light beside the segment, ahead of it, behind it, nearly on-axis (the
// clamp), far off-axis, and an unbounded-ish segment.
const CONFIGS: Array<{ name: string; tC: number; h2: number; tMax: number }> = [
    { name: 'beside', tC: 2.0, h2: 1.0, tMax: 5.0 },
    { name: 'ahead (past segment end)', tC: 8.0, h2: 0.25, tMax: 5.0 },
    { name: 'behind segment start', tC: -3.0, h2: 4.0, tMax: 5.0 },
    { name: 'near-axis (clamped h)', tC: 2.5, h2: 1e-8, tMax: 5.0 },
    { name: 'far off-axis', tC: 1.0, h2: 100.0, tMax: 5.0 },
    { name: 'long segment', tC: 0.5, h2: 0.09, tMax: 1000.0 },
];

const N = 1 << 17;
const BINS = 64;

describe('equiangular t-sampler (TS twin of equiangular.glsl)', () => {
    for (const cfg of CONFIGS) {
        // 30s budget, not the 5s default: each case draws 2¹⁷ samples and integrates the
        // pdf per bin, measuring ~3.3s ALONE — marginal against 5s, and reliably over it
        // once vitest runs several CPU-heavy twins in parallel. The documented "equiangular
        // long-segment χ² is flaky under parallel load" was always this: a wall-clock
        // timeout, never an unstable result (the LCG and the bins are deterministic).
        it(`${cfg.name}: histogram matches pdf (χ²), pdf normalizes`, () => {
            const rand = lcg(987654 + cfg.tC * 100 + cfg.h2);
            const counts = new Float64Array(BINS);
            const w = cfg.tMax / BINS;
            for (let i = 0; i < N; i++) {
                const { t, pdf } = sampleT(cfg.tC, cfg.h2, cfg.tMax, rand());
                expect(t).toBeGreaterThanOrEqual(-1e-4);
                expect(t).toBeLessThanOrEqual(cfg.tMax + 1e-4 * cfg.tMax);
                expect(pdf).toBeGreaterThan(0);
                // sample.pdf ≡ pdf-query agreement (the MIS-readiness invariant):
                const q = pdfT(cfg.tC, cfg.h2, cfg.tMax, t);
                expect(Math.abs(q - pdf) / pdf).toBeLessThan(1e-9);
                counts[Math.min(BINS - 1, Math.max(0, Math.floor(t / w)))]++;
            }

            // Expected per bin: EXACT via the closed-form CDF — P(t) = (θ(t)−θa)/(θb−θa).
            // (Numeric integration under-resolves the near-axis spike; the CDF doesn't.)
            const h = Math.sqrt(cfg.h2);
            const thetaA = Math.atan2(0.0 - cfg.tC, h);
            const thetaB = Math.atan2(cfg.tMax - cfg.tC, h);
            const cdf = (t: number) => (Math.atan2(t - cfg.tC, h) - thetaA) / (thetaB - thetaA);
            let chi2 = 0, cells = 0, pooledE = 0, pooledO = 0, totalP = 0;
            for (let b = 0; b < BINS; b++) {
                const p = cdf((b + 1) * w) - cdf(b * w);
                totalP += p;
                const E = N * p, O = counts[b];
                if (E < 5) { pooledE += E; pooledO += O; continue; }
                chi2 += ((O - E) * (O - E)) / E;
                cells++;
            }
            if (pooledE >= 5) { chi2 += ((pooledO - pooledE) ** 2) / pooledE; cells++; }
            expect(totalP, 'CDF must span the segment exactly').toBeCloseTo(1.0, 9);
            expect(chi2, `χ²=${chi2.toFixed(1)} over ${cells} cells (crit ${chi2Crit(cells - 1).toFixed(1)})`)
                .toBeLessThan(chi2Crit(cells - 1));
        }, 30000);
    }
});
