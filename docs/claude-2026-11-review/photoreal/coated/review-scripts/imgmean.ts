// Image-mean of A(μ) for a unit sphere seen by a pinhole (full vertical fov, square image),
// to test whether "spectral-mirror's setup" (fov 0.2, distance 4, whole frame) reads A(1).
function fresnel(c: number, eta: number) { const s2 = eta*eta*(1-c*c); if (s2 >= 1) return 1; const t = Math.sqrt(1-s2);
  const a = (c-eta*t)/(c+eta*t), b = (eta*c-t)/(eta*c+t); return 0.5*(a*a+b*b); }
const K = 0.5963457597, eta = 1.5;
const A = (mu: number, R: number) => { const F = fresnel(mu, 1/eta); return F + (1-F)*R*(1-K)/(1-R*K); };
function mean(fov: number, dist: number, R: number, region = { x: 0, y: 0, w: 1, h: 1 }, N = 400) {
  const t = Math.tan(fov/2); let s = 0, n = 0, minMu = 1;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const u = region.x + (i+0.5)/N*region.w, v = region.y + (j+0.5)/N*region.h;
    const dx = (2*u-1)*t, dy = (2*v-1)*t; const len = Math.hypot(dx, dy, 1);
    const sinA = Math.hypot(dx, dy)/len; const d = dist*sinA;   // perpendicular distance of ray from center
    if (d >= 1) { s += 1; n++; continue; }                         // sky
    const mu = Math.sqrt(1-d*d); minMu = Math.min(minMu, mu); s += A(mu, R); n++;
  }
  return { mean: s/n, minMu };
}
for (const R of [1, 0.5]) {
  console.log(`R=${R} A(1)=${A(1,R).toFixed(6)}`);
  console.log('  spectral-mirror setup, whole frame:', mean(0.2, 4, R));
  console.log('  spectral-mirror setup, center 10% region:', mean(0.2, 4, R, { x: 0.45, y: 0.45, w: 0.1, h: 0.1 }));
  console.log('  furnace-sky setup, center region:', mean(0.8, 3.5, R, { x: 0.45, y: 0.45, w: 0.1, h: 0.1 }));
  console.log('  furnace-sky setup, whole frame:', mean(0.8, 3.5, R));
}
