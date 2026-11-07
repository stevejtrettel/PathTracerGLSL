// The curved box, cylinder and quad (H³ and S³) and the curved quad light, through their fp64 TS
// transcriptions (tests/witnesses/scenes/curvedShapeTwins.ts), checked against definitions that do
// not use the bodies' face normals: membership from chart coordinates and axis distances, the first
// change of membership along the marched geodesic, normals against finite differences of the
// defining functions, and the quad light's density against the rectangle's Gauss–Bonnet area. The
// witnesses (h3Shapes/s3Shapes, the quad lights) then check the GLSL against these transcriptions.

import { describe, it, expect } from 'vitest';
import {
    type Space, type V4, form, lin, scale, flow, tangentUnit,
    boxIntersect, boxNormal, boxSdf, boxInside,
    cylinderIntersect, cylinderNormal, cylinderSdf, cylinderInside,
    quadIntersect, quadNormal4, quadChart,
    quadLightNormal, quadLightPoint, quadLightAreaPdf, quadArea,
} from '../witnesses/scenes/curvedShapeTwins.js';
import { hyperbolicGeometry } from '../../src/components/ambient/hyperbolic/hyperbolic.js';
import { sphericalGeometry } from '../../src/components/ambient/spherical/spherical.js';
import { mat4Apply, placementIsometry, tangentAtOrigin, type CurvedGeometry } from '../../src/components/ambient/isometry.js';
import { quatFromAxisAngle } from '../../src/components/geometry/similarity.js';

type V3 = [number, number, number];
const geomOf = (S: Space): CurvedGeometry => (S === 'H3' ? hyperbolicGeometry : sphericalGeometry);
const exp = (S: Space, v: V3): V4 => geomOf(S).exp(v) as V4;
const TMAX = (S: Space) => (S === 'H3' ? 10 : 2 * Math.PI);

function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const randVec = (r: () => number, len: number): V3 => {
    let v: V3;
    do { v = [2 * r() - 1, 2 * r() - 1, 2 * r() - 1]; } while (Math.hypot(...v) > 1 || Math.hypot(...v) < 1e-3);
    const n = Math.hypot(...v);
    return [v[0] * len / n, v[1] * len / n, v[2] * len / n];
};
/** The unit direction at p of the geodesic to q (the chord projected onto T_p). */
const directionTo = (S: Space, p: V4, q: V4): V4 => tangentUnit(S, p, lin(q, 1, p, -1));

/** A ray aimed near the shape: from inside (a third of them) or from up to distance `far`, toward a
 *  point within `spread` of o. */
function aimedRay(S: Space, r: () => number, inner: number, far: number, spread: number): { p: V4; v: V4 } {
    const p = inner > 0 && r() < 0.33 ? exp(S, randVec(r, inner * r())) : exp(S, randVec(r, 0.3 + (far - 0.3) * r()));
    const q = exp(S, randVec(r, spread * r()));
    let v = directionTo(S, p, q);
    if (form(S, lin(q, 1, p, -1), lin(q, 1, p, -1)) < 1e-12) v = tangentUnit(S, p, [1, 0.3, -0.2, 0.1]);
    return { p, v };
}

/** The first crossing of the membership boundary along the geodesic, compared with the closed form
 *  tc: sampled at n steps on (0, TMAX), bisected; a closed-form root shorter than a step is accepted
 *  when membership flips across it and nothing flips before it. Returns |Δt| or a failure string. */
