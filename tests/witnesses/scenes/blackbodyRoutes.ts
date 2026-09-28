// Compile-only fixtures for blackbody emission on routes no other suite scene compiles: an
// instanced sphere-light batch under the light tree, a constant blackbody sky in an RGB render,
// and a blackbody point light under equiangular medium sampling. They bring these routes into
// the compiled-output digest and the static GLSL compile; they carry no rendered check.

import type { BlackbodyValue, RenderStrategy, SceneDescription } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry } from '../types.js';
import { spectralMediaSuite } from './spectralMedia.js';

const blackbody: BlackbodyValue = { blackbody: { kelvin: 3000, scale: 2 } };

function strategy(color: 'rgb' | 'spectral', estimator: Partial<RenderStrategy['estimator']> = {}): RenderStrategy {
    return {
        id: color,
        measurement: { color, maxBounces: 3,
            camera: { type: 'pinhole', fov: 0.75, position: [3, 2.2, 5], target: [0, 0.5, -0.5] } },
        estimator: { directLighting: 'nee', ...(color === 'spectral' ? { wavelengths: 'visible' as const } : {}),
            russianRoulette: null, accumulation: { type: 'average' }, ...estimator },
        view: { tonemap: { type: 'reinhard' } },
    };
}

const lampBatch: SceneDescription = {
    id: 'blackbody-lamp-batch', name: 'Blackbody lamp batch and sky', ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor' },
        { kind: 'instanced', name: 'lamps',
            prototype: { type: 'sphere', parameters: { center: [0, 0, 0], radius: 0.5 }, material: 'lamps' },
            placements: [{ position: [1, 0.6, 0] }, { position: [-1, 0.6, 0] }] },
    ],
    materials: { floor: { model: 'lambert', albedo: 0.6 }, lamps: { model: 'lambert', albedo: 0, emission: blackbody } },
    lights: [{ kind: 'point', position: [0, 3, 2], emission: blackbody }],
    environment: { type: 'constant', color: blackbody, intensity: 0.5 },
};

const fog = structuredClone(spectralMediaSuite['spectral-fog-placement']);
const equiangularScene: SceneDescription = {
    ...fog.scene, id: 'blackbody-equiangular', name: 'Blackbody point light in fog, equiangular placement',
    lights: [{ kind: 'point', position: [0.6, 1.7, 0], emission: blackbody }],
};
const equiangularStrategies = (['rgb', 'spectral'] as const).map((color) => {
    const s = fog.strategies[1];
    const { wavelengths: _w, ...rgbEstimator } = s.estimator;
    return { ...s, id: color, measurement: { ...s.measurement, color },
        estimator: color === 'spectral' ? s.estimator : rgbEstimator } as RenderStrategy;
});

export const blackbodyRoutesSuite: Record<string, SceneSuiteEntry> = {
    [lampBatch.id]: {
        scene: lampBatch,
        strategies: [strategy('rgb', { lightSelection: 'bvh' }), strategy('spectral', { lightSelection: 'bvh' })],
        exercises: 'Compile coverage: blackbody instanced sphere lights under the light tree, packed blackbody rows, and a blackbody sky, in RGB and spectral renders',
    },
    [equiangularScene.id]: {
        scene: equiangularScene, strategies: equiangularStrategies,
        exercises: 'Compile coverage: a blackbody point light under equiangular medium sampling, in RGB and spectral renders',
    },
};
