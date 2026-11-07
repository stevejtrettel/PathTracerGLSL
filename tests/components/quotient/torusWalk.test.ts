// Float32 twin of the generated torus walk (intersection.ts, generateTorusWalks) over
// torus_face_times (components/quotient/torus/torus.glsl): every arithmetic step rounds to float32
// with Math.fround, in the order the GLSL writes it. Port of the review twin
// docs/claude-2026-11-review/quotients/torus-code/dda_bound_twin.py, plus exact ±0.0 direction
// components and the image identification of quotient_image (derived in
// docs/claude-2026-11-review/quotients-plan.md, Q1.1).
//
// What it checks, for random rays (origins in D, far outside D, exactly on a face; directions
// generic and near-axis), random periods 0.3–3 and far clips 1–200:
//   - the cells visited never exceed TORUS_MAX_CELLS (torusMaxCells), the loop bound the walk
//     relies on;
//   - t_enter never decreases, and every cell's local entry point lies in D up to 1e-3;
//   - the cell sequence equals a float64 walk's, except where two faces are met within float32
//     rounding of t (an edge passage, crossed in the other order); exactly, for ±0.0 components;
//   - quotient_image's rounding returns the walk's cell index k at random hit distances in every
//     visited cell, from a start point offset by a spawn offset.
// GLSL builtins and FMA contraction are not modeled.

import { describe, it, expect } from 'vitest';
import { torusMaxCells, torusImageIndex, torusImageOffset } from '../../../src/components/quotient/torus/torus.js';
import type { Vec3 } from '../../../src/compiler/types.js';

const f = Math.fround;
const BIG = f(3.0e38);

type Arith = (x: number) => number;

interface Cell { k: Vec3; tEnter: number; tExit: number; local: Vec3 }

/** The walk of intersection.ts over torus_face_times, with every operation rounded by `r`. */
function walk(o: Vec3, d: Vec3, L: Vec3, far: number, r: Arith, maxCells: number): Cell[] {
    const k: Vec3 = [0, 1, 2].map((i) => Math.floor(r(r(o[i] / L[i]) + 0.5))) as Vec3;
    const s: Vec3 = d.map((v) => (v >= 0 ? 1 : -1)) as Vec3;   // -0.0 >= 0 is true, as in GLSL
    let tEnter = 0;
    const cells: Cell[] = [];
    const FAR = r(far);
    for (let n = 0; n < maxCells + 10; n++) {
        const tn = [0, 1, 2].map((i) => {
            const c = r(r(r(k[i] + r(0.5 * s[i])) * L[i]) - o[i]);
            return d[i] !== 0 ? r(c / d[i]) : BIG;
        });
        const tExit = Math.min(tn[0], tn[1], tn[2]);
        const local = [0, 1, 2].map((i) => r(r(o[i] + r(d[i] * tEnter)) - r(L[i] * k[i]))) as Vec3;
        cells.push({ k: [...k] as Vec3, tEnter, tExit, local });
        if (tExit >= FAR) return cells;
        if (tExit === tn[0]) k[0] += s[0]; else if (tExit === tn[1]) k[1] += s[1]; else k[2] += s[2];
        tEnter = Math.max(tEnter, tExit);
    }
    throw new Error('runaway walk');
}

function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function gauss(u: () => number): number {
    return Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
}

const id: Arith = (x) => x;

