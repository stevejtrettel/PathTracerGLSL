// Partition-MIS twin of the 3-torus (float64), a port of the review twin
// docs/claude-2026-11-review/quotients/twin/torus.ts at its fixed-ray point Q1.
//
// The GPU program samples NEE images from the 27-entry table S with the occupant's numbering
// (quotient_image_shift ↔ torusImageOffset) and names the image a BSDF ray hit by the cell index
// its walk reached (hit.image = quotient_image_index(k) ↔ the trace's `k` below); an image
// outside S has NEE density 0, so its BSDF hit keeps weight 1. This twin runs that scheme on a small scene and checks that
// the three estimators agree and that two wrong schemes are caught:
//   - pt, pt-nee and pt-mis agree within 3σ (independent fixed-seed streams, 200,000 paths each);
//   - W1 (pt-nee also drops BSDF hits on images outside S) is wrong by more than 10σ;
//   - W2 (NEE samples S, MIS tests a different set: the block around x's nearest image) is wrong
//     by more than 10σ.
// The review measured W1 ≈ −110σ and W2 ≈ −24σ at this budget, so both controls can fail. With
// fixed seeds the test is deterministic.
//
// Scene (D = [−½, ½]³, L = 1): an opaque Lambert ball (albedo 0.7) and a black spherical emitter
// (radiance 10), both strictly inside D. Measurement: at most 4 scattering events, every segment
// (camera, BSDF, shadow) cut at R = 4 (the far clip); no sky.

import { describe, it, expect } from 'vitest';
import { torusImageIndex, torusImageOffset } from '../../../src/components/quotient/torus/torus.js';
import type { Vec3 } from '../../../src/compiler/types.js';

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

// ---- vectors ---------------------------------------------------------------------------------
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addS = (a: Vec3, b: Vec3, s: number): Vec3 => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.sqrt(dot(a, a));
const nrm = (a: Vec3): Vec3 => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };
const crs = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ---- scene -----------------------------------------------------------------------------------
const L = 1, H = L / 2;
const BALL = { c: [0.12, -0.17, 0.08] as Vec3, r: 0.3 };
const LIGHT = { c: [-0.31, 0.29, -0.27] as Vec3, r: 0.1 };
const RHO = 0.7, LE = 10, NB = 4, RSEG = 4;
const X0: Vec3 = [0.3, 0.35, 0.3];
const Q1DIR: Vec3 = nrm(sub(addS(BALL.c, [0.15, 0.1, -0.05], 1), X0));
const TMIN = 1e-6;

/** kind 0 = miss, 1 = ball, 2 = light; t is summed over cells, p in D's chart, k the cell index
 *  accumulated by the teleports (exact): the walk's hit.image names it. */
type Hit = { kind: 0 | 1 | 2; t: number; p: Vec3; n: Vec3; k: Vec3 };
const NONE: Hit = { kind: 0, t: Infinity, p: [0, 0, 0], n: [0, 0, 0], k: [0, 0, 0] };

function sphereT(o: Vec3, d: Vec3, c: Vec3, r: number, tmin: number, tmax: number): number {
    const oc = sub(o, c);
    const b = dot(oc, d), cc = dot(oc, oc) - r * r;
    const disc = b * b - cc;
    if (disc < 0) return Infinity;
    const s = Math.sqrt(disc);
    const t1 = -b - s; if (t1 > tmin && t1 <= tmax) return t1;
    const t2 = -b + s; if (t2 > tmin && t2 <= tmax) return t2;
    return Infinity;
}

/** The teleporting walk: the ray lives in D; at each face exit it moves by ∓L on that axis. */
function trace(o: Vec3, d: Vec3): Hit {
    let p: Vec3 = [o[0], o[1], o[2]];
    const k: Vec3 = [0, 0, 0];
    let tacc = 0;
    for (;;) {
        const ti = [Infinity, Infinity, Infinity];
        let tex = Infinity;
        for (let i = 0; i < 3; i++) {
            if (d[i] > 0) ti[i] = (H - p[i]) / d[i];
            else if (d[i] < 0) ti[i] = (-H - p[i]) / d[i];
            if (ti[i] < tex) tex = ti[i];
        }
        if (tex < 0) tex = 0;
        const tlim = Math.min(tex, RSEG - tacc);
        const tb = sphereT(p, d, BALL.c, BALL.r, TMIN, tlim);
        const tl = sphereT(p, d, LIGHT.c, LIGHT.r, TMIN, tlim);
        if (tb < Infinity || tl < Infinity) {
            const isL = tl < tb, tt = isL ? tl : tb, c = isL ? LIGHT.c : BALL.c, r = isL ? LIGHT.r : BALL.r;
            const ph = addS(p, d, tt);
            return { kind: isL ? 2 : 1, t: tacc + tt, p: ph, n: [(ph[0] - c[0]) / r, (ph[1] - c[1]) / r, (ph[2] - c[2]) / r], k: [k[0], k[1], k[2]] };
        }
        if (tex >= RSEG - tacc) return NONE;
        p = addS(p, d, tex);
        for (let i = 0; i < 3; i++) if (ti[i] <= tex * (1 + 1e-12) + 1e-15) { const s = d[i] > 0 ? 1 : -1; p[i] -= s * L; k[i] += s; }
        tacc += tex;
    }
}

