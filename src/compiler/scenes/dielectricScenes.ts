// compiler/scenes/dielectricScenes.ts
// R-SUBMERGED (validation §5): glass sphere inside a water pool, camera in the water.
// Under the old deepest-wins classification the sphere gets η = 1 and is perfectly
// invisible; under innermost-wins it visibly distorts the checker. Eyeball-only —
// the numeric dielectric witnesses (F-ETA, the glass twins) live in
// src/witnesses/scenes/dielectricWitness.ts.

import type { SceneDescription, RenderStrategy } from '../types.js';

// ---------------------------------------------------------------------------
// R-SUBMERGED — pool box (half-extent 5, ior 1.33) + glass sphere (r 0.4, ior 1.5) at its
// center, camera INSIDE the water. The sphere's entry hit must classify region_from = water
// (not ambient): η = 1.33/1.5. A checkered emissive backwall gives the refraction something
// to distort — with a constant background the bug would be invisible even when present.
// ---------------------------------------------------------------------------

export const submergedScene: SceneDescription = {
    id: 'submerged',
    name: 'R-SUBMERGED (innermost-wins witness)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        // Water pool: big box around everything (camera included)
        {
            kind: 'sdf',
            sdf: { type: 'box', parameters: { center: [0, 0, 0], halfSize: [5, 5, 5] } },
            material: 'water',
        },
        // Glass sphere at the center, fully submerged
        {
            kind: 'sdf',
            sdf: { type: 'sphere', parameters: { center: [0, 0, 0], radius: 0.4 } },
            material: 'glass',
        },
        // Emissive checker backwall: solid below z = -2 (inside the pool)
        {
            kind: 'sdf',
            sdf: { type: 'plane', parameters: { normal: [0, 0, 1], offset: 2.0 } },
            material: 'screen',
        },
    ],
    materials: {
        water: { model: 'dielectric', ior: 1.33 },
        glass: { model: 'dielectric', ior: 1.5 },
        screen: {
            model: 'lambert',
            albedo: [0, 0, 0],
            emission: {
                kind: 'glsl',
                source: 'mix(vec3(0.05), vec3(1.0), mod(floor(p.x * 2.0) + floor(p.y * 2.0), 2.0))',
            },
        },
    },
    lights: [],
};

export const submergedStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: {
        camera: { type: 'pinhole', fov: 0.7 },
        maxBounces: 12, // TIR chains inside the sphere; paths that TIR at the pool walls just die
    },
    estimator: {
        directLighting: 'none',
        russianRoulette: null, // witness protocol: RR off
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};