function marchCheck(S: Space, p: V4, v: V4, tc: number | null, inside: (x: V4) => boolean): { dt?: number; fail?: string } {
    const n = 4000, T = TMAX(S);
    const at = (t: number) => inside(flow(S, p, v, t).pos);
    const in0 = inside(p);
    let tm: number | null = null;
    for (let k = 1; k <= n && tm === null; k++) {
        let a = (T * (k - 1)) / n, b = (T * k) / n;
        if (k === n) b = T * (1 - 1e-12);
        if (at(b) === (k === 1 ? in0 : at(a))) continue;
        if (k === 1) a = 0;
        const ia = k === 1 ? in0 : at(a);
        for (let it = 0; it < 60; it++) { const m = 0.5 * (a + b); if (at(m) === ia) a = m; else b = m; }
        tm = 0.5 * (a + b);
    }
    if (tc === null) return tm === null ? {} : { fail: `closed form misses, march crosses at ${tm}` };
    const d = 1e-7 * Math.max(1, tc);
    if (at(tc - d) === at(tc + d)) return { fail: `no membership flip at the closed-form root ${tc}` };
    if (tm !== null && tm < tc - 1e-8) return { fail: `march crosses at ${tm} before the closed form ${tc}` };
    return { dt: tm === null || tm > tc + 1e-6 ? 0 : Math.abs(tm - tc) };
}

/** The orthonormal tangent frame at x from the coordinate axes. */
function tangentFrame(S: Space, x: V4): V4[] {
    const out: V4[] = [];
    for (const e of [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] as V4[]) {
        let w = lin(e, 1, x, S === 'H3' ? form(S, e, x) : -form(S, e, x));
        for (const o of out) w = lin(w, 1, o, -form(S, w, o));
        const l = form(S, w, w);
        if (l > 1e-6 && out.length < 3) out.push(scale(w, 1 / Math.sqrt(l)));
    }
    return out;
}
/** The metric gradient at x of f, unit (finite differences along geodesics of a tangent frame). */
function fdGradient(S: Space, x: V4, f: (y: V4) => number): V4 {
    const eps = 1e-6;
    let g: V4 = [0, 0, 0, 0];
    for (const e of tangentFrame(S, x)) g = lin(g, 1, e, (f(flow(S, x, e, eps).pos) - f(flow(S, x, e, -eps).pos)) / (2 * eps));
    return scale(g, 1 / Math.sqrt(form(S, g, g)));
}

interface ShapeCase {
    name: string;
    intersect: (p: V4, v: V4) => number | null;
    inside: (x: V4) => boolean;
    normal: (x: V4) => V4;
    /** The defining function of the face x lies on, decided without the body's normals. */
    faceFunction: (x: V4) => (y: V4) => number;
    sdf?: (x: V4) => number;
    /** A quad's edges and chart half-widths (T(a), T(b)). */
    quad?: { e1: V3; e2: V3; bounds: [number, number] };
}

