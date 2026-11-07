// S3 cone formula sin(alpha) = sin R / sin d outside R < d < pi - R.
// Case 1: ball containing the antipode -x (d > pi - R): formula > 1; what fraction of directions hit?
// Case 2: x inside a ball (d < R) with sin R / sin d < 1: formula gives a false cone.
// Case 3: S3 ray leaving a disk at x returns to x at t = 2 pi (its own surface, other face).
import { S3, O, E1, E2, E3, V4, flow, frame, local, hitBall, makeDisk, hitDisk, rng, lin } from './geom.ts';
const sp = S3, r = rng(11);
for (const [d, R] of [[2.8, 0.5], [1.0, 2.5], [2.5, 2.0], [1.2, 0.5]]) {
  const c = flow(sp, O, E3, d).pos; let hit = 0; const M = 20000;
  for (let i = 0; i < M; i++) {
    const z = 2*r()-1, ph = 2*Math.PI*r(), s = Math.sqrt(1-z*z);
    const v: V4 = [s*Math.cos(ph), s*Math.sin(ph), z, 0];
    if (hitBall(sp, { c, R }, O, v, 2*Math.PI) < Infinity) hit++;
  }
  const f = Math.sin(R)/Math.sin(d);
  const twoCones = f <= 1 ? 2 * (1 - Math.sqrt(1 - f*f)) / 2 : NaN; // fraction of sphere covered by two cones
  console.log(`d=${d} R=${R}: sinR/sind=${f.toFixed(4)}  inside=${d < R}  contains -x=${d > Math.PI - R}  fraction of directions hitting ${(hit/M).toFixed(4)}  two-cone fraction ${twoCones.toFixed?.(4)}`);
}
// case 3
const dk = makeDisk(sp, O, E3, 0.5); let back = 0, tot = 0, tmin = Infinity;
for (let i = 0; i < 2000; i++) {
  const z = r(), ph = 2*Math.PI*r(), s = Math.sqrt(1-z*z);
  const v: V4 = [s*Math.cos(ph), s*Math.sin(ph), z, 0]; // leaving the disk at its center, upward
  const t = hitDisk(sp, dk, O, v, 2*Math.PI + 1e-9);
  tot++; if (Math.abs(t - 2*Math.PI) < 1e-9) back++; tmin = Math.min(tmin, t);
}
console.log(`ray leaving a disk at its center (only object in S3): ${back}/${tot} hit the disk again at t = 2pi (to 1e-9) when tmax = 2pi + 1e-9; with tmax = 2pi they score 0`);
