// compiler/scenes/areaLightScenes.ts
// Phase-A area-light witnesses (impl-plan-area-lights A5):
//   cornell-area — X-CORNELL (validation §4): the Cornell box with the point light replaced by
//                  a CEILING QUAD (explicit-light route → desugars to a synthesized emissive
//                  region). pt-nee (key 1) vs pt (key 2) are different estimators of the same
//                  integral — converged images must match (§11.2: RMSE < 1.5% at 4096 spp).
//                  Divergence implicates the §6.2 w-bookkeeping, the quad's solid-angle pdf,
//                  or shadow offsetting. The panel must be VISIBLE (it is real geometry).
//   orb          — the sphere-light + sampleAsLight-route summoning scene: a glowing analytic
//                  sphere (emissive material, registry via the default-true flag) over a floor
//                  with a matte box and a glass sphere. Same pt-nee vs pt convergence pair;
//                  the orb must appear in the glass reflections (hittable-emitter invariant).

import type { SceneDescription, RenderStrategy } from '../types.js';
import { cornellBox } from './cornellBox.js';

// ---------------------------------------------------------------------------
// cornell-area — X-CORNELL
// ---------------------------------------------------------------------------
// Quad slightly BELOW the ceiling plane (y = 1.98, ceiling at y = 2): a flush coplanar panel
// would z-fight the ceiling and self-block its own shadow rays. Edges chosen so
// cross(edge1, edge2) = (0, -1, 0): emitting DOWN (one-sided pin).

export const cornellArea: SceneDescription = {
    ...cornellBox,
    id: 'cornell-area',
    name: 'Cornell + Ceiling Quad (X-CORNELL)',
    lights: [
        {
            kind: 'quad',
            corner: [-0.5, 1.98, -0.5],
            edge1: [1.0, 0.0, 0.0],
            edge2: [0.0, 0.0, 1.0],
            intensity: 15.0,
            color: [1.0, 1.0, 1.0],
        },
    ],
};

export const cornellAreaNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    transport: {
        maxBounces: 10,
        directLighting: 'nee',
        russianRoulette: { enabled: true, startDepth: 3 },
        samplesPerFrame: 1,
    },
    camera: { type: 'pinhole', fov: { param: 'camera.fov', default: 0.8, min: 0.3, max: 1.5 } },
    accumulation: { type: 'average' },
    display: { type: 'reinhard' },
};

export const cornellAreaPtStrategy: RenderStrategy = {
    ...cornellAreaNeeStrategy,
    id: 'pt',
    transport: { ...cornellAreaNeeStrategy.transport, directLighting: 'none' },
};

export const cornellAreaMisStrategy: RenderStrategy = {
    ...cornellAreaNeeStrategy,
    id: 'pt-mis',
    transport: { ...cornellAreaNeeStrategy.transport, directLighting: 'mis' },
};

// ---------------------------------------------------------------------------
// cornell-area-glass — X-GLASS (validation §4): the delta-bookkeeping stressor.
// The clay sphere becomes GLASS: prev_was_delta propagation through specular chains, NEE
// correctly skipped at the glass (the nondelta guard), full-weight emission after delta
// bounces, and the MIS emitter-hit weight staying 1 exactly there. The noisiest pair —
// double spp before suspecting bias (§4 protocol note).
// ---------------------------------------------------------------------------

export const cornellAreaGlass: SceneDescription = {
    ...cornellArea,
    id: 'cornell-area-glass',
    name: 'Cornell + Quad + Glass (X-GLASS)',
    objects: cornellArea.objects.map((o) => (o.material === 'clay' ? { ...o, material: 'glass' } : o)),
    materials: {
        white: { model: 'lambert', albedo: [0.73, 0.73, 0.73] },
        red: { model: 'lambert', albedo: [0.65, 0.05, 0.05] },
        green: { model: 'lambert', albedo: [0.12, 0.45, 0.15] },
        glass: { model: 'dielectric', ior: 1.5 },
    },
};

