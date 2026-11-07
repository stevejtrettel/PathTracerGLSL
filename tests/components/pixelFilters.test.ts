// TS twins of the pixel filters (components/pixel: box.glsl, gaussian.glsl), line-for-line
// transcriptions; change one, change both. A filter places the sub-pixel sample by warping xi, so the kernel
// h(u) the pixel integrates IS the density of the warp. These tests check that density
// against the stated kernel by χ² over a grid of offset cells, so the plain average of the
// samples is the h-weighted pixel value with weight 1. The sample stream is the sampler's:
// [0, 1) on a 2⁻²⁴ grid (components/sampler/README.md).

import { describe, it, expect } from 'vitest';
import { PIXEL_MODELS } from '../../src/components/pixel/index.js';
import { glslDefine } from '../helpers/glslDefine.js';
import { normalCdf } from '../helpers/normalCdf.js';

// ── The twins ──────────────────────────────────────────────────────────────────

function boxOffset(xi: [number, number]): [number, number] {
    return [xi[0] - 0.5, xi[1] - 0.5];
}

const SIGMA = glslDefine(PIXEL_MODELS.gaussian.glsl, 'PIXEL_GAUSSIAN_SIGMA');

function gaussianOffset(xi: [number, number]): [number, number] {
    const r = SIGMA * Math.sqrt(-2.0 * Math.log(1.0 - xi[0]));
    const phi = 2.0 * Math.PI * xi[1];
    return [r * Math.cos(phi), r * Math.sin(phi)];
}

// ── Harness ────────────────────────────────────────────────────────────────────

/** Deterministic mulberry32 reduced to the sampler's 24-bit grid on [0, 1). (Consecutive
 *  outputs of a plain 32-bit LCG lie on a lattice in the plane, which a 2D χ² at this sample
 *  count detects.) */
function stream(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 8) / 16777216;
    };
}

/** χ² critical value via Wilson–Hilferty, z = 3.0902 ⇒ p ≈ 0.001. */
function chi2Crit(dof: number): number {
    const z = 3.0902;
    const t = 1 - 2 / (9 * dof) + z * Math.sqrt(2 / (9 * dof));
    return dof * t * t * t;
}

/**
 * χ² of N warped samples against a separable kernel's cell masses on an n×n grid over
 * [−half, half]², plus one cell for everything outside the grid. `axisMass(a, b)` is the
 * kernel's one-axis mass on [a, b]; the outside cell expects the rest of N, so a kernel that
 * did not integrate to 1 would fail too. Cells expected below 5 are pooled into one cell.
 */
function chi2(warp: (xi: [number, number]) => [number, number], axisMass: (a: number, b: number) => number,
    n: number, half: number, N: number, seed: number) {
    const next = stream(seed);
    const counts = new Float64Array(n * n);
    let outside = 0;
    const cell = (2 * half) / n;
    for (let i = 0; i < N; i++) {
        const [x, y] = warp([next(), next()]);
        const cx = Math.floor((x + half) / cell), cy = Math.floor((y + half) / cell);
        if (cx < 0 || cx >= n || cy < 0 || cy >= n) outside++;
        else counts[cy * n + cx]++;
    }
    let sum = 0, cells = 0, pooledE = 0, pooledO = 0, totalE = 0;
    for (let cy = 0; cy < n; cy++) {
        for (let cx = 0; cx < n; cx++) {
            const E = N * axisMass(-half + cx * cell, -half + (cx + 1) * cell) * axisMass(-half + cy * cell, -half + (cy + 1) * cell);
            const O = counts[cy * n + cx];
            totalE += E;
            if (E < 5) { pooledE += E; pooledO += O; continue; }
            sum += ((O - E) * (O - E)) / E;
            cells++;
        }
    }
    const outsideE = N - totalE;
    pooledE += outsideE; pooledO += outside;
    if (pooledE >= 5) { sum += ((pooledO - pooledE) ** 2) / pooledE; cells++; }
    return { chi2: sum, dof: cells - 1, outside };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('pixel filters: the kernel is the density of the warp', () => {
    it('box: uniform on the unit footprint centered on the pixel', () => {
        const mass = (a: number, b: number) => Math.max(0, Math.min(b, 0.5) - Math.max(a, -0.5));
        const r = chi2(boxOffset, mass, 16, 0.5, 1_000_000, 7);
        expect(r.outside).toBe(0);
        expect(r.chi2, `χ²=${r.chi2.toFixed(1)} / ${r.dof}`).toBeLessThan(chi2Crit(r.dof));
    });

    it('gaussian: isotropic normal with σ = 0.5 px, untruncated', () => {
        expect(SIGMA).toBe(0.5);
        const mass = (a: number, b: number) => normalCdf(b / SIGMA) - normalCdf(a / SIGMA);
        const r = chi2(gaussianOffset, mass, 32, 2, 4_000_000, 11);
        expect(r.chi2, `χ²=${r.chi2.toFixed(1)} / ${r.dof}`).toBeLessThan(chi2Crit(r.dof));
    }, 30_000);

    it('gaussian: a wrong σ fails the same χ² (the test can fail)', () => {
        const mass = (a: number, b: number) => normalCdf(b / 0.45) - normalCdf(a / 0.45);
        const r = chi2(gaussianOffset, mass, 32, 2, 4_000_000, 11);
        expect(r.chi2).toBeGreaterThan(chi2Crit(r.dof));
    }, 30_000);

    it('gaussian: the only truncation is the 24-bit stream, at σ·√(48 ln 2) ≈ 2.884 px', () => {
        const largest = 1 - 2 ** -24;   // the largest value random() returns
        const [x] = gaussianOffset([largest, 0]);
        expect(x).toBeCloseTo(SIGMA * Math.sqrt(48 * Math.LN2), 12);
        expect(x).toBeCloseTo(2.884, 3);
        // ξ = 0 is the center, not a NaN: log(1 − 0) = 0.
        for (const c of gaussianOffset([0, 0.3])) expect(Math.abs(c)).toBe(0);
    });

    it('gaussian: the warp\'s x-marginal past the filter-edge witness offsets is 1 − Φ(d/σ)', () => {
        // The filter-edge witness reads P(d + U > 0) for pixel centers d = −0.5 and −1.5 px from
        // an edge, with U the warp's x-offset, and expects normalCdf(−|d|/σ). First the helper's
        // values; then the warp's own tail fractions against them, each within 4 binomial σ.
        expect(normalCdf(-0.5 / SIGMA)).toBeCloseTo(0.158655, 6);
        expect(normalCdf(-1.5 / SIGMA)).toBeCloseTo(0.001350, 6);
        const N = 1_000_000;
        const next = stream(13);
        let past05 = 0, past15 = 0;
        for (let i = 0; i < N; i++) {
            const [x] = gaussianOffset([next(), next()]);
            if (x > 0.5) past05++;
            if (x > 1.5) past15++;
        }
        for (const [count, d] of [[past05, 0.5], [past15, 1.5]] as const) {
            const p = normalCdf(-d / SIGMA);
            const tol = 4 * Math.sqrt(p * (1 - p) / N);
            expect(Math.abs(count / N - p), `d = ${d}: ${count / N} vs ${p}`).toBeLessThan(tol);
        }
    });
});
