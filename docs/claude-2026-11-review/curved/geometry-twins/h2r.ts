// H²×R twin: point (x1,x2,x3,z) with (x1,x2,x3) on the hyperboloid <x,x>_{2,1} = -1 and z ∈ R.
// Origin (0,0,1,0). Tangent form diag(1,1,-1,1). Isometries: (SO+(2,1) 3×3 block, z shift) —
// NOT a linear map of the vec4 (a z translation is affine).
import { Arith, mk, F64, V, M } from './common.ts';

export function H2R(A: Arith = mk(F64)) {
  const ip = A.form([1, 1, -1, 1]);
  const ipH = (a: V, b: V) => A.form([1, 1, -1])(a.slice(0, 3), b.slice(0, 3));
  const origin: V = [0, 0, 1, 0];
  const basis: V[] = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1]]; // e3 = vertical (z)
  // horizontal part moves along an H² geodesic at speed s = |v_h|, z at speed v_z
  function flow(p: V, v: V, t: number) {
    const vh = v.slice(0, 3), s = A.sqrt(Math.max(ipH(vh, vh), 0));
    let ph: V, vhOut: V;
    if (s === 0) { ph = p.slice(0, 3); vhOut = vh; } else {
      const c = A.cosh(A.r(s * t)), sh = A.sinh(A.r(s * t));
      const dir = A.scale(vh, A.r(1 / s));
      ph = A.lin(c, p.slice(0, 3), sh, dir);
      vhOut = A.scale(A.lin(sh, p.slice(0, 3), c, dir), s);
    }
    return { p: [...ph, A.r(p[3] + A.r(v[3] * t))], v: [...vhOut, v[3]] };
  }
  const reducePoint = (p: V) => { const k = A.r(1 / A.sqrt(-ipH(p, p))); return [p[0] * k, p[1] * k, p[2] * k, p[3]].map(A.r); };
  function reduceVec(p: V, v: V) {
    const ph = p.slice(0, 3);
    const w = [...A.add(v.slice(0, 3), A.scale(ph, ipH(ph, v))), v[3]];
    return A.scale(w, A.r(1 / A.sqrt(ip(w, w))));
  }
  const dH = (p: V, q: V) => { const d = A.sub(p.slice(0, 3), q.slice(0, 3)); return A.r(2 * A.r(Math.asinh(A.r(A.sqrt(Math.max(ipH(d, d), 0)) / 2)))); };
  const distance = (p: V, q: V) => { const h = dH(p, q), z = A.r(q[3] - p[3]); return A.sqrt(A.r(A.r(h * h) + A.r(z * z))); };
  function connections(p: V, q: V) {
    const ph = p.slice(0, 3), dq = A.sub(q.slice(0, 3), ph);
    const w = A.add(dq, A.scale(ph, ipH(ph, dq)));
    const wn = A.sqrt(Math.max(ipH(w, w), 0));
    const h = dH(p, q), z = A.r(q[3] - p[3]), L = distance(p, q);
    const uh = wn === 0 ? [0, 0, 0] : A.scale(w, A.r(A.r(h / L) / wn));
    return [{ u: [...uh, A.r(z / L)], len: L }];
  }
  // transport: vertical direction is parallel; horizontal part transports along the H² geodesic
  function transport(p: V, u: V, L: number, v: V) {
    const uh = u.slice(0, 3), s = A.sqrt(Math.max(ipH(uh, uh), 0));
    if (s === 0) return v.slice();
    const dir = A.scale(uh, A.r(1 / s));
    const ph = p.slice(0, 3), vh = v.slice(0, 3);
    const a = ipH(vh, dir);
    const c = A.cosh(A.r(s * L)), sh = A.sinh(A.r(s * L));
    const vel = A.lin(sh, ph, c, dir);
    return [...A.add(vh, A.scale(A.sub(vel, dir), a)), v[3]];
  }
  // b = angle of the initial direction from vertical: A(r,b) = r sinh(r sin b)/sin b
  const areaDensity = (r: number, u?: V) => {
    const sb = u ? Math.sqrt(Math.max(0, u[0] * u[0] + u[1] * u[1] - u[2] * u[2])) : 1;
    return sb < 1e-12 ? r * r : (r * Math.sinh(r * sb)) / sb;
  };
  const pointAt = (dir: V, r: number) => flow(origin, [dir[0], dir[1], 0, dir[2]], r).p;
  // isometry = { m: 3×3 in SO+(2,1), z }
  type Iso = { m: M; z: number };
  const apply = (g: Iso, x: V) => [...A.matVec(g.m, x.slice(0, 3)), A.r(x[3] + g.z)];
  const compose = (a: Iso, b: Iso): Iso => ({ m: A.matMul(a.m, b.m), z: A.r(a.z + b.z) });
  return { name: 'H2R', A, ip, origin, basis, flow, reducePoint, reduceVec, distance, connections, transport, areaDensity, pointAt, apply, compose };
}
