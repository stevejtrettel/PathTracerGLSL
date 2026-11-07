// (g) tangent frame from a normal; local vec3 <-> tangent 4-vector; what Euclidean
// normalize() does to a Minkowski-unit tangent; frame handedness.
import { mk, F64, F32, V, rng, randUnit3, fmt, det, fromCols } from './common.ts';
import { H3 } from './h3.ts';
import { S3 } from './s3.ts';

const u = rng(7);
for (const prec of ['f64', 'f32'] as const) {
  const A = mk(prec === 'f64' ? F64 : F32);
  for (const mkS of [H3, S3]) {
    const S = mkS(A), S64 = mkS(mk(F64));
    const radii = S.name === 'H3' ? [0, 1, 2, 4, 6] : [0, 1, 2, 3];
    for (const R of radii) {
      const w: any = { orth: 0, det: 0, round: 0, eucl: 0, euclLen: 0, dot: 0 };
      for (let k = 0; k < 200; k++) {
                // exact unit tangent (float64, transported from the origin by T_p), then rounded once
        const p64 = S64.pointAt(randUnit3(u), R);
        const n = S64.apply(S64.makeTranslation(p64), [...randUnit3(u), 0]).map(A.r);
        // ambient_dot error of two exact unit tangents rounded to f32
        const m = S64.apply(S64.makeTranslation(p64), [...randUnit3(u), 0]);
        w.dot = Math.max(w.dot ?? 0, Math.abs(S.ip(n, m.map(A.r)) - S64.ip(S64.apply(S64.makeTranslation(p64), [0,0,0,0]), [0,0,0,0]) - S64.ip(n.map(Number), m)));
        const p = p64.map(A.r);
        const f = S.frame(p, n);
        const B = [f.t, f.b, f.n];
        for (let i = 0; i < 3; i++) {
          w.orth = Math.max(w.orth, Math.abs(S64.ip(B[i], p)));
          for (let j = 0; j < 3; j++) w.orth = Math.max(w.orth, Math.abs(S64.ip(B[i], B[j]) - (i === j ? 1 : 0)));
        }
        w.det = Math.max(w.det, Math.abs(det(fromCols([f.t, f.b, f.n, p])) - 1));
        // local round trip: microfacet_to_local / from_local with the ambient form
        const loc = randUnit3(u).map(A.r);
        const v4 = A.add(A.add(A.scale(f.t, loc[0]), A.scale(f.b, loc[1])), A.scale(f.n, loc[2]));
        const back = [S.ip(v4, f.t), S.ip(v4, f.b), S.ip(v4, f.n)];
        w.round = Math.max(w.round, Math.max(...back.map((x, i) => Math.abs(x - loc[i]))));
        // GLSL normalize() on a 4-vector = Euclidean normalization: its ambient length afterwards
        const e = Math.sqrt(v4.reduce((s, x) => s + x * x, 0));
        const vn = v4.map((x) => x / e);
        w.eucl = Math.max(w.eucl, Math.abs(Math.sqrt(S64.ip(vn, vn)) - 1));
        w.euclLen = Math.max(w.euclLen, e);
      }
      console.log(`${prec} ${S.name} R=${R}: ambient_dot err ${fmt(w.dot)}, frame orthonormality ${fmt(w.orth)}, |det[t,b,n,p]-1| ${fmt(w.det)}, local round trip ${fmt(w.round)}, max Euclidean |v4| of a unit tangent ${fmt(w.euclLen)} → after GLSL normalize(), |ambient length - 1| up to ${fmt(w.eucl)}`);
    }
  }
}
