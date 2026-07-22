// demos/grinScene.ts — DEMO for variable-IOR (gradient-index) media (fable-variable-ior.md).
// A LUNEBURG LENS: refractive index n(r) = √(2 − (r/R)²) inside a sphere, which bends rays
// continuously (no interface — n → 1 at the boundary, so the lens surface is invisible). Rays
// entering the region integrate the Sharma ray ODE (velocity Verlet) instead of scattering; you see the
// checker floor BENT and magnified through the (otherwise invisible) lens. Combines P1 charts
// (the checker floor) with the new curved-space region walker.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';

const C: [number, number, number] = [0, 1.0, 0];   // lens center
const R = 1.0;                                       // lens radius

export const grinScene: SceneDescription = {
    id: 'grin',
    name: 'Gradient-index lens (variable IOR)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor', name: 'floor' },
        // The Luneburg lens — an INVISIBLE deflecting region: you see only the bent background.
        { type: 'sphere', parameters: { center: C, radius: R }, material: 'lens', name: 'lens' },
    ],
    materials: {
        // A bold checker floor so the bending reads clearly through the lens.
        floor: { model: 'checker', albedo_a: [0.9, 0.35, 0.2], albedo_b: [0.12, 0.2, 0.5], uv_scale: 3 },
        // model:'none' = a null-interface container (no Fresnel); the medium's `ior` formula
        // makes it deflecting. n(r) = √(2 − (r/R)²): √2 at the center, → 1 at the boundary.
        lens: {
            model: 'none',
            medium: {
                ior: {
                    kind: 'glsl',
                    // n(r) = √(2 − r²/R²), r = |p − center|. NOTE: authored formula strings are
                    // raw GLSL — every literal needs a decimal point (`${(R*R).toFixed(4)}`), or
                    // `x / 1` is a float/int type error.
                    source: `sqrt(max(2.0 - dot(p - vec3(${C[0].toFixed(3)}, ${C[1].toFixed(3)}, ${C[2].toFixed(3)}), p - vec3(${C[0].toFixed(3)}, ${C[1].toFixed(3)}, ${C[2].toFixed(3)})) / ${(R * R).toFixed(4)}, 0.0))`,
                },
            },
        },
    },
    lights: [
        { kind: 'quad', corner: [-2, 4, -2], edge1: [4, 0, 0], edge2: [0, 0, 4], emission: [5, 5, 5] },
    ],
    environment: { type: 'constant', color: [0.18, 0.2, 0.28], intensity: 1.0 },
};

export const grinNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: {
        camera: { type: 'pinhole', fov: { param: 'camera.fov', default: 0.9, min: 0.3, max: 1.4 } },
        maxBounces: 6,
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'agx' } },
};

export const grinPtStrategy: RenderStrategy = {
    ...grinNeeStrategy,
    id: 'pt',
    estimator: { ...grinNeeStrategy.estimator, directLighting: 'none' },
};

// ---------------------------------------------------------------------------
// fisheye — MAXWELL'S FISHEYE: n(r) = 2/(1 + r²/R²), the classic absolute
// instrument. n = 2 at the center, EXACTLY 1 at the rim (continuous 'none' wall,
// no Fresnel), and every ray inside travels a CIRCLE — light from any point of
// the rim refocuses perfectly at the antipodal point. This is the closed-photon-
// orbit field the walk's bounce budget was designed around (a ray entering near
// the rim can wind far around the sphere before leaving; each traversal consumes
// a bounce, so trapped windings terminate by budget, not by hanging).
// ---------------------------------------------------------------------------

const FC: [number, number, number] = [0, 1.0, 0];
const FR = 1.0;
const fDot = `dot(p - vec3(${FC[0].toFixed(3)}, ${FC[1].toFixed(3)}, ${FC[2].toFixed(3)}), p - vec3(${FC[0].toFixed(3)}, ${FC[1].toFixed(3)}, ${FC[2].toFixed(3)}))`;

