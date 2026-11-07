// Seifert–Weber twin (float64). Same estimators as torus.ts, in H³ (hyperboloid model).
//
// Conventions (as in ../seifert-weber/sw.ts, whose geometry is copied here): points [x,y,z,w] with
// <a,b> = a_x b_x + a_y b_y + a_z b_z − a_w b_w; H³ = {<p,p> = −1, w > 0}; o = (0,0,0,1).
// D is the regular dodecahedron at o with dihedral angle 2π/5; face i has outward unit normal N_i;
// a ray exiting through face i is mapped by g_i (g_{2k} = T(−2 r_in u_k)·R(u_k, 3π/5), g_{2k+1} = g_{2k}⁻¹).
// The cell across face i is g_i⁻¹ D.
//
// Scene (strictly inside D): an opaque Lambert ball (albedo RHO) and a black spherical emitter (LE).
// Measurement I_{N,R}: at most N = 4 scattering events, every segment cut at R_SEG.
// H³ facts used: geodesic γ(s) = cosh s·p + sinh s·v; a sphere of radius R at distance d is seen as a
// cone of half-angle α with sin α = sinh R / sinh d (hyperbolic right triangle); radiance is constant
// along geodesics, so direct light = ∫ f·Le·cos dω over the visible cones.
//
// Run from the repo root:
//   npx tsx <dir>/sw_twin.ts check | firsthit <rays> | list | job <name> <Q0|Q1> <samples> <seed> [rseg]

import { Rng, Acc } from "./common.ts";

type V4 = number[];
type M4 = Float64Array;
const mink = (a: V4, b: V4) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] - a[3] * b[3];
const lin = (a: V4, sa: number, b: V4, sb: number): V4 => [sa * a[0] + sb * b[0], sa * a[1] + sb * b[1], sa * a[2] + sb * b[2], sa * a[3] + sb * b[3]];
const scl = (a: V4, s: number): V4 => [a[0] * s, a[1] * s, a[2] * s, a[3] * s];
function apply(M: M4, x: V4): V4 {
  return [0, 1, 2, 3].map((i) => M[4 * i] * x[0] + M[4 * i + 1] * x[1] + M[4 * i + 2] * x[2] + M[4 * i + 3] * x[3]);
}
function mul(A: M4, B: M4): M4 {
  const C = new Float64Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += A[4 * i + k] * B[4 * k + j]; C[4 * i + j] = s; }
  return C;
}
function eye(): M4 { const I = new Float64Array(16); I[0] = I[5] = I[10] = I[15] = 1; return I; }
function minv(M: M4): M4 { const s = [1, 1, 1, -1]; const R = new Float64Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) R[4 * i + j] = s[i] * s[j] * M[4 * j + i]; return R; }
const hdist = (a: V4, b: V4) => Math.acosh(Math.max(1, -mink(a, b)));
const O: V4 = [0, 0, 0, 1];
function rot(u: number[], th: number): M4 {
  const c = Math.cos(th), s = Math.sin(th), C = 1 - c; const [x, y, z] = u;
  return Float64Array.from([c + x * x * C, x * y * C - z * s, x * z * C + y * s, 0, y * x * C + z * s, c + y * y * C, y * z * C - x * s, 0, z * x * C - y * s, z * y * C + x * s, c + z * z * C, 0, 0, 0, 0, 1]);
}
function trans(u: number[], t: number): M4 {
  const ch = Math.cosh(t) - 1, sh = Math.sinh(t); const M = eye();
  for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) M[4 * i + j] += ch * u[i] * u[j]; M[4 * i + 3] = sh * u[i]; M[12 + i] = sh * u[i]; }
  M[15] = Math.cosh(t); return M;
}
/** point at distance s from o in Euclidean direction u */
const pointAt = (u: number[], s: number): V4 => { const n = Math.hypot(u[0], u[1], u[2]); return [Math.sinh(s) * u[0] / n, Math.sinh(s) * u[1] / n, Math.sinh(s) * u[2] / n, Math.cosh(s)]; };

