// Review check (review-0): is "the BSDF ray made exactly one face crossing" the same as "the hit is
// in the neighbour cell g_f^-1 D", in float64 and in simulated float32 (Math.fround after every op)?
// Also checks convexity of D ∪ g_f^-1 D directly (points along x→y lie in D or in g_f^-1 D).
// Geometry copied from ../twin/sw_twin.ts. Run: npx tsx sw_cross.ts <pairs> <seed> <nearEdgeFrac>
import { Rng } from "../twin/common.ts";

type V4 = number[]; type M4 = Float64Array;
let R = (x: number) => x; // rounding hook: identity (float64) or Math.fround (float32)
const mink = (a: V4, b: V4) => R(R(R(R(a[0] * b[0]) + R(a[1] * b[1])) + R(a[2] * b[2])) - R(a[3] * b[3]));
const lin = (a: V4, sa: number, b: V4, sb: number): V4 => [0, 1, 2, 3].map((i) => R(R(sa * a[i]) + R(sb * b[i])));
const scl = (a: V4, s: number): V4 => a.map((x) => R(x * s));
function apply(M: M4, x: V4): V4 { return [0, 1, 2, 3].map((i) => R(R(R(R(M[4 * i] * x[0]) + R(M[4 * i + 1] * x[1])) + R(M[4 * i + 2] * x[2])) + R(M[4 * i + 3] * x[3]))); }
function mul(A: M4, B: M4): M4 { const C = new Float64Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += A[4 * i + k] * B[4 * k + j]; C[4 * i + j] = s; } return C; }
function eye(): M4 { const I = new Float64Array(16); I[0] = I[5] = I[10] = I[15] = 1; return I; }
function minv(M: M4): M4 { const s = [1, 1, 1, -1]; const Q = new Float64Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) Q[4 * i + j] = s[i] * s[j] * M[4 * j + i]; return Q; }
function rot(u: number[], th: number): M4 { const c = Math.cos(th), s = Math.sin(th), C = 1 - c; const [x, y, z] = u; return Float64Array.from([c + x * x * C, x * y * C - z * s, x * z * C + y * s, 0, y * x * C + z * s, c + y * y * C, y * z * C - x * s, 0, z * x * C - y * s, z * y * C + x * s, c + z * z * C, 0, 0, 0, 0, 1]); }
function trans(u: number[], t: number): M4 { const ch = Math.cosh(t) - 1, sh = Math.sinh(t); const M = eye(); for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) M[4 * i + j] += ch * u[i] * u[j]; M[4 * i + 3] = sh * u[i]; M[12 + i] = sh * u[i]; } M[15] = Math.cosh(t); return M; }
const SQ5 = Math.sqrt(5), PHI = (1 + SQ5) / 2;
const rIn = Math.acosh(Math.sqrt((5 + 2 * SQ5) / 4)), rCirc = Math.acosh((7 + 3 * SQ5) / 4);
const dirs0 = [[0, 1, PHI], [0, 1, -PHI], [1, PHI, 0], [1, -PHI, 0], [PHI, 0, 1], [-PHI, 0, 1]];
const nhat: number[][] = []; for (const d of dirs0) { const n = Math.hypot(d[0], d[1], d[2]); const u = d.map((x) => x / n); nhat.push(u, u.map((x) => -x)); }
const NRM64: V4[] = nhat.map((u) => [u[0] * Math.cosh(rIn), u[1] * Math.cosh(rIn), u[2] * Math.cosh(rIn), Math.sinh(rIn)]);
const G64: M4[] = []; for (let k = 0; k < 6; k++) { const u = nhat[2 * k]; const g = mul(trans(u.map((x) => -x), 2 * rIn), rot(u, 3 * Math.PI / 5)); G64.push(g, minv(g)); }
const NRM32 = NRM64.map((n) => n.map(Math.fround)); const G32 = G64.map((g) => Float64Array.from(g, Math.fround));

