// Independent wavelength quadrature of the serialized lift. Report asset error, not a literature number.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spectralCoefficients, evaluatePolynomial, spectralCurves } from '../src/components/color/spectral/lookup.js';
import { spectralData as d } from '../src/components/color/spectral/data.js';
import type { Vec3 } from '../src/compiler/types.js';
const read = (name: string) => { const b = readFileSync(new URL(`../src/components/color/spectral/data/${name}.bin`, import.meta.url)); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const atlas = read('coefficients'), curves = read('curves');
assert(atlas.every(Number.isFinite));
const colors: Vec3[] = [];
for (const r of [0, .01, .1, .5, .9, .99, 1])
    for (const g of [0, .01, .1, .5, .9, .99, 1])
        for (const b of [0, .01, .1, .5, .9, .99, 1])
            colors.push([r, g, b]);
let seed = 173;
for (let i = 0; i < 1024; i++)
    colors.push([0, 1, 2].map(() => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }) as Vec3);
function integrate(c: Vec3, h: number): number[] {
    const coeff = c.every(x => x === c[0]) ? null : spectralCoefficients(c, atlas);
    const xyz = [0, 0, 0], n = Math.round(470 / h);
    for (let i = 0; i <= n; i++) {
        const lambda = 360 + i * h, cmf = spectralCurves(lambda, curves);
        const rho = coeff ? evaluatePolynomial(coeff, lambda) : c[0];
        const w = (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * h / 3;
        for (let j = 0; j < 3; j++)
            xyz[j] += w * rho * cmf[3] * cmf[j] / d.cieYIntegral;
    }
    return d.xyzToRGB.map(row => row.reduce((s, v, j) => s + v * xyz[j], 0));
}
let sum2 = 0, max = 0, quadrature = 0;
for (const c of colors) {
    const rgb = integrate(c, .5);
    for (let j = 0; j < 3; j++) {
        const e = Math.abs(rgb[j] - c[j]);
        sum2 += e * e;
        max = Math.max(max, e);
    }
}
for (const c of colors.slice(0, 343)) {
    const a = integrate(c, .5), b = integrate(c, .25);
    quadrature = Math.max(quadrature, ...a.map((v, i) => Math.abs(v - b[i])));
}
const rms = Math.sqrt(sum2 / (3 * colors.length));
// Engineering acceptance budget for this serialized model, stated before collecting its errors.
assert(rms < .003 && max < .03, `RGB round trip: rms ${rms}, max ${max}`);
assert(quadrature < 1e-5, `reference quadrature discrepancy ${quadrature}`);
console.log(JSON.stringify({ colors: colors.length, rmsRGB: rms, maxRGB: max, quadratureDiscrepancy: quadrature, white: integrate([1, 1, 1], .25) }, null, 2));
const target: Vec3 = [.2, .5, .8], coeff = spectralCoefficients(target, atlas), xyz = [0, 0, 0];
for (let i = 0; i <= 1880; i++) {
    const lambda = 360 + .25 * i, cmf = spectralCurves(lambda, curves), rho = evaluatePolynomial(coeff, lambda);
    let series = 0, power = 1;
    for (let k = 0; k <= 6; k++) {
        series += power;
        power *= rho;
    }
    const w = (i === 0 || i === 1880 ? 1 : i % 2 ? 4 : 2) * .25 / 3;
    for (let j = 0; j < 3; j++)
        xyz[j] += w * .2 * series * cmf[3] * cmf[j] / d.cieYIntegral;
}
console.log(JSON.stringify({ plane: integrate(target, .25), furnace: d.xyzToRGB.map(row => row.reduce((s, x, j) => s + x * xyz[j], 0)) }));
