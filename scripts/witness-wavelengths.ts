// Numerical carrier checks use generated programs with a visible test-only wavelength type.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { renderProbes } from '../tools/render-glsl-probes.mjs';
import { packSceneData } from '../src/app/sceneData.js';
import { Compiler } from '../src/compiler/Compiler.js';
import type { SceneDescription } from '../src/compiler/types.js';
import { CAMERA_MODELS } from '../src/components/camera/index.js';
import { minimalScene, minimalStrategy } from '../tests/witnesses/scenes/minimalScene.js';

const compiler = new Compiler();
const wavelengths = [400, 480, 560, 680];
const cameraWavelengths = [416, 512, 584, 704];
const cameraEncoded = cameraWavelengths.slice(0, 3).map(x => (x + cameraWavelengths[3]) / 16);
const encoded = wavelengths.slice(0, 3).map(x => (x + wavelengths[3]) / 16);
const wl = 'Wavelengths(vec4(400.0, 480.0, 560.0, 680.0))';
const ray = `make_ray(vec3(0.0, 0.0, 3.0), vec3(0.0, 0.0, -1.0), ${wl})`;
const scene: SceneDescription = {
    ...minimalScene,
    objects: [{ type: 'sphere', parameters: { center: [0, 0, 0], radius: 1 }, material: 'surface', backend: 'analytic' }],
    materials: { surface: { model: 'lambert', albedo: [0.25, 0.5, 0.75], emission: [1, 2, 4], sampleAsLight: false } },
};

/** Replace a GLSL definition body, leaving its real signature and all call sites intact. */
function replaceBody(source: string, name: string, body: string): string {
    const match = new RegExp(`\\b${name}\\([^;{}]*\\)\\s*\\{`).exec(source);
    assert(match, `Missing definition: ${name}`);
    const start = match.index + match[0].length;
    let end = start, depth = 1;
    while (depth) {
        if (source[end] === '{') ++depth;
        if (source[end] === '}') --depth;
        ++end;
    }
    return source.slice(0, start) + '\n' + body + '\n' + source.slice(end - 1);
}

function replaceOnce(source: string, before: string, after: string): string {
    assert(source.includes(before), `Missing mutation target: ${before}`);
    return source.replace(before, after);
}

function program(s = scene, strategy = minimalStrategy): string {
    const renderer = compiler.compile(s, strategy);
    let source = [...renderer.shaders.values()].find(p => p.fragment.includes('transport_trace'))!.fragment;
    source = replaceOnce(source, 'float unused;', 'vec4 nm;');
    source = replaceOnce(source, 'Wavelengths(0.0)', 'Wavelengths(vec4(416.0, 512.0, 584.0, 704.0))');
    // Deliberately nonidentity, distinct role evaluations. The coefficient square catches
    // moving the authored medium clamp after conversion; all four wavelengths are observed.
    for (const [role, rgb] of [['reflectance', 'rgb'], ['coefficient', 'rgb * rgb'], ['emission', '2.0 * rgb']]) {
        source = replaceBody(source, `color_lift_${role}`, `return ${rgb} + (wl.nm.xyz + wl.nm.www) / 16.0;`);
    }
    return source;
}

type Uniforms = Record<string, { type: string; value: number | number[] }>;
type Probe = { name: string; source: string; expected: number[]; tolerance?: number;
    uniforms?: Uniforms; textures?: { uniform: string; width: number; height: number; data: number[] }[] };

