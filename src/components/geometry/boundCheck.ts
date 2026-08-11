// Bound containment, CPU-side (fable-sdf-contract §3/§6) — the checker that makes a
// declared march bound CHECKED rather than trusted. The failure modes are asymmetric:
// a bound that is too LOOSE only costs march steps; one that is too TIGHT silently
// clips geometry — surfaces vanish at the bound's wall with no error anywhere.
// Nothing in the type system can catch that, so sampling does.
//
// Two gates share this core:
//   · marchBound.test.ts — registry occupants, via the test-side field twins;
//   · the Validator      — scene-local `defineSDF` fields, via the definition's own
//     twin, over each authored object's RESOLVED values (the check runs where the
//     real parameter values are, so a value-dependent bound failure cannot hide).

import type { PrimitiveValues } from '../descriptors.js';
import type { AABB } from '../accel/bvh/bvh.js';

export type FieldFn = (p: number[], values: PrimitiveValues) => number;

/** Signed fields of the analytic BOUND primitives, host-side — exact one-line forms
 *  mirroring the GLSL. Every `marchBound` cross-type target is one of these (the
 *  contract test requires the target to be analytic with an `_interval`). Receives
 *  RESOLVED values (callers resolve; `center` defaults apply). The registry shapes'
 *  own twins stay test-side in fieldTwins.ts — this file ships, so it carries only
 *  what the compile-time gate needs. */
export const BOUND_FIELDS: Record<string, FieldFn> = {
    sphere: (p, v) => {
        const c = v.center as number[];
        return Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - (v.radius as number);
    },
    box: (p, v) => {
        const c = v.center as number[], h = v.halfSize as number[];
        const d = [0, 1, 2].map((i) => Math.abs(p[i] - c[i]) - h[i]);
        return Math.hypot(...d.map((x) => Math.max(x, 0))) + Math.min(Math.max(d[0], Math.max(d[1], d[2])), 0);
    },
    cylinder: (p, v) => {
        const c = v.center as number[];
        const dx = Math.hypot(p[0] - c[0], p[2] - c[2]) - (v.radius as number);
        const dy = Math.abs(p[1] - c[1]) - (v.halfHeight as number);
        return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
    },
};

export interface BoundContainment {
    /** Probes the field claims as interior (f < 0). Near-zero means the sample values
     *  produced no interior — a vacuous pass the caller should treat as suspicious. */
    interior: number;
    /** Interior probes that fell OUTSIDE the declared bound — any nonzero = clipping. */
    escaped: number;
    /** Worst escape depth (the bound field's value at the worst offender). */
    worst: number;
}

export interface Conservativeness {
    /** Worst sampled directional slope |f(x+hv) − f(x−hv)| / 2h. A field that never
     *  overestimates true distance has slope ≤ 1 EVERYWHERE (the sdf clauses);
     *  directional differences can never spuriously exceed the true Lipschitz
     *  constant, so worst > ~1 is PROOF of an overestimating field — the class
     *  whose renders show terraced walls/concentric rings (the marcher steps
     *  through geometry; fable-sdf-contract §4's conservativeness law). */
    worst: number;
    at: number[];
}

/** Sample directional slopes of `field` over `box` × `margin` — the CONSERVATIVENESS
 *  gate's core (fable-sdf-contract §4.3). Deterministic pseudo-random directions
 *  (LCG) so the gate is reproducible; h scales with the box diagonal. */
export function checkConservativeness(
    field: FieldFn,
    values: PrimitiveValues,
    box: AABB,
    grid = 17,
    margin = 1.2,
): Conservativeness {
    const c = [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2);
    const half = [0, 1, 2].map((i) => ((box.max[i] - box.min[i]) / 2) * margin);
    const diag = Math.hypot(...[0, 1, 2].map((i) => box.max[i] - box.min[i]));
    const h = Math.max(diag * 1e-4, 1e-7);
    let seed = 0x9e3779b9 >>> 0;
    const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
    let worst = 0;
    let at: number[] = [];
    for (let ix = 0; ix < grid; ix++) {
        for (let iy = 0; iy < grid; iy++) {
            for (let iz = 0; iz < grid; iz++) {
                const p = [ix, iy, iz].map((n, i) => c[i] + half[i] * (2 * (n / (grid - 1)) - 1));
                const v = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
                const n = Math.hypot(...v) || 1;
                const d = v.map((x) => (x / n) * h);
                const slope = Math.abs(
                    field([p[0] + d[0], p[1] + d[1], p[2] + d[2]], values)
                    - field([p[0] - d[0], p[1] - d[1], p[2] - d[2]], values),
                ) / (2 * h);
                if (slope > worst) { worst = slope; at = p; }
            }
        }
    }
    return { worst, at };
}

/** Sample `field` over `box` × `margin` on a grid³ lattice; every interior point must
 *  lie inside the bound (boundField ≤ 0). Exact up to fp noise — a one-grid-step
 *  tolerance would hide exactly the clipping this check exists for. */
export function checkBoundContainment(
    field: FieldFn,
    values: PrimitiveValues,
    boundField: FieldFn,
    boundValues: PrimitiveValues,
    box: AABB,
    grid = 26,
    margin = 1.6,
): BoundContainment {
    const c = [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2);
    const half = [0, 1, 2].map((i) => ((box.max[i] - box.min[i]) / 2) * margin);
    let interior = 0, escaped = 0, worst = 0;
    for (let ix = 0; ix < grid; ix++) {
        for (let iy = 0; iy < grid; iy++) {
            for (let iz = 0; iz < grid; iz++) {
                const p = [ix, iy, iz].map((n, i) => c[i] + half[i] * (2 * (n / (grid - 1)) - 1));
                if (field(p, values) >= 0) continue;
                interior++;
                const d = boundField(p, boundValues);
                if (d > 1e-9) { escaped++; worst = Math.max(worst, d); }
            }
        }
    }
    return { interior, escaped, worst };
}
