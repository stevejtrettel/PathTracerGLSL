// tests/witnesses/scenes/solidsWitness.ts — placement-fold stage 4 (Aug 10 2026):
// box/cylinder ANALYTIC occupants.
//
// TWIN PAIR: `solids-analytic` renders a rotated box, an unrotated box, and a rotated
// cylinder through the new closed-form intersectors — the rotated ones through the
// rigid-residual analytic arm (constant quat baked, T,s folded — the first NON-closed
// constant shapes on that arm), the unrotated box through the bare params-folded arm.
// `solids-sdf` is the SAME scene with `backend: 'sdf'` pins — the marcher reference.
// Cross-backend twin → display-space RMSE gates (the analytic-minimal discipline).
//
// CUBE-CLOUD TWIN: `cube-cloud` authors 48 rotated, scale-varied boxes as ONE
// instanced batch (FRAME-tier records — box is not similarityClosed, so the params
// tier is structurally unavailable; the 2-texel rigid record conjugates the ray into
// the prototype frame and calls box_intersect with s-scaled params); `cube-cloud-ref`
// authors the same 48 boxes as individual objects (rigid-residual analytic arms).
// Same math modulo fold-vs-conjugation → tight twin gates (mesh-instance-twin's).

import type { SceneDescription, RenderStrategy, Transform } from '../../../src/compiler/types.js';

const solidsMaterials = (): SceneDescription['materials'] => ({
    floor: { model: 'lambert', albedo: [0.5, 0.5, 0.5] },
    red: { model: 'lambert', albedo: [0.65, 0.25, 0.2] },
    blue: { model: 'lambert', albedo: [0.2, 0.35, 0.65] },
    tan: { model: 'lambert', albedo: [0.6, 0.5, 0.35] },
});

const solidsObjects = (backend?: 'sdf'): SceneDescription['objects'] => [
    { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 }, material: 'floor' },
    {
        type: 'box', parameters: { halfSize: [0.5, 0.8, 0.5] }, material: 'red', name: 'tall_box',
        transform: { position: [-1.4, 0.8, 0], rotation: { axis: [0, 1, 0], angle: 0.45 } },
        ...(backend !== undefined ? { backend } : {}),
    },
    {
        type: 'box', parameters: { center: [1.4, 0.5, -0.6], halfSize: [0.5, 0.5, 0.5] }, material: 'blue', name: 'flat_box',
        ...(backend !== undefined ? { backend } : {}),
    },
    {
        type: 'cylinder', parameters: { radius: 0.45, halfHeight: 0.7 }, material: 'tan', name: 'tilted_cyl',
        transform: { position: [0.2, 0.75, 0.9], rotation: { axis: [1, 0, 0.3], angle: 0.5 } },
        ...(backend !== undefined ? { backend } : {}),
    },
];

const solidsScene = (id: string, name: string, backend?: 'sdf'): SceneDescription => ({
    id, name,
    ambientSpace: { type: 'euclidean' },
    objects: solidsObjects(backend),
    materials: solidsMaterials(),
    lights: [{ kind: 'point', position: [2.5, 4.5, 2.5], emission: 60 }],
    environment: { type: 'constant', color: [0.08, 0.08, 0.1] },
});

export const solidsAnalytic = solidsScene('solids-analytic', 'Analytic Solids (box slab + cylinder interval)');
export const solidsSdf = solidsScene('solids-sdf', 'Analytic Solids Ref (marcher pins)', 'sdf');

export const solidsStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: { camera: { type: 'pinhole', fov: 0.9 }, maxBounces: 4 },
    estimator: { directLighting: 'nee', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};

// ---- cube cloud (the frame-tier instanced-box twin) -------------------------

function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

const rand = lcg(20260810);
const cubePlacements: Transform[] = [];
for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const r = 1.6 + rand() * 3.2;
    cubePlacements.push({
        position: [r * Math.cos(a), 0.25 + rand() * 1.6, r * Math.sin(a)],
        rotation: { axis: [rand() - 0.5, 1, rand() - 0.5], angle: rand() * Math.PI },
        scale: 0.5 + rand() * 0.9,
    });
}

const cloudMaterials = (): SceneDescription['materials'] => ({
    floor: { model: 'lambert', albedo: [0.5, 0.5, 0.5] },
    cube: { model: 'lambert', albedo: [0.55, 0.45, 0.3] },
});

export const cubeCloud: SceneDescription = {
    id: 'cube-cloud',
    name: 'Cube Cloud (48 instanced boxes, frame tier)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 }, material: 'floor' },
        {
            kind: 'instanced',
            prototype: { type: 'box', parameters: { halfSize: [0.22, 0.22, 0.22] }, material: 'cube' },
            placements: cubePlacements,
            name: 'cubes',
        },
    ],
    materials: cloudMaterials(),
    lights: [{ kind: 'point', position: [3, 6, 3], emission: 90 }],
    environment: { type: 'constant', color: [0.1, 0.1, 0.12] },
};

export const cubeCloudRef: SceneDescription = {
    id: 'cube-cloud-ref',
    name: 'Cube Cloud Ref (48 individual boxes)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 }, material: 'floor' },
        ...cubePlacements.map((t, i) => ({
            type: 'box',
            parameters: { halfSize: [0.22, 0.22, 0.22] },
            material: 'cube',
            transform: t,
            name: `cube_${i}`,
        })),
    ],
    materials: cloudMaterials(),
    lights: [{ kind: 'point', position: [3, 6, 3], emission: 90 }],
    environment: { type: 'constant', color: [0.1, 0.1, 0.12] },
};

export const cubeCloudStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: { camera: { type: 'pinhole', fov: 0.95 }, maxBounces: 4 },
    estimator: { directLighting: 'nee', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
