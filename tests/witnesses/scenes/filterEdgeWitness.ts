// The pixel filter's kernel, measured at a straight edge (measurement.pixel; components/pixel).
//
// A pinhole camera at the origin looks down −z (right = +x). One emissive quad (Le = 1, black
// environment, maxBounces 0, so a pixel reads exactly the fraction of its kernel that sees the
// quad) covers x ∈ [0, 50], y ∈ [−50, 50] at z = −4. Its left edge x = 0 projects to film
// x = 80 exactly (ndc 0 at the center of a 160-pixel-wide image), and it spans the full height.
// Pixel column c has its center d = c + 0.5 − 80 px from the edge, so its mean is P(d + U > 0),
// with U the kernel's x-marginal:
//
//     column (d)    box   gaussian σ
//     79 (−0.5)     0     1 − Φ(0.5/σ) = 0.158655   (σ = 0.5)
//     80 (+0.5)     1     Φ(0.5/σ)     = 0.841345
//
// Each region selects one column: the runner floors x0 and ceils x1, so x = (c + 0.5)/160 with
// w = 0.25/160 reads column c over all rows. Column 79 separates the kernels by 0.16, which is
// 25 tolerances. Noise: a column of 120 pixels at 1024 spp averages 122 880 samples, so the
// Bernoulli σ at p = 0.16 is 0.001. The spectral arm adds the noise of the sampled wavelengths;
// measured, its column means sat within 0.002 of the expected values. tol 0.006.
//
// The tiled check renders the gaussian arm in 64-px tiles, whose samples cross tile seams: a
// pixel's film point may land in a neighbor tile, and the image must still be identical.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry, WitnessRegion } from '../types.js';
import { PIXEL_MODELS } from '../../../src/components/pixel/index.js';
import { glslDefine } from '../../helpers/glslDefine.js';
import { normalCdf } from '../../helpers/normalCdf.js';

const sigma = glslDefine(PIXEL_MODELS.gaussian.glsl, 'PIXEL_GAUSSIAN_SIGMA');

const scene: SceneDescription = {
    id: 'filter-edge',
    name: 'Pixel filter at an edge',
    ambientSpace: { type: 'euclidean' },
    objects: [
        // Emitting side cross(edge1, edge2) = +z, toward the camera.
        { type: 'quad', parameters: { corner: [0, -50, -4], edge1: [50, 0, 0], edge2: [0, 100, 0] }, material: 'panel' },
    ],
    materials: { panel: { model: 'lambert', albedo: 0, emission: 1, sampleAsLight: false } },
    lights: [],
    environment: { type: 'none' },
};

function strategy(id: string, pixel: 'box' | 'gaussian', color: 'rgb' | 'spectral'): RenderStrategy {
    return {
        id,
        measurement: {
            camera: { type: 'pinhole', fov: 0.8, position: [0, 0, 0], target: [0, 0, -1] },
            maxBounces: 0,
            pixel,
            color,
        },
        estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
        view: { tonemap: { type: 'none' } },
    };
}

const strategies = [
    strategy('box', 'box', 'rgb'),
    strategy('gaussian', 'gaussian', 'rgb'),
    strategy('gaussian-spectral', 'gaussian', 'spectral'),
];

const column = (c: number): WitnessRegion => ({ x: (c + 0.5) / 160, w: 0.25 / 160, y: 0, h: 1 });
const gaussian79 = 1 - normalCdf(0.5 / sigma);
const gaussian80 = normalCdf(0.5 / sigma);
const tol = 0.006;

export const filterEdgeSuite: Record<string, SceneSuiteEntry> = {
    'filter-edge': {
        scene,
        strategies,
        exercises:
            'measurement.pixel: the box and gaussian kernels, read as the x-marginal across a straight emissive edge at film x = 80 (keys 1 box, 2 gaussian, 3 gaussian spectral); a tiled gaussian render equals the one-piece render',
        expected:
            `column 79 / 80 read 0 / 1 under box and ${gaussian79.toFixed(6)} / ${gaussian80.toFixed(6)} under gaussian (RGB and spectral)`,
        witness: {
            size: [160, 120],
            spp: 1024,
            checks: [
                { kind: 'mean', strategy: 0, region: column(79), value: 0, tol, label: 'box: column 79 = 0' },
                { kind: 'mean', strategy: 0, region: column(80), value: 1, tol, label: 'box: column 80 = 1' },
                { kind: 'mean', strategy: 1, region: column(79), value: gaussian79, tol, label: 'gaussian: column 79 = 1 − Φ(1)' },
                { kind: 'mean', strategy: 1, region: column(80), value: gaussian80, tol, label: 'gaussian: column 80 = Φ(1)' },
                { kind: 'mean', strategy: 2, region: column(79), value: gaussian79, tol, label: 'gaussian spectral: column 79 = 1 − Φ(1)' },
                { kind: 'mean', strategy: 2, region: column(80), value: gaussian80, tol, label: 'gaussian spectral: column 80 = Φ(1)' },
                { kind: 'tiled', strategy: 1, tileSize: 64, label: 'gaussian: tiled ≡ one piece (HDR and PNG)' },
            ],
        },
    },
};
