// tests/witnesses/scenes/sdfTableWitness.ts — boxed-SDF leaves (impl-plan-sdf-accel T5).
//
// SDF-TABLE-TWIN: ~30 rotated mixed `backend:'sdf'`-pinned objects (post-stage-4 the
// pins are required — box/cylinder resolve analytic by default) rendered under
// `objectDispatch: 'unrolled'` (the global min-march, THE reference) vs `'table'`
// (per-leaf interval marching through the scene TLAS — LEAF_SDF records with the
// rigid tail). Same scene, same RNG stream, bias-free estimator swap → the bazaar
// identical-stream gates. The big ground slab is the GRAZING stress: the low camera
// sends near-silhouette rays skimming its top face, so any interval-end epsilon
// mistake (fable-sdf-accel §3 — clipped silhouettes at box walls, stall-commit at a
// boundary) shows as structural rmse divergence between the arms.
//
// PERF-SDF (report-only, --perf): the crossover referee — procedural mixed scenes at
// N ∈ {8, 32, 128}, unrolled vs table arms. The design predicts unrolled wins small N
// and table wins past the crossover; the measured N is the number the default-policy
// question reopens with (fable-sdf-accel §2.3).
//
// The perf scenes deliberately carry NO grazing slab (the Aug 10 first-numbers lesson:
// a flat SDF field at grazing incidence steps by the ray's HEIGHT — ~L/h steps, i.e.
// the full 512 budget for horizon-ward rays — so a big pinned slab makes BOTH arms
// measure the sphere-tracing worst case instead of the crossover). The floor is an
// ANALYTIC plane (what shape-not-backend picks anyway); the SDF objects float in a
// cluster the camera looks INTO, so the timings scale with the SDF machinery, not
// with a pathological graze. The graze stays where it belongs: the TWIN's epsilon
// stress.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';

function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

/** N pinned-SDF objects (box/cylinder/sphere cycling, rotated, scale-varied) on a
 *  grazing ground slab. Deterministic — the twin arms and the perf arms share bytes. */
function sdfObjects(n: number, seed: number): SceneDescription['objects'] {
    const rand = lcg(seed);
    const objects: SceneDescription['objects'] = [
        // The grazing target: a wide flat box just under the camera's line of sight.
        { type: 'box', parameters: { halfSize: [9, 0.15, 9] }, material: 'floor', backend: 'sdf', name: 'ground_slab', transform: { position: [0, -0.15, 0] } },
    ];
    const mats = ['red', 'blue', 'tan'];
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = 1.2 + (i % 5) * 0.9 + rand() * 0.5;
        const pos: [number, number, number] = [r * Math.cos(a * 3.7), 0.35 + rand() * 1.4, r * Math.sin(a * 3.7)];
        const rot = { axis: [rand() - 0.5, 1, rand() - 0.5] as [number, number, number], angle: rand() * Math.PI };
        const s = 0.5 + rand() * 0.7;
        const material = mats[i % 3];
        const kind = i % 3;
        if (kind === 0) {
            objects.push({ type: 'box', parameters: { halfSize: [0.3, 0.45, 0.3] }, material, backend: 'sdf', transform: { position: pos, rotation: rot, scale: s } });
        } else if (kind === 1) {
            objects.push({ type: 'cylinder', parameters: { radius: 0.28, halfHeight: 0.5 }, material, backend: 'sdf', transform: { position: pos, rotation: rot, scale: s } });
        } else {
            objects.push({ type: 'sphere', parameters: { radius: 0.35 }, material, backend: 'sdf', transform: { position: pos, scale: s } });
        }
    }
    return objects;
}

const twinMaterials = (): SceneDescription['materials'] => ({
    floor: { model: 'lambert', albedo: [0.45, 0.45, 0.45] },
    red: { model: 'lambert', albedo: [0.65, 0.25, 0.2] },
    blue: { model: 'lambert', albedo: [0.2, 0.35, 0.65] },
    tan: { model: 'lambert', albedo: [0.6, 0.5, 0.35] },
});

const sdfScene = (id: string, name: string, n: number): SceneDescription => ({
    id, name,
    ambientSpace: { type: 'euclidean' },
    objects: sdfObjects(n, 20260810),
    materials: twinMaterials(),
    lights: [{ kind: 'point', position: [4, 7, 4], emission: 140 }],
    environment: { type: 'constant', color: [0.09, 0.09, 0.11] },
});

export const sdfTableTwin = sdfScene('sdf-table-twin', 'SDF Table Twin (30 pinned SDFs, interval leaves)', 30);

