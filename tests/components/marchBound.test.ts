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
import {
    PRIMITIVES,
    canonicalizePrimitiveParameters,
    primitiveBounds,
    resolvePrimitiveValues,
    type PrimitiveValues,
} from '../../src/components/geometry/index.js';
import { checkConservativeness } from '../../src/components/geometry/boundCheck.js';
import { FIELDS } from './fieldTwins.js';


/** Is p inside the bounding primitive? (The bound is an analytic object, so "inside"
 *  is just its own field being negative — the same dichotomy the renderer uses.) */
function insideBound(boundType: string, boundValues: PrimitiveValues, p: number[]): number {
    const f = FIELDS[boundType];
    if (f === undefined) throw new Error(`marchBound test: no TS field twin for bound type '${boundType}'`);
    return f(p, resolvePrimitiveValues(PRIMITIVES[boundType], boundValues));
}

/** Sample values per primitive. The self-bounded analytic shapes are deliberately
 *  off-centre (a bound that ignores `center` cannot pass); the marched shapes are
 *  CANONICAL (fable-sdf-contract §2 — no center row), so their asymmetry lives in the
 *  bound's own y-offset (bottle/knob) and non-cubic extents. */
const SAMPLES: Record<string, PrimitiveValues> = {
    sphere: { center: [0.4, -0.2, 0.7], radius: 0.9 },
    box: { center: [-0.3, 0.5, 0.2], halfSize: [0.8, 0.35, 1.1] },
    cylinder: { center: [0.25, -0.4, -0.6], radius: 0.55, halfHeight: 0.9 },
    // The cross-type bounds (impl-plan-sdf-as-shape §2.2) — the cases this gate was
    // written for.
    torus: { ringRadius: 0.8, tubeRadius: 0.25 },
    bottle: {
        baseRadius: 0.5, baseHeight: 0.7, neckRadius: 0.18,
        neckHeight: 0.35, thickness: 0.04, rounded: 0.06, smoothJoin: 0.25, punt: 0.2,
    },
    knob: { radius: 0.8 },
    // The fractals: a subtractive construction whose cube bounds it exactly, and an IFS
    // whose bound is a MEASURED fit (apollonian.ts) — the case §2.4 was written for,
    // since nothing about an iterated inversion yields a closed-form envelope.
    menger: { size: 0.9, iterations: 4 },
    apollonian: { size: 0.5, morph: 1.2, thickness: 0.02, iterations: 8 },
};

const GRID = 26;      // 26³ ≈ 17.5k probes per shape — cheap, and dense enough that a
const MARGIN = 1.6;   // clipped face shows up. Grid spans the bound × MARGIN.

/** Interior probes of `shape` that fall outside `bound`, over the shape's AABB × MARGIN.
 *  Zero = the bound contains the shape. */
