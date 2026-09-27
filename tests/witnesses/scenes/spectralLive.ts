import type { RenderStrategy, SceneDescription, SpectrumValue, Vec3 } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry } from '../types.js';

export type LiveColours = Record<'surface.albedo' | 'surface.emission' | 'lamp.emission' | 'sky.color', number | Vec3>;
export const liveDefaults: LiveColours = {
    'surface.albedo': [0.2, 0.5, 0.8], 'surface.emission': 0,
    'lamp.emission': [5, 2, 1], 'sky.color': [0.08, 0.12, 0.2],
};
export const liveChanged: LiveColours = {
    'surface.albedo': [0.8, 0.15, 0.3], 'surface.emission': [0.1, 0.3, 0.05],
    'lamp.emission': [1, 6, 20], 'sky.color': [0.3, 0.1, 0.04],
};

/** The same authored scene with live bindings or a constant value at every binding site. */
export function spectralLiveAt(values: LiveColours, driven = false): SceneDescription {
    const color = (key: keyof LiveColours): SpectrumValue => driven
        ? { param: key, default: values[key], min: 0, max: key === 'surface.albedo' ? 1 : 30 } as SpectrumValue
        : values[key];
    return {
        id: driven ? 'spectral-live' : 'spectral-live-ref', ambientSpace: { type: 'euclidean' },
        objects: [
            { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor' },
            { type: 'sphere', parameters: { center: [0, 0.7, 0], radius: 0.7 }, material: 'surface' },
        ],
        materials: {
            floor: { model: 'lambert', albedo: 0.6 },
            surface: { model: 'lambert', albedo: color('surface.albedo'), emission: color('surface.emission'), sampleAsLight: false },
        },
        lights: [
            { kind: 'point', position: [-2, 3, 2], emission: [2, 3, 5] },
            { kind: 'quad', corner: [0.5, 2.5, -1], edge1: [1, 0, 0], edge2: [0, 0, 1], emission: color('lamp.emission') },
        ],
        environment: { type: 'constant', color: color('sky.color'), sampleAsLight: true },
    };
}
export const liveStrategies: RenderStrategy[] = (['nee', 'mis'] as const).map(directLighting => ({
    id: directLighting,
    measurement: { color: 'spectral', maxBounces: 3,
        camera: { type: 'pinhole', fov: 0.75, position: [3, 2, 4], target: [0, 0.7, 0] } },
    estimator: { directLighting, lightSelection: 'power', wavelengths: 'visible', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
}));
export const spectralLiveSuite: Record<string, SceneSuiteEntry> = {
    'spectral-live': {
        scene: spectralLiveAt(liveDefaults, true), strategies: liveStrategies,
        exercises: 'Live spectral surface colour/emission, a sampled quad emitter, a constant-type sky, and changing light-selection probabilities',
        witness: { size: [48, 36], spp: 256, checks: [
            { kind: 'twin', other: { scene: 'spectral-live-ref' }, meanTol: 0.005, rmse: 0.002, label: 'live defaults ≡ constants' },
            { kind: 'equality', strategies: [0, 1], meanTol: 0.025, label: 'live NEE ≡ MIS' },
        ] },
    },
    'spectral-live-ref': {
        scene: spectralLiveAt(liveDefaults), strategies: liveStrategies,
        exercises: 'Constant reference for the live spectral scene',
    },
    'spectral-live-changed': {
        scene: { ...spectralLiveAt(liveDefaults, true), id: 'spectral-live-changed' }, strategies: liveStrategies,
        initialParameters: liveChanged,
        exercises: 'All spectral colour controls changed from their compiled defaults, including light-selection power',
        witness: { size: [48, 36], spp: 256, checks: [
            { kind: 'twin', other: { scene: 'spectral-live-changed-ref' }, meanTol: 0.005, rmse: 0.002, label: 'live changed values ≡ constants' },
        ] },
    },
    'spectral-live-changed-ref': {
        scene: { ...spectralLiveAt(liveChanged), id: 'spectral-live-changed-ref' }, strategies: liveStrategies,
        exercises: 'Constant reference at the changed colour-control values',
    },
};
