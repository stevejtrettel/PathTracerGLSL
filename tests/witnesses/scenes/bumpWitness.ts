// tests/witnesses/scenes/bumpWitness.ts — the bump-mapping gates (materials/README,
// "Shading-normal perturbation").
//
// Both fixtures use the height field h(p) = p.x on a surface whose outward normal is +y, so the
// bumped outward normal is n'_out = (−1, 1, 0)/√2: a constant 45° tilt toward −x. The field is
// linear, so the central differences are exact up to float rounding.
//
//   bump-tilt  — a Lambert plane (ρ = 0.4) at y = 0 under a constant samplable sky L = 1. The
//                shading normal is tilted 45° from the true normal; the BSDF is masked to the
//                directions above BOTH (the ng mask), so the plane reads the lune
//                    ρ·L·(1 + cos 45°)/2 = 0.4·(1 + 1/√2)/2 = 0.341421
//                for EVERY view direction. The camera sits at +x looking toward −x, so the near
//                rows (view steeper than 45°) see n' unflipped and the far rows (shallower) see
//                it flipped (wo·n' ≤ 0, mirrored across the true normal). An emitting plane just
//                below (radiance L_b = 2, not sampled as a light, so every estimator finds it on
//                BSDF rays) is what every direction below the surface reaches; the correct BSDF
//                never reaches it. Each missing step reads a different value:
//                  ρ(1+cos45°)/2 + ρ·L_b·(1−cos45°)/2 = 0.458579 — the mask is missing (or tests
//                      the perturbed normal instead of ng): the lobe's below-surface directions
//                      reach the emitter;
//                  ρ(1+cos45°)/2·L_b = 0.682843 — in the far rows only: the flip is missing (the
//                      lobe around −n' keeps only its below-surface directions).
//                A black plane would hide the mask (0 in place of L_b gives the lune again), and
//                no plane would hide the flip (the antipodal lune reaches the same sky).
//                The Lambert integral is symmetric under mirroring n', so a gradient SIGN error
//                passes here; bump-sides catches it.
//   bump-sides — two thin quads with normal +y and the same bump. The camera (between them) sees
//                quad A's front from above and quad B's back from below. Directional light 1
//                propagates along (1,−1,0)/√2, light 2 along (−1,1,0)/√2, each with E = π, so a
//                Lambert surface reads ρ·cos against the light. Correct shading normals:
//                A front n' = (−1,1,0)/√2 faces light 1 head-on → ρ; B back n' = (1,−1,0)/√2
//                faces light 2 head-on → ρ. Each quad sees only one light (the other arrives
//                from below its true surface and is masked). Failures read differently:
//                  ρ/√2 — no bump at all;
//                  0    — B back with the wrong σ (the relief inverted when seen from behind);
//                  0    — A front with the gradient sign flipped.
//                The shadow rays toward each light miss the other quad (light 1 leaves A's
//                points at x − 2 ≤ −1.25 when it reaches y = 1; light 2 leaves B's at x + 2 ≥ 1.25).
//                maxBounces 1: direct light only, so the light A sends up to B's back is outside
//                the measurement.
//
// Witness protocol: RR off; tonemap none (values read off the linear picture).

import type { SceneDescription, RenderStrategy, MaterialDescription } from '../../../src/compiler/types.js';

const RHO = 0.4;
/** The radiance of bump-tilt's emitter below the surface (L_b): any value but 1 and 0 keeps the
 *  three outcomes in the header apart. */
const BELOW_RADIANCE = 2;

/** The tilt shared by both fixtures: h = p.x, a 45° slope. The step only has to be small next
 *  to the scene (|p| ≤ ~10 here): for a linear field there is no truncation error. */
const bumped = (): MaterialDescription => ({
    model: 'lambert',
    albedo: RHO,
    bump: { height: { kind: 'glsl', source: 'p.x' }, step: 0.01 },
});

export const bumpTiltScene: SceneDescription = {
    id: 'bump-tilt',
    name: 'Bump tilt (45° lune under a unit sky)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'tilted' },
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.01 }, material: 'below' },
    ],
    materials: {
        tilted: bumped(),
        below: { model: 'lambert', albedo: 0, emission: BELOW_RADIANCE, sampleAsLight: false },
    },
    lights: [],
    environment: { type: 'constant', color: 1, intensity: 1.0, sampleAsLight: true },
};

