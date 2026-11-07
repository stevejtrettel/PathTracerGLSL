// demos/hyperbolicScene.ts — a room in hyperbolic space H³ (curvature −1).
// A floor plane 0.6 below the origin, two rings of balls resting on it about the point under the
// origin, and a backdrop plane 1.8 away, lit by a warm disk light overhead and a cool sky. The
// hyperbolic geometry shows in three places: the rings hold 7 and 19 equal balls at equal spacing
// (a circle of radius ρ has length 2π·sinh ρ, so the outer ring is far longer than twice the
// inner); balls shrink exponentially with distance; and the floor and the backdrop never meet —
// two planes this far apart are ultraparallel, so the sky shows through the gap between them.
// Every point here is within 2 of the origin, inside the working radius.

import type { SceneDescription, RenderStrategy, ObjectDescription, Vec3 } from '../src/compiler/types.js';
import { hyperbolicGeometry as H } from '../src/components/ambient/hyperbolic/hyperbolic.js';
import { mat4Apply, tangentAtOrigin } from '../src/components/ambient/isometry.js';

const FLOOR = 0.6;   // the floor plane's distance below o

/** The center (in exp coordinates at o) of a ball of radius r resting on the floor at geodesic
 *  polar coordinates (ρ, θ) about the floor's foot point exp_o((0, −FLOOR, 0)): the floor is the
 *  xz-plane through o carried down by the transvection T, its normal is T·e_y at every point,
 *  and the center lies r along it. */
function restingCenter(rho: number, theta: number, r: number): Vec3 {
    const T = H.transvection([0, -FLOOR, 0]);
    const f = mat4Apply(T, H.exp([rho * Math.cos(theta), 0, rho * Math.sin(theta)]));
    const n = mat4Apply(T, tangentAtOrigin([0, 1, 0]));
    const c = f.map((x, i) => Math.cosh(r) * x + Math.sinh(r) * n[i]) as [number, number, number, number];
    return H.log(c);
}

const palette: Record<string, Vec3> = {
    coral: [0.85, 0.36, 0.28], amber: [0.88, 0.62, 0.22], sage: [0.45, 0.66, 0.42],
    teal: [0.22, 0.58, 0.62], slate: [0.32, 0.42, 0.72], plum: [0.58, 0.34, 0.62], bone: [0.86, 0.83, 0.76],
};
const hues = Object.keys(palette);

const balls: ObjectDescription[] = [];
const ring = (count: number, rho: number, r: number, phase: number) => {
    for (let i = 0; i < count; i++) {
        const theta = phase + (2 * Math.PI * i) / count;
        balls.push({ type: 'sphere', parameters: { center: restingCenter(rho, theta, r), radius: r }, material: hues[i % hues.length] });
    }
};
ring(7, 0.85, 0.2, 0.3);
ring(19, 1.7, 0.2, 0.1);

export const hyperbolicScene: SceneDescription = {
    id: 'hyperbolic',
    name: 'Hyperbolic Room (H³)',
    ambientSpace: { type: 'hyperbolic' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: FLOOR }, material: 'floor' },
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 1.8 }, material: 'backdrop' },
        { type: 'sphere', parameters: { center: restingCenter(0, 0, 0.25), radius: 0.25 }, material: 'bone' },
        ...balls,
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.62, 0.6, 0.56] },
        backdrop: { model: 'lambert', albedo: [0.72, 0.7, 0.66] },
        ...Object.fromEntries(hues.map((h) => [h, { model: 'lambert' as const, albedo: palette[h] }])),
    },
    lights: [{ kind: 'disk', position: [0.25, 0.95, 0.2], normal: [0, -1, 0], radius: 0.55, emission: [11.0, 9.2, 7.0] }],
    environment: { type: 'constant', color: [0.32, 0.42, 0.62], intensity: 0.35 },
};

export const hyperbolicMisStrategy: RenderStrategy = {
    id: 'pt-mis',
    measurement: { camera: { type: 'pinhole', fov: 1.2 }, maxBounces: 6 },
    estimator: { directLighting: 'mis', russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'aces' } },
};
export const hyperbolicNeeStrategy: RenderStrategy = {
    ...hyperbolicMisStrategy, id: 'pt-nee', estimator: { ...hyperbolicMisStrategy.estimator, directLighting: 'nee' },
};
export const hyperbolicPtStrategy: RenderStrategy = {
    ...hyperbolicMisStrategy, id: 'pt', estimator: { ...hyperbolicMisStrategy.estimator, directLighting: 'none' },
};
