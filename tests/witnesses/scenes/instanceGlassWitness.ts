// tests/witnesses/scenes/instanceGlassWitness.ts — instanced DIELECTRICS
// (impl-plan-instanced-containment §5).
//
// The gate is a cross-scene TWIN in every case, and it is unusually sharp: before this
// batch, an instanced glass object had no interior at all, so ior_of fell to 1.0 and the
// batch refracted at η = 1 — i.e. it looked like clear air with a Fresnel sheen. Any
// regression to that state diverges from the individually-authored reference on the
// FIRST bounce, everywhere the glass is on screen. There is no subtle failure mode here.
//
//   instance-glass ⇄ instance-glass-ref     the params tier (folded world spheres)
//   instance-glass-mesh ⇄ …-ref             the frame tier + a closed MESH prototype:
//                                           the three-tier query (local box →
//                                           first-hit-facing → closest triangle) run
//                                           per instance in its own conjugated frame
//   instance-fog ⇄ instance-fog-ref         the interior as a MEDIUM region, not just an
//                                           ior: proves current_medium tracking enters
//                                           and leaves instanced volumes correctly
//   perf-instance-glass / -opaque           the bounce ladder + the glass-vs-opaque cost row

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';
import { instance } from '../../../src/authoring/instance.js';
import { boxMesh } from './meshWitness.js';

const PLACEMENTS = [
    { position: [-1.1, 0.55, 0.0] as [number, number, number], scale: 1.0 },
    { position: [0.15, 0.75, -0.2] as [number, number, number], scale: 1.3 },
    { position: [1.25, 0.5, 0.25] as [number, number, number], scale: 0.85 },
];

const floor = { type: 'quad', parameters: { corner: [-6, 0, -6], edge1: [0, 0, 12], edge2: [12, 0, 0] }, material: 'floor' };
// A patterned backdrop: refraction through the batch INVERTS it, so a η = 1 regression
// (which leaves the backdrop upright and unmagnified) is unmissable rather than subtle.
const backdrop = { type: 'sphere', parameters: { center: [0, 1.1, -2.6], radius: 0.9 }, material: 'red' };

const common = {
    materials: {
        floor: { model: 'lambert', albedo: [0.55, 0.55, 0.58] },
        red: { model: 'lambert', albedo: [0.75, 0.18, 0.12] },
        // Real glass ABSORBS, faintly and unevenly — soda-lime glass is green from its
        // iron content, taking red hardest and green least. σ_a here is small enough to
        // be barely a tint through ONE sphere (~12% of red over a 0.6 crossing) and
        // unmistakable through a cluster (~90% of red over 10 units).
        //
        // This is not decoration: absorption is the PHYSICAL terminator. Perfectly clear
        // glass never dims a path, so nothing but the bounce cap ends it — which is how
        // truncation became visible as blackness here in the first place. A faintly
        // absorbing solid ends its own long internal-reflection chains, so the budget it
        // needs drops and the truncation goes with it. (The glass-lab ruby finding, at
        // ordinary-window strength.)
        glass: { model: 'dielectric', ior: 1.5, medium: { sigma_a: [0.22, 0.06, 0.10] } },
    } as SceneDescription['materials'],
    lights: [{ kind: 'quad', corner: [-1.5, 3.4, -1.5], edge1: [3, 0, 0], edge2: [0, 0, 3], emission: 9 }] as SceneDescription['lights'],
    environment: { type: 'constant', color: [0.12, 0.15, 0.22], intensity: 1.0 } as SceneDescription['environment'],
    ambientSpace: { type: 'euclidean' } as SceneDescription['ambientSpace'],
};

// ── params tier: a batch of glass spheres ───────────────────────────────────────

export const instanceGlass: SceneDescription = {
    id: 'instance-glass',
    name: 'Instanced glass (batch of spheres)',
    ...common,
    objects: [
        { ...floor }, { ...backdrop },
        instance({ type: 'sphere', parameters: { radius: 0.5 }, material: 'glass' }, PLACEMENTS),
    ],
};

