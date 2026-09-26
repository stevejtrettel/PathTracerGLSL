// witnesses/scenes/shadowAimWitness.ts
// Shadow rays must end at the light point they were aimed at.
//
// A shadow ray cannot start on the surface it leaves, so it starts ε off it (ray_spawn, ε =
// Hit.eps). If it keeps the direction computed from the unmoved point, it runs parallel to the
// true segment, ε away, and passes beside the light point instead of ending there. The search
// stops SHADOW_BACKOFF short of the light point; for a receiver facing a parallel emitter the
// shifted line meets the emitter's own surface first whenever ε·(1/cos θ − cos θ) > SHADOW_BACKOFF
// (θ from the receiver's normal), and NEE counts the light as blocked. pt uses no shadow ray, so
// pt-nee and pt-mis read dark against pt. The same shift happens at each null-interface crossing
// of the media shadow walker, which re-spawns the ray past every boundary it passes.
//
// All three scenes: a lambert floor (ρ = 0.5) under a one-sided disk light facing down (radiance
// Le = 2, radius R = 2, height h = 0.25), direct light only, and an orthographic camera looking
// straight down at a 0.013 × 0.010 patch of floor under the disk's centre. For a point on the
// disk's axis the view factor to a parallel coaxial disk is R²/(R² + h²), so the floor's radiance
// is ρ·Le·R²/(R² + h²). Across the patch it varies by 5·10⁻⁷ (relative), so one value holds for
// every pixel. Each scene checks pt, pt-nee and pt-mis against it; pt is the control.
//
//   shadow-aim-march — the floor is marched (ε = MARCH_CLEARANCE = 10⁻³) and the disk is an
//                      AUTHORED light (it desugars to a scene object, so it can block itself).
//                      Blocked today: cos θ < √2 − 1.
//   shadow-aim-far   — the same, moved to x = 100: an analytic floor whose fp-relative spawn
//                      margin is 3.05·10⁻⁵ · 100 ≈ 3·10⁻³; the disk is an emissive OBJECT (the
//                      sampleAsLight route).
//   shadow-aim-fog   — an analytic floor at the origin (ε ≈ 1.5·10⁻⁵, so the first segment is
//                      clean) under a marched absorbing slab (a 'none'-walled box, σ_a = 0.25,
//                      thickness 0.08): every shadow ray crosses two marched null interfaces
//                      (ε = 10⁻³ each). The floor's radiance is ρ·(Le/π)·∫ cos θ·e^{−σ_a d/cos θ} dω
//                      over the disk = 2ρ·Le·∫_{u₀}^{1} u·e^{−τ/u} du with τ = σ_a·d and
//                      u₀ = h/√(h² + R²), evaluated below by Simpson's rule.
//
// The tolerances were measured before the fix, each arm at three salts (see the comment above the
// entries in index.ts).

import type { SceneDescription, RenderStrategy, Vec3 } from '../../../src/compiler/types.js';

export const AIM_RHO = 0.5;
export const AIM_LE = 2.0;
export const AIM_R = 2.0;
export const AIM_H = 0.25;

/** The fog slab: y from 0.08 to 0.16, wider than every line from the floor patch to the disk. */
export const AIM_SLAB = { bottom: 0.08, top: 0.16, halfWidth: AIM_R + 0.5, sigmaA: 0.25 };
export const AIM_TAU = AIM_SLAB.sigmaA * (AIM_SLAB.top - AIM_SLAB.bottom);

/** Orthographic film half-height, and the camera heights (both below the disk; the fog
 *  scene's camera is also below the slab, so camera rays cross nothing). */
export const AIM_FILM = 0.005;
export const AIM_CAMERA_Y = 0.1;
export const AIM_FOG_CAMERA_Y = 0.04;
export const AIM_FAR_X = 100;

/** cos θ at the disk's rim, seen from the floor point under its centre. */
export const AIM_U0 = AIM_H / Math.hypot(AIM_H, AIM_R);

