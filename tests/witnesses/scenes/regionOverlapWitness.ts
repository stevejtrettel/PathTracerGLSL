// tests/witnesses/scenes/regionOverlapWitness.ts — the CONTAINMENT DESCENT's own gate
// (impl-plan-instanced-containment, the closing item).
//
// `bvhPointWalkLines` answers "which region is this point inside?" for table-dispatch
// scenes, and it read the node layout wrong for months: it never visited left subtrees,
// so half the regions were unreachable. Every sweep stayed green. The reason is the
// sharpest fact of that batch:
//
//   For DISJOINT solids, containment is barely load-bearing. Entering an object the
//   classifier probes only OUTSIDE it; leaving it, a solid owner covers its own side
//   with no probe at all. A stranded leaf changes NO answer. The descent decides
//   something only where a point is genuinely INSIDE a region.
//
// Which makes the obvious scene useless: separate glass balls under table dispatch
// diverge 0.08% with the defect restored — they pass. One nested tank: 0.48% — also
// passes. This scene is built the other way round, FROM the failure: twelve heavily
// OVERLAPPING absorbing balls in three strongly different hues, so every point sits
// inside several regions at once, innermost-wins has a real decision everywhere, and a
// stranded leaf lands a segment in the WRONG-COLOURED medium.
//
// Calibrated against the restored defect (Aug 11): 49.2% divergence with the bug,
// 0.07% without. There is no glass here and no instancing — the subject is the descent.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';

const NEST = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    const r = 1.0 + 0.45 * (i % 3);
    return {
        type: 'sphere' as const,
        parameters: {
            center: [Math.cos(a) * r * 0.7, 1.5 + 0.35 * Math.sin(a * 3), Math.sin(a) * r * 0.7] as [number, number, number],
            radius: 1.05 + 0.25 * (i % 4),
        },
        material: `tint${i % 3}`,
        name: `blob${i}`,
    };
});

export const regionOverlap: SceneDescription = {
    id: 'region-overlap',
    name: 'Overlapping regions under table dispatch (containment descent)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'quad', parameters: { corner: [-6, 0, -6], edge1: [0, 0, 12], edge2: [12, 0, 0] }, material: 'floor' },
        ...NEST,
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.55, 0.55, 0.58] },
        // Three absorbing media, strongly different in COLOUR: a stranded leaf shows up
        // as the wrong hue rather than a subtle shift, which is what makes the gate sharp.
        tint0: { model: 'none', medium: { sigma_a: [1.6, 0.15, 0.15] } },
        tint1: { model: 'none', medium: { sigma_a: [0.15, 1.6, 0.2] } },
        tint2: { model: 'none', medium: { sigma_a: [0.2, 0.2, 1.6] } },
    },
    lights: [{ kind: 'quad', corner: [-1.5, 3.4, -1.5], edge1: [3, 0, 0], edge2: [0, 0, 3], emission: 9 }],
    environment: { type: 'constant', color: [0.12, 0.15, 0.22], intensity: 1.0 },
};

const base = {
    measurement: { camera: { type: 'pinhole' as const, fov: 0.9 }, maxBounces: 24 },
    view: { tonemap: { type: 'reinhard' as const } },
};

export const regionOverlapUnrolledStrategy: RenderStrategy = {
    id: 'unrolled', ...base,
    estimator: { directLighting: 'nee', objectDispatch: 'unrolled', russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' } },
};
export const regionOverlapTableStrategy: RenderStrategy = {
    id: 'table', ...base,
    estimator: { directLighting: 'nee', objectDispatch: 'table', russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' } },
};
