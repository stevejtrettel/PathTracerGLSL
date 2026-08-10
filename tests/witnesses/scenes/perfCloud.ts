// tests/witnesses/scenes/perfCloud.ts — the durable acceleration-structure perf
// fixture (impl-plan-placement-fold, the perf-witness arm).
//
// A tracked, PROCEDURAL 200k-sphere cloud (seeded LCG → PackedPlacements built at
// module load — no .inst file, no repo bloat) sized so traversal dominates shading:
// primary rays walk a ~200k-leaf TLAS and nee shadow rays walk it again through the
// any-hit arm. Two arms differing ONLY in placement-record tier: default (1-texel
// folded params) vs the `placementRecord: 'frame'` pin (2-texel rigid records) — the
// ms/frame delta between adjacent perf rows IS the tier's bandwidth win. Future accel
// occupants (wide/compressed BVH nodes) add strategy arms here and gate on the same
// numbers.
//
// Perf entries are report-only and run ONLY under `npm run witness -- --perf`
// (real GPU — see tools/witness.mjs); they are excluded from the numeric sweep.

import type { SceneDescription, RenderStrategy, PackedPlacements, InstancedObject } from '../../../src/compiler/types.js';
import { withPose } from '../../../src/authoring/strategy.js';

export const PERF_CLOUD_COUNT = 200_000;

/** Seeded uniform cloud in a 16-unit cube, radii 0.02–0.07 (world units — ≥ the 0.01
 *  ray-spawn floor). Deterministic: the same bytes every load, so runs compare. */
function makeCloud(n: number): PackedPlacements {
    let s = 20260809 >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const positions = new Float32Array(3 * n);
    const sizes = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        positions[3 * i] = (rnd() * 2 - 1) * 8;
        positions[3 * i + 1] = (rnd() * 2 - 1) * 8;
        positions[3 * i + 2] = (rnd() * 2 - 1) * 8;
        sizes[i] = 0.02 + rnd() * 0.05;
    }
    return { count: n, positions, sizes };
}

const placements = makeCloud(PERF_CLOUD_COUNT);

const materials: SceneDescription['materials'] = {
    ball: { model: 'lambert', albedo: [0.62, 0.55, 0.45] },
};
const lights: SceneDescription['lights'] = [{ kind: 'point', position: [20, 24, 18], emission: 2000 }];
const environment: SceneDescription['environment'] = { type: 'constant', color: [0.35, 0.42, 0.55], intensity: 1.0 };

const cloudObject = (record?: 'frame'): InstancedObject => ({
    kind: 'instanced',
    prototype: { type: 'sphere', parameters: { radius: 1 }, material: 'ball' },
    placements,
    name: 'cloud',
    ...(record !== undefined ? { placementRecord: record } : {}),
});

export const perfCloud: SceneDescription = {
    id: 'perf-cloud',
    name: 'Perf Cloud (200k spheres, params tier)',
    ambientSpace: { type: 'euclidean' },
    objects: [cloudObject()],
    materials, lights, environment,
};

export const perfCloudFrame: SceneDescription = {
    id: 'perf-cloud-frame',
    name: 'Perf Cloud (200k spheres, frame tier pinned)',
    ambientSpace: { type: 'euclidean' },
    objects: [cloudObject('frame')],
    materials, lights, environment,
};

const base: RenderStrategy = {
    id: 'pathtracer',
    measurement: { camera: { type: 'pinhole', fov: 0.9 }, maxBounces: 3 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 2 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
export const perfCloudStrategy: RenderStrategy = withPose(base, [16, 11, 16], [0, 0, 0]);

/** The CWBVH verdict arm (fable-accel-cwbvh §7): same scene, same pose, compressed
 *  8-wide quantized nodes — the adjacent perf row IS the experiment's outcome
 *  (go/no-go at ≥ 1.15× vs the binary params-tier median). */
export const perfCloudCwbvhStrategy: RenderStrategy = {
    ...perfCloudStrategy,
    id: 'pathtracer-cwbvh',
    estimator: { ...perfCloudStrategy.estimator, instanceAccel: 'cwbvh' },
};