// ---------------- the dodecahedron and its pairings (from ../seifert-weber/sw.ts) ----------------
const SQ5 = Math.sqrt(5), PHI = (1 + SQ5) / 2;
const rIn = Math.acosh(Math.sqrt((5 + 2 * SQ5) / 4));
const rCirc = Math.acosh((7 + 3 * SQ5) / 4);
const THETA = (3 * Math.PI) / 5;
const dirs0 = [[0, 1, PHI], [0, 1, -PHI], [1, PHI, 0], [1, -PHI, 0], [PHI, 0, 1], [-PHI, 0, 1]];
const nhat: number[][] = [];
for (const d of dirs0) { const n = Math.hypot(d[0], d[1], d[2]); const u = d.map((x) => x / n); nhat.push(u, u.map((x) => -x)); }
const NF = 12;
const NRM: V4[] = nhat.map((u) => [u[0] * Math.cosh(rIn), u[1] * Math.cosh(rIn), u[2] * Math.cosh(rIn), Math.sinh(rIn)]);
const G: M4[] = [];
for (let k = 0; k < 6; k++) { const u = nhat[2 * k]; const g = mul(trans(u.map((x) => -x), 2 * rIn), rot(u, THETA)); G.push(g, minv(g)); }
const faceDist = (p: V4) => Math.min(...NRM.map((n) => -Math.asinh(mink(n, p)))); // distance from p to ∂D (p in D)

// ---------------- scene ----------------
const BALL = { c: pointAt([0.3, -0.5, 0.2], 0.12), R: 0.72 };
const LIGHT = { c: pointAt([-1, 1, -1], 1.12), R: 0.2 };
const RHO = 0.7, LE = 10, NB = Number(process.env.NB ?? 4); // NB: maxBounces (env override for direct-only runs)
let RSEG = 8;
const X0: V4 = pointAt([-0.2, -0.6, 0.75], 0.88);
const TMIN = 1e-7;
const coshB = Math.cosh(BALL.R), coshL = Math.cosh(LIGHT.R), sinhL = Math.sinh(LIGHT.R);

/** smallest s in (smin, smax] where the geodesic (p, v) meets the sphere (c, R), else Infinity */
function sphereS(p: V4, v: V4, c: V4, coshR: number, smin: number, smax: number): number {
  const a = -mink(p, c), b = -mink(v, c);
  const disc = coshR * coshR - (a * a - b * b); // a² − b² = cosh² (distance from c to the geodesic)
  if (disc < 0) return Infinity;
  const sq = Math.sqrt(disc);
  const u1 = (a - b) / (coshR + sq), u2 = (coshR + sq) / (a + b); // roots of (a+b)u² − 2C u + (a−b) = 0, u = e^s
  const s1 = Math.log(u1); if (s1 > smin && s1 <= smax) return s1;
  const s2 = Math.log(u2); if (s2 > smin && s2 <= smax) return s2;
  return Infinity;
}
/** outward unit normal of sphere centre c at y */
function sphereN(y: V4, c: V4): V4 { const t = lin(c, 1, y, mink(c, y)); const s = Math.sqrt(mink(t, t)); return scl(t, -1 / s); }

type Hit = { kind: 0 | 1 | 2; t: number; p: V4; v: V4; n: V4; cross: number };
const NONE: Hit = { kind: 0, t: Infinity, p: O, v: O, n: O, cross: 0 };
const segStats = { segs: 0, cross: 0, maxCross: 0, clipped: 0, zeroLen: 0, shadowSegs: 0, shadowCross: 0, shadowMax: 0, maxDefect: 0 };

