// demos/sdfFieldScene.ts — the boxed-SDF architecture's HOME-TURF demo
// (fable-sdf-accel; built after the first perf-sdf numbers came back terrible — that
// fixture accidentally measured the grazing worst case, see the witness header).
//
// This scene is the case the design's OWN cost analysis says should be fast: MANY
// small, well-separated, rotated SDF objects. Under `objectDispatch: 'table'` a ray
// slab-tests boxes and marches only the 1–3 fields whose boxes it enters, each
// within a tight interval — empty space costs zero field evaluations. The global
// marcher would evaluate ALL N fields at EVERY step of one march.
//
// The floor is an ANALYTIC plane (what shape-not-backend picks anyway): flat SDF
// grounds at grazing incidence are sphere tracing's global worst case (~L/h steps)
// and belong only in the epsilon-rule stress witness, never in a perf scene.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';

function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

const N = 150;
const rand = lcg(97531);
const objects: SceneDescription['objects'] = [
    { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 }, material: 'floor' },
];
// A loose 3D field: golden-angle spiral columns with jittered heights — real spacing
// (nearest neighbors ~1.2+ units apart at 0.25–0.45-unit object radii), so leaf boxes
// barely overlap and every ray crosses only a few.
const mats = ['clay', 'teal', 'gold', 'plum'];
for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    const theta = i * 2.399963229728653;
    const r = 1.5 + 8.5 * Math.sqrt(t);
    const pos: [number, number, number] = [
        r * Math.cos(theta),
        0.5 + 3.2 * rand(),
        r * Math.sin(theta),
    ];
    const rot = { axis: [rand() - 0.5, 1, rand() - 0.5] as [number, number, number], angle: rand() * Math.PI };
    const s = 0.6 + rand() * 0.6;
    const material = mats[i % 4];
    const kind = i % 3;
    if (kind === 0) {
        objects.push({ type: 'box', parameters: { halfSize: [0.28, 0.4, 0.28] }, material, backend: 'sdf', transform: { position: pos, rotation: rot, scale: s }, name: `b${i}` });
    } else if (kind === 1) {
        objects.push({ type: 'cylinder', parameters: { radius: 0.26, halfHeight: 0.45 }, material, backend: 'sdf', transform: { position: pos, rotation: rot, scale: s }, name: `c${i}` });
    } else {
        objects.push({ type: 'sphere', parameters: { radius: 0.32 }, material, backend: 'sdf', transform: { position: pos, scale: s }, name: `s${i}` });
    }
}

export const sdfFieldScene: SceneDescription = {
    id: 'sdf-field',
    name: `SDF Field (${N} boxed leaves)`,
    ambientSpace: { type: 'euclidean' },
    objects,
    materials: {
        floor: { model: 'lambert', albedo: [0.42, 0.42, 0.44] },
        clay: { model: 'lambert', albedo: [0.62, 0.4, 0.3] },
        teal: { model: 'lambert', albedo: [0.22, 0.5, 0.5] },
        gold: { model: 'lambert', albedo: [0.65, 0.52, 0.25] },
        plum: { model: 'lambert', albedo: [0.45, 0.3, 0.5] },
    },
    lights: [{ kind: 'point', position: [6, 10, 6], emission: 260 }],
    environment: { type: 'constant', color: [0.12, 0.13, 0.16] },
};

const measurement = { camera: { type: 'pinhole' as const, fov: 0.95 }, maxBounces: 4 };
const view = { tonemap: { type: 'reinhard' as const } };

/** TABLE-ONLY on purpose (the grand-bazaar rule): the app compiles EVERY strategy arm
 *  eagerly at load, and an unrolled arm at this count stalls ANGLE's compile — putting
 *  it on a key makes the whole card unloadable. The A/B against the global marcher
 *  lives on the 30-object sdf-table-twin witness, where both arms compile. */
export const sdfFieldTableStrategy: RenderStrategy = {
    id: 'table',
    measurement,
    estimator: { directLighting: 'nee', objectDispatch: 'table', russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
    view,
};