const measurement = { camera: { type: 'pinhole' as const, fov: 0.95 }, maxBounces: 4 };
const view = { tonemap: { type: 'reinhard' as const } };

export const sdfUnrolledStrategy: RenderStrategy = {
    id: 'unrolled',
    measurement,
    estimator: { directLighting: 'nee', russianRoulette: null, accumulation: { type: 'average' } },
    view,
};

export const sdfTableStrategy: RenderStrategy = {
    id: 'table',
    measurement,
    estimator: { directLighting: 'nee', objectDispatch: 'table', russianRoulette: null, accumulation: { type: 'average' } },
    view,
};

// ---- perf-sdf (the crossover referee) ---------------------------------------

/** N pinned-SDF objects clustered in the air — NO slab (see the header note). */
function perfObjects(n: number, seed: number): SceneDescription['objects'] {
    const rand = lcg(seed);
    const objects: SceneDescription['objects'] = [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 }, material: 'floor' },
    ];
    const mats = ['red', 'blue', 'tan'];
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = 1.0 + (i % 5) * 0.8 + rand() * 0.5;
        const pos: [number, number, number] = [r * Math.cos(a * 3.7), 1.2 + rand() * 2.4, r * Math.sin(a * 3.7)];
        const rot = { axis: [rand() - 0.5, 1, rand() - 0.5] as [number, number, number], angle: rand() * Math.PI };
        const s = 0.5 + rand() * 0.7;
        const material = mats[i % 3];
        const kind = i % 3;
        if (kind === 0) {
            objects.push({ type: 'box', parameters: { halfSize: [0.3, 0.45, 0.3] }, material, backend: 'sdf', transform: { position: pos, rotation: rot, scale: s } });
        } else if (kind === 1) {
            objects.push({ type: 'cylinder', parameters: { radius: 0.28, halfHeight: 0.5 }, material, backend: 'sdf', transform: { position: pos, rotation: rot, scale: s } });
        } else {
            objects.push({ type: 'sphere', parameters: { radius: 0.35 }, material, backend: 'sdf', transform: { position: pos, scale: s } });
        }
    }
    return objects;
}

const perfScene = (id: string, name: string, n: number): SceneDescription => ({
    id, name,
    ambientSpace: { type: 'euclidean' },
    objects: perfObjects(n, 20260810),
    materials: twinMaterials(),
    lights: [{ kind: 'point', position: [4, 8, 4], emission: 160 }],
    environment: { type: 'constant', color: [0.09, 0.09, 0.11] },
});

/** N=0 — the FLOOR: same camera, floor, light and film as the ladder, zero SDF
 *  objects. Every other row's ms/frame minus this one is the SDF-attributable cost,
 *  which is what the architecture question is actually about (raw ms/frame carries
 *  a fixed per-frame cost that compresses every ratio). */
export const perfSdf0 = perfScene('perf-sdf-0', 'Perf SDF (N=0, the floor)', 0);

export const perfSdf8 = perfScene('perf-sdf-8', 'Perf SDF (N=8)', 8);
export const perfSdf32 = perfScene('perf-sdf-32', 'Perf SDF (N=32)', 32);
export const perfSdf128 = perfScene('perf-sdf-128', 'Perf SDF (N=128)', 128);

// ---- perf-sdf-cluster / perf-sdf-blob (the OVERLAP referee) -----------------
//
// THE QUESTION (Aug 10 2026, owner): is "an SDF is just a shape with a slow
// intersect" (per-object boxed marching, no combined SDF scene at all) ever worse
// than today's global min-march? The cost asymmetry is exact:
//
//   global min-march — one walk of the ray, N field evaluations PER STEP, and no
//     way to skip empty space (it still steps through it, paying N each step).
//   per-object march — 1 evaluation per step and empty space skipped analytically
//     by the box test, but a stretch of ray covered by k boxes is walked k TIMES.
//
// So the shared loop can only win where boxes overlap deeply AND there is little
// empty space AND N is small enough that the per-step ×N stays cheap. perf-sdf-*
// above is the per-object home turf (objects spread apart). These two are the
// other end of the axis:
//
//   perf-sdf-cluster-N — the same shape mix packed into ONE fixed ball (radius
//     1.5) at N ∈ {8, 32, 128}, with the camera framing that ball identically at
//     every N. Screen coverage is constant while box-overlap depth grows with N,
//     so the ladder isolates the cost of re-walking shared stretches from the
//     benefit of skipping empty space.
//   perf-sdf-blob — the adversarial case, built to be the WORST geometry for
//     per-object marching: 6 mutually interpenetrating shapes in one lump, camera
//     close and level with it so the lump fills the frame at grazing incidence.
//     Minimal empty space to skip, maximal re-walking, N small enough that the
//     global march's per-step ×6 is nearly free. If the shared loop wins anywhere,
//     it wins here — and if it does NOT win here, the architecture question is
//     settled in favour of "shape with a slow intersect".

