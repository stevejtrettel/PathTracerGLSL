// demos/fractalsScene.ts — two classical fractals as ordinary shapes.
//
// Both are ports from the reference shape library, and each lands a different point
// about what "an SDF is a shape with a slow intersect" buys:
//
//   menger      the construction is SUBTRACTIVE (max out a cross of tubes per level), so
//               the sponge never leaves the cube it starts from — its march bound is
//               that cube, EXACTLY. A fractal costs the marcher no more envelope than a
//               box. Iterations are a parameter: 1…8 on the same object.
//   apollonian  an IFS with no closed-form envelope at all, so its bound is a MEASURED
//               fit (apollonian.ts records the numbers). More interesting: the gasket's
//               limit set has EMPTY INTERIOR, so `thickness` — the ε-neighbourhood the
//               object actually is — is a declared row rather than an accident of
//               MARCH_EPSILON. Set it to 0.002 and the filigree gets finer; that is a
//               change to the SHAPE, and it says so.
//
// Both are lit rather than shaded-by-normal: the recursive structure reads through
// contact shadows and occlusion, which is the whole reason to put a fractal in a path
// tracer instead of a fragment shader.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';

export const fractalsScene: SceneDescription = {
    id: 'fractals',
    name: 'Fractals (Menger sponge · Apollonian gasket)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        {
            type: 'plane',
            name: 'ground',
            parameters: { normal: [0, 1, 0], offset: 0 },
            material: 'floor',
        },
        // The sponge, tipped onto a corner so the recursion reads on three faces at once.
        // A rotation is PLACEMENT (the fold has canonical axes → the rigid-residual arm).
        {
            type: 'menger',
            name: 'sponge',
            parameters: { size: 0.72, iterations: 5 },
            material: 'ivory',
            transform: {
                position: [-0.95, 0.8, 0],
                rotation: { axis: [0.42, 0.78, 0.46], angle: 0.62 },
            },
        },
        {
            type: 'apollonian',
            name: 'gasket',
            parameters: { size: 0.3, morph: 1.22, thickness: 0.01, iterations: 9 },
            material: 'gold',
            transform: { position: [0.95, 0.78, 0] },
        },
        // A plain sphere between them — the control. Same dispatch, same materials, same
        // lighting; the only difference is how many steps its intersect takes.
        {
            type: 'sphere',
            name: 'control',
            parameters: { radius: 0.3 },
            material: 'ivory',
            transform: { position: [0, 0.3, 1.1] },
        },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.32, 0.31, 0.3] },
        ivory: { model: 'lambert', albedo: [0.78, 0.74, 0.66] },
        gold: { model: 'ggx', f0: [1.0, 0.78, 0.35], roughness: 0.18 },
    },
    lights: [
        // Key from high left, and a large dim panel behind to rim the recursion.
        { kind: 'quad', corner: [-2.6, 3.4, -0.9], edge1: [1.7, 0, 0], edge2: [0, 0, 1.7], emission: 11 },
        { kind: 'quad', corner: [-2.4, 0.0, -3.2], edge1: [4.8, 0, 0], edge2: [0, 1.5, 0], emission: 1.2 },
    ],
    environment: { type: 'constant', color: [0.1, 0.12, 0.16], intensity: 1.0 },
};

export const fractalsStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 6 },
    estimator: {
        directLighting: 'mis',
        russianRoulette: { startDepth: 4 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'agx' } },
};
