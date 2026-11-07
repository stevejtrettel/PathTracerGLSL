// Numeric checks for the bypass inventory. float64 unless Math.fround is used.
const f = Math.fround;
const mink = (a: number[], b: number[]) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2] - a[3]*b[3];
// 1. float32 cosh overflow
let lo = 50, hi = 100;
for (let i = 0; i < 60; i++) { const m = (lo+hi)/2; if (f(Math.cosh(m)) === Infinity) hi = m; else lo = m; }
console.log('1. f32 cosh overflows at t =', lo.toFixed(3));
// 2. hyperboloid constraint residual in f32 at distance t (point stored as f32 4-vector)
for (const t of [1, 5, 9, 10, 15, 20, 30]) {
  let worst = 0;
  for (let k = 0; k < 2000; k++) {
    const u = [Math.random()-0.5, Math.random()-0.5, Math.random()-0.5]; const n = Math.hypot(...u); u.forEach((x,i)=>u[i]=x/n);
    const p = [f(Math.sinh(t)*u[0]), f(Math.sinh(t)*u[1]), f(Math.sinh(t)*u[2]), f(Math.cosh(t))];
    // residual of <p,p> = -1, evaluated in f64 from the f32-stored coordinates
    worst = Math.max(worst, Math.abs(mink(p, p) + 1));
    // distance recovered from the stored point: acosh(p.w) vs t
  }
  const pw = f(Math.cosh(t));
  console.log(`2. t=${t}: max |<p,p>+1| from f32 storage = ${worst.toExponential(2)}; acosh(f32 w) - t = ${(Math.acosh(pw)-t).toExponential(2)}`);
}
// 3. small-distance precision: acosh(w) vs asinh(|xyz|), all f32
for (const d of [1e-4, 1e-3, 1e-2, 1e-1]) {
  const w = f(Math.cosh(d)), r = f(Math.sinh(d));
  const viaAcosh = f(Math.acosh(w)), viaAsinh = f(Math.asinh(r));
  console.log(`3. d=${d}: acosh(f32 cosh d) rel err ${(Math.abs(viaAcosh-d)/d).toExponential(2)}, asinh(f32 sinh d) rel err ${(Math.abs(viaAsinh-d)/d).toExponential(2)}`);
}
// 4. Klein chart: hyperbolic distance >= Euclidean chart distance (conservative SDF)?
// 5. Gnomonic chart on S3: spherical distance vs Euclidean chart distance
let kleinViol = 0, kleinMinRatio = Infinity, gnoViol = 0, gnoMinRatio = Infinity;
const rnd = (R: number) => { for(;;){ const v=[2*Math.random()-1,2*Math.random()-1,2*Math.random()-1].map(x=>x*R); if (Math.hypot(...v) < R) return v; } };
for (let k = 0; k < 200000; k++) {
  const x = rnd(0.999), y = rnd(0.999);
  // Klein -> hyperboloid: (x, 1)/sqrt(1-|x|^2)
  const hx = [...x, 1].map(c => c/Math.sqrt(1 - x[0]**2 - x[1]**2 - x[2]**2));
  const hy = [...y, 1].map(c => c/Math.sqrt(1 - y[0]**2 - y[1]**2 - y[2]**2));
  const dH = Math.acosh(Math.max(1, -mink(hx, hy)));
  const dE = Math.hypot(x[0]-y[0], x[1]-y[1], x[2]-y[2]);
  if (dH < dE - 1e-12) kleinViol++; kleinMinRatio = Math.min(kleinMinRatio, dH/dE);
  const a = rnd(3), b = rnd(3);
  const sa = [...a, 1].map(c => c/Math.sqrt(1 + a[0]**2 + a[1]**2 + a[2]**2));
  const sb = [...b, 1].map(c => c/Math.sqrt(1 + b[0]**2 + b[1]**2 + b[2]**2));
  const dS = Math.acos(Math.min(1, sa[0]*sb[0]+sa[1]*sb[1]+sa[2]*sb[2]+sa[3]*sb[3]));
  const dG = Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
  if (dS < dG - 1e-12) gnoViol++; gnoMinRatio = Math.min(gnoMinRatio, dS/dG);
}
console.log(`4. Klein ball: pairs with d_H < |x-y|: ${kleinViol}/200000, min d_H/|x-y| = ${kleinMinRatio.toFixed(4)}`);
console.log(`5. Gnomonic chart |x|<3: pairs with d_S3 < |x-y|: ${gnoViol}/200000, min d_S3/|x-y| = ${gnoMinRatio.toFixed(4)}`);
// 6. sphere-light cone half-angle in H3 / S3: sin(theta_max) = sinh R / sinh d  (H3), sin R / sin d (S3)
function minDistAlong(theta: number, d: number, space: 'H'|'S'): number {
  let best = Infinity; const T = space === 'H' ? 30 : Math.PI;
  for (let i = 0; i <= 20000; i++) { const t = T*i/20000;
    const c = space === 'H'
      ? Math.acosh(Math.max(1, Math.cosh(t)*Math.cosh(d) - Math.sinh(t)*Math.sinh(d)*Math.cos(theta)))
      : Math.acos(Math.max(-1, Math.min(1, Math.cos(t)*Math.cos(d) + Math.sin(t)*Math.sin(d)*Math.cos(theta))));
    best = Math.min(best, c); }
  return best;
}
for (const [space, d, R] of [['H', 3, 0.5], ['H', 6, 1.0], ['S', 1.2, 0.3], ['S', 2.5, 0.4]] as const) {
  let a = 0, b = Math.PI/2;
  for (let i = 0; i < 50; i++) { const m = (a+b)/2; if (minDistAlong(m, d, space) < R) a = m; else b = m; }
  const pred = space === 'H' ? Math.asin(Math.sinh(R)/Math.sinh(d)) : Math.asin(Math.sin(R)/Math.sin(d));
  const eucl = Math.asin(R/d);
  console.log(`6. ${space}3 d=${d} R=${R}: measured theta_max=${a.toFixed(5)}, predicted=${pred.toFixed(5)}, Euclidean formula=${eucl.toFixed(5)}`);
}
// 7. area density: solid angle of a small sphere of radius R at distance d -> ~ pi R^2 / A(d) with A = sinh^2 (H), sin^2 (S)
for (const [space, d] of [['H', 2], ['S', 1]] as const) {
  const R = 1e-3; const th = space === 'H' ? Math.asin(Math.sinh(R)/Math.sinh(d)) : Math.asin(Math.sin(R)/Math.sin(d));
  const omega = 2*Math.PI*(1-Math.cos(th));
  const A = space === 'H' ? Math.sinh(d)**2 : Math.sin(d)**2;
  console.log(`7. ${space}3 d=${d}: solid angle*A(d)/(pi R^2) = ${(omega*A/(Math.PI*R*R)).toFixed(6)} (1 means density A(d)); with d^2: ${(omega*d*d/(Math.PI*R*R)).toFixed(4)}`);
}
