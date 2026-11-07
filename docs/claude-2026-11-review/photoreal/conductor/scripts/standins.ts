// Scratch: compare RGB stand-ins for a measured conductor (eta(λ), k(λ)) against the D65-projected
// spectral reflectance. Usage: npx tsx standins.ts <path to pbrt spectrum.cpp>
import { readFileSync } from 'node:fs';
import { cie1931Curves } from '/Users/stevetrettel/Code/PathTracerGLSL/src/components/sensor/cie1931/curves.js';
import { d65Curve } from '/Users/stevetrettel/Code/PathTracerGLSL/src/components/color/spectral/d65.js';
import { spectralData } from '/Users/stevetrettel/Code/PathTracerGLSL/src/components/color/spectral/data.js';

const src = readFileSync(process.argv[2], 'utf8');
function table(name: string): [number, number][] {
    const m = src.match(new RegExp(`const Float ${name}\\[\\] = \\{([^}]*)\\}`));
    if (!m) throw new Error(name);
    const nums = m[1].split(',').map(s => s.trim()).filter(s => s.length).map(Number);
    const out: [number, number][] = [];
    for (let i = 0; i < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
    return out;
}
// pbrt PiecewiseLinearSpectrum: linear between knots, clamped (constant) outside.
function plin(t: [number, number][], l: number): number {
    if (l <= t[0][0]) return t[0][1];
    if (l >= t[t.length - 1][0]) return t[t.length - 1][1];
    let i = 0; while (t[i + 1][0] < l) i++;
    const f = (l - t[i][0]) / (t[i + 1][0] - t[i][0]);
    return t[i][1] * (1 - f) + t[i + 1][1] * f;
}

// pbrt-v4 FrComplex (scattering.h:81-92), complex arithmetic spelled out.
type C = [number, number];
const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a: C, b: C): C => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const csqrt = (z: C): C => { const r = Math.hypot(z[0], z[1]); const re = Math.sqrt(0.5 * (r + z[0])); const im = Math.sqrt(0.5 * (r - z[0])) * (z[1] < 0 ? -1 : 1); return [re, im]; };
const norm = (z: C) => z[0] * z[0] + z[1] * z[1];
export function frComplex(cosI: number, eta: number, k: number): number {
    cosI = Math.min(1, Math.max(0, cosI));
    const e: C = [eta, k];
    const sin2i = 1 - cosI * cosI;
    const sin2t = cdiv([sin2i, 0], cmul(e, e));
    const cost = csqrt([1 - sin2t[0], -sin2t[1]]);
    const ec = cmul(e, [cosI, 0]);
    const rpar = cdiv([ec[0] - cost[0], ec[1] - cost[1]], [ec[0] + cost[0], ec[1] + cost[1]]);
    const ect = cmul(e, cost);
    const rperp = cdiv([cosI - ect[0], -ect[1]], [cosI + ect[0], ect[1]]);
    return (norm(rpar) + norm(rperp)) / 2;
}
// Mitsuba 3 fresnel_conductor (fresnel.h:103-127), real arithmetic.
export function frMitsuba(c: number, er: number, ei: number): number {
    const c2 = c * c, s2 = 1 - c2, s4 = s2 * s2;
    const t1 = er * er - ei * ei - s2;
    const a2pb2 = Math.sqrt(Math.max(0, t1 * t1 + 4 * ei * ei * er * er));
    const a = Math.sqrt(Math.max(0, 0.5 * (a2pb2 + t1)));
    const term1 = a2pb2 + c2, term2 = 2 * c * a;
    const rs = (term1 - term2) / (term1 + term2);
    const term3 = a2pb2 * c2 + s4, term4 = term2 * s2;
    const rp = rs * (term3 - term4) / (term3 + term4);
    return 0.5 * (rs + rp);
}

// D65-weighted, white-normalized projection (the gaussianStandIn rule, generalized).
const M = spectralData.xyzToRGB;
function project(g: (l: number) => number): number[] {
    const num = [0, 0, 0], den = [0, 0, 0];
    for (let interval = 0; interval < cie1931Curves.length - 1; interval++) {
        for (let s = 0; s <= 10; s++) {
            const fr = s / 10, l = 360 + 5 * (interval + fr);
            const w = 0.5 / 3 * (s === 0 || s === 10 ? 1 : s % 2 ? 4 : 2);
            const lerp = (a: number, b: number) => a * (1 - fr) + b * fr;
            const cmf = [0, 1, 2].map(j => lerp(cie1931Curves[interval][j], cie1931Curves[interval + 1][j]));
            const light = w * lerp(d65Curve[interval], d65Curve[interval + 1]);
            const v = g(l);
            for (let c = 0; c < 3; c++) {
                const resp = M[c][0] * cmf[0] + M[c][1] * cmf[1] + M[c][2] * cmf[2];
                num[c] += v * light * resp; den[c] += light * resp;
            }
        }
    }
    return num.map((x, c) => x / den[c]);
}
// Mitsuba spectrum_list_to_srgb(bounded=false, d65=false): equal-energy XYZ, Y normalized.
function projectMitsuba(g: (l: number) => number): number[] {
    const xyz = [0, 0, 0]; let ynorm = 0;
    for (let interval = 0; interval < cie1931Curves.length - 1; interval++) {
        for (let s = 0; s < 10; s++) {
            const fr = s / 10;
            const cmf = [0, 1, 2].map(j => cie1931Curves[interval][j] * (1 - fr) + cie1931Curves[interval + 1][j] * fr);
            const v = g(360 + 5 * (interval + fr));
            for (let j = 0; j < 3; j++) xyz[j] += cmf[j] * v;
            ynorm += cmf[1];
        }
    }
    const x = xyz.map(v => v / ynorm);
    return [0, 1, 2].map(c => Math.max(0, M[c][0] * x[0] + M[c][1] * x[1] + M[c][2] * x[2]));
}

