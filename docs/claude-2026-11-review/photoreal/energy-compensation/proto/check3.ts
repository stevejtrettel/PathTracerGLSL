// Interpolation error of the dielectric energy table A(mu, alpha, z) per side (enter: eta = n_i/n_t < 1,
// exit: eta > 1), z = F0^(1/4) = sqrt((r-1)/(r+1)) with r = max(eta, 1/eta) (Cycles' ior_to_z_index,
// bsdf_microfacet.h:147). Slices: z = 0 is the index-matched limit A = G1(wo); z = 1 the F = 1 conductor.
// Usage: npx tsx check3.ts nMu nA nZ Nquad
import { A_diel, E_cond, G1, woOf } from './twin.ts';
const [nMu, nA, nZ, NQ] = process.argv.slice(2).map(Number);
const nodeMu = (y: number) => Math.max(1e-4, y * y);
const nodeAlpha = (x: number) => Math.max(1e-3, x * x);
const rOfZ = (z: number) => (1 + z * z) / (1 - z * z);
const zOfR = (r: number) => Math.sqrt((r - 1) / (r + 1));
function A(mu: number, a: number, z: number, side: 'enter' | 'exit', N: number) {
    if (z === 0) return G1(woOf(mu), a);
    if (z === 1) return E_cond(mu, a, N);
    const r = rOfZ(z); return A_diel(mu, a, side === 'enter' ? 1 / r : r, N);
}
function build(side: 'enter' | 'exit') {
    const t = new Float64Array(nMu * nA * nZ);
    for (let k = 0; k < nZ; k++) for (let j = 0; j < nA; j++) for (let i = 0; i < nMu; i++)
        t[(k * nA + j) * nMu + i] = A(nodeMu(i / (nMu - 1)), nodeAlpha(j / (nA - 1)), k / (nZ - 1), side, NQ);
    return t;
}
function lookup(t: Float64Array, mu: number, a: number, z: number) {
    const f = [Math.sqrt(mu) * (nMu - 1), Math.sqrt(a) * (nA - 1), z * (nZ - 1)];
    const n = [nMu, nA, nZ];
    const i0 = f.map((v, d) => Math.min(Math.floor(v), n[d] - 2)); const tt = f.map((v, d) => v - i0[d]);
    let s = 0;
    for (let c = 0; c < 8; c++) {
        const o = [c & 1, (c >> 1) & 1, (c >> 2) & 1];
        const w = o.reduce((p, b, d) => p * (b ? tt[d] : 1 - tt[d]), 1);
        s += w * t[((i0[2] + o[2]) * nA + (i0[1] + o[1])) * nMu + (i0[0] + o[0])];
    }
    return s;
}
let seed = 777; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const t0 = Date.now();
for (const side of ['enter', 'exit'] as const) {
    const t = build(side);
    let worst = 0, sum = 0, at = ''; const M = 200; seed = 777;
    const iors = [1.1, 1.33, 1.5, 1.7, 2.0, 2.42, 1.5 / 1.33];
    for (let k = 0; k < M; k++) {
        const mu = Math.max(0.005, rnd()), rr = Math.max(0.0316, rnd()), a = rr * rr;
        const r = iors[Math.floor(rnd() * iors.length)];
        const ref = A_diel(mu, a, side === 'enter' ? 1 / r : r, 512);
        const err = Math.abs(ref / lookup(t, mu, a, zOfR(r)) - 1);
        sum += err; if (err > worst) { worst = err; at = `mu=${mu.toFixed(3)} rough=${rr.toFixed(3)} n=${r.toFixed(3)}`; }
    }
    console.log(`${side} ${nMu}x${nA}x${nZ} N=${NQ}: furnace error max ${worst.toExponential(2)} (${at}) mean ${(sum / M).toExponential(2)}`);
}
console.log('s', (Date.now() - t0) / 1000);
