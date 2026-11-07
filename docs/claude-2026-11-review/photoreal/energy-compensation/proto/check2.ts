// Interpolation error of the conductor table E(mu, alpha): grid y = sqrt(mu), x = sqrt(alpha),
// nodes i/(n-1) (Cycles' layout, cycles_precompute.cpp), bilinear lookup. Reports the FURNACE error
// |E_true / E_table - 1| at random off-grid points (the white conductor's compensated albedo − 1).
import { E_cond } from './twin.ts';
const ALPHA_MIN = 1e-3, MU_MIN = 1e-4;
const nodeMu = (y: number) => Math.max(MU_MIN, y * y);
const nodeAlpha = (x: number) => Math.max(ALPHA_MIN, x * x);
function build(nMu: number, nA: number, N: number) {
    const t = new Float64Array(nMu * nA);
    for (let j = 0; j < nA; j++) for (let i = 0; i < nMu; i++) t[j * nMu + i] = E_cond(nodeMu(i / (nMu - 1)), nodeAlpha(j / (nA - 1)), N);
    return t;
}
function lookup(t: Float64Array, nMu: number, nA: number, mu: number, alpha: number) {
    const fy = Math.sqrt(mu) * (nMu - 1), fx = Math.sqrt(alpha) * (nA - 1);
    const i0 = Math.min(Math.floor(fy), nMu - 2), j0 = Math.min(Math.floor(fx), nA - 2);
    const ty = fy - i0, tx = fx - j0;
    const v = (i: number, j: number) => t[j * nMu + i];
    return (1 - tx) * ((1 - ty) * v(i0, j0) + ty * v(i0 + 1, j0)) + tx * ((1 - ty) * v(i0, j0 + 1) + ty * v(i0 + 1, j0 + 1));
}
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
for (const [nMu, nA] of [[16, 16], [32, 32], [64, 32]]) {
    const t0 = Date.now(); const t = build(nMu, nA, 256);
    let worst = 0, sum = 0, at = ''; const M = 300; seed = 12345;
    for (let k = 0; k < M; k++) {
        const mu = Math.max(0.005, rnd()), r = Math.max(0.0316, rnd()); const a = r * r;
        const ref = E_cond(mu, a, 512);
        const err = Math.abs(ref / lookup(t, nMu, nA, mu, a) - 1);
        sum += err; if (err > worst) { worst = err; at = `mu=${mu.toFixed(3)} r=${r.toFixed(3)}`; }
    }
    console.log(`${nMu}x${nA}: furnace error max ${worst.toExponential(2)} (${at}) mean ${(sum / M).toExponential(2)}  build ${Date.now() - t0} ms`);
}