export const instanceGlassRef: SceneDescription = {
    id: 'instance-glass-ref',
    name: 'Instanced glass reference (individual spheres)',
    ...common,
    objects: [
        { ...floor }, { ...backdrop },
        ...PLACEMENTS.map((p) => ({ type: 'sphere' as const, parameters: { radius: 0.5 }, material: 'glass', transform: p })),
    ],
};

// ── frame tier: a batch of closed glass MESH cubes ──────────────────────────────
// boxMesh is the witness corpus's welded, watertight cube — `closed: true` is what makes
// first-hit-facing valid, and it is now honoured on a PROTOTYPE (the rejection this batch
// deleted). Rotated placements force the frame tier and exercise the conjugation.

const MESH_PLACEMENTS = [
    { position: [-0.9, 0.45, 0.0] as [number, number, number], scale: 0.9, rotation: { axis: [0, 1, 0] as [number, number, number], angle: 0.5 } },
    { position: [0.9, 0.55, -0.3] as [number, number, number], scale: 1.1, rotation: { axis: [1, 0, 1] as [number, number, number], angle: 0.7 } },
];

const glassCube = { kind: 'mesh' as const, ...boxMesh(0.45, false), material: 'glass', closed: true };

export const instanceGlassMesh: SceneDescription = {
    id: 'instance-glass-mesh',
    name: 'Instanced glass mesh (closed cube prototype)',
    ...common,
    objects: [
        { ...floor }, { ...backdrop },
        instance(glassCube, MESH_PLACEMENTS),
    ],
};

export const instanceGlassMeshRef: SceneDescription = {
    id: 'instance-glass-mesh-ref',
    name: 'Instanced glass mesh reference (individual cubes)',
    ...common,
    objects: [
        { ...floor }, { ...backdrop },
        ...MESH_PLACEMENTS.map((p) => ({ ...glassCube, transform: p })),
    ],
};

// ── the interior as a MEDIUM ────────────────────────────────────────────────────
// A null-interface batch holding absorbing fog: containment here feeds current_medium,
// not ior_of, so it proves the interior is a REGION in the transport sense and not just
// a refraction-time lookup. Absorption makes the depth through each instance visible,
// which is exactly what a missing/incorrect interior would get wrong.

const fogCommon = {
    ...common,
    materials: {
        ...common.materials,
        fog: { model: 'none', medium: { sigma_a: [0.9, 0.5, 0.25] } },
    } as SceneDescription['materials'],
};

export const instanceFog: SceneDescription = {
    id: 'instance-fog',
    name: 'Instanced fog (medium inside a batch)',
    ...fogCommon,
    objects: [
        { ...floor }, { ...backdrop },
        instance({ type: 'sphere', parameters: { radius: 0.5 }, material: 'fog' }, PLACEMENTS),
    ],
};

export const instanceFogRef: SceneDescription = {
    id: 'instance-fog-ref',
    name: 'Instanced fog reference (individual spheres)',
    ...fogCommon,
    objects: [
        { ...floor }, { ...backdrop },
        ...PLACEMENTS.map((p) => ({ type: 'sphere' as const, parameters: { radius: 0.5 }, material: 'fog', transform: p })),
    ],
};

// ── strategies ──────────────────────────────────────────────────────────────────

// maxBounces 24, not the suite's usual 8-12: EVERY glass object costs at least two
// interfaces (enter + exit) before any TIR, and transmission carries weight ~1, so
// Russian roulette barely thins these paths — the budget, not RR, is what terminates
// them. Truncation reads as DARKENING, and in a cluster it reads as black (glass-lab's
// key-1→4 lesson: many-interface solids want 16+). The twin arms share the budget, so
// the gate is unaffected either way; this is about the image being honest.
export const instanceGlassStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 24 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};