// Use the compiler's bindings with valid instrument and placement inputs.
function uniformsFor(s: SceneDescription, strategy = minimalStrategy): Uniforms {
    const renderer = compiler.compile(s, strategy);
    const params = { ...Object.fromEntries(Object.entries(renderer.parameters).map(([key, p]) => [key, p.default])),
        'engine.imageSize': [1, 1], 'engine.pixelOffset': [0, 0], 'engine.sampleCount': 0, 'engine.resetSalt': 0 };
    return Object.fromEntries(renderer.uniforms.map(u => [u.uniform, { type: u.type, value: u.compute(params) }]));
}
const cases: Probe[] = [];
function add(name: string, source: string, body: string, expected = wavelengths, tolerance = 1e-6): Probe {
    const test = { name, source: replaceBody(source, 'main', body), expected, tolerance };
    cases.push(test);
    return test;
}
const base = program();
const construction = add('construction and copy', base, `Ray r = ${ray}; Ray copied = r; fragColor = copied.wl.nm;`);
const hitBody = `Ray r = ${ray}; Hit h; if (!scene_intersect(r, h)) { fragColor = vec4(-1.0); return; }`;
const arrival = add('analytic arrival', base, hitBody + 'fragColor = h.wl.nm;');
const spawn = add('surface and shadow spawn', base, hitBody + 'fragColor = ray_spawn(h, vec3(0.0, 1.0, 0.0)).wl.nm;');
add('miss carrier', base, `Hit h; scene_intersect(make_ray(vec3(0.0, 0.0, 3.0), vec3(0.0, 0.0, 1.0), ${wl}), h); fragColor = h.wl.nm;`);
const placed: Probe[] = [];
for (const backend of ['sdf', 'analytic'] as const) {
    const s = structuredClone(scene);
    s.objects = [{ type: 'sphere', parameters: { center: [0, 0, 0], radius: 1 }, material: 'surface', backend,
        transform: { position: { param: 'sphere.position', default: [0, 0, 0] }, scale: 2 } }];
    let source = program(s);
    // Local rays normally affect only geometry. Make their carrier observable at the
    // intersection helper so dropping it cannot be masked by scene_intersect's hit fill.
    assert(/Ray lray = make_ray\(/.test(source), `${backend}: no local ray to exercise`);
    source = source.replace(/(Ray lray = make_ray\([^;]+;)/g,
        '$1\n        if (any(notEqual(lray.wl.nm, ray.wl.nm))) return false;');
    const test = add(`${backend} placed arrival`, source, hitBody + 'fragColor = h.wl.nm;');
    test.uniforms = uniformsFor(s);
    placed.push(test);
}
for (const [name, camera] of Object.entries(CAMERA_MODELS)) {
    if (!camera) continue;
    const strategy = structuredClone(minimalStrategy);
    const fields: Record<string, unknown> = { fov: 0.8, aperture: 0.1, focusDistance: 3, scale: 2, hfov: 120, projection: 'equidistant' };
    strategy.measurement.camera = { type: name, ...Object.fromEntries((camera.authoredParams ?? []).map(row => [row.name, fields[row.name]])) };
    add(`${name} camera`, program(scene, strategy),
        `fragColor = camera_generateRay(vec2(0.5), vec2(0.25), ${wl}).wl.nm;`).uniforms = uniformsFor(scene, strategy);
}
// The actual accumulator passes its sampled wavelengths into a camera that uses them
// to change geometry. Film projection exposes that direction; no production lens model.
let dispersiveCamera = replaceBody(base, 'camera_generateRay', 'return make_ray(vec3(0.0), wl.nm.xyz / wl.nm.w, wl);');
dispersiveCamera = replaceBody(dispersiveCamera, 'transport_trace', 'return SPECTRUM_ZERO;');
dispersiveCamera = replaceBody(dispersiveCamera, 'color_to_pixel', 'return ray_dir;');
cases.push({ name: 'camera uses sampled wavelengths for geometry', source: dispersiveCamera,
    expected: [...cameraWavelengths.slice(0, 3).map(x => x / cameraWavelengths[3]), 1] });
let retainedSample = replaceBody(dispersiveCamera, 'camera_generateRay',
    'wl.nm += vec4(16.0); return make_ray(vec3(0.0), vec3(0.0, 0.0, 1.0), wl);');
retainedSample = replaceBody(retainedSample, 'color_to_pixel',
    'return (camera_sample.wl.nm.xyz + camera_sample.wl.nm.www) / 16.0;');
const originalSample = { name: 'camera sample retained independently of ray carrier', source: retainedSample, expected: [...cameraEncoded, 1] };
cases.push(originalSample);
const props = 'scene_material_properties(0, vec3(0.0), vec2(0.0), 0, ' + wl + ')';
const material = add('material carrier', base, `fragColor = ${props}.wl.nm;`);
add('material fallback carrier', base, `fragColor = scene_material_properties(-1, vec3(0.0), vec2(0.0), 0, ${wl}).wl.nm;`);
add('reflectance conversion', base, `fragColor = vec4(${props}.albedo, 1.0);`, [...encoded.map((x, i) => x + [0.25, 0.5, 0.75][i]), 1]);
add('emission conversion', base, `fragColor = vec4(${props}.emission, 1.0);`, [...encoded.map((x, i) => x + [2, 4, 8][i]), 1]);
add('light accessor conversion', base, `fragColor = vec4(light_get_0(${wl}).intensity, 1.0);`, [...encoded.map(x => x + 60), 1]);
const tree = structuredClone(minimalStrategy); tree.estimator.lightSelection = 'bvh';
const packed = await packSceneData(compiler.compileScene(scene, [tree]).sceneData);
assert(packed);
const records = packed.channels.records;
const row = add('packed light row conversion', program(scene, tree), `fragColor = vec4(point_light_row(0, ${wl}).intensity, 1.0);`, [...encoded.map(x => x + 60), 1]);
row.textures = [{ uniform: 'u_data_records', width: records.width, height: records.height, data: Array.from(records.data) }];
// Nonzero input tests both the authored radiance and its wavelength conversion.
add('environment miss conversion', base, `fragColor = vec4(environment_radiance(vec3(0.0, 1.0, 0.0), ${wl}), 1.0);`, [...encoded.map((x, i) => x + [0.4, 0.8, 1.8][i]), 1], 1e-5).uniforms = { u_envIntensity: { type: 'float', value: 2 } };
const sky = structuredClone(scene); sky.environment = { type: 'constant', color: [1, 2, 3], sampleAsLight: true };
add('environment NEE conversion', program(sky), `fragColor = vec4(environment_sample(vec3(0.0), vec2(0.25), ${wl}).radiance, 1.0);`, [...encoded.map((x, i) => x + [4, 8, 12][i]), 1]).uniforms = { u_envIntensity: { type: 'float', value: 2 } };
const fog = structuredClone(scene);
fog.materials.surface = { model: 'none', medium: { sigma_a: { kind: 'glsl', source: 'vec3(2.0, 4.0, 8.0)' }, sigma_s: 0, majorant: 2 } };
const tracking = structuredClone(minimalStrategy); tracking.estimator.volumeSampling = 'delta-tracking';
const fogProgram = program(fog, tracking);
add('medium carrier', fogProgram, `fragColor = scene_medium_properties(0, vec3(0.0), ${wl}).wl.nm;`);
add('medium fallback carrier', fogProgram, `fragColor = scene_medium_properties(-1, vec3(0.0), ${wl}).wl.nm;`);
const clamp = add('authored clamp precedes conversion', fogProgram,
    `fragColor = vec4(scene_medium_properties(0, vec3(0.0), ${wl}).sigma_a, 1.0);`,
    [...encoded.map((x, i) => x + [0.25, 1, 4][i]), 1]);
const grin = structuredClone(scene);
grin.materials.surface = { model: 'none', medium: { sigma_a: 0, ior: { kind: 'glsl', source: '1.0 + 0.01 * p.x' } } };
let grinProgram = program(grin);
grinProgram = replaceBody(grinProgram, 'ior_at', 'return 1.0 + dot(p, wl.nm.xyz / 1024.0) + wl.nm.w / 1024.0;');
add('GRIN gradient holds wavelengths fixed', grinProgram,
    `fragColor = vec4(grin_grad_n(0, vec3(0.0), ${wl}), grin_n(0, vec3(0.0), ${wl}));`,
    [...wavelengths.slice(0, 3).map(x => x / 1024), 1 + wavelengths[3] / 1024], 0.001);

const scattering = structuredClone(scene);
scattering.materials.surface = { model: 'none', medium: { sigma_a: 0, sigma_s: 0.5 } };
const scatterProgram = program(scattering);
add('phase continuation carrier', scatterProgram,
    `rng_init(uvec2(0), 0u, 0u); PathState s = path_state_init(${ray});
     kernel_sample_phase(s, 0, vec3(0.0), vec3(0.0, 0.0, 1.0)); fragColor = s.ray.wl.nm;`);
let shadow = replaceBody(scatterProgram, 'medium_transmittance',
    'return (ray.wl.nm.xyz + ray.wl.nm.www) / 16.0;');
add('shadow crosses null boundary with carrier', shadow,
    `fragColor = vec4(shadow_transmittance(${ray}, vec3(0.0, 0.0, -3.0), 4), 1.0);`, [...encoded, 1]);
let mediumLight = replaceBody(scatterProgram, 'lighting_sample',
    'LightSample ls; ls.wi = vec3(0.0, 0.0, 1.0); ls.distance = 1.0; ls.pdf = 1.0; ls.radiance = SPECTRUM_ONE; ls.flags = 0u; ls.light_id = 0; return ls;');
mediumLight = replaceBody(mediumLight, 'shadow_transmittance', 'return (shadow_ray.wl.nm.xyz + shadow_ray.wl.nm.www) / 16.0;');
mediumLight = replaceBody(mediumLight, 'interaction_medium_eval', 'return SPECTRUM_ONE;');
mediumLight = replaceBody(mediumLight, 'combiner_w_light_medium', 'return 1.0;');
add('medium light spawns shadow with carrier', mediumLight,
    `rng_init(uvec2(0), 0u, 0u); PathState s = path_state_init(${ray});
     light_sample_direct_medium(s, 0, vec3(0.0), vec3(0.0, 0.0, 1.0)); fragColor = vec4(s.radiance, 1.0);`, [...encoded, 1]);
let handoff = replaceBody(grinProgram, 'medium_sample',
    'MediumSample ms; ms.scattered = false; ms.deflected = ray.origin.z < 0.5; ms.t = t_max; ms.weight = SPECTRUM_ONE; ms.radiance = SPECTRUM_ZERO; ms.exit_p = vec3(0.0, 0.0, 0.999); ms.exit_dir = vec3(0.0, 0.0, 1.0); ms.eta_scale = 1.0; return ms;');
handoff = replaceBody(handoff, 'environment_radiance', 'return (wl.nm.xyz + wl.nm.www) / 16.0;');
add('GRIN handoff keeps carrier through next trace iteration', handoff,
    `rng_init(uvec2(0), 0u, 0u); fragColor = vec4(transport_trace(make_ray(vec3(0.0), vec3(0.0, 0.0, 1.0), ${wl})), 1.0);`, [...encoded, 1]);

// Each defect must compile, execute, and be rejected numerically.
const mutations = [
    { ...construction, name: 'camera wavelengths substituted for current carrier', source: replaceOnce(construction.source, 'r.wl        = wl;', 'r.wl = wavelengths_sample().wl;') },
    ...placed.map(test => ({ ...test, name: `${test.name}: lost local carrier`, source: test.source.replace(/(Ray lray = make_ray\([^;]+), ray.wl\);/g, '$1, Wavelengths(vec4(0.0)));') })),
    { ...row, name: 'packed RGB discarded', source: replaceBody(row.source, 'color_lift_emission', 'return (wl.nm.xyz + wl.nm.www) / 16.0;') },
    { ...originalSample, name: 'camera sample overwritten', source: replaceOnce(originalSample.source, 'Radiance L = transport_trace(ray);', 'camera_sample.wl = ray.wl; Radiance L = transport_trace(ray);') },
    { ...clamp, name: 'clamp moved after nonlinear conversion', source: replaceOnce(replaceOnce(clamp.source, 'sigma_a *= sigma_scale;', ''), 'm.sigma_a = color_lift_coefficient(sigma_a, wl);', 'm.sigma_a = color_lift_coefficient(sigma_a, wl) * sigma_scale;') },
    { ...arrival, name: 'lost arrival', source: replaceOnce(arrival.source, 'hit.wl = ray.wl;', 'hit.wl = Wavelengths(vec4(0.0));') },
    { ...spawn, name: 'lost spawned carrier', source: replaceOnce(spawn.source, 'wi, hit.wl);', 'wi, Wavelengths(vec4(0.0)));') },
    { ...material, name: 'lost property carrier', source: replaceOnce(material.source, 'props.wl = wl;', 'props.wl = Wavelengths(vec4(0.0));') },
    { ...clamp, name: 'coefficient conversion bypass', source: replaceBody(clamp.source, 'color_lift_coefficient', 'return rgb;') },
];
function verify(test: Probe, actual: number[]) {
    test.expected.forEach((value, c) => assert(Math.abs(actual[c] - value) <= (test.tolerance ?? 1e-6),
        `${test.name}[${c}]: ${actual[c]} != ${value}`));
}
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    const frames = await renderProbes(page, [...cases, ...mutations]);
    cases.forEach((test, i) => verify(test, frames[i]));
    mutations.forEach((test, i) => assert.throws(() => verify(test, frames[cases.length + i]), { name: 'AssertionError' }, test.name));
    console.log(`PASS: ${cases.length} wavelength GPU cases; all ${mutations.length} deliberate defects rejected`);
} finally {
    await browser.close();
}
