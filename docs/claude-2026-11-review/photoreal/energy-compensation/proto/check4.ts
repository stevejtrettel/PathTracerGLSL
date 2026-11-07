// (a) Schlick hemispherical average: 2∫(f0 + (1−f0)(1−μ)^5) μ dμ = f0 + (1−f0)/21.
// (b) Gauss–Legendre accuracy for F_avg of a complex-index conductor (pbrt-v4 FrComplex form).
function frComplex(cosI: number, eta: number, k: number) {
    // pbrt-v4 util/scattering.h FrComplex with complex eta = eta + i k
    type C = [number, number];
    const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
    const div = (a: C, b: C): C => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
    const sub = (a: C, b: C): C => [a[0] - b[0], a[1] - b[1]];
    const add = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
    const sqrtC = (a: C): C => { const r = Math.hypot(a[0], a[1]); const re = Math.sqrt((r + a[0]) / 2); const im = Math.sign(a[1] || 1) * Math.sqrt(Math.max(0, (r - a[0]) / 2)); return [re, im]; };
    const n: C = [eta, k]; const ci: C = [cosI, 0];
    const sin2i = 1 - cosI * cosI;
    const sin2t = div([sin2i, 0], mul(n, n));
    const ct = sqrtC(sub([1, 0], sin2t));
    const rpar = div(sub(mul(n, ci), ct), add(mul(n, ci), ct));
    const rperp = div(sub(ci, mul(n, ct)), add(ci, mul(n, ct)));
    const n2 = (a: C) => a[0] * a[0] + a[1] * a[1];
    return (n2(rpar) + n2(rperp)) / 2;
}
// Gauss–Legendre nodes on [-1,1], n=8
const GL8x = [-0.9602898564975363, -0.7966664774136267, -0.5255324099163290, -0.1834346424956498, 0.1834346424956498, 0.5255324099163290, 0.7966664774136267, 0.9602898564975363];
const GL8w = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.3626837833783620, 0.3626837833783620, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];
const gl8 = (f: (m: number) => number) => GL8x.reduce((s, x, i) => s + GL8w[i] * 0.5 * f(0.5 * (x + 1)), 0);
const fine = (f: (m: number) => number) => { const N = 200000; let s = 0; for (let i = 0; i < N; i++) s += f((i + 0.5) / N); return s / N; };
for (const f0 of [0, 0.04, 0.5, 0.9, 1]) {
    const v = fine(m => 2 * m * (f0 + (1 - f0) * Math.pow(1 - m, 5)));
    console.log(`Schlick f0=${f0}: numeric ${v.toFixed(7)} closed ${(f0 + (1 - f0) / 21).toFixed(7)}`);
}
for (const [name, eta, k] of [['gold~600nm', 0.2, 3.4], ['copper~650nm', 0.27, 3.6], ['aluminium', 1.2, 7.0], ['silver', 0.15, 3.6], ['iron', 2.9, 3.0], ['dielectric 1.5', 1.5, 0]] as Array<[string, number, number]>) {
    const ref = fine(m => 2 * m * frComplex(m, eta, k)), g = gl8(m => 2 * m * frComplex(m, eta, k));
    console.log(`${name}: Favg=${ref.toFixed(6)} GL8=${g.toFixed(6)} err=${Math.abs(g - ref).toExponential(1)} F0=${frComplex(1, eta, k).toFixed(4)}`);
}
