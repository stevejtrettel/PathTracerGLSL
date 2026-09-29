// demos/spectralShowcaseScene.ts — a still life made to be rendered spectrally
// (docs/claude-spectral-showcase-plan.md).
//
// Three things carry the spectral character; everything else is plain RGB:
//   THE PRISM — dense flint glass (SCHOTT N-SF11) catching one narrow 5800 K beam from a lamp
//     housing and throwing a rainbow onto a white card. The beam is narrow (divergence 0.06 rad):
//     a wide source would make each color a wide fan, the fans would overlap, and the card would
//     show white with colored edges. The rainbow is found through card → prism → aperture paths,
//     so it converges slowly.
//   TWO POOLS OF LIGHT — a white spot on the left (in a spectral render, plain RGB white light is
//     the D65 daylight spectrum) and a 2700 K blackbody spot on the right. Each pool holds the same
//     pair: a sphere colored by a Gaussian reflectance band, and its RGB twin, whose color is the
//     band's RGB stand-in. Under the white spot the twins match; under the warm spot they differ
//     (metamerism). In the RGB render the twins are identical in both pools.
//   BAND COLORS AND AN EMBER — saturated Gaussian colors (a deep red, a cyan, and a magenta, which
//     is a notch band), and a small sphere glowing at 1800 K.
//
// The RGB renderer is the preview: bands whose RGB stand-in lies outside [0, 1] are clipped there,
// with a compile warning, while the spectral renderer evaluates them exactly.

import type { SceneDescription, RenderStrategy, GaussianValue, BlackbodyValue } from '../src/compiler/types.js';
import { N_SF11 } from '../src/authoring/opticalGlass.js';
import { gaussianStandIn } from '../src/components/color/spectra/gaussian/gaussian.js';

const band = (center: number, width: number, peak: number, floor: number): GaussianValue => ({ gaussian: { center, width, peak, floor } });
const blackbody = (kelvin: number, scale: number): BlackbodyValue => ({ blackbody: { kelvin, scale } });

// The metameric pair: a 610 nm band (inside the RGB gamut) and a plain RGB color equal to its stand-in.
const pairBand = band(610, 25, 0.85, 0.04);
const pairTwin = gaussianStandIn(pairBand);

const sphere = (center: [number, number, number], radius: number, material: string) =>
    ({ type: 'sphere' as const, parameters: { center, radius }, material });

// Pool centers on the table (y = -1), in front of the prism.
const POOL_Z = 2.4, POOL_X = 1.9, PAIR_GAP = 0.42, PAIR_R = 0.38;

export const spectralShowcaseScene: SceneDescription = {
    id: 'spectral-showcase',
    name: 'Spectral still life — prism, blackbody light, Gaussian colors',
    ambientSpace: { type: 'euclidean' },
    materials: {
        table: { model: 'lambert', albedo: [0.42, 0.3, 0.2] },
        wall: { model: 'lambert', albedo: [0.55, 0.55, 0.52] },
        card: { model: 'lambert', albedo: 0.85 },
        housing: { model: 'lambert', albedo: 0.1 },
        glass: { model: 'dielectric', ior: N_SF11 },
        band: { model: 'lambert', albedo: pairBand },
        twin: { model: 'lambert', albedo: pairTwin },
        red: { model: 'lambert', albedo: band(645, 18, 0.9, 0.03) },
        cyan: { model: 'lambert', albedo: band(490, 30, 0.85, 0.05) },
        magenta: { model: 'lambert', albedo: band(540, 28, 0.04, 0.88) },
        ember: { model: 'lambert', albedo: 0, emission: blackbody(1800, 4) },
    },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1 }, material: 'table' },
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 3.5 }, material: 'wall' },
        // A triangular prism in x/z, extruded in y, standing on the table; the beam enters its left face.
        { kind: 'mesh', closed: true, material: 'glass',
            positions: new Float32Array([-1, -1, -0.7, 1, -1, -0.7, 0, -1, 0.9, -1, 1, -0.7, 1, 1, -0.7, 0, 1, 0.9]),
            indices: new Uint32Array([0, 1, 2, 3, 5, 4, 0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 3, 2, 3, 0]) },
        { type: 'box', parameters: { center: [2.5, 0.4, -0.65], halfSize: [0.05, 1.5, 1.1] }, material: 'card' },
        { type: 'box', parameters: { center: [-2, 0, -0.735], halfSize: [0.1, 0.15, 0.15] }, material: 'housing' },
        // The metameric pair, once in each pool.
        sphere([-POOL_X - PAIR_GAP, -1 + PAIR_R, POOL_Z], PAIR_R, 'band'),
        sphere([-POOL_X + PAIR_GAP, -1 + PAIR_R, POOL_Z], PAIR_R, 'twin'),
        sphere([POOL_X - PAIR_GAP, -1 + PAIR_R, POOL_Z], PAIR_R, 'band'),
        sphere([POOL_X + PAIR_GAP, -1 + PAIR_R, POOL_Z], PAIR_R, 'twin'),
        // Saturated band colors and the ember.
        sphere([-3.0, -0.55, 0.2], 0.45, 'red'),
        sphere([-3.3, -0.6, -1.7], 0.4, 'cyan'),
        sphere([3.6, -0.6, 1.2], 0.4, 'magenta'),
        sphere([-0.6, -0.88, 1.4], 0.12, 'ember'),
    ],
    lights: [
        // The beam: 5800 K, narrow, from inside the housing toward the prism's left face.
        { kind: 'softbeam', position: [-1.8, 0, -0.65], direction: [Math.cos(0.4), 0, Math.sin(0.4)],
            radius: 0.1, divergence: 0.06, emission: blackbody(5800, 1000) },
        // The two pools: plain white (D65 in a spectral render) and a 2700 K blackbody.
        { kind: 'spot', position: [-POOL_X, 2.2, POOL_Z], direction: [0, -1, 0], angle: 0.33, falloffStart: 0.26, emission: 10 },
        { kind: 'spot', position: [POOL_X, 2.2, POOL_Z], direction: [0, -1, 0], angle: 0.33, falloffStart: 0.26, emission: blackbody(2700, 10) },
    ],
    // A dim warm room, so the pools and the rainbow read.
    environment: { type: 'constant', color: blackbody(3500, 0.04), sampleAsLight: true },
};

function strategy(color: 'spectral' | 'rgb'): RenderStrategy {
    return {
        id: color,
        measurement: { color, maxBounces: 12, camera: { type: 'pinhole', fov: 42 * Math.PI / 180 } },
        estimator: { directLighting: 'mis', ...(color === 'spectral' ? { wavelengths: 'visible' as const } : {}),
            russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' } },
        view: { tonemap: { type: 'aces' } },
    };
}

/** Key 1: the spectral render. Key 2: the RGB preview (band colors clipped to the RGB gamut). */
export const spectralShowcaseStrategies: RenderStrategy[] = [strategy('spectral'), strategy('rgb')];