describe('torus walk (float32 twin)', () => {
    it('numbers its 27 images with index and offset as inverses', () => {
        for (let j = 0; j < 27; j++) expect(torusImageIndex(torusImageOffset(j))).toBe(j);
        expect(torusImageIndex([2, 0, 0])).toBe(-1);
        expect(torusImageIndex([0, -2, 1])).toBe(-1);
        expect(torusImageIndex([0, 0, 0])).toBe(13);
    });

    it('stays within its loop bound, keeps entries monotone and in D, matches float64, and identifies images', () => {
        const u = rng(7);
        let worstRatio = 0, maxOut = 0, backward = 0, mismatches = 0, nonTieMismatches = 0, zeroMismatches = 0, zeroRays = 0, imageSamples = 0, imageWrong = 0;
        const TRIALS = 4000;
        for (let trial = 0; trial < TRIALS; trial++) {
            const L: Vec3 = [f(0.3 + 2.7 * u()), f(0.3 + 2.7 * u()), f(0.3 + 2.7 * u())];
            const far = 1 + 199 * u();
            const bound = torusMaxCells(L, f(far));
            const kind = trial % 6;
            let o: Vec3 = [0, 1, 2].map((i) => (u() - 0.5) * L[i]) as Vec3;
            if (kind === 1) o = o.map((v, i) => v + L[i] * (Math.floor(u() * 2000) - 1000)) as Vec3;   // far outside D
            if (kind === 2) { const ax = Math.floor(u() * 3); o[ax] = 0.5 * L[ax] * (u() < 0.5 ? -1 : 1); }   // on a face
            o = o.map(f) as Vec3;
            let d: Vec3 = [gauss(u), gauss(u), gauss(u)];
            if (kind === 3) { d = [0, 0, 0]; d[Math.floor(u() * 3)] = 1; d = d.map((v) => v + gauss(u) * 1e-7) as Vec3; }   // near-axis
            const zero = kind >= 4;
            if (zero) {
                // Exact ±0.0 components: one or two axes, as a mirror off an axis-aligned wall makes.
                const pick = Math.floor(u() * 3);
                const axes = kind === 4 ? [pick] : [0, 1, 2].filter((i) => i !== pick);
                for (const ax of axes) d[ax] = u() < 0.5 ? 0 : -0;
            }
            const n = Math.hypot(d[0], d[1], d[2]);
            d = d.map((v) => f(v / n)) as Vec3;

            const c32 = walk(o, d, L, far, f, bound);
            const c64 = walk(o, d, L, far, id, bound);
            worstRatio = Math.max(worstRatio, c32.length / bound);
            const same = c32.length === c64.length && c32.every((c, i) => c.k.every((v, a) => v === c64[i].k[a]));
            if (!same) {
                // The only allowed difference: two faces met within float32 rounding of t (an
                // edge passage), crossed in the other order — both orders are walks of the ray.
                mismatches++;
                const i = c32.findIndex((c, j) => j >= c64.length || c.k.some((v, a) => v !== c64[j].k[a]));
                const t = c64[i - 1].tExit;
                if (!(i > 0 && i < c64.length && Math.abs(c64[i].tExit - t) <= 1e-6 * (1 + t))) nonTieMismatches++;
            }
            if (zero) { zeroRays++; if (!same) zeroMismatches++; }
            for (let i = 1; i < c32.length; i++) if (c32[i].tEnter < c32[i - 1].tEnter) backward++;
            for (const c of c32) maxOut = Math.max(maxOut, ...c.local.map((v, a) => Math.abs(v) - 0.5 * L[a]));

            // quotient_image: a hit at arc length t in cell k is reported, as the walk forms it,
            // at hit.t = t_local + t_enter and hit.p = local + d·t_local; the start point x is the
            // previous vertex, a spawn offset (1e-3) behind the ray's origin.
            const off: Vec3 = [gauss(u), gauss(u), gauss(u)];
            const on = Math.hypot(...off);
            const x = o.map((v, a) => f(v - 1e-3 * off[a] / on)) as Vec3;
            for (const c of c32) {
                const t1 = Math.min(c.tExit, f(far));
                if (!(t1 > c.tEnter)) continue;
                const tLocal = f(f(c.tEnter + u() * (t1 - c.tEnter)) - c.tEnter);
                const hitT = f(tLocal + c.tEnter);
                const hitP = c.local.map((v, a) => f(v + f(d[a] * tLocal)));
                const k = [0, 1, 2].map((a) => Math.round(f(f(f(x[a] + f(d[a] * hitT)) - hitP[a]) / L[a])));
                imageSamples++;
                if (k.some((v, a) => v !== c.k[a])) imageWrong++;
            }
        }
        // Measured: printed so a change in margin is visible in the test log.
        console.log(JSON.stringify({ worstRatio, maxOut, backward, mismatches, nonTieMismatches, zeroRays, zeroMismatches, imageSamples, imageWrong }));
        expect(worstRatio).toBeLessThanOrEqual(1);
        expect(backward).toBe(0);
        expect(maxOut).toBeLessThanOrEqual(1e-3);
        expect(zeroMismatches).toBe(0);
        expect(nonTieMismatches).toBe(0);
        expect(imageWrong).toBe(0);
        expect(imageSamples).toBeGreaterThan(100000);
    }, 120_000);
});
