// tests/witnesses/scenes/roughDielectricWitness.ts — the rough-dielectric numeric gates
// (docs/fable-rough-dielectric.md §5; build record impl-plan-rough-dielectric.md T3).
//
//   rough-smooth-limit — the α → 0 TREND gate: rough glass at roughness 0.02 on the
//                        F-ETA geometry must reproduce the smooth dielectric's 0.5540.
//                        A trend gate, not an exact twin: the α floor makes true 0
//                        unreachable, and the model is single-scattering (G1 < 1).
//   rough-mis          — the X-GLASS pattern on the new model: nee ≡ mis over a
//                        two-lobe non-delta BSDF (the pdf's F-weighted lobe split and
//                        the stored-query replay in one number) + the pt tripwire.
//   glass-inclusion    — THE §3 POLICY GATE. An emitter INSIDE the glass is the one
//                        configuration where far-side NEE survives the
//                        `opaque-dielectrics` shadow truncation, so it is the only
//                        place the light tree's below-horizon cull can zero a REAL
//                        contribution. Two lights (one inside, one outside) — a
//                        single-light tree would never call the importance at all.
//                        Without the two-sided query the bvh+nee arm loses the
//                        inclusion's direct term entirely (bias, not noise).
//   rough-furnace      — W-ENERGY: three frosted spheres in a white furnace. A
//                        lossless BSDF is INVISIBLE against a uniform field; the
//                        measured darkening IS the single-scattering energy loss, and
//                        recording it is what makes §6's declaration checkable.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';

// ---------------------------------------------------------------------------
// W-SMOOTH-LIMIT — the F-ETA geometry with the rough model at roughness 0.02.
// Twin of the `eta` witness: same 0.5540 center pixel (validation §3), reached
// through the microfacet transmission lobe instead of the delta branch.
// ---------------------------------------------------------------------------

export const roughSmoothLimit: SceneDescription = {
    id: 'rough-smooth-limit',
    name: 'Rough dielectric — smooth limit (F-ETA twin)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 }, material: 'water' },
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 }, material: 'glow' },
    ],
    materials: {
        // ior 1.33 exactly as F-ETA: R₀ = 0.020053, throughput (1−R₀)/1.33² = 0.5540.
        water: { model: 'rough_dielectric', ior: 1.33, roughness: 0.02 },
        glow: { model: 'lambert', albedo: [0, 0, 0], emission: [1.0, 1.0, 1.0] },
    },
    lights: [],
};

export const roughSmoothLimitStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: { camera: { type: 'pinhole', fov: 0.6 }, maxBounces: 4 },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};

// ---------------------------------------------------------------------------
// W-ROUGH-MIS — frosted glass sphere under a samplable panel (the X-GLASS pattern).
// ---------------------------------------------------------------------------

export const roughMis: SceneDescription = {
    id: 'rough-mis',
    name: 'Rough glass under a panel (X-GLASS pattern)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', name: 'ground', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor' },
        {
            type: 'sphere', name: 'frosted',
            parameters: { center: [0, 0.85, 0], radius: 0.55 },
            material: 'roughglass',
        },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.45, 0.43, 0.4] },
        // Roughness 0.25 (α = 0.0625): visibly frosted, but not so wide that the pt arm
        // never finds the panel through it.
        roughglass: { model: 'rough_dielectric', ior: 1.5, roughness: 0.25, transmittance: [0.95, 0.97, 0.95] },
    },
    lights: [
        { kind: 'quad', corner: [-0.8, 2.6, -0.8], edge1: [1.6, 0, 0], edge2: [0, 0, 1.6], emission: 10 },
    ],
    environment: { type: 'constant', color: [0.1, 0.12, 0.15], intensity: 1.0 },
};

const misBase = {
    measurement: { camera: { type: 'pinhole' as const, fov: 0.8 }, maxBounces: 8 },
    view: { tonemap: { type: 'agx' as const } },
};

