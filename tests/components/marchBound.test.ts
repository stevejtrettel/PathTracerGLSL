// The march bound CONTAINS the surface (impl-plan-sdf-as-shape §2.4).
//
// A shape that marches declares an analytic object bounding it, and the marched
// intersect only runs where the ray is inside that bound. The failure modes are
// asymmetric: a bound that is too LOOSE merely costs march steps, while a bound that
// is too TIGHT silently clips geometry — surfaces vanish at the bound's wall with no
// error anywhere. Nothing in the type system can catch that, so this test does, by
// sampling each shape's own field.
//
// The check: over a grid covering the bound and a margin around it, every point the
// shape claims as INSIDE (sdf < 0) must lie within the declared bound; and no point
// outside the bound may be inside the shape. Both directions matter — the first is
// the clipping guard, the second catches a bound attached to the wrong shape.
//
// This is the gate custom/expression distance fields inherit: when a hand-written
// field arrives with a hand-written bound, this is what proves the pair honest.

import { describe, it, expect } from 'vitest';
import { PRIMITIVES, resolvePrimitiveValues, type PrimitiveValues } from '../../src/components/geometry/index.js';

/** Signed distance TS twins — one per marchable primitive, transcribed from the GLSL
 *  (the .glsl is the shipping truth; these mirror it for the CPU-side gate). */
const FIELDS: Record<string, (p: number[], v: PrimitiveValues) => number> = {
    sphere: (p, v) => {
        const c = v.center as number[];
        return Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - (v.radius as number);
    },
    plane: (p, v) => {
        const n = v.normal as number[];
        return p[0] * n[0] + p[1] * n[1] + p[2] * n[2] + (v.offset as number);
    },
    box: (p, v) => {
        const c = v.center as number[], h = v.halfSize as number[];
        const d = [0, 1, 2].map((i) => Math.abs(p[i] - c[i]) - h[i]);
        const outside = Math.hypot(...d.map((x) => Math.max(x, 0)));
        return outside + Math.min(Math.max(d[0], Math.max(d[1], d[2])), 0);
    },
    cylinder: (p, v) => {
        const c = v.center as number[];
        const q = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
        const dx = Math.hypot(q[0], q[2]) - (v.radius as number);
        const dy = Math.abs(q[1]) - (v.halfHeight as number);
        return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
    },
};

/** Is p inside the bounding primitive? (The bound is an analytic object, so "inside"
 *  is just its own field being negative — the same dichotomy the renderer uses.) */
function insideBound(boundType: string, boundValues: PrimitiveValues, p: number[]): number {
    const f = FIELDS[boundType];
    if (f === undefined) throw new Error(`marchBound test: no TS field twin for bound type '${boundType}'`);
    return f(p, resolvePrimitiveValues(PRIMITIVES[boundType], boundValues));
}

/** Sample values per primitive — deliberately off-centre and non-cubic so a bound that
 *  ignores `center`, or swaps an axis, cannot pass. */
const SAMPLES: Record<string, PrimitiveValues> = {
    sphere: { center: [0.4, -0.2, 0.7], radius: 0.9 },
    box: { center: [-0.3, 0.5, 0.2], halfSize: [0.8, 0.35, 1.1] },
    cylinder: { center: [0.25, -0.4, -0.6], radius: 0.55, halfHeight: 0.9 },
};

const GRID = 26;      // 26³ ≈ 17.5k probes per shape — cheap, and dense enough that a
const MARGIN = 1.6;   // clipped face shows up. Grid spans the bound × MARGIN.

/** Interior probes of `shape` that fall outside `bound`, over the shape's AABB × MARGIN.
 *  Zero = the bound contains the shape. */
function escapedProbes(shapeType: string, values: PrimitiveValues, boundType: string, boundValues: PrimitiveValues): { interior: number; escaped: number; worst: number } {
    const box = PRIMITIVES[shapeType].bounds!(values);
    const c = [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2);
    const half = [0, 1, 2].map((i) => ((box.max[i] - box.min[i]) / 2) * MARGIN);
    let interior = 0, escaped = 0, worst = 0;
    for (let ix = 0; ix < GRID; ix++) {
        for (let iy = 0; iy < GRID; iy++) {
            for (let iz = 0; iz < GRID; iz++) {
                const p = [ix, iy, iz].map((n, i) => c[i] + half[i] * (2 * (n / (GRID - 1)) - 1));
                if (FIELDS[shapeType](p, values) >= 0) continue;
                interior++;
                const d = insideBound(boundType, boundValues, p);
                if (d > 1e-9) { escaped++; worst = Math.max(worst, d); }
            }
        }
    }
    return { interior, escaped, worst };
}

