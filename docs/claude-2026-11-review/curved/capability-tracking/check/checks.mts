// Independent checks for the capability-tracking result (float64).
const mink = (a: number[], b: number[]) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2] - a[3]*b[3];
const eu = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x*b[i], 0);
// (1) Euclidean normalize() of a Minkowski-unit tangent vector at a boosted point p (H^3).
for (const d of [0, 0.5, 1, 2, 4]) {
  const p = [Math.sinh(d), 0, 0, Math.cosh(d)];
  const ex = [Math.cosh(d), 0, 0, Math.sinh(d)];          // Minkowski-unit tangent at p along the boost
  const ey = [0, 1, 0, 0];
  const s = 1/Math.SQRT2; const w = ex.map((x, i) => s*x + s*ey[i]);   // Minkowski-unit combination
  const L = Math.sqrt(eu(w, w)); const wn = w.map(x => x/L);           // GLSL normalize()
  console.log(`d=${d}: <w,p>_M=${mink(w,p).toExponential(1)} |w|_M=${Math.sqrt(mink(w,w)).toFixed(6)} after normalize |w|_M=${Math.sqrt(mink(wn,wn)).toFixed(6)}; raw dot(ex,ey')=${eu(ex,ex).toFixed(4)} vs mink ${mink(ex,ex)}`);
}
// (2) Jacobian of the map tangent direction at p -> ideal point (sky direction), H^3.
// p boosted by d along x; v = (cos th) e_x' + (sin th) e_y. Ideal point dir = (p+v)_xyz/(p+v)_w.
function sky(d: number, th: number, ph: number) {
  const p = [Math.sinh(d), 0, 0, Math.cosh(d)];
  const ex = [Math.cosh(d), 0, 0, Math.sinh(d)];
  const v = [0,1,2,3].map(i => Math.cos(th)*ex[i] + (i===1?Math.sin(th)*Math.cos(ph):0) + (i===2?Math.sin(th)*Math.sin(ph):0));
  const s = p.map((x, i) => x + v[i]); return [s[0]/s[3], s[1]/s[3], s[2]/s[3]];
}
const ang = (a: number[], b: number[]) => Math.acos(Math.min(1, eu(a,b)));
for (const d of [0, 1, 2]) {
  const r: string[] = [];
  for (const th of [0.3, Math.PI/2, 2.8]) {
    const h = 1e-6; const a = sky(d, th, 0), b = sky(d, th + h, 0);
    r.push(`th=${th.toFixed(2)}: dSky/dth=${(ang(a,b)/h).toFixed(4)}`);
  }
  console.log(`d=${d}: ${r.join('  ')}`);
}
// (3) counts from the matrix output
const noGlsl = { LIGHT_SELECTIONS: 3, MESH_TRAVERSALS: 2, INSTANCE_ACCELS: 3, OBJECT_DISPATCHES: 2 };
const n = Object.values(noGlsl).reduce((a, b) => a + b, 0);
console.log(`occupants without glsl: ${n}; with glsl: ${64 - n}`);
