// S³ twin: unit sphere in R⁴, Euclidean dot, origin (0,0,0,1). Isometries: SO(4).
import { Arith, mk, F64, V, M, transpose, ident } from './common.ts';

export function S3(A: Arith = mk(F64)) {
  const ip = A.form([1, 1, 1, 1]);
  const origin: V = [0, 0, 0, 1];
  const basis: V[] = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];
  function flow(p: V, v: V, t: number) {
    const c = A.r(Math.cos(t)), s = A.r(Math.sin(t));
    return { p: A.lin(c, p, s, v), v: A.lin(-s, p, c, v) };
  }
  const reducePoint = (p: V) => A.scale(p, A.r(1 / A.sqrt(ip(p, p))));
  function reduceVec(p: V, v: V) {
    const w = A.sub(v, A.scale(p, ip(p, v)));
    return A.scale(w, A.r(1 / A.sqrt(ip(w, w))));
  }
  // chord |p-q| = 2 sin(d/2), |p+q| = 2 cos(d/2)
  function distance(p: V, q: V) {
    const a = A.sub(p, q), b = A.add(p, q);
    return A.r(2 * A.r(Math.atan2(A.sqrt(ip(a, a)), A.sqrt(ip(b, b)))));
  }
  const distanceAcos = (p: V, q: V) => A.r(Math.acos(Math.min(1, Math.max(-1, ip(p, q)))));
  // two geodesics: (u, d) and (-u, 2π-d). w = q - <p,q>p = (q-p) - <p,q-p>p.
  function connections(p: V, q: V) {
    const dq = A.sub(q, p);
    const w = A.sub(dq, A.scale(p, ip(p, dq)));
    const u = A.scale(w, A.r(1 / A.sqrt(ip(w, w))));
    const d = distance(p, q);
    return [{ u, len: d }, { u: A.scale(u, -1), len: A.r(2 * Math.PI - d) }];
  }
  function connectionsNaive(p: V, q: V) {
    const w = A.sub(q, A.scale(p, ip(p, q)));
    const u = A.scale(w, A.r(1 / A.sqrt(ip(w, w))));
    const d = distanceAcos(p, q);
    return [{ u, len: d }, { u: A.scale(u, -1), len: A.r(2 * Math.PI - d) }];
  }
  function transport(p: V, u: V, L: number, v: V) {
    const a = ip(v, u);
    return A.add(v, A.scale(A.sub(flow(p, u, L).v, u), a));
  }
  // short geodesic only: v - <q,v>/(1+<p,q>) (p+q); singular at q = -p
  function transportPQ(p: V, q: V, v: V) {
    return A.sub(v, A.scale(A.add(p, q), A.r(ip(q, v) / A.r(1 + ip(p, q)))));
  }
  const areaDensity = (r: number) => Math.sin(r) ** 2;
  // rotation in the (e4,p) plane taking origin to p; singular at p = -origin
  function makeTranslation(p: V): M {
    const k = 1 / (1 + p[3]);
    const m: M = ident(4);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) m[i][j] = A.r((i === j ? 1 : 0) - A.r(A.r(p[i] * p[j]) * k));
      m[i][3] = p[i]; m[3][i] = -p[i];
    }
    m[3][3] = p[3];
    return m;
  }
  const inverse = (m: M): M => transpose(m);
  const isoError = (m: M) => {
    const g = transpose(m).map((row) => m[0].map((_, j) => row.reduce((s, x, k) => s + x * m[k][j], 0)));
    return Math.max(...g.flat().map((x, idx) => Math.abs(x - (idx % 5 === 0 ? 1 : 0))));
  };
  function reduceIso(m: M): M {
    const c = [0, 1, 2, 3].map((j) => m.map((row) => row[j]));
    c[3] = reducePoint(c[3]);
    for (let j = 0; j < 3; j++) {
      let w = A.sub(c[j], A.scale(c[3], ip(c[j], c[3])));
      for (let k = 0; k < j; k++) w = A.sub(w, A.scale(c[k], ip(w, c[k])));
      c[j] = A.scale(w, A.r(1 / A.sqrt(ip(w, w))));
    }
    return c[0].map((_, i) => c.map((cc) => cc[i]));
  }
  function frame(p: V, n: V) {
    const seed = Math.abs(n[0]) < 0.9 * Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) ? [1, 0, 0, 0] : [0, 1, 0, 0];
    let t = A.sub(seed, A.scale(p, ip(seed, p)));
    t = A.sub(t, A.scale(n, ip(t, n)));
    t = A.scale(t, A.r(1 / A.sqrt(ip(t, t))));
    let b = cross4(p, t, n);
    b = A.scale(b, A.r(1 / A.sqrt(ip(b, b))));
    return { t, b, n };
  }
  function cross4(a: V, b: V, c: V): V {
    const d3 = (r0: V, r1: V, r2: V) => r0[0] * (r1[1] * r2[2] - r1[2] * r2[1]) - r0[1] * (r1[0] * r2[2] - r1[2] * r2[0]) + r0[2] * (r1[0] * r2[1] - r1[1] * r2[0]);
    const sub = (v: V, k: number) => v.filter((_, i) => i !== k);
    return [0, 1, 2, 3].map((k) => ((k + 3) % 2 ? -1 : 1) * d3(sub(a, k), sub(b, k), sub(c, k)));
  }
  const pointAt = (dir: V, r: number) => flow(origin, [...dir, 0], r).p;
  const apply = (m: M, x: V) => A.matVec(m, x);
  return { name: 'S3', A, ip, origin, basis, flow, reducePoint, reduceVec, distance, distanceAcosh: distanceAcos, connections, connectionsNaive, transport, transportPQ, areaDensity, makeTranslation, inverse, isoError, reduceIso, frame, pointAt, apply, compose: A.matMul };
}
