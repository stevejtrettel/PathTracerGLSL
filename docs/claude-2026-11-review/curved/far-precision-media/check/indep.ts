// Independent checks for check.md (float64 truth, float32 via Math.fround).
const f = Math.fround;
type V = number[];
const mink = (a: V, b: V) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2]-a[3]*b[3];
let s = 12345; const r = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
const unit3 = () => { const z = 1-2*r(), ph = 2*Math.PI*r(), q = Math.sqrt(1-z*z); return [q*Math.cos(ph), q*Math.sin(ph), z]; };
const hPoint = (u: number[], D: number): V => [Math.sinh(D)*u[0], Math.sinh(D)*u[1], Math.sinh(D)*u[2], Math.cosh(D)];
// random unit tangent at p: project a random ambient vector, normalize
const hTan = (p: V): V => { const a = [...unit3(), 0.3*(r()-0.5)]; const c = mink(a, p); const t = a.map((x,i)=>x + c*p[i]); const n = Math.sqrt(mink(t,t)); return t.map(x=>x/n); };
const flow = (p: V, v: V, t: number) => p.map((x,i)=>Math.cosh(t)*x + Math.sinh(t)*v[i]);
const dist = (p: V, q: V) => Math.acosh(Math.max(1, -mink(p,q)));   // float64 truth (ok in f64 for these ranges)
const distS = (p: V, q: V) => { const d = p.map((x,i)=>x-q[i]); return 2*Math.asinh(Math.sqrt(Math.max(0,mink(d,d)))/2); };

// A. w-recompute error vs fp_uncertainty = REL*max|p_i| (all four): ratio
{
  const REL = 3.0517578125e-5, ABS = 1.52587890625e-5;
  for (const D of [2, 4, 6, 8, 10]) {
    let worst = 0, worstErr = 0;
    for (let k = 0; k < 2000; k++) {
      const p0 = hPoint(unit3(), 0.5*r()), v0 = hTan(p0);
      const ex = flow(p0, v0, D);
      const c = f(Math.cosh(f(D))), sh = f(Math.sinh(f(D)));
      const pf = p0.map((x,i)=>f(f(f(x)*c) + f(f(v0[i])*sh)));
      const xyz = [pf[0],pf[1],pf[2]]; const w = f(Math.sqrt(f(1 + f(f(xyz[0]*xyz[0]) + f(xyz[1]*xyz[1])) + f(xyz[2]*xyz[2]))));
      const q = [...xyz, w];
      const e = distS(ex, q);   // short distance: stable form in f64
      const fu = Math.max(ABS, REL*Math.max(...q.map(Math.abs)));
      worst = Math.max(worst, e/fu); worstErr = Math.max(worstErr, e);
    }
    console.log(`[A] D=${D}: w-recompute arc err ${worstErr.toExponential(2)}; max err/fp_unc(xyzw) = ${worst.toExponential(2)}`);
  }
}
// B. Short shadow distances at D=4 in float32: acosh form vs asinh form, d in {0.01, 0.1, 1}
{
  for (const D of [0, 2, 4]) for (const d of [0.01, 0.1, 1, 5]) {
    let eA = 0, eS = 0;
    for (let k = 0; k < 500; k++) {
      const p = hPoint(unit3(), D), v = hTan(p), q = flow(p, v, d);
      const P = p.map(f), Q = q.map(f);
      const fm = (a: V, b: V) => f(f(f(f(a[0]*b[0]) + f(a[1]*b[1])) + f(a[2]*b[2])) - f(a[3]*b[3]));
      const dA = f(Math.acosh(Math.max(1, f(-fm(P,Q)))));
      const dv = P.map((x,i)=>f(x - Q[i])); const dS = f(2*Math.asinh(f(Math.sqrt(Math.max(0, fm(dv,dv)))/2)));
      eA = Math.max(eA, Math.abs(dA - d)); eS = Math.max(eS, Math.abs(dS - d));
    }
    console.log(`[B] D=${D} d=${d}: |err| acosh ${eA.toExponential(2)}, asinh ${eS.toExponential(2)}  (SHADOW_BACKOFF 2e-3)`);
  }
}
// C. Jacobian via the Poisson kernel P(x,xi) = (-<x,xihat>)^{-2}: dOmega_x = P dOmega_o, and (x+v).w = 1/(-<x,xihat>)
{
  let worst = 0;
  for (let k = 0; k < 200; k++) {
    const D = 3*r(); const x = hPoint(unit3(), D); const xi = unit3(); const xh = [...xi, 1];
    const c = mink(x, xh); const v = xh.map((a,i)=>(a + c*x[i])/(-c));
    worst = Math.max(worst, Math.abs((x[3]+v[3]) * (-c) - 1));
  }
  console.log(`[C] max |(x+v).w * (-<x,xihat>) - 1| = ${worst.toExponential(2)}  (so 1/((x+v).w)^2 = <x,xihat>^2 = 1/Poisson)`);
}
// D. S3: the long arc arrives at y with velocity opposite to the short arc's arrival velocity.
{
  const eu = (a: V, b: V) => a.reduce((s,x,i)=>s+x*b[i],0);
  const u4 = () => { const a = [r()-.5, r()-.5, r()-.5, r()-.5]; const n = Math.sqrt(eu(a,a)); return a.map(x=>x/n); };
  let worst = 0;
  for (let k = 0; k < 200; k++) {
    const x = u4(); let a = u4(); const c = eu(a,x); a = a.map((y,i)=>y - c*x[i]); const na = Math.sqrt(eu(a,a)); const u = a.map(y=>y/na);
    const d = 0.3 + 2.5*r();
    const yS = x.map((p,i)=>Math.cos(d)*p + Math.sin(d)*u[i]);          // short arc: direction u, length d
    const velS = x.map((p,i)=>-Math.sin(d)*p + Math.cos(d)*u[i]);
    const L = 2*Math.PI - d; const yL = x.map((p,i)=>Math.cos(L)*p - Math.sin(L)*u[i]);   // long arc: direction -u
    const velL = x.map((p,i)=>-Math.sin(L)*p - Math.cos(L)*u[i]);
    const same = Math.hypot(...yS.map((q,i)=>q-yL[i]));
    worst = Math.max(worst, same, Math.abs(eu(velS, velL) + 1));
  }
  console.log(`[D] S3: long arc reaches the same point, arrival velocity = -(short-arc arrival velocity): max dev ${worst.toExponential(2)}`);
}
// E. S3 march epsilon at t=3: min(5e-4, 1e-4(1+t)) / sin t
console.log(`[E] march_epsilon(3)=${Math.min(5e-4, 1e-4*4)}; /sin(3) = ${(Math.min(5e-4,1e-4*4)/Math.sin(3)).toExponential(2)} rad`);