/** The 'linear' accel arm — the A/B baseline keeps working through the containment scan
 *  (its walk has no TLAS texture, so the containment block is a linear loop instead of a
 *  point descent; the two must agree). */
export const instanceGlassLinearStrategy: RenderStrategy = {
    ...instanceGlassStrategy,
    id: 'pathtracer-linear',
    estimator: { ...instanceGlassStrategy.estimator, instanceAccel: 'linear' },
};

/** The RR survival CEILING as a checkable claim. Clear glass transmits at weight exactly
 *  1, so throughput never dims and this ceiling is the only thing ending the path: 0.95
 *  runs ~20 further bounces, 0.5 runs ~1. That is a 20× difference in path length, and
 *  the converged image must be IDENTICAL — survivors are divided by the same probability
 *  they survived with. This arm is what makes "unbiased" a number instead of an
 *  assurance, and it is the direct contrast with lowering maxBounces, which would move
 *  the mean (uncompensated truncation). Expect it noticeably noisier at equal spp — that
 *  IS the trade being bought. */
export const instanceGlassLowRRStrategy: RenderStrategy = {
    ...instanceGlassStrategy,
    id: 'pathtracer-lowrr',
    estimator: { ...instanceGlassStrategy.estimator, russianRoulette: { startDepth: 4, maxSurvival: 0.5 } },
};

// ── perf: what containment actually costs ───────────────────────────────────────
// The design gates the containment arm on the batch NEEDING an interior, on the claim
// that the probe is a real per-hit cost. These two rows are that claim as a number:
// the SAME 300-sphere batch, glass (arm emitted, TLAS point descent on every
// classification probe) vs opaque (no arm at all). Report-only, real GPU, read across
// the two rows — the perf-cloud pattern.

const PERF_COUNT = 300;
const perfPlacements = (() => {
    let s = 12345 >>> 0;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
    return Array.from({ length: PERF_COUNT }, () => ({
        position: [(rand() - 0.5) * 9, 0.35 + rand() * 2.2, (rand() - 0.5) * 9] as [number, number, number],
        scale: 0.5 + rand() * 0.7,
    }));
})();

const perfScene = (id: string, material: string): SceneDescription => ({
    id,
    name: `Perf: ${PERF_COUNT} instanced ${material === 'glass' ? 'GLASS' : 'opaque'} spheres`,
    ...common,
    objects: [
        { ...floor },
        instance({ type: 'sphere', parameters: { radius: 0.3 }, material }, perfPlacements),
    ],
});

export const perfInstanceGlass = perfScene('perf-instance-glass', 'glass');
export const perfInstanceOpaque = perfScene('perf-instance-opaque', 'red');

/** THE BOUNCE LADDER (glass-lab's keys 1-4, pointed at a cluster). maxBounces is the one
 *  knob that trades correctness for time — it truncates paths with no compensation, so
 *  its error is always one-directional (too dark) and never converges away. Roulette does
 *  NOT reduce that error: it pays killed paths forward into the survivors, so the energy
 *  lost at the cap is the same however the ceiling is set. The two knobs are independent,
 *  and only this one can make the picture wrong.
 *
 *  Which means the budget is a question about the SCENE, answerable only by measurement:
 *  raise it until the image stops changing. A cluster needs far more than a single solid
 *  (two interfaces per sphere CROSSED, not per object in view), which is exactly the
 *  intuition that fails silently — hence a ladder on the card instead of a chosen number.
 *  Keys 1/2/3 = 12/24/48: if 2 and 3 agree, 24 is enough and 48 is insurance. */
const perfBounces = (n: number): RenderStrategy => ({
    id: `perf-b${n}`,
    measurement: { camera: { type: 'pinhole', fov: 0.9 }, maxBounces: n },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
});

export const perfInstanceStrategy = perfBounces(48);
export const perfInstanceLadder: RenderStrategy[] = [perfBounces(12), perfBounces(24), perfBounces(48)];
