// Float32 twin of the generated torus walk (intersection.ts, generateQuotientWalks) over
// torus_face_times (components/quotient/torus/torus.glsl): every arithmetic step rounds to float32
// with Math.fround, in the order the GLSL writes it. Port of the review twin
// docs/claude-2026-11-review/quotients/torus-code/dda_bound_twin.py, plus exact ±0.0 direction
// components.
//
// What it checks, for random rays (origins in D, far outside D, exactly on a face; directions
// generic and near-axis), random periods 0.3–3 and far clips 1–200:
//   - the cells visited never exceed TORUS_MAX_CELLS (torusMaxCells), the loop bound the walk
//     relies on;
//   - t_enter never decreases, and every cell's local entry point lies in D up to 1e-3;
//   - the cell sequence equals a float64 walk's, except where two faces are met within float32
//     rounding of t (an edge passage, crossed in the other order); exactly, for ±0.0 components.
// The walk reports the image it reached as quotient_image_index(k) of the cell index k it holds,
// so no image needs to be recovered from the hit.
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

    it('stays within its loop bound, keeps entries monotone and in D, and matches float64', () => {
        const u = rng(7);
        let worstRatio = 0, maxOut = 0, backward = 0, mismatches = 0, nonTieMismatches = 0, zeroMismatches = 0, zeroRays = 0;
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
                // The only allowed difference: two faces met within float32 rounding of their face
                // times (an edge passage), crossed in the other order — both orders are walks of
                // the ray. A face time (k_a + s_a/2)·L_a − o_a over d_a is rounded at the size of
                // its terms, so its error grows with the origin's distance from D and shrinks
                // with |d_a|: 2⁻²²·(|o_a| + (|k_a| + 1)·L_a)/|d_a| on each of the two axes.
                mismatches++;
                const i = c32.findIndex((c, j) => j >= c64.length || c.k.some((v, a) => v !== c64[j].k[a]));
                const t = i > 0 ? c64[i - 1].tExit : 0;
                const stepAxis = (cells: Cell[]) => [0, 1, 2].find((a) => cells[i].k[a] !== cells[i - 1].k[a])!;
                const faceTimeError = (a: number) => 2 ** -22 * (Math.abs(o[a]) + (Math.abs(c64[i - 1].k[a]) + 1) * L[a]) / Math.abs(d[a]);
                const tie = i > 0 && i < c64.length && i < c32.length
                    && Math.abs(c64[i].tExit - t) <= 1e-6 * (1 + t) + faceTimeError(stepAxis(c32)) + faceTimeError(stepAxis(c64));
                if (!tie) nonTieMismatches++;
            }
            if (zero) { zeroRays++; if (!same) zeroMismatches++; }
            for (let i = 1; i < c32.length; i++) if (c32[i].tEnter < c32[i - 1].tEnter) backward++;
            for (const c of c32) maxOut = Math.max(maxOut, ...c.local.map((v, a) => Math.abs(v) - 0.5 * L[a]));
        }
        // Measured: printed so a change in margin is visible in the test log.
        console.log(JSON.stringify({ worstRatio, maxOut, backward, mismatches, nonTieMismatches, zeroRays, zeroMismatches }));
        expect(worstRatio).toBeLessThanOrEqual(1);
        expect(backward).toBe(0);
        expect(maxOut).toBeLessThanOrEqual(1e-3);
        expect(zeroMismatches).toBe(0);
        expect(nonTieMismatches).toBe(0);
    }, 120_000);
});
