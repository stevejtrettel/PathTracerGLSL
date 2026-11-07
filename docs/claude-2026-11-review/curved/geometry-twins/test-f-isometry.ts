// (f) isometries as mat4: makeTranslation(p) closed form, inverse in closed form, group
// membership, makeTranslation = parallel transport along origin→p, and float32 drift of 1000
// random compositions with and without reduceIso.
import { mk, F64, F32, V, M, rng, randUnit3, fmt, det, maxAbs, subM, ident, col } from './common.ts';
import { H3 } from './h3.ts';
import { S3 } from './s3.ts';

const u = rng(5);
const A64 = mk(F64), A32 = mk(F32);
function randRot(): M { // random SO(3) via axis-angle, embedded in mat4
  const a = randUnit3(u), t = 2 * Math.PI * u(), c = Math.cos(t), s = Math.sin(t), C = 1 - c;
  const [x, y, z] = a;
  return [[c + x * x * C, x * y * C - z * s, x * z * C + y * s, 0], [y * x * C + z * s, c + y * y * C, y * z * C - x * s, 0], [z * x * C - y * s, z * y * C + x * s, c + z * z * C, 0], [0, 0, 0, 1]];
}
for (const mkS of [H3, S3]) {
  const S = mkS(A64);
  let w = { mapO: 0, grp: 0, det: 0, inv: 0, pt: 0 };
  const radii = S.name === 'H3' ? [0.001, 0.5, 2, 5, 8] : [0.001, 0.5, 2, 3, 3.1, 3.14];
  for (const R of radii) {
    for (let k = 0; k < 50; k++) {
      const p = S.pointAt(randUnit3(u), R);
      const T = S.makeTranslation(p);
      w.mapO = Math.max(w.mapO, Math.max(...S.apply(T, S.origin).map((x, i) => Math.abs(x - p[i]))) / (S.name === 'H3' ? Math.cosh(R) : 1));
      w.grp = Math.max(w.grp, S.isoError(T) / (S.name === 'H3' ? Math.cosh(R) ** 2 : 1));
      w.det = Math.max(w.det, Math.abs(det(T) - 1));
      w.inv = Math.max(w.inv, maxAbs(subM(S.compose(S.inverse(T), T), ident(4))) / (S.name === 'H3' ? Math.cosh(R) ** 2 : 1));
      // T e_i = parallel transport of e_i along origin→p
      const c = S.connections(S.origin, p)[0];
      for (let i = 0; i < 3; i++) {
        const PT = S.transport(S.origin, c.u, c.len, S.basis[i]);
        w.pt = Math.max(w.pt, Math.max(...col(T, i).map((x, j) => Math.abs(x - PT[j]))) / (S.name === 'H3' ? Math.cosh(R) : 1));
      }
    }
  }
  console.log(`${S.name} f64 (errors relative to coordinate size): T·o=p ${fmt(w.mapO)}, form preserved ${fmt(w.grp)}, |det-1| ${fmt(w.det)}, inv·T=I ${fmt(w.inv)}, T·e_i = PT(e_i) ${fmt(w.pt)}`);
  if (S.name === 'S3') {
    const q = [0, 0, 1e-4, -Math.sqrt(1 - 1e-8)];
    const T = S.makeTranslation(q);
    console.log(`S3 makeTranslation near the antipode of the origin (p4=${fmt(q[3])}): max entry ${fmt(maxAbs(T))}, |TᵀT-I| ${fmt(S.isoError(T))}  (formula divides by 1+p4)`);
  }
}