// ---------------------------------------------------------------------------
// fog-area — X-FOG proper (validation §4): the RESURRECTED haze equality pair. Grayscale
// ambient haze in the quad-lit Cornell box. This is the scene the media plan had to defer
// (delta lights are invisible to phase paths) — with a hittable quad, pt / pt-nee / pt-mis
// are three estimators of the same integral: divergence between pt and pt-nee implicates
// hg_eval/hg_sample consistency (the audit's +2gc bug makes EXACTLY these two disagree);
// pt-mis joining implicates the medium-side weight (hg_pdf) or lighting_pdf.
// ---------------------------------------------------------------------------

export const fogArea: SceneDescription = {
    ...cornellArea,
    id: 'fog-area',
    name: 'Foggy Cornell + Quad (X-FOG)',
    materials: {
        ...cornellArea.materials,
        haze: {
            model: 'none',
            medium: { sigma_a: [0.05, 0.05, 0.05], sigma_s: [0.4, 0.4, 0.4], phase_g: 0.6 },
        },
    },
    ambientMedium: 'haze',
};

export const fogAreaNeeStrategy: RenderStrategy = {
    ...cornellAreaNeeStrategy,
    id: 'pt-nee',
    transport: { ...cornellAreaNeeStrategy.transport, maxBounces: 16, volumeIntegrator: 'analytic' },
};

export const fogAreaMisStrategy: RenderStrategy = {
    ...fogAreaNeeStrategy,
    id: 'pt-mis',
    transport: { ...fogAreaNeeStrategy.transport, directLighting: 'mis' },
};

export const fogAreaPtStrategy: RenderStrategy = {
    ...fogAreaNeeStrategy,
    id: 'pt',
    transport: { ...fogAreaNeeStrategy.transport, directLighting: 'none' },
};

// ---------------------------------------------------------------------------
// orb — sphere light via the sampleAsLight route
// ---------------------------------------------------------------------------

export const orbScene: SceneDescription = {
    id: 'orb',
    name: 'Glowing Orb (sphere light)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        // Floor
        {
            kind: 'sdf',
            sdf: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 } },
            material: 'ground',
        },
        // The light: an ANALYTIC emissive sphere — sampleAsLight defaults true for this shape,
        // so it enters the registry with no explicit flag (the second authoring route).
        {
            kind: 'analytic',
            shape: { type: 'sphere', parameters: { center: [0.0, 1.6, 0.0], radius: 0.25 } },
            material: 'glow',
        },
        // A matte box for soft-shadow display
        {
            kind: 'sdf',
            sdf: { type: 'box', parameters: { center: [-0.7, 0.4, 0.0], halfSize: [0.35, 0.4, 0.35] } },
            material: 'slate',
        },
        // A glass sphere — the orb must appear in its reflections (hittable-emitter invariant),
        // and specular chains exercise prev_was_delta → full-weight emission after delta.
        {
            kind: 'sdf',
            sdf: { type: 'sphere', parameters: { center: [0.75, 0.45, 0.35], radius: 0.45 } },
            material: 'glass',
        },
    ],
    materials: {
        ground: { model: 'lambert', albedo: [0.45, 0.44, 0.42] },
        glow: { model: 'lambert', albedo: [0, 0, 0], emission: [22.0, 20.0, 17.0] },
        slate: { model: 'lambert', albedo: [0.25, 0.27, 0.3] },
        glass: { model: 'dielectric', ior: 1.5 },
    },
    lights: [],           // the orb IS the light (registry via sampleAsLight default)
    environment: { type: 'constant', color: [0.03, 0.035, 0.05], intensity: 1.0 },
};

export const orbNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    transport: {
        maxBounces: 12,
        directLighting: 'nee',
        russianRoulette: { enabled: true, startDepth: 3 },
        samplesPerFrame: 1,
    },
    camera: { type: 'pinhole', fov: 0.8 },
    accumulation: { type: 'average' },
    display: { type: 'reinhard' },
};

export const orbPtStrategy: RenderStrategy = {
    ...orbNeeStrategy,
    id: 'pt',
    transport: { ...orbNeeStrategy.transport, directLighting: 'none' },
};
