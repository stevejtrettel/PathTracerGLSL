// Partition-MIS twin of the Seifert–Weber space (float64), a port of the review twin
// docs/claude-2026-11-review/quotients/twin/sw_twin.ts at its fixed-ray point Q1, run with the
// occupant's data and the GPU program's scheme:
//   - NEE draws image j of the 13-entry table S13 uniformly and runs the light sampler at the
//     moved query swImageMatrix(j)·x (quotient_image_query), mapping the sampled direction back
//     with PAIRING[(j − 1) xor 1] (quotient_image_direction);
//   - a BSDF ray that hits the light names its image by the walk's crossing count
//     (swImageIndex, quotient_image_index): 0 crossings → 0, one crossing through face f → 1 + f,
//     more → −1, NEE density 0, so that hit keeps weight 1.
// It checks that the three estimators agree and that two wrong schemes are caught:
//   - pt, pt-nee and pt-mis agree within 3σ (independent fixed-seed streams);
//   - W1 (pt-nee also drops BSDF hits on images outside S13) is wrong by more than 10σ;
//   - MEM (NEE samples S13, but MIS counts only 0-crossing hits as members) is wrong by more
//     than 10σ: the 12 neighbor images are then counted by both techniques.
// At 120,000 paths per estimator these seeds give pt 0.5422 ± 0.0047, pt-nee 0.5326 ± 0.0043,
// pt-mis 0.5412 ± 0.0043 (|z| ≤ 1.5), W1 −93σ and MEM +13.8σ (60,000 paths gave MEM only
// +9.9σ, so the budget was doubled). With fixed seeds the test is deterministic.
// And it checks the identification itself: for every BSDF light hit the crossing count names,
// the distance from the moved query to the light equals the distance to the image hit, computed
// from the hit's local data by the hyperbolic law of cosines.
//
// Scene (inside D): an opaque Lambert ball (albedo 0.7) and a black spherical emitter (radiance
// 10). Measurement: at most 4 scattering events, every segment cut at R = 6 (the far clip, above
// the floor 2R_c + 2r_in = 5.80); no sky.

import { describe, it, expect } from 'vitest';
import { swFaceNormals, swPairings, swImageMatrix, swImageIndex } from '../../../src/components/quotient/seifert-weber/seifert-weber.js';
import type { Mat4, Vec4 } from '../../../src/components/ambient/isometry.js';

// ---- RNG (sfc32 seeded by splitmix32) and running statistics -------------------------------
class Rng {
    private a: number; private b: number; private c: number; private d: number;
    constructor(seed: number) {
        const sm = () => {
            seed = (seed + 0x9e3779b9) | 0;
            let z = seed;
            z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
            z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
            return (z ^ (z >>> 16)) >>> 0;
        };
        this.a = sm(); this.b = sm(); this.c = sm(); this.d = sm();
        for (let i = 0; i < 12; i++) this.next();
    }
    next(): number {
        const t = (((this.a + this.b) | 0) + this.d) | 0;
        this.d = (this.d + 1) | 0;
        this.a = this.b ^ (this.b >>> 9);
        this.b = (this.c + (this.c << 3)) | 0;
        this.c = (this.c << 21) | (this.c >>> 11);
        this.c = (this.c + t) | 0;
        return (t >>> 0) / 4294967296;
    }
}
class Acc {
    n = 0; mean = 0; m2 = 0;
    add(x: number) { this.n++; const d = x - this.mean; this.mean += d / this.n; this.m2 += d * (x - this.mean); }
    get se() { return Math.sqrt(this.m2 / (this.n - 1) / this.n); }
}
const zScore = (a: Acc, b: Acc) => (a.mean - b.mean) / Math.hypot(a.se, b.se);

// ---- H³ (hyperboloid model) ------------------------------------------------------------------
const mink = (a: Vec4, b: Vec4) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] - a[3] * b[3];
const lin = (a: Vec4, sa: number, b: Vec4, sb: number): Vec4 => [sa * a[0] + sb * b[0], sa * a[1] + sb * b[1], sa * a[2] + sb * b[2], sa * a[3] + sb * b[3]];
const scl = (a: Vec4, s: number): Vec4 => [a[0] * s, a[1] * s, a[2] * s, a[3] * s];
const apply = (m: Mat4, v: Vec4): Vec4 => [0, 1, 2, 3].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]) as Vec4;
const hdist = (a: Vec4, b: Vec4) => Math.acosh(Math.max(1, -mink(a, b)));
const pointAt = (u: number[], s: number): Vec4 => { const n = Math.hypot(u[0], u[1], u[2]); return [Math.sinh(s) * u[0] / n, Math.sinh(s) * u[1] / n, Math.sinh(s) * u[2] / n, Math.cosh(s)]; };
const NRM = swFaceNormals;
const G = swPairings;

