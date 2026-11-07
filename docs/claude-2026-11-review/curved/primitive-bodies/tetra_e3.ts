// Order of accuracy of the Euclidean 4-tap tetrahedral gradient (geometry/index.ts emitSdfNormal) vs 6-tap central,
// torus R=0.8 r=0.25, max angle error over surface points.
import { rng } from './lib.ts';
const f = (p: number[]) => Math.hypot(Math.hypot(p[0], p[2]) - 0.8, p[1]) - 0.25;
const Rg = rng(3);
for (const h of [1e-2, 1e-3, 1e-4]) {
  let e4 = 0, e6 = 0;
  for (let i = 0; i < 5000; i++) {
    const th = 2 * Math.PI * Rg(), ph = 2 * Math.PI * Rg();
    const n = [Math.cos(ph) * Math.cos(th), Math.sin(ph), Math.cos(ph) * Math.sin(th)];
    const p = [0.8 * Math.cos(th) + 0.25 * n[0], 0.25 * n[1], 0.8 * Math.sin(th) + 0.25 * n[2]];
    const K = [[1, -1, -1], [-1, -1, 1], [-1, 1, -1], [1, 1, 1]].map(k => k.map(x => x * 0.5773));
    const g = [0, 0, 0];
    for (const k of K) { const v = f(p.map((x, j) => x + h * k[j])); for (let j = 0; j < 3; j++) g[j] += k[j] * v; }
    const g6 = [0, 1, 2].map(j => { const a = [...p], b = [...p]; a[j] += h; b[j] -= h; return f(a) - f(b); });
    const ang = (g: number[]) => { const m = Math.hypot(...g); return Math.acos(Math.min(1, (g[0] * n[0] + g[1] * n[1] + g[2] * n[2]) / m)); };
    e4 = Math.max(e4, ang(g)); e6 = Math.max(e6, ang(g6));
  }
  console.log(`E3 torus h=${h}: tetrahedral 4-tap max angle err ${e4.toExponential(2)} | central 6-tap ${e6.toExponential(2)}`);
}
