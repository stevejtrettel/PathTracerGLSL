// demos/laserScene.ts — DEMO showcase for the beam kind (impl-plan-directional-beam):
// three colored lasers crossing a foggy dark room. Everything on screen is the delta-
// direction machinery being honest: the shafts are medium-vertex NEE landing inside
// each beam's cylinder, the wall spots are the surface evaluation, and the GREEN beam
// is aimed dead-center at a chrome MIRROR ball — occlusion is what terminates a beam,
// so it carves a fog shadow tunnel behind the ball while the ball itself reflects the
// shafts (the shadow walker doing the work; no range parameter exists). v1 caveat (plan P7): thin beams
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
        // The green beam's target: its axis passes through this center exactly. A
        // MIRROR ball: no diffuse lobe, so the beam leaves no stamp — instead the
        // ball reflects all three shafts through the fog (eye rays bounce specularly,
        // then gather medium NEE along the reflected line), and it still blocks the
        // green beam (occlusion is the range), carving the shadow tunnel behind it.
        // The REFLECTED green beam is not a visible shaft: a curved mirror diverges a
        // delta-direction beam into a cone vertex NEE cannot sample (the same
        // measure-zero argument as the delta² laser — plan §1).
        { type: 'sphere', parameters: { center: [0.6, 1.1, -1.0], radius: 0.45 }, material: 'chrome', name: 'chrome_ball' },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.25, 0.25, 0.28] },
        backwall: { model: 'lambert', albedo: [0.3, 0.3, 0.33] },
        fog: { model: 'none', medium: { sigma_a: 0, sigma_s: { param: 'fog.sigma_s', default: 0.35, min: 0.05, max: 1.2 }, phase_g: 0.0 } },
        chrome: { model: 'mirror', f0: [0.95, 0.96, 0.97] },
    },
    lights: [
        // Three beams fanning from the upper left. Radii are thin (laser look);
        // emission is per-beam irradiance E (W/m²) — B2's delta-direction rung.
        { kind: 'beam', position: [-2.8, 2.6, 2.4], direction: [1.5, -0.8, -1.6], radius: 0.06, emission: [70, 3, 3] },
        // Aimed exactly at the pearl: direction = center − position.
        { kind: 'beam', position: [-2.8, 1.8, 2.0], direction: [3.4, -0.7, -3.0], radius: 0.06, emission: [4, 70, 4] },
        { kind: 'beam', position: [-2.8, 0.9, 1.6], direction: [1.8, -0.15, -1.4], radius: 0.06, emission: [3, 3, 70] },
        // A dim cool wash so the room reads at all outside the shafts.
        { kind: 'point', position: [0, 3.0, 2.2], emission: [0.6, 0.7, 0.9] },
    ],
    // No environment: black — the shafts are the only structure in the air.
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
