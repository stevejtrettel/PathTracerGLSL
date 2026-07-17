// tests/witnesses/scenes/ggxScenes.ts
// veach-mis — THE glossy MIS witness (Veach 1997 §9.3.1, adapted): four GGX plates of
// increasing roughness under three sphere lights of increasing radius at ~equal power
// (Le ∝ 1/r²). This is the regime the lambert/dielectric witnesses cannot reach — a
// peaked-but-non-delta pdf, where the power heuristic actually decides the image:
//   · small light + rough plate  → light sampling (T2) wins, kernel sampling fireflies
//   · big light + smooth plate   → kernel sampling (T1) wins, light sampling fireflies
// pt / pt-nee / pt-mis are three estimators of the SAME integral (§11.2): converged
// images must match; pt-mis must be visibly lowest-variance across ALL plate×light
// combinations. Divergence implicates ggx_pdf vs ggx_sample agreement (the §11.3
// triple), the sphere light's cone pdf, or the MIS weights at either scoring site.
// Plate normals are light↔camera bisectors (precomputed) so every highlight is visible.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';

export const veachMis: SceneDescription = {
    id: 'veach-mis',
    name: 'Veach MIS (GGX plates + sphere lights)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        // The four plates, top (smoothest) → bottom (roughest). corner/edge1 from the
        // bisector construction; edge1 = depth (0.4, tilted in yz), edge2 = width (x) —
        // cross(edge1, edge2) faces up toward lights and camera.
        {
            type: 'quad', parameters: { corner: [-1.8, 1.113, -0.54], edge1: [0.0, -0.125, 0.38], edge2: [3.6, 0.0, 0.0] },
            material: 'plate1',
        },
        {
            type: 'quad', parameters: { corner: [-1.8, 0.769, 0.156], edge1: [0.0, -0.099, 0.388], edge2: [3.6, 0.0, 0.0] },
            material: 'plate2',
        },
        {
            type: 'quad', parameters: { corner: [-1.8, 0.457, 0.853], edge1: [0.0, -0.074, 0.393], edge2: [3.6, 0.0, 0.0] },
            material: 'plate3',
        },
        {
            type: 'quad', parameters: { corner: [-1.8, 0.173, 1.551], edge1: [0.0, -0.047, 0.397], edge2: [3.6, 0.0, 0.0] },
            material: 'plate4',
        },
        // Matte floor catching the spill.
        {
            type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.35 },
            material: 'floor',
        },
    ],
    materials: {
        plate1: { model: 'ggx', f0: [0.95, 0.93, 0.88], roughness: 0.1 },
        plate2: { model: 'ggx', f0: [0.95, 0.93, 0.88], roughness: 0.22 },
        plate3: { model: 'ggx', f0: [0.95, 0.93, 0.88], roughness: 0.38 },
        plate4: { model: 'ggx', f0: [0.95, 0.93, 0.88], roughness: 0.6 },
        floor: { model: 'lambert', albedo: [0.18, 0.18, 0.2] },
    },
    // Explicit sphere lights (desugar route): Le ∝ 1/r² for ~equal power (π·4πr²·Le).
    lights: [
        { kind: 'sphere', position: [-1.15, 2.3, -1.9], radius: 0.035, emission: [150, 127.5, 105] },
        { kind: 'sphere', position: [0.0, 2.3, -1.9], radius: 0.14, emission: [8.46, 9.4, 7.99] },
        { kind: 'sphere', position: [1.15, 2.3, -1.9], radius: 0.5, emission: [0.592, 0.666, 0.74] },
    ],
    environment: { type: 'constant', color: [0.015, 0.015, 0.02], intensity: 1.0 },
};

export const veachMisStrategy: RenderStrategy = {
    id: 'pt-mis',
    measurement: {
        camera: { type: 'pinhole', fov: 0.8 },
        maxBounces: 6,      // a direct-lighting stressor — depth buys nothing here
    },
    estimator: {
        directLighting: 'mis',
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

export const veachNeeStrategy: RenderStrategy = {
    ...veachMisStrategy,
    id: 'pt-nee',
    estimator: { ...veachMisStrategy.estimator, directLighting: 'nee' },
};

export const veachPtStrategy: RenderStrategy = {
    ...veachMisStrategy,
    id: 'pt',
    estimator: { ...veachMisStrategy.estimator, directLighting: 'none' },
};