export const roughMisNeeStrategy: RenderStrategy = {
    id: 'pt-nee', ...misBase,
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' } },
};
export const roughMisMisStrategy: RenderStrategy = {
    id: 'pt-mis', ...misBase,
    estimator: { directLighting: 'mis', russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' } },
};
export const roughMisPtStrategy: RenderStrategy = {
    id: 'pt', ...misBase,
    estimator: { directLighting: 'none', russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' } },
};

// ---------------------------------------------------------------------------
// W-GLASS-INCLUSION — the two-sided-query gate (fable-rough-dielectric §3.2).
//
// The glowing core sits ENTIRELY below the tangent plane of every point on the glass
// sphere's outer surface, and its shadow ray never leaves the glass — so it is visible
// to NEE through the transmission lobe. A one-sided query culls it (importance 0 ⇒ pmf
// 0), and under nee-only there is no MIS weight to carry the term: the core's direct
// contribution simply vanishes. The outside lamp is not decoration — with a single
// light the tree is one leaf and the descent never calls the importance function.
// ---------------------------------------------------------------------------

export const glassInclusion: SceneDescription = {
    id: 'glass-inclusion',
    name: 'Glowing core in rough glass (two-sided NEE gate)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', name: 'ground', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor' },
        {
            type: 'sphere', name: 'shell',
            parameters: { center: [0, 1.0, 0], radius: 0.7 },
            material: 'roughglass',
        },
        // The inclusion: nested INSIDE the glass (innermost-wins gives it its own region).
        {
            type: 'sphere', name: 'core',
            parameters: { center: [0, 1.0, 0], radius: 0.16 },
            material: 'core',
        },
        // The outside lamp — the tree's second leaf, above the horizon everywhere the
        // core is below it.
        {
            type: 'sphere', name: 'lamp',
            parameters: { center: [1.5, 2.2, 0.6], radius: 0.14 },
            material: 'lamp',
        },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.4, 0.4, 0.42] },
        roughglass: { model: 'rough_dielectric', ior: 1.5, roughness: 0.2 },
        core: { model: 'lambert', albedo: [0, 0, 0], emission: [40, 26, 12] },
        lamp: { model: 'lambert', albedo: [0, 0, 0], emission: [18, 20, 24] },
    },
    lights: [],
    environment: { type: 'constant', color: [0.02, 0.02, 0.03], intensity: 1.0 },
};

const inclusionBase = {
    measurement: { camera: { type: 'pinhole' as const, fov: 0.8 }, maxBounces: 10 },
    view: { tonemap: { type: 'agx' as const } },
};

/** nee × power — the reference arm: orientation-free selection, no cull anywhere. */
export const inclusionNeePowerStrategy: RenderStrategy = {
    id: 'pt-nee-power', ...inclusionBase,
    estimator: {
        directLighting: 'nee', lightSelection: 'power',
        russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' },
    },
};
/** nee × bvh — THE gate: the tree's horizon cull must disarm at the glass. */
export const inclusionNeeBvhStrategy: RenderStrategy = {
    id: 'pt-nee-bvh', ...inclusionBase,
    estimator: {
        directLighting: 'nee', lightSelection: 'bvh',
        russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' },
    },
};
/** mis × bvh — the stored-query replay: the pmf must see the SAME two-sided context. */
export const inclusionMisBvhStrategy: RenderStrategy = {
    id: 'pt-mis-bvh', ...inclusionBase,
    estimator: {
        directLighting: 'mis', lightSelection: 'bvh',
        russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' },
    },
};
export const inclusionPtStrategy: RenderStrategy = {
    id: 'pt', ...inclusionBase,
    estimator: { directLighting: 'none', russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' } },
};

// ---------------------------------------------------------------------------
// rough-grin / rough-grin-ref — the ROUGH × GRIN twin (grinWitness.ts's hard-interface
// pattern, pointed at the new model). A constant-FORMULA medium ior on a ROUGH wall
// routes the whole GRIN pipeline — entry Fresnel through ior_of(region, p), the Verlet
// walker on a straight line (∇n = 0), the inside-exit handoff, exit Fresnel/TIR, the
// interior L/n² factor — and must converge to the same image as a plain `ior: 1.5`
// rough dielectric. This exists because rough_dielectric reads its IORs through the
// SAME ior_of(region, p) seam the smooth model does, which is the claim under test:
// nothing about the microfacet lobes should care where the index came from.
// ---------------------------------------------------------------------------

const roughGrinBase = (viaGrin: boolean): SceneDescription => ({
    id: viaGrin ? 'rough-grin' : 'rough-grin-ref',
    name: viaGrin ? 'Rough × GRIN twin (constant formula through the walker)' : 'Rough × GRIN twin reference (region-table ior)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor', name: 'floor' },
        { type: 'sphere', parameters: { center: [0, 1, -2.5], radius: 0.8 }, material: 'red', name: 'backdrop' },
        { type: 'sphere', parameters: { center: [0, 1, 0], radius: 0.75 }, material: 'glass', name: 'ball' },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.6, 0.6, 0.6] },
        red: { model: 'lambert', albedo: [0.7, 0.15, 0.1] },
        glass: viaGrin
            ? { model: 'rough_dielectric', roughness: 0.15, medium: { ior: 1.5 } }   // the ONE ior truth: the medium's field
            : { model: 'rough_dielectric', roughness: 0.15, ior: 1.5 },              // classic region-table constant
    },
    lights: [
        { kind: 'quad', corner: [-2, 4, -2], edge1: [4, 0, 0], edge2: [0, 0, 4], emission: [5, 5, 5] },
    ],
    environment: { type: 'constant', color: [0.18, 0.2, 0.28], intensity: 1.0 },
});

