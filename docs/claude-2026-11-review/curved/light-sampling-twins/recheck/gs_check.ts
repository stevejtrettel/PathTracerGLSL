// Gram-Schmidt of the coordinate axes at a point p at hyperbolic distance s from the origin:
// Minkowski length^2 of each candidate after projecting to T_p and removing the unit normal n.
// Checks the claim "every candidate shrinks a lot far from the origin".
import { H3, V4, O, E1, E2, E3, flow, frame, local, rng, sub, mul } from './geom.ts';
const sp = H3, r = rng(3);
for (const s of [0, 1, 2, 4, 6, 8]) {
  let minBest = Infinity, minSecond = Infinity, minAll = Infinity;
  for (let i = 0; i < 2000; i++) {
    // random point at distance s, random unit tangent n there
    const z = 2*r()-1, ph = 2*Math.PI*r(), q = Math.sqrt(1-z*z);
    const g = flow(sp, O, [q*Math.cos(ph), q*Math.sin(ph), z, 0], s); const p = g.pos;
    const f = frame(sp, p, g.vel);
    const z2 = 2*r()-1, ph2 = 2*Math.PI*r(), q2 = Math.sqrt(1-z2*z2);
    const n = local(f, q2*Math.cos(ph2), q2*Math.sin(ph2), z2);
    const L = [E1, E2, E3, O].map((e) => {
      let w = sub(e, mul(p, sp.ip(e, p) / sp.sgn)); w = sub(w, mul(n, sp.ip(w, n)));
      return sp.ip(w, w);
    }).sort((a, b) => b - a);
    minBest = Math.min(minBest, L[0]); minSecond = Math.min(minSecond, L[1]); minAll = Math.min(minAll, L[3]);
  }
  console.log(`s=${s}: over 2000 random (p,n): min of largest candidate len^2 ${minBest.toExponential(2)}, min of 2nd largest ${minSecond.toExponential(2)}, min of smallest ${minAll.toExponential(2)}`);
}
