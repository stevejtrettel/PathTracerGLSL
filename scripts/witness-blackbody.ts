// Execute original Planck forms through generated readers and actual packed scene data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { Compiler } from '../src/compiler/Compiler.js';
import { packSceneData } from '../src/app/sceneData.js';
import { spectralData } from '../src/components/color/spectral/data.js';
import { blackbodyFixture, blackbodySites } from '../tests/helpers/blackbodyFixtures.js';
import { planckReference } from '../tests/helpers/planckReference.js';
import { minimalStrategy } from '../tests/witnesses/scenes/minimalScene.js';
import type { RenderStrategy, SceneDescription } from '../src/compiler/types.js';
import { renderProbes, type ProbeTexture, type ProbeUniform } from '../tools/render-glsl-probes.mjs';

const compiler = new Compiler();
const wavelengths = [360, 410, 555, 830];
const carrier = `Wavelengths(vec4(${wavelengths.map(v => `${v}.0`).join(',')}))`;
const assets = ['coefficients', 'curves'].map((name, i) => {
    const bytes = readFileSync(new URL(`../src/components/color/spectral/data/${name}.bin`, import.meta.url));
    return { uniform: i === 0 ? 'u_spectralCoefficients' : 'u_spectralCurves',
        width: i === 0 ? spectralData.atlasWidth : spectralData.curveWidth,
        height: i === 0 ? spectralData.atlasHeight : spectralData.curveHeight,
        data: Array.from(new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))) };
});
const probes: Array<{ name: string; source: string; textures: ProbeTexture[]; uniforms: Record<string, ProbeUniform>; expected: number[] }> = [];
async function add(name: string, scene: SceneDescription, choice: RenderStrategy, body: string,
    expected: number[], params: Record<string, unknown> = {}) {
    const compiled = compiler.compileScene(scene, [choice]);
    const renderer = compiled.renderers[0];
    const source = [...renderer.shaders.values()].find(s => s.fragment.includes('transport_trace'))!.fragment;
    const packed = await packSceneData(compiled.sceneData);
    const textures = Object.entries(packed?.channels ?? {}).map(([channel, data]) => ({
        uniform: `u_data_${channel}`, width: data.width, height: data.height, data: Array.from(data.data),
    }));
    const uniforms = Object.fromEntries(renderer.uniforms.map(u => [u.uniform, { type: u.type, value: u.compute(params) }]));
    const probe = { name, source: source.slice(0, source.lastIndexOf('void main()')) + `void main() { ${body} }`,
        uniforms, textures, expected };
    probes.push(probe);
    return probe;
}
function strategy(color: 'rgb' | 'spectral', lightSelection: 'power' | 'bvh'): RenderStrategy {
    return { ...minimalStrategy, id: `${color}-${lightSelection}`, measurement: { ...minimalStrategy.measurement, color },
        estimator: { ...minimalStrategy.estimator, lightSelection } };
}
const result = (color: 'rgb' | 'spectral', expr: string) => color === 'spectral' ? expr : `vec4(${expr},1.0)`;
const target = (color: 'rgb' | 'spectral', temperature: number, scale: number) => {
    const reference = planckReference(temperature, scale);
    return color === 'spectral' ? wavelengths.map(reference.spectrum) : [...reference.rgb, 1];
};
let packedMutation: typeof probes[number] | undefined;
let normalizationMutation: typeof probes[number] | undefined;
for (const T of [1000, 3200, 6500, 40000]) {
    const scene = blackbodyFixture('surface', { blackbody: {
        kelvin: { param: 'lamp.kelvin', default: 3200 }, scale: { param: 'lamp.scale', default: 1 },
    } });
    const probe = await add(`reference Y ${T} K`, scene, strategy('spectral', 'power'), `
        float y = 0.0;
        for (int i = 0; i <= 940; ++i) {
            float lambda = 360.0 + 0.5 * float(i);
            Wavelengths wl = Wavelengths(vec4(lambda));
            float emission = scene_material_properties(2,vec3(0),vec2(0),-1,wl).emission.x;
            float weight = i == 0 || i == 940 ? 1.0 : (i % 2 == 0 ? 2.0 : 4.0);
            y += weight * emission * spectral_curves(lambda).y;
        }
        y *= 0.5 / (3.0 * CIE_Y_INTEGRAL);
        fragColor = vec4(y);
    `, [2, 2, 2, 2], { 'lamp.kelvin': T, 'lamp.scale': 2 });
    if (T === 1000) {
        // Recreate the former max-RGB normalization in a live spectral binding.
        const binding = (probe.uniforms as Record<string, { type: string; value: number[] }>).u_lamp_kelvin_blackbody;
        const peak = Math.max(...planckReference(T).rgb);
        normalizationMutation = { ...probe, name: 'max-RGB normalization instead of reference Y',
            uniforms: { ...probe.uniforms,
                u_lamp_kelvin_blackbody: { ...binding, value: [T, binding.value[1] / peak] } } };
    }
}
for (const color of ['rgb', 'spectral'] as const) {
    for (const T of [1000, 3200, 6500, 40000]) {
        const scene = blackbodyFixture('surface', { blackbody: { kelvin: T, scale: 2 } });
        const wl = color === 'spectral' ? carrier : 'Wavelengths(0.0)';
        await add(`constant ${color} ${T} K`, scene, strategy(color, 'power'),
            `fragColor=${result(color, `scene_material_properties(2,vec3(0),vec2(0),-1,${wl}).emission`)};`, target(color, T, 2));
    }
    for (const site of blackbodySites) {
        const scene = blackbodyFixture(site, { blackbody: { kelvin: 3200, scale: 2 } });
        const wl = color === 'spectral' ? carrier : 'Wavelengths(0.0)';
        // Keep only blackbody emitters so every sampled instance has the same source.
        scene.lights = scene.lights.slice(1);
        if (site !== 'sky') scene.environment = { type: 'none' };
        let expr: string;
        if (site === 'sky') expr = `environment_sample(vec3(0),vec2(0.3),${wl}).radiance`;
        else if (site === 'batch') expr = `lighting_sample(LightQuery(vec3(0,0,4),vec3(0),false),vec2(0.3,0.6),${wl}).radiance`;
        else {
            const kind = site === 'surface' ? 'sphere' : site;
            expr = `${kind}_light_row(0,${wl}).${site === 'point' ? 'intensity' : 'radiance'}`;
        }
        const probe = await add(`packed ${color} ${site}`, scene, strategy(color, 'bvh'),
            `rng_init(uvec2(gl_FragCoord.xy),0u,173u); fragColor=${result(color, expr)};`, target(color, 3200, 2));
        if (site === 'quad' && color === 'spectral') {
            packedMutation = { ...probe, name: 'discarded original Planck form',
                source: probe.source.replace('int(emissionHeader.y) == 1', 'false') };
            assert.notEqual(packedMutation.source, probe.source);
        }
    }
    for (const T of [1000, 40000]) {
        const scene = blackbodyFixture('sky', { blackbody: {
            kelvin: { param: 'sky.kelvin', default: 3200 }, scale: { param: 'sky.scale', default: 1 },
        } });
        const wl = color === 'spectral' ? carrier : 'Wavelengths(0.0)';
        await add(`live sky ${color} ${T} K`, scene, strategy(color, 'power'),
            `fragColor=${result(color, `environment_radiance(vec3(0,1,0),${wl})`)};`, target(color, T, 4.25),
            { 'sky.kelvin': T, 'sky.scale': 2.5, 'env.intensity': 1.7 });
    }
    // Shared temperature must preserve independent strengths; shared strength must
    // preserve independent temperatures.
    for (const T of [1000, 6500, 40000]) {
        const scene = blackbodyFixture('point', { blackbody: {
            kelvin: { param: 'lamp.kelvin', default: 3200 }, scale: 4,
        } });
        scene.materials.lamp.emission = { blackbody: { kelvin: { param: 'lamp.kelvin', default: 3200 }, scale: 1 } };
        const wl = color === 'spectral' ? carrier : 'Wavelengths(0.0)';
        for (const [name, expr, scale] of [
            ['hit', `scene_material_properties(2,vec3(0),vec2(0),-1,${wl}).emission`, 1],
            ['sample', `light_get_1(${wl}).intensity`, 4],
        ] as const) await add(`shared temperature ${color} ${T} K ${name}`, scene, strategy(color, 'power'),
            `fragColor=${result(color, expr)};`, target(color, T, scale), { 'lamp.kelvin': T });
    }
    for (const scale of [0, 3]) {
        const scene = blackbodyFixture('point', { blackbody: { kelvin: 12000, scale: { param: 'lamp.scale', default: 1 } } });
        scene.materials.lamp.emission = { blackbody: { kelvin: 2000, scale: { param: 'lamp.scale', default: 1 } } };
        const wl = color === 'spectral' ? carrier : 'Wavelengths(0.0)';
        for (const [name, expr, T] of [
            ['hit', `scene_material_properties(2,vec3(0),vec2(0),-1,${wl}).emission`, 2000],
            ['sample', `light_get_1(${wl}).intensity`, 12000],
        ] as const) await add(`shared scale ${color} ${scale} ${name}`, scene, strategy(color, 'power'),
            `fragColor=${result(color, expr)};`, target(color, T, scale), { 'lamp.scale': scale });
    }
}
assert(packedMutation);
assert(normalizationMutation);
function verify(probe: typeof probes[number], values: number[]) {
    probe.expected.forEach((expected, i) => assert(Math.abs(values[i] - expected) < 2e-5 * Math.max(1, Math.abs(expected)),
        `${probe.name} lane ${i}: ${values[i]} != ${expected}`));
}
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
    const frames = await renderProbes(await browser.newPage(), [...probes, packedMutation, normalizationMutation], 1, assets);
    probes.forEach((probe, i) => verify(probe, frames[i]));
    assert.throws(() => verify(packedMutation, frames[probes.length]), { name: 'AssertionError' });
    assert.throws(() => verify(normalizationMutation, frames[probes.length + 1]), { name: 'AssertionError' });
    console.log(`PASS: ${probes.length} Planck GPU probes; discarded-form and max-RGB normalization mutations rejected`);
} finally { await browser.close(); }
