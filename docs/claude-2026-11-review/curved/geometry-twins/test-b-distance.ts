// (b) distance: stable chord forms vs acosh/acos, float64 and float32, by separation and by
// distance from the origin. Ground truth: float64 stable form on the float32-ROUNDED inputs
// (so we measure the formula's error, not the input rounding) — and separately the error vs
// the exact separation (which includes the input rounding: the "position quantum").
import { mk, F64, F32, V, rng, randUnit3, fmt } from './common.ts';
import { H3 } from './h3.ts';
import { S3 } from './s3.ts';

const u = rng(2);
const D = { f64: mk(F64), f32: mk(F32) };
for (const name of ['H3', 'S3']) {
  const S64 = name === 'H3' ? H3(D.f64) : S3(D.f64);
  const S32 = name === 'H3' ? H3(D.f32) : S3(D.f32);
  console.log(`\n== ${name}: worst relative error of d over 200 pairs; columns = stable f64 | naive f64 | stable f32 | naive f32 | f32 vs exact (incl. input rounding)`);
  const radii = name === 'H3' ? [0, 0.001, 0.1, 1, 2, 4, 6, 8] : [0, 0.001, 0.1, 1, 2, 3, 3.1];
  for (const R of radii) {
    for (const sep of [1e-4, 1e-2, 1, 3]) {
      if (name === 'S3' && sep >= 3) continue;
      let e = [0, 0, 0, 0, 0];
      for (let k = 0; k < 200; k++) {
        const p = S64.pointAt(randUnit3(u), R);
        // q at exactly `sep` from p: flow from p along a random unit tangent
        const v = S64.reduceVec(p, [...randUnit3(u), u() - 0.5]);
        const q = S64.flow(p, v, sep).p;
        const rel = (x: number, ref: number) => Math.abs(x - ref) / ref;
        e[0] = Math.max(e[0], rel(S64.distance(p, q), sep));
        e[1] = Math.max(e[1], rel(S64.distanceAcosh(p, q), sep));
        const p32 = p.map(Math.fround), q32 = q.map(Math.fround);
        const ref32 = S64.distance(S64.reducePoint(p32), S64.reducePoint(q32)); // exact on rounded inputs (after projecting)
        e[2] = Math.max(e[2], rel(S32.distance(p32, q32), ref32));
        e[3] = Math.max(e[3], rel(S32.distanceAcosh(p32, q32), ref32));
        e[4] = Math.max(e[4], rel(S32.distance(p32, q32), sep));
      }
      console.log(`R=${String(R).padEnd(5)} sep=${String(sep).padEnd(6)} ${e.map(fmt).join(' | ')}`);
    }
  }
}
// position quantum: hyperbolic distance between a point at R and its float32 rounding (projected)
console.log('\n== H3 position quantum: max over 500 points of d(p, reducePoint(fround(p))) in f64');
{
  const S = H3(D.f64);
  for (const R of [0, 1, 2, 4, 6, 8, 10]) {
    let w = 0, wOff = 0;
    for (let k = 0; k < 500; k++) {
      const p = S.pointAt(randUnit3(u), R);
      const p32 = p.map(Math.fround);
      w = Math.max(w, S.distance(p, S.reducePoint(p32)));
      wOff = Math.max(wOff, Math.abs(S.ip(p32, p32) + 1));
    }
    console.log(`R=${R}: quantum ${fmt(w)}  | off-model |<p32,p32>+1| (f64) ${fmt(wOff)}`);
  }
}
