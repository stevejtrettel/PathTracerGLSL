// The closure contract test (impl-plan-placement-fold stage 1): `similarityClosed`
// is a DECLARED symmetry fact, so this suite verifies it in BOTH directions (the
// desugar-totality pattern — either drift direction fails):
//   declared TRUE  → for every test similarity g, surface points of g·Shape(v)
//                    satisfy Shape(fold(v, g))  (point-mapping equivariance, §8);
//   declared FALSE → the kind-derived fold GENUINELY drops R: for some rotated g,
//                    a mapped surface point violates membership of derivedFold's
//                    output — proving the residual (and the fold guard) is REQUIRED.
// Membership/sampling live here per shape; the completeness guard fails loudly for
// any registered primitive without them, so a new shape cannot skip the contract.

import { describe, it, expect } from 'vitest';
import {
    PRIMITIVES,
    primitive,
    classifyPlacement,
    derivedFold,
    foldPlacementIntoParameters,
    resolvePrimitiveValues,
    type PrimitiveValues,
} from '../../src/components/geometry/index.js';
import { FIELDS, projectToSurface } from './fieldTwins.js';
import {
    quatFromAxisAngle,
    similarityApplyPoint,
    similarityInverse,
    isIdentityRotation,
    isIdentityTranslation,
    IDENTITY_QUAT,
    type Similarity,
    type Vec3Tuple,
} from '../../src/components/geometry/similarity.js';

type V3 = Vec3Tuple;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 =>
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const normalize = (a: V3): V3 => mul(a, 1 / norm(a));
/** Any unit vector ⊥ n (n unit). */
const tangent = (n: V3): V3 => {
    const t = Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0] as V3) : cross(n, [1, 0, 0] as V3);
    return normalize(t);
};

const EPS = 1e-9;

/** Per-shape surface sampling + membership over CANONICAL values. Tolerances are
 *  absolute in world units — test fixtures keep coordinates O(1..10). */
interface ShapeGeometry {
    /** Representative authored values (pre-canonicalization). */
    values: PrimitiveValues;
    surfacePoints(v: PrimitiveValues): V3[];
    onSurface(v: PrimitiveValues, p: V3): boolean;
}

const v3 = (v: PrimitiveValues, k: string): V3 => v[k] as V3;
const f = (v: PrimitiveValues, k: string): number => v[k] as number;