// ---- scene -----------------------------------------------------------------------------------
const BALL = { c: pointAt([0.3, -0.5, 0.2], 0.12), R: 0.72 };
const LIGHT = { c: pointAt([-1, 1, -1], 1.12), R: 0.2 };
const RHO = 0.7, LE = 10, NB = 4, RSEG = 6;
const X0: Vec4 = pointAt([-0.2, -0.6, 0.75], 0.88);
const TMIN = 1e-7;
const coshB = Math.cosh(BALL.R), coshL = Math.cosh(LIGHT.R), sinhL = Math.sinh(LIGHT.R);

/** The smallest s in (smin, smax] where the geodesic (p, v) meets the sphere (c, R), else ∞. */
function sphereS(p: Vec4, v: Vec4, c: Vec4, coshR: number, smin: number, smax: number): number {
    const a = -mink(p, c), b = -mink(v, c);
    const disc = coshR * coshR - (a * a - b * b);
    if (disc < 0) return Infinity;
    const sq = Math.sqrt(disc);
    const s1 = Math.log((a - b) / (coshR + sq)); if (s1 > smin && s1 <= smax) return s1;
    const s2 = Math.log((coshR + sq) / (a + b)); if (s2 > smin && s2 <= smax) return s2;
    return Infinity;
}
function sphereN(y: Vec4, c: Vec4): Vec4 { const t = lin(c, 1, y, mink(c, y)); return scl(t, -1 / Math.sqrt(mink(t, t))); }

/** kind 0 = miss, 1 = ball, 2 = light; t summed over cells; p, v (arrival), n in D's chart;
 *  cross the faces crossed and first the first of them. */
type Hit = { kind: 0 | 1 | 2; t: number; p: Vec4; v: Vec4; n: Vec4; cross: number; first: number };
const NONE: Hit = { kind: 0, t: Infinity, p: X0, v: X0, n: X0, cross: 0, first: -1 };

/** The walk: the cell query clipped at the exit face, then the renormalized step and the pairing
 *  (the generated scene_intersect over seifert_weber_exit/seifert_weber_cross, in float64). */
function trace(p0: Vec4, v0: Vec4): Hit {
    let p = p0, v = v0, tacc = 0, cross = 0, first = -1;
    for (;;) {
        let tau = 1, f = -1;
        for (let i = 0; i < 12; i++) {
            const b = mink(NRM[i], v); if (b <= 0) continue;
            const t = Math.max(-mink(NRM[i], p) / b, 0);
            if (t < tau) { tau = t; f = i; }
        }
        if (f < 0) throw new Error('no exit');
        const sExit = Math.atanh(tau);
        const sLim = Math.min(sExit, RSEG - tacc);
        const sb = sphereS(p, v, BALL.c, coshB, TMIN, sLim), sl = sphereS(p, v, LIGHT.c, coshL, TMIN, sLim);
        if (sb < Infinity || sl < Infinity) {
            const isL = sl < sb, s = isL ? sl : sb, ch = Math.cosh(s), sh = Math.sinh(s);
            const y = lin(p, ch, v, sh);
            return { kind: isL ? 2 : 1, t: tacc + s, p: y, v: lin(p, sh, v, ch), n: sphereN(y, isL ? LIGHT.c : BALL.c), cross, first };
        }
        if (sExit >= RSEG - tacc) return NONE;
        const q = lin(p, 1, v, tau), w = lin(v, 1, p, tau);
        const pn = scl(q, 1 / Math.sqrt(-mink(q, q)));
        let vn = lin(w, 1, pn, mink(w, pn)); vn = scl(vn, 1 / Math.sqrt(mink(vn, vn)));
        p = apply(G[f], pn); v = apply(G[f], vn);
        if (cross === 0) first = f;
        tacc += sExit; cross++;
    }
}

// ---- tangent-space helpers -------------------------------------------------------------------
function frame(x: Vec4, n: Vec4): [Vec4, Vec4] {
    const out: Vec4[] = [];
    for (const e of [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]] as Vec4[]) {
        let t = lin(e, 1, x, mink(e, x));
        t = lin(t, 1, n, -mink(t, n));
        for (const o of out) t = lin(t, 1, o, -mink(t, o));
        const s = mink(t, t); if (s < 1e-6) continue;
        out.push(scl(t, 1 / Math.sqrt(s)));
        if (out.length === 2) break;
    }
    return [out[0], out[1]];
}
function aroundAxis(x: Vec4, u: Vec4, ct: number, phi: number): Vec4 {
    const [e1, e2] = frame(x, u); const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    return [0, 1, 2, 3].map((i) => ct * u[i] + st * Math.cos(phi) * e1[i] + st * Math.sin(phi) * e2[i]) as Vec4;
}
function toward(x: Vec4, C: Vec4): [Vec4, number] {
    const ch = -mink(x, C), d = Math.acosh(Math.max(1, ch));
    return [scl(lin(C, 1, x, -ch), 1 / Math.sinh(d)), d];
}
const sinAlpha = (d: number) => Math.min(1, sinhL / Math.sinh(d));
/** The cone sampler's density toward a light ball at distance d (uniform in the cone). */
const pcone = (d: number) => 1 / (2 * Math.PI * (1 - Math.sqrt(1 - sinAlpha(d) ** 2)));
/** The distance from the ray's start to the center of the light image it hit, from the hit's
 *  local data alone (hyperbolic law of cosines). */
