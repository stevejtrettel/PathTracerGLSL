// demos/sdfShapesScene.ts — the SDF shape library, in one still life.
//
// What it is here to show, now that "an SDF is a shape with a slow intersect" has
// landed: an interesting distance field is now just an OCCUPANT. Every shape below
// went in as one folder plus one registry line, and the scene authors them exactly the
// way it authors a sphere — same `type` + `parameters`, same placement, same materials,
// same lighting. Nothing in the compiler knows one from another.
//
//   bottle   a CONSTRUCTION (two rounded cylinders, smooth-unioned, hollowed to a shell,
//            chopped open, punted) filled with a dielectric — the glass is real glass:
//            the shell is two interfaces and the marcher steps |d| through the interior.
//            Its operators are file-private: a shape's internal maths is its own.
//   knob     a VENDORED model (NVIDIA's sdf-explorer, MIT), ported by prefixing its
//            helpers and giving it a measured bound. The corpus's own test model.
//   torus    the shape whose march bound is a DIFFERENT primitive (a cylinder of radius
//            R+r, half-height r — the tight one).
//
// The plinths and the ground are ANALYTIC (box, cylinder, plane), so the scene also
// shows the two intersect kinds sitting in one dispatch with nothing to distinguish
// them at the authoring layer.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';

export const sdfShapesScene: SceneDescription = {
    id: 'sdf-shapes',
    name: 'SDF shapes (bottle · knob · torus · eroded rock)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        {
            type: 'plane',
            name: 'ground',
            parameters: { normal: [0, 1, 0], offset: 0 },
            material: 'floor',
        },
        // --- the plinths: ANALYTIC cylinders, closed-form intersect ------------
        {
            type: 'cylinder',
            name: 'plinth_left',
            parameters: { radius: 0.42, halfHeight: 0.45 },
            material: 'stone',
            transform: { position: [-1.15, 0.45, -0.15] },
        },
        {
            type: 'cylinder',
            name: 'plinth_right',
            parameters: { radius: 0.38, halfHeight: 0.32 },
            material: 'stone',
            transform: { position: [1.25, 0.32, -0.35] },
        },
        // --- the glass bottle, standing on the right plinth -------------------
        // Local frame: origin at the BODY centre, so it sits at plinth top + baseHeight.
        {
            type: 'bottle',
            name: 'flask',
            parameters: {
                baseRadius: 0.3, baseHeight: 0.34, neckRadius: 0.1, neckHeight: 0.2,
                thickness: 0.022, rounded: 0.06, smoothJoin: 0.2, punt: 0.14,
            },
            material: 'glass',
            transform: { position: [1.25, 0.98, -0.35] },
        },
        // --- the vendored knob, on the left plinth ----------------------------
        // Rotated: a non-closed shape under a constant rotation takes the rigid-residual
        // arm, and its cylinder bound rides along — nothing about the port knows.
        {
            type: 'knob',
            name: 'vendor_knob',
            parameters: { radius: 0.42 },
            material: 'brass',
            transform: { position: [-1.15, 1.26, -0.15], rotation: { axis: [0, 1, 0], angle: 0.7 } },
        },
        // --- the torus, standing up behind ------------------------------------
        {
            type: 'torus',
            name: 'ring',
            parameters: { ringRadius: 0.46, tubeRadius: 0.13 },
            material: 'copper',
            transform: { position: [0.05, 0.52, -1.1], rotation: { axis: [1, 0, 0], angle: Math.PI / 2 } },
        },
        // --- analytic company on the floor ------------------------------------
        {
            type: 'sphere',
            name: 'ball',
            parameters: { radius: 0.3 },
            material: 'pale_stone',
            transform: { position: [0.15, 0.3, 0.6] },
        },
        {
            type: 'box',
            name: 'block',
            parameters: { halfSize: [0.22, 0.22, 0.22] },
            material: 'stone',
            transform: { position: [-0.5, 0.22, 0.85], rotation: { axis: [0, 1, 0], angle: 0.5 } },
        },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.42, 0.4, 0.38] },
        stone: { model: 'lambert', albedo: [0.36, 0.33, 0.3] },
        pale_stone: { model: 'lambert', albedo: [0.6, 0.57, 0.5] },
        glass: { model: 'dielectric', ior: 1.5, albedo: [0.92, 0.97, 0.94] },
        brass: { model: 'ggx', f0: [0.86, 0.68, 0.32], roughness: 0.22 },
        copper: { model: 'ggx', f0: [0.92, 0.55, 0.4], roughness: 0.12 },
    },
    lights: [
        // A soft key overhead-left (the shape-reader: erosion needs a grazing light to
        // read at all) and a dim warm fill from the right.
        {
            kind: 'quad',
            corner: [-2.2, 3.0, -1.4], edge1: [1.8, 0, 0], edge2: [0, 0, 1.6],
            emission: 9,
        },
        { kind: 'sphere', position: [2.6, 1.5, 1.8], radius: 0.35, emission: [3.2, 2.4, 1.6] },
    ],
    environment: { type: 'constant', color: [0.13, 0.16, 0.22], intensity: 1.0 },
};

export const sdfShapesStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: {
        camera: { type: 'pinhole', fov: 0.85 },
        maxBounces: 8,
    },
    estimator: {
        directLighting: 'mis',
        russianRoulette: { startDepth: 4 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'agx' } },
};

/** The pt arm — no NEE at all. Slower to converge, and the honest cross-check that the
 *  area lights above are being sampled correctly rather than just plausibly. */
export const sdfShapesPtStrategy: RenderStrategy = {
    ...sdfShapesStrategy,
    id: 'pt',
    estimator: { ...sdfShapesStrategy.estimator, directLighting: 'none' },
};
