import type { SceneDescription, RenderStrategy, Vec3 } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry } from '../types.js';

const albedos: Vec3[] = [[0.15, 0.35, 0.75], [0.8, 0.25, 0.1]];
const emissions: Vec3[] = [[0.04, 0.12, 0.3], [0.3, 0.06, 0.02]];
const rgb = (v: Vec3) => `vec3(${v.join(',')})`;
const reference: SceneDescription = {
    id: 'spectral-expressions-ref', name: 'Spectral expression reference',
    ambientSpace: { type: 'euclidean' }, objects: [], materials: {}, lights: [],
    environment: { type: 'constant', color: 1, sampleAsLight: true },
};
// Four constant patches independently define the piecewise field on one plane.
for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const material = `patch${x}${y}`;
    reference.objects.push({ type: 'quad', material, parameters: {
        corner: [-2 + 2*x, -2 + 2*y, 0], edge1: [2, 0, 0], edge2: [0, 2, 0],
    } });
    reference.materials[material] = {
        model: 'lambert', albedo: albedos[x], emission: emissions[y], sampleAsLight: false,
    };
}
const constant = structuredClone(reference);
constant.id = 'spectral-expressions-constant';
constant.name = 'Spectral constant RGB expressions';
for (const mat of Object.values(constant.materials)) {
    mat.albedo = { kind: 'glsl', source: rgb(mat.albedo as Vec3) };
    mat.emission = { kind: 'glsl', source: rgb(mat.emission as Vec3) };
}
const spatial: SceneDescription = {
    ...reference, id: 'spectral-expressions', name: 'Spectral procedural surface colours',
    objects: [{ type: 'quad', material: 'pattern', parameters: {
        corner: [-2, -2, 0], edge1: [4, 0, 0], edge2: [0, 4, 0],
    } }],
    materials: { pattern: { model: 'lambert', sampleAsLight: false,
        albedo: { kind: 'glsl', source: `mix(${rgb(albedos[0])},${rgb(albedos[1])},step(u_pattern_split,p.x))`,
            params: [{ param: 'pattern.split', default: 0, min: -1, max: 1 }] },
        emission: { kind: 'glsl', source: `mix(${rgb(emissions[0])},${rgb(emissions[1])},step(0.5,uv.y))` },
    } },
};
const strategies: RenderStrategy[] = (['none', 'nee', 'mis'] as const).map(directLighting => ({
    id: directLighting,
    measurement: { color: 'spectral', maxBounces: 1,
        camera: { type: 'pinhole', fov: 0.7, position: [0, 0, 4], target: [0, 0, 0] } },
    estimator: { directLighting, wavelengths: 'visible', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'none' } },
}));
export const spectralExpressionsSuite: Record<string, SceneSuiteEntry> = {
    [reference.id]: { scene: reference, strategies, exercises: 'Constant quadrant reference for spectral expression twins' },
    ...Object.fromEntries([constant, spatial].map(scene => [scene.id, {
        scene, strategies,
        exercises: 'RGB surface reflectance and emission expressions; world position, UV chart and a live split control',
        witness: { size: [32, 32], spp: 256, checks: strategies.map((_, strategy) => ({
            kind: 'twin', strategy, other: { scene: reference.id, strategy },
            meanTol: 0.00001, rmse: 0.00001, label: 'RGB expression ≡ constant patches',
        })) },
    } satisfies SceneSuiteEntry])),
};
