// Colored Schlick conductor under the Cycles/Turquin gain g = 1 + Fms (1−E)/E,
// Fms = Favg Eavg / (1 − Favg (1 − Eavg)), Favg = f0 + (1 − f0)/21.
// Reports the compensated directional albedo g·E_F(μ) (E_F = single-scatter albedo WITH Fresnel)
// — must never exceed 1 (energy creation) — and how it compares with uncompensated E_F.
import { vndf, G1, quad, woOf, E_cond, type V3 } from './twin.ts';
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function E_F(mu: number, a: number, f0: number, N: number) {
    const wo = woOf(mu);
    return quad((u1, u2) => {
        const m = vndf(wo, a, u1, u2); const d = 2 * dot(wo, m);
        const wi: V3 = [d * m[0] - wo[0], d * m[1] - wo[1], d * m[2] - wo[2]];
        if (wi[2] <= 0) return 0;
        const F = f0 + (1 - f0) * Math.pow(1 - Math.abs(dot(wo, m)), 5);
        return F * G1(wi, a);
    }, N);
}
function Eavg(a: number) { // 2∫E μ dμ, midpoint in μ
    const M = 64; let s = 0; for (let i = 0; i < M; i++) { const mu = (i + 0.5) / M; s += 2 * mu * E_cond(mu, a, 128); } return s / M;
}
let worst = 0, at = '';
for (const r of [0.3, 0.6, 1.0]) {
    const a = r * r, ea = Eavg(a);
    console.log(`rough=${r} Eavg=${ea.toFixed(4)}`);
    for (const f0 of [0.04, 0.5, 0.9, 1.0]) {
        const fa = f0 + (1 - f0) / 21, fms = fa * ea / (1 - fa * (1 - ea));
        const row: string[] = [];
        for (const mu of [0.05, 0.3, 0.7, 1.0]) {
            const e = E_cond(mu, a, 256), ef = E_F(mu, a, f0, 256);
            const comp = (1 + fms * (1 - e) / e) * ef;
            if (comp > worst) { worst = comp; at = `r=${r} f0=${f0} mu=${mu}`; }
            row.push(`mu=${mu}: ${ef.toFixed(4)}→${comp.toFixed(4)}`);
        }
        console.log(`  f0=${f0}: ${row.join('  ')}`);
    }
}
console.log('max compensated albedo', worst.toFixed(5), at);
