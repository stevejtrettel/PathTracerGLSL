// demos/bottleArrayScene.ts — THE TRANSLUCENCY WEDGE: twelve porcelain lanterns, one
// parameter grid.
//
// `porcelain` is the hero shot; this is the INSTRUMENT. Twelve copies of the same bottle
// shell, each with its own bulb inside it, laid out as a 4 × 3 grid over the two dials that
// decide what a subsurface medium looks like:
//
//   ACROSS (columns, left → right): the MEAN FREE PATH, halving each step, so the wall's
//     optical thickness DOUBLES: 0.625 → 1.25 → 2.5 → 5.0 free paths across 0.05 of wall
//     (σ_t = 12.5 → 25 → 50 → 100 per scene unit; radius IS the free path, so these are just
//     0.05/radius). Left is glass with barely a hint of milk in it; right is solidly ceramic.
//     This is the axis people mean by "how translucent is it".
//
//     WHY THE SWEEP STOPS AT 5 and not higher: the walk's length grows with the SQUARE of the
//     wall's optical thickness, so the next column would need ~4× the collisions to cross and
//     would start colliding with the maxBounces budget — and a truncated cell converges DARKER,
//     which would corrupt exactly the row-to-row comparison below. Key 3 is the instrument's
//     own validity check: if the right column brightens at maxBounces 128, this sweep is
//     truncated and the numbers here are wrong.
//
//   BACK (rows, front → back): the SCATTERING DIRECTION g, the Henyey–Greenstein anisotropy —
//     forward (g = +0.8), isotropic (g = 0), backward (g = −0.6). Front row scatters mostly
//     onward, middle row scatters every way equally, back row prefers to send light back the way
//     it came.
//
// WHAT THE ROW AXIS NOW TESTS — this changed, and the change is the point. Every cell in the grid
// is authored for the SAME TARGET COLOUR through `subsurfaceMedium`, and that inversion takes
// anisotropy: to hit one colour it asks for a HIGHER single-scattering albedo as scattering turns
// forward, because forward scattering wastes fewer bounces reversing direction. At this colour:
//
//     g = −0.6  →  α = 0.99791
//     g =  0    →  α = 0.99869
//     g = +0.8  →  α = 0.99974      (green channel of the target colour)
//
// so the three rows have genuinely different coefficients, chosen so that they should LOOK THE
// SAME. (The previous version of this card did the opposite — identical σ down each column with g
// bolted on afterwards — which is exactly the flaw that motivated adopting an anisotropy-aware
// inversion: the observed colour drifted with g.)
//
// AND THE CLAIM TO CHECK, which is sharper than the old one. That inversion is derived for a
// SEMI-INFINITE slab. These walls are not semi-infinite — they are between 0.6 and 5 free paths
// thick. So:
//
//     RIGHT-HAND columns (thick enough for the asymptotic argument): the three rows should look
//         nearly identical. That is the inversion doing its job.
//     LEFT-HAND columns (under one free path): the rows should visibly DIFFER, because the
//         assumption behind the inversion does not hold there and the phase function is still
//         visible as itself rather than as an average.
//
// The grid therefore measures the inversion's domain of validity, and the boundary between "rows
// agree" and "rows disagree" is the answer it reports. That is a more useful thing to know about
// our own parameterization than a restatement of similarity theory.
//
// COST WARNING, unmeasured: the forward row's α of 0.9997 means a path that stays inside absorbs
// only after thousands of collisions. Forward scattering also crosses a thin wall in fewer
// bounces, so the two effects fight and I have not measured which wins. If the front row is much
// slower than the others, that is why.
//
//   KEY 1 `wedge`     — the full estimate: mis, maxBounces 64, objectDispatch 'table'.
//   KEY 2 `noscatter` — scattering 'ignored'. All twelve collapse to the SAME clear glass:
//              every difference in the grid was the random walk, and none of it was the
//              surface. The bulbs snap into view in rows.
//   KEY 3 `wedge-128` — the same sweep at twice the path budget. Nothing should change; if
//              the right column brightens, the sweep is truncated (see WHY THE SWEEP STOPS).
//   KEY 4 `unrolled`  — objectDispatch 'unrolled', pixel-identical. Twelve SDF shells is
//              past the point where per-object boxes beat a global min-march, so this is the
//              LEAF_SDF cost A/B on a real scene: watch pathtracer ms/frame, not the image.
//
// Cost note: twelve marched shells cost about ONE shell per pixel under table dispatch (each
// ray descends the TLAS to the leaf it actually hits), which is what makes a grid this size
// affordable at all. The random walk inside the wall is the expense, and it does not care how
// many other bottles exist.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';
import { subsurfaceMedium } from '../src/authoring/subsurface.js';

// The shell — identical for all twelve. Local origin is the centre of the body cylinder with
// +Y up the neck, so standing one on the table means lifting it by baseHeight.
const SHELL = {
    baseRadius: 0.26, baseHeight: 0.34, neckRadius: 0.13, neckHeight: 0.22,
    thickness: 0.05, rounded: 0.06, smoothJoin: 0.13, punt: 0.10,
};
const WALL = SHELL.thickness;

/** The colour every cell is authored to read as — a porcelain white. Held fixed across the
 *  whole grid: the row axis changes only the phase function, and the inversion compensates. */
const TARGET_COLOR: [number, number, number] = [0.94, 0.92, 0.88];

