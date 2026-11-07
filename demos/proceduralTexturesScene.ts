// demos/proceduralTexturesScene.ts — solid Perlin noise in material formulas.
//
// Albedo rows written as GLSL expressions that call the Perlin library
// (src/glsl/core/perlin.glsl: perlin_noise, perlin_fbm, perlin_turbulence) at the world
// shading point `p`. Solid noise needs no surface chart, so it textures a fractal, which has
// none, as easily as a torus:
//   marble  a menger sponge: sin bands across the sponge, phase-shifted by fBm (pbrt's
//           MarbleTexture recipe, with a two-color palette in place of its spline);
//   wood    a torus: rings at constant distance from the vertical axis through its center,
//           warped by low-frequency noise;
//   stone   a sphere: gray speckle from turbulence.
// Every formula stays in [0, 1] by the bounds in perlin.glsl's header (stone clamps its
// turbulence to 1), since nothing clamps a reflectance at run time. The pattern is fixed in
// world space: moving an object moves it through the pattern.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';

export const proceduralTexturesScene: SceneDescription = {
    id: 'procedural-textures',
    name: 'Procedural textures (Perlin marble · wood · stone)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', name: 'ground', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor' },
        {
            type: 'menger',
            name: 'sponge',
            parameters: { size: 0.72, iterations: 4 },
            material: 'marble',
            transform: { position: [-0.95, 0.8, 0], rotation: { axis: [0.42, 0.78, 0.46], angle: 0.62 } },
        },
        {
            type: 'torus',
            name: 'ring',
            parameters: { ringRadius: 0.48, tubeRadius: 0.17 },
            material: 'wood',
            transform: { position: [0.95, 0.17, -0.1] },
        },
        { type: 'sphere', name: 'pebble', parameters: { radius: 0.32 }, material: 'stone', transform: { position: [0.05, 0.32, 1.05] } },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.32, 0.31, 0.3] },
        // Veins where sin(…) nears 1: pow(·, 8) keeps them thin. |fBm(·, 0.5, 6)| ≤ 3.94.
        marble: {
            model: 'lambert',
            albedo: {
                kind: 'glsl',
                source: 'mix(vec3(0.86, 0.85, 0.82), vec3(0.22, 0.24, 0.32), '
                    + 'pow(0.5 + 0.5 * sin(5.0 * (p.y + 0.6 * p.x) + 3.0 * perlin_fbm(2.5 * p, 0.5, 6)), 8.0))',
            },
        },
        // 14 rings per unit radius about the axis x = 0.95, z = −0.1.
        wood: {
            model: 'lambert',
            albedo: {
                kind: 'glsl',
                source: 'mix(vec3(0.58, 0.36, 0.18), vec3(0.30, 0.16, 0.07), smoothstep(0.25, 0.75, '
                    + 'fract(14.0 * length(p.xz - vec2(0.95, -0.1)) + 0.7 * perlin_noise(vec3(1.5, 6.0, 1.5) * p))))',
            },
        },
        stone: {
            model: 'lambert',
            albedo: {
                kind: 'glsl',
                source: 'vec3(0.47, 0.45, 0.42) * (0.55 + 0.45 * min(perlin_turbulence(7.0 * p, 0.55, 5), 1.0))',
            },
        },
    },
    lights: [
        { kind: 'quad', corner: [-2.6, 3.4, -0.9], edge1: [1.7, 0, 0], edge2: [0, 0, 1.7], emission: 11 },
        { kind: 'quad', corner: [-2.4, 0.0, -3.2], edge1: [4.8, 0, 0], edge2: [0, 1.5, 0], emission: 1.2 },
    ],
    environment: { type: 'constant', color: [0.1, 0.12, 0.16], intensity: 1.0 },
};

export const proceduralTexturesStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 6 },
    estimator: {
        directLighting: 'mis',
        russianRoulette: { startDepth: 4 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'agx' } },
};