// ---------------- the teleporting walk ----------------
function traceSW(p0: V4, v0: V4, shadow: boolean): Hit {
  let p = p0, v = v0, tacc = 0, cross = 0;
  const done = (h: Hit) => {
    if (shadow) { segStats.shadowSegs++; segStats.shadowCross += cross; segStats.shadowMax = Math.max(segStats.shadowMax, cross); }
    else { segStats.segs++; segStats.cross += cross; segStats.maxCross = Math.max(segStats.maxCross, cross); if (h.kind === 0) segStats.clipped++; }
    return h;
  };
  for (;;) {
    let tau = Infinity, f = -1;
    for (let i = 0; i < NF; i++) {
      const b = mink(NRM[i], v); if (b <= 0) continue;
      const t = Math.max(-mink(NRM[i], p) / b, 0);
      if (t < tau) { tau = t; f = i; }
    }
    if (f < 0 || tau >= 1) throw new Error("no exit");
    const sExit = Math.atanh(tau);
    const sLim = Math.min(sExit, RSEG - tacc);
    const sb = sphereS(p, v, BALL.c, coshB, TMIN, sLim), sl = sphereS(p, v, LIGHT.c, coshL, TMIN, sLim);
    if (sb < Infinity || sl < Infinity) {
      const isL = sl < sb, s = isL ? sl : sb, ch = Math.cosh(s), sh = Math.sinh(s);
      const y = lin(p, ch, v, sh), vh = lin(p, sh, v, ch);
      return done({ kind: isL ? 2 : 1, t: tacc + s, p: y, v: vh, n: sphereN(y, isL ? LIGHT.c : BALL.c), cross });
    }
    if (sExit >= RSEG - tacc) return done(NONE);
    // exit point and direction without cosh/sinh, then renormalize (the constraint is unstable)
    const q = lin(p, 1, v, tau), w = lin(v, 1, p, tau);
    const pn = scl(q, 1 / Math.sqrt(-mink(q, q)));
    let vn = lin(w, 1, pn, mink(w, pn)); vn = scl(vn, 1 / Math.sqrt(mink(vn, vn)));
    p = apply(G[f], pn); v = apply(G[f], vn);
    if (tau < 1e-12) segStats.zeroLen++;
    segStats.maxDefect = Math.max(segStats.maxDefect, Math.abs(mink(p, p) + 1), Math.abs(mink(v, v) - 1), Math.abs(mink(p, v)));
    tacc += sExit; cross++;
  }
}

// ---------------- tangent-space helpers ----------------
/** two unit tangents at x orthogonal to the unit tangent n */
function frame(x: V4, n: V4): [V4, V4] {
  const out: V4[] = [];
  for (const e of [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]) {
    let t = lin(e, 1, x, mink(e, x));           // project onto T_x
    t = lin(t, 1, n, -mink(t, n));
    for (const o of out) t = lin(t, 1, o, -mink(t, o));
    const s = mink(t, t); if (s < 1e-6) continue;
    out.push(scl(t, 1 / Math.sqrt(s)));
    if (out.length === 2) break;
  }
  return [out[0], out[1]];
}
function aroundAxis(x: V4, u: V4, ct: number, phi: number): V4 {
  const [e1, e2] = frame(x, u); const st = Math.sqrt(Math.max(0, 1 - ct * ct));
  return [0, 1, 2, 3].map((i) => ct * u[i] + st * Math.cos(phi) * e1[i] + st * Math.sin(phi) * e2[i]);
}
/** unit tangent at x toward the point C, and the distance */
function toward(x: V4, C: V4): [V4, number] {
  const ch = -mink(x, C), d = Math.acosh(Math.max(1, ch));
  return [scl(lin(C, 1, x, -ch), 1 / Math.sinh(d)), d];
}
const sinAlpha = (d: number) => Math.min(1, sinhL / Math.sinh(d));
const pcone = (d: number) => 1 / (2 * Math.PI * (1 - Math.sqrt(1 - sinAlpha(d) ** 2)));
/** unoccluded solid angle / 2π of the light image centred at C seen from (x, n); 0 if wholly below the horizon */
function solidW(x: V4, n: V4, C: V4): number {
  const ch = -mink(x, C), d = Math.acosh(Math.max(1, ch)), sa = sinAlpha(d);
  if (mink(C, n) / Math.sinh(d) < -sa) return 0;
  return 1 - Math.sqrt(1 - sa * sa);
}