function shapeCases(S: Space, r: () => number): ShapeCase[] {
    const T = (x: number) => (S === 'H3' ? Math.tanh(x) : Math.tan(x));
    const out: ShapeCase[] = [];
    for (let k = 0; k < 4; k++) {
        // Box half-widths inside the bounded domain: H³ Σ tanh² < 1, S³ below π/2.
        let h: number[];
        do { h = [0.1 + 1.1 * r(), 0.1 + 1.1 * r(), 0.1 + 1.1 * r()]; } while (S === 'H3' && h.reduce((s, x) => s + Math.tanh(x) ** 2, 0) >= 0.95);
        out.push({
            name: `box [${h.map((x) => x.toFixed(2))}]`,
            intersect: (p, v) => boxIntersect(S, p, v, h),
            inside: (x) => boxInside(S, x, h),
            normal: (x) => boxNormal(S, x, h),
            faceFunction: (x) => {
                let i = 0;
                for (let j = 1; j < 3; j++) if (Math.abs(x[j] / x[3]) / T(h[j]) > Math.abs(x[i] / x[3]) / T(h[i])) i = j;
                return (y) => y[i] / y[3];
            },
            sdf: (x) => boxSdf(S, x, h),
        });
        const cr = 0.1 + 1.2 * r(), ch = 0.1 + 1.3 * r();
        out.push({
            name: `cylinder r=${cr.toFixed(2)} h=${ch.toFixed(2)}`,
            intersect: (p, v) => cylinderIntersect(S, p, v, cr, ch),
            inside: (x) => cylinderInside(S, x, cr, ch),
            normal: (x) => cylinderNormal(S, x, cr, ch),
            faceFunction: (x) => {
                const axial = (y: V4) => (S === 'H3' ? Math.atanh(y[1] / y[3]) : Math.atan2(y[1], y[3]));
                const radial = (y: V4) => (S === 'H3' ? Math.asinh(Math.hypot(y[0], y[2])) : Math.atan2(Math.hypot(y[0], y[2]), Math.hypot(y[1], y[3])));
                return Math.abs(Math.abs(axial(x)) - ch) < Math.abs(radial(x) - cr) ? axial : radial;
            },
            sdf: (x) => cylinderSdf(S, x, cr, ch),
        });
        // Quad: orthogonal edges, a rotated frame, sizes inside the bounded domain.
        const e1 = randVec(r, 1);
        const e2raw = randVec(r, 1);
        const d = e1[0] * e2raw[0] + e1[1] * e2raw[1] + e1[2] * e2raw[2];
        const e2u: V3 = [e2raw[0] - d * e1[0], e2raw[1] - d * e1[1], e2raw[2] - d * e1[2]];
        const nn = Math.hypot(...e2u);
        let a: number, b: number;
        do { a = 0.1 + 1.1 * r(); b = 0.1 + 1.1 * r(); } while (S === 'H3' && Math.sinh(a) * Math.sinh(b) >= 0.95);
        const E1: V3 = [2 * a * e1[0], 2 * a * e1[1], 2 * a * e1[2]];
        const E2: V3 = [2 * b * e2u[0] / nn, 2 * b * e2u[1] / nn, 2 * b * e2u[2] / nn];
        const N = quadNormal4(E1, E2);
        out.push({
            name: `quad a=${a.toFixed(2)} b=${b.toFixed(2)}`,
            intersect: (p, v) => quadIntersect(S, p, v, E1, E2),
            // A thin shape: its "inside" is the side −N of its plane; the quad test below finds the
            // crossings of the plane and keeps those whose chart coordinates lie in the rectangle.
            inside: (x) => form(S, x, N) <= 0,
            normal: () => N,
            faceFunction: () => (y) => form(S, y, N),
            quad: { e1: E1, e2: E2, bounds: [T(a), T(b)] },
        });
    }
    return out;
}

