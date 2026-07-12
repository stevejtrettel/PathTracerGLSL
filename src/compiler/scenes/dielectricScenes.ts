// compiler/scenes/dielectricScenes.ts
// The dielectric witnesses (impl-plan-dielectric phase 3):
//   eta            — F-ETA (validation §3): the η² witness. Center pixel = 0.5540 ± 1% in linear
//                    HDR; an implementation that omits the η² radiance-compression factor renders
//                    0.980 (77% too bright) and looks completely plausible.
//   submerged      — R-SUBMERGED (validation §5): glass sphere inside a water pool, camera in the
//                    water. Under the old deepest-wins classification the sphere gets η = 1 and is
//                    perfectly invisible; under innermost-wins it visibly distorts the checker.
//   cornell-glass  — glass sphere in the Cornell box (eyeball: Fresnel rim, TIR at grazing,
//                    inverted image through the sphere). RR ON → exercises the etaScale metric.
//   analytic-glass — the same scene with the glass sphere behind the ANALYTIC backend
//                    (cross-backend convergence twin; interior far-root path).

import type { SceneDescription, RenderStrategy } from '../types.js';

// ---------------------------------------------------------------------------
// F-ETA — emissive plane under a flat water surface, camera in air looking down.
// Derivation (validation §3): R₀ = ((1.33−1)/(1.33+1))² = 0.020053 at normal incidence;
// center-pixel throughput = (1−R₀) · (1/1.33²) = 0.97995 · 0.56532 = 0.5540.
// ---------------------------------------------------------------------------

export const etaScene: SceneDescription = {
    id: 'eta',
    name: 'F-ETA (η² witness)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        // Water half-space below y = 0 (sdf = p.y)
        {
            kind: 'sdf',
            sdf: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 } },
            material: 'water',
        },
        // Emissive plane INSIDE the water: solid below y = -1 (sdf = p.y + 1)
        {
            kind: 'sdf',
            sdf: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 } },
            material: 'glow',
        },
    ],
    materials: {
        water: { model: 'dielectric', ior: 1.33 },
        glow: { model: 'lambert', albedo: [0, 0, 0], emission: [1.0, 1.0, 1.0] },
    },
    lights: [], // emission is the only source; no environment (reflected branch escapes to black)
};

// Camera tilted a hair off straight-down so the view basis doesn't degenerate (up ∥ view);
// cos θ ≈ 0.9997 at the center pixel — within the ±1% tolerance of the normal-incidence number.
export const etaStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: {
        camera: { type: 'pinhole', fov: 0.6 },
        maxBounces: 4,
    },
    estimator: {
        directLighting: 'none',
        russianRoulette: null, // witness protocol: RR off
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

// ---------------------------------------------------------------------------
// R-SUBMERGED — pool box (half-extent 5, ior 1.33) + glass sphere (r 0.4, ior 1.5) at its
// center, camera INSIDE the water. The sphere's entry hit must classify region_from = water
// (not ambient): η = 1.33/1.5. A checkered emissive backwall gives the refraction something
// to distort — with a constant background the bug would be invisible even when present.
// ---------------------------------------------------------------------------

export const submergedScene: SceneDescription = {
    id: 'submerged',
    name: 'R-SUBMERGED (innermost-wins witness)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        // Water pool: big box around everything (camera included)
        {
            kind: 'sdf',
            sdf: { type: 'box', parameters: { center: [0, 0, 0], halfSize: [5, 5, 5] } },
            material: 'water',
        },
        // Glass sphere at the center, fully submerged
        {
            kind: 'sdf',
            sdf: { type: 'sphere', parameters: { center: [0, 0, 0], radius: 0.4 } },
            material: 'glass',
        },
        // Emissive checker backwall: solid below z = -2 (inside the pool)
        {
            kind: 'sdf',
            sdf: { type: 'plane', parameters: { normal: [0, 0, 1], offset: 2.0 } },
            material: 'screen',
        },
    ],
    materials: {
        water: { model: 'dielectric', ior: 1.33 },
        glass: { model: 'dielectric', ior: 1.5 },
        screen: {
            model: 'lambert',
            albedo: [0, 0, 0],
            emission: {
                kind: 'glsl',
                source: 'mix(vec3(0.05), vec3(1.0), mod(floor(p.x * 2.0) + floor(p.y * 2.0), 2.0))',
            },
        },
    },
    lights: [],
};

