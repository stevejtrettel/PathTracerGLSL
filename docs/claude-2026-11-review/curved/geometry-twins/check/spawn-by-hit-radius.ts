// Independent check of the H3 spawn claim, written without the twin modules.
// Unit sphere (radius 1) centred at c = (sinh R e, cosh R). Random hit point h on it with outward
// normal n (exact, float64), rounded to float32. Spawn q = cosh(eps) h32 + sinh(eps) n32 in float32.
// Judges: (true) float64 distance from c to q/sqrt(-<q,q>) minus 1;
//         (local) float32: x = T^-1 q with T^-1 = J T^T J in float32, d = asinh(|x_s|) - 1.
// For each sample: the smallest eps on a fine log grid that clears the surface. Report the max
// needed eps binned by the HIT POINT's distance from the world origin, and eps / cosh^2(r_hit).
const f = Math.fround;
const mink = (a: number[], b: number[]) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2] - a[3]*b[3];
let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const unit3 = () => { const z = 2*rnd()-1, ph = 2*Math.PI*rnd(), s = Math.sqrt(1-z*z); return [s*Math.cos(ph), s*Math.sin(ph), z]; };
function translation(p: number[]) { // boost taking o to p
  const k = 1/(1+p[3]); const m = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  for (let i=0;i<3;i++){ for (let j=0;j<3;j++) m[i][j]=(i===j?1:0)+p[i]*p[j]*k; m[i][3]=p[i]; m[3][i]=p[i]; }
  m[3][3]=p[3]; return m;
}
const mv = (m: number[][], v: number[]) => m.map(r => r.reduce((s,x,j)=>s+x*v[j],0));
const mv32 = (m: number[][], v: number[]) => m.map(r => { let s=0; for (let j=0;j<4;j++) s=f(s+f(r[j]*v[j])); return s; });
const eps = Array.from({length: 60}, (_, i) => 1e-7 * Math.pow(10, i/8)); // 1e-7 .. ~3e0
const bins = new Map<number, {t:number,l:number,n:number}>();
for (const R of [0,1,2,3,4,5]) for (let k=0;k<3000;k++) {
  const e = unit3(); const c = [Math.sinh(R)*e[0], Math.sinh(R)*e[1], Math.sinh(R)*e[2], Math.cosh(R)];
  const T = translation(c); const Tinv32 = [0,1,2,3].map(i => [0,1,2,3].map(j => f(T[j][i] * (i===3?-1:1) * (j===3?-1:1))));
  const d = unit3(); const nd = [d[0],d[1],d[2],0];
  const h = mv(T, [Math.sinh(1)*d[0], Math.sinh(1)*d[1], Math.sinh(1)*d[2], Math.cosh(1)]);
  const n = mv(T, [Math.cosh(1)*d[0], Math.cosh(1)*d[1], Math.cosh(1)*d[2], Math.sinh(1)]);
  const rh = Math.acosh(h[3]);
  const h32 = h.map(f), n32 = n.map(f);
  let needT = NaN, needL = NaN;
  for (const ep of eps) {
    const ch = f(Math.cosh(ep)), sh = f(Math.sinh(ep));
    const q = h32.map((x,i)=>f(f(ch*x)+f(sh*n32[i])));
    const qq = q.map(x => x/Math.sqrt(-mink(q,q)));
    const dt = Math.acosh(Math.max(1, -mink(qq, c))) - 1;
    const x = mv32(Tinv32, q); const sp = f(Math.sqrt(f(f(f(x[0]*x[0])+f(x[1]*x[1]))+f(x[2]*x[2]))));
    const dl = f(Math.asinh(sp)) - 1;
    if (Number.isNaN(needT) && dt > 0) needT = ep;
    if (Number.isNaN(needL) && dl > 0) needL = ep;
  }
  const b = Math.floor(rh*2)/2; const o = bins.get(b) ?? {t:0,l:0,n:0};
  o.t = Math.max(o.t, needT); o.l = Math.max(o.l, needL); o.n++; bins.set(b, o);
}
console.log('r_hit bin | n | max eps needed (true judge) | /cosh^2(r_hi) | max eps (local f32 judge) | /cosh^2(r_hi)');
for (const b of [...bins.keys()].sort((a,b)=>a-b)) { const o = bins.get(b)!; const c2 = Math.cosh(b+0.5)**2;
  console.log(`[${b},${b+0.5}) | ${o.n} | ${o.t.toExponential(2)} | ${(o.t/c2).toExponential(2)} | ${o.l.toExponential(2)} | ${(o.l/c2).toExponential(2)}`); }
