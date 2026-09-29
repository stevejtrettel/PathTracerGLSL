// Execute shipped spectral lookup, sampling and sensor integration in WebGL2.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { renderProbes } from '../tools/render-glsl-probes.mjs';
import { spectral } from '../src/components/color/spectral/spectral.js';
import { cie1931 } from '../src/components/sensor/cie1931/cie1931.js';
import { spectralData as data } from '../src/components/color/spectral/data.js';
import { spectralCoefficients, spectralCurves, evaluatePolynomial } from '../src/components/color/spectral/lookup.js';
import type { Vec3 } from '../src/compiler/types.js';
function floats(name: string): Float32Array {
    const b = readFileSync(new URL(`../src/components/color/spectral/data/${name}.bin`, import.meta.url));
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
const atlas = floats('coefficients'), curves = floats('curves');
const textures = [
    { uniform: 'u_spectralCoefficients', width: data.atlasWidth, height: data.atlasHeight, data: Array.from(atlas) },
    { uniform: 'u_spectralCurves', width: data.curveWidth, height: data.curveHeight, data: Array.from(curves) },
];
const width = 4096;
function shader(body: string, sampler = 'visible', projection = spectral.glsl, lookup = spectral.supportGLSL) {
    return `#version 300 es
precision highp float;
precision highp int;
#define Direction vec3
#define SPECTRUM_ZERO vec4(0.0)
uniform highp sampler2D u_spectralCoefficients;
uniform highp sampler2D u_spectralCurves;
out vec4 result;
${spectral.typesGLSL}
float random() { return (gl_FragCoord.x - 0.5) / ${width - 1}.0; }
${lookup}
${spectral.wavelengthSamplers![sampler]}
${cie1931.glsl}
${projection}
void main() { ${body} }`;
}
const lambdas = [365, 455, 555, 725];
const colours: Vec3[] = [[0, 0, 0], [1, 1, 1], [0.25, 0.25, 0.25], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1], [1, 0, 1], [0.2, 0.5, 0.8], [0.001, 0, 0.0001], [1, 0.99, 0.98]];
let seed = 173;
for (let i = 0; i < 40; ++i)
    colours.push([0, 1, 2].map(() => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }) as Vec3);
const literal = (v: number[]) => `vec${v.length}(${v.map(x => x.toFixed(9)).join(',')})`;
const lookupBody = `Wavelengths wl = Wavelengths(${literal(lambdas)}); int i = int(gl_FragCoord.x);\n` + colours.map((rgb, i) => `if (i == ${i}) { result = spectral_bounded(${literal(rgb)}, wl); return; }`).join('\n') + '\nresult = vec4(0.0);';
const expectedLookup = colours.map(rgb => rgb.every(c => c === rgb[0]) ? lambdas.map(() => rgb[0]) : lambdas.map(l => evaluatePolynomial(spectralCoefficients(rgb, atlas), l)));
// Largest channels so small that 63/z overflows float32 (z below about 1.85e-37); the table
// coordinates must stay finite. `one` is 1.0 at run time, so the compiler cannot fold the values.
const tinyColours: Vec3[] = [[1e-37, 5e-38, 0], [1e-37, 0, 0]];
const tinyBody = 'float one = step(0.0, gl_FragCoord.x); int i = int(gl_FragCoord.x);\n'
    + tinyColours.map((rgb, i) => `if (i == ${i}) { result = vec4(spectral_coefficients(vec3(${rgb.map(c => c === 0 ? '0.0' : c.toExponential()).join(', ')}) * one), 0.0); return; }`).join('\n')
    + '\nresult = vec4(0.0);';