/** Deterministic point in a ball — uniform in volume (cbrt) so packing density is
 *  what the fixture says it is. */
function ballPoint(rand: () => number, R: number, c: [number, number, number]): [number, number, number] {
    const r = R * Math.cbrt(rand());
    const ct = 2 * rand() - 1, ph = 2 * Math.PI * rand();
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    return [c[0] + r * st * Math.cos(ph), c[1] + r * ct, c[2] + r * st * Math.sin(ph)];
}

/** The shared shape mix (box / cylinder / sphere cycling) — identical to the
 *  spread fixtures, so packing is the ONLY variable across the two ladders. */
function pushSdfShape(
    objects: SceneDescription['objects'], i: number, pos: [number, number, number],
    rot: { axis: [number, number, number]; angle: number }, s: number, material: string, size: number,
): void {
    const kind = i % 3;
    if (kind === 0) {
        objects.push({ type: 'box', parameters: { halfSize: [0.3 * size, 0.45 * size, 0.3 * size] }, material, backend: 'sdf', transform: { position: pos, rotation: rot, scale: s } });
    } else if (kind === 1) {
        objects.push({ type: 'cylinder', parameters: { radius: 0.28 * size, halfHeight: 0.5 * size }, material, backend: 'sdf', transform: { position: pos, rotation: rot, scale: s } });
    } else {
        objects.push({ type: 'sphere', parameters: { radius: 0.35 * size }, material, backend: 'sdf', transform: { position: pos, scale: s } });
    }
}

const CLUSTER_CENTER: [number, number, number] = [0, 1.8, 0];

/** N shapes packed into the fixed ball — box overlap grows with N, framing does not. */
function clusterObjects(n: number, seed: number): SceneDescription['objects'] {
    const rand = lcg(seed);
    const objects: SceneDescription['objects'] = [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 }, material: 'floor' },
    ];
    const mats = ['red', 'blue', 'tan'];
    for (let i = 0; i < n; i++) {
        const pos = ballPoint(rand, 1.5, CLUSTER_CENTER);
        const rot = { axis: [rand() - 0.5, 1, rand() - 0.5] as [number, number, number], angle: rand() * Math.PI };
        pushSdfShape(objects, i, pos, rot, 0.5 + rand() * 0.7, mats[i % 3], 1);
    }
    return objects;
}

/** The adversarial lump: 6 oversized shapes inside a 0.3-radius ball — every box
 *  covers essentially every other, and the shapes genuinely interpenetrate. */
function blobObjects(seed: number): SceneDescription['objects'] {
    const rand = lcg(seed);
    const objects: SceneDescription['objects'] = [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 }, material: 'floor' },
    ];
    const mats = ['red', 'blue', 'tan'];
    for (let i = 0; i < 6; i++) {
        const pos = ballPoint(rand, 0.3, [0, 1.0, 0]);
        const rot = { axis: [rand() - 0.5, 1, rand() - 0.5] as [number, number, number], angle: rand() * Math.PI };
        pushSdfShape(objects, i, pos, rot, 0.9 + rand() * 0.3, mats[i % 3], 1.6);
    }
    return objects;
}

const clusterScene = (id: string, name: string, n: number): SceneDescription => ({
    id, name,
    ambientSpace: { type: 'euclidean' },
    objects: clusterObjects(n, 20260810),
    materials: twinMaterials(),
    lights: [{ kind: 'point', position: [4, 8, 4], emission: 160 }],
    environment: { type: 'constant', color: [0.09, 0.09, 0.11] },
});

export const perfSdfCluster8 = clusterScene('perf-sdf-cluster-8', 'Perf SDF cluster (N=8)', 8);
export const perfSdfCluster32 = clusterScene('perf-sdf-cluster-32', 'Perf SDF cluster (N=32)', 32);
export const perfSdfCluster128 = clusterScene('perf-sdf-cluster-128', 'Perf SDF cluster (N=128)', 128);

export const perfSdfBlob: SceneDescription = {
    id: 'perf-sdf-blob', name: 'Perf SDF blob (N=6, interpenetrating)',
    ambientSpace: { type: 'euclidean' },
    objects: blobObjects(20260810),
    materials: twinMaterials(),
    lights: [{ kind: 'point', position: [3, 5, 3], emission: 90 }],
    environment: { type: 'constant', color: [0.09, 0.09, 0.11] },
};