describe('march bounds contain their shapes', () => {
    for (const [key, d] of Object.entries(PRIMITIVES)) {
        if (d.marchBound === undefined || d.marchBound === 'unbounded') continue;

        it(`${key}: every interior point lies inside the declared bound`, () => {
            const values = resolvePrimitiveValues(d, SAMPLES[key]);
            const boundType = d.marchBound === 'self' ? d.type : (d.marchBound as { type: string }).type;
            const boundValues = d.marchBound === 'self'
                ? values
                : (d.marchBound as { values(v: PrimitiveValues): PrimitiveValues }).values(values);

            const box = d.bounds!(values);
            const c = [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2);
            const half = [0, 1, 2].map((i) => ((box.max[i] - box.min[i]) / 2) * MARGIN);

            let interior = 0, escaped = 0, worst = 0;
            for (let ix = 0; ix < GRID; ix++) {
                for (let iy = 0; iy < GRID; iy++) {
                    for (let iz = 0; iz < GRID; iz++) {
                        const p = [ix, iy, iz].map((n, i) => c[i] + half[i] * (2 * (n / (GRID - 1)) - 1));
                        const inShape = FIELDS[key](p, values);
                        if (inShape >= 0) continue;
                        interior++;
                        const inBound = insideBound(boundType, boundValues, p);
                        // Inside the shape ⇒ inside the bound. A tolerance of one grid
                        // step would hide exactly the clipping this test exists for, so
                        // the comparison is exact up to fp noise.
                        if (inBound > 1e-9) { escaped++; worst = Math.max(worst, inBound); }
                    }
                }
            }
            expect(interior, `${key}: the sample values produced no interior probes — fix SAMPLES`).toBeGreaterThan(100);
            expect(escaped, `${key}: ${escaped} interior points fell OUTSIDE the '${boundType}' bound (worst ${worst.toFixed(4)}) — the bound clips the shape`).toBe(0);
        });

        it(`${key}: the bound is not attached to the wrong shape (it must be reached)`, () => {
            // The dual: a bound so loose it is vacuous still passes above, but a bound
            // for a DIFFERENT shape usually leaves the surface unreached. Require the
            // shape's surface to come within a tenth of the bound's own extent.
            const values = resolvePrimitiveValues(d, SAMPLES[key]);
            const box = d.bounds!(values);
            const diag = Math.hypot(...[0, 1, 2].map((i) => box.max[i] - box.min[i]));
            const boundType = d.marchBound === 'self' ? d.type : (d.marchBound as { type: string }).type;
            const boundValues = d.marchBound === 'self'
                ? values
                : (d.marchBound as { values(v: PrimitiveValues): PrimitiveValues }).values(values);

            let closest = Infinity;
            for (let ix = 0; ix < GRID; ix++) {
                for (let iy = 0; iy < GRID; iy++) {
                    for (let iz = 0; iz < GRID; iz++) {
                        const p = [ix, iy, iz].map((n, i) => box.min[i] + (box.max[i] - box.min[i]) * (n / (GRID - 1)));
                        if (insideBound(boundType, boundValues, p) > 0) continue;   // outside the bound
                        closest = Math.min(closest, Math.abs(FIELDS[key](p, values)));
                    }
                }
            }
            expect(closest, `${key}: no probe inside the '${boundType}' bound lands near the surface`).toBeLessThan(diag * 0.1);
        });
    }

    it('an unbounded shape says so explicitly (plane is the standing instance)', () => {
        expect(PRIMITIVES.plane.marchBound).toBe('unbounded');
    });
});

// The checker must be able to FAIL. Every shape today declares `marchBound: 'self'`
// (bound ≡ shape, so containment holds trivially), which would leave the gate above
// vacuous and silently useless the day a real cross-type bound arrives. These two
// cases exercise it on the shape a future occupant will actually have: a cylinder
// bounded by a sphere — once honestly, once deliberately too small.
describe('the containment check itself catches a clipping bound', () => {
    const cyl: PrimitiveValues = { center: [0.25, -0.4, -0.6], radius: 0.55, halfHeight: 0.9 };
    const r = cyl.radius as number, h = cyl.halfHeight as number;

    it('accepts an honest sphere bound (radius = hypot(radius, halfHeight))', () => {
        const good = { center: cyl.center, radius: Math.hypot(r, h) };
        expect(escapedProbes('cylinder', cyl, 'sphere', good).escaped).toBe(0);
    });

    it('rejects a sphere bound shrunk by 10% — the clipping this gate exists for', () => {
        const bad = { center: cyl.center, radius: Math.hypot(r, h) * 0.9 };
        const { interior, escaped } = escapedProbes('cylinder', cyl, 'sphere', bad);
        expect(interior).toBeGreaterThan(100);
        expect(escaped, 'a 10%-small bound must leave interior points outside it').toBeGreaterThan(0);
    });
});