// ---------------- light images ----------------
/** BFS over Γ: all γ with d(o, γo) ≤ Rmax (dedupe by γo; Γ acts freely) */
function enumerate(Rmax: number): M4[] {
  const mats: M4[] = [eye()]; const seen = new Set<string>(["0,0,0"]); const chMax = Math.cosh(Rmax);
  for (let h = 0; h < mats.length; h++) for (let i = 0; i < NF; i++) {
    const P = mul(mats[h], G[i]); if (P[15] > chMax) continue;
    const key = `${Math.round(P[3] * 1e4)},${Math.round(P[7] * 1e4)},${Math.round(P[11] * 1e4)}`;
    if (seen.has(key)) continue; seen.add(key); mats.push(P);
  }
  return mats;
}
// S13: the light's own image and its images in the 12 neighbour cells g_i⁻¹ D
const S13: V4[] = [LIGHT.c, ...G.map((g) => apply(minv(g), LIGHT.c))];
// candidate table for ball sets: every image whose centre can be within R_S of a point of D
const RS_MAX = 3;
let CAND: { C: V4; d0: number }[] = [];
function buildCand() {
  const mats = enumerate(rCirc + RS_MAX + hdist(O, LIGHT.c) + 0.05);
  CAND = mats.map((M) => { const C = apply(M, LIGHT.c); return { C, d0: hdist(O, C) }; }).filter((e) => e.d0 <= rCirc + RS_MAX + 1e-9).sort((a, b) => a.d0 - b.d0);
  return { elements: mats.length, candidates: CAND.length };
}
/** index of the S13 image whose ball contains the cover point y, or −1 */
const idS13 = (y: V4) => S13.findIndex((C) => -mink(y, C) <= coshL * (1 + 1e-9));

type Prep = { C: V4[]; w: number[]; W: number };
type HitInfo = { h: Hit; x: V4; v0: V4 };
interface Sel { prepare(x: V4, n: V4): Prep; psel(p: Prep, x: V4, n: V4, hi: HitInfo): number }
const coverPoint = (hi: HitInfo) => lin(hi.x, Math.cosh(hi.h.t), hi.v0, Math.sinh(hi.h.t)); // the hit, unteleported, in x's chart
/** distance from x to the centre of the image hit, from local data at the hit (hyperbolic law of cosines) */
const dLocal = (h: Hit) => Math.acosh(Math.cosh(h.t) * coshL - Math.sinh(h.t) * sinhL * mink(h.v, h.n));
const diag = { lawVsTable: 0, lawChecks: 0, s13HitsByCross: [0, 0, 0, 0, 0] as number[] };

