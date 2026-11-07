// Live Planck illumination over a checker floor; temperature and intensity are independent.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';

export const hearthScene: SceneDescription = {
    id: 'hearth',
    name: 'Hearth (blackbody lamp + checker uv)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'tiles', name: 'floor' },
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 3.0 }, material: 'wall', name: 'backwall' },
        { type: 'sphere', parameters: { center: [-1.1, 0.6, 0.4], radius: 0.6 }, material: 'chrome', name: 'chrome_ball' },
        { type: 'sphere', parameters: { center: [1.0, 0.5, -0.4], radius: 0.5 }, material: 'clay', name: 'clay_ball' },
    ],
    materials: {
        // The first Hit.uv reader: warm ivory / deep slate cells. uv is the planar xz
        // placeholder chart, so the pattern tracks world coordinates.
        tiles: { model: 'checker', albedo_a: [0.85, 0.78, 0.68], albedo_b: [0.14, 0.15, 0.18], uv_scale: 6 },
        wall: { model: 'lambert', albedo: [0.45, 0.42, 0.38] },
        chrome: { model: 'mirror', f0: [0.95, 0.96, 0.97] },   // re-reflects the lamp's color shift
        clay: { model: 'lambert', albedo: [0.55, 0.30, 0.22] },
    },
    lights: [
        // Temperature normalization is CPU-derived; scale multiplies it at the read site.
        {
            kind: 'quad',
            corner: [-0.9, 2.6, -0.9],
            edge1: [1.8, 0, 0],
            edge2: [0, 0, 1.8],
            emission: {
                blackbody: {
                    kelvin: { param: 'lamp.kelvin', default: 2900, min: 1000, max: 12000 },
                    scale: { param: 'lamp.power', default: 14, min: 0, max: 40 },
                },
            },
        },
    ],
};

export const hearthNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: {
        camera: { type: 'pinhole', fov: { param: 'camera.fov', default: 0.85, min: 0.3, max: 1.4 } },
        maxBounces: 8,
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'agx' } },
};

export const hearthPtStrategy: RenderStrategy = {
    ...hearthNeeStrategy,
    id: 'pt',
    estimator: { ...hearthNeeStrategy.estimator, directLighting: 'none' },
};

// The pt-nee render shown with the display white at the lamp's default temperature: the
// lamp's white reads as D65 white, so the ivory cells look neutral (a view change only).
export const hearthWhiteBalanceStrategy: RenderStrategy = {
    ...hearthNeeStrategy,
    id: 'pt-nee-wb',
    view: { tonemap: { type: 'agx', whiteBalance: 2900 } },
};