function escapedProbes(shapeType: string, values: PrimitiveValues, boundType: string, boundValues: PrimitiveValues): { interior: number; escaped: number; worst: number } {
    const box = primitiveBounds(shapeType, values)!;
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
        if (d.local === true) continue;   // scene-local fields: the Validator runs this gate per authored object
        if (d.marchBound === undefined || d.marchBound === 'unbounded') continue;

        it(`${key}: every interior point lies inside the declared bound`, () => {
            const values = resolvePrimitiveValues(d, SAMPLES[key]);
            const boundType = d.marchBound === 'self' ? d.type : (d.marchBound as { type: string }).type;
            const boundValues = d.marchBound === 'self'
                ? values
                : (d.marchBound as { values(v: PrimitiveValues): PrimitiveValues }).values(values);

            const box = primitiveBounds(key, values)!;
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
            const box = primitiveBounds(key, values)!;
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

// The CONSERVATIVENESS gate, registry side (fable-sdf-contract §4's law): a marched
// field must never claim MORE distance than is true — the marching architecture's one
// load-bearing axiom, and the one whose violation renders as terraced rings instead
// of failing loudly (the glass-lab night: a ½·f/|∇f_local| "safety factor" overshot
// where the gradient steepened ahead of the ray). Directional finite differences
// never exceed the true Lipschitz constant, so worst > 1 + FD-grace is PROOF.
describe('marched fields never overestimate distance (the conservativeness law)', () => {
    // DECLARED exceptions — a raised ceiling with a reason, never a silent blanket:
    //   knob: the VENDORED sdf-explorer math overestimates mildly (measured 1.036 —
    //   its smooth ops are the corpus's, not ours to fix). Opaque in every scene,
    //   and the sign-tracked march commits any crossing it steps over, so the
    //   violation degrades to correct geometry. The gate found it on its FIRST run.
    const DECLARED_SLOPE: Record<string, number> = { knob: 1.05 };
    for (const [key, d] of Object.entries(PRIMITIVES)) {
        if (d.local === true || !d.provides.sdf) continue;
        if (FIELDS[key] === undefined) continue;
        it(`${key}: sampled directional slope ≤ ${DECLARED_SLOPE[key] ?? 1.02}`, () => {
            const values = resolvePrimitiveValues(d, SAMPLES[key]);
            const box = primitiveBounds(key, values);
            if (box === null) return;   // unbounded (plane): exact field, nothing to fit a grid to
            const { worst, at } = checkConservativeness(FIELDS[key], values, box);
            expect(worst, `${key}: slope ${worst.toFixed(3)} at [${at.map((x) => x.toFixed(3)).join(', ')}] — the field overestimates; the marcher can step through walls`)
                .toBeLessThanOrEqual(DECLARED_SLOPE[key] ?? 1.02);
        });
    }
});

// The checker must be able to FAIL. The real cross-type bounds above (torus/bottle/
// knob/menger/apollonian) exercise it for keeps; these two synthetic cases prove the
// checker itself can reject — a cylinder bounded by a sphere, once honestly, once
// deliberately too small — so a passing suite is never mistaken for a vacuous one.
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

// The resolve pin (fable-sdf-contract §3): every descriptor function receives values
// that went through `canonicalizePrimitiveParameters` — THE resolve site. Before the
// pin, the Planner's driven and retained-frame paths shipped RAW authored values, so a
// driven bottle with defaulted optional rows fed NaN through bottleExtent and the
// object silently disappeared. This feeds each bound function EXACTLY what the Planner
// now hands it — the authored form with every optional row OMITTED — and requires
// finite numbers everywhere. (The old form of this test resolved values itself first,
// which is why it could never catch the violation.)
describe('bound functions receive resolved values (the fable-sdf-contract §3 pin)', () => {
    const flat = (v: PrimitiveValues): number[] =>
        Object.values(v).flatMap((x) => (Array.isArray(x) ? x : [x])) as number[];

    for (const [key, d] of Object.entries(PRIMITIVES)) {
        if (d.local === true) continue;
        const requiredOnly = Object.fromEntries(
            d.params.filter((p) => p.required).map((p) => [p.name, SAMPLES[key]?.[p.name]
                ?? (p.shape === 'vec3' ? [0.3, -0.2, 0.5] : 0.7)]),
        );

        it(`${key}: marchBound.values / bounds are finite on minimally-authored input`, () => {
            const v = canonicalizePrimitiveParameters(key, requiredOnly);
            const mb = d.marchBound;
            if (mb !== undefined && mb !== 'self' && mb !== 'unbounded') {
                for (const x of flat(mb.values(v))) {
                    expect(Number.isFinite(x), `${key}: marchBound.values produced a non-finite number — an optional row leaked through unresolved`).toBe(true);
                }
            }
            const box = primitiveBounds(key, requiredOnly);
            if (box !== null) {
                for (const x of [...box.min, ...box.max]) {
                    expect(Number.isFinite(x), `${key}: derived AABB is non-finite on minimal input`).toBe(true);
                }
            }
        });
    }
});
