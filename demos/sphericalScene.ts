// demos/sphericalScene.ts — a floor in spherical space S³ (curvature +1).
// A floor plane 0.6 below the origin, a ring of balls resting on it about the point under the
// origin, and one ball resting near the floor's far side, lit by a warm disk light overhead and a
// cool one to the side. The spherical geometry shows in three places: the floor is a great sphere, so
// every line of sight meets it — looking up, the floor curves over the camera and closes as a
// ceiling; the ring holds only 9 balls of radius 0.18 at radius 1.1 (a circle of radius ρ has length
// 2π·sin ρ, shorter than in E³); and the far ball, near the antipode of the camera, is magnified
// until it fills much of the upper view (lines of sight from a point refocus at its antipode).
// S³ has no sky; the two lights reach every point along both arcs joining them to it.

import type { SceneDescription, RenderStrategy, ObjectDescription, Vec3 } from '../src/compiler/types.js';
import { sphericalGeometry as S } from '../src/components/ambient/spherical/spherical.js';
import { mat4Apply, tangentAtOrigin } from '../src/components/ambient/isometry.js';

const FLOOR = 0.6;   // the floor plane's distance below o

/** The center (in exp coordinates at o) of a ball of radius r resting on the floor at geodesic
 *  polar coordinates (ρ, θ) about the floor's foot point exp_o((0, −FLOOR, 0)): the floor is the
 *  great sphere through o perpendicular to y carried down by the transvection T, its normal is T·e_y
 *  at every point, and the center lies r along it. */
function restingCenter(rho: number, theta: number, r: number): Vec3 {
    const T = S.transvection([0, -FLOOR, 0]);
    const f = mat4Apply(T, S.exp([rho * Math.cos(theta), 0, rho * Math.sin(theta)]));
    const n = mat4Apply(T, tangentAtOrigin([0, 1, 0]));
    const c = f.map((x, i) => Math.cos(r) * x + Math.sin(r) * n[i]) as [number, number, number, number];
    return S.log(c);
}

const palette: Record<string, Vec3> = {
    coral: [0.85, 0.36, 0.28], amber: [0.88, 0.62, 0.22], sage: [0.45, 0.66, 0.42],
    teal: [0.22, 0.58, 0.62], slate: [0.32, 0.42, 0.72], plum: [0.58, 0.34, 0.62],
};
const hues = Object.keys(palette);

const balls: ObjectDescription[] = [];
for (let i = 0; i < 9; i++) {
    const theta = 0.2 + (2 * Math.PI * i) / 9;
    balls.push({ type: 'sphere', parameters: { center: restingCenter(1.1, theta, 0.18), radius: 0.18 }, material: hues[i % hues.length] });
}

export const sphericalScene: SceneDescription = {
    id: 'spherical',
    name: 'Spherical Floor (S³)',
    ambientSpace: { type: 'spherical' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: FLOOR }, material: 'floor' },
        { type: 'sphere', parameters: { center: restingCenter(0, 0, 0.25), radius: 0.25 }, material: 'bone' },
        // Near the floor's far side, 2.7 from the foot point (the far side is π away).
        { type: 'sphere', parameters: { center: restingCenter(2.7, -1.75, 0.3), radius: 0.3 }, material: 'teal' },
        ...balls,
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.62, 0.6, 0.56] },
        bone: { model: 'lambert', albedo: [0.86, 0.83, 0.76] },
        ...Object.fromEntries(hues.map((h) => [h, { model: 'lambert' as const, albedo: palette[h] }])),
    },
    lights: [
        { kind: 'disk', position: [0.25, 0.75, 0.2], normal: [0, -1, 0], radius: 0.35, emission: [11.0, 9.2, 7.0] },
        { kind: 'disk', position: [-0.9, 0.25, -0.5], normal: [1, -0.4, 0.5], radius: 0.25, emission: [2.2, 3.0, 4.6] },
    ],
};

export const sphericalMisStrategy: RenderStrategy = {
    id: 'pt-mis',
    measurement: { camera: { type: 'pinhole', fov: 1.3 }, maxBounces: 6 },
    estimator: { directLighting: 'mis', russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'aces' } },
};
export const sphericalNeeStrategy: RenderStrategy = {
    ...sphericalMisStrategy, id: 'pt-nee', estimator: { ...sphericalMisStrategy.estimator, directLighting: 'nee' },
};
export const sphericalPtStrategy: RenderStrategy = {
    ...sphericalMisStrategy, id: 'pt', estimator: { ...sphericalMisStrategy.estimator, directLighting: 'none' },
};