const GEOMETRY: Record<string, ShapeGeometry> = {
    sphere: {
        values: { center: [1, -2, 0.5], radius: 1.5 },
        surfacePoints: (v) => {
            const c = v3(v, 'center'), r = f(v, 'radius');
            const dirs: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, -1],
                normalize([1, 1, 1]), normalize([-2, 1, 3])];
            return dirs.map((d) => add(c, mul(d, r)));
        },
        onSurface: (v, p) => Math.abs(norm(sub(p, v3(v, 'center'))) - f(v, 'radius')) < EPS * 100,
    },
    plane: {
        values: { normal: [0, 2, 1], offset: 0.75 },
        // Receives CANONICAL values (unit normal, scaled offset). House convention:
        // the plane is dot(p, n) + offset = 0 (plane.ts canonicalPlane).
        surfacePoints: (v) => {
            const n = v3(v, 'normal');
            const base = mul(n, -f(v, 'offset'));
            const t1 = tangent(n), t2 = cross(n, t1);
            return [[0, 0], [1, 0], [-0.5, 2], [3, -1]].map(([a, b]) =>
                add(add(base, mul(t1, a)), mul(t2, b)));
        },
        onSurface: (v, p) => Math.abs(dot(v3(v, 'normal'), p) + f(v, 'offset')) < EPS * 100,
    },
    quad: {
        values: { corner: [-1, 0, 2], edge1: [2, 0.5, 0], edge2: [0, 1, 1.5] },
        surfacePoints: (v) => {
            const c = v3(v, 'corner'), e1 = v3(v, 'edge1'), e2 = v3(v, 'edge2');
            return [[0, 0], [1, 0], [0, 1], [1, 1], [0.3, 0.7]].map(([a, b]) =>
                add(add(c, mul(e1, a)), mul(e2, b)));
        },
        onSurface: (v, p) => {
            const c = v3(v, 'corner'), e1 = v3(v, 'edge1'), e2 = v3(v, 'edge2');
            const d = sub(p, c);
            const g11 = dot(e1, e1), g12 = dot(e1, e2), g22 = dot(e2, e2);
            const det = g11 * g22 - g12 * g12;
            const a = (dot(d, e1) * g22 - dot(d, e2) * g12) / det;
            const b = (dot(d, e2) * g11 - dot(d, e1) * g12) / det;
            const rec = add(add(c, mul(e1, a)), mul(e2, b));
            return norm(sub(p, rec)) < EPS * 100
                && a > -1e-6 && a < 1 + 1e-6 && b > -1e-6 && b < 1 + 1e-6;
        },
    },
    disk: {
        values: { center: [0.5, 1, -1], radius: 2, normal: [1, 1, 0] },
        surfacePoints: (v) => {
            const c = v3(v, 'center'), r = f(v, 'radius'), n = normalize(v3(v, 'normal'));
            const t1 = tangent(n), t2 = cross(n, t1);
            const pts: V3[] = [c];
            for (const [rho, th] of [[1, 0], [1, 2.1], [0.4, 1.0], [1, 4.4]]) {
                pts.push(add(c, add(mul(t1, r * rho * Math.cos(th)), mul(t2, r * rho * Math.sin(th)))));
            }
            return pts;
        },
        onSurface: (v, p) => {
            const c = v3(v, 'center'), n = normalize(v3(v, 'normal'));
            const d = sub(p, c);
            return Math.abs(dot(n, d)) < EPS * 100 && norm(d) < f(v, 'radius') + EPS * 100;
        },
    },
    box: {
        values: { center: [1, 0, -2], halfSize: [1, 0.5, 2] },
        surfacePoints: (v) => {
            const c = v3(v, 'center'), h = v3(v, 'halfSize');
            const pts: V3[] = [];
            for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
                pts.push(add(c, [sx * h[0], sy * h[1], sz * h[2]]));
            }
            pts.push(add(c, [h[0], 0, 0]), add(c, [0, -h[1], 0.3]));
            return pts;
        },
        onSurface: (v, p) => {
            const c = v3(v, 'center'), h = v3(v, 'halfSize');
            const d = sub(p, c);
            const m = Math.max(Math.abs(d[0]) / h[0], Math.abs(d[1]) / h[1], Math.abs(d[2]) / h[2]);
            return Math.abs(m - 1) < 1e-7;
        },
    },
    cylinder: {
        values: { center: [0, 1, 0], radius: 0.8, halfHeight: 1.5 },
        surfacePoints: (v) => {
            const c = v3(v, 'center'), r = f(v, 'radius'), h = f(v, 'halfHeight');
            const pts: V3[] = [];
            for (const th of [0, 1.3, 2.9, 4.5]) {
                pts.push(add(c, [r * Math.cos(th), 0.5 * h, r * Math.sin(th)]));
                pts.push(add(c, [r * Math.cos(th), -h, r * Math.sin(th)]));
            }
            pts.push(add(c, [0, h, 0]));
            return pts;
        },
        onSurface: (v, p) => {
            const c = v3(v, 'center'), r = f(v, 'radius'), h = f(v, 'halfHeight');
            const d = sub(p, c);
            const rho = Math.hypot(d[0], d[2]);
            const inside = rho < r + 1e-7 && Math.abs(d[1]) < h + 1e-7;
            return inside && (Math.abs(rho - r) < 1e-7 || Math.abs(Math.abs(d[1]) - h) < 1e-7);
        },
    },
    // The marched shapes are CANONICAL (fable-sdf-contract §2): no center row, so
    // their geometry samples the origin-centred surface; translation never folds for
    // them (the canonical guard test below is the enforcement).
    torus: {
        values: { ringRadius: 1.4, tubeRadius: 0.35 },
        surfacePoints: (v) => {
            const R = f(v, 'ringRadius'), r = f(v, 'tubeRadius');
            const pts: V3[] = [];
            for (const th of [0, 1.1, 2.7, 4.9]) for (const ph of [0, 1.7, 3.4]) {
                const rho = R + r * Math.cos(ph);
                pts.push([rho * Math.cos(th), r * Math.sin(ph), rho * Math.sin(th)]);
            }
            return pts;
        },
        onSurface: (v, p) => Math.abs(fieldOf('torus', v, p)) < 1e-7,
    },
    // The FIELD-DEFINED shapes (bottle, knob, and the two fractals). Their surfaces have no
    // closed form to sample, so the twin does both jobs: seeds near the base shape are
    // Newton-projected onto {f = 0}, and membership is |f| under tolerance. This is the
    // pattern any future custom/expression field inherits — the fold contract does not
    // care how a surface is described, only that placement maps it onto the folded one.
    bottle: {
        values: {
            baseRadius: 0.6, baseHeight: 0.8, neckRadius: 0.2,
            neckHeight: 0.4, thickness: 0.05, rounded: 0.06, smoothJoin: 0.25, punt: 0.25,
        },
        // Seeded OUTSIDE the wall: the shell's field is |solid| − thickness, whose kink
        // sits exactly on the solid's own surface — a seed there has no gradient to
        // descend. Starting a few wall-thicknesses out lands on the outer face.
        surfacePoints: (v) => projected('bottle', v, seedRing([0, 0, 0], f(v, 'baseRadius') + 4 * f(v, 'thickness'), f(v, 'baseHeight'))),
        onSurface: (v, p) => Math.abs(fieldOf('bottle', v, p)) < 1e-6,
    },
    knob: {
        values: { radius: 0.9 },
        surfacePoints: (v) => projected('knob', v, seedSphere([0, 0, 0], f(v, 'radius') * 0.8)),
        onSurface: (v, p) => Math.abs(fieldOf('knob', v, p)) < 1e-6,
    },
    menger: {
        values: { size: 1.0, iterations: 3 },
        // Seeds on the cube's own faces: level 0 IS the box, so a face point is already
        // on the sponge wherever the iteration has not carved it away.
        surfacePoints: (v) => projected('menger', v, seedSphere([0, 0, 0], f(v, 'size') * 1.4)),
        onSurface: (v, p) => Math.abs(fieldOf('menger', v, p)) < 1e-6,
    },
    apollonian: {
        values: { size: 0.6, morph: 1.2, thickness: 0.03, iterations: 8 },
        surfacePoints: (v) => projected('apollonian', v, seedSphere([0, 0, 0], f(v, 'size') * 2.0)),
        onSurface: (v, p) => Math.abs(fieldOf('apollonian', v, p)) < 1e-6,
    },
};

