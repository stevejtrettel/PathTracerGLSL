// Does routing d2 through a distance-based seam (r = sqrt(d2); A = r*r) change float32 bits?
const f = Math.fround;
let diff = 0, N = 1000000;
for (let i = 0; i < N; i++) {
  const x = f((Math.random()-0.5)*10), y = f((Math.random()-0.5)*10), z = f((Math.random()-0.5)*10);
  const d2 = f(f(f(x*x) + f(y*y)) + f(z*z));
  const r = f(Math.sqrt(d2));
  if (f(r*r) !== d2) diff++;
}
console.log(`f32: sqrt(d2)^2 != d2 in ${(100*diff/N).toFixed(1)}% of random cases`);
// Does normalize-free unit combination differ? n/a. Check Euclidean norm of a unit H3 tangent vector off-origin
const t = 2.0, p = [Math.sinh(t), 0, 0, Math.cosh(t)], v = [Math.cosh(t), 0, 0, Math.sinh(t)]; // unit tangent at p along the geodesic
console.log('H3 unit tangent at distance 2: Minkowski <v,v> =', (v[0]**2 - v[3]**2).toFixed(6), ' Euclidean |v| =', Math.hypot(...v).toFixed(4), ' tangency <p,v> =', (p[0]*v[0]-p[3]*v[3]).toFixed(6));
