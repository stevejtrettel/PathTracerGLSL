// demos/laserScene.ts — DEMO showcase for the beam kind (impl-plan-directional-beam):
// three colored lasers crossing a foggy dark room. Everything on screen is the delta-
// direction machinery being honest: the shafts are medium-vertex NEE landing inside
// each beam's cylinder, the wall spots are the surface evaluation, and the GREEN beam
// hits a NEAR-MIRROR GGX ball — the roughness-vs-sampling experiment: non-delta, so
// the reflected glow is REACHABLE (phase sample → ball vertex → NEE with the GGX
// eval), with variance ∝ 1/α² as the slider approaches mirror (the delta×delta
// probability-zero limit, approached continuously). Occlusion still terminates the
// beam at the ball (shadow tunnel behind). v1 caveat (plan P7): thin beams
// under vertex NEE are firefly-ish at low spp — the beam-segment technique is the
// deferred fix; let the card accumulate.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';

export const laserScene: SceneDescription = {
    id: 'laser',
    name: 'Lasers (beams in fog)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor', name: 'floor' },
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 3.0 }, material: 'backwall', name: 'backwall' },
        // The fog volume — a null-interface box filling the room.
        { type: 'box', parameters: { center: [0, 1.6, 0], halfSize: [3.5, 1.6, 3.0] }, material: 'fog', name: 'fog_volume' },
        // The green beam's target: a NEAR-MIRROR rough chrome ball — the sampling
        // experiment (owner-requested). GGX is non-delta, so the reflected-glow chain
        // becomes sampleable: eye ray → fog vertex → phase sample toward the ball →
        // NEE at the ball vertex with the GGX eval weighting the beam's delta sample.
        // The variance law to observe on the ball.roughness slider: the GGX eval is
        // only large on the small surface patch reflecting the beam toward the fog
        // vertex (patch area ∝ α²), so convergence degrades as roughness → 0 —
        // approaching the delta×delta probability-zero limit continuously.
        { type: 'sphere', parameters: { center: [0.6, 1.1, -1.0], radius: 0.45 }, material: 'chrome', name: 'chrome_ball' },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.25, 0.25, 0.28] },
        backwall: { model: 'lambert', albedo: [0.3, 0.3, 0.33] },
        fog: { model: 'none', medium: { sigma_a: 0, sigma_s: { param: 'fog.sigma_s', default: 0.35, min: 0.05, max: 1.2 }, phase_g: 0.0 } },
        chrome: { model: 'ggx', f0: [0.95, 0.96, 0.97], roughness: { param: 'ball.roughness', default: 0.15, min: 0.02, max: 0.6 } },
    },
    lights: [
        // Three beams fanning from the upper left. Radii are thin (laser look);
        // emission is per-beam irradiance E (W/m²) — B2's delta-direction rung.
        { kind: 'beam', position: [-2.8, 2.6, 2.4], direction: [1.5, -0.8, -1.6], radius: 0.06, emission: [70, 3, 3] },
        // Aimed exactly at the ball: direction = center − position.
        { kind: 'beam', position: [-2.8, 1.8, 2.0], direction: [3.4, -0.7, -3.0], radius: 0.06, emission: [4, 70, 4] },
        { kind: 'beam', position: [-2.8, 0.9, 1.6], direction: [1.8, -0.15, -1.4], radius: 0.06, emission: [3, 3, 70] },
        // A dim cool wash so the room reads at all outside the shafts.
        { kind: 'point', position: [0, 3.0, 2.2], emission: [0.6, 0.7, 0.9] },
    ],
    // No environment: black — the shafts are the only structure in the air.
};

// The SOFT-BEAM twin (fable-emitter-profiles v0): same room, same GGX ball, but the
// green laser is a `softbeam` — finite divergence δ = 2° (0.035 rad), Le chosen so the
// in-corridor irradiance matches the delta twin (Le = E/(π sin²δ): [4,70,4]/0.0038469).
// What the comparison card shows: (1) the green shaft's edge softens with distance;
// (2) the ball's reflected glow is now reachable TWO ways — vertex NEE × GGX eval
// (as in `laser`) AND chance hits through the specular lobe onto the hittable
// aperture, MIS-weighted — drag ball.roughness down and compare noise against the
// delta card at the same spp. Red/blue stay delta beams as in-frame references.
export const laserSoftScene: SceneDescription = {
    ...laserScene,
    id: 'laser-soft',
    name: 'Lasers (soft green beam)',
    lights: [
        laserScene.lights![0],
        { kind: 'softbeam', position: [-2.8, 1.8, 2.0], direction: [3.4, -0.7, -3.0], radius: 0.06, divergence: 0.035, emission: [1040, 18200, 1040] },
        laserScene.lights![2],
        laserScene.lights![3],
    ],
};

export const laserNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: {
        camera: { type: 'pinhole', fov: { param: 'camera.fov', default: 0.8, min: 0.3, max: 1.4 } },
        maxBounces: 6,
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'agx' } },   // neon cores roll off instead of clipping
};

export const laserMisStrategy: RenderStrategy = {
    ...laserNeeStrategy,
    id: 'pt-mis',
    estimator: { ...laserNeeStrategy.estimator, directLighting: 'mis' },
};
