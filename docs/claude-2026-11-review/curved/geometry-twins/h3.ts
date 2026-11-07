// H³ twin: hyperboloid model in R^{3,1}, <x,y> = x1y1+x2y2+x3y3-x4y4, origin (0,0,0,1).
// Points p with <p,p> = -1, p4 > 0. Tangent vectors v at p: <p,v> = 0. Isometries: SO+(3,1).
import { Arith, mk, F64, V, M, transpose } from './common.ts';

export function H3(A: Arith = mk(F64)) {
  const ip = A.form([1, 1, 1, -1]);
  const J = (m: M): M => m.map((row, i) => row.map((x, j) => (i === 3 ? -x : x) * (j === 3 ? -1 : 1)));
  const origin: V = [0, 0, 0, 1];
  const basis: V[] = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];

  // geodesic flow: point and transported velocity, exact
  function flow(p: V, v: V, t: number, sinh = A.sinh) {
    const c = A.cosh(t), s = sinh(t);
    return { p: A.lin(c, p, s, v), v: A.lin(s, p, c, v) };
  }
  const reducePoint = (p: V) => A.scale(p, A.r(1 / A.sqrt(-ip(p, p))));
  // project onto T_p (v + <p,v>p, since <p,p>=-1) then unit length
  function reduceVec(p: V, v: V) {
    const w = A.add(v, A.scale(p, ip(p, v)));
    return A.scale(w, A.r(1 / A.sqrt(ip(w, w))));
  }
  // <p-q,p-q> = 4 sinh²(d/2)
  function distance(p: V, q: V) {
    const d = A.sub(p, q);
    return A.r(2 * A.r(Math.asinh(A.r(A.sqrt(Math.max(ip(d, d), 0)) / 2))));
  }
  const distanceAcosh = (p: V, q: V) => A.r(Math.acosh(Math.max(1, -ip(p, q))));
  // log map: w = q + <p,q>p = (q-p) + <p,q-p>p (second form avoids the cosh d cancellation)
  function connections(p: V, q: V) {
    const dq = A.sub(q, p);
    const w = A.add(dq, A.scale(p, ip(p, dq)));
    const u = A.scale(w, A.r(1 / A.sqrt(ip(w, w))));
    return [{ u, len: distance(p, q) }];
  }
  function connectionsNaive(p: V, q: V) {
    const w = A.add(q, A.scale(p, ip(p, q)));
    return [{ u: A.scale(w, A.r(1 / A.sqrt(ip(w, w)))), len: distanceAcosh(p, q) }];
  }
  // parallel transport of v (tangent at p) along the geodesic (p,u) for length L:
  // the component along u rides the velocity, the part ⊥ span(p,u) is fixed in R^{3,1}.
  function transport(p: V, u: V, L: number, v: V) {
    const a = ip(v, u);
    const vel = flow(p, u, L).v;
    return A.add(v, A.scale(A.sub(vel, u), a));
  }
  // closed form in p,q only: v + <q,v>/(1-<p,q>) (p+q)
  function transportPQ(p: V, q: V, v: V) {
    return A.add(v, A.scale(A.add(p, q), A.r(ip(q, v) / A.r(1 - ip(p, q)))));
  }
  const areaDensity = (r: number) => Math.sinh(r) ** 2;
  // transvection taking origin to p (also parallel transport along origin→p)
  function makeTranslation(p: V): M {
    const k = 1 / (1 + p[3]);
    const m: M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) m[i][j] = A.r((i === j ? 1 : 0) + A.r(A.r(p[i] * p[j]) * k));
      m[i][3] = p[i]; m[3][i] = p[i];
    }
    m[3][3] = p[3];
    return m;
  }
  const inverse = (m: M): M => J(transpose(m)); // J Mᵀ J
  const isoError = (m: M) => {
    // max |Mᵀ J M - J|
    const JM = m.map((row, i) => row.map((x) => (i === 3 ? -x : x)));
    const g = transpose(m).map((row) => JM[0].map((_, j) => row.reduce((s, x, k) => s + x * JM[k][j], 0)));
    return Math.max(...g.flat().map((x, idx) => Math.abs(x - (idx % 5 === 0 ? (idx === 15 ? -1 : 1) : 0))));
  };
  // Gram–Schmidt of the columns in the form, point column first
  function reduceIso(m: M): M {
    const c = [0, 1, 2, 3].map((j) => m.map((row) => row[j]));
    c[3] = reducePoint(c[3]);
    for (let j = 0; j < 3; j++) {
      let w = A.add(c[j], A.scale(c[3], ip(c[j], c[3])));
      for (let k = 0; k < j; k++) w = A.sub(w, A.scale(c[k], ip(w, c[k])));
      c[j] = A.scale(w, A.r(1 / A.sqrt(ip(w, w))));
    }
    return c[0].map((_, i) => c.map((cc) => cc[i]));
  }
  // orthonormal frame at p with unit normal n: Gram–Schmidt one seed, b from the 4D cross
  // product (Minkowski-raised) so det[t,b,n,p] = +1 like a right-handed E3 frame at the origin.
  function frame(p: V, n: V) {
    const seed = Math.abs(n[0]) < 0.9 * Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) ? [1, 0, 0, 0] : [0, 1, 0, 0];
    let t = A.add(seed, A.scale(p, ip(seed, p)));
    t = A.sub(t, A.scale(n, ip(t, n)));
    t = A.scale(t, A.r(1 / A.sqrt(ip(t, t))));
    const X = cross4(p, t, n);
    let b = [X[0], X[1], X[2], -X[3]];
    b = A.scale(b, A.r(1 / A.sqrt(ip(b, b))));
    return { t, b, n };
  }
  // X·x = det[a;b;c;x]
  function cross4(a: V, b: V, c: V): V {
    const d3 = (r0: V, r1: V, r2: V) => r0[0] * (r1[1] * r2[2] - r1[2] * r2[1]) - r0[1] * (r1[0] * r2[2] - r1[2] * r2[0]) + r0[2] * (r1[0] * r2[1] - r1[1] * r2[0]);
    const sub = (v: V, k: number) => v.filter((_, i) => i !== k);
    return [0, 1, 2, 3].map((k) => ((k + 3) % 2 ? -1 : 1) * d3(sub(a, k), sub(b, k), sub(c, k)));
  }
  const pointAt = (dir: V, r: number) => flow(origin, [...dir, 0], r).p;
  const apply = (m: M, x: V) => A.matVec(m, x);
  return { name: 'H3', A, ip, origin, basis, flow, reducePoint, reduceVec, distance, distanceAcosh, connections, connectionsNaive, transport, transportPQ, areaDensity, makeTranslation, inverse, isoError, reduceIso, frame, pointAt, apply, compose: A.matMul };
}
