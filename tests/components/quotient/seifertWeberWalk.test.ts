// Float32 twin of the Seifert–Weber walk step (seifert_weber_exit and seifert_weber_cross in
// components/quotient/seifert-weber/seifert-weber.glsl, over the emitted float32 tables): every
// arithmetic step rounds to float32 with Math.fround, in the order the GLSL writes it, with
// inversesqrt as the rounded 1/√x and atanh as the rounded float64 value. A port of the review's
// float32 study docs/claude-2026-11-review/quotients/seifert-weber/sw.ts (`teleport`).
//
// What it checks, for 2,000 random rays in D taken through 100 crossings each and 2,000 rays
// aimed exactly at D's vertices and edge midpoints (the zero-length crossings of edge and vertex
// passages):
//   - no ray is stuck: every step finds an exit face, and runs of zero-length crossings stay
//     short (the review measured at most 6);
//   - the hyperboloid and tangency constraints drift by at most 5e-5 (renormalizing at every
//     crossing keeps them from growing; without it the defect grows by cosh 2t per crossing);
//   - every window of arc length farClip (6, 8, 16) crosses fewer faces than the walk's cap
//     QUOTIENT_MAX_CROSSINGS = ⌈4·farClip⌉ + 32 (swMaxCrossings), so the cap never ends a segment.
// GLSL builtins (atanh, inversesqrt) and FMA contraction are not modeled; SwiftShader's builtins
// were measured separately (seifert-weber.md).

import { describe, it, expect } from 'vitest';
import { swFaceNormals, swPairings, swMaxCrossings, SW_CIRCUMRADIUS } from '../../../src/components/quotient/seifert-weber/seifert-weber.js';
import type { Mat4, Vec4 } from '../../../src/components/ambient/isometry.js';

const f = Math.fround;
const N32 = swFaceNormals.map((n) => n.map(f) as Vec4);
const G32 = swPairings.map((m) => m.map(f) as Mat4);

/** hyperbolic_form in float32: dot(a.xyz, b.xyz) − a.w·b.w. */
const form32 = (a: Vec4, b: Vec4): number => f(f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2])) - f(a[3] * b[3]));
const form64 = (a: Vec4, b: Vec4): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] - a[3] * b[3];
/** GLSL's mat4 · vec4 (column-major m): out[r] = Σ_c m[4c + r]·v[c], in float32. */
const apply32 = (m: Mat4, v: Vec4): Vec4 => [0, 1, 2, 3].map((r) => {
    let s = 0;
    for (let c = 0; c < 4; c++) s = f(s + f(m[4 * c + r] * v[c]));
    return s;
}) as Vec4;
const inversesqrt = (x: number): number => f(1 / Math.sqrt(x));

/** seifert_weber_exit: τ = tanh of the arc length to the exit face, and the face (−1: none). */
function exit(p: Vec4, v: Vec4): { tau: number; face: number } {
    let tau = 1, face = -1;
    for (let i = 0; i < 12; i++) {
        const b = form32(N32[i], v);
        if (b > 0) {
            const ti = Math.max(f(-form32(N32[i], p) / b), 0);
            if (ti < tau) { tau = ti; face = i; }
        }
    }
    return { tau, face };
}