// drift: compose 1000 random isometries g_k = translation(dist 0.05..0.3 random dir)·rotation
console.log('\nfloat32 composition drift over 1000 steps (camera-like motion: small translations + rotations)');
for (const mkS of [H3, S3]) {
  for (const step of [0.05, 0.3]) {
    const gens: M[] = [];
    const S = mkS(A64);
    for (let k = 0; k < 1000; k++) gens.push(S.compose(S.makeTranslation(S.pointAt(randUnit3(u), step * u())), randRot()));
    const runs: Record<string, { M: M; S: any; reduce: boolean }> = {
      f64: { M: ident(4), S: mkS(A64), reduce: false },
      f32: { M: ident(4), S: mkS(A32), reduce: false },
      'f32+reduce': { M: ident(4), S: mkS(A32), reduce: true },
      'f32+polar': { M: ident(4), S: mkS(A32), reduce: true },
    };
    // polar reduce: M = T(p)·R with p = M·o renormalized; re-orthonormalize R's 3×3 block in
    // the Euclidean dot (R is near the identity scale, so no Minkowski cancellation)
    const polar = (SS: any, Mx: M): M => {
      const A = SS.A;
      const p = SS.reducePoint(SS.apply(Mx, SS.origin));
      const T = SS.makeTranslation(p);
      const R = A.matMul(SS.inverse(T), Mx);
      const c = [0, 1, 2].map((j) => [R[0][j], R[1][j], R[2][j]]);
      const d3 = (a: V, b: V) => A.r(A.r(A.r(a[0] * b[0]) + A.r(a[1] * b[1])) + A.r(a[2] * b[2]));
      for (let j = 0; j < 3; j++) {
        for (let k = 0; k < j; k++) c[j] = A.sub(c[j], A.scale(c[k], d3(c[j], c[k])));
        c[j] = A.scale(c[j], A.r(1 / A.sqrt(d3(c[j], c[j]))));
      }
      const R2: M = [[c[0][0], c[1][0], c[2][0], 0], [c[0][1], c[1][1], c[2][1], 0], [c[0][2], c[1][2], c[2][2], 0], [0, 0, 0, 1]];
      return A.matMul(T, R2);
    };
    const report: string[] = [];
    for (let k = 0; k < 1000; k++) {
      for (const r of Object.values(runs)) {
        r.M = r.S.compose(r.M, r.S.A.roundM(gens[k]));
        if (r.reduce) r.M = r === runs['f32+polar'] ? polar(r.S, r.M) : r.S.reduceIso(r.M);
      }
    }
    const ref = runs.f64.M;
    const S64 = mkS(A64);
    const refP = S64.apply(ref, S64.origin);
    const Rfin = S64.distance(S64.origin, refP);
    report.push(`f64 form err ${fmt(S64.isoError(ref) / Math.cosh(Rfin) ** 2)} (rel)`);
    for (const [name, r] of Object.entries(runs)) {
      if (name === 'f64') continue;
      const P = S64.apply(r.M, S64.origin);
      const posErr = S64.distance(S64.reducePoint(P), refP);
      // frame error: angle between images of e1 after pulling back by ref⁻¹
      const D = S64.compose(S64.inverse(ref), r.M);
      report.push(`${name}: form err ${fmt(S64.isoError(r.M))}, position err ${fmt(posErr)}, |ref⁻¹·M - I| ${fmt(maxAbs(subM(D, ident(4))))}`);
    }
    console.log(`${mkS(A64).name} step≤${step}: final distance from origin ${fmt(Rfin)} | ${report.join(' | ')}`);
  }
}

// S3 translation from (unit direction u at origin, distance d): rotation in the (e4,u) plane,
// no division, valid through d = π
{
  const fromDir = (A: any, u3: V, d: number): M => {
    const c = A.r(Math.cos(d)), s = A.r(Math.sin(d));
    const m = ident(4);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i][j] = A.r(m[i][j] + A.r(A.r(c - 1) * A.r(u3[i] * u3[j])));
    for (let i = 0; i < 3; i++) { m[i][3] = A.r(s * u3[i]); m[3][i] = A.r(-s * u3[i]); }
    m[3][3] = c;
    return m;
  };
  const S = S3(A64);
  for (const d of [0.5, 3.0, Math.PI - 1e-6, Math.PI]) {
    const u3 = randUnit3(u);
    const T32 = fromDir(A32, u3.map(Math.fround), d);
    const p = S.pointAt(u3, d);
    console.log(`S3 fromDir f32 d=${fmt(d)}: |T·o - p| ${fmt(Math.max(...S.apply(T32, S.origin).map((x, i) => Math.abs(x - p[i]))))}, |TᵀT-I| ${fmt(S.isoError(T32))}`);
  }
}
