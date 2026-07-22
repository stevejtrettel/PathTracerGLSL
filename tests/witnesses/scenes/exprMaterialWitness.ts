// tests/witnesses/scenes/exprMaterialWitness.ts — the expression-material gate (fable-imagery P2).
//
// expr-const ⇄ expr-const-ref: the SAME lit scene, one authoring the sphere albedo as a
// CONSTANT vec3, the other as a GLSL expression that evaluates to that exact constant. The two
// must render identically — proof that the expression fill path does not perturb transport (the
// formula is a compile-time constant, so shading is byte-for-byte the constant material's). It
// also proves the P2 chart gate is transport-neutral: the expression scene turns the real uv
// charts ON (a procedural material is present), but this formula never reads uv, so the extra
// chart is unread and cannot move the image.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';

const ALBEDO: [number, number, number] = [0.7, 0.35, 0.2];

function scene(id: string, sphereAlbedo: SceneDescription['materials'][string]['albedo']): SceneDescription {
    return {
        id,
        name: `Expression material twin (${id})`,
        ambientSpace: { type: 'euclidean' },
        objects: [
            { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 }, material: 'ground' },
            { type: 'sphere', parameters: { center: [0, 0, 0], radius: 1.0 }, material: 'sphere' },
        ],
        materials: {
            ground: { model: 'lambert', albedo: [0.6, 0.6, 0.6] },
            sphere: { model: 'lambert', albedo: sphereAlbedo },
        },
        lights: [
            { kind: 'point', position: [3, 4, 2], emission: 30 },
        ],
        environment: { type: 'constant', color: [0.1, 0.2, 0.45], intensity: 1.0 },
    };
}

/** Reference: the sphere albedo is a plain constant. */
export const exprConstRef = scene('expr-const-ref', ALBEDO);

/** Twin: the SAME albedo authored as a formula that evaluates to the constant (no p/uv read). */
export const exprConst = scene('expr-const', { kind: 'glsl', source: `vec3(${ALBEDO[0]}, ${ALBEDO[1]}, ${ALBEDO[2]})` });

export const exprTwinStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 8 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
