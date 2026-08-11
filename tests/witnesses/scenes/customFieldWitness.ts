// tests/witnesses/scenes/customFieldWitness.ts — the scene-local field door's
// numeric gate (fable-sdf-contract §5.2 / §4).
//
// FIELD-GLASS: a defineSDF quartic solid in real glass under a samplable panel — the
// X-GLASS pattern pointed at the door: nee ≡ mis convergence exercises delta
// bookkeeping THROUGH a scene-local field's interfaces, and any hit-refinement
// regression (misplaced/misclassified interfaces — the ring-banding class the
// `refine` fact exists for) diverges the arms instead of waiting for an eye.
//
// The tangle is defined HERE and imported by the custom-fields demo (demos may
// import witness fixtures, never the reverse) — one field, one truth, and the
// defineSDF name-collision guard stays happy when both load in one session.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';
import { defineSDF } from '../../../src/components/geometry/custom.js';

/** The quartic tangle SOLID (f = x⁴+y⁴+z⁴ − 5|q|² + shape < 0 — a genuine interior,
 *  so the glass is real). Distance is the VALUE/GRADIENT estimate — the variety-port
 *  form (the old tracer's DE; gradient hand-derived, autodiff's job later): first-
 *  order accurate near the surface ⇒ fast marching and a small honest `refine: 4`.
 *  The |∇f| floor keeps critical points from exploding the step; the Chebyshev clip
 *  owns the bound (menger's argument), so `shape` roams without the envelope moving. */
export const tangle = defineSDF({
    name: 'tangle',
    params: [
        { name: 'size', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' } },
        // The quartic's constant c — the morph dial. 11.8 is the classic tangle cube.
        { name: 'shape', kind: 'scalar', shape: 'number', required: false, default: 11.8 },
    ],
    glsl: `
float tangle_sdf(vec3 p, Tangle t) {
    vec3 q = p / t.size;
    vec3 q2 = q * q;
    float f = dot(q2, q2) - 5.0 * dot(q, q) + t.shape;
    vec3 g = 4.0 * q2 * q - 10.0 * q;
    float d = 0.5 * f / max(length(g), 4.0);
    float clip = (max(abs(q.x), max(abs(q.y), abs(q.z))) - 2.3) * t.size;
    return max(d * t.size, clip);
}
`,
    field: (p, v) => {
        const s = v.size as number;
        const q = p.map((x) => x / s);
        const f = q[0] ** 4 + q[1] ** 4 + q[2] ** 4
            - 5 * (q[0] * q[0] + q[1] * q[1] + q[2] * q[2]) + (v.shape as number);
        const g = Math.hypot(...q.map((x) => 4 * x * x * x - 10 * x));
        const d = (0.5 * f) / Math.max(g, 4.0);
        const clip = (Math.max(Math.abs(q[0]), Math.abs(q[1]), Math.abs(q[2])) - 2.3) * s;
        return Math.max(d * s, clip);
    },
    marchBound: { type: 'box', values: (v) => ({ halfSize: [2.3 * (v.size as number), 2.3 * (v.size as number), 2.3 * (v.size as number)] }) },
    refine: 4,
});

export const fieldGlass: SceneDescription = {
    id: 'field-glass',
    name: 'Field glass (scene-local tangle, X-GLASS pattern)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        {
            type: 'plane',
            name: 'ground',
            parameters: { normal: [0, 1, 0], offset: 0 },
            material: 'floor',
        },
        {
            type: tangle,
            name: 'solid',
            parameters: { size: 0.3, shape: 11.8 },
            material: 'glass',
            transform: { position: [0, 0.85, 0], rotation: { axis: [1, 0, 1], angle: 0.45 } },
        },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.45, 0.43, 0.4] },
        glass: { model: 'dielectric', ior: 1.5, albedo: [0.95, 0.97, 0.95] },
    },
    lights: [
        {
            kind: 'quad',
            corner: [-0.8, 2.6, -0.8], edge1: [1.6, 0, 0], edge2: [0, 0, 1.6],
            emission: 10,
        },
    ],
    environment: { type: 'constant', color: [0.1, 0.12, 0.15], intensity: 1.0 },
};

const base = {
    measurement: { camera: { type: 'pinhole' as const, fov: 0.8 }, maxBounces: 8 },
    view: { tonemap: { type: 'agx' as const } },
};

export const fieldGlassNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    ...base,
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' } },
};

export const fieldGlassMisStrategy: RenderStrategy = {
    id: 'pt-mis',
    ...base,
    estimator: { directLighting: 'mis', russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' } },
};

export const fieldGlassPtStrategy: RenderStrategy = {
    id: 'pt',
    ...base,
    estimator: { directLighting: 'none', russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' } },
};