const SEL: Record<string, Sel> = {
  // the in-cell image only; a BSDF hit is that image iff it made no face crossing (D is convex)
  S1: { prepare: () => ({ C: [LIGHT.c], w: [1], W: 1 }), psel: (_p, _x, _n, hi) => (hi.h.cross === 0 ? 1 : 0) },
  // own cell + 12 neighbours, uniform; BSDF side identifies the image by its unteleported position
  S13: { prepare: () => ({ C: S13, w: S13.map(() => 1), W: 13 }), psel: (_p, _x, _n, hi) => { const j = idS13(coverPoint(hi)); if (j >= 0) diag.s13HitsByCross[Math.min(4, hi.h.cross)]++; return j >= 0 ? 1 / 13 : 0; } },
  S13w: {
    prepare: (x, n) => { const w = S13.map((C) => solidW(x, n, C)); return { C: S13, w, W: w.reduce((a, b) => a + b, 0) }; },
    psel: (p, x, n, hi) => { const j = idS13(coverPoint(hi)); return j >= 0 && p.W > 0 ? solidW(x, n, S13[j]) / p.W : 0; },
  },
  // WRONG on purpose: NEE as S13, but the BSDF side calls a hit "in S13" iff it crossed at most one
  // face (word-length membership). A neighbour-cell image reached through an edge region crosses two.
  W2: { prepare: () => ({ C: S13, w: S13.map(() => 1), W: 13 }), psel: (_p, _x, _n, hi) => (hi.h.cross <= 1 ? 1 / 13 : 0) },
};
function ballSel(RS: number, weighted: boolean): Sel {
  return {
    prepare: (x, n) => {
      const C: V4[] = [], w: number[] = []; const dx = hdist(O, x);
      for (const e of CAND) {
        if (e.d0 > dx + RS) break;
        const ch = -mink(x, e.C); if (ch > Math.cosh(RS)) continue;
        const s = solidW(x, n, e.C); if (s > 0) { C.push(e.C); w.push(weighted ? s : 1); }
      }
      return { C, w, W: w.reduce((a, b) => a + b, 0) };
    },
    // membership and weight from the hit's local data only: the hit image is never horizon-culled
    // (the BSDF ray has cos > 0 and lies in that image's cone), so no group element is needed
    psel: (p, x, n, hi) => {
      const d = dLocal(hi.h);
      // diagnostic: the same distance from the table, via the unteleported position
      const y = coverPoint(hi), dy = hdist(O, y);
      for (const e of CAND) { if (e.d0 > dy + LIGHT.R + 1e-6) break; if (e.d0 < dy - LIGHT.R - 1e-6) continue; if (-mink(y, e.C) <= coshL * (1 + 1e-9)) { diag.lawChecks++; diag.lawVsTable = Math.max(diag.lawVsTable, Math.abs(hdist(x, e.C) - d)); break; } }
      if (d > RS || p.W <= 0) return 0;
      return (weighted ? 1 - Math.sqrt(1 - sinAlpha(d) ** 2) : 1) / p.W;
    },
  };
}
SEL["BALL2"] = ballSel(2, false); SEL["BALL2w"] = ballSel(2, true); SEL["BALL3"] = ballSel(3, false); SEL["BALL3w"] = ballSel(3, true);

