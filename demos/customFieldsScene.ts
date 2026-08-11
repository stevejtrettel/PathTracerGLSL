// demos/customFieldsScene.ts — scene-local SDF fields (fable-sdf-contract §5.2).
//
// The zero-ceremony door, exercised: two fields INVENTED FOR THIS SCENE, defined
// right here with `defineSDF` — no folder, no registry line, deleted with the scene.
// Each definition is one call: the GLSL field, its TS twin (the measuring instrument
// that lets the compiler CHECK the declared bound at compile time, per object, at the
// authored parameter values), and the declaration sheet (bound, step budget). The
// compiler generates everything else exactly as for registry shapes — struct, march
// loop, gradient normal, containment (the tangle is real glass), placement, AABB.
//
//   gyroid   the triply-periodic minimal-surface lattice, shelled and clipped to a
//            ball. sin/cos sums are NOT distances: the field divides by its own
//            gradient bound to stay conservative, and the hard clip against the EXACT
//            ball field is what makes the declared sphere bound correct BY
//            CONSTRUCTION, whatever the lattice does.
//   tangle   a quartic SOLID (f = x⁴+y⁴+z⁴ − 5|q|² + c < 0 — the arms have a genuine
//            interior, so the glass is real). The `shape` dial (c) can roam freely
//            because the clip cell, not the surface, owns the bound — menger's argument.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';
import { defineSDF } from '../src/components/geometry/custom.js';
import { tangle } from '../tests/witnesses/scenes/customFieldWitness.js';

export const gyroid = defineSDF({
    name: 'gyroid',
    params: [
        { name: 'radius', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' } },
        // Lattice period — one full gyroid cell per `cell` of world distance.
        { name: 'cell', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' } },
        { name: 'thickness', kind: 'length', shape: 'number', required: false, default: 0.03, constraint: { kind: 'positive' } },
    ],
    // w = sin kx cos ky + sin ky cos kz + sin kz cos kx, k = 2π/cell.
    // |∂w/∂x| ≤ k(|cos kx cos ky| + |sin kz sin kx|) ≤ k(|cos kx| + |sin kx|) ≤ √2·k per
    // axis ⇒ |∇w| ≤ √6·k ≈ 2.45k, so w/(2.5k) never overestimates the distance to the
    // level set (the sdf clauses). NOTE the coupled scale this forces on the shell:
    // |w| ≤ √(3/2)·... maxes ≈ 1.5, so the estimate tops out at ~0.6/k — a `thickness`
    // above that makes the shell swallow the whole ball (the first render of this very
    // scene was a solid sphere). |·| − thickness shells it; max() with the exact ball
    // field clips it, and a max of conservative fields is conservative — the sphere
    // bound below is exact by construction.
    glsl: `
float gyroid_sdf(vec3 p, Gyroid g) {
    float k = TWO_PI / g.cell;
    float w = sin(k * p.x) * cos(k * p.y) + sin(k * p.y) * cos(k * p.z) + sin(k * p.z) * cos(k * p.x);
    float shell = abs(w) / (2.5 * k) - g.thickness;
    return max(shell, length(p) - g.radius);
}
`,
    field: (p, v) => {
        const k = (2 * Math.PI) / (v.cell as number);
        const w = Math.sin(k * p[0]) * Math.cos(k * p[1])
            + Math.sin(k * p[1]) * Math.cos(k * p[2])
            + Math.sin(k * p[2]) * Math.cos(k * p[0]);
        const shell = Math.abs(w) / (2.5 * k) - (v.thickness as number);
        return Math.max(shell, Math.hypot(p[0], p[1], p[2]) - (v.radius as number));
    },
    marchBound: { type: 'sphere', values: (v) => ({ radius: v.radius as number }) },
    // A conservative estimate converges geometrically (ratio 1 − 1/3.5 per step), so
    // the default 512 is far more than this smooth field needs.
    stepBudget: 256,
});

// The tangle — a quartic SOLID authored in the VALUE/GRADIENT form (the variety-port
// shape) — is defined in the WITNESS fixture and imported above (demos may import
// witness fixtures, never the reverse): one field, one truth, and its numeric gate
// (field-glass: nee ≡ mis through the scene-local interfaces) rides the sweep.

export const customFieldsScene: SceneDescription = {
    id: 'custom-fields',
    name: 'Scene-local fields (gyroid · tangle)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        {
            type: 'plane',
            name: 'ground',
            parameters: { normal: [0, 1, 0], offset: 0 },
            material: 'floor',
        },
        // --- plinths: analytic, closed-form ------------------------------------
        {
            type: 'cylinder',
            name: 'plinth_left',
            parameters: { radius: 0.5, halfHeight: 0.4 },
            material: 'stone',
            transform: { position: [-0.95, 0.4, 0] },
        },
        {
            type: 'cylinder',
            name: 'plinth_right',
            parameters: { radius: 0.5, halfHeight: 0.3 },
            material: 'stone',
            transform: { position: [1.0, 0.3, -0.2] },
        },
        // --- the gyroid lattice ball, bronze -----------------------------------
        {
            type: gyroid,
            name: 'lattice',
            parameters: { radius: 0.45, cell: 0.42, thickness: 0.012 },
            material: 'bronze',
            transform: { position: [-0.95, 1.27, 0], rotation: { axis: [0, 1, 0], angle: 0.5 } },
        },
        // --- the glass tangle: a custom field with a REAL dielectric interior ---
        // (containment classifies through the same twin-checked signed field).
        {
            type: tangle,
            name: 'quartic',
            parameters: { size: 0.24, shape: 11.8 },
            material: 'glass',
            transform: { position: [1.0, 1.16, -0.2], rotation: { axis: [1, 0, 1], angle: 0.45 } },
        },
        // --- a registry torus for company: nothing distinguishes the two kinds --
        {
            type: 'torus',
            name: 'ring',
            parameters: { ringRadius: 0.4, tubeRadius: 0.11 },
            material: 'copper',
            transform: { position: [0.05, 0.42, 1.0], rotation: { axis: [1, 0, 0], angle: Math.PI / 2 } },
        },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.42, 0.4, 0.38] },
        stone: { model: 'lambert', albedo: [0.34, 0.32, 0.3] },
        bronze: { model: 'ggx', f0: [0.85, 0.62, 0.36], roughness: 0.3 },
        copper: { model: 'ggx', f0: [0.92, 0.55, 0.4], roughness: 0.14 },
        glass: { model: 'dielectric', ior: 1.5, albedo: [0.94, 0.97, 0.95] },
    },
    lights: [
        {
            kind: 'quad',
            corner: [-2.0, 3.0, -1.6], edge1: [1.7, 0, 0], edge2: [0, 0, 1.5],
            emission: 9,
        },
        { kind: 'sphere', position: [2.4, 1.6, 1.9], radius: 0.3, emission: [3.4, 2.5, 1.6] },
    ],
    environment: { type: 'constant', color: [0.12, 0.15, 0.2], intensity: 1.0 },
};

export const customFieldsStrategy: RenderStrategy = {
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
