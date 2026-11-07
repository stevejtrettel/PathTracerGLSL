// E³ cubic 3-torus twin (float64). Proves the partition-MIS image scheme before anything is built.
//
// Scene in D = [-L/2, L/2]^3 (L = 1): an opaque Lambert ball (albedo RHO) and a black spherical
// emitter of radiance LE, both off-centre and strictly inside D. Camera at X0 inside D.
// Measurement I_{N,R}: at most N = 4 scattering events; every segment (camera, BSDF, shadow) is cut
// at R_SEG, and the cut part carries 0 (no sky in a closed manifold).
//
// Tracers:
//   torus   — the ray lives in D; at each face exit it teleports by ∓L on that axis and an integer
//             cell offset k accumulates (hit image of an object = its D-position + k·L in the chart
//             of the ray origin). Exact identity of the light image hit, no rounding.
//   crystal — an ordinary E³ scene: every copy (object + k·L) whose distance from X0 minus its radius
//             is ≤ (N+1)·R_SEG, in a generic BVH. No teleports. Lights are separate light copies.
//
// Estimators: pt (BSDF only), pt-nee (NEE; BSDF hits on images IN S(x) weight 0, outside weight 1),
// pt-mis (power heuristic; NEE pdf of an image outside S(x) is 0, so weight 1). Lights are sampled by
// a uniform cone toward the chosen image (pdf 1/(2π(1−cos α)), sin α = r/d).
//
// Run from the repo root:  npx tsx <this dir>/torus.ts job <name> <Q0|Q1> <samples> <seed>
//                          npx tsx <this dir>/torus.ts list

import { Rng, Acc } from "./common.ts";

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addS = (a: V3, b: V3, s: number): V3 => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.sqrt(dot(a, a));
const nrm = (a: V3): V3 => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };
const crs = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ---------------- scene ----------------
const L = 1, H = L / 2;
const BALL = { c: [0.12, -0.17, 0.08] as V3, r: 0.3 };
const LIGHT = { c: [-0.31, 0.29, -0.27] as V3, r: 0.1 };
const RHO = 0.7, LE = 10, NB = Number(process.env.NB ?? 4); // NB: maxBounces (env override for direct-only runs)
let RSEG = 4;
const X0: V3 = [0.3, 0.35, 0.3];
const Q1DIR: V3 = nrm(sub(addS(BALL.c, [0.15, 0.1, -0.05], 1), X0));
const TMIN = 1e-6; // spawn offset; the crystal needs it (absolute coordinates up to ~20), the torus would not

type Hit = { kind: 0 | 1 | 2; t: number; p: V3; n: V3; k: V3; cross: number };
const NONE: Hit = { kind: 0, t: Infinity, p: [0, 0, 0], n: [0, 0, 0], k: [0, 0, 0], cross: 0 };

function sphereT(o: V3, d: V3, c: V3, r: number, tmin: number, tmax: number): number {
  const oc = sub(o, c);
  const b = dot(oc, d), cc = dot(oc, oc) - r * r;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  const t1 = -b - s; if (t1 > tmin && t1 <= tmax) return t1;
  const t2 = -b + s; if (t2 > tmin && t2 <= tmax) return t2;
  return Infinity;
}

// statistics of the walk
const segStats = { segs: 0, cross: 0, maxCross: 0, clipped: 0, shadowSegs: 0, shadowCross: 0, shadowMax: 0, ties: 0 };

