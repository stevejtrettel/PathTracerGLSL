// demos/uvChartsScene.ts — DEMO for real per-primitive UV charts (fable-imagery P1):
// ONE `checker` material on THREE primitives, so the same albedo pair reveals three
// DIFFERENT parameterizations — the whole point of P1 (Hit.uv stops being the planar
// placeholder). sphere → (θ,φ) equirect (poles converge); quad → the natural [0,1]²
// along its edges (even grid); disk → polar (r/R, θ/2π) (concentric rings × wedges).
// The floor is a plain lambert so the charted shapes read clean. Sphere/disk charts are
// AXIS-ALIGNED in v1 (§7.2): no rotation is authored here, so nothing is dissolved.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';

export const uvChartsScene: SceneDescription = {
    id: 'charts',
    name: 'UV charts (checker on sphere/quad/disk)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor', name: 'floor' },
        // (θ,φ) equirectangular chart — cells crowd toward the poles. Canonical at the origin +
        // placed via transform (rotation THEN position → spins IN PLACE): the poles tilt toward
        // the camera and the checker rotates WITH the sphere, because a patterned shape keeps its
        // own frame instead of baking the rotation away (fable-imagery P1b).
        { type: 'sphere', parameters: { center: [0, 0, 0], radius: 0.95 }, material: 'chart', name: 'sphere',
          transform: { position: [-1.7, 0.95, 0], rotation: { axis: [1, 0, 0.3], angle: 0.8 } } },
        // Natural [0,1]² along the quad's own edges — an even grid, placement-correct for free
        // (the fold carries the quad's orientation in its edges, so no P1b frame needed).
        { type: 'quad', parameters: { corner: [-0.75, 0.1, -0.1], edge1: [1.5, 0, 0], edge2: [0, 1.75, 0] }, material: 'chart', name: 'panel' },
        // Polar (r/R, θ/2π) — concentric rings × angular wedges. Spun about its own normal (P1b):
        // the wedge pattern rotates with the disk while it stays facing the camera.
        { type: 'disk', parameters: { center: [0, 0, 0], radius: 0.95, normal: [0.25, 0.35, 1] }, material: 'chart', name: 'disk',
          transform: { position: [2.0, 1.0, 0.15], rotation: { axis: [0.25, 0.35, 1], angle: 0.9 } } },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.35, 0.36, 0.4] },
        // ONE checker — three shapes, three charts. High contrast so the parameterization reads.
        chart: { model: 'checker', albedo_a: [0.9, 0.85, 0.75], albedo_b: [0.12, 0.16, 0.28], uv_scale: 8 },
    },
    lights: [
        // Overhead white quad (normal = cross(edge1, edge2) = -y → faces the shapes).
        {
            kind: 'quad',
            corner: [-1.6, 3.4, -1.6],
            edge1: [3.2, 0, 0],
            edge2: [0, 0, 3.2],
            emission: [7, 7, 7],
        },
    ],
};

export const uvChartsNeeStrategy: RenderStrategy = {
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

export const uvChartsPtStrategy: RenderStrategy = {
    ...uvChartsNeeStrategy,
    id: 'pt',
    estimator: { ...uvChartsNeeStrategy.estimator, directLighting: 'none' },
};
