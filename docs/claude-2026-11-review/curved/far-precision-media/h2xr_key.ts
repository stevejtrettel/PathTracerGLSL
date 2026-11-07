// H2xR sky key (brief): endpoint class of a geodesic = (ideal point of the H2 part, beta).
// Key K = (sin(beta) * xiH, cos(beta)) with xiH = Klein(pH + uhat), a unit 2-vector.
// Checks: (a) Klein/limit convergence of the H2 part; (b) d(phi_o)/d(phi_x) = 1/((pH+uhat).z).
import { rng } from './lib.ts';
const r = rng(99); const out = (s: string) => console.log(s);
const m3 = (a: number[], b: number[]) => a[0]*b[0] + a[1]*b[1] - a[2]*b[2];
for (let k = 0; k < 5; k++) {
    const D = 2.5 * r(), th = 2 * Math.PI * r();
    const pH = [Math.sinh(D)*Math.cos(th), Math.sinh(D)*Math.sin(th), Math.cosh(D)];
    // orthonormal tangent basis at pH: radial e1 (boost direction) and angular e2
    const e1 = [Math.cosh(D)*Math.cos(th), Math.cosh(D)*Math.sin(th), Math.sinh(D)], e2 = [-Math.sin(th), Math.cos(th), 0];
    const uh = (phi: number) => [0, 1, 2].map((i) => Math.cos(phi)*e1[i] + Math.sin(phi)*e2[i]);
    const xi = (phi: number) => { const s = uh(phi).map((x, i) => x + pH[i]); return Math.atan2(s[1]/s[2], s[0]/s[2]); };
    const phi = 2 * Math.PI * r(), h = 1e-6;
    let dxi = xi(phi + h) - xi(phi - h); if (dxi > Math.PI) dxi -= 2*Math.PI; if (dxi < -Math.PI) dxi += 2*Math.PI;
    const fd = dxi / (2 * h); const s = uh(phi).map((x, i) => x + pH[i]);
    // (a) the H2 part flowed far lands on the same ideal point
    const t = 25, g = [0,1,2].map((i) => Math.cosh(t)*pH[i] + Math.sinh(t)*uh(phi)[i]);
    const conv = Math.abs(Math.atan2(g[1]/g[2], g[0]/g[2]) - xi(phi));
    out(`D=${D.toFixed(2)}: dphi_o/dphi_x FD ${fd.toFixed(6)} vs 1/(pH+uhat).z ${(1/s[2]).toFixed(6)}; |m3(s,s)| ${Math.abs(m3(s,s)).toExponential(1)}; limit-angle diff ${conv.toExponential(1)}`);
}