// ---- image selection -------------------------------------------------------------------------
const lightCenter = (k: Vec3): Vec3 => addS(LIGHT.c, k, L);
const nearestK = (x: Vec3): Vec3 => [0, 1, 2].map((i) => Math.round((x[i] - LIGHT.c[i]) / L)) as Vec3;
/** NEE: image j of the table, uniformly (quotient_image_shift's numbering). */
const sampleImage = (u: number): Vec3 => torusImageOffset(Math.min(Math.floor(u * 27), 26));
/** MIS: the selection probability of the image in cell k — 1/27 in S (quotient_image_index ≥ 0), else 0. */
const pselU27 = (_x: Vec3, k: Vec3) => (torusImageIndex(k) >= 0 ? 1 / 27 : 0);
/** WRONG on purpose (W2): the block around x's nearest image instead of S. */
const pselW2 = (x: Vec3, k: Vec3) => (torusImageIndex(sub(k, nearestK(x))) >= 0 ? 1 / 27 : 0);

// ---- integrator ------------------------------------------------------------------------------
function frame(n: Vec3): [Vec3, Vec3] {
    const a: Vec3 = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
    const t = nrm(crs(n, a)); return [t, crs(n, t)];
}
function aroundAxis(n: Vec3, ct: number, phi: number): Vec3 {
    const [t, b] = frame(n); const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    return [0, 1, 2].map((i) => st * Math.cos(phi) * t[i] + st * Math.sin(phi) * b[i] + ct * n[i]) as Vec3;
}
const pcone = (d: number) => 1 / (2 * Math.PI * (1 - Math.sqrt(1 - Math.min(1, (LIGHT.r / d) ** 2))));

type Mode = 'pt' | 'nee' | 'mis' | 'w1';

function radiance(mode: Mode, psel: (x: Vec3, k: Vec3) => number, rng: Rng): number {
    let Lr = 0, beta = 1;
    let hit = trace(X0, Q1DIR);
    if (hit.kind === 2) return LE;
    for (let bounce = 1; hit.kind === 1 && bounce <= NB; bounce++) {
        const x = hit.p, n = hit.n;
        if (mode !== 'pt') {
            // NEE: one image of S, then a uniform cone toward it (the unchanged sampler at the
            // moved query); the shadow ray walks the cells and must reach that image.
            const k = sampleImage(rng.next()), C = lightCenter(k), ps = 1 / 27;
            const e = sub(C, x), dC = len(e), u0: Vec3 = [e[0] / dC, e[1] / dC, e[2] / dC];
            const cosA = Math.sqrt(1 - Math.min(1, (LIGHT.r / dC) ** 2));
            const wi = aroundAxis(u0, 1 - rng.next() * (1 - cosA), 2 * Math.PI * rng.next());
            const cx = dot(wi, n);
            const tl = sphereT(x, wi, C, LIGHT.r, TMIN, Infinity);
            if (cx > 0 && tl <= RSEG) {
                const sh = trace(x, wi);
                if (sh.kind === 2 && Math.abs(sh.t - tl) < 1e-7 * (1 + tl)) {
                    const pn = ps * pcone(dC), pb = cx / Math.PI;
                    const w = mode === 'mis' ? (pn * pn) / (pn * pn + pb * pb) : 1;
                    Lr += beta * (RHO / Math.PI) * LE * cx / pn * w;
                }
            }
        }
        // BSDF: cosine sampling, f·cos/pdf = RHO.
        const ct = Math.sqrt(rng.next());
        const wo = aroundAxis(n, ct, 2 * Math.PI * rng.next());
        beta *= RHO;
        const h2 = trace(x, wo);
        if (h2.kind === 2) {
            let w = 1;
            if (mode !== 'pt') {
                const k = h2.k;
                const ps = psel(x, k);
                const pn = ps > 0 ? ps * pcone(len(sub(lightCenter(k), x))) : 0, pb = ct / Math.PI;
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

function run(mode: Mode, psel: (x: Vec3, k: Vec3) => number, seed: number, n = 200_000): Acc {
    const rng = new Rng(seed), acc = new Acc();
    for (let s = 0; s < n; s++) acc.add(radiance(mode, psel, rng));
    return acc;
}

describe('torus partition MIS (float64 twin, fixed seeds)', () => {
    it('pt = pt-nee = pt-mis, and the W1 and W2 controls fail', () => {
        const pt = run('pt', pselU27, 9101);
        const mis = run('mis', pselU27, 9102);
        const nee = run('nee', pselU27, 9103);
        const w1 = run('w1', pselU27, 9104);
        const w2 = run('mis', pselW2, 9105);
        const z = { neePt: zScore(nee, pt), misPt: zScore(mis, pt), neeMis: zScore(nee, mis), w1: zScore(w1, pt), w2: zScore(w2, pt) };
        console.log(JSON.stringify({ pt: pt.mean, nee: nee.mean, mis: mis.mean, w1: w1.mean, w2: w2.mean, z }));
        expect(Math.abs(z.neePt)).toBeLessThan(3);
        expect(Math.abs(z.misPt)).toBeLessThan(3);
        expect(Math.abs(z.neeMis)).toBeLessThan(3);
        expect(z.w1).toBeLessThan(-10);
        expect(z.w2).toBeLessThan(-10);
    }, 300_000);
});
