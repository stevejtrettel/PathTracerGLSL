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
async function add(name: string, scene: SceneDescription, body: string, values: number[][],
    uniforms: Record<string, { type: string; value: number | number[] }> = {}) {
    const compiled = compiler.compileScene(scene, [packedStrategy('mis', 'bvh')]);
    const source = [...compiled.renderers[0].shaders.values()].find(s => s.fragment.includes('transport_trace'))!.fragment;
    const main = source.lastIndexOf('void main()');
    assert(main >= 0, 'generated accumulator entry point');
    const packed = await packSceneData(compiled.sceneData);
    assert(packed);
    const textures: object[] = Object.entries(packed.channels).map(([channel, data]) => ({
        uniform: `u_data_${channel}`, width: data.width, height: data.height, data: Array.from(data.data),
    }));
    const probe = { name, source: source.slice(0, main) + `void main() { ${body} }`, textures, uniforms, expected: values };
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

// At normal incidence the model weights have closed forms. These run the generated
// resolver AND the actual BSDF, retaining four unequal wavelengths through the hit.
const tint: Vec3 = [0.2, 0.5, 0.8];
const lifted = expected(tint, false);
for (const model of ['mirror', 'ggx', 'checker', 'dielectric', 'rough_dielectric']) {
    const scene = structuredClone(spectralPackedReference);
    for (let i = 0; i < 3; i++) scene.materials[`lamp${i}`] = {
        model,
        ...(model === 'mirror' || model === 'ggx' ? { f0: tint } : {}),
        ...(model === 'ggx' || model === 'rough_dielectric' ? { roughness: 0.5 } : {}),
        ...(model === 'checker' ? { albedo_a: tint, albedo_b: [0.8, 0.3, 0.1] as Vec3, uv_scale: 1 } : {}),
        ...(model === 'dielectric' || model === 'rough_dielectric' ? { transmittance: tint, ior: 1.5 } : {}),
    };
    const setup = hit + `h.uv = vec2(0.25); MaterialProperties mp = ${properties};`;
    const glass = model === 'dielectric' || model === 'rough_dielectric';
    await add(`${model} normal sample`, scene,
        setup + `fragColor = ${model}_sample(vec3(0.0,0.0,1.0),h,mp,0.9,vec2(0.0)).weight;`,
        [lifted.map(v => v * (glass ? 1 / 2.25 : 1))]);
    if (model === 'checker') {
        await add('checker second cell', scene,
            setup + 'h.uv.x += 1.0; fragColor = checker_eval(vec3(0.0,0.0,1.0),vec3(0.0,0.0,1.0),h,mp);',
            [expected([0.8, 0.3, 0.1], false).map(v => v / Math.PI)]);
    }
    if (model === 'ggx' || model === 'rough_dielectric') {
        // alpha = 0.5², D(normal) = 1/(pi*alpha²), G1(normal) = 1.
        const D = 16 / Math.PI;
        const scale = glass ? D * (1 - 0.04) * (4 / 9) / (1 / 9) : D / 4;
        await add(`${model} normal eval`, scene,
            setup + `fragColor = ${model}_eval(vec3(0.0,0.0,${glass ? '-1.0' : '1.0'}),vec3(0.0,0.0,1.0),h,mp);`,
            [lifted.map(v => v * scale)]);
    }
}
// Image filtering and procedural evaluation are authored RGB operations, before lift.
const imageScene = { ...spectralPackedReference, environment: { type: 'image' as const, url: 'probe.hdr' } };
const imageProbe = await add('filtered image sky', imageScene,
    `fragColor = environment_radiance(vec3(1.0,0.0,0.0),${carrier});`,
    [expected([0.3*1.7, 0.4*1.7, 0.5*1.7], true)],
    { u_envIntensity: { type:'float', value:1.7 }, u_envRotation: { type:'float', value:0 } });
imageProbe.textures.push({ uniform:'u_envMap', width:2, height:2,
    data:[0.1,0.2,0.3,1, 0.5,0.2,0.3,1, 0.1,0.6,0.7,1, 0.5,0.6,0.7,1], filter:'linear' });
const procScene = { ...spectralPackedReference, environment: { type:'procedural' as const,
    glsl:{ kind:'glsl' as const, source:'vec3(0.2,0.5,0.8) * (1.0 + 0.5 * dir.z)' }, tableSize:[4,2] as [number,number] } };
const rotation = 0.73;
await add('rotated procedural sky', procScene,
    `fragColor = environment_radiance(vec3(1.0,0.0,0.0),${carrier});`,
    [expected([0.2,0.5,0.8].map(v=>v*1.7*(1+0.5*Math.sin(rotation))) as Vec3,true)],
    { u_envIntensity:{type:'float',value:1.7}, u_envRotCS:{type:'vec2',value:[Math.cos(rotation),Math.sin(rotation)]} });

// Coefficients are lifted without an illuminant; absorption and scattering are separate fields.
function coefficient(rgb: Vec3): number[] {
    if (rgb.every(v => v === rgb[0])) return wavelengths.map(() => rgb[0]);
    const scale = 2 * Math.max(...rgb);
    const c = spectralCoefficients(rgb.map(v => v / scale) as Vec3, atlas);
    return wavelengths.map(lambda => scale * evaluatePolynomial(c, lambda));
}
const mediumScene = structuredClone(spectralPackedReference);
const mediumID = Object.keys(mediumScene.materials).length;
mediumScene.materials.fog = { model: 'none', medium: {
    sigma_a: { param: 'fog.a', default: [0.3,0.7,1.2], min: 0, max: 3 },
    sigma_s: [0.2,0.4,0.8],
} };
mediumScene.ambientMedium = 'fog';
const a = coefficient([0.3,0.7,1.2]), scattering = coefficient([0.2,0.4,0.8]);
const extinction = a.map((v,i) => v + scattering[i]);
const mediumUniforms = { u_fog_a: { type: 'vec3', value: [0.3,0.7,1.2] } };
const mediumSetup = `MediumProperties m = scene_medium_properties(${mediumID},vec3(0.0),${carrier});`;
const coefficientProbe = await add('medium absorption coefficient', mediumScene, mediumSetup + 'fragColor = m.sigma_a;', [a], mediumUniforms);
await add('medium scattering coefficient', mediumScene, mediumSetup + 'fragColor = m.sigma_s;', [scattering], mediumUniforms);
await add('medium live absorption update', mediumScene, mediumSetup + 'fragColor = m.sigma_a;',
    [coefficient([0.9,0.1,0.5])], { u_fog_a: { type: 'vec3', value: [0.9,0.1,0.5] } });
await add('medium shadow Beer–Lambert', mediumScene,
    `fragColor = medium_transmittance(${mediumID},make_ray(vec3(0.0),vec3(0.0,0.0,-1.0),${carrier}),0.7);`,
    [extinction.map(v => Math.exp(-0.7*v))], mediumUniforms);
const average = (values: number[]) => values.reduce((s,v) => s+v,0)/values.length;
const sampleCall = (limit: number, y: number) => `medium_sample_analytic(m,make_ray(vec3(0.0),vec3(0.0,0.0,-1.0),${carrier}),${limit.toFixed(1)},vec2((float(int(gl_FragCoord.x)%4)+0.5)/4.0,${y}))`;
for (const [name,limit,y] of [['collision',10,0.3],['survival',0.1,0.999]] as const) {
    const weights = extinction.map(sc => {
        const t = -Math.log(1-y)/sc;
        const tr = extinction.map(v => Math.exp(-v*Math.min(t,limit)));
        const pdf = average(tr.map((v,i) => t < limit ? extinction[i]*v : v));
        return tr.map((v,i) => v*(t < limit ? scattering[i] : 1)/pdf);
    });
    await add(`medium ${name} weights in every selected lane`,mediumScene,
        mediumSetup + `fragColor = ${sampleCall(limit,y)}.weight;`,weights,mediumUniforms);
    await add(`medium ${name} distance and event`,mediumScene,
        mediumSetup + `MediumSample ms = ${sampleCall(limit,y)}; fragColor=vec4(ms.t,float(ms.scattered),0.0,0.0);`,
        extinction.map(sc => { const t=-Math.log(1-y)/sc; return [Math.min(t,limit),Number(t<limit),0,0]; }),mediumUniforms);
}
for (const vacuum of [true,false]) {
    const tr = [0,1,2,3].map(v => Math.exp(-v));
    await add(`medium zero extinction endpoint, vacuum=${vacuum}`,mediumScene,
        mediumSetup + `m.sigma_a=vec4(0.0); m.sigma_s=${vacuum ? 'vec4(0.0)' : 'vec4(0.0,1.0,2.0,3.0)'};
        MediumSample ms=medium_sample_analytic(m,make_ray(vec3(0.0),vec3(0.0,0.0,-1.0),${carrier}),1.0,vec2(0.0));
        fragColor=ms.scattered ? vec4(-99.0) : ms.weight;`,
        [vacuum ? [1,1,1,1] : tr.map(v => v/average(tr))],mediumUniforms);
}
const mediumMutation = { ...coefficientProbe, name: 'illuminant incorrectly applied to absorption',
    source: coefficientProbe.source.replace('fragColor = m.sigma_a;', `fragColor = m.sigma_a * vec4(${wavelengths.map(v => `spectral_curves(${v}.0).w`).join(',')});`) };

function verify(probe: typeof probes[number], values: number[]) {
    for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++) {
        const target = probe.expected[x % probe.expected.length][c];
        assert(Math.abs(values[4*x+c] - target) < 2e-5, `${probe.name}, pixel ${x}, lane ${c}: ${values[4*x+c]} != ${target}`);
    }
}
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
    const frames = await renderProbes(await browser.newPage(), [...probes, mutation, mediumMutation], width, assets);
    probes.forEach((probe, i) => verify(probe, frames[i]));
    assert.throws(() => verify(mutation, frames[probes.length]), { name: 'AssertionError' });
    assert.throws(() => verify(mediumMutation, frames[probes.length+1]), { name: 'AssertionError' });
    console.log(`PASS: ${probes.length} generated spectral binding/BSDF/media probes, all four lanes; instance-index and absorption-illuminant mutations rejected`);
} finally {
    await browser.close();
}
