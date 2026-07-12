// env-as-light T5: the equal-area octahedral chart's TS twin. The GLSL chart is a
// transcription of these functions — these tests are the ground truth for both.

import { describe, it, expect } from 'vitest';
import { equalAreaSquareToSphere, equalAreaSphereToSquare, resampleEquirectToOctahedral } from '../../src/engine/loaders/octahedral.js';

// deterministic LCG (no Math.random in tests — reproducible failures)
function lcg(seed: number) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
}

describe('equal-area octahedral mapping', () => {
    it('square → sphere gives unit vectors', () => {
        const rnd = lcg(1);
        for (let k = 0; k < 500; k++) {
            const d = equalAreaSquareToSphere(rnd(), rnd());
            const len = Math.hypot(...d);
            expect(len).toBeCloseTo(1, 6);
        }
    });

    it('round-trips uv → dir → uv (the sample↔pdf agreement in CPU form)', () => {
        const rnd = lcg(2);
        for (let k = 0; k < 500; k++) {
            const u = rnd(), v = rnd();
            const [u2, v2] = equalAreaSphereToSquare(equalAreaSquareToSphere(u, v));
            expect(u2).toBeCloseTo(u, 4);
            expect(v2).toBeCloseTo(v, 4);
        }
    });

    it('round-trips dir → uv → dir', () => {
        const rnd = lcg(3);
        for (let k = 0; k < 500; k++) {
            // uniform direction via the mapping itself (it IS equal-area)
            const d = equalAreaSquareToSphere(rnd(), rnd());
            const d2 = equalAreaSquareToSphere(...equalAreaSphereToSquare(d));
            expect(d2[0]).toBeCloseTo(d[0], 4);
            expect(d2[1]).toBeCloseTo(d[1], 4);
            expect(d2[2]).toBeCloseTo(d[2], 4);
        }
    });

    it('is EQUAL-AREA: uniform square samples give uniform sphere coverage (octant chi-square)', () => {
        // Map a regular grid; count directions per octant — equal-area ⇒ equal counts.
        const N = 64;
        const counts = new Map<string, number>();
        for (let j = 0; j < N; j++) {
            for (let i = 0; i < N; i++) {
                const d = equalAreaSquareToSphere((i + 0.5) / N, (j + 0.5) / N);
                const key = `${d[0] >= 0}${d[1] >= 0}${d[2] >= 0}`;
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
        }
        const expected = (N * N) / 8;
        for (const c of counts.values()) {
            expect(Math.abs(c - expected) / expected).toBeLessThan(0.05);
        }
        expect(counts.size).toBe(8);
    });

    it('mean of mapped directions ≈ 0 (no hemispherical bias)', () => {
        const N = 128;
        let sx = 0, sy = 0, sz = 0;
        for (let j = 0; j < N; j++) {
            for (let i = 0; i < N; i++) {
                const d = equalAreaSquareToSphere((i + 0.5) / N, (j + 0.5) / N);
                sx += d[0]; sy += d[1]; sz += d[2];
            }
        }
        const n = N * N;
        expect(Math.abs(sx / n)).toBeLessThan(1e-3);
        expect(Math.abs(sy / n)).toBeLessThan(1e-3);
        expect(Math.abs(sz / n)).toBeLessThan(1e-3);
    });
});

describe('resampleEquirectToOctahedral', () => {
    it('preserves a constant field exactly', () => {
        const W = 16, H = 8, N = 8;
        const rgb = new Float32Array(W * H * 3).fill(0.7);
        const out = resampleEquirectToOctahedral(rgb, W, H, N);
        for (let i = 0; i < out.length; i++) expect(out[i]).toBeCloseTo(0.7, 6);
    });

    it('routes a bright northern cap to the octahedral center region (y-up pole)', () => {
        const W = 32, H = 16, N = 16;
        const rgb = new Float32Array(W * H * 3);
        for (let i = 0; i < W * 2; i++) rgb[3 * i] = 10;   // top two rows (θ ≈ 0, +Y pole)
        const out = resampleEquirectToOctahedral(rgb, W, H, N);
        // +Y decodes to the center of the square: uv (0.5, 0.5)
        const ci = Math.floor(N / 2), cj = Math.floor(N / 2);
        const centerVal = out[3 * (cj * N + ci)];
        const cornerVal = out[3 * (0 * N + 0)];             // corners are the -Y pole
        expect(centerVal).toBeGreaterThan(0);
        expect(cornerVal).toBeCloseTo(0, 6);
    });
});
