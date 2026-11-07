// H³ tube discriminant D = S²(S² − (|P|² − |V|²)) − (P×V)² in float32 (fround after each op) vs
// float64 on the same rounded inputs, for grazing rays from distance 3.
import { hyperbolicGeometry as H } from '../../../../src/components/ambient/hyperbolic/hyperbolic.js';
const f = Math.fround;
type V4 = number[];
const form = (a: V4, b: V4) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2]-a[3]*b[3];
let s = 7; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
for (const r of [0.01, 0.03, 0.1, 0.3]) for (const D0 of [1, 2, 3]) {
  let mism = 0, n = 0, mismN = 0;
  for (let i = 0; i < 20000; i++) {
    // origin at distance D0 in a random direction; aim at a point at axis distance r·(1+δ), δ ∈ ±2%
    const u = [rnd()-0.5, rnd()-0.5, rnd()-0.5]; const un = Math.hypot(...u);
    const p = H.exp([u[0]/un*D0, u[1]/un*D0, u[2]/un*D0] as any);
    const ang = 2*Math.PI*rnd(), rr = r*(1 + 0.04*(rnd()-0.5)), y = 0.6*(rnd()-0.5);
    const q = H.exp([rr*Math.cos(ang), y, rr*Math.sin(ang)] as any);
    // chord projected
    const c = q.map((x,k)=>x-p[k]); const w = c.map((x,k)=>x + form(p,c)*p[k]); const wl = Math.sqrt(form(w,w));
    const v = w.map(x=>x/wl);
    const pr = p.map(f), vr = v.map(f);
    const S = Math.sinh(r), S2 = f(f(S)*f(S));
    const D64 = (() => { const P2 = pr[0]**2+pr[2]**2, V2 = vr[0]**2+vr[2]**2, X = pr[0]*vr[2]-pr[2]*vr[0]; return S2*(S2-(P2-V2)) - X*X; })();
    const D32 = (() => { const P2 = f(f(pr[0]*pr[0])+f(pr[2]*pr[2])), V2 = f(f(vr[0]*vr[0])+f(vr[2]*vr[2])); const X = f(f(pr[0]*vr[2])-f(pr[2]*vr[0])); return f(f(S2*f(S2-f(P2-V2))) - f(X*X)); })();
    // the naive form: (β)² − αγ̂ with β = |P|²−|V|²−2S², α=|P+V|², γ̂=|P−V|²
    const N32 = (() => { const P2 = f(f(pr[0]*pr[0])+f(pr[2]*pr[2])), V2 = f(f(vr[0]*vr[0])+f(vr[2]*vr[2])); const b = f(f(P2-V2)-f(2*S2)); const a = f(f((pr[0]+vr[0])**2)+f((pr[2]+vr[2])**2)), g = f(f((pr[0]-vr[0])**2)+f((pr[2]-vr[2])**2)); return f(f(b*b)-f(a*g)); })();
    n++; if (Math.sign(D32) !== Math.sign(D64)) mism++; if (Math.sign(N32) !== Math.sign(D64)) mismN++;
  }
  console.log(`r=${r} dist=${D0}: sign(D) f32 vs f64-of-rounded mismatch ${(100*mism/n).toFixed(2)}% ; naive β²−αγ̂ ${(100*mismN/n).toFixed(2)}% (grazing band ±2%)`);
}
