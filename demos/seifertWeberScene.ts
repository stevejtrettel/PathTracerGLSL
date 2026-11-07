// demos/seifertWeberScene.ts — a room inside the Seifert–Weber space H³/Γ
// (components/quotient/seifert-weber), a closed hyperbolic 3-manifold whose fundamental domain D is
// a regular dodecahedron with 72° dihedral angles, each face glued to the opposite one with a
// 3/10 twist. Nothing escapes: every ray that leaves D comes back through the opposite face, so
// the room is seen again in every direction, in the cells of a tiling of H³ by dodecahedra, five
// around every edge and twenty around every vertex.
//
// The tiling is drawn by beads set inside D's corners and at its edge midpoints, each as close to
// the faces as the Validator allows. Around a vertex of the tiling twenty cells meet, so their
// corner beads close into a pale node; around an edge five meet, so their edge beads close into a
// teal ring. The skeleton they trace repeats outward, shrinking exponentially. A two-sided lamp
// hangs at the center of the cell beside two small balls, and every copy of the cell holds a copy
// of the lamp, so the whole tiling is lit alike.

import type { SceneDescription, RenderStrategy, ObjectDescription, Vec3 } from '../src/compiler/types.js';
import { hyperbolicGeometry as H } from '../src/components/ambient/hyperbolic/hyperbolic.js';
import { SW_CIRCUMRADIUS, swBallInside } from '../src/components/quotient/seifert-weber/seifert-weber.js';
import type { Vec4 } from '../src/components/ambient/isometry.js';

const PHI = (1 + Math.sqrt(5)) / 2;
/** The Validator's margin between an object's bounding ball and a face (EPS_INTERFACE), with room. */
const MARGIN = 2e-3;

/** The 20 vertex directions of the dodecahedron dual to the face directions (0, ±1, ±φ), …. */
const VERTEX_DIRECTIONS: Vec3[] = (() => {
    const raw: Vec3[] = [];
    for (const a of [1, -1]) for (const b of [1, -1]) for (const c of [1, -1]) raw.push([a, b, c]);
    for (const a of [1, -1]) for (const b of [1, -1]) raw.push([a / PHI, 0, b * PHI], [0, a * PHI, b / PHI], [a * PHI, b / PHI, 0]);
    return raw.map((v) => { const n = Math.hypot(...v); return [v[0] / n, v[1] / n, v[2] / n] as Vec3; });
})();
const VERTICES: Vec4[] = VERTEX_DIRECTIONS.map((d) => H.exp([d[0] * SW_CIRCUMRADIUS, d[1] * SW_CIRCUMRADIUS, d[2] * SW_CIRCUMRADIUS]));

/** D's 30 edges: the vertex pairs at the least distance apart. */
const EDGES: Array<[number, number]> = (() => {
    const d = (i: number, j: number) => Math.acosh(-H.form(VERTICES[i], VERTICES[j]));
    let least = Infinity;
    for (let i = 0; i < 20; i++) for (let j = i + 1; j < 20; j++) least = Math.min(least, d(i, j));
    const out: Array<[number, number]> = [];
    for (let i = 0; i < 20; i++) for (let j = i + 1; j < 20; j++) if (d(i, j) < least + 1e-9) out.push([i, j]);
    return out;
})();

/** The point a fraction s of the way along the geodesic from p to q. */
function along(p: Vec4, q: Vec4, s: number): Vec4 {
    const d = Math.acosh(-H.form(p, q));
    const a = Math.sinh((1 - s) * d) / Math.sinh(d), b = Math.sinh(s * d) / Math.sinh(d);
    return [0, 1, 2, 3].map((k) => a * p[k] + b * q[k]) as Vec4;
}

/** The center of a ball of radius r pushed from the boundary point p toward o until it lies inside
 *  D with the margin (bisection along the geodesic to o, which stays in the bisector planes of the
 *  faces through p, so the ball ends equally far from each). In exp coordinates at o. */
function tucked(p: Vec4, r: number): Vec3 {
    const o: Vec4 = [0, 0, 0, 1];
    let lo = 0, hi = 1;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (swBallInside(along(p, o, mid), r + MARGIN)) hi = mid; else lo = mid;
    }
    return H.log(along(p, o, hi));
}

const CORNER_R = 0.24;
const BEAD_R = 0.12;
const skeleton: ObjectDescription[] = [
    ...VERTICES.map((v, i): ObjectDescription => ({
        type: 'sphere', parameters: { center: tucked(v, CORNER_R), radius: CORNER_R }, material: 'bone', name: `corner_${i}`,
    })),
    ...EDGES.map(([a, b], i): ObjectDescription => ({
        type: 'sphere', parameters: { center: tucked(along(VERTICES[a], VERTICES[b], 0.5), BEAD_R), radius: BEAD_R }, material: 'teal', name: `bead_${i}`,
    })),
];

export const seifertWeberRoomScene: SceneDescription = {
    id: 'seifert-weber-room',
    name: 'Seifert–Weber room (H³/Γ)',
    ambientSpace: { type: 'hyperbolic', quotient: { kind: 'seifert-weber' } },
    objects: [
        ...skeleton,
        { type: 'sphere', parameters: { center: [0.32, -0.3, 0.12], radius: 0.13 }, material: 'terracotta', name: 'terracotta_ball' },
        { type: 'sphere', parameters: { center: [-0.3, 0.26, -0.2], radius: 0.11 }, material: 'gold', name: 'gold_ball' },
    ],
    materials: {
        bone: { model: 'lambert', albedo: [0.84, 0.81, 0.74] },
        teal: { model: 'lambert', albedo: [0.18, 0.5, 0.54] },
        terracotta: { model: 'lambert', albedo: [0.78, 0.35, 0.22] },
        gold: { model: 'lambert', albedo: [0.85, 0.62, 0.24] },
    },
    lights: [
        // A two-sided lamp at the center: two disks back to back, warm above and paler below.
        { kind: 'disk', position: [0, 0.008, 0], normal: [0, 1, 0], radius: 0.13, emission: [42, 33, 22] },
        { kind: 'disk', position: [0, -0.008, 0], normal: [0, -1, 0], radius: 0.13, emission: [30, 28, 26] },
    ],
};

export const seifertWeberRoomStrategy: RenderStrategy = {
    id: 'pt-mis',
    measurement: {
        camera: { type: 'pinhole', fov: { param: 'camera.fov', default: 1.2, min: 0.4, max: 1.8 } },
        maxBounces: 6,
        // A closed manifold has no sky: a segment that meets nothing within 6 carries 0. Farther
        // copies of the skeleton are smaller than a pixel and only add speckle.
        farClip: 6,
    },
    estimator: { directLighting: 'mis', russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'agx' } },
};

export const seifertWeberRoomPtStrategy: RenderStrategy = {
    ...seifertWeberRoomStrategy,
    id: 'pt',
    estimator: { ...seifertWeberRoomStrategy.estimator, directLighting: 'none' },
};