// ---------------- torus tracer (teleporting) ----------------
function traceTorus(o: V3, d: V3, shadow: boolean): Hit {
  let p: V3 = [o[0], o[1], o[2]];
  const k: V3 = [0, 0, 0];
  let tacc = 0, cross = 0;
  const done = (h: Hit) => {
    if (shadow) { segStats.shadowSegs++; segStats.shadowCross += cross; segStats.shadowMax = Math.max(segStats.shadowMax, cross); }
    else { segStats.segs++; segStats.cross += cross; segStats.maxCross = Math.max(segStats.maxCross, cross); if (h.kind === 0) segStats.clipped++; }
    return h;
  };
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
      return done({ kind: isL ? 2 : 1, t: tacc + tt, p: ph, n: [(ph[0] - c[0]) / r, (ph[1] - c[1]) / r, (ph[2] - c[2]) / r], k: [k[0], k[1], k[2]], cross });
    }
    if (tex >= RSEG - tacc) return done(NONE);
    p = addS(p, d, tex);
    let nAx = 0;
    for (let i = 0; i < 3; i++) if (ti[i] <= tex * (1 + 1e-12) + 1e-15) { const s = d[i] > 0 ? 1 : -1; p[i] -= s * L; k[i] += s; nAx++; }
    if (nAx > 1) segStats.ties++;
    tacc += tex; cross++;
  }
}