export const roughGrin = roughGrinBase(true);
export const roughGrinRef = roughGrinBase(false);

/** pt: the twin isolates routing/plumbing, not estimator policy. The GRIN arm spends an
 *  extra bounce per interior traversal, so the budget carries headroom (grinWitness's rule). */
export const roughGrinStrategy: RenderStrategy = {
    id: 'pt',
    measurement: { camera: { type: 'pinhole', fov: 0.9 }, maxBounces: 14 },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'agx' } },
};

// ---------------------------------------------------------------------------
// W-ENERGY — the white furnace: three roughnesses in one frame.
//
// In a uniform radiance field an energy-preserving BSDF is INVISIBLE (every direction
// returns the same L), so the background reads exactly 1.0 and each sphere reads
// 1.0 − (its single-scattering loss). The three spheres are placed to fall in three
// horizontal thirds of the frame; the check regions read their centers.
// ---------------------------------------------------------------------------

export const roughFurnace: SceneDescription = {
    id: 'rough-furnace',
    name: 'Rough glass white furnace (W-ENERGY)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'sphere', name: 'r005', parameters: { center: [-1.6, 0, 0], radius: 0.6 }, material: 'g005' },
        { type: 'sphere', name: 'r02', parameters: { center: [0, 0, 0], radius: 0.6 }, material: 'g02' },
        { type: 'sphere', name: 'r05', parameters: { center: [1.6, 0, 0], radius: 0.6 }, material: 'g05' },
    ],
    materials: {
        g005: { model: 'rough_dielectric', ior: 1.5, roughness: 0.05 },
        g02: { model: 'rough_dielectric', ior: 1.5, roughness: 0.2 },
        g05: { model: 'rough_dielectric', ior: 1.5, roughness: 0.5 },
    },
    lights: [],
    // THE furnace: uniform incident radiance 1.0 from every direction.
    environment: { type: 'constant', color: [1, 1, 1], intensity: 1.0 },
};

export const roughFurnaceStrategy: RenderStrategy = {
    id: 'furnace',
    measurement: {
        camera: { type: 'pinhole', fov: 0.9 },
        // Generous: a rough sphere's internal path can take many crossings, and
        // TRUNCATION would masquerade as energy loss — the one confound this
        // measurement must not have.
        maxBounces: 24,
    },
    estimator: {
        directLighting: 'none',      // the env is the only source; path-found only
        russianRoulette: null,       // RR's variance would swamp a few-percent number
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};
