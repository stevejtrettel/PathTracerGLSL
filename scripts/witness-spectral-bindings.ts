// Execute generated packed readers, including the App's actual scene-data packer.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { Compiler } from '../src/compiler/Compiler.js';
import { packSceneData } from '../src/app/sceneData.js';
import type { InstancedObject, LightDescription, SceneDescription, Vec3 } from '../src/compiler/types.js';
import { LIGHT_KINDS } from '../src/components/lights/index.js';
import { blackbodyFixture } from '../tests/helpers/blackbodyFixtures.js';
import { spectralData } from '../src/components/color/spectral/data.js';
import { spectralCoefficients, spectralCurves, evaluatePolynomial } from '../src/components/color/spectral/lookup.js';
import { packedPositions, packedAlbedos, packedEmissions, packedStrategy, spectralPackedScene, spectralPackedReference } from '../tests/witnesses/scenes/spectralPacked.js';
import { renderProbes } from '../tools/render-glsl-probes.mjs';

function read(name: string): Float32Array {
    const bytes = readFileSync(new URL(`../src/components/color/spectral/data/${name}.bin`, import.meta.url));
    return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
const atlas = read('coefficients'), curves = read('curves');
const assets = [
    { uniform: 'u_spectralCoefficients', width: spectralData.atlasWidth, height: spectralData.atlasHeight, data: Array.from(atlas) },
    { uniform: 'u_spectralCurves', width: spectralData.curveWidth, height: spectralData.curveHeight, data: Array.from(curves) },
];
const wavelengths = [410, 480, 555, 660];
const carrier = `Wavelengths(vec4(${wavelengths.map(v => `${v}.0`).join(',')}))`;
const literal = (v: Vec3) => `vec3(${v.map(x => x.toFixed(8)).join(',')})`;
function expected(rgb: Vec3, emission: boolean): number[] {
    const scale = emission ? 2 * Math.max(...rgb) : 1;
    const c = rgb.map(x => x / scale) as Vec3;
    const coefficients = spectralCoefficients(c, atlas);
    return wavelengths.map(lambda => scale * evaluatePolynomial(coefficients, lambda) * (emission ? spectralCurves(lambda, curves)[3] : 1));
}
const width = 96;
const compiler = new Compiler();
const probes: Array<{ name: string; source: string; textures: object[]; expected: number[][] }> = [];
async function add(name: string, scene: SceneDescription, body: string, values: number[][]) {
    const compiled = compiler.compileScene(scene, [packedStrategy('mis', 'bvh')]);
    const source = [...compiled.renderers[0].shaders.values()].find(s => s.fragment.includes('transport_trace'))!.fragment;
    const main = source.lastIndexOf('void main()');
    assert(main >= 0, 'generated accumulator entry point');
    const packed = await packSceneData(compiled.sceneData);
    assert(packed);
    const textures = Object.entries(packed.channels).map(([channel, data]) => ({
        uniform: `u_data_${channel}`, width: data.width, height: data.height, data: Array.from(data.data),
    }));
    const probe = { name, source: source.slice(0, main) + `void main() { ${body} }`, textures, expected: values };
    probes.push(probe);
    return probe;
}
const hit = `
    int i = int(gl_FragCoord.x) % 3;
    vec3 centers[3] = vec3[3](${packedPositions.map(literal).join(',')});
    vec3 origin = centers[i] + vec3(0.0,0.0,3.0);
    Hit h;
    if (!scene_intersect(make_ray(origin,vec3(0.0,0.0,-1.0),${carrier}),h)) { fragColor=vec4(-99.0); return; }
`;
const properties = `scene_material_properties(material_of(h.region_owner), h.p, h.uv, h.element, h.wl)`;
for (const flat of [false, true]) {
    const scene = structuredClone(spectralPackedScene);
    if (flat) {
        const batch = scene.objects[1] as InstancedObject;
        batch.attributes = { albedo: new Float32Array(packedAlbedos.flat()), emission: new Float32Array(packedEmissions.flat()) };
    }
    for (const role of ['albedo', 'emission'] as const) {
        await add(`${flat ? 'flat' : 'nested'} ${role} attributes`, scene,
            hit + `fragColor = ${properties}.${role};`,
            (role === 'albedo' ? packedAlbedos : packedEmissions).map(c => expected(c, role === 'emission')));
    }
}
const frameScene = structuredClone(spectralPackedScene);
const frameBatch = frameScene.objects[1] as InstancedObject;
frameBatch.placementRecord = 'frame';
frameBatch.attributes = { albedo: packedAlbedos };
await add('frame placement albedo attributes', frameScene, hit + `fragColor = ${properties}.albedo;`,
    packedAlbedos.map(c => expected(c, false)));

// Every table-supported light kind retains authored RGB before its row reader lifts it.
const emission: Vec3 = [0.6, 1.8, 3.6];
const lights: LightDescription[] = [
    { kind: 'point', position: [0, 3, 0], emission },
    { kind: 'spot', position: [0, 3, 0], direction: [0, -1, 0], angle: 0.6, emission },
    { kind: 'quad', corner: [-1, 3, -1], edge1: [2, 0, 0], edge2: [0, 0, 2], emission },
    { kind: 'sphere', position: [0, 3, 0], radius: 0.5, emission },
    { kind: 'disk', position: [0, 3, 0], normal: [0, -1, 0], radius: 0.5, emission },
    { kind: 'softbeam', position: [0, 3, 0], direction: [0, -1, 0], radius: 0.5, divergence: 0.3, emission },
];
for (const light of lights) {
    const scene = structuredClone(spectralPackedReference);
    scene.lights = [light];
    const row = LIGHT_KINDS[light.kind].params.find(p => p.semantic === 'radiometric')!;
    await add(`${light.kind} light row`, scene, `fragColor = ${light.kind}_light_row(0,${carrier}).${row.name};`,
        [expected(emission, true)]);
}
const mesh = blackbodyFixture('mesh', emission);
mesh.lights = [];
await add('mesh light row', mesh, `fragColor = mesh_light_row(0,${carrier}).radiance;`, [expected(emission, true)]);

// A sampled instance and its hit-side material must evaluate the same emission.
const batchOnly = structuredClone(spectralPackedScene);
batchOnly.lights = [];
batchOnly.environment = { type: 'none' };
await add('instance sampling matches hit emission', batchOnly, `
    rng_init(uvec2(gl_FragCoord.xy),0u,173u);
    vec3 origin = vec3(0.0,2.0,5.0);
    LightSample ls = lighting_sample(LightQuery(origin,vec3(0.0),false),random2(),${carrier});
    Hit h;
    if (ls.pdf <= 0.0 || !scene_intersect(make_ray(origin,ls.wi,${carrier}),h)) { fragColor=vec4(-99.0); return; }
    fragColor = ls.radiance - ${properties}.emission;
`, [[0, 0, 0, 0]]);
const mutation = { ...probes[0], name: 'lost instance index',
    source: probes[0].source.replace(`fragColor = ${properties}.albedo;`, `h.element=0; fragColor = ${properties}.albedo;`) };
assert.notEqual(mutation.source, probes[0].source);
function verify(probe: typeof probes[number], values: number[]) {
    for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++) {
        const target = probe.expected[x % probe.expected.length][c];
        assert(Math.abs(values[4*x+c] - target) < 2e-5, `${probe.name}, pixel ${x}, lane ${c}: ${values[4*x+c]} != ${target}`);
    }
}
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
    const frames = await renderProbes(await browser.newPage(), [...probes, mutation], width, assets);
    probes.forEach((probe, i) => verify(probe, frames[i]));
    assert.throws(() => verify(mutation, frames[probes.length]), { name: 'AssertionError' });
    console.log(`PASS: ${probes.length} generated packed spectral readers, all four lanes; lost-instance-index mutation rejected`);
} finally {
    await browser.close();
}
