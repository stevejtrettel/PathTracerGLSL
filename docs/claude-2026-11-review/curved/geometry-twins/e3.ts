// E³ twin: points and directions are vec3 (as today); isometries are affine mat4 (rotation + translation).
import { Arith, mk, F64, V, M } from './common.ts';

export function E3(A: Arith = mk(F64)) {
  const ip = A.form([1, 1, 1]);
  const origin: V = [0, 0, 0];
  const basis: V[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const flow = (p: V, v: V, t: number) => ({ p: A.add(p, A.scale(v, t)), v: v.slice() });
  const reducePoint = (p: V) => p;
  const reduceVec = (_p: V, v: V) => A.scale(v, A.r(1 / A.sqrt(ip(v, v))));
  const distance = (p: V, q: V) => { const d = A.sub(p, q); return A.sqrt(ip(d, d)); };
  function connections(p: V, q: V) {
    const d = A.sub(q, p), L = A.sqrt(ip(d, d));
    return [{ u: A.scale(d, A.r(1 / L)), len: L }];
  }
  const transport = (_p: V, _u: V, _L: number, v: V) => v.slice();
  const areaDensity = (r: number) => r * r;
  const makeTranslation = (p: V): M => [[1, 0, 0, p[0]], [0, 1, 0, p[1]], [0, 0, 1, p[2]], [0, 0, 0, 1]];
  const inverse = (m: M): M => {
    const R = [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[j][i]));
    const t = [0, 1, 2].map((i) => -(R[i][0] * m[0][3] + R[i][1] * m[1][3] + R[i][2] * m[2][3]));
    return [[...R[0], t[0]], [...R[1], t[1]], [...R[2], t[2]], [0, 0, 0, 1]];
  };
  // ambient_frame as in src/components/ambient/euclidean/euclidean.glsl:13-19
  function frame(_p: V, n: V) {
    let t: V = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    t = A.sub(t, A.scale(n, ip(t, n)));
    t = A.scale(t, A.r(1 / A.sqrt(ip(t, t))));
    const b = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]].map(A.r);
    return { t, b, n };
  }
  const pointAt = (dir: V, r: number) => A.scale(dir, r);
  const apply = (m: M, x: V) => A.matVec(m, [...x, 1]).slice(0, 3);
  return { name: 'E3', A, ip, origin, basis, flow, reducePoint, reduceVec, distance, connections, transport, areaDensity, makeTranslation, inverse, frame, pointAt, apply, compose: A.matMul };
}