const expectedTiny = tinyColours.map(rgb => spectralCoefficients(rgb.map(Math.fround) as Vec3, atlas));
const filmBody = `WavelengthSample s = WavelengthSample(Wavelengths(vec4(410.0, 480.0, 555.0, 660.0)), vec4(0.001,0.002,0.004,0.008)); result = vec4(color_to_pixel(vec2(0.0), vec3(0.0,0.0,1.0), vec4(2.0,0.02,0.03,0.04), s), 1.0);`;
const sensor = (lambda: number) => data.xyzToRGB.map(row => row.reduce((s, x, j) => s + x * spectralCurves(lambda, curves)[j], 0) / data.cieYIntegral);
const expectedFilm = [410, 480, 555, 660].map(sensor).reduce((out, s, lane) => out.map((x, i) => x + ([2, .02, .03, .04][lane] / [.001, .002, .004, .008][lane] / 4) * s[i]), [0, 0, 0]);
assert(expectedFilm.some(x => x < 0), 'fixed film fixture must contain a negative output channel');
const whiteBody = 'WavelengthSample s = wavelengths_sample(); result = vec4(color_to_pixel(vec2(0.0),vec3(0.0,0.0,1.0),color_lift_emission(vec3(1.0),s.wl),s),1.0);';
const roleRGB: Vec3 = [2, .7, .1];
const roleCoefficients = spectralCoefficients([.5, .175, .025], atlas);
const roleExpected = lambdas.map(l => 4 * evaluatePolynomial(roleCoefficients, l));
const roleBody = (role: string) => `result = color_lift_${role}(${literal(roleRGB)}, Wavelengths(${literal(lambdas)}));`;
const probes = [
    { name: 'lookup', source: shader(lookupBody) },
    { name: 'signed film with unequal PDFs', source: shader(filmBody) },
    ...['uniform', 'visible'].flatMap(policy => [
        { name: `${policy} wavelengths`, source: shader('result = wavelengths_sample().wl.lambda;', policy) },
        { name: `${policy} PDFs`, source: shader('result = wavelengths_sample().pdf;', policy) },
        { name: `${policy} white`, source: shader(whiteBody, policy) },
    ]),
];
probes.push({ name: 'coefficient role', source: shader(roleBody('coefficient')) }, { name: 'emission role', source: shader(roleBody('emission')) });
probes.push({ name: 'tiny largest channel', source: shader(tinyBody) });
const mutations = [
    { name: 'common PDF', source: shader(filmBody, 'visible', spectral.glsl.replace('L[i] / camera_sample.pdf[i]', 'L[i] / camera_sample.pdf[0]')) },
    { name: 'fourth lane omitted', source: shader(filmBody, 'visible', spectral.glsl.replaceAll('i < 4', 'i < 3')) },
    { name: 'early clamp', source: shader(filmBody, 'visible', spectral.glsl.replace('return 0.25 * pixel;', 'return max(vec3(0.0), 0.25 * pixel);')) },
];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    const frames = await renderProbes(page, [...probes, ...mutations], width, textures);
    let worst = 0;
    expectedLookup.forEach((expected, i) => expected.forEach((x, j) => {
        const error = Math.abs(frames[0][4 * i + j] - x);
        worst = Math.max(worst, error);
        assert(error < 0.002, `lookup ${i}/${j}: error ${error}`);
    }));
    function verifyFilm(frame: number[]) {
        expectedFilm.forEach((x, j) => assert(Math.abs(frame[j] - x) < 2e-5, `film ${j}: ${frame[j]} != ${x}`));
    }
    verifyFilm(frames[1]);
    const a = Math.tanh(.0072 * (360 - 538)), b = Math.tanh(.0072 * (830 - 538));
    for (const [k, policy] of ['uniform', 'visible'].entries()) {
        const wl = frames[2 + 3 * k], pdf = frames[3 + 3 * k], white = frames[4 + 3 * k];
        const average = [0, 0, 0];
        for (let x = 0; x < width; x++)
            for (let i = 0; i < 4; i++) {
                const u = (x / (width - 1) + i / 4) % 1;
                const expected = policy === 'uniform' ? 360 + 470 * u : 538 + Math.atanh(a + (b - a) * u) / .0072;
                assert(Math.abs(wl[4 * x + i] - expected) < 0.002, `${policy} inverse CDF`);
                assert(wl[4 * x + i] >= 359.9999 && wl[4 * x + i] <= 830.0001, `${policy} support`);
                const density = policy === 'uniform' ? 1 / 470 : .0072 / ((b - a) * Math.cosh(.0072 * (wl[4 * x + i] - 538)) ** 2);
                assert(Math.abs(pdf[4 * x + i] - density) < 2e-8, `${policy} PDF`);
                if (i < 3)
                    average[i] += white[4 * x + i] / width;
            }
        average.forEach(x => assert(Math.abs(x - 1) < 0.001, `${policy} D65 white: ${average}`));
        console.log(`${policy} D65 white: ${average.map(x => x.toFixed(7))}`);
    }
    roleExpected.forEach((x, i) => {
        assert(Math.abs(frames[8][i] - x) < 0.002, 'coefficient role');
        assert(Math.abs(frames[9][i] - x * spectralCurves(lambdas[i], curves)[3]) < 0.003, 'emission role');
    });
    expectedTiny.forEach((expected, i) => expected.forEach((x, j) => {
        const got = frames[10][4 * i + j];
        assert(Number.isFinite(got), `tiny largest channel ${i}/${j}: coefficient ${got}`);
        assert(Math.abs(got - x) <= 1e-3 * Math.max(1, Math.abs(x)), `tiny largest channel ${i}/${j}: ${got} != ${x}`);
    }));
    mutations.forEach((m, i) => assert.throws(() => verifyFilm(frames[probes.length + i]), { name: 'AssertionError' }, m.name));
    console.log(`PASS: ${colours.length} four-wavelength lookups (worst error ${worst}), ${tinyColours.length} tiny-channel table addresses, two sampler/PDF/white integrations, signed film; ${mutations.length} compiled defects rejected`);
}
finally {
    await browser.close();
}