const fieldOf = (type: string, v: PrimitiveValues, p: V3): number => FIELDS[type](p, v);

/** Seeds on a sphere about the shape's centre. */
const seedSphere = (c: V3, r: number): V3[] =>
    ([[1, 0.3, 0.2], [-1, 0.4, -0.3], [0.2, 1, 0.1], [0.1, -1, 0.4], [0.3, 0.2, 1], [-0.4, -0.2, -1]] as V3[])
        .map((d) => add(c, mul(normalize(d), r)));

/** Seeds on a ring about the shape's centre (bodies). */
const seedRing = (c: V3, radius: number, halfHeight: number): V3[] => {
    const pts: V3[] = [];
    for (const th of [0.2, 1.6, 3.0, 4.4, 5.8]) for (const y of [-0.6, 0, 0.6]) {
        pts.push(add(c, [radius * Math.cos(th), y * halfHeight, radius * Math.sin(th)]));
    }
    return pts;
};

/** Seeds Newton-projected onto the shape's zero set; stalled ones are dropped and the
 *  count is asserted, so a twin that stops converging fails loudly instead of quietly
 *  testing nothing. */
function projected(type: string, v: PrimitiveValues, seeds: V3[]): V3[] {
    const out = seeds
        .map((s) => projectToSurface((p) => FIELDS[type](p, v), s))
        .filter((p): p is number[] => p !== null)
        .map((p) => [p[0], p[1], p[2]] as V3);
    if (out.length < 3) throw new Error(`${type}: only ${out.length} seeds reached the surface — the twin or the seeds need attention`);
    return out;
}

