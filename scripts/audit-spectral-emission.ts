// Independent wavelength quadrature of closed-form volume-emission targets.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spectralCoefficients, evaluatePolynomial, spectralCurves } from '../src/components/color/spectral/lookup.js';
import { spectralData } from '../src/components/color/spectral/data.js';
import type { Vec3 } from '../src/compiler/types.js';
const read = (name: string) => {
    const b = readFileSync(new URL(`../src/components/color/spectral/data/${name}.bin`, import.meta.url));
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset+b.byteLength));
};
const atlas = read('coefficients'), curves = read('curves');
function coefficient(rgb: Vec3) {
    const scale = 2*Math.max(...rgb);
    const polynomial = spectralCoefficients(rgb.map(v => v/scale) as Vec3, atlas);
    return (lambda: number) => scale*evaluatePolynomial(polynomial, lambda);
}
const absorption = coefficient([0.3, 0.7, 1.2]);
const slabEmission = coefficient([0.4, 0.8, 1.2]);
const fogEmission = coefficient([1, 2, 4]);
function integrate(source: (lambda: number) => number, step: number): Vec3 {
    const xyz = [0,0,0], count = Math.round(470/step);
    for (let i=0; i<=count; i++) {
        const lambda = 360+i*step, cmf = spectralCurves(lambda, curves);
        const weight = step/3*(i===0 || i===count ? 1 : i%2 ? 4 : 2);
        for (let c=0; c<3; c++) xyz[c] += weight*source(lambda)*cmf[3]*cmf[c]/spectralData.cieYIntegral;
    }
    return spectralData.xyzToRGB.map(row => row.reduce((s,v,c) => s+v*xyz[c],0)) as Vec3;
}
const targets = [
    { name: 'slab', source: (lambda: number) => {
        const a = absorption(lambda);
        return Math.exp(-a)+slabEmission(lambda)*(a===0 ? 1 : -Math.expm1(-a)/a);
    } },
    ...[0,1,2].map(n => ({ name: `fog-budget-${n}`,
        source: (lambda: number) => fogEmission(lambda)/2*(1-(1/3)**(n+1)) })),
];
for (const {name, source} of targets) {
    const fine = integrate(source, 0.25), coarse = integrate(source, 0.5);
    const discrepancy = Math.max(...fine.map((v,c) => Math.abs(v-coarse[c])));
    assert(discrepancy < 1e-7);
    console.log(JSON.stringify({name, rgb:fine, refinementDiscrepancy:discrepancy}));
}
