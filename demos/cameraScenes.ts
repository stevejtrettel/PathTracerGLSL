// demos/cameraScenes.ts — camera-model demos (replaceable). Thin-lens defocus on the
// Cornell box: the box has real depth (front/back walls, the tall block), so an aperture
// wide enough blurs the walls while the focus plane stays sharp. fov stays a live slider;
// aperture + focusDistance are the thin-lens params (both trigger accumulation reset).

import type { RenderStrategy } from '../src/compiler/types.js';

// Fisheye — one occupant, four radial maps behind `projection` (see fisheye.md). fov is the
// full angular field (π = 180°). Each projection is a separate compiled renderer.
type FisheyeProjection = 'equidistant' | 'equisolid' | 'stereographic' | 'orthographic';
export function fisheyeStrategy(projection: FisheyeProjection): RenderStrategy {
    return {
        id: `fisheye-${projection}`,
        measurement: { camera: { type: 'fisheye', projection, fov: Math.PI }, maxBounces: 10 },
        estimator: {
            directLighting: 'nee',
            russianRoulette: { startDepth: 3 },
            accumulation: { type: 'average' },
        },
        view: { tonemap: { type: 'reinhard' } },
    };
}

// Cylindrical wide panorama of the Cornell box — 240° horizontal sweep (vertical follows
// the window at square pixels).
export const cornellCylindricalStrategy: RenderStrategy = {
    id: 'cylindrical',
    measurement: { camera: { type: 'cylindrical', hfov: 240 }, maxBounces: 10 },
    estimator: {
        directLighting: 'nee',
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

// Orthographic view of the Cornell box — parallel projection, no perspective convergence.
// scale = world half-height of the view (the box is ~2 tall, so ~1.6 frames it snugly).
export const cornellOrthoStrategy: RenderStrategy = {
    id: 'orthographic',
    measurement: { camera: { type: 'orthographic', scale: 1.6 }, maxBounces: 10 },
    estimator: {
        directLighting: 'nee',
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

// Equirectangular 360°×180° panorama from inside the Cornell box — every wall (red left,
// green right, white back/floor/ceiling, light strip) wraps across the image. Best viewed
// at a 2:1 resolution. No fov/aperture: the whole sphere is the frame.
export const cornellEquirectStrategy: RenderStrategy = {
    id: 'equirect',
    measurement: { camera: { type: 'equirect' }, maxBounces: 10 },
    estimator: {
        directLighting: 'nee',
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

export const cornellThinlensStrategy: RenderStrategy = {
    id: 'thinlens',
    measurement: {
        camera: {
            type: 'thinlens',
            fov: { param: 'camera.fov', default: 0.8, min: 0.3, max: 1.5 },
            aperture: 0.15,
            focusDistance: 4,
        },
        maxBounces: 10,
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};