// ---------------- integrator ----------------
// contribution of BSDF light hits by distance to the image centre (bins of 1), pt only
const DHIST = new Array(9).fill(0);
type Mode = "pt" | "nee" | "mis" | "w1";
const neeStats = { shadow: 0, visible: 0, empty: 0, setSize: new Acc() };
function radiance(sel: Sel | null, mode: Mode, d0: V4, rng: Rng): number {
  let Lr = 0, beta = 1;
  let hit = traceSW(X0, d0, false);
  if (hit.kind === 2) return LE;
  for (let bounce = 1; hit.kind === 1 && bounce <= NB; bounce++) {
    const x = hit.p, n = hit.n;
    const prep = mode === "pt" ? null : sel!.prepare(x, n);
    if (prep) {
      neeStats.setSize.add(prep.C.length);
      if (prep.W > 0) {
        let u = rng.next() * prep.W, j = 0;
        while (j < prep.C.length - 1 && u >= prep.w[j]) { u -= prep.w[j]; j++; }
        const C = prep.C[j], ps = prep.w[j] / prep.W;
        const [u0, dC] = toward(x, C);
        const cosA = Math.sqrt(1 - sinAlpha(dC) ** 2);
        const wi = aroundAxis(x, u0, 1 - rng.next() * (1 - cosA), 2 * Math.PI * rng.next());
        const cx = mink(wi, n);
        const sl = sphereS(x, wi, C, coshL, TMIN, Infinity);
        if (cx > 0 && sl <= RSEG) {
          neeStats.shadow++;
          const sh = traceSW(x, wi, true);
          if (sh.kind === 2 && Math.abs(sh.t - sl) < 1e-6 * (1 + sl)) {
            neeStats.visible++;
            const pn = ps * pcone(dC), pb = cx / Math.PI;
            const w = mode === "mis" ? (pn * pn) / (pn * pn + pb * pb) : 1;
            Lr += beta * (RHO / Math.PI) * LE * cx / pn * w;
          }
        }
      } else neeStats.empty++;
    }
    const ct = Math.sqrt(rng.next());
    const wo = aroundAxis(x, n, ct, 2 * Math.PI * rng.next());
    beta *= RHO;
    const h2 = traceSW(x, wo, false);
    if (h2.kind === 2) {
      let w = 1;
      if (mode !== "pt") {
        const ps = sel!.psel(prep!, x, n, { h: h2, x, v0: wo });
        const pn = ps > 0 ? ps * pcone(dLocal(h2)) : 0, pb = ct / Math.PI;
        if (mode === "nee") w = pn > 0 ? 0 : 1;
        else if (mode === "w1") w = 0;
        else w = (pb * pb) / (pb * pb + pn * pn);
      }
      Lr += beta * LE * w;
      if (mode === "pt") { const dd = dLocal(h2); DHIST[Math.min(DHIST.length - 1, Math.floor(dd))] += beta * LE; }
      break;
    }
    hit = h2;
  }
  return Lr;
}
/** uniform unit tangent at X0 (any isometry T_o → T_x0 preserves uniformity) */
function uniformDir(rng: Rng): V4 {
  const z = 1 - 2 * rng.next(), ph = 2 * Math.PI * rng.next(), s = Math.sqrt(1 - z * z);
  const d = [s * Math.cos(ph), s * Math.sin(ph), z];
  const ch = X0[3], ds = d[0] * X0[0] + d[1] * X0[1] + d[2] * X0[2];
  return [d[0] + (ds / (1 + ch)) * X0[0], d[1] + (ds / (1 + ch)) * X0[1], d[2] + (ds / (1 + ch)) * X0[2], ds];
}
// Q1: a fixed camera ray aimed at a point 0.3 from the ball centre (it hits the ball first)
const Q1DIR: V4 = toward(X0, (() => { const [u] = toward(BALL.c, X0); const [e1] = frame(BALL.c, u); return lin(BALL.c, Math.cosh(0.3), e1, Math.sinh(0.3)); })())[0];

const JOBS: Record<string, [string | null, Mode]> = {
  "pt": [null, "pt"],
  "S1-nee": ["S1", "nee"], "S1-mis": ["S1", "mis"],
  "S13-nee": ["S13", "nee"], "S13-mis": ["S13", "mis"], "S13w-mis": ["S13w", "mis"],
  "BALL2-mis": ["BALL2", "mis"], "BALL2w-mis": ["BALL2w", "mis"], "BALL3-mis": ["BALL3", "mis"], "BALL3w-mis": ["BALL3w", "mis"], "BALL3w-nee": ["BALL3w", "nee"],
  "WRONG-W1": ["S13", "w1"], "WRONG-W2": ["W2", "mis"],
};