/** 2ρ·Le·∫_{u₀}^{1} u·e^{−τ/u} du — the floor's radiance under the disk through an absorbing
 *  slab of optical thickness τ (normal incidence). Composite Simpson, 2000 panels: the integrand
 *  is smooth on [u₀, 1], so the error is far below any render tolerance. At τ = 0 it is the
 *  closed form ρ·Le·(1 − u₀²) = ρ·Le·R²/(R² + h²) (checked in shadowAim.test.ts). */
export function aimFloorRadiance(tau: number): number {
    const n = 2000;
    const a = AIM_U0, b = 1.0, step = (b - a) / n;
    const f = (u: number) => u * Math.exp(-tau / u);
    let s = f(a) + f(b);
    for (let i = 1; i < n; i++) s += (i % 2 === 1 ? 4 : 2) * f(a + i * step);
    return 2 * AIM_RHO * AIM_LE * (s * step / 3);
}

/** The open scenes' value: ρ·Le·R²/(R² + h²) = 64/65. */
export const AIM_OPEN = AIM_RHO * AIM_LE * AIM_R * AIM_R / (AIM_R * AIM_R + AIM_H * AIM_H);
/** The fog scene's value. */
export const AIM_FOG = aimFloorRadiance(AIM_TAU);

const floorMaterial = { model: 'lambert' as const, albedo: [AIM_RHO, AIM_RHO, AIM_RHO] as Vec3 };
const down: Vec3 = [0, -1, 0];

export const shadowAimMarch: SceneDescription = {
    id: 'shadow-aim-march',
    name: 'Shadow-ray aim: marched floor under a disk light',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor', backend: 'sdf', name: 'floor' },
    ],
    materials: { floor: floorMaterial },
    lights: [{ kind: 'disk', position: [0, AIM_H, 0], radius: AIM_R, normal: down, emission: AIM_LE }],
    environment: { type: 'none' },
};

export const shadowAimFar: SceneDescription = {
    id: 'shadow-aim-far',
    name: 'Shadow-ray aim: floor at x = 100 under an emissive disk',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor', name: 'floor' },
        { type: 'disk', parameters: { center: [AIM_FAR_X, AIM_H, 0], radius: AIM_R, normal: down }, material: 'lamp', name: 'lamp' },
    ],
    materials: {
        floor: floorMaterial,
        lamp: { model: 'lambert', albedo: [0, 0, 0], emission: [AIM_LE, AIM_LE, AIM_LE] },
    },
    lights: [],
    environment: { type: 'none' },
};

export const shadowAimFog: SceneDescription = {
    id: 'shadow-aim-fog',
    name: 'Shadow-ray aim: disk light through a marched fog slab',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor', name: 'floor' },
        {
            type: 'box',
            parameters: {
                center: [0, (AIM_SLAB.bottom + AIM_SLAB.top) / 2, 0],
                halfSize: [AIM_SLAB.halfWidth, (AIM_SLAB.top - AIM_SLAB.bottom) / 2, AIM_SLAB.halfWidth],
            },
            material: 'fog', backend: 'sdf', name: 'slab',
        },
    ],
    materials: {
        floor: floorMaterial,
        fog: { model: 'none', medium: { sigma_a: [AIM_SLAB.sigmaA, AIM_SLAB.sigmaA, AIM_SLAB.sigmaA] } },
    },
    lights: [{ kind: 'disk', position: [0, AIM_H, 0], radius: AIM_R, normal: down, emission: AIM_LE }],
    environment: { type: 'none' },
};

// Direct light only (maxBounces 1: the floor is the one event), RR off (witness protocol).
const aimStrategy = (id: string, directLighting: 'nee' | 'mis' | 'none'): RenderStrategy => ({
    id,
    measurement: { camera: { type: 'orthographic', scale: AIM_FILM }, maxBounces: 1 },
    estimator: { directLighting, russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
});

/** pt-nee, pt-mis, pt — in the order the checks index them. */
export const shadowAimStrategies: RenderStrategy[] = [
    aimStrategy('pt-nee', 'nee'),
    aimStrategy('pt-mis', 'mis'),
    aimStrategy('pt', 'none'),
];
