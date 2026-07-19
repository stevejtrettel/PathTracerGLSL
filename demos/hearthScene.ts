// demos/hearthScene.ts — DEMO showcase for the blackbody lamp + the checker material
// (impl-plan-blackbody-uv, July 19 2026): a checkered floor under a DRIVEN blackbody
// quad lamp. TWO firsts in one card:
//   · the lamp's emission is `{ blackbody: { kelvin: {param}, scale: {param} } }` —
//     drag `lamp.kelvin` (1000–12000 K) and the light re-colors LIVE with zero
//     recompiles (the derived u_lamp_kelvin_rgb closure; the power CDF re-weights too);
//   · the floor is the FIRST Hit.uv reader — `checker` mixes two albedos in the
//     surface parameterization. The visible chart is the PLACEHOLDER planar xz map
//     (UV_PLANAR_SCALE): tiles run in world xz on every surface, which is exactly the
//     fact this demo exists to make visible (per-primitive uv charts are the ledgered
//     follow-up).

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
        // THE blackbody lamp: temperature and power are the two physical dials, both
        // driven. kelvin → chroma folds on the CPU (Planck locus), never on the GPU.
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