/** Test similarities: identity, pure T, pure s, T+s (rotation-free set), and full
 *  TRS with off-axis rotations (the rotating set). */
const ROTATION_FREE: Similarity[] = [
    { rotation: IDENTITY_QUAT, translation: [0, 0, 0], scale: 1 },
    { rotation: IDENTITY_QUAT, translation: [3, -1, 0.5], scale: 1 },
    { rotation: IDENTITY_QUAT, translation: [0, 0, 0], scale: 2.5 },
    { rotation: IDENTITY_QUAT, translation: [-2, 4, 1], scale: 0.4 },
];
const ROTATING: Similarity[] = [
    { rotation: quatFromAxisAngle([0, 1, 0], Math.PI / 2), translation: [0, 0, 0], scale: 1 },
    { rotation: quatFromAxisAngle(normalize([1, 2, 3]), 0.7), translation: [1, -0.5, 2], scale: 1.7 },
    { rotation: quatFromAxisAngle([1, 0, 0], 1.1), translation: [-3, 0, 1], scale: 0.6 },
    { rotation: quatFromAxisAngle([0, 0, 1], Math.PI / 4), translation: [0.2, 0.2, 0.2], scale: 1 },
];

const canonical = (type: string, values: PrimitiveValues): PrimitiveValues => {
    const d = primitive(type);
    const resolved = resolvePrimitiveValues(d, values);
    return d.canonicalize !== undefined ? d.canonicalize(resolved) : resolved;
};

