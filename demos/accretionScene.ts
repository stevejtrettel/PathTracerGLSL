// demos/accretionScene.ts — A BLACK HOLE WITH A GLOWING ACCRETION DISK, in a crystal ball.
// The imagery payoff of impl-plan-grin-media batch 1: the disk is EMISSIVE MEDIUM, not
// geometry — a thin equatorial torus of volume emission ε(x) inside the same deflecting
// region as the hole's index field — so the lensed image (the disk seen bent over and under
// the shadow, the classic shot) needs no embedded-geometry machinery at all. The GRIN walker
// collects ε per step along the BENT path with the (n₀/n)² source factor, and rays that
// plunge keep the glow they crossed before capture.
//
// Field: a single Majumdar–Papapetrou hole, n = (1 + M/r)² (see blackholeScene.ts for the
// physics), inside a dielectric glass ball — the wall refracts with the local field value
// (n_wall ≈ 1.25). Shadow radius = the critical impact parameter 4M; the disk sits just
// outside the photon sphere (r = M), where the lensing is strongest. `bh.mass` is LIVE.
// Colored absorption in the ball (σ_a rising toward blue) warms the glow with path length.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';

const C: [number, number, number] = [0, 1.25, 0];   // ball + hole center
const BALL_R = 1.2;

const v3 = (p: [number, number, number]) => `vec3(${p[0].toFixed(3)}, ${p[1].toFixed(3)}, ${p[2].toFixed(3)})`;
const mpField = `pow(1.0 + u_bh_mass / max(length(p - ${v3(C)}), 0.0001), 2.0)`;
// The disk: a ring at radius 0.55 (width 0.18) in the hole's equatorial plane, thickness 0.05.
const disk =
    `8.0 * exp(-pow((length(vec2(p.x - ${C[0].toFixed(3)}, p.z - ${C[2].toFixed(3)})) - 0.55) / 0.18, 2.0))` +
    ` * exp(-pow((p.y - ${C[1].toFixed(3)}) / 0.05, 2.0))`;

export const accretionScene: SceneDescription = {
    id: 'accretion',
    name: 'Accretion disk (black hole in a crystal ball)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor', name: 'floor' },
        { type: 'sphere', parameters: { center: C, radius: BALL_R }, material: 'ball', name: 'ball' },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.22, 0.22, 0.25] },
        ball: {
            model: 'dielectric',   // the wall reads the LOCAL field value at every hit point
            medium: {
                ior: {
                    kind: 'glsl',
                    source: mpField,
                    params: [{ param: 'bh.mass', default: 0.14, min: 0.0, max: 0.3 }],
                },
                // Volume glow: the disk (scalar ε broadcasts; the walker collects it per
                // step along the bent path — rays plunging into the hole keep the glow
                // they crossed first).
                emission: { kind: 'glsl', source: disk },
                // Blue-absorbing haze in the ball: path length warms the disk light.
                sigma_a: [0.04, 0.16, 0.45],
            },
        },
    },
    lights: [
        { kind: 'quad', corner: [-2, 4.5, -2], edge1: [4, 0, 0], edge2: [0, 0, 4], emission: [2, 2, 2] },
    ],
    environment: { type: 'constant', color: [0.05, 0.06, 0.1], intensity: 1.0 },
};

export const accretionStrategy: RenderStrategy = {
    id: 'pt',
    measurement: {
        camera: { type: 'pinhole', fov: { param: 'camera.fov', default: 0.85, min: 0.3, max: 1.4 } },
        maxBounces: 24,
    },
    estimator: {
        directLighting: 'none',
        russianRoulette: { startDepth: 4 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'agx' } },
};