const dLocal = (h: Hit) => Math.acosh(Math.cosh(h.t) * coshL - Math.sinh(h.t) * sinhL * mink(h.v, h.n));

// ---- integrator ------------------------------------------------------------------------------
type Mode = 'pt' | 'nee' | 'mis' | 'w1' | 'mem';
const IMAGES = 13;
const identification = { checked: 0, wrong: 0 };

/** NEE's density for the image a BSDF ray from x hit (lighting_pdf): the image the crossing
 *  count names, or, for MEM, the in-cell image only. */
function neePdf(mode: Mode, x: Vec4, h: Hit): number {
    const j = mode === 'mem' ? (h.cross === 0 ? 0 : -1) : swImageIndex(h.cross, h.first);
    if (j < 0) return 0;
    const d = hdist(apply(swImageMatrix(j), x), LIGHT.c);
    if (mode !== 'mem') {
        identification.checked++;
        if (Math.abs(d - dLocal(h)) > 1e-6 * (1 + d)) identification.wrong++;
    }
    return pcone(d) / IMAGES;
}

function radiance(mode: Mode, d0: Vec4, rng: Rng): number {
    let Lr = 0, beta = 1;
    let hit = trace(X0, d0);
    if (hit.kind === 2) return LE;
    for (let bounce = 1; hit.kind === 1 && bounce <= NB; bounce++) {
        const x = hit.p, n = hit.n;
        if (mode !== 'pt') {
            // NEE: image j of S13, the cone sampler at the moved query, the direction mapped back.
            const j = Math.min(Math.floor(rng.next() * IMAGES), IMAGES - 1);
            const xj = apply(swImageMatrix(j), x);
            const [u0, dC] = toward(xj, LIGHT.c);
            const cosA = Math.sqrt(1 - sinAlpha(dC) ** 2);
            const wj = aroundAxis(xj, u0, 1 - rng.next() * (1 - cosA), 2 * Math.PI * rng.next());
            const wi = j === 0 ? wj : apply(G[(j - 1) ^ 1], wj);
            const cx = mink(wi, n);
            const sl = sphereS(xj, wj, LIGHT.c, coshL, TMIN, Infinity);
            if (cx > 0 && sl <= RSEG) {
                const sh = trace(x, wi);
                if (sh.kind === 2 && Math.abs(sh.t - sl) < 1e-6 * (1 + sl)) {
                    const pn = pcone(dC) / IMAGES, pb = cx / Math.PI;
                    const w = mode === 'mis' || mode === 'mem' ? (pn * pn) / (pn * pn + pb * pb) : 1;
                    Lr += beta * (RHO / Math.PI) * LE * cx / pn * w;
                }
            }
        }
        const ct = Math.sqrt(rng.next());
        const wo = aroundAxis(x, n, ct, 2 * Math.PI * rng.next());
        beta *= RHO;
        const h2 = trace(x, wo);
        if (h2.kind === 2) {
            let w = 1;
            if (mode !== 'pt') {
                const pn = neePdf(mode, x, h2), pb = ct / Math.PI;
                if (mode === 'nee') w = pn > 0 ? 0 : 1;
                else if (mode === 'w1') w = 0;
                else w = (pb * pb) / (pb * pb + pn * pn);
            }
            Lr += beta * LE * w;
            break;
        }
        hit = h2;
    }
    return Lr;
}

// Q1: a fixed camera ray from X0 aimed at a point 0.3 from the ball center (it hits the ball).
const Q1DIR: Vec4 = toward(X0, (() => { const [u] = toward(BALL.c, X0); const [e1] = frame(BALL.c, u); return lin(BALL.c, Math.cosh(0.3), e1, Math.sinh(0.3)); })())[0];

function estimate(mode: Mode, seed: number, paths: number): Acc {
    const rng = new Rng(seed), acc = new Acc();
    for (let s = 0; s < paths; s++) acc.add(radiance(mode, Q1DIR, rng));
    return acc;
}

const PATHS = 120000;

describe('Seifert–Weber partition MIS (float64 twin, fixed seeds)', () => {
    it('pt = pt-nee = pt-mis, and the W1 and membership controls fail', () => {
        const pt = estimate('pt', 9101, PATHS);
        const nee = estimate('nee', 9102, PATHS);
        const mis = estimate('mis', 9103, PATHS);
        const w1 = estimate('w1', 9104, PATHS);
        const mem = estimate('mem', 9105, PATHS);
        const z = { neePt: zScore(nee, pt), misPt: zScore(mis, pt), neeMis: zScore(nee, mis), w1: zScore(w1, mis), mem: zScore(mem, mis) };
        expect(Math.abs(z.neePt)).toBeLessThan(3);
        expect(Math.abs(z.misPt)).toBeLessThan(3);
        expect(Math.abs(z.neeMis)).toBeLessThan(3);
        expect(z.w1).toBeLessThan(-10);
        expect(z.mem).toBeGreaterThan(10);
        expect(identification.wrong).toBe(0);
        expect(identification.checked).toBeGreaterThan(1000);
    }, 120000);
});
