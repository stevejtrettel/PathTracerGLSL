// Independent wavelength quadrature for a unit-thickness spectral absorption slab.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spectralCoefficients, evaluatePolynomial, spectralCurves } from '../src/components/color/spectral/lookup.js';
import { spectralData } from '../src/components/color/spectral/data.js';
import type { Vec3 } from '../src/compiler/types.js';
const read = (name: string) => {
    const b = readFileSync(new URL(`../src/components/color/spectral/data/${name}.bin`, import.meta.url));
    return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
};
const atlas = read('coefficients'), curves = read('curves');
const absorption: Vec3 = [0.3,0.7,1.2];
const scale = 2 * Math.max(...absorption);
const polynomial = spectralCoefficients(absorption.map(v=>v/scale) as Vec3,atlas);
function integrate(distance: number, step: number): Vec3 {
    const xyz = [0,0,0], count = Math.round(470/step);
    for (let i=0;i<=count;i++) {
        const lambda = 360+i*step, cmf = spectralCurves(lambda,curves);
        const transmission = Math.exp(-distance*scale*evaluatePolynomial(polynomial,lambda));
        const weight = step/3 * (i===0 || i===count ? 1 : i%2 ? 4 : 2);
        for (let c=0;c<3;c++) xyz[c] += weight*transmission*cmf[3]*cmf[c]/spectralData.cieYIntegral;
    }
    return spectralData.xyzToRGB.map(row=>row.reduce((sum,v,c)=>sum+v*xyz[c],0)) as Vec3;
}
for (const distance of [1,2]) {
    const fine = integrate(distance,0.25), coarse = integrate(distance,0.5);
    const discrepancy = Math.max(...fine.map((v,c)=>Math.abs(v-coarse[c])));
    assert(discrepancy<1e-7);
    console.log(JSON.stringify({distance,rgb:fine,refinementDiscrepancy:discrepancy}));
}
