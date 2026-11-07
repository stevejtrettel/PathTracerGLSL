// demos/photo/windowScene.ts — an interior still life by a window: Poly Haven models (a glazed
// ceramic vase, a brass vase, a turned wooden bowl, apples) on a plank table against a worn
// plaster wall, lit by one tall window to the left. The room is otherwise dark.
//
// Meters. The table top is y = 0; the wall stands 1.1 m behind the objects, far enough back that
// f/4 softens it (a blur circle of about 8 px, against at most 3 px on the objects). The models come in
// meters (glTF) and are placed at their own size, except the bowl, scaled ×2.2 to a 29 cm fruit bowl.
//
// The brass vase uses the asset's own material model, glTF metallic-roughness: a GGX lobe with
// Schlick Fresnel whose normal-incidence reflectance is the base-color map. This is a stand-in
// for a conductor with a complex index (not available here), as glTF itself is.

import type { SceneDescription, Vec3 } from '../../src/compiler/types.js';
import type { AsyncSceneSuiteEntry } from '../../tests/witnesses/types.js';
import { loadOBJ } from '../../src/authoring/loadOBJ.js';
import { distance, photoStrategy } from './camera.js';

const M = '/trial/models';

async function windowScene(): Promise<SceneDescription> {
    const [vase, brass, bowl, apple] = await Promise.all([
        loadOBJ(`${M}/ceramic_vase_01/ceramic_vase_01.obj`, { material: 'ceramic', name: 'vase' }),
        loadOBJ(`${M}/brass_vase_03/brass_vase_03.obj`, { material: 'brass', name: 'brass' }),
        loadOBJ(`${M}/wooden_bowl_02/wooden_bowl_02.obj`, { material: 'bowl', name: 'bowl' }),
        loadOBJ(`${M}/food_apple_01/food_apple_01.obj`, { material: 'apple', name: 'apple' }),
    ]);
    const yaw = (angle: number) => ({ axis: [0, 1, 0] as Vec3, angle });
    return {
        id: 'photo-window',
        name: 'Interior still life by a window (Poly Haven models)',
        ambientSpace: { type: 'euclidean' },
        textures: {
            wood: { url: '/trial/textures/wood_floor/wood_floor_diff_2k.jpg', colorspace: 'srgb' },
            plaster: { url: '/trial/textures/worn_plaster_wall/worn_plaster_wall_diff_2k.jpg', colorspace: 'srgb' },
            vase: { url: `${M}/ceramic_vase_01/textures/ceramic_vase_01_diff_2k.jpg`, colorspace: 'srgb' },
            brass: { url: `${M}/brass_vase_03/textures/brass_vase_03_diff_2k.jpg`, colorspace: 'srgb' },
            bowl: { url: `${M}/wooden_bowl_02/textures/wooden_bowl_02_diff_2k.jpg`, colorspace: 'srgb' },
            apple: { url: `${M}/food_apple_01/textures/food_apple_01_diff_2k.jpg`, colorspace: 'srgb' },
        },
        objects: [
            // Table top 1.6 × 0.9 m of planks, its front edge at z = 0.35. The wood map spans
            // ~2 m; its planks run along v, so edge2 lies along x. edge1 × edge2 points −y; a quad
            // is two-sided, so for a non-emitter the side does not matter.
            { type: 'quad', name: 'table', parameters: { corner: [-0.8, 0, 0.35], edge1: [0, 0, -0.9], edge2: [1.6, 0, 0] }, material: 'wood' },
            // The top's front edge, 3 cm thick, with the same plank direction (edge2 along x).
            { type: 'quad', name: 'table_edge', parameters: { corner: [-0.8, -0.03, 0.35], edge1: [0, 0.03, 0], edge2: [1.6, 0, 0] }, material: 'wood_edge' },
            // The apron under the top, 8 cm deep and set back 3 cm, so the table has a frame.
            { type: 'quad', name: 'apron', parameters: { corner: [-0.76, -0.11, 0.32], edge1: [0, 0.08, 0], edge2: [1.52, 0, 0] }, material: 'wood_apron' },
            // Back wall (normal +z) and a floor far below, so the room has something to bounce from.
            { type: 'quad', name: 'wall', parameters: { corner: [-3, -0.8, -1.2], edge1: [6, 0, 0], edge2: [0, 3, 0] }, material: 'plaster' },
            { type: 'quad', name: 'floor', parameters: { corner: [-3, -0.78, 3], edge1: [0, 0, -4.2], edge2: [6, 0, 0] }, material: 'floor' },
            { ...vase, transform: { position: [-0.28, 0, -0.25], rotation: yaw(0.4) } },
            { ...brass, transform: { position: [0.03, 0, -0.12], rotation: yaw(2.0) } },
            { ...bowl, transform: { position: [0.3, 0, -0.08], rotation: yaw(0.9), scale: 2.2 } },
            { ...apple, name: 'apple_a', transform: { position: [0.12, 0, 0.12], rotation: yaw(0.3) } },
            { ...apple, name: 'apple_b', transform: { position: [0.24, 0, 0.17], rotation: yaw(2.6) } },
        ],
        materials: {
            // Old oiled planks: matte.
            wood: { model: 'lambert', albedo: { texture: 'wood', uvScale: [0.45, 0.8] } },
            // The same map at the same 2 m scale on the edge (3 cm) and the apron (8 cm).
            wood_edge: { model: 'lambert', albedo: { texture: 'wood', uvScale: [0.015, 0.8] } },
            wood_apron: { model: 'lambert', albedo: { texture: 'wood', uvScale: [0.04, 0.76] } },
            plaster: { model: 'lambert', albedo: { texture: 'plaster', uvScale: [2.4, 1.2] } },
            floor: { model: 'lambert', albedo: [0.12, 0.09, 0.07] },
            // Glazed stoneware: the body color under a glossy glaze.
            ceramic: { model: 'plastic', albedo: { texture: 'vase' }, coat_eta: 1.5 },
            // glTF metallic-roughness for a metal: GGX, Schlick F0 = base color, roughness from the
            // asset's mean (0.24). A stand-in for a complex-index conductor.
            brass: { model: 'ggx', f0: { texture: 'brass' }, roughness: 0.24 },
            // Turned wood with an oil finish (the asset's roughness is about 0.65): matte.
            bowl: { model: 'lambert', albedo: { texture: 'bowl' } },
            // Apple skin is waxy: a pigmented body under a thin natural wax. The wax is not a
            // mirror: relief of wavelength 0.2 mm (a pixel is 0.8 mm here) and slope about 0.1
            // spreads the window's reflection into a sheen.
            apple: {
                model: 'plastic', albedo: { texture: 'apple' }, coat_eta: 1.45,
                bump: { height: { kind: 'glsl', source: '0.00002 * perlin_noise(5000.0 * p)' }, step: 0.00003 },
            },
        },
        lights: [
            // A tall window to the left, 0.9 × 1.6 m, facing +x and a little toward the wall
            // (edge1 × edge2 ∝ (0.97, 0, −0.26)).
            { kind: 'quad', corner: [-1.5, -0.3, 0.9], edge1: [-0.23, 0, -0.87], edge2: [0, 1.6, 0], emission: [7.4, 7.6, 8.0] },
        ],
        environment: { type: 'constant', color: [0.02, 0.02, 0.022], intensity: 1.0 },
    };
}

const CAMERA: Vec3 = [0.12, 0.44, 2.35];

export const photoWindowEntry: AsyncSceneSuiteEntry = {
    scene: windowScene,
    name: 'Photo: interior still life by a window (needs fetched assets)',
    strategies: [
        photoStrategy({
            id: 'photo',
            focalLengthMm: 85, fNumber: 4, focusDistance: distance(CAMERA, [0.05, 0.1, -0.1]), blades: 9,
            position: CAMERA, target: [0.04, 0.19, -0.1],
            exposure: 1.0,
        }),
    ],
    exercises:
        'PHOTO — a window-lit still life of Poly Haven models (OBJ meshes with their base-color maps): a '
        + 'glazed vase and apples (plastic), a wooden bowl (lambert), a brass vase (glTF metal model: GGX with '
        + 'Schlick F0 = base color, a stand-in for a complex-index conductor), on a plank table before a '
        + 'plaster wall. 85 mm, f/4. Needs fetched assets.',
    expected:
        'soft directional light from the left with long falloff into a dark room; the vase glaze and apples '
        + 'carry the window as a highlight; the brass vase shows a warm blurred reflection.',
};