const tiltBase: RenderStrategy = {
    id: 'pt',
    measurement: { camera: { type: 'pinhole', fov: 1.2 }, maxBounces: 4 },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'none' } },
};
export const bumpTiltPtStrategy: RenderStrategy = tiltBase;
export const bumpTiltNeeStrategy: RenderStrategy = { ...tiltBase, id: 'pt-nee', estimator: { ...tiltBase.estimator, directLighting: 'nee' } };
export const bumpTiltMisStrategy: RenderStrategy = { ...tiltBase, id: 'pt-mis', estimator: { ...tiltBase.estimator, directLighting: 'mis' } };
export const bumpTiltSpectralStrategy: RenderStrategy = {
    ...tiltBase,
    id: 'spectral-nee',
    measurement: { ...tiltBase.measurement, color: 'spectral' },
    estimator: { ...tiltBase.estimator, directLighting: 'nee', wavelengths: 'visible' },
};

/** The lune value ρ(1 + cos 45°)/2. */
export const BUMP_TILT_VALUE = RHO * (1 + Math.SQRT1_2) / 2;

/** Camera at (2, 2, 0) looking at (−2, 0, 0) with fov 1.2 (tan of the half angle 0.684): the
 *  ground line x = 0, where the view is exactly 45°, lies at row fraction 0.256, and the
 *  horizon at 0.866. Rows below 0.256 are unflipped, rows between it and the horizon flipped. */
export const BUMP_TILT_POSE = { position: [2, 2, 0] as [number, number, number], target: [-2, 0, 0] as [number, number, number] };
export const BUMP_TILT_REGIONS = {
    unflipped: { x: 0.05, y: 0.03, w: 0.9, h: 0.17 },
    flipped: { x: 0.05, y: 0.32, w: 0.9, h: 0.38 },
    sky: { x: 0.05, y: 0.9, w: 0.9, h: 0.08 },
};

export const bumpSidesScene: SceneDescription = {
    id: 'bump-sides',
    name: 'Bump seen from both sides (two lights)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        // edge1 × edge2 = (0,0,4) × (1.5,0,0) = (0, 6, 0): both quads face +y.
        { type: 'quad', parameters: { corner: [-0.75, -1, -2], edge1: [0, 0, 4], edge2: [1.5, 0, 0] }, material: 'a' },
        { type: 'quad', parameters: { corner: [-0.75, 1, -2], edge1: [0, 0, 4], edge2: [1.5, 0, 0] }, material: 'b' },
    ],
    materials: { a: bumped(), b: bumped() },
    lights: [
        { kind: 'directional', direction: [Math.SQRT1_2, -Math.SQRT1_2, 0], emission: Math.PI },
        { kind: 'directional', direction: [-Math.SQRT1_2, Math.SQRT1_2, 0], emission: Math.PI },
    ],
    environment: { type: 'none' },
};

const sidesBase: RenderStrategy = {
    id: 'pt-nee',
    measurement: { camera: { type: 'pinhole', fov: 2 * Math.atan(0.6) }, maxBounces: 1 },
    estimator: { directLighting: 'nee', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'none' } },
};
export const bumpSidesNeeStrategy: RenderStrategy = sidesBase;
export const bumpSidesMisStrategy: RenderStrategy = { ...sidesBase, id: 'pt-mis', estimator: { ...sidesBase.estimator, directLighting: 'mis' } };

/** Camera at (0, 0, 4) looking at the origin, tan of the half angle 0.6. Quad A (y = −1,
 *  z ∈ [−2, 2]) spans rows 0.083–0.361 and quad B rows 0.639–0.917; the columns 0.38–0.62 lie
 *  on both quads over the checked rows. The pixels are noisy although each light is a delta:
 *  NEE picks one of the two lights per sample (probability 1/2 each), and only one of them
 *  lights a given quad, so a sample reads 2ρ or 0. */
export const BUMP_SIDES_POSE = { position: [0, 0, 4] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
export const BUMP_SIDES_REGIONS = {
    aFront: { x: 0.38, y: 0.12, w: 0.24, h: 0.2 },
    bBack: { x: 0.38, y: 0.68, w: 0.24, h: 0.2 },
};
export const BUMP_SIDES_VALUE = RHO;
