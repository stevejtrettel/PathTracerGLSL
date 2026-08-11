// demos/sdfKnotScene.ts — a knot of MARCHED objects, instanced (impl-plan-sdf-as-shape T7).
//
// The scale demo for "an SDF is a shape with a slow intersect", built the way scale is
// meant to be built here: THREE batches (a cylinder, a box and a sphere prototype), each
// placed at ~1000 transforms along a (2,3) torus knot. Every link is individually
// positioned, individually rotated to follow the tangent, and individually scaled — the
// placements are data — but the scene has three regions and three materials, so nothing
// in the compiler grows with the link count.
//
// This is what the merge bought: a marched prototype now rides the SAME instance leaf
// item as a closed-form one, differing only in the intersect line (its bound test plus
// <type>_sdf_intersect). Before T5/T7 an SDF prototype was rejected outright.
//
// Distinct (non-instanced) marched objects remain the small-N regime — a few dozen at
// most, which is where sdf-table-twin lives. Thousands of DISTINCT marched objects, each
// with its own parameters and material, is a case this deliberately does not build: the
// region-keyed tables are O(regions) and the design for fixing them is recorded in
// impl-plan-sdf-as-shape §6.2, unbuilt because instancing is the answer to scale.

import type { SceneDescription, RenderStrategy, Transform } from '../src/compiler/types.js';
import { instance } from '../src/authoring/instance.js';

type Vec3 = [number, number, number];

const P = 2, Q = 3;          // the (2,3) torus knot — the trefoil
const R_MAJOR = 3.2, R_MINOR = 1.05;
const COUNT = 3000;

/** Torus-knot point at curve parameter t ∈ [0, 2π). */
function knotPoint(t: number): Vec3 {
    const r = R_MAJOR + R_MINOR * Math.cos(Q * t);
    return [r * Math.cos(P * t), R_MINOR * Math.sin(Q * t), r * Math.sin(P * t)];
}

/** Unit tangent by central difference — the curve is smooth and the step is tiny, so a
 *  finite difference IS the tangent to well past float precision (the repo's standing
 *  position on derivatives of smooth maps). */
function knotTangent(t: number): Vec3 {
    const h = 1e-4;
    const a = knotPoint(t - h), b = knotPoint(t + h);
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const n = Math.hypot(d[0], d[1], d[2]);
    return [d[0] / n, d[1] / n, d[2] / n];
}

/** Axis-angle taking canonical +Y onto `dir` (the shapes' up axis onto the tangent).
 *  Antiparallel is the one degenerate case: any perpendicular axis serves. */
function alignYTo(dir: Vec3): { axis: Vec3; angle: number } {
    const dot = Math.max(-1, Math.min(1, dir[1]));
    const axis: Vec3 = [dir[2], 0, -dir[0]];             // cross([0,1,0], dir)
    const len = Math.hypot(axis[0], axis[1], axis[2]);
    if (len < 1e-8) return { axis: [1, 0, 0], angle: dot > 0 ? 0 : Math.PI };
    return { axis: [axis[0] / len, axis[1] / len, axis[2] / len], angle: Math.acos(dot) };
}

/** Placements for the links whose index ≡ `phase` (mod 3) — one list per prototype, so
 *  the three shape types become three batches. Each link is positioned on the knot,
 *  rotated onto the tangent, and scaled by a slow harmonic. */
function knotPlacements(phase: number, count: number): Transform[] {
    const out: Transform[] = [];
    for (let i = phase; i < count; i += 3) {
        const t = (i / count) * Math.PI * 2;
        out.push({
            position: knotPoint(t),
            rotation: alignYTo(knotTangent(t)),
            scale: 0.55 + 0.28 * Math.sin(7 * t) * Math.cos(3 * t),
        });
    }
    return out;
}

function knotObjects(count: number): SceneDescription['objects'] {
    return [
        // The floor is ANALYTIC (shape-not-backend picks it): an unbounded plane has no
        // march bound to declare, so a marched one would be visited by every ray.
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 2.4 }, material: 'floor' },
        instance(
            { type: 'cylinder', parameters: { radius: 0.16, halfHeight: 0.34 }, material: 'brass', backend: 'sdf' },
            knotPlacements(0, count), 'knot_links'),
        instance(
            { type: 'box', parameters: { halfSize: [0.13, 0.3, 0.13] }, material: 'jade', backend: 'sdf' },
            knotPlacements(1, count), 'knot_rungs'),
        instance(
            { type: 'sphere', parameters: { radius: 0.17 }, material: 'coral', backend: 'sdf' },
            knotPlacements(2, count), 'knot_beads'),
    ];
}

export const sdfKnotScene: SceneDescription = {
    id: 'sdf-knot',
    name: `SDF Knot (${COUNT} instanced marched links)`,
    ambientSpace: { type: 'euclidean' },
    objects: knotObjects(COUNT),
    materials: {
        floor: { model: 'lambert', albedo: [0.32, 0.33, 0.35] },
        brass: { model: 'lambert', albedo: [0.72, 0.55, 0.22] },
        jade: { model: 'lambert', albedo: [0.22, 0.55, 0.42] },
        coral: { model: 'lambert', albedo: [0.75, 0.32, 0.28] },
    },
    lights: [
        { kind: 'point', position: [6, 9, 6], emission: 420 },
        { kind: 'point', position: [-7, 4, -5], emission: 160 },
    ],
    environment: { type: 'constant', color: [0.06, 0.07, 0.09] },
};

export const sdfKnotStrategy: RenderStrategy = {
    id: 'knot',
    measurement: { camera: { type: 'pinhole', fov: 0.85 }, maxBounces: 4 },
    estimator: { directLighting: 'nee', objectDispatch: 'table', russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