function main() {
  const [cmd, name, q, nS, seedS, rsegS] = process.argv.slice(2);
  if (cmd === "list") { console.log(Object.keys(JOBS).join("\n")); return; }
  if (rsegS) RSEG = Number(rsegS);
  if (cmd === "check") {
    const q1 = traceSW(X0, Q1DIR, false);
    console.log(JSON.stringify({
      ballFaceGap: faceDist(BALL.c) - BALL.R, lightFaceGap: faceDist(LIGHT.c) - LIGHT.R, x0FaceGap: faceDist(X0),
      ballLightGap: hdist(BALL.c, LIGHT.c) - BALL.R - LIGHT.R, x0BallGap: hdist(X0, BALL.c) - BALL.R, x0LightGap: hdist(X0, LIGHT.c) - LIGHT.R,
      q1Kind: q1.kind, q1t: q1.t, areaBall: 4 * Math.PI * Math.sinh(BALL.R) ** 2, areaLight: 4 * Math.PI * Math.sinh(LIGHT.R) ** 2,
      santaloMeanFreePath: (4 * 11.1990647) / (4 * Math.PI * (Math.sinh(BALL.R) ** 2 + Math.sinh(LIGHT.R) ** 2)),
      s13MinSep: Math.min(...S13.flatMap((a, i) => S13.slice(i + 1).map((b) => hdist(a, b)))),
      s13Dist: S13.map((C) => +hdist(LIGHT.c, C).toFixed(4)),
    }));
    return;
  }
  if (cmd === "firsthit") {
    // Independent check of walk + pairings: first hits by teleporting vs brute force over the
    // unrolled cover (every image γ·ball, γ·light with γ from a BFS over Γ), same clip.
    const R = Number(q ?? 3); RSEG = R;
    const mats = enumerate(R + hdist(O, X0) + Math.max(hdist(O, BALL.c) + BALL.R, hdist(O, LIGHT.c) + LIGHT.R) + 0.05);
    const imgs = mats.flatMap((M) => [{ c: apply(M, BALL.c), ch: coshB, kind: 1 }, { c: apply(M, LIGHT.c), ch: coshL, kind: 2 }]);
    const rng = new Rng(Number(seedS ?? 5)); const nR = Number(name);
    let bad = 0, maxDt = 0, lightHits = 0, idBad = 0;
    for (let s = 0; s < nR; s++) {
      const d = uniformDir(rng);
      const h = traceSW(X0, d, false);
      let bt = R, bk = 0, bc: V4 = O;
      for (const im of imgs) { const t = sphereS(X0, d, im.c, im.ch, TMIN, bt); if (t < bt) { bt = t; bk = im.kind; bc = im.c; } }
      if (bk !== h.kind) { bad++; continue; }
      if (bk) {
        maxDt = Math.max(maxDt, Math.abs(bt - h.t));
        if (bk === 2) { lightHits++; const dl = dLocal(h), dt = hdist(X0, bc); if (Math.abs(dl - dt) > 1e-8) idBad++; }
      }
    }
    console.log(JSON.stringify({ space: "SW", firsthit: nR, rclip: R, elements: mats.length, kindMismatch: bad, maxAbsDt: maxDt, lightHits, lawOfCosinesMismatch: idBad, crossPerSeg: segStats.cross / segStats.segs, maxCross: segStats.maxCross, zeroLen: segStats.zeroLen, maxDefect: segStats.maxDefect }));
    return;
  }
  const [selName, mode] = JOBS[name];
  const info = buildCand();
  const sel = selName ? SEL[selName] : null;
  const rng = new Rng(Number(seedS)); const acc = new Acc(); const N = Number(nS); const t0 = Date.now();
  for (let s = 0; s < N; s++) acc.add(radiance(sel, mode, q === "Q0" ? uniformDir(rng) : Q1DIR, rng));
  console.log(JSON.stringify({
    space: "SW", name, q, nb: NB, rseg: RSEG, n: acc.n, mean: acc.mean, se: acc.se, var: acc.variance, ms: Date.now() - t0, ...info,
    segs: segStats.segs, crossPerSeg: segStats.cross / segStats.segs, maxCross: segStats.maxCross, clippedFrac: segStats.clipped / segStats.segs, zeroLen: segStats.zeroLen, maxDefect: segStats.maxDefect,
    shadowRays: segStats.shadowSegs, shadowCrossPerRay: segStats.shadowCross / Math.max(1, segStats.shadowSegs), shadowMaxCross: segStats.shadowMax,
    dHistPerPath: DHIST.map((v) => +(v / acc.n).toFixed(5)), neeVisibleFrac: neeStats.visible / Math.max(1, neeStats.shadow), meanSetSize: neeStats.setSize.mean, emptySets: neeStats.empty,
    lawVsTableMaxErr: diag.lawVsTable, lawChecks: diag.lawChecks, s13HitsByCross: diag.s13HitsByCross,
  }));
}
main();
