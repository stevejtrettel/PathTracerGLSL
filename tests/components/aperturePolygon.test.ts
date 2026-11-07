// TS twin of the bladed thin-lens aperture (components/camera/thinlens/thinlens.glsl,
// aperture_polygon), a line-for-line transcription; change one, change both. The thin lens
// samples its pupil uniformly, so the warp's density must be 1/Area over the regular n-gon:
// χ² of the warped samples against the exact area of each grid cell inside the polygon.

import { describe, it, expect } from 'vitest';
import { regularPolygon, clipConvex, polygonArea, type Point2 } from '../helpers/convexPolygon.js';

// ── The twin ───────────────────────────────────────────────────────────────────

function aperturePolygon(xi: [number, number], n: number, rotation: number): [number, number] {
    const sector = Math.floor(xi[0] * n);
    const s = Math.sqrt(xi[0] * n - sector);
    const a = 1.0 - s, b = s * xi[1];
    const halfAngle = Math.PI / n;
    const px = (a + b) * Math.cos(halfAngle), py = (a - b) * Math.sin(halfAngle);
    const angle = rotation + (2.0 * sector - 1.0) * halfAngle;
    const c = Math.cos(angle), sn = Math.sin(angle);
    return [c * px - sn * py, sn * px + c * py];
}

// ── Harness ────────────────────────────────────────────────────────────────────

/** mulberry32 reduced to the sampler's 24-bit grid on [0, 1). */
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

/** Whether p is inside the counterclockwise convex polygon, allowing `eps` outside. */
function inside(poly: Point2[], p: [number, number], eps: number): boolean {
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / len < -eps) return false;
    }
    return true;
}

const CASES: Array<[number, number]> = [[5, 0.37], [6, 0], [6, 1.234], [9, -2.1], [3, 0.5]];

describe('bladed aperture warp (aperture_polygon twin)', () => {
    for (const [n, rotation] of CASES) {
        it(`n = ${n}, rotation ${rotation}: uniform over the n-gon (χ² against exact cell areas)`, () => {
            const poly = regularPolygon(n, rotation);
            const area = polygonArea(poly);
            const grid = 40, N = 1_000_000;
            const counts = new Float64Array(grid * grid);
            const next = stream(1000 + n * 17 + Math.round(rotation * 100));
            let outside = 0;
            for (let i = 0; i < N; i++) {
                const p = aperturePolygon([next(), next()], n, rotation);
                if (!inside(poly, p, 1e-12)) outside++;
                const ix = Math.min(grid - 1, Math.floor((p[0] + 1) / 2 * grid));
                const iy = Math.min(grid - 1, Math.floor((p[1] + 1) / 2 * grid));
                counts[iy * grid + ix]++;
            }
            expect(outside).toBe(0);
            // Expected count per cell = N · area(cell ∩ polygon) / area(polygon); cells expected
            // below 5 are pooled (their total must also match).
            let chi2 = 0, dof = -1, pooledObs = 0, pooledExp = 0, expectedTotal = 0;
            for (let iy = 0; iy < grid; iy++) {
                for (let ix = 0; ix < grid; ix++) {
                    const x0 = -1 + 2 * ix / grid, x1 = x0 + 2 / grid, y0 = -1 + 2 * iy / grid, y1 = y0 + 2 / grid;
                    const cell: Point2[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
                    const e = N * polygonArea(clipConvex(cell, poly)) / area;
                    const o = counts[iy * grid + ix];
                    expectedTotal += e;
                    if (e < 5) { pooledObs += o; pooledExp += e; continue; }
                    chi2 += (o - e) ** 2 / e; dof++;
                }
            }
            if (pooledExp > 0) { chi2 += (pooledObs - pooledExp) ** 2 / Math.max(pooledExp, 1e-9); dof++; }
            expect(expectedTotal).toBeCloseTo(N, 3);
            expect(chi2).toBeLessThan(chi2Crit(dof));
        });
    }

    it('places a vertex at `rotation` (ξ₀ = 0 is the vertex of sector 0)', () => {
        for (const [n, rotation] of CASES) {
            const p = aperturePolygon([0, 0.5], n, rotation);
            expect(p[0]).toBeCloseTo(Math.cos(rotation), 12);
            expect(p[1]).toBeCloseTo(Math.sin(rotation), 12);
        }
    });

    it('n = 6, rotation 0: the cap x > 1/2 holds 1/6 of the samples', () => {
        // The bokeh-edge witness's value: the cap beyond x = R/2 of a hexagon with a vertex on +x.
        const next = stream(7);
        let cap = 0;
        const N = 400_000;
        for (let i = 0; i < N; i++) if (aperturePolygon([next(), next()], 6, 0)[0] > 0.5) cap++;
        expect(Math.abs(cap / N - 1 / 6)).toBeLessThan(4 * Math.sqrt((1 / 6) * (5 / 6) / N));
    });
});
