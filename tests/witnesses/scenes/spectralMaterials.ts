import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry } from '../types.js';
import { etaScene } from './dielectricWitness.js';
import { mirrorScene } from './mirrorWitness.js';
import { glassInclusion } from './roughDielectricWitness.js';

export const spectralMaterials: SceneDescription = {
    id: 'spectral-materials', name: 'Spectral surface materials',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'checks' },
        ...['mirror', 'metal', 'glass', 'frosted'].map((material, i) => ({
            type: 'sphere', parameters: { center: [(i - 1.5) * 1.3, 0.65, 0], radius: 0.55 }, material,
        })),
    ],
    materials: {
        checks: { model: 'checker', albedo_a: [0.15, 0.35, 0.7], albedo_b: 0.8, uv_scale: 2 },
        mirror: { model: 'mirror', f0: [0.85, 0.35, 0.15] },
        metal: { model: 'ggx', f0: [0.15, 0.65, 0.3], roughness: 0.35 },
        glass: { model: 'dielectric', ior: 1.5, transmittance: [0.9, 0.97, 1] },
        frosted: { model: 'rough_dielectric', ior: 1.5, roughness: 0.3, transmittance: [1, 0.9, 0.97] },
    },
    lights: [{ kind: 'quad', corner: [-3, 4, -2], edge1: [6, 0, 0], edge2: [0, 0, 4], emission: 5 }],
    environment: { type: 'constant', color: [0.15, 0.2, 0.3], sampleAsLight: true },
};
export const spectralMaterialStrategies: RenderStrategy[] = (['nee', 'mis'] as const).map(directLighting => ({
    id: directLighting,
    measurement: { color: 'spectral', maxBounces: 6,
        camera: { type: 'pinhole', fov: 0.65, position: [3, 2.4, 7], target: [0, 0.6, 0] } },
    estimator: { directLighting, wavelengths: 'visible', lightSelection: 'bvh',
        russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'agx' } },
}));
const base = spectralMaterialStrategies[0];
export const spectralMaterialsSuite: Record<string, SceneSuiteEntry> = {
    'spectral-materials': {
        scene: spectralMaterials, strategies: spectralMaterialStrategies,
        exercises: 'Coloured mirror, GGX, smooth/rough glass and checker under a sampled sky and panel; NEE/MIS with roulette',
        witness: { size: [64, 40], spp: 512, checks: [
            { kind: 'equality', strategies: [0, 1], meanTol: 0.025, label: 'surface materials NEE ≡ MIS' },
        ] },
    },
    'spectral-mirror': {
        scene: { ...mirrorScene, id: 'spectral-mirror' },
        strategies: [{ ...base, measurement: { ...base.measurement,
            camera: { type: 'pinhole', fov: 0.2, position: [0, 0, 4], target: [0, 0, 0] } } }],
        exercises: 'Grey Schlick mirror at near-normal incidence under D65: F ≈ f0 = 0.5',
        witness: { size: [32, 32], spp: 512, checks: [
            { kind: 'mean', value: 0.5, tol: 0.004, label: 'spectral mirror f0' },
        ] },
    },
    'spectral-eta': {
        scene: { ...etaScene, id: 'spectral-eta' },
        strategies: [{ ...base, id: 'pt', measurement: { ...base.measurement,
            camera: { type: 'pinhole', fov: 0.1, position: [0, 1, 0.05], target: [0, -1, 0] } },
            estimator: { ...base.estimator, directLighting: 'none', russianRoulette: null } }],
        exercises: 'Spectral radiance compression at an air/water interface: (1-F)/1.33² ≈ 0.554',
        witness: { size: [32, 32], spp: 512, checks: [
            { kind: 'mean', value: 0.554, tol: 0.004, label: 'spectral η²' },
        ] },
    },
    'spectral-inclusion': {
        scene: { ...glassInclusion, id: 'spectral-inclusion', materials: {
            ...glassInclusion.materials,
            roughglass: { ...glassInclusion.materials.roughglass, roughness: 0.5 },
        } },
        strategies: (['power', 'bvh'] as const).map(lightSelection => ({
            ...base, id: lightSelection,
            // One surface event isolates the transmission-side NEE query. Broader
            // microfacets keep a tiny internal emitter from dominating through rare peaks.
            measurement: { ...base.measurement, maxBounces: 1,
                camera: { type: 'pinhole', fov: 0.8, position: [0, 1.2, 3.2], target: [0, 1, 0] } },
            estimator: { ...base.estimator, lightSelection, russianRoulette: null },
        })),
        exercises: 'Single-event rough-glass transmission reaches an internal emitter; spectral two-sided light-tree selection agrees with power selection',
        witness: { size: [48, 36], spp: 512, checks: [
            { kind: 'equality', strategies: [0, 1], meanTol: 0.025, label: 'spectral two-sided tree ≡ power' },
        ] },
    },
};