/** seifert_weber_cross: the renormalized exit state, moved by PAIRING[face]. */
function cross(p: Vec4, v: Vec4, tau: number, face: number): { p: Vec4; v: Vec4 } {
    const q = p.map((x, c) => f(x + f(tau * v[c]))) as Vec4;
    const w = v.map((x, c) => f(x + f(tau * p[c]))) as Vec4;
    const sp = inversesqrt(f(-form32(q, q)));
    const pn = q.map((x) => f(x * sp)) as Vec4;
    const k = form32(w, pn);
    let vn = w.map((x, c) => f(x + f(k * pn[c]))) as Vec4;
    const sv = inversesqrt(form32(vn, vn));
    vn = vn.map((x) => f(x * sv)) as Vec4;
    return { p: apply32(G32[face], pn), v: apply32(G32[face], vn) };
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
function randUnit3(u: () => number): [number, number, number] {
    const z = 1 - 2 * u(), ph = 2 * Math.PI * u(), s = Math.sqrt(1 - z * z);
    return [s * Math.cos(ph), s * Math.sin(ph), z];
}
const pointAt = (d: [number, number, number], r: number): Vec4 => [Math.sinh(r) * d[0], Math.sinh(r) * d[1], Math.sinh(r) * d[2], Math.cosh(r)];
const inD = (p: Vec4): boolean => swFaceNormals.every((n) => form64(n, p) <= 0);
function randomPointInD(u: () => number): Vec4 {
    for (;;) {
        const p = pointAt(randUnit3(u), SW_CIRCUMRADIUS * Math.cbrt(u()));
        if (inD(p)) return p;
    }
}
/** The unit tangent at p toward the point `to` (float64). */
function toward(p: Vec4, to: Vec4): Vec4 {
    const c = form64(to, p);
    const w = to.map((x, i) => x + c * p[i]) as Vec4;
    const n = Math.sqrt(form64(w, w));
    return w.map((x) => x / n) as Vec4;
}

// D's 20 vertices (Klein radius tanh R_c) and the midpoints of its 30 edges.
const VERTS: Vec4[] = (() => {
    const PHI = (1 + Math.sqrt(5)) / 2;
    const raw: number[][] = [];
    for (const a of [1, -1]) for (const b of [1, -1]) for (const c of [1, -1]) raw.push([a, b, c]);
    for (const a of [1, -1]) for (const b of [1, -1]) raw.push([a / PHI, 0, b * PHI], [0, a * PHI, b / PHI], [a * PHI, b / PHI, 0]);
    const k = Math.tanh(SW_CIRCUMRADIUS), s = 1 / Math.sqrt(1 - k * k);
    return raw.map((v) => { const n = Math.hypot(v[0], v[1], v[2]); return [(k * s * v[0]) / n, (k * s * v[1]) / n, (k * s * v[2]) / n, s] as Vec4; });
})();
const EDGE_MIDPOINTS: Vec4[] = (() => {
    const faces = VERTS.map((v) => swFaceNormals.map((n, i) => [i, form64(n, v)] as const).filter(([, x]) => Math.abs(x) < 1e-9).map(([i]) => i));
    const mids: Vec4[] = [];
    for (let a = 0; a < VERTS.length; a++) for (let b = a + 1; b < VERTS.length; b++) {
        if (faces[a].filter((i) => faces[b].includes(i)).length !== 2) continue;
        const m = VERTS[a].map((x, c) => x + VERTS[b][c]) as Vec4;
        const s = 1 / Math.sqrt(-form64(m, m));
        mids.push(m.map((x) => x * s) as Vec4);
    }
    return mids;
})();

interface Stats { stuck: number; maxZeroRun: number; zeroCrossings: number; crossings: number; drift: number; outside: number; maxInWindow: Map<number, number> }
const CLIPS = [6, 8, 16];

/** Walks a float32 ray through `n` crossings, recording drift, zero-length runs and the most
 *  crossings in any window of arc length farClip. */
function run(p0: Vec4, v0: Vec4, n: number, s: Stats): void {
    let p = p0.map(f) as Vec4, v = v0.map(f) as Vec4;
    let t = 0, run0 = 0;
    const ts: number[] = [];
    for (let k = 0; k < n; k++) {
        const e = exit(p, v);
        if (e.face < 0) { s.stuck++; return; }
        if (e.tau === 0) { s.zeroCrossings++; run0++; s.maxZeroRun = Math.max(s.maxZeroRun, run0); } else run0 = 0;
        t = f(t + f(Math.atanh(e.tau)));
        ts.push(t);
        ({ p, v } = cross(p, v, e.tau, e.face));
        s.crossings++;
        s.drift = Math.max(s.drift, Math.abs(form64(p, p) + 1), Math.abs(form64(v, v) - 1), Math.abs(form64(p, v)));
        s.outside = Math.max(s.outside, ...swFaceNormals.map((nn) => form64(nn, p)));
    }
    for (const R of CLIPS) {
        let most = 0;
        for (let a = 0, b = 0; a < ts.length; a++) {
            while (b < ts.length && ts[b] < ts[a] + R) b++;
            most = Math.max(most, b - a);
        }
        s.maxInWindow.set(R, Math.max(s.maxInWindow.get(R) ?? 0, most));
    }
}

const newStats = (): Stats => ({ stuck: 0, maxZeroRun: 0, zeroCrossings: 0, crossings: 0, drift: 0, outside: 0, maxInWindow: new Map() });

describe('Seifert–Weber walk (float32 twin)', () => {
    it('takes random rays through 100 crossings without sticking, drifting or reaching the cap', () => {
        const u = rng(2000);
        const s = newStats();
        for (let k = 0; k < 2000; k++) {
            const p = randomPointInD(u);
            run(p, toward(p, pointAt(randUnit3(u), 3)), 100, s);
        }
        expect(s.stuck).toBe(0);
        expect(s.crossings).toBe(200000);
        expect(s.drift).toBeLessThanOrEqual(5e-5);
        expect(s.outside).toBeLessThan(1e-4);                 // states stay in D up to rounding
        for (const R of CLIPS) expect(s.maxInWindow.get(R)!).toBeLessThan(swMaxCrossings(R));
    });

    it('passes edges and vertices with short zero-length runs', () => {
        const u = rng(4000);
        const s = newStats();
        for (let k = 0; k < 2000; k++) {
            const p = randomPointInD(u);
            const target = k % 2 === 0 ? VERTS[Math.floor(u() * VERTS.length)] : EDGE_MIDPOINTS[Math.floor(u() * EDGE_MIDPOINTS.length)];
            run(p, toward(p, target), 30, s);
        }
        expect(s.stuck).toBe(0);
        expect(s.zeroCrossings).toBeGreaterThan(0);           // the passages were reached
        expect(s.maxZeroRun).toBeLessThanOrEqual(6);
        expect(s.drift).toBeLessThanOrEqual(5e-5);
        for (const R of CLIPS) expect(s.maxInWindow.get(R)!).toBeLessThan(swMaxCrossings(R));
    });
});