const metals = ['Au', 'Cu', 'Ag', 'Al', 'CuZn'];
const angles = [0, 30, 45, 60, 70, 80, 85];
// Check the two Fresnel transcriptions agree.
let maxd = 0;
for (const m of metals) {
    const te = table(`${m}_eta`), tk = table(`${m}_k`);
    for (let l = 360; l <= 830; l += 1) for (let c = 0; c <= 1; c += 0.01) {
        maxd = Math.max(maxd, Math.abs(frComplex(c, plin(te, l), plin(tk, l)) - frMitsuba(c, plin(te, l), plin(tk, l))));
    }
}
console.log(`max |pbrt FrComplex - Mitsuba fresnel_conductor| over 5 metals, 360-830 nm, cos 0..1: ${maxd.toExponential(2)}`);

// 5 nm resample error (uniform grid from 360 to 830, linear between nodes).
let maxResF = 0, maxResV = 0;
for (const m of metals) {
    const te = table(`${m}_eta`), tk = table(`${m}_k`);
    const grid = (t: [number, number][]) => Array.from({ length: 95 }, (_, i) => plin(t, 360 + 5 * i));
    const ge = grid(te), gk = grid(tk);
    const g = (arr: number[], l: number) => { const x = (l - 360) / 5; const i = Math.min(93, Math.floor(x)); const f = x - i; return arr[i] * (1 - f) + arr[i + 1] * f; };
    for (let l = 360; l <= 830; l += 0.25) {
        maxResV = Math.max(maxResV, Math.abs(g(ge, l) - plin(te, l)), Math.abs(g(gk, l) - plin(tk, l)));
        for (let c = 0; c <= 1; c += 0.05) maxResF = Math.max(maxResF, Math.abs(frComplex(c, g(ge, l), g(gk, l)) - frComplex(c, plin(te, l), plin(tk, l))));
    }
}
console.log(`5 nm resample: max |Δeta|,|Δk| = ${maxResV.toFixed(4)}, max |ΔF| = ${maxResF.toExponential(2)}`);

for (const m of metals) {
    const te = table(`${m}_eta`), tk = table(`${m}_k`);
    const truth = (deg: number) => project(l => frComplex(Math.cos(deg * Math.PI / 180), plin(te, l), plin(tk, l)));
    const r0 = truth(0);
    const etaS2 = project(l => plin(te, l)), kS2 = project(l => plin(tk, l));
    const etaS1 = projectMitsuba(l => plin(te, l)), kS1 = projectMitsuba(l => plin(tk, l));
    const kS5 = etaS2.map((n, c) => Math.sqrt((r0[c] * (n + 1) ** 2 - (n - 1) ** 2) / (1 - r0[c])));
    const kS4 = r0.map(r => 2 * Math.sqrt(r) / Math.sqrt(1 - r));
    const schlick = (deg: number, c: number) => r0[c] + (1 - r0[c]) * Math.pow(1 - Math.cos(deg * Math.PI / 180), 5);
    const cands: Record<string, (deg: number, c: number) => number> = {
        'S1 mitsuba-proj eta,k': (d, c) => frComplex(Math.cos(d * Math.PI / 180), etaS1[c], kS1[c]),
        'S2 D65-proj eta,k':     (d, c) => frComplex(Math.cos(d * Math.PI / 180), etaS2[c], kS2[c]),
        'S4 pbrt refl (eta=1)':  (d, c) => frComplex(Math.cos(d * Math.PI / 180), 1, kS4[c]),
        'S5 D65 eta + k for R0': (d, c) => frComplex(Math.cos(d * Math.PI / 180), etaS2[c], kS5[c]),
        'Schlick(R0) (ggx today)': schlick,
    };
    console.log(`\n${m}: truth R(0)=${r0.map(x => x.toFixed(4))}  eta_D65=${etaS2.map(x => x.toFixed(3))} k_D65=${kS2.map(x => x.toFixed(3))}  k_S5=${kS5.map(x => x.toFixed(3))}`);
    console.log('  truth by angle: ' + angles.map(a => `${a}°:${truth(a).map(x => x.toFixed(3)).join('/')}`).join('  '));
    for (const [name, f] of Object.entries(cands)) {
        let worst = 0, at = '';
        for (const a of [0, 10, 20, 30, 40, 50, 60, 70, 75, 80, 85, 89]) {
            const t = truth(a);
            for (let c = 0; c < 3; c++) { const e = Math.abs(f(a, c) - t[c]); if (e > worst) { worst = e; at = `${a}° ch${c}`; } }
        }
        console.log(`  ${name.padEnd(26)} max|err| ${worst.toFixed(4)} (${at})  R(0)=${[0, 1, 2].map(c => f(0, c).toFixed(4))}`);
    }
}