const m64 = (a: V4, b: V4) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] - a[3] * b[3];
const inD = (p: V4, tol: number) => NRM64.every((n) => m64(n, p) <= tol);
const klein = (k: number[]): V4 => { const s = 1 / Math.sqrt(1 - (k[0] ** 2 + k[1] ** 2 + k[2] ** 2)); return [k[0] * s, k[1] * s, k[2] * s, s]; };
function sampleD(rng: Rng): V4 { const kr = Math.tanh(rCirc); for (;;) { const k = [0, 1, 2].map(() => (2 * rng.next() - 1) * kr); if (k[0] ** 2 + k[1] ** 2 + k[2] ** 2 >= kr * kr) continue; const p = klein(k); if (inD(p, -1e-6)) return p; } }
// vertices of D (Klein), and the 5 vertices of face f
const verts: number[][] = []; { const a = 1 / PHI; const raw = [] as number[][]; for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) raw.push([sx, sy, sz]); for (const s1 of [1, -1]) for (const s2 of [1, -1]) { raw.push([s1 * a, 0, s2 * PHI], [0, s1 * PHI, s2 * a], [s1 * PHI, s2 * a, 0]); } const kr = Math.tanh(rCirc); for (const v of raw) { const n = Math.hypot(v[0], v[1], v[2]); verts.push(v.map((x) => (x / n) * kr)); } }
const faceVerts = (f: number) => verts.filter((v) => Math.abs(m64(NRM64[f], klein(v.map((x) => x * 0.999999999)))) < 1e-6);
/** a point of D near an edge of face f: on an edge, pulled toward o by a small Klein factor, jittered */
function nearEdge(f: number, rng: Rng, eps: number): V4 {
  const fv = faceVerts(f); // 5 vertices, edges = pairs at minimal distance
  const pairs: [number[], number[]][] = []; let dmin = Infinity;
  for (let i = 0; i < fv.length; i++) for (let j = i + 1; j < fv.length; j++) { const d = Math.hypot(...fv[i].map((x, k) => x - fv[j][k])); if (d < dmin - 1e-9) { dmin = d; pairs.length = 0; } if (Math.abs(d - dmin) < 1e-9) pairs.push([fv[i], fv[j]]); }
  for (;;) { const [a, b] = pairs[Math.floor(rng.next() * pairs.length)]; const s = 0.05 + 0.9 * rng.next(); const e = a.map((x, k) => x + s * (b[k] - x)); const sh = 1 - eps * rng.next(); const k = e.map((x) => x * sh + (rng.next() - 0.5) * eps * 0.1); const p = klein(k); if (inD(p, -1e-12)) return p; }
}

/** walk from (p, v) for arc length d; returns the number of face crossings before reaching d */
function crossings(p: V4, v: V4, d: number, NRM: V4[], G: M4[]): number {
  let tacc = 0, cross = 0;
  for (let n = 0; n < 64; n++) {
    let tau = Infinity, f = -1;
    for (let i = 0; i < 12; i++) { const b = mink(NRM[i], v); if (b <= 0) continue; const t = Math.max(R(-mink(NRM[i], p) / b), 0); if (t < tau) { tau = t; f = i; } }
    const s = R(Math.atanh(tau));
    if (tacc + s >= d) return cross;
    const q = lin(p, 1, v, tau), w = lin(v, 1, p, tau);
    const pn = scl(q, R(1 / R(Math.sqrt(-mink(q, q)))));
    let vn = lin(w, 1, pn, mink(w, pn)); vn = scl(vn, R(1 / R(Math.sqrt(mink(vn, vn)))));
    p = apply(G[f], pn); v = apply(G[f], vn); tacc = R(tacc + s); cross++;
  }
  return 99;
}

const [nS, seedS, nearS] = process.argv.slice(2);
const N = Number(nS ?? 20000), rng = new Rng(Number(seedS ?? 1)), nearFrac = Number(nearS ?? 0.5);
const hist64 = new Map<number, number>(), hist32 = new Map<number, number>(); let convexBad = 0, mism = 0;
for (let s = 0; s < N; s++) {
  const f = Math.floor(rng.next() * 12);
  const near = rng.next() < nearFrac;
  const x = near ? nearEdge(f, rng, 1e-3) : sampleD(rng);
  // y in the neighbour across face f: g_f^-1 z, z in D; near-edge z taken near the edges of face opp(f)
  const z = near ? nearEdge(f ^ 1, rng, 1e-3) : sampleD(rng);
  const y = (() => { const M = minv(G64[f]); return [0, 1, 2, 3].map((i) => M[4 * i] * z[0] + M[4 * i + 1] * z[1] + M[4 * i + 2] * z[2] + M[4 * i + 3] * z[3]); })();
  const ch = -m64(x, y), d = Math.acosh(ch), v = [0, 1, 2, 3].map((i) => (y[i] - ch * x[i]) / Math.sinh(d));
  // convexity: sample points along the geodesic; each must lie in D or in g_f^-1 D
  for (let k = 1; k < 20; k++) { const t = (d * k) / 20; const p = [0, 1, 2, 3].map((i) => Math.cosh(t) * x[i] + Math.sinh(t) * v[i]); const gp = [0, 1, 2, 3].map((i) => G64[f][4 * i] * p[0] + G64[f][4 * i + 1] * p[1] + G64[f][4 * i + 2] * p[2] + G64[f][4 * i + 3] * p[3]); if (!inD(p, 1e-9) && !inD(gp, 1e-9)) { convexBad++; break; } }
  R = (u) => u; const c64 = crossings(x, v, d * (1 - 1e-9), NRM64, G64);
  R = Math.fround; const c32 = crossings(x.map(Math.fround), v.map(Math.fround), Math.fround(d * (1 - 1e-6)), NRM32, G32);
  R = (u) => u;
  hist64.set(c64, (hist64.get(c64) ?? 0) + 1); hist32.set(c32, (hist32.get(c32) ?? 0) + 1); if (c32 !== c64) mism++;
}
console.log(JSON.stringify({ pairs: N, nearEdgeFrac: nearFrac, convexityViolations: convexBad, crossings64: Object.fromEntries(hist64), crossings32: Object.fromEntries(hist32), float32vs64Mismatch: mism }));
