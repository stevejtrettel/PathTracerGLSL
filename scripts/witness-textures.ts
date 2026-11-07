// GPU probe of the Perlin library (src/glsl/core/perlin.glsl) as a compiled program links it:
// perlin_noise, perlin_fbm and perlin_turbulence at 4096 fp32 points (negative coordinates,
// lattice points, cell faces and the period-256 seam) against the TS twin, which
// tests/glsl/perlin.test.ts ties to pbrt-v4's compiled noise.cpp; then a material expression
// row calling them, read back through the generated resolver. Two mutated libraries (a cubic
// fade, a turbulence without its 0.2ωⁿ residual) must fail the same checks.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { Compiler } from '../src/compiler/Compiler.js';
import type { SceneDescription } from '../src/compiler/types.js';
import { exprConst, exprTwinStrategy } from '../tests/witnesses/scenes/exprMaterialWitness.js';
import { perlinNoise, perlinFbm, perlinTurbulence } from '../tests/glsl/perlinTwin.js';
import { renderProbes } from '../tools/render-glsl-probes.mjs';

const SIDE = 64;   // a SIDE × SIDE probe: one point per pixel
const TOLERANCE = 2e-5;

let state = 2024;
const uniform = (lo: number, hi: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.fround(lo + (hi - lo) * (state >>> 8) / 2 ** 24);
};
const points: Array<[number, number, number]> = [];
for (let i = 0; i < 1024; i++) points.push([uniform(-4, 4), uniform(-4, 4), uniform(-4, 4)]);
for (let i = 0; i < 1024; i++) points.push([uniform(-600, 600), uniform(-600, 600), uniform(-600, 600)]);
for (let i = 0; i < 512; i++) points.push([Math.floor(uniform(-300, 300)), Math.floor(uniform(-300, 300)), Math.floor(uniform(-300, 300))]);
for (let i = 0; i < 1024; i++) {
    const p: [number, number, number] = [uniform(-20, 20), uniform(-20, 20), uniform(-20, 20)];
    p[i % 3] = Math.floor(p[i % 3]);
    points.push(p);
}
for (let i = 0; i < 512; i++) points.push([uniform(-0.01, 0.01), uniform(255.9, 256.1), uniform(-256.1, -255.9)]);
assert.equal(points.length, SIDE * SIDE);
const pointTexture = { uniform: 'u_probePoints', width: SIDE, height: SIDE, data: points.flatMap((p) => [...p, 0]) };

// The scene: expr-const with a sphere albedo that calls all three functions.
const ALBEDO = 'vec3(0.5) + 0.2 * vec3(perlin_noise(4.0 * p), perlin_fbm(2.0 * p, 0.5, 6), perlin_turbulence(p, 0.5, 4))';
const scene: SceneDescription = structuredClone(exprConst);
scene.materials.sphere.albedo = { kind: 'glsl', source: ALBEDO };
const compiled = new Compiler().compileScene(scene, [exprTwinStrategy]);
const fragment = [...compiled.renderers[0].shaders.values()].find((s) => s.fragment.includes('scene_material_properties'))!.fragment;
const sphereId = Object.keys(scene.materials).indexOf('sphere');
const head = fragment.slice(0, fragment.lastIndexOf('void main()'));
assert(head.includes('float perlin_noise(vec3 x)'), 'the compiled program links the Perlin library');

const probe = (body: string) => `${head}uniform highp sampler2D u_probePoints;
void main() {
    vec3 q = texelFetch(u_probePoints, ivec2(gl_FragCoord.xy), 0).xyz;
    ${body}
}`;
const functions = probe('fragColor = vec4(perlin_noise(q), perlin_fbm(q, 0.5, 8), perlin_turbulence(q, 0.5, 6), perlin_turbulence(q, 0.8, 1));');
const resolver = probe(`fragColor = vec4(scene_material_properties(${sphereId}, q, vec2(0.0), 0, Wavelengths(0.0)).albedo, 0.0);`);
const expectFunctions = ([x, y, z]: [number, number, number]) =>
    [perlinNoise(x, y, z), perlinFbm(x, y, z, 0.5, 8), perlinTurbulence(x, y, z, 0.5, 6), perlinTurbulence(x, y, z, 0.8, 1)];
const expectResolver = ([x, y, z]: [number, number, number]) => {
    const s = (v: number) => Math.fround(4 * v), t = (v: number) => Math.fround(2 * v);
    return [0.5 + 0.2 * perlinNoise(s(x), s(y), s(z)), 0.5 + 0.2 * perlinFbm(t(x), t(y), t(z), 0.5, 6),
        0.5 + 0.2 * perlinTurbulence(x, y, z, 0.5, 4), 0];
};

const mutate = (source: string, from: string, to: string) => {
    assert(source.includes(from), `mutation target present: ${from}`);
    return source.replace(from, to);
};
const cubic = mutate(functions, 'return 6.0 * (t4 * t) - 15.0 * t4 + 10.0 * (t2 * t);', 'return t2 * (3.0 - 2.0 * t);');
const noResidual = mutate(functions, 'return sum + o * 0.2;', 'return sum;');

/** Largest |GPU − twin| over every pixel and lane. */
function worst(pixels: number[], expected: (p: [number, number, number]) => number[]): number {
    let w = 0;
    points.forEach((p, i) => {
        const e = expected(p);
        // Point i is texel (i % SIDE, i / SIDE), the pixel that fetches it, and readPixels entry i.
        for (let c = 0; c < 4; c++) w = Math.max(w, Math.abs(pixels[4 * i + c] - e[c]));
    });
    return w;
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    const [f, r, c, n] = await renderProbes(page, [
        { name: 'perlin functions', source: functions, textures: [pointTexture] },
        { name: 'expression row', source: resolver, textures: [pointTexture] },
        { name: 'cubic fade', source: cubic, textures: [pointTexture] },
        { name: 'no turbulence residual', source: noResidual, textures: [pointTexture] },
    ], SIDE, [], SIDE);
    const results = {
        functions: worst(f, expectFunctions),
        resolver: worst(r, expectResolver),
        cubic: worst(c, expectFunctions),
        noResidual: worst(n, expectFunctions),
    };
    console.log(`max |GPU − twin| over ${points.length} points × 4 lanes:`, results);
    assert(results.functions < TOLERANCE, `perlin functions: ${results.functions}`);
    assert(results.resolver < TOLERANCE, `expression row: ${results.resolver}`);
    assert(results.cubic >= TOLERANCE, 'the cubic-fade mutation was not detected');
    assert(results.noResidual >= TOLERANCE, 'the residual-free turbulence mutation was not detected');
    console.log(`PASS: Perlin library matches the twin to ${TOLERANCE} (functions and an expression row); both mutations rejected`);
} finally {
    await browser.close();
}
