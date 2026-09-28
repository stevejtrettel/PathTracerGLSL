// Compare the historical RGB parameterization with Planck projected through the shipped
// CIE sensor. This independent audit is not imported by the renderer.
// npx vite-node scripts/audit-blackbody.ts /tmp/blackbody-comparison
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { kelvinToRGB } from '../tests/helpers/legacyBlackbody.js';
import { spectralData as data } from '../src/components/color/spectral/data.js';
import { spectralCurves, spectralCoefficients, evaluatePolynomial } from '../src/components/color/spectral/lookup.js';
import type { Vec3 } from '../src/compiler/types.js';

const read = (name: string) => {
    const bytes = readFileSync(new URL(`../src/components/color/spectral/data/${name}.bin`, import.meta.url));
    return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};
const curves = read('curves'), atlas = read('coefficients');
const h = 6.62607015e-34, c = 299792458, k = 1.380649e-23;
const c2NM = h * c / k * 1e9;

// B(lambda,T)/B(550 nm,T). The common 2hc² and SI-to-nm factors cancel.
// Normalizing its RGB projection cancels the 550 nm reference as well.
function planckShape(lambdaNM: number, temperature: number): number {
    return (550 / lambdaNM) ** 5
        * Math.expm1(c2NM / (550 * temperature))
        / Math.expm1(c2NM / (lambdaNM * temperature));
}
function project(spectrum: (lambda: number) => number, step = 0.5): Vec3 {
    const xyz = [0, 0, 0];
    const count = Math.round((data.lambdaMax - data.lambdaMin) / step);
    for (let i = 0; i <= count; i++) {
        const lambda = data.lambdaMin + i * step;
        const cmf = spectralCurves(lambda, curves);
        const weight = step / 3 * (i === 0 || i === count ? 1 : i % 2 ? 4 : 2);
        const value = weight * spectrum(lambda) / data.cieYIntegral;
        for (let channel = 0; channel < 3; channel++) xyz[channel] += value * cmf[channel];
    }
    return data.xyzToRGB.map(row => row.reduce((sum, v, i) => sum + v * xyz[i], 0)) as Vec3;
}
const normalize = (rgb: Vec3) => rgb.map(v => v / Math.max(...rgb)) as Vec3;
const distance = (a: Vec3, b: Vec3) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const luminance = (rgb: Vec3) => data.rgbToXYZ[1].reduce((sum, v, i) => sum + v * rgb[i], 0);
function compare(temperature: number) {
    const current = kelvinToRGB(temperature);
    const planck = normalize(project(lambda => planckShape(lambda, temperature)));
    const fine = normalize(project(lambda => planckShape(lambda, temperature), 0.25));
    assert(planck.every(Number.isFinite));
    const refinement = distance(planck, fine);
    assert(refinement < 1e-7, `quadrature refinement at ${temperature} K: ${refinement}`);
    return { temperature, current, planck, maxChannelDelta: distance(current, planck),
        clippedChannelDelta: distance(current, planck.map(v => Math.max(0, v)) as Vec3),
        luminanceChange: luminance(planck) / luminance(current) - 1, refinement };
}

// Inclusive 1 K sweep of the existing effective temperature domain, plus every
// polynomial branch boundary. Fine quadrature is checked at every temperature.
let worst = compare(1667), worstClipped = worst, maxRefinement = 0;
let negativeBlueEnd = 0;
for (let temperature = 1667; temperature <= 25000; temperature++) {
    const result = compare(temperature);
    if (result.maxChannelDelta > worst.maxChannelDelta) worst = result;
    if (result.clippedChannelDelta > worstClipped.clippedChannelDelta) worstClipped = result;
    maxRefinement = Math.max(maxRefinement, result.refinement);
    if (result.planck[2] < 0) negativeBlueEnd = temperature;
}
const temperatures = [1000, 1500, 1667, 1800, 2000, 2222, 2700, 2900, 3200, 4000, 5000, 6500, 12000, 25000, 40000];
const rows = temperatures.map(compare);

