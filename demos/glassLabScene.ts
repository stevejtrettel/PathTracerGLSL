// demos/glassLabScene.ts — THE GLASS EXPERIMENT BENCH.
//
// One scene, the glass variables on separate dials. This bench earned its keep the
// night it was built: it separated dark-spot truncation from ring artifacts, then
// exonerated normals/refinement/epsilons one arm at a time until the real bug fell
// out (a non-conservative field step — fable-sdf-contract §4's conservativeness law,
// whose gate + sign-tracked marching now guard the whole class).
//
//   KEYS 1-4 — PATH LENGTH: identical estimators at maxBounces 4 / 8 / 16 / 32.
//              Dark patches that BRIGHTEN with higher keys = path truncation (paths
//              dying inside the glass — a solid with many internal interfaces wants
//              16+; the spheres-era default of 8 is too short here).
//   LEFT vs RIGHT — TWO FIELD CONSTRUCTIONS in the same glass: the quartic tangle
//              SOLID (value/gradient/Hessian envelope — the variety-port form) vs
//              the gyroid SHELL (global gradient-bound divide, thin double-walled
//              lattice). Different estimate styles, different feature scales — an
//              artifact on one and not the other localizes to its construction.
//   THE SPHERE — the EXACT control: closed-form intersection, analytic normal, no
//              field anywhere in its paths. Artifacts it shares with the others are
//              transport (Fresnel/TIR/truncation); artifacts it lacks are field or
//              marching. (The solo-sphere version of this control is what finally
//              cornered the tangle's ring bug.)
//   ior SLIDER — TIR STRENGTH, live (1.05-2.0): total internal reflection multiplies
//              with the index, amplifying everything path-length-related.
//   THE FROSTED TWIN — the rough dielectric on the same ior dial and the same ruby
//              interior as the exact control, with its own live `glass.roughness`
//              slider: the smooth/rough pair as a controlled comparison. Roughness is
//              the third mechanism (with absorption and dispersion) that suppresses
//              idealized-specular structure; the two front spheres show it isolated.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';
import { tangle } from '../tests/witnesses/scenes/customFieldWitness.js';
import { gyroid } from './customFieldsScene.js';

export const glassLabScene: SceneDescription = {
    id: 'glass-lab',
    name: 'Glass lab (bounces × field construction × geometry × ior)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        {
            type: 'plane',
            name: 'ground',
            parameters: { normal: [0, 1, 0], offset: 0 },
            material: 'floor',
        },
        {
            type: tangle,          // quartic SOLID — the (f, ∇f, H) envelope estimate
            name: 'quartic',
            parameters: { size: 0.26, shape: 11.8 },
            material: 'glass',
            transform: { position: [-0.85, 0.75, 0], rotation: { axis: [1, 0, 1], angle: 0.45 } },
        },
        {
            type: gyroid,          // lattice SHELL — global-bound estimate, thin walls
            name: 'lattice',
            parameters: { radius: 0.42, cell: 0.42, thickness: 0.014 },
            material: 'glass',
            transform: { position: [0.85, 0.75, 0], rotation: { axis: [0, 1, 0], angle: 0.5 } },
        },
        {
            type: 'sphere',        // the closed-form control: no field, no marching
            name: 'control',
            parameters: { radius: 0.4 },
            material: 'glass',
            transform: { position: [0, 0.4, 1.1] },
        },
        {
            type: 'sphere',        // the ROUGH twin of the control — identical in every
            name: 'frosted',       // other respect (same ior dial, same ruby interior)
            parameters: { radius: 0.34 },
            material: 'roughglass',
            transform: { position: [0.95, 0.34, 1.25] },
        },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.45, 0.43, 0.4] },
        // RUBY: absorbing interior (Beer–Lambert — the homogeneous-media machinery).
        // σ_a kills green/blue over the ~0.3-unit chords → deep red transmission; it
        // ALSO exponentially kills long TIR chains, which is exactly how real colored
        // glass suppresses the many-bounce families this bench exists to study —
        // watch the key-1→4 truncation difference shrink relative to clear glass.
        glass: {
            model: 'dielectric',
            ior: { param: 'glass.ior', default: 1.5, min: 1.05, max: 2.0 },
            albedo: [0.98, 0.98, 0.98],
            medium: { sigma_a: [0.3, 5.0, 7.0] },
        },
        // The rough control's material: the SAME ior dial and the SAME ruby interior,
        // so the only variable between the two front spheres is microroughness. The
        // dial is live (fable-rough-dielectric §5) — turn it up and watch the mirror-
        // sharp caustics and TIR chains soften into frost, which is the third physical
        // mechanism (with absorption and dispersion) that keeps real glass from showing
        // the idealized-specular structure this bench was built to hunt.
        roughglass: {
            model: 'rough_dielectric',
            ior: { param: 'glass.ior', default: 1.5, min: 1.05, max: 2.0 },
            roughness: { param: 'glass.roughness', default: 0.12, min: 0.0, max: 0.6 },
            transmittance: [0.98, 0.98, 0.98],
            medium: { sigma_a: [0.3, 5.0, 7.0] },
        },
    },
    lights: [
        {
            kind: 'quad',
            corner: [-1.0, 2.8, -1.0], edge1: [2.0, 0, 0], edge2: [0, 0, 2.0],
            emission: 9,
        },
    ],
    environment: { type: 'constant', color: [0.12, 0.14, 0.18], intensity: 1.0 },
};

const bounces = (n: number): RenderStrategy => ({
    id: `b${n}`,
    measurement: { camera: { type: 'pinhole', fov: 0.85 }, maxBounces: n },
    estimator: {
        directLighting: 'mis',
        russianRoulette: { startDepth: 6 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'agx' } },
});

export const glassLabStrategies: RenderStrategy[] = [bounces(4), bounces(8), bounces(16), bounces(32)];