export const maxwellScene: SceneDescription = {
    id: 'maxwell',
    name: "Maxwell's fisheye (closed photon orbits)",
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor', name: 'floor' },
        { type: 'sphere', parameters: { center: FC, radius: FR }, material: 'lens', name: 'lens' },
    ],
    materials: {
        floor: { model: 'checker', albedo_a: [0.9, 0.35, 0.2], albedo_b: [0.12, 0.2, 0.5], uv_scale: 3 },
        lens: {
            model: 'none',   // n → 1 at the rim exactly: seamless, Fresnel-free wall
            medium: {
                ior: { kind: 'glsl', source: `2.0 / (1.0 + ${fDot} / ${(FR * FR).toFixed(4)})` },
            },
        },
    },
    lights: [
        { kind: 'quad', corner: [-2, 4, -2], edge1: [4, 0, 0], edge2: [0, 0, 4], emission: [5, 5, 5] },
    ],
    environment: { type: 'constant', color: [0.18, 0.2, 0.28], intensity: 1.0 },
};

export const maxwellStrategy: RenderStrategy = {
    id: 'pt',
    measurement: {
        camera: { type: 'pinhole', fov: { param: 'camera.fov', default: 0.9, min: 0.3, max: 1.4 } },
        // Deep windings near the rim consume bounces (the closed-orbit budget).
        maxBounces: 16,
    },
    estimator: {
        directLighting: 'none',
        russianRoulette: { startDepth: 4 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'agx' } },
};

// ---------------------------------------------------------------------------
// glassball — the HARD-INTERFACE demo (impl-plan-grin-interface): a VISIBLE glass
// ball whose interior index falls off from the center, n(r) = 1.6 − 0.45·(r/R)².
// The wall sits at n ≈ 1.15 everywhere, so the dielectric surface really fires:
// Fresnel reflections and TIR at the boundary (via ior_of(region, p) = the local
// field value), plus continuous bending inside — glass and mirage in one object.
// ---------------------------------------------------------------------------

const GC: [number, number, number] = [0, 1.0, 0];
const GR = 1.0;
const gDot = `dot(p - vec3(${GC[0].toFixed(3)}, ${GC[1].toFixed(3)}, ${GC[2].toFixed(3)}), p - vec3(${GC[0].toFixed(3)}, ${GC[1].toFixed(3)}, ${GC[2].toFixed(3)}))`;

export const glassGrinScene: SceneDescription = {
    id: 'glassball',
    name: 'Gradient glass ball (hard-interface GRIN)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor', name: 'floor' },
        { type: 'sphere', parameters: { center: GC, radius: GR }, material: 'ball', name: 'ball' },
    ],
    materials: {
        floor: { model: 'checker', albedo_a: [0.9, 0.35, 0.2], albedo_b: [0.12, 0.2, 0.5], uv_scale: 3 },
        // Dielectric wall + deflecting interior: the medium's formula is the ONE ior —
        // the wall's Snell/Fresnel reads it at the hit point, the interior bends by ∇n.
        ball: {
            model: 'dielectric',
            medium: {
                ior: { kind: 'glsl', source: `1.6 - 0.45 * ${gDot} / ${(GR * GR).toFixed(4)}` },
            },
        },
    },
    lights: [
        { kind: 'quad', corner: [-2, 4, -2], edge1: [4, 0, 0], edge2: [0, 0, 4], emission: [5, 5, 5] },
    ],
    environment: { type: 'constant', color: [0.18, 0.2, 0.28], intensity: 1.0 },
};

// Interior traversals + TIR each consume bounces — the glass budget, not the fog one.
export const glassGrinStrategy: RenderStrategy = {
    id: 'pt',
    measurement: {
        camera: { type: 'pinhole', fov: { param: 'camera.fov', default: 0.9, min: 0.3, max: 1.4 } },
        maxBounces: 16,
    },
    estimator: {
        directLighting: 'none',
        russianRoulette: { startDepth: 4 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'agx' } },
};