// Check the relative formula against SI Planck with a separate exponent evaluation.
let maxSIResidual = 0;
for (const temperature of temperatures) {
    const si = (nm: number) => {
        const meters = nm * 1e-9;
        return 2 * h * c * c / (meters ** 5 * (Math.exp(h * c / (meters * k * temperature)) - 1));
    };
    for (const lambda of [360, 410, 550, 660, 830]) {
        const residual = Math.abs(planckShape(lambda, temperature) / (si(lambda) / si(550)) - 1);
        maxSIResidual = Math.max(maxSIResidual, residual);
        assert(residual < 1e-12);
    }
}

// Same direct RGB, different spectra: illuminating a selective receiver exposes
// information lost when a blackbody is first reduced to RGB and then upsampled.
const receiver: Vec3 = [0.1, 0.5, 0.8];
const reflectanceCoefficients = spectralCoefficients(receiver, atlas);
const selectiveReceiver = [3200, 6500, 12000].map(temperature => {
    const rgb = project(lambda => planckShape(lambda, temperature));
    const K = Math.max(...rgb);
    const normalized = normalize(rgb);
    assert(normalized.every(v => v > 0));
    const emissionCoefficients = spectralCoefficients(normalized.map(v => v / 2) as Vec3, atlas);
    const lifted = (lambda: number) => 2 * evaluatePolynomial(emissionCoefficients, lambda) * spectralCurves(lambda, curves)[3];
    const rho = (lambda: number) => evaluatePolynomial(reflectanceCoefficients, lambda);
    const trueSource = project(lambda => planckShape(lambda, temperature) / K * rho(lambda));
    const rgbLiftedSource = project(lambda => lifted(lambda) * rho(lambda));
    return { temperature, receiver, trueSource, rgbLiftedSource,
        directLiftError: distance(project(lifted), normalized),
        reflectedDelta: distance(trueSource, rgbLiftedSource),
        luminanceChange: luminance(trueSource) / luminance(rgbLiftedSource) - 1 };
});
const report = {
    assetVersion: data.version, curvesSHA256: data.sha256['curves.bin'],
    wavelengthDomainNM: [data.lambdaMin, data.lambdaMax], temperatureSweepK: [1667, 25000],
    normalization: 'max linear RGB channel = 1; signed channels preserved; scale = 1',
    c2NM, worst, worstClipped, maxRefinement, maxSIResidual, negativeBlueEnd, rows, selectiveReceiver,
};
const directory = process.argv[2] ?? '/tmp/blackbody-comparison';
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, 'comparison.json'), JSON.stringify(report, null, 2) + '\n');

