import type { RenderStrategy, SceneDescription } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry } from '../types.js';
import { spectralSlab, mediaStrategy } from './spectralMedia.js';
import {
    grinFurnaceHardScene, grinFurnaceEmitScene, grinFurnaceScatterScene,
    grinScatter, grinScatterRef,
} from './grinWitness.js';

const slab = structuredClone(spectralSlab);
slab.id = 'spectral-grin-slab';
slab.name = 'Spectral absorption along a GRIN traversal';
slab.materials.ink.medium!.ior = 1;

const vacuum = structuredClone(slab);
vacuum.id = 'spectral-grin-vacuum';
vacuum.name = 'Spectral luminous vacuum through GRIN';
vacuum.materials.ink.medium = { ior: 1, sigma_a: 0, emission: 0.5 };

const source = {
    tier: 'exact' as const,
    from: 'Unit slab at constant index: wavelength quadrature in scripts/audit-spectral-media.ts; luminous vacuum adds emission times length',
};
const furnaceStrategy: RenderStrategy = {
    ...mediaStrategy('furnace'),
    measurement: {
        color: 'spectral', maxBounces: 64,
        camera: { type: 'pinhole', fov: 1, position: [0, 0, 0], target: [0, 0, -1] },
    },
};
const scatterStrategy: RenderStrategy = {
    ...mediaStrategy('scatter'),
    measurement: {
        color: 'spectral', maxBounces: 16,
        camera: { type: 'pinhole', fov: 0.9, position: [0, 1.2, 4.2], target: [0, 1, 0] },
    },
};
const showcase: SceneDescription = {
    id: 'spectral-grin', name: 'Spectral Luneburg lens', ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor' },
        { type: 'sphere', parameters: { center: [0, 1, 0], radius: 1 }, material: 'lens' },
    ],
    materials: {
        floor: { model: 'checker', albedo_a: [0.9, 0.35, 0.2], albedo_b: [0.12, 0.2, 0.5], uv_scale: 3 },
        lens: { model: 'none', medium: {
            sigma_a: [0.01, 0.03, 0.05],
            ior: { kind: 'glsl', source: 'sqrt(max(2.0-dot(p-vec3(0.0,1.0,0.0),p-vec3(0.0,1.0,0.0)),0.0))' },
        } },
    },
    lights: [{ kind: 'quad', corner: [-2, 4, -2], edge1: [4, 0, 0], edge2: [0, 0, 4], emission: 5 }],
    environment: { type: 'constant', color: [0.18, 0.2, 0.28], sampleAsLight: true },
};
const showStrategies = (['nee', 'mis'] as const).map(d => ({
    ...scatterStrategy, id: d,
    estimator: { ...scatterStrategy.estimator, directLighting: d, russianRoulette: { startDepth: 4 } },
    view: { tonemap: { type: 'agx' as const } },
}));

export const spectralGrinSuite: Record<string, SceneSuiteEntry> = {
    [slab.id]: {
        scene: slab, strategies: [mediaStrategy('absorption')],
        exercises: 'Four unequal coefficient lanes survive a complete constant-index GRIN traversal',
        witness: { size: [16, 16], spp: 512, checks: [{
            kind: 'mean', value: [0.7252018857862556, 0.49546203867937083, 0.2958918635233839], tol: 0.005, source,
        }] },
    },
    [vacuum.id]: {
        scene: vacuum, strategies: [mediaStrategy('vacuum')],
        exercises: 'Per-step, exit-partial and boundary-guard emission in exact vacuum',
        witness: { size: [16, 16], spp: 512, checks: [{ kind: 'mean', value: 1.5, tol: 0.006, source }] },
    },
    ...Object.fromEntries([grinFurnaceHardScene, grinFurnaceEmitScene, grinFurnaceScatterScene].map(scene => [
        `spectral-${scene.id}`, {
            scene: { ...scene, id: `spectral-${scene.id}`, name: `Spectral ${scene.name}` },
            strategies: [furnaceStrategy],
            exercises: 'Spectral furnace conservation under spatial index, source integration or chromatic arc-length scattering',
            witness: { size: [16, 16], spp: 256, checks: [{ kind: 'mean', value: 0.4, tol: 0.006 }] },
        } satisfies SceneSuiteEntry,
    ])),
    'spectral-grin-scatter-ref': {
        scene: { ...grinScatterRef, id: 'spectral-grin-scatter-ref' }, strategies: [scatterStrategy],
        exercises: 'Straight analytic reference for spectral GRIN scattering',
    },
    'spectral-grin-scatter': {
        scene: { ...grinScatter, id: 'spectral-grin-scatter' }, strategies: [scatterStrategy],
        exercises: 'Constant-index spectral arc-length sampling agrees with straight analytic sampling',
        witness: { size: [24, 24], spp: 512, checks: [{
            kind: 'twin', other: { scene: 'spectral-grin-scatter-ref' }, meanTol: 0.02, rmse: 0.08,
        }] },
    },
    [showcase.id]: {
        scene: showcase, strategies: showStrategies,
        exercises: 'Spectral absorption through a spatially varying, wavelength-independent index; opaque shadow policy under NEE/MIS',
        witness: { size: [32, 24], spp: 512, checks: [{ kind: 'equality', strategies: [0, 1], meanTol: 0.03 }] },
    },
};