for (const S of ['H3', 'S3'] as Space[]) {
    describe(`${S} box, cylinder and quad (fp64 transcriptions)`, () => {
        const r = rng(S === 'H3' ? 11 : 29);
        const cases = shapeCases(S, r);

        it('the closed-form first hit is the first change of membership along the marched geodesic', () => {
            let worst = 0, hits = 0, twoArc = 0;
            const fails: string[] = [];
            for (const c of cases) {
                if (c.quad !== undefined) continue;
                for (let i = 0; i < 120; i++) {
                    const { p, v } = aimedRay(S, r, 0.4, S === 'H3' ? 3 : 3, 1.0);
                    const tc = c.intersect(p, v);
                    const res = marchCheck(S, p, v, tc, c.inside);
                    if (res.fail !== undefined) fails.push(`${c.name}: ${res.fail}`);
                    else if (tc !== null) { hits++; worst = Math.max(worst, res.dt!); }
                    if (S === 'S3' && c.name.startsWith('cylinder')) {
                        // count geodesics meeting the (non-convex) capped tube in two arcs
                        let flips = 0, prev = c.inside(p);
                        for (let k = 1; k <= 2000; k++) { const now = c.inside(flow(S, p, v, (2 * Math.PI * k) / 2000).pos); if (now !== prev) flips++; prev = now; }
                        if (flips >= 4) twoArc++;
                    }
                }
            }
            expect(fails).toEqual([]);
            expect(hits).toBeGreaterThan(250);
            expect(worst).toBeLessThan(1e-8);
            if (S === 'S3') expect(twoArc).toBeGreaterThan(0);
        });

        it('the quad hit is the first crossing of its plane inside the chart rectangle', () => {
            let hits = 0;
            for (const c of cases.filter((x) => x.quad !== undefined)) {
                const q = c.quad!;
                for (let i = 0; i < 150; i++) {
                    const { p, v } = aimedRay(S, r, 0.0, 3, 1.0);
                    const tc = c.intersect(p, v);
                    // brute force: every plane crossing in (0, TMAX) by sign changes of x·N, the first
                    // whose point's chart coordinates lie in the rectangle
                    const f = (t: number) => c.faceFunction(p)(flow(S, p, v, t).pos);
                    const n = 4000, T = TMAX(S);
                    let tb: number | null = null;
                    for (let k = 1; k <= n && tb === null; k++) {
                        let lo = (T * (k - 1)) / n, hi = (T * k) / n;
                        if (Math.sign(f(lo)) === Math.sign(f(hi)) || f(lo) === 0) continue;
                        for (let it = 0; it < 60; it++) { const m = 0.5 * (lo + hi); if (Math.sign(f(m)) === Math.sign(f(lo))) lo = m; else hi = m; }
                        const t = 0.5 * (lo + hi);
                        const x = flow(S, p, v, t).pos;
                        const [k1, k2] = quadChart(x, q.e1, q.e2);
                        if (Math.abs(k1) <= q.bounds[0] && Math.abs(k2) <= q.bounds[1] && x[3] > 0) tb = t;
                    }
                    if (tb === null) expect(tc).toBeNull();
                    else { expect(tc).not.toBeNull(); expect(Math.abs(tc! - tb)).toBeLessThan(1e-8); hits++; }
                }
            }
            expect(hits).toBeGreaterThan(60);
        });

        it('normals are unit, tangent, outward, and the gradient of the face\'s defining function', () => {
            let checked = 0;
            for (const c of cases) {
                for (let i = 0; i < 80; i++) {
                    const { p, v } = aimedRay(S, r, 0.4, 3, 1.0);
                    const tc = c.intersect(p, v);
                    if (tc === null) continue;
                    const x = flow(S, p, v, tc).pos;
                    const n = c.normal(x);
                    expect(Math.abs(form(S, n, n) - 1)).toBeLessThan(1e-9);
                    expect(Math.abs(form(S, n, x))).toBeLessThan(1e-7);
                    const g = fdGradient(S, x, c.faceFunction(x));
                    expect(Math.abs(Math.abs(form(S, g, n)) - 1), `${c.name} direction`).toBeLessThan(1e-5);
                    if (c.quad === undefined) {
                        // outward: a short step along n leaves the solid, along −n enters it (points within
                        // 1e-4 of an edge are skipped: the step may cross the neighboring face)
                        const nearEdge = c.sdf !== undefined && [1, -1].some((sg) => {
                            for (const e of tangentFrame(S, x)) if (c.inside(flow(S, x, e, sg * 1e-4).pos) !== c.inside(flow(S, x, e, -sg * 1e-4).pos) && Math.abs(form(S, e, n)) < 0.5) return true;
                            return false;
                        });
                        if (nearEdge) continue;
                        expect(c.inside(flow(S, x, n, 1e-6).pos), `${c.name} outward`).toBe(false);
                        expect(c.inside(flow(S, x, n, -1e-6).pos), `${c.name} inward`).toBe(true);
                    }
                    checked++;
                }
            }
            expect(checked).toBeGreaterThan(150);
        });

        it('the sdf has the membership\'s sign, vanishes on the surface and never exceeds the distance to a boundary point', () => {
            for (const c of cases.filter((x) => x.sdf !== undefined)) {
                for (let i = 0; i < 200; i++) {
                    const x = exp(S, randVec(r, 1.6 * r() + 1e-3));
                    const d = c.sdf!(x);
                    if (Math.abs(d) > 1e-9) expect(d < 0, `${c.name} sign`).toBe(c.inside(x));
                    // any boundary point along a geodesic from x is at least sdf(x) away
                    if (d > 0) {
                        const v = tangentUnit(S, x, lin(exp(S, randVec(r, 0.5 * r())), 1, x, -1));
                        const t = c.intersect(x, v);
                        if (t !== null) expect(d).toBeLessThanOrEqual(t + 1e-12);
                    }
                }
                for (let i = 0; i < 60; i++) {
                    const { p, v } = aimedRay(S, r, 0.4, 3, 1.0);
                    const tc = c.intersect(p, v);
                    if (tc !== null) expect(Math.abs(c.sdf!(flow(S, p, v, tc).pos))).toBeLessThan(1e-8);
                }
            }
        });
    });

    describe(`${S} quad light (chart-uniform sampling)`, () => {
        const geom = geomOf(S);
        const r = rng(S === 'H3' ? 5 : 7);

        it('its normal is the isometry applied to ê1×ê2, and its samples lie on the rectangle', () => {
            for (let k = 0; k < 20; k++) {
                const g = placementIsometry(geom, randVec(r, 2 * r()), quatFromAxisAngle(randVec(r, 1), 6 * r()), [0, 0, 0]);
                const a = 0.2 + 0.6 * r(), b = 0.2 + 0.6 * r();
                const e1: V3 = [2 * a, 0, 0], e2: V3 = [0, 0, 2 * b];   // ê1×ê2 = −y
                const c = mat4Apply(g, [0, 0, 0, 1]) as V4;
                const E1 = mat4Apply(g, tangentAtOrigin(e1)) as V4, E2 = mat4Apply(g, tangentAtOrigin(e2)) as V4;
                const N = quadLightNormal(S, c, E1, E2);
                const want = mat4Apply(g, [0, -1, 0, 0]);
                for (let i = 0; i < 4; i++) expect(N[i]).toBeCloseTo(want[i], 10);
                const ginv = geom.inverse(g);
                for (let i = 0; i < 10; i++) {
                    const y = quadLightPoint(S, c, E1, E2, r(), r());
                    expect(Math.abs(form(S, y, y) - (S === 'H3' ? -1 : 1))).toBeLessThan(1e-10);
                    const x = mat4Apply(ginv, y) as V4;
                    expect(Math.abs(x[1])).toBeLessThan(1e-10);
                    const [k1, k2] = quadChart(x, e1, e2);
                    expect(Math.abs(k1)).toBeLessThanOrEqual((S === 'H3' ? Math.tanh(a) : Math.tan(a)) + 1e-12);
                    expect(Math.abs(k2)).toBeLessThanOrEqual((S === 'H3' ? Math.tanh(b) : Math.tan(b)) + 1e-12);
                }
            }
        });

        it('its density integrates to 1 over the rectangle: the mean of 1/pdf is the Gauss–Bonnet area', () => {
            for (const [a, b] of [[0.3, 0.5], [0.6, 0.7], [0.9, 0.4]]) {
                if (S === 'H3' && Math.sinh(a) * Math.sinh(b) >= 1) continue;
                const g = placementIsometry(geom, [0.4, -0.3, 0.5], quatFromAxisAngle([1, 2, 3], 0.7), [0, 0, 0]);
                const c = mat4Apply(g, [0, 0, 0, 1]) as V4;
                const E1 = mat4Apply(g, tangentAtOrigin([2 * a, 0, 0])) as V4, E2 = mat4Apply(g, tangentAtOrigin([0, 0, 2 * b])) as V4;
                const n = 400;
                let sum = 0;
                for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
                    const y = quadLightPoint(S, c, E1, E2, (i + 0.5) / n, (j + 0.5) / n);
                    sum += 1 / quadLightAreaPdf(S, c, E1, E2, y);
                }
                // midpoint rule: error O(n⁻²)
                expect(Math.abs(sum / (n * n) / quadArea(S, a, b) - 1)).toBeLessThan(2e-5);
            }
        });
    });
}