/** Columns: the MEAN FREE PATH itself, halving each step. σ_t = 1/radius exactly, so the free
 *  paths across the 0.05 wall are just 0.05/radius — 0.625, 1.25, 2.5, 5.0. */
const COLUMNS = [0.08, 0.04, 0.02, 0.01];

/** Rows, front to back: the phase function. NOT identical coefficients — the inversion gives
 *  each row the α that reaches the shared target colour under its own g. */
const ROWS: { tag: string; g: number; z: number; offset: number }[] = [
    { tag: 'fwd', g: 0.8, z: 1.30, offset: 0.0 },      // forward  — needs the highest α
    { tag: 'iso', g: 0.0, z: 0.10, offset: 0.42 },     // isotropic — the reference row
    { tag: 'back', g: -0.6, z: -1.10, offset: 0.0 },   // backward — needs the lowest α
];

const SPACING = 0.85;
const columnX = (i: number) => (i - (COLUMNS.length - 1) / 2) * SPACING;

const objects: SceneDescription['objects'] = [
    {
        type: 'plane', name: 'table',
        parameters: { normal: [0, 1, 0], offset: 0 },
        material: 'slate',
    },
];
const materials: SceneDescription['materials'] = {
    slate: { model: 'lambert', albedo: [0.135, 0.132, 0.142] },
};
const lights: SceneDescription['lights'] = [];

for (const row of ROWS) {
    for (let c = 0; c < COLUMNS.length; c++) {
        const name = `p${c + 1}_${row.tag}`;
        const x = columnX(c) + row.offset;
        // ONE inversion call per cell, given the column's free path AND the row's anisotropy.
        // The inversion raises α as g turns forward so that every cell is aiming at the SAME
        // colour — which is what makes the row axis a test of the inversion rather than a
        // restatement of similarity theory. See the header.
        const medium = subsurfaceMedium({
            color: TARGET_COLOR, radius: COLUMNS[c], anisotropy: row.g,
        });
        materials[name] = {
            model: 'rough_dielectric',
            ior: 1.5,
            roughness: 0.12,
            medium,
        };
        objects.push({
            type: 'bottle', name: `b${c + 1}_${row.tag}`,
            parameters: { ...SHELL },
            material: name,
            transform: { position: [x, SHELL.baseHeight, row.z] },
        });
        // One bulb per vessel, all identical: the grid varies the medium, never the light.
        // Radius stays under the neck cavity (neckRadius − thickness) so it cannot plug its
        // own neck — the failure that cost an afternoon on the `porcelain` card.
        lights.push({
            kind: 'sphere',
            position: [x, SHELL.baseHeight + 0.14, row.z], radius: 0.06,
            emission: [40, 26, 15],
        });
    }
}

// Cool fill above the top of the frame, facing down — never in shot. Emitting normal is
// cross(edge1, edge2) = (0, −1, 0). Deliberately dim: the twelve bulbs are the picture.
lights.push({
    kind: 'quad',
    corner: [-3.0, 3.6, -2.4], edge1: [6.0, 0, 0], edge2: [0, 0, 4.4],
    emission: [1.1, 1.2, 1.5],
});

export const bottleArrayScene: SceneDescription = {
    id: 'porcelain-array',
    name: 'Translucency wedge (12 porcelain lanterns: free path × scattering direction)',
    ambientSpace: { type: 'euclidean' },
    objects,
    materials,
    lights,
    environment: { type: 'constant', color: [0.012, 0.014, 0.02], intensity: 1.0 },
};

/** Free paths across the wall per column — the axis label, for the card text. */
export const WEDGE_FREE_PATHS = COLUMNS.map((r) => WALL / r);
export const WEDGE_WALL = WALL;

const camera = { type: 'pinhole' as const, fov: 0.82 };

export const bottleArrayStrategy: RenderStrategy = {
    id: 'wedge',
    measurement: { camera, maxBounces: 64 },
    estimator: {
        directLighting: 'mis',
        // See sssLabScene.ts: a high-albedo walk barely dims, so the usual roulette ceiling
        // becomes the terminator and pays each survivor a compounding boost. Unbiased either
        // way — this is a variance choice, and these walls are tens of events deep.
        russianRoulette: { startDepth: 10, maxSurvival: 0.98 },
        volumeSampling: 'analytic',
        // Twelve marched shells: each ray descends the scene TLAS to the one leaf it hits
        // instead of min-marching all twelve fields at every step.
        objectDispatch: 'table',
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'agx' } },
};

/** Scattering off: all twelve become the same clear glass. */
export const bottleArrayNoScatterStrategy: RenderStrategy = {
    ...bottleArrayStrategy,
    id: 'noscatter',
    measurement: { camera, maxBounces: 64, scattering: 'ignored' },
};

/**
 * The instrument's validity check: the SAME sweep with twice the path budget. If any cell
 * brightens, that cell's walk was being cut off and its place in the wedge is a lie. The
 * dense right-hand column is where to look — its walk is the longest.
 */
export const bottleArrayDeepStrategy: RenderStrategy = {
    ...bottleArrayStrategy,
    id: 'wedge-128',
    measurement: { camera, maxBounces: 128 },
};

/** The dispatch A/B — pixel-identical, different cost. */
export const bottleArrayUnrolledStrategy: RenderStrategy = {
    ...bottleArrayStrategy,
    id: 'unrolled',
    estimator: { ...bottleArrayStrategy.estimator, objectDispatch: 'unrolled' },
};
