// Scratch twin: Zeltner 2022 LTC sheen (MaterialX mx_microfacet_sheen.glsl transcription)
// and pbrt-v4 thin dielectric. Checks: D normalization, sampler pdf == D, sampled
// histogram vs D, E range, aInv sign, thin-dielectric R+T and furnace identity.
const PI = Math.PI;
const sq = (x: number) => x * x;

function E(x: number, y: number) {   // x = mu_o, y = roughness
    const s = y * (0.0206607 + 1.58491 * y) / (0.0379424 + y * (1.32227 + y));
    const m = y * (-0.193854 + y * (-1.14885 + y * (1.7932 - 0.95943 * y * y))) / (0.046391 + y);
    const o = y * (0.000654023 + (-0.0207818 + 0.119681 * y) * y) / (1.26264 + y * (-1.92021 + y));
    return Math.exp(-0.5 * sq((x - m) / s)) / (s * Math.sqrt(2 * PI)) + o;
}
const aInv = (x: number, y: number) => (2.58126 * x + 0.813703 * y) * y / (1 + 0.310327 * x * x + 2.60994 * x * y);
const bInv = (x: number, y: number) => Math.sqrt(1 - x) * (y - 1) * y * y * y / (0.0000254053 + 1.71228 * x - 1.71506 * x * y + 1.34174 * y * y);

// wi in the LTC frame (X in the plane of wo and n, toward wo; n = z).
function D(w: number[], muo: number, r: number) {
    const a = aInv(muo, r), b = bInv(muo, r);
    const o = [a * w[0] + b * w[2], a * w[1], w[2]];
    const len2 = o[0] * o[0] + o[1] * o[1] + o[2] * o[2];
    return Math.max(o[2], 0) / PI * sq(a / len2);
}
function sample(u: [number, number], muo: number, r: number): { w: number[]; pdf: number } {
    const phi = 2 * PI * u[0], ct = Math.sqrt(u[1]), st = Math.sqrt(1 - u[1]);
    const o = [Math.cos(phi) * st, Math.sin(phi) * st, ct];
    const a = aInv(muo, r), b = bInv(muo, r);
    let w = [o[0] / a - o[2] * b / a, o[1] / a, o[2]];
    const len2 = w[0] * w[0] + w[1] * w[1] + w[2] * w[2];
    const l = Math.sqrt(len2); w = w.map(v => v / l);
    return { w, pdf: Math.max(w[2], 0) / PI * sq(a * len2) };
}

let rng = 12345;
const rand = () => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 4294967296; };

console.log('--- sheen ---');
let minE = 1e9, maxE = -1e9, minA = 1e9;
for (let i = 0; i <= 50; i++) for (let j = 1; j <= 50; j++) {
    const x = i / 50, y = 0.01 + 0.99 * (j - 1) / 49;
    const e = E(x, y); minE = Math.min(minE, e); maxE = Math.max(maxE, e);
    minA = Math.min(minA, aInv(x, y));
}
console.log('E range over mu_o in [0,1], r in [0.01,1]:', minE.toFixed(5), maxE.toFixed(5), ' min aInv:', minA.toExponential(3));

for (const [muo, r] of [[1, 0.5], [0.5, 0.5], [0.1, 0.3], [0.9, 0.05], [0.3, 1.0], [0.02, 0.01], [0.7, 0.01]]) {
    // Normalization by stratified quadrature over the hemisphere (uniform in cos, phi).
    const N = 1200; let integ = 0;
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
        const ct = (a + 0.5) / N, phi = 2 * PI * (b + 0.5) / N, st = Math.sqrt(1 - ct * ct);
        integ += D([st * Math.cos(phi), st * Math.sin(phi), ct], muo, r);
    }
    integ *= 2 * PI / (N * N);
    // Sampler: pdf returned vs D at the same direction; histogram vs D over cells in (cos, phi).
    let maxRel = 0; const B = 8; const hist = new Float64Array(B * B); const S = 400000;
    for (let k = 0; k < S; k++) {
        const s = sample([rand(), rand()], muo, r);
        const d = D(s.w, muo, r);
        if (d > 0) maxRel = Math.max(maxRel, Math.abs(s.pdf - d) / d);
        const ci = Math.min(B - 1, Math.floor(s.w[2] * B));
        let ph = Math.atan2(s.w[1], s.w[0]); if (ph < 0) ph += 2 * PI;
        hist[ci * B + Math.min(B - 1, Math.floor(ph / (2 * PI) * B))]++;
    }
    let chi2 = 0, dof = 0;
    for (let ci = 0; ci < B; ci++) for (let pj = 0; pj < B; pj++) {
        const M = 60; let p = 0;
        for (let a = 0; a < M; a++) for (let b = 0; b < M; b++) {
            const ct = (ci + (a + 0.5) / M) / B, phi = 2 * PI * (pj + (b + 0.5) / M) / B, st = Math.sqrt(1 - ct * ct);
            p += D([st * Math.cos(phi), st * Math.sin(phi), ct], muo, r);
        }
        p *= (1 / B) * (2 * PI / B) / (M * M);
        const exp = p * S; if (exp < 5) continue;
        chi2 += sq(hist[ci * B + pj] - exp) / exp; dof++;
    }
    console.log(`mu_o=${muo} r=${r}: integral D = ${integ.toFixed(5)}  max|pdf-D|/D = ${maxRel.toExponential(2)}  chi2=${chi2.toFixed(1)} over ${dof} cells  E=${E(muo, r).toFixed(4)}`);
}

console.log('--- thin dielectric ---');
function frDielectric(cosI: number, eta: number) {   // pbrt FrDielectric, eta = n_t/n_i, cosI >= 0
    const sin2t = (1 - cosI * cosI) / (eta * eta);
    if (sin2t >= 1) return 1;
    const cosT = Math.sqrt(1 - sin2t);
    const rpar = (eta * cosI - cosT) / (eta * cosI + cosT), rperp = (cosI - eta * cosT) / (cosI + eta * cosT);
    return (rpar * rpar + rperp * rperp) / 2;
}
for (const c of [1, 0.7, 0.3, 0.05, 0]) {
    const R = frDielectric(c, 1.5), T = 1 - R;
    const Rt = R < 1 ? R + T * T * R / (1 - R * R) : 1;
    console.log(`cos=${c}: R1=${R.toFixed(5)} Rtot=${Rt.toFixed(5)} 2R/(1+R)=${(2 * R / (1 + R)).toFixed(5)} Ttot=${(1 - Rt).toFixed(5)}`);
}
// Normal-incidence transmittance of a pane, eta = 1.5: the derived witness value.
const R0 = frDielectric(1, 1.5);
console.log('T_total(normal, eta 1.5) =', ((1 - R0) / (1 + R0)).toFixed(6), ' R0 =', R0.toFixed(6));
