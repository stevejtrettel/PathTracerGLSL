// demos/h2xrScene.ts — a colonnade in H²×R (the hyperbolic plane times the line).
// A floor 0.6 below the origin (a disk of radius 3.2 in a horizontal plane, a copy of H²), two rings of columns (capped
// vertical cylinders) standing on it about the point under the origin, balls resting on the floor
// between the inner columns, and a backdrop wall (a vertical plane: an H² geodesic times the line),
// lit by a warm disk light overhead and a dim sky. The geometry shows in three places: the outer
// ring, at twice the radius of the inner one, needs nearly three times as many columns for the same
// spacing (a circle of radius ρ has length 2π·sinh ρ); the columns stay upright and parallel to the
// eye, because the vertical direction is the line factor, while along the floor everything recedes
// hyperbolically; and the light falls off differently up and sideways (its area density is
// d²·sinh(D_H)/D_H, D_H the horizontal distance), so the pool under the lamp is tight and the walls
// stay lit. Every point is within 2.5 of the origin.

import type { SceneDescription, RenderStrategy, ObjectDescription, Vec3 } from '../src/compiler/types.js';

const FLOOR = 0.6;   // the floor's depth below o
/** The floor is a disk, not a plane: a plane is hit near its horizon at points far beyond the working
 *  radius (about 3 from o), where float32 hyperboloid coordinates carry relative error ε·w² and a
 *  column root computed from there can be garbage (rare NaN pixels in the plane version, measured). */
const FLOOR_RADIUS = 3.2;

/** A point at H² polar coordinates (ρ, θ) about the point under o, at height y (exp coordinates at o:
 *  a horizontal vector of length ρ reaches the H² point at distance ρ in its direction). */
const at = (rho: number, theta: number, y: number): Vec3 => [rho * Math.cos(theta), y, rho * Math.sin(theta)];

const palette: Record<string, Vec3> = {
    coral: [0.85, 0.36, 0.28], amber: [0.88, 0.62, 0.22], sage: [0.45, 0.66, 0.42],
    teal: [0.22, 0.58, 0.62], slate: [0.32, 0.42, 0.72], plum: [0.58, 0.34, 0.62],
};
const hues = Object.keys(palette);

const objects: ObjectDescription[] = [
    { type: 'disk', parameters: { center: [0, -FLOOR, 0], radius: FLOOR_RADIUS, normal: [0, 1, 0] }, material: 'floor' },
    { type: 'plane', parameters: { normal: [0, 0, 1], offset: 2.4 }, material: 'wall' },
];
const column = (rho: number, theta: number, r: number, h: number) =>
    objects.push({ type: 'cylinder', parameters: { center: at(rho, theta, -FLOOR + h), radius: r, halfHeight: h }, material: 'stone' });
for (let i = 0; i < 6; i++) column(0.9, (2 * Math.PI * i) / 6, 0.07, 0.5);
for (let i = 0; i < 17; i++) column(1.8, (2 * Math.PI * (i + 0.5)) / 17, 0.07, 0.5);
for (let i = 0; i < 6; i++) {
    const r = 0.13;
    objects.push({ type: 'sphere', parameters: { center: at(0.9, (2 * Math.PI * (i + 0.5)) / 6, -FLOOR + r), radius: r }, material: hues[i] });
}
objects.push({ type: 'sphere', parameters: { center: at(0, 0, -FLOOR + 0.16), radius: 0.16 }, material: 'bone' });

export const h2xrScene: SceneDescription = {
    id: 'h2xr',
    name: 'Colonnade in H²×R',
    ambientSpace: { type: 'h2xr' },
    objects,
    materials: {
        floor: { model: 'lambert', albedo: [0.62, 0.6, 0.56] },
        wall: { model: 'lambert', albedo: [0.7, 0.68, 0.64] },
        stone: { model: 'lambert', albedo: [0.82, 0.8, 0.76] },
        bone: { model: 'lambert', albedo: [0.86, 0.83, 0.76] },
        ...Object.fromEntries(hues.map((h) => [h, { model: 'lambert' as const, albedo: palette[h] }])),
    },
    lights: [{ kind: 'disk', position: [0, 0.9, 0], normal: [0, -1, 0], radius: 0.6, emission: [9.0, 7.6, 5.8] }],
    environment: { type: 'constant', color: [0.32, 0.42, 0.62], intensity: 0.35 },
};

export const h2xrMisStrategy: RenderStrategy = {
    id: 'pt-mis',
    measurement: { camera: { type: 'pinhole', fov: 1.3 }, maxBounces: 6 },
    estimator: { directLighting: 'mis', russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'aces' } },
};
export const h2xrNeeStrategy: RenderStrategy = {
    ...h2xrMisStrategy, id: 'pt-nee', estimator: { ...h2xrMisStrategy.estimator, directLighting: 'nee' },
};
export const h2xrPtStrategy: RenderStrategy = {
    ...h2xrMisStrategy, id: 'pt', estimator: { ...h2xrMisStrategy.estimator, directLighting: 'none' },
};
