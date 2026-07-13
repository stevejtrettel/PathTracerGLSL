// demos/mediaScenes.ts
// R-FOGCUBE (validation §5, absorbing variant): a gray absorber cube over an emissive
// checker floor. The silhouette edge must show NO Fresnel-like rim (a rim = the null
// interface leaked a BSDF). Eyeball-only — the numeric media witnesses (F-SLAB,
// F-BOX-M, haze) live in src/witnesses/scenes/mediaWitness.ts.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';

// ---------------------------------------------------------------------------
// R-FOGCUBE (absorbing variant) — gray absorber cube floating over an emissive
// checker floor. Eyeball invariant: the cube dims the checker behind it with NO
// bright rim at the silhouette (any Fresnel-like edge = a leaked BSDF at the null
// interface). Grazing rays have near-zero path length through the cube, so the
// silhouette should fade smoothly to the background.
// ---------------------------------------------------------------------------

export const fogcubeScene: SceneDescription = {
    id: 'fogcube',
    name: 'R-FOGCUBE (null-interface rim witness)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        // Emissive checker floor: solid below y = 0
        {
            kind: 'sdf',
            sdf: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 } },
            material: 'floor',
        },
        // The absorber cube, floating
        {
            kind: 'sdf',
            sdf: { type: 'box', parameters: { center: [0, 1.0, 0], halfSize: [0.5, 0.5, 0.5] } },
            material: 'mist',
        },
    ],
    materials: {
        floor: {
            model: 'lambert',
            albedo: [0, 0, 0],
            emission: {
                kind: 'glsl',
                source: 'mix(vec3(0.15), vec3(1.0), mod(floor(p.x * 2.0) + floor(p.z * 2.0), 2.0))',
            },
        },
        mist: { model: 'none', medium: { sigma_a: [1.5, 1.5, 1.5] } },
    },
    lights: [],
};

export const fogcubeStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: {
        camera: { type: 'pinhole', fov: 0.8 },
        maxBounces: 6,
    },
    estimator: {
        directLighting: 'none',
        russianRoulette: null,
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};
