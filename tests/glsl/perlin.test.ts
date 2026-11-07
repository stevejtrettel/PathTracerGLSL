// The Perlin library (src/glsl/core/perlin.glsl) through its TS twin: the table is pbrt's,
// the twin reproduces pbrt-v4's compiled noise.cpp, and the bounds the GLSL header states
// hold. The GLSL itself is held to the twin on a GPU by `npm run witness:textures`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PERLIN_PERM, perlinNoise, perlinFbm, perlinTurbulence } from './perlinTwin.js';
import golden from '../fixtures/perlin-pbrt-golden.json';

const PBRT_NOISE = resolve(__dirname, '../../docs/claude-2026-11-review/photoreal/procedural-textures/ref/noise.cpp');

describe('Perlin noise library (pbrt-v4 transcription)', () => {
    it("the permutation is pbrt's NoisePerm (whose 512 entries are two copies of one 256-entry table)", () => {
        const source = readFileSync(PBRT_NOISE, 'utf8');
        const body = /NoisePerm\[2 \* NoisePermSize\] = \{([^}]*)\}/.exec(source)![1]
            .replace(/\/\/[^\n]*/g, '');
        const pbrt = body.split(',').map((s) => s.trim()).filter((s) => s !== '').map(Number);
        expect(pbrt).toHaveLength(512);
        expect(pbrt.slice(256)).toEqual(pbrt.slice(0, 256));
        expect([...PERLIN_PERM]).toEqual(pbrt.slice(0, 256));
        expect([...PERLIN_PERM].sort((a, b) => a - b)).toEqual(Array.from({ length: 256 }, (_, i) => i));
    });

    it('matches pbrt-v4 noise.cpp compiled in fp32 (Noise, FBm and Turbulence at zero footprint)', () => {
        expect(golden.columns).toEqual(['x', 'y', 'z', 'noise', 'fbm(0.5,8)', 'turbulence(0.5,6)', 'fbm(0.7,3)', 'turbulence(0.8,1)']);
        expect(golden.rows.length).toBeGreaterThanOrEqual(300);
        let worst = 0;
        // Nine significant digits round-trip fp32, so fround recovers pbrt's exact floats.
        for (const [x, y, z, n, fbm8, turb6, fbm3, turb1] of golden.rows.map((r) => r.map(Math.fround))) {
            const ours = [perlinNoise(x, y, z), perlinFbm(x, y, z, 0.5, 8), perlinTurbulence(x, y, z, 0.5, 6),
                perlinFbm(x, y, z, 0.7, 3), perlinTurbulence(x, y, z, 0.8, 1)];
            const theirs = [n, fbm8, turb6, fbm3, turb1];
            for (let k = 0; k < 5; k++) worst = Math.max(worst, Math.abs(ours[k] - theirs[k]));
        }
        expect(worst).toBe(0);
    });

    it('is zero at lattice points, and turbulence there is the residual 0.2·ωⁿ alone', () => {
        for (const [x, y, z] of [[0, 0, 0], [3, -7, 255], [-256, 256, 1000]]) {
            expect(perlinNoise(x, y, z)).toBe(0);
            expect(perlinTurbulence(x, y, z, 0.8, 1)).toBeCloseTo(0.2 * 0.8, 7);
        }
    });

    it('obeys the stated bounds: |noise| ≤ 2, |fbm| ≤ 2Σωⁱ, 0 ≤ turbulence ≤ 2Σωⁱ + 0.2ωⁿ', () => {
        let state = 7;
        const rand = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
        let maxNoise = 0;
        for (let i = 0; i < 100000; i++) {
            const [x, y, z] = [rand() * 64 - 32, rand() * 64 - 32, rand() * 64 - 32].map(Math.fround);
            maxNoise = Math.max(maxNoise, Math.abs(perlinNoise(x, y, z)));
            if (i % 10 === 0) {
                expect(Math.abs(perlinFbm(x, y, z, 0.5, 6))).toBeLessThanOrEqual(2 * (2 - 2 ** -5));
                const t = perlinTurbulence(x, y, z, 0.5, 6);
                expect(t).toBeGreaterThanOrEqual(0);
                expect(t).toBeLessThanOrEqual(2 * (2 - 2 ** -5) + 0.2 * 2 ** -6);
            }
        }
        expect(maxNoise).toBeLessThanOrEqual(2);
        expect(maxNoise).toBeGreaterThan(0.5);   // the samples reach the noise's working range
    });
});
