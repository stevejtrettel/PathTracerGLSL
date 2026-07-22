// demos/exprMaterialsScene.ts — DEMO for expression-driven materials (fable-imagery P2):
// a material property is a FORMULA over the surface chart `uv` (from P1) and the shading
// point `p`, with a live slider — the mathematician's paint, zero recompiles as you drag.
// The formula plumbing is the same one heterogeneous media use (GlslExpression + params);
// P2 just points it at material rows and hands the fill the surface coordinate.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';

// ONE slider drives both formulas — `{param}` fields mint a live uniform (u_paint_freq).
const FREQ = { param: 'paint.freq', default: 5, min: 1, max: 16 };

export const exprMaterialsScene: SceneDescription = {
    id: 'paint',
    name: 'Expression materials (paint with math)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor', name: 'floor' },
        // Albedo painted by a cosine PALETTE over the sphere's (θ,φ) chart (uv.x = longitude):
        // rainbow bands that wrap the surface and follow it — needs P1's real chart.
        { type: 'sphere', parameters: { center: [-1.15, 0.9, 0], radius: 0.9 }, material: 'uvpaint', name: 'uv_sphere' },
        // Albedo painted by a 3D sinusoid over the WORLD POINT p — reads no chart, so it
        // works on any surface (p is always meaningful, chart or not).
        { type: 'sphere', parameters: { center: [1.15, 0.9, 0], radius: 0.9 }, material: 'ppaint', name: 'p_sphere' },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.35, 0.36, 0.4] },
        // The classic Iñigo-Quilez cosine palette, over the surface chart.
        uvpaint: {
            model: 'lambert',
            albedo: {
                kind: 'glsl',
                source: 'vec3(0.5) + 0.5 * cos(6.28318 * (u_paint_freq * uv.x + vec3(0.0, 0.33, 0.67)))',
                params: [FREQ],
            },
        },
        // A 3D sinusoidal field sampled on the surface — colored by where the point sits in space.
        ppaint: {
            model: 'lambert',
            albedo: {
                kind: 'glsl',
                source: 'vec3(0.5) + 0.5 * sin(u_paint_freq * p * vec3(1.0, 1.3, 1.7))',
                params: [FREQ],
            },
        },
    },
    lights: [
        { kind: 'quad', corner: [-1.5, 3.2, -1.5], edge1: [3, 0, 0], edge2: [0, 0, 3], emission: [6, 6, 6] },
    ],
};

export const exprMaterialsNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: {
        camera: { type: 'pinhole', fov: { param: 'camera.fov', default: 0.9, min: 0.3, max: 1.4 } },
        maxBounces: 6,
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'agx' } },
};

export const exprMaterialsPtStrategy: RenderStrategy = {
    ...exprMaterialsNeeStrategy,
    id: 'pt',
    estimator: { ...exprMaterialsNeeStrategy.estimator, directLighting: 'none' },
};