// Swatches show direct emission with sRGB encoding and display-only gamut clipping.
// Numerical values preserve signed linear RGB. No exposure or tone map is applied.
function swatch(rgb: Vec3): string {
    const encoded = rgb.map(v => {
        const x = Math.max(0, Math.min(1, v));
        return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
    });
    return `<span class="swatch" style="background:rgb(${encoded.join(',')})"></span>`;
}
const triple = (rgb: Vec3) => rgb.map(v => v.toFixed(5)).join(', ');
const percent = (v: number) => (100 * v).toFixed(3) + '%';
writeFileSync(join(directory, 'comparison.html'), `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blackbody: current RGB versus Planck</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;background:#f5f5f2;color:#202326;margin:40px auto;padding:0 24px;max-width:1100px}
h1{font-size:30px;line-height:1.2}p{max-width:850px}table{border-collapse:collapse;width:100%;background:white;margin:28px 0}
th,td{padding:10px 14px;text-align:left;border-bottom:1px solid #ddd}th{font-size:13px}td{font-variant-numeric:tabular-nums}
.swatch{display:inline-block;width:90px;height:38px;vertical-align:middle;border:1px solid #999;border-radius:3px}
small{display:block;font:11px/1.8 monospace;margin-top:5px}caption{text-align:left;font-weight:650;padding-bottom:12px}
.outside{background:#fff4e8}.note{color:#575e63;font-size:14px}a{color:#145888}
</style>
<h1>Blackbody: current RGB versus Planck</h1>
<p>Both use <b>scale = 1</b>: the largest linear RGB channel is one. Planck uses the shipped
CIE sensor over 360–830 nm. This is a CPU comparison, not a changed renderer or a rendered scene.</p>
<p>Within 1667–25,000 K, the largest measured channel change is <b>${percent(worst.maxChannelDelta)}</b>
of the unit peak, at <b>${worst.temperature} K</b>. After display-only negative clipping,
the maximum linear-channel change is <b>${percent(worstClipped.clippedChannelDelta)}</b>
at <b>${worstClipped.temperature} K</b>. Orange rows isolate a separate range decision:
the current implementation clamps these temperatures; the Planck column evaluates them as written.</p>
<table><caption>Direct emission — sRGB display swatches, signed linear RGB values</caption>
<thead><tr><th>Temperature</th><th>Current approximation</th><th>Planck projection</th><th>Max channel change<br>(% of unit peak)</th><th>Luminance change</th></tr></thead>
<tbody>${rows.map(r => `<tr class="${r.temperature < 1667 || r.temperature > 25000 ? 'outside' : ''}"><td>${r.temperature} K</td><td>${swatch(r.current)}<small>${triple(r.current)}</small></td><td>${swatch(r.planck)}<small>${triple(r.planck)}</small></td><td>${percent(r.maxChannelDelta)}</td><td>${percent(r.luminanceChange)}</td></tr>`).join('\n')}</tbody></table>
<p class="note">Swatches clip negative channels only for display. Near the low end, the positive
Planck spectrum projects outside the sRGB gamut; its negative blue value is retained in the numbers.
A channel difference is not a perceptual colour-difference metric or an error bound for arbitrary scenes.</p>
<table><caption>A selective receiver distinguishes spectra with nearly equal direct RGB</caption>
<thead><tr><th>Temperature</th><th>True Planck illumination</th><th>RGB reconstructed illumination</th><th>Luminance change</th></tr></thead>
<tbody>${selectiveReceiver.map(r => `<tr><td>${r.temperature} K</td><td>${swatch(r.trueSource)}<small>${triple(r.trueSource)}</small></td><td>${swatch(r.rgbLiftedSource)}<small>${triple(r.rgbLiftedSource)}</small></td><td>${percent(r.luminanceChange)}</td></tr>`).join('\n')}</tbody></table>
<p class="note">Receiver RGB: [0.1, 0.5, 0.8], lifted with the existing reflectance table.
Values are the sensor integral of source × reflectance; a common geometric/Lambert factor is omitted.
The reconstructed source starts from Planck's own RGB, not the old approximation. See comparison.json
for direct RGB reconstruction errors, separating lift error from the different reflected spectrum.</p>
<p class="note">Composite Simpson quadrature: 0.5 nm, checked against 0.25 nm at every integer K in the
existing range. Maximum normalized discrepancy: ${maxRefinement.toExponential(3)}.
SI-form residual: ${maxSIResidual.toExponential(3)}. Asset: ${data.version}.</p>
<p class="note">Physics: <a href="https://www.pbr-book.org/4ed/Radiometry%2C_Spectra%2C_and_Color/Light_Emission">Planck emission</a>.
Constants: <a href="https://physics.nist.gov/cuu/Constants/Table/allascii.txt">NIST SI constants</a>.
Normalization follows this repository's proposed blackbody contract, not absolute thermal power.</p>
`);
console.log(JSON.stringify({ directory, worst, worstClipped, maxRefinement, maxSIResidual, negativeBlueEnd, rows, selectiveReceiver }, null, 2));