describe('similarityClosed contract (impl-plan-placement-fold)', () => {
    it('every registered primitive declares the fact and has test geometry', () => {
        for (const [type, d] of Object.entries(PRIMITIVES)) {
            if (d.local === true) continue;   // scene-local defineSDF fields carry their own gates
            expect(typeof d.similarityClosed, `${type}.similarityClosed`).toBe('boolean');
            expect(GEOMETRY[type], `GEOMETRY['${type}'] — add sampling/membership for the new primitive`).toBeDefined();
        }
    });

    for (const [type, geom] of Object.entries(GEOMETRY)) {
        const d = PRIMITIVES[type];
        if (d === undefined) continue;   // completeness test above catches the reverse gap

        if (d.similarityClosed) {
            it(`${type} (closed): equivariance under every test similarity`, () => {
                for (const g of [...ROTATION_FREE, ...ROTATING]) {
                    const v = canonical(type, geom.values);
                    const folded = foldPlacementIntoParameters(type, geom.values, g);
                    for (const p of geom.surfacePoints(v)) {
                        expect(geom.onSurface(folded, similarityApplyPoint(g, p)),
                            `${type}: g·p must lie on Shape(fold(v,g))`).toBe(true);
                    }
                }
            });
        } else {
            // A CANONICAL shape (fable-sdf-contract §2) has no point row: only scale
            // folds; translation must throw (it rides classifyPlacement's residual).
            const isCanonical = d.fold === undefined && !d.params.some((p) => p.kind === 'point');
            if (isCanonical) {
                it(`${type} (canonical): scale-only placements fold exactly`, () => {
                    for (const g of ROTATION_FREE.filter((g) => isIdentityTranslation(g.translation))) {
                        const v = canonical(type, geom.values);
                        const folded = foldPlacementIntoParameters(type, geom.values, g);
                        for (const p of geom.surfacePoints(v)) {
                            expect(geom.onSurface(folded, similarityApplyPoint(g, p)),
                                `${type}: s folds through the length rows`).toBe(true);
                        }
                    }
                });
                it(`${type} (canonical): foldPlacementIntoParameters guards translated placements`, () => {
                    expect(() => foldPlacementIntoParameters(type, geom.values,
                        { rotation: IDENTITY_QUAT, translation: [1, -2, 0.5], scale: 1 }))
                        .toThrow(/CANONICAL/);
                });
                it(`${type} (canonical): classifyPlacement routes T,s — rigid residual, scaled params`, () => {
                    const g: Similarity = { rotation: IDENTITY_QUAT, translation: [3, -1, 0.5], scale: 2.5 };
                    const v = canonical(type, geom.values);
                    const { parameters, residual } = classifyPlacement(type, geom.values, g);
                    expect(residual.scale).toBe(1);
                    expect(residual.translation).toEqual(g.translation);
                    const inv = similarityInverse(residual);
                    for (const p of geom.surfacePoints(v)) {
                        expect(geom.onSurface(parameters, similarityApplyPoint(inv, similarityApplyPoint(g, p))),
                            `${type}: residual⁻¹·g·p must lie on Shape(s·v)`).toBe(true);
                    }
                });
            } else {
                it(`${type} (open): rotation-free placements still fold exactly`, () => {
                    for (const g of ROTATION_FREE) {
                        const v = canonical(type, geom.values);
                        const folded = foldPlacementIntoParameters(type, geom.values, g);
                        for (const p of geom.surfacePoints(v)) {
                            expect(geom.onSurface(folded, similarityApplyPoint(g, p)),
                                `${type}: T,s fold through the kind rows`).toBe(true);
                        }
                    }
                });
            }
            it(`${type} (open): the kind-fold genuinely drops R — some rotated point escapes`, () => {
                const violated = ROTATING.some((g) => {
                    const v = canonical(type, geom.values);
                    const folded = derivedFold(primitive(type), v, g);
                    return geom.surfacePoints(v).some((p) => !geom.onSurface(folded, similarityApplyPoint(g, p)));
                });
                expect(violated, `${type}: declared open but no rotation broke the kind-fold — should it be similarityClosed?`).toBe(true);
            });
            it(`${type} (open): foldPlacementIntoParameters guards rotated placements`, () => {
                expect(() => foldPlacementIntoParameters(type, geom.values, ROTATING[0]))
                    .toThrow(/not similarityClosed/);
            });
        }
    }
});

describe('classifyPlacement (impl-plan-placement-fold stage 2: g·Shape(v) = residual · Shape(parameters))', () => {
    for (const [type, geom] of Object.entries(GEOMETRY)) {
        const d = PRIMITIVES[type];
        if (d === undefined) continue;

        it(`${type}: residual-reconstruction holds for every test similarity`, () => {
            for (const g of [...ROTATION_FREE, ...ROTATING]) {
                const v = canonical(type, geom.values);
                const { parameters, residual } = classifyPlacement(type, geom.values, g);
                const inv = similarityInverse(residual);
                for (const p of geom.surfacePoints(v)) {
                    // Pull g·p back through the residual — it must land on the folded shape.
                    expect(geom.onSurface(parameters, similarityApplyPoint(inv, similarityApplyPoint(g, p))),
                        `${type}: residual⁻¹·g·p must lie on Shape(parameters)`).toBe(true);
                }
                if (d.similarityClosed) {
                    expect(isIdentityRotation(residual.rotation), `${type}: closed → identity residual`).toBe(true);
                    expect(residual.scale).toBe(1);
                } else {
                    // Non-closed residual is at worst a PURE rotation (rigid tier — the
                    // s·d similarity correction is dead for constants).
                    expect(residual.scale).toBe(1);
                }
            }
        });
    }
});