export const submergedStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: {
        camera: { type: 'pinhole', fov: 0.7 },
        maxBounces: 12, // TIR chains inside the sphere; paths that TIR at the pool walls just die
    },
    estimator: {
        directLighting: 'none',
        russianRoulette: null, // witness protocol: RR off
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

// ---------------------------------------------------------------------------
// Cornell + glass sphere — the eyeball scene, in SDF and analytic-backend twin form.
// The two must converge to the same image (cross-backend witness for interior tracing).
// ---------------------------------------------------------------------------

// Sphere FLOATS mid-box (per validation X-GLASS: r 0.5, not touching anything): exact tangency
// with the floor parked the witness on an epsilon-degeneracy hub (spawn points inside the sphere,
// classification probes into the floor, the ray_sphere near-root window — review finding).
const GLASS_SPHERE = { center: [0.35, 1.0, 0.3], radius: 0.5 };

function cornellGlassObjects(glassKind: 'sdf' | 'analytic'): SceneDescription['objects'] {
    const glassSphere: SceneDescription['objects'][number] =
        glassKind === 'sdf'
            ? {
                  kind: 'sdf',
                  sdf: { type: 'sphere', parameters: { ...GLASS_SPHERE } },
                  material: 'glass',
              }
            : {
                  kind: 'analytic',
                  shape: { type: 'sphere', parameters: { ...GLASS_SPHERE } },
                  material: 'glass',
              };

    return [
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 } }, material: 'white' },
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [0, -1, 0], offset: 2.0 } }, material: 'white' },
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [0, 0, 1], offset: 2.0 } }, material: 'white' },
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [1, 0, 0], offset: 1.5 } }, material: 'red' },
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [-1, 0, 0], offset: 1.5 } }, material: 'green' },
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [0, 0, -1], offset: 5.0 } }, material: 'white' },
        { kind: 'sdf', sdf: { type: 'box', parameters: { center: [-0.5, 0.6, -0.5], halfSize: [0.3, 0.6, 0.3] } }, material: 'white' },
        glassSphere,
    ];
}

const cornellGlassMaterials: SceneDescription['materials'] = {
    white: { model: 'lambert', albedo: [0.73, 0.73, 0.73] },
    red: { model: 'lambert', albedo: [0.65, 0.05, 0.05] },
    green: { model: 'lambert', albedo: [0.12, 0.45, 0.15] },
    glass: { model: 'dielectric', ior: 1.5 },
};

export const cornellGlass: SceneDescription = {
    id: 'cornell-glass',
    name: 'Cornell + Glass Sphere',
    ambientSpace: { type: 'euclidean' },
    objects: cornellGlassObjects('sdf'),
    materials: cornellGlassMaterials,
    lights: [{ kind: 'point', position: [0, 1.9, 0], intensity: 15.0, color: [1.0, 1.0, 1.0] }],
};

export const analyticGlass: SceneDescription = {
    ...cornellGlass,
    id: 'analytic-glass',
    name: 'Cornell + Glass Sphere (analytic)',
    objects: cornellGlassObjects('analytic'),
};

// Real-world usage strategy: RR ON (exercises the §7.2 etaScale metric), NEE ON (exercises the
// generated material_has_nondelta_lobes guard skipping shadow rays at glass hits).
export const glassStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: {
        camera: { type: 'pinhole', fov: 0.8 },
        maxBounces: 12,
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};
