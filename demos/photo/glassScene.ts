// demos/photo/glassScene.ts — a glass study in the dark-field style: a blown-glass Klein bottle
// (a thin sheet), a solid glass ring and a frosted glass ball on black acrylic in a black room,
// lit by two strip boxes behind the set and a small softbox above, so the glass is drawn by its
// bright edges.
//
// Meters. The acrylic is the plane y = 0. The Klein bottle is 25 cm tall.

import type { SceneDescription, Vec3 } from '../../src/compiler/types.js';
import type { AsyncSceneSuiteEntry } from '../../tests/witnesses/types.js';
import { kleinBottle, meshObject } from './geometry.js';
import { distance, photoStrategy } from './camera.js';

// kleinBottle() spans y ∈ [0, 4.21] (the formula's units); scaled by S it stands on y = 0.
const S = 0.062;
const BOTTLE_AT: Vec3 = [0.0, 0.0, 0];

async function glassScene(): Promise<SceneDescription> {
    return {
        id: 'photo-glass',
        name: 'Glass study: Klein bottle, ring and frosted ball',
        ambientSpace: { type: 'euclidean' },
        objects: [
            { type: 'plane', name: 'acrylic', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'acrylic' },
            meshObject(kleinBottle(240, 96), 'sheet_glass', 'klein', {
                transform: { position: BOTTLE_AT, rotation: { axis: [0, 1, 0], angle: 0.6 }, scale: S },
            }),
            {
                type: 'torus', name: 'ring', parameters: { ringRadius: 0.055, tubeRadius: 0.022 }, material: 'glass',
                transform: { position: [0.15, 0.022, 0.16] },
            },
            { type: 'sphere', name: 'ball', parameters: { center: [-0.16, 0.06, -0.17], radius: 0.06 }, material: 'frosted' },
        ],
        materials: {
            // Black acrylic: a near-black body under a polished surface of index 1.49.
            acrylic: { model: 'plastic', albedo: [0.01, 0.01, 0.01], coat_eta: 1.49 },
            // Blown borosilicate, about 1.5 mm thick: a thin sheet.
            sheet_glass: { model: 'thin_dielectric', sheet_eta: 1.47 },
            glass: { model: 'dielectric', ior: 1.52 },
            // Acid-etched glass: a rough interface.
            frosted: { model: 'rough_dielectric', ior: 1.52, roughness: 0.35 },
        },
        lights: [
            // Dark field: two tall strip boxes (0.25 × 1.2 m) behind the set to either side, out of
            // frame, each facing the set's center, so the glass shows them only as bright edges
            // (edge1 × edge2 ∝ (±0.82, 0, 0.58), the sign opposite to the box's x).
            { kind: 'quad', corner: [-0.85, 0.0, -0.6], edge1: [0, 1.2, 0], edge2: [-0.145, 0, 0.205], emission: 9 },
            { kind: 'quad', corner: [0.85, 0.0, -0.6], edge1: [0, 1.2, 0], edge2: [-0.145, 0, -0.205], emission: 9 },
            // A small overhead softbox, 0.5 × 0.4 m, 0.9 m up, facing down: the top highlights.
            { kind: 'quad', corner: [-0.25, 0.9, -0.3], edge1: [0.5, 0, 0], edge2: [0, 0, 0.4], emission: 4 },
        ],
        environment: { type: 'constant', color: [0.01, 0.01, 0.01], intensity: 1.0 },
    };
}

const CAMERA: Vec3 = [0.05, 0.3, 1.75];

export const photoGlassEntry: AsyncSceneSuiteEntry = {
    scene: glassScene,
    name: 'Photo: glass study (needs no assets)',
    strategies: [
        photoStrategy({
            id: 'photo',
            focalLengthMm: 90, fNumber: 11, focusDistance: distance(CAMERA, [0, 0.13, 0]), blades: 9,
            position: CAMERA, target: [0, 0.13, 0],
            exposure: 1.0,
            maxBounces: 32,
        }),
    ],
    exercises:
        'PHOTO — bright-field glass photography: a Klein bottle (the parametric "bottle" immersion as a '
        + 'mesh) in thin sheet glass (thin_dielectric), a solid glass ring (dielectric torus), a frosted ball '
        + '(rough_dielectric), on black acrylic (plastic) before a backlit diffuser with two strip lights. '
        + '90 mm, f/11.',
    expected:
        'glass outlined in dark lines against a bright diffuser, the bottle\'s self-intersecting neck '
        + 'visible through its body, mirror reflections in the acrylic, and a soft glow through the frosted ball.',
};
