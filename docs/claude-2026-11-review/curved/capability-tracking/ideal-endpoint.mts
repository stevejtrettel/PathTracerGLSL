// H³ hyperboloid (form x1y1+x2y2+x3y3-x4y4, origin (0,0,0,1)). Checks that the sky direction
// of the geodesic γ(t) = cosh t·p + sinh t·v (v a unit tangent at p) is
// (p+v)_xyz / (p+v)_w — i.e. env charts (functions of a unit 3-vector) can be reused in H³
// once the ambient supplies this one map. float64.
const mink = (a: number[], b: number[]) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2] - a[3]*b[3];
function rnd() { return Math.random()*2-1; }
let worst = 0;
for (let k = 0; k < 1000; k++) {
  // random point: boost of origin
  const x = [rnd()*3, rnd()*3, rnd()*3]; const p = [...x, Math.sqrt(1 + x[0]**2 + x[1]**2 + x[2]**2)];
  // random tangent at p: project a random vector onto p^⊥ (Minkowski) and normalize
  let w = [rnd(), rnd(), rnd(), rnd()]; const c = mink(w, p) / mink(p, p);
  w = w.map((wi, i) => wi - c * p[i]); const n = Math.sqrt(mink(w, w)); const v = w.map(wi => wi / n);
  const s = p.map((pi, i) => pi + v[i]); const pred = [s[0]/s[3], s[1]/s[3], s[2]/s[3]];
  const t = 30; const g = p.map((pi, i) => Math.cosh(t)*pi + Math.sinh(t)*v[i]);
  const l = Math.hypot(g[0], g[1], g[2]); const dir = [g[0]/l, g[1]/l, g[2]/l];
  worst = Math.max(worst, Math.hypot(dir[0]-pred[0], dir[1]-pred[1], dir[2]-pred[2]), Math.abs(Math.hypot(...pred) - 1));
}
console.log('max |sky dir at t=30 − (p+v)_xyz/(p+v)_w| and | |pred|−1 | over 1000 random rays:', worst.toExponential(2));
