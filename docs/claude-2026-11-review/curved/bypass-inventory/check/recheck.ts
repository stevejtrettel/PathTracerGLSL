// Independent checks by the reviewer of bypass-inventory. float64 unless Math.fround.
const f = Math.fround;
const rnd = (R: number) => { for(;;){ const v=[0,0,0].map(()=> (2*Math.random()-1)*R); if (Math.hypot(...v) < R) return v; } };

// A. S3 sphere light: p at distance d from the center, radius R. For d > pi - R, does EVERY
// direction meet the ball within t <= pi?  (the cone formula sin(th)=sinR/sind would exceed 1
// or give the wrong cap there)
for (const [d, R] of [[2.9, 0.4], [2.7, 0.4], [3.0, 0.3]]) {
  let worst = 0; // max over directions of the min distance to center along t in [0, pi]
  for (let k = 0; k <= 2000; k++) { const th = Math.PI * k / 2000; let best = Infinity;
    for (let i = 0; i <= 4000; i++) { const t = Math.PI * i / 4000;
      best = Math.min(best, Math.acos(Math.max(-1, Math.min(1, Math.cos(t)*Math.cos(d) + Math.sin(t)*Math.sin(d)*Math.cos(th))))); }
    worst = Math.max(worst, best); }
  console.log(`A. S3 d=${d} R=${R} (pi-R=${(Math.PI-R).toFixed(3)}): max over directions of min dist to center = ${worst.toFixed(4)} -> every direction hits: ${worst <= R}; sinR/sind = ${(Math.sin(R)/Math.sin(d)).toFixed(3)}`);
}

// B. Stereographic chart of S3 centered on the object (x = X/(1+w)): is d_S >= |x-y| for |x|,|y| < 1?
let viol = 0, minr = Infinity;
for (let k = 0; k < 200000; k++) {
  const x = rnd(1), y = rnd(1);
  const lift = (a: number[]) => { const s = a[0]**2+a[1]**2+a[2]**2; return [...a.map(c=>2*c/(1+s)), (1-s)/(1+s)]; };
  const X = lift(x), Y = lift(y);
  const dS = Math.acos(Math.max(-1, Math.min(1, X[0]*Y[0]+X[1]*Y[1]+X[2]*Y[2]+X[3]*Y[3])));
  const dE = Math.hypot(x[0]-y[0], x[1]-y[1], x[2]-y[2]);
  if (dS < dE - 1e-12) viol++; minr = Math.min(minr, dS/dE);
}
console.log(`B. stereographic chart, |x|,|y|<1: pairs with d_S3 < |x-y|: ${viol}/200000, min ratio ${minr.toFixed(4)}`);

// C. H3, f32 ARITHMETIC: two points at distance T from the world origin, separation s.
// Recover s = acosh(-<p,q>) with every operation rounded to f32 (as a GPU would, no FMA).
const mink32 = (a: number[], b: number[]) => f(f(f(f(a[0]*b[0]) + f(a[1]*b[1])) + f(a[2]*b[2])) - f(a[3]*b[3]));
const pt = (T: number, u: number[]) => [Math.sinh(T)*u[0], Math.sinh(T)*u[1], Math.sinh(T)*u[2], Math.cosh(T)];
for (const T of [1, 3, 5, 7, 9]) for (const s of [0.5]) {
  let worst = 0;
  for (let k = 0; k < 2000; k++) {
    const u = rnd(1); const n = Math.hypot(...u); const a = u.map(c=>c/n);
    // q: from p go distance s in a random tangent direction (exact in f64), then store both in f32
    const p = pt(T, a);
    let v = rnd(1); // random tangent: project out p in Minkowski sense, normalize
    let v4 = [...v, 0]; const pv = v4[0]*p[0]+v4[1]*p[1]+v4[2]*p[2]-v4[3]*p[3];
    v4 = v4.map((c,i)=>c + pv*p[i]); const vn = Math.sqrt(v4[0]**2+v4[1]**2+v4[2]**2-v4[3]**2); v4 = v4.map(c=>c/vn);
    const q = p.map((c,i)=> c*Math.cosh(s) + v4[i]*Math.sinh(s));
    const p32 = p.map(f), q32 = q.map(f);
    const est = Math.acosh(Math.max(1, -mink32(p32, q32)));
    worst = Math.max(worst, Math.abs(est - s));
  }
  console.log(`C. H3 f32 arithmetic: points at distance ${T} from the origin, separation ${s}: max |error in separation| = ${worst.toExponential(2)}`);
}
// D. H3: position error of a single f32-stored point after projecting back to the hyperboloid
for (const T of [3, 5, 7, 8, 9, 12]) {
  let worst = 0, spacelike = 0;
  for (let k = 0; k < 2000; k++) { const u = rnd(1); const n = Math.hypot(...u); const a = u.map(c=>c/n);
    const p = pt(T, a), p32 = p.map(f);
    const m = -(p32[0]**2+p32[1]**2+p32[2]**2-p32[3]**2); if (!(m > 0)) { spacelike++; continue; } const pr = p32.map(c=>c/Math.sqrt(m));
    const c = -(p[0]*pr[0]+p[1]*pr[1]+p[2]*pr[2]-p[3]*pr[3]);
    // stable distance: 2 asinh(|p - pr|_M / 2)
    const dd = p.map((x,i)=>x-pr[i]); const nm = Math.sqrt(Math.max(0, dd[0]**2+dd[1]**2+dd[2]**2-dd[3]**2));
    worst = Math.max(worst, 2*Math.asinh(nm/2)); }
  console.log(`D. H3 f32-stored point at ${T}, projected back: max hyperbolic position error = ${worst.toExponential(2)}; stored point not timelike in ${spacelike}/2000; 1.5e-8*e^{2T} = ${(1.5e-8*Math.exp(2*T)).toExponential(1)}`);
}
