// demos/chromeScene.ts — DEMO showcase for the mirror + disk-light occupants (July 17
// 2026): three spheres (chrome mirror · glass · gold GGX) on a dark glossy floor, lit by
// TWO tilted disk lights (warm key, cool rim) under a black sky. The round highlights —
// in the mirror, in the glass, and stretched across the glossy floor — are the disk
// sampler showing its shape; the square-panel era ends here. MIS is this scene's home
// turf: two area lights × a peaked GGX floor.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';

export const chromeScene: SceneDescription = {
    id: 'chrome',
    name: 'Chrome (mirror + disk lights)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor', name: 'floor' },
        { type: 'sphere', parameters: { center: [0, 0.7, 0], radius: 0.7 }, material: 'chrome', name: 'chrome_ball' },
        { type: 'sphere', parameters: { center: [-1.8, 0.7, 0.35], radius: 0.7 }, material: 'glass', name: 'glass_ball' },
        { type: 'sphere', parameters: { center: [1.8, 0.7, 0.2], radius: 0.7 }, material: 'gold', name: 'gold_ball' },
    ],
    materials: {
        // Dark glossy charcoal — the disk reflections stretch across it (GGX × area light).
        floor: { model: 'ggx', f0: [0.06, 0.06, 0.07], roughness: { param: 'floor.roughness', default: 0.28, min: 0.05, max: 0.8 } },
        chrome: { model: 'mirror', f0: [0.95, 0.96, 0.97] },
        glass: { model: 'dielectric', ior: 1.5 },
        gold: { model: 'ggx', f0: [1.0, 0.71, 0.29], roughness: 0.18 },
    },
    lights: [
        // Warm KEY: a big tilted disk upper-left, aimed at the chrome ball (one-sided —
        // the normal IS the aim).
        { kind: 'disk', position: [-2.2, 3.4, 2.2], radius: 1.0, normal: [2.2, -2.7, -2.2], emission: [16, 11, 6.5] },
        // Cool RIM: a small disk behind-right, raking across the backs of the spheres.
        { kind: 'disk', position: [2.6, 2.6, -2.6], radius: 0.55, normal: [-2.6, -1.9, 2.6], emission: [7, 10, 16] },
    ],
    // No environment: black sky — the mirror shows only the scene and the two disks.
};

export const chromeMisStrategy: RenderStrategy = {
    id: 'pt-mis',
    measurement: {
        camera: { type: 'pinhole', fov: { param: 'camera.fov', default: 0.75, min: 0.3, max: 1.4 } },
        maxBounces: 8,
    },
    estimator: {
        directLighting: 'mis',
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'agx' } },   // neutral highlight roll-off on the bright disk reflections
};

export const chromeNeeStrategy: RenderStrategy = {
    ...chromeMisStrategy,
    id: 'pt-nee',
    estimator: { ...chromeMisStrategy.estimator, directLighting: 'nee' },
};

export const chromePtStrategy: RenderStrategy = {
    ...chromeMisStrategy,
    id: 'pt',
    estimator: { ...chromeMisStrategy.estimator, directLighting: 'none' },
};
