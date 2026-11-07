// The transvection computed from the exp-coordinate vector v directly (generator form,
// exp(d M) = I + sh(d) M + sigma(1 - ch(d)) M^2 style), versus from the point P = expO(v) with
// the 1/(1+w) formula. The v-form has no singularity at the S3 antipode (|v| = pi).
import { type Space, type V3, type M4, J, mul, transpose, expO, transvection } from './space.ts';
function transvectionFromV(s: Space, v: V3): M4 {
    const d = Math.hypot(...v); const I = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    if (d === 0) return I;
    const u = v.map((x) => x / d);
    const k = s === 'H' ? 1 : -1;  // H3: M = [[0,u],[u^T,0]] (M^3 = M); S3: M = [[0,u],[-u^T,0]] (M^3 = -M)
    const M = [0,0,0,u[0], 0,0,0,u[1], 0,0,0,u[2], k*u[0],k*u[1],k*u[2],0];
    const M2 = mul(M, M);
    const a = s === 'H' ? Math.sinh(d) : Math.sin(d), b = s === 'H' ? Math.cosh(d) - 1 : 1 - Math.cos(d);
    return I.map((x, i) => x + a * M[i] + b * M2[i]);
}
const isoErr = (s: Space, g: M4) => Math.max(...mul(transpose(g), mul(J(s), g)).map((x, i) => Math.abs(x - J(s)[i])));
for (const s of ['H', 'S'] as Space[]) {
    let e = 0;
    for (let k = 1; k < 400; k++) {
        const v: V3 = [Math.sin(k) * 1.5, Math.cos(2 * k) * 1.2, Math.sin(3 * k)];
        const A = transvectionFromV(s, v), B = transvection(s, expO(s, v));
        e = Math.max(e, ...A.map((x, i) => Math.abs(x - B[i]) / Math.max(1, Math.abs(B[i]))));
    }
    console.log(`${s}3: generator-form transvection == point-form: ${e.toExponential(2)}`);
}
for (const d of [Math.PI - 1e-6, Math.PI, 4.0]) {
    const T = transvectionFromV('S', [d, 0, 0]);
    console.log(`S3 generator-form at |v| = ${d.toFixed(7)}: isometry error ${isoErr('S', T).toExponential(2)}`);
}