// ---------------- crystal (ordinary E³ scene, generic BVH) ----------------
class SphereBVH {
  cx: Float64Array; cy: Float64Array; cz: Float64Array; r: Float64Array; kind: Uint8Array; key: Int32Array;
  order: Int32Array;
  bmin: number[] = []; bmax: number[] = []; left: number[] = []; right: number[] = []; start: number[] = []; count: number[] = [];
  constructor(sph: { c: V3; r: number; kind: 1 | 2; k: V3 }[]) {
    const n = sph.length;
    this.cx = new Float64Array(n); this.cy = new Float64Array(n); this.cz = new Float64Array(n); this.r = new Float64Array(n);
    this.kind = new Uint8Array(n); this.key = new Int32Array(3 * n); this.order = new Int32Array(n);
    sph.forEach((s, i) => { this.cx[i] = s.c[0]; this.cy[i] = s.c[1]; this.cz[i] = s.c[2]; this.r[i] = s.r; this.kind[i] = s.kind; this.key.set(s.k, 3 * i); this.order[i] = i; });
    this.build(0, n);
  }
  private build(s: number, e: number): number {
    const id = this.left.length;
    this.left.push(-1); this.right.push(-1); this.start.push(s); this.count.push(e - s);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    const cmn = [Infinity, Infinity, Infinity], cmx = [-Infinity, -Infinity, -Infinity];
    for (let j = s; j < e; j++) {
      const i = this.order[j]; const c = [this.cx[i], this.cy[i], this.cz[i]];
      for (let a = 0; a < 3; a++) {
        mn[a] = Math.min(mn[a], c[a] - this.r[i]); mx[a] = Math.max(mx[a], c[a] + this.r[i]);
        cmn[a] = Math.min(cmn[a], c[a]); cmx[a] = Math.max(cmx[a], c[a]);
      }
    }
    this.bmin.push(...mn); this.bmax.push(...mx);
    if (e - s <= 4) return id;
    let ax = 0; for (let a = 1; a < 3; a++) if (cmx[a] - cmn[a] > cmx[ax] - cmn[ax]) ax = a;
    const arr = [this.cx, this.cy, this.cz][ax];
    const sl = Array.from(this.order.subarray(s, e)).sort((u, v) => arr[u] - arr[v]);
    this.order.set(sl, s);
    const m = (s + e) >> 1;
    const l = this.build(s, m), r = this.build(m, e);
    this.left[id] = l; this.right[id] = r; this.count[id] = 0;
    return id;
  }
  private slab(nd: number, o: V3, inv: V3, tmax: number): boolean {
    let t0 = 0, t1 = tmax;
    for (let a = 0; a < 3; a++) {
      let ta = (this.bmin[3 * nd + a] - o[a]) * inv[a], tb = (this.bmax[3 * nd + a] - o[a]) * inv[a];
      if (ta > tb) { const q = ta; ta = tb; tb = q; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
      if (t0 > t1) return false;
    }
    return true;
  }
  closest(o: V3, d: V3, tmin: number, tmax: number): { i: number; t: number } {
    const inv: V3 = [1 / d[0], 1 / d[1], 1 / d[2]];
    const stack = [0]; let best = -1, bt = tmax;
    while (stack.length) {
      const nd = stack.pop()!;
      if (!this.slab(nd, o, inv, bt)) continue;
      if (this.left[nd] < 0) {
        for (let j = this.start[nd]; j < this.start[nd] + this.count[nd]; j++) {
          const i = this.order[j];
          const t = sphereT(o, d, [this.cx[i], this.cy[i], this.cz[i]], this.r[i], tmin, bt);
          if (t < bt) { bt = t; best = i; }
        }
      } else { stack.push(this.left[nd], this.right[nd]); }
    }
    return { i: best, t: bt };
  }
  /** indices of spheres whose centre is within R of x */
  within(x: V3, R: number): number[] {
    const out: number[] = []; const stack = [0];
    while (stack.length) {
      const nd = stack.pop()!;
      let dd = 0;
      for (let a = 0; a < 3; a++) { const v = Math.max(this.bmin[3 * nd + a] - x[a], 0, x[a] - this.bmax[3 * nd + a]); dd += v * v; }
      if (dd > R * R) continue;
      if (this.left[nd] < 0) {
        for (let j = this.start[nd]; j < this.start[nd] + this.count[nd]; j++) {
          const i = this.order[j];
          const e = [this.cx[i] - x[0], this.cy[i] - x[1], this.cz[i] - x[2]];
          if (e[0] * e[0] + e[1] * e[1] + e[2] * e[2] <= R * R) out.push(i);
        }
      } else stack.push(this.left[nd], this.right[nd]);
    }
    return out;
  }
}

let crystalAll: SphereBVH | null = null, crystalLights: SphereBVH | null = null;
function buildCrystal() {
  const RTOT = process.env.CRYSTAL_R ? Number(process.env.CRYSTAL_R) : (NB + 1) * RSEG;
  const K = Math.ceil(RTOT / L) + 2;
  const all: { c: V3; r: number; kind: 1 | 2; k: V3 }[] = [], lights: typeof all = [];
  for (let a = -K; a <= K; a++) for (let b = -K; b <= K; b++) for (let c = -K; c <= K; c++) {
    for (const [obj, kind] of [[BALL, 1], [LIGHT, 2]] as const) {
      const cen: V3 = [obj.c[0] + a * L, obj.c[1] + b * L, obj.c[2] + c * L];
      if (len(sub(cen, X0)) - obj.r <= RTOT) {
        const s = { c: cen, r: obj.r, kind: kind as 1 | 2, k: [a, b, c] as V3 };
        all.push(s); if (kind === 2) lights.push(s);
      }
    }
  }
  crystalAll = new SphereBVH(all); crystalLights = new SphereBVH(lights);
  return { spheres: all.length, lights: lights.length, RTOT };
}
function traceCrystal(o: V3, d: V3, shadow: boolean): Hit {
  const { i, t } = crystalAll!.closest(o, d, TMIN, RSEG);
  if (!shadow) { segStats.segs++; if (i < 0) segStats.clipped++; } else segStats.shadowSegs++;
  if (i < 0) return NONE;
  const B = crystalAll!;
  const c: V3 = [B.cx[i], B.cy[i], B.cz[i]], r = B.r[i];
  const ph = addS(o, d, t);
  return { kind: B.kind[i] as 1 | 2, t, p: ph, n: [(ph[0] - c[0]) / r, (ph[1] - c[1]) / r, (ph[2] - c[2]) / r], k: [B.key[3 * i], B.key[3 * i + 1], B.key[3 * i + 2]], cross: 0 };
}

// ---------------- light-image selection ----------------
// An image of the light is named by its lattice vector k relative to the chart of the vertex x; its
// centre in that chart is c_L + k·L (in the torus x ∈ D; in the crystal the chart is absolute).
const center = (k: V3): V3 => [LIGHT.c[0] + k[0] * L, LIGHT.c[1] + k[1] * L, LIGHT.c[2] + k[2] * L];
/** Unoccluded solid angle of the image / 2π, 0 if its whole cone is below x's tangent plane. */
function solidW(x: V3, n: V3, C: V3): number {
  const e = sub(C, x), d = len(e);
  const s = Math.min(1, LIGHT.r / d);
  if (dot(e, n) / d < -s) return 0;
  return 1 - Math.sqrt(1 - s * s);
}
type Prep = { ks: V3[]; w: number[]; W: number; aux?: any };
interface Selector {
  prepare(x: V3, n: V3): Prep;
  /** NEE probability that this selector picks image k at vertex (x, n) with prepared data; 0 = not in S(x) */
  psel(prep: Prep, x: V3, n: V3, k: V3): number;
}
const cube27: V3[] = []; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) cube27.push([a, b, c]);
const inf = (k: V3) => Math.max(Math.abs(k[0]), Math.abs(k[1]), Math.abs(k[2]));
const eqK = (a: V3, b: V3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const nearestK = (x: V3): V3 => [Math.round((x[0] - LIGHT.c[0]) / L), Math.round((x[1] - LIGHT.c[1]) / L), Math.round((x[2] - LIGHT.c[2]) / L)];

const SEL: Record<string, Selector> = {
  // fixed patch {-1,0,1}^3 around D, uniform 1/27 (torus-code's default)
  U27: { prepare: () => ({ ks: cube27, w: cube27.map(() => 1), W: 27 }), psel: (_p, _x, _n, k) => (inf(k) <= 1 ? 1 / 27 : 0) },
  // fixed patch, p ∝ unoccluded solid angle with the exact horizon cull
  W27: {
    prepare: (x, n) => { const w = cube27.map((k) => solidW(x, n, center(k))); return { ks: cube27, w, W: w.reduce((a, b) => a + b, 0) }; },
    psel: (p, x, n, k) => (inf(k) <= 1 && p.W > 0 ? solidW(x, n, center(k)) / p.W : 0),
  },
  // the nearest image of the light centre only (p = 1)
  NEAR: { prepare: (x) => ({ ks: [nearestK(x)], w: [1], W: 1 }), psel: (p, _x, _n, k) => (eqK(k, p.ks[0]) ? 1 : 0) },
  // WRONG on purpose: NEE uses the fixed patch, the BSDF side tests the x-centred block
  W2: { prepare: () => ({ ks: cube27, w: cube27.map(() => 1), W: 27 }), psel: (_p, x, _n, k) => { const n0 = nearestK(x); return inf(sub(k, n0) as V3) <= 1 ? 1 / 27 : 0; } },
};
function ballSelector(RS: number, weighted: boolean): Selector {
  // S(x) = images whose centre is within RS of x and not wholly below the horizon
  const inS = (x: V3, n: V3, k: V3) => { const C = center(k); return len(sub(C, x)) <= RS ? solidW(x, n, C) : 0; };
  return {
    prepare: (x, n) => {
      const ks: V3[] = [], w: number[] = [];
      const lo = (i: number) => Math.floor((x[i] - LIGHT.c[i] - RS) / L), hi = (i: number) => Math.ceil((x[i] - LIGHT.c[i] + RS) / L);
      for (let a = lo(0); a <= hi(0); a++) for (let b = lo(1); b <= hi(1); b++) for (let c = lo(2); c <= hi(2); c++) {
        const k: V3 = [a, b, c]; const s = inS(x, n, k);
        if (s > 0) { ks.push(k); w.push(weighted ? s : 1); }
      }
      return { ks, w, W: w.reduce((a, b) => a + b, 0) };
    },
    psel: (p, x, n, k) => { const s = inS(x, n, k); return s > 0 && p.W > 0 ? (weighted ? s : 1) / p.W : 0; },
  };
}
SEL["BALL2"] = ballSelector(2, false);
SEL["BALL2w"] = ballSelector(2, true);
SEL["BALL3w"] = ballSelector(3, true);
// Crystal: every light copy within reach R_SEG + r_L of x (an ordinary range query over the light
// list), uniform. A BSDF hit at t ≤ R_SEG always has its copy in this set.
SEL["REACH"] = {
  prepare: (x) => { const idx = crystalLights!.within(x, RSEG + LIGHT.r); const B = crystalLights!; const ks = idx.map((i) => [B.key[3 * i], B.key[3 * i + 1], B.key[3 * i + 2]] as V3); return { ks, w: ks.map(() => 1), W: ks.length }; },
  psel: (p, x, _n, k) => (len(sub(center(k), x)) <= RSEG + LIGHT.r && p.W > 0 ? 1 / p.W : 0),
};

// Crystal version of BALL(RS): an ordinary range query over the light-copy list, filtered and
// weighted by the same rule, sorted lexicographically by copy index so that the image picked by a
// given random number is the same image as in the torus selector (paired comparison).
function crystalBall(RS: number, weighted: boolean): Selector {
  const inS = (x: V3, n: V3, k: V3) => { const C = center(k); return len(sub(C, x)) <= RS ? solidW(x, n, C) : 0; };
  return {
    prepare: (x, n) => {
      const B = crystalLights!;
      const ks = B.within(x, RS).map((i) => [B.key[3 * i], B.key[3 * i + 1], B.key[3 * i + 2]] as V3)
        .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
      const keep: V3[] = [], w: number[] = [];
      for (const k of ks) { const s = inS(x, n, k); if (s > 0) { keep.push(k); w.push(weighted ? s : 1); } }
      return { ks: keep, w, W: w.reduce((a, b) => a + b, 0) };
    },
    psel: (p, x, n, k) => { const s = inS(x, n, k); return s > 0 && p.W > 0 ? (weighted ? s : 1) / p.W : 0; },
  };
}
SEL["CBALL2"] = crystalBall(2, false);
SEL["CBALL2w"] = crystalBall(2, true);

// ---------------- integrator ----------------
function frame(n: V3): [V3, V3] {
  const a: V3 = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t = nrm(crs(n, a)); return [t, crs(n, t)];
}
function aroundAxis(n: V3, ct: number, phi: number): V3 {
  const [t, b] = frame(n); const st = Math.sqrt(Math.max(0, 1 - ct * ct));
  return [st * Math.cos(phi) * t[0] + st * Math.sin(phi) * b[0] + ct * n[0], st * Math.cos(phi) * t[1] + st * Math.sin(phi) * b[1] + ct * n[1], st * Math.cos(phi) * t[2] + st * Math.sin(phi) * b[2] + ct * n[2]];
}
const pcone = (d: number) => 1 / (2 * Math.PI * (1 - Math.sqrt(1 - Math.min(1, (LIGHT.r / d) ** 2))));

// contribution of BSDF light hits by distance to the image centre (bins of 1), pt only
const DHIST = new Array(9).fill(0);
type Mode = "pt" | "nee" | "mis" | "w1";
const neeStats = { shadow: 0, visible: 0, empty: 0, setSize: new Acc(), beyondSum: 0, beyondVisible: 0 };
function radiance(trace: (o: V3, d: V3, sh: boolean) => Hit, sel: Selector | null, mode: Mode, d0: V3, rng: Rng): number {
  let Lr = 0, beta = 1;
  let hit = trace(X0, d0, false);
  if (hit.kind === 2) return LE;
  for (let bounce = 1; hit.kind === 1 && bounce <= NB; bounce++) {
    const x = hit.p, n = hit.n;
    const prep = mode === "pt" ? null : sel!.prepare(x, n);
    if (prep) {
      neeStats.setSize.add(prep.ks.length);
      if (prep.W > 0) {
        // pick an image with probability w/W
        let u = rng.next() * prep.W, j = 0;
        while (j < prep.ks.length - 1 && u >= prep.w[j]) { u -= prep.w[j]; j++; }
        const k = prep.ks[j], C = center(k), ps = prep.w[j] / prep.W;
        const e = sub(C, x), dC = len(e), u0: V3 = [e[0] / dC, e[1] / dC, e[2] / dC];
        const cosA = Math.sqrt(1 - Math.min(1, (LIGHT.r / dC) ** 2));
        const wi = aroundAxis(u0, 1 - rng.next() * (1 - cosA), 2 * Math.PI * rng.next());
        const cx = dot(wi, n);
        const tl = sphereT(x, wi, C, LIGHT.r, TMIN, Infinity);
        const noclip = !!process.env.NEE_NOCLIP;
        if (cx > 0 && (noclip || tl <= RSEG)) {
          neeStats.shadow++;
          const saved = RSEG; if (noclip) RSEG = 1000;
          const sh = trace(x, wi, true);
          RSEG = saved;
          if (sh.kind === 2 && Math.abs(sh.t - tl) < 1e-7 * (1 + tl)) {
            neeStats.visible++;
            const pn = ps * pcone(dC), pb = cx / Math.PI;
            const w = mode === "mis" ? (pn * pn) / (pn * pn + pb * pb) : 1;
            Lr += beta * (RHO / Math.PI) * LE * cx / pn * w;
            if (tl > saved) { neeStats.beyondVisible++; neeStats.beyondSum += beta * (RHO / Math.PI) * LE * cx / pn * w; }
          }
        }
      } else neeStats.empty++;
    }
    // BSDF: cosine sampling, f·cos/pdf = RHO
    const ct = Math.sqrt(rng.next());
    const wo = aroundAxis(n, ct, 2 * Math.PI * rng.next());
    beta *= RHO;
    const h2 = trace(x, wo, false);
    if (h2.kind === 2) {
      let w = 1;
      if (mode !== "pt") {
        const ps = sel!.psel(prep!, x, n, h2.k);
        const pn = ps > 0 ? ps * pcone(len(sub(center(h2.k), x))) : 0, pb = ct / Math.PI;
        if (mode === "nee") w = pn > 0 ? 0 : 1;
        else if (mode === "w1") w = 0;
        else w = (pb * pb) / (pb * pb + pn * pn);
      }
      Lr += beta * LE * w;
      if (mode === "pt") { const dd = len(sub(center(h2.k), x)); DHIST[Math.min(DHIST.length - 1, Math.floor(dd))] += beta * LE; }
      break;
    }
    hit = h2;
  }
  return Lr;
}

function uniformDir(rng: Rng): V3 {
  const z = 1 - 2 * rng.next(), ph = 2 * Math.PI * rng.next(), s = Math.sqrt(1 - z * z);
  return [s * Math.cos(ph), s * Math.sin(ph), z];
}

// ---------------- jobs ----------------
// name → [tracer, selector, mode]
const JOBS: Record<string, [string, string | null, Mode]> = {
  "pt": ["torus", null, "pt"],
  "U27-nee": ["torus", "U27", "nee"], "U27-mis": ["torus", "U27", "mis"],
  "W27-nee": ["torus", "W27", "nee"], "W27-mis": ["torus", "W27", "mis"],
  "NEAR-mis": ["torus", "NEAR", "mis"],
  "BALL2-mis": ["torus", "BALL2", "mis"], "BALL2w-mis": ["torus", "BALL2w", "mis"], "BALL3w-mis": ["torus", "BALL3w", "mis"],
  "crystal-pt": ["crystal", null, "pt"], "crystal-mis": ["crystal", "REACH", "mis"], "crystal-nee": ["crystal", "REACH", "nee"],
  "crystal-BALL2-mis": ["crystal", "CBALL2", "mis"], "crystal-BALL2w-mis": ["crystal", "CBALL2w", "mis"], "crystal-BALL2-nee": ["crystal", "CBALL2", "nee"],
  "BALL2-nee": ["torus", "BALL2", "nee"],
  "WRONG-W1": ["torus", "U27", "w1"], "WRONG-W2": ["torus", "W2", "mis"],
};

function main() {
  const [cmd, name, q, nS, seedS, rsegS] = process.argv.slice(2);
  if (cmd === "list") { console.log(Object.keys(JOBS).join("\n")); return; }
  if (cmd === "check") {
    // sanity: objects inside D, Q1 ray hits the ball; finite-horizon probe along an axis through a gap
    const inside = (o: { c: V3; r: number }) => o.c.every((v) => Math.abs(v) + o.r < H);
    console.log(JSON.stringify({ ballInside: inside(BALL), lightInside: inside(LIGHT), sep: len(sub(BALL.c, LIGHT.c)) - BALL.r - LIGHT.r, q1: traceTorus(X0, Q1DIR, false).kind }));
    // a line x = 0.45, y = 0.45 along z: misses every image of both spheres → infinite free path
    RSEG = 1000;
    const h = traceTorus([0.45, 0.45, 0], [0, 0, 1], false);
    console.log(JSON.stringify({ axisLineHit: h.kind, crossings: segStats.cross }));
    return;
  }
  if (rsegS) RSEG = Number(rsegS);
  if (cmd === "debug") {
    buildCrystal();
    const idx = Number(name);
    for (const tr of ["torus", "crystal"]) {
      const r = new Rng(Number(seedS));
      const T = tr === "torus" ? traceTorus : traceCrystal;
      const log = (o: V3, d: V3, sh: boolean) => { const h = T(o, d, sh); if (!sh) console.log(tr, "seg from", o.map((v) => v.toFixed(4)).join(","), "kind", h.kind, "t", h.t.toFixed(6), "k", h.k.join(","), "cross", h.cross); return h; };
      for (let s = 0; s < idx; s++) radiance(T, null, "pt", uniformDir(r), r);
      console.log(tr, "value", radiance(log, null, "pt", uniformDir(r), r));
    }
    return;
  }
  if (cmd === "paired") {
    // same random stream through a torus job and a crystal job; compare path by path
    const [jobA, jobB] = name.split(",");
    const info = buildCrystal();
    const N = Number(nS), diffs: any[] = []; let nd = 0; const da = new Acc(), a = new Acc(), b = new Acc();
    const t0 = Date.now();
    const ra = new Rng(Number(seedS)), rb = new Rng(Number(seedS));
    const run = (job: string, r: Rng, d: V3 | null) => { const [tr, sn, md] = JOBS[job]; return radiance(tr === "torus" ? traceTorus : traceCrystal, sn ? SEL[sn] : null, md, d ?? uniformDir(r), r); };
    for (let s = 0; s < N; s++) {
      const va = run(jobA, ra, q === "Q0" ? null : Q1DIR), vb = run(jobB, rb, q === "Q0" ? null : Q1DIR);
      a.add(va); b.add(vb); da.add(va - vb);
      if (Math.abs(va - vb) > 1e-9 * (1 + Math.abs(va))) { nd++; if (diffs.length < 5) diffs.push([s, va, vb]); }
    }
    console.log(JSON.stringify({ space: "E3", paired: name, q, rseg: RSEG, n: N, ms: Date.now() - t0, ...info, meanA: a.mean, meanB: b.mean, seA: a.se, pathsDiffering: nd, meanDiff: da.mean, seDiff: da.se, firstDiffs: diffs }));
    return;
  }
  const [tr, selName, mode] = JOBS[name];
  let info: any = {};
  if (tr === "crystal") info = buildCrystal();
  const trace = tr === "torus" ? traceTorus : traceCrystal;
  const sel = selName ? SEL[selName] : null;
  const rng = new Rng(Number(seedS));
  const acc = new Acc(); const N = Number(nS);
  const t0 = Date.now();
  for (let s = 0; s < N; s++) acc.add(radiance(trace, sel, mode, q === "Q0" ? uniformDir(rng) : Q1DIR, rng));
  console.log(JSON.stringify({
    space: "E3", name, q, nb: NB, rseg: RSEG, n: acc.n, mean: acc.mean, se: acc.se, var: acc.variance, ms: Date.now() - t0, ...info,
    segs: segStats.segs, crossPerSeg: segStats.cross / segStats.segs, maxCross: segStats.maxCross, clippedFrac: segStats.clipped / segStats.segs,
    shadowRays: segStats.shadowSegs, shadowCrossPerRay: segStats.shadowCross / Math.max(1, segStats.shadowSegs), shadowMaxCross: segStats.shadowMax, ties: segStats.ties,
    dHistPerPath: DHIST.map((v) => +(v / acc.n).toFixed(5)), neeVisibleFrac: neeStats.visible / Math.max(1, neeStats.shadow), meanSetSize: neeStats.setSize.mean, emptySets: neeStats.empty, beyondVisible: neeStats.beyondVisible, beyondPerPath: neeStats.beyondSum / acc.n,
  }));
}
main();
