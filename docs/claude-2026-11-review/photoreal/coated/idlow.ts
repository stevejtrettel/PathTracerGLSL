// η < 1 check of the identity 1 − K_int(η) = (1 − Fdr_ext(η))/η², plus a finer quadrature
// to bound the integration error at η = 1.5.
function fresnel(c: number, eta: number) { const s2 = eta*eta*(1-c*c); if (s2 >= 1) return 1; const t = Math.sqrt(1-s2);
  const a = (c-eta*t)/(c+eta*t), b = (eta*c-t)/(eta*c+t); return 0.5*(a*a+b*b); }
function simpson(f: (x:number)=>number, a: number, b: number, n: number) { const h=(b-a)/n; let s=f(a)+f(b);
  for (let i=1;i<n;i++) s += (i%2?4:2)*f(a+i*h); return s*h/3; }
// substitution μ = μc + (1-μc)·s² removes the sqrt kink at the critical cosine
function fdr(eta: number, n = 20000) { const mc = eta > 1 ? Math.sqrt(1-1/(eta*eta)) : 0; const g = (m:number)=>fresnel(m,eta)*2*m;
  const lo = mc > 0 ? mc*mc : 0;   // ∫_0^mc 2μ dμ = mc² exactly (F = 1 under TIR)
  return lo + simpson(s => g(mc+(1-mc)*s*s)*(1-mc)*2*s, 0, 1, n); }
for (const eta of [0.6, 0.8, 1.2, 1.5, 2.0]) { const K = fdr(eta), E = fdr(1/eta);
  console.log(`η=${eta}: K_int=${K.toFixed(10)} 1-K=${(1-K).toExponential(10)} (1-Fext)/η²=${((1-E)/(eta*eta)).toExponential(10)} diff=${((1-K)-(1-E)/(eta*eta)).toExponential(2)}`); }
