// demos/trialStillLifeScene.ts — a Poly Haven model and texture set, loaded end to end.
//
// The apple (food_apple_01) was fetched as glTF and converted to OBJ offline
// (tools/fetch-trial-assets.mjs, tools/gltf-to-obj.mjs); its diffuse map colors it through the
// mesh's uvs. The floor quad reads the wood_floor diffuse map through the quad's chart. Both files
// live in the gitignored public/trial/ (run `node tools/fetch-trial-assets.mjs` first), so this is
// an async entry: the scene is built only when the lab opens it.
//
// Units are decimeters: the model is in meters (the apple is about 10 cm wide), placed at scale 10.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';
import type { AsyncSceneSuiteEntry } from '../tests/witnesses/types.js';
import { loadOBJ } from '../src/authoring/loadOBJ.js';
import { withPose } from '../src/authoring/strategy.js';

const APPLE = '/trial/models/food_apple_01';

async function trialStillLifeScene(): Promise<SceneDescription> {
    const apple = await loadOBJ(`${APPLE}/food_apple_01.obj`, { material: 'apple', name: 'apple' });
    return {
        id: 'trial-still-life',
        name: 'Trial still life (Poly Haven apple on wood)',
        ambientSpace: { type: 'euclidean' },
        textures: {
            apple: { url: `${APPLE}/textures/food_apple_01_diff_2k.jpg`, colorspace: 'srgb' },
            wood: { url: '/trial/textures/wood_floor/wood_floor_diff_2k.jpg', colorspace: 'srgb' },
        },
        objects: [
            // 1.2 m square, normal +y (edge1 × edge2).
            { type: 'quad', parameters: { corner: [-6, 0, -6], edge1: [0, 0, 12], edge2: [12, 0, 0] }, material: 'wood' },
            { ...apple, transform: { position: [0, 0, 0], scale: 10 } },
        ],
        materials: {
            wood: { model: 'lambert', albedo: { texture: 'wood' } },
            apple: { model: 'lambert', albedo: { texture: 'apple' } },
        },
        lights: [
            // A 2 dm square softbox above and to the left, facing down (edge1 × edge2 = −y).
            { kind: 'quad', corner: [-3, 6, 1], edge1: [2, 0, 0], edge2: [0, 0, 2], emission: 40 },
        ],
        environment: { type: 'constant', color: [0.8, 0.85, 1.0], intensity: 0.3 },
    };
}

const strategy: RenderStrategy = {
    id: 'nee',
    measurement: { camera: { type: 'pinhole', fov: 0.5 }, maxBounces: 6 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 4 }, meshTraversal: 'bvh', accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};

export const trialStillLifeEntry: AsyncSceneSuiteEntry = {
    scene: trialStillLifeScene,
    name: 'Trial still life (Poly Haven, needs fetched assets)',
    strategies: [withPose(strategy, [0, 2.2, 4.5], [0, 0.45, 0])],
    exercises:
        'DEMO — the trial asset pipeline end to end: a Poly Haven glTF model converted offline to OBJ '
        + '(tools/gltf-to-obj.mjs, v flipped to the OBJ origin) with its diffuse map read through the '
        + 'mesh uvs, on a quad textured with a Poly Haven wood floor. Needs `node tools/fetch-trial-assets.mjs`.',
    expected:
        'a red-and-yellow apple with its stem up, skin pattern wrapped correctly (no upside-down or '
        + 'mirrored map), sitting on light wood planks, soft shadow to the right.',
};
