// H²×R: the CPU geometry (components/ambient/h2xr/h2xr.ts), the GLSL decode of its isometry
// encoding (transcribed), and the fp64 twins of the occupant's and the bodies' math
// (tests/witnesses/scenes/h2xrTwins.ts) against independent computations: a numerical integration of
// the geodesic equations, the distance along the flow, finite differences of the exponential map,
// Monte Carlo irradiance that uses ray hits only, and sphere tracing with the exact distances. The
// derivations are in docs/claude-2026-11-review/curved/h2xr-plan.md.

import { describe, it, expect } from 'vitest';
import { h2xrGeometry as G, H2XR_SHIFT } from '../../src/components/ambient/h2xr/h2xr.js';
import { ORIGIN, mat4Apply, placementIsometry, tangentAtOrigin, type Mat4, type Vec4 } from '../../src/components/ambient/isometry.js';
import { curvedCameraBasis } from '../../src/components/camera/basis.js';
import { quatFromAxisAngle, type Vec3Tuple } from '../../src/components/geometry/similarity.js';
import {
    flow, dist, split, directionTo, areaDensity, skyKey, form, hform, lin, unit, exp, EY, O,
    planeRoot, diskRoot, cylinderRoot, ballRootNewton, ballRootBisect, shapeSdf, shapeNormal,
    diskEmitter, diskIrradiance, pointIrradiance, type Shape, type V4,
} from '../witnesses/scenes/h2xrTwins.js';

const close = (a: number[], b: number[], tol: number, what = '') => {
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i]), `${what} component ${i}: ${a[i]} vs ${b[i]}`).toBeLessThan(tol);
};

/** A deterministic generator (LCG). */
function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** A random point within `R` of o (exp coordinates) and a random unit tangent vector there; `vy`
 *  forces the vertical component (±1 for a vertical ray). */
function randomRay(r: () => number, R = 1.5, vy?: number): { p: V4; v: V4 } {
    const p = exp([R * (2 * r() - 1), R * (2 * r() - 1), R * (2 * r() - 1)]);
    let v = G.tangent(p, [2 * r() - 1, 2 * r() - 1, 2 * r() - 1, 2 * r() - 1]) as V4;
    if (vy !== undefined) {
        const h = G.tangent(p, [v[0], 0, v[2], v[3]]) as V4;
        const hn = Math.sqrt(form(h, h));
        const s = Math.sqrt(Math.max(0, 1 - vy * vy));
        v = hn === 0 || s === 0 ? [0, vy, 0, 0] : lin(h, s / hn, EY, vy);
    }
    return { p, v: unit(v) };
}

/** Two orthonormal tangent vectors at p orthogonal to the unit tangent v. */
function orthoPair(p: V4, v: V4): [V4, V4] {
    const axes: V4[] = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    const pick = (others: V4[]): V4 => {
        let best: V4 = [0, 0, 0, 0], bl = -1;
        for (const e of axes) {
            let w = G.tangent(p, e) as V4;
            for (const o of others) w = lin(w, 1, o, -form(w, o));
            const l2 = form(w, w);
            if (l2 > bl) { bl = l2; best = w; }
        }
        return lin(best, 1 / Math.sqrt(bl), best, 0);
    };
    const e1 = pick([v]);
    return [e1, pick([v, e1])];
}

describe('H²×R CPU geometry', () => {
    const vectors: Vec3Tuple[] = [[0.3, -0.2, 0.5], [1.2, 0.4, -0.7], [0, 2, 0], [0, 0, 2.5], [-0.01, 0.002, 0.003]];

    it('exp_o lands on the model at distance |v|, and log_o inverts it', () => {
        for (const v of vectors) {
            const p = exp(v);
            expect(Math.abs(hform(p, p) + 1)).toBeLessThan(1e-12);
            expect(dist(O, p)).toBeCloseTo(Math.hypot(...v), 10);
            close(G.log(p), v, 1e-12);
        }
    });

    it('the transvection takes o to exp_o(v) and carries the frame at o along the geodesic', () => {
        for (const v of vectors) {
            const T = G.transvection(v);
            close(G.apply(T, ORIGIN), exp(v), 1e-12);
            const d = Math.hypot(...v);
            if (d === 0) continue;
            // its direction goes to the geodesic's arrival velocity at exp_o(v)
            const u = tangentAtOrigin([v[0] / d, v[1] / d, v[2] / d]) as V4;
            close(G.applyTangent(T, u), flow(O, u, d).v, 1e-12);
        }
    });

    it('isometries preserve the metric, compose with their exact inverses to the identity, and add their shifts', () => {
        const g = placementIsometry(G, [0.5, -0.4, 0.8], quatFromAxisAngle([0, 1, 0], 1.1), [0.3, 0.7, -0.2]);
        const gi = G.inverse(g);
        close(G.compose(g, gi), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 1e-12);
        close(G.compose(gi, g), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 1e-12);
        expect(g[H2XR_SHIFT]).toBeCloseTo(-0.4 + 0.7, 14);
        const r = rng(7);
        for (let k = 0; k < 10; k++) {
            const { p, v } = randomRay(r);
            const { v: w } = randomRay(r);
            const wp = G.tangent(p, w) as V4;
            const q = G.apply(g, p) as V4;
            expect(Math.abs(hform(q, q) + 1)).toBeLessThan(1e-10);
            expect(dist(q, G.apply(g, flow(p, v, 0.7).p) as V4)).toBeCloseTo(0.7, 10);
            expect(form(G.applyTangent(g, v) as V4, G.applyTangent(g, wp) as V4)).toBeCloseTo(form(v, wp), 10);
            close(G.apply(gi, q), p, 1e-10);
        }
    });

    it('a placement T(position)·R(angle about y)·T(pre) puts the shape center at T(position)·exp_o(R·pre)', () => {
        const q = quatFromAxisAngle([0, 1, 0], 0.7);
        const g = placementIsometry(G, [0.2, 0.5, -0.3], q, [0.4, 0.3, 0]);
        const Rpre: Vec3Tuple = [0.4 * Math.cos(0.7), 0.3, -0.4 * Math.sin(0.7)];
        close(G.apply(g, ORIGIN), G.apply(G.transvection([0.2, 0.5, -0.3]), exp(Rpre)), 1e-12);
    });

    it('a rotation about a non-vertical axis is refused', () => {
        expect(() => G.rotation(quatFromAxisAngle([1, 0, 0], 0.3))).toThrow(/non-vertical/);
        expect(() => G.rotation(quatFromAxisAngle([0, 1, 0], 0.3))).not.toThrow();
    });
});

describe('the GLSL decode of the H²×R isometry encoding', () => {
    const g = placementIsometry(G, [0.5, -0.4, 0.8], quatFromAxisAngle([0, 1, 0], 1.1), [0.3, 0.7, -0.2]);
    const inv = G.inverse(g);
    const col = (m: Mat4, c: number): number[] => m.slice(4 * c, 4 * c + 4);
    // isometry_point: q = m·(p.x, 0, p.z, p.w); q.y = p.y + m[3][1]   (m[3][1] = m[13])
    const glslPoint = (m: Mat4, p: Vec4): Vec4 => { const q = mat4Apply(m, [p[0], 0, p[2], p[3]]); q[1] = p[1] + col(m, 3)[1]; return q; };
    // isometry_tangent: q = m·(v.x, 0, v.z, v.w); q.y = v.y
    const glslTangent = (m: Mat4, v: Vec4): Vec4 => { const q = mat4Apply(m, [v[0], 0, v[2], v[3]]); q[1] = v[1]; return q; };
    // isometry_direction: L = m with m[3][1] = 0; J·((J·v)·L), GLSL v·M the row-vector product
    const glslDirection = (m: Mat4, v: Vec4): Vec4 => {
        const L = m.slice(); L[13] = 0;
        const J = [1, 1, 1, -1];
        const Jv = v.map((x, i) => x * J[i]);
        return [0, 1, 2, 3].map((c) => J[c] * (Jv[0] * L[4 * c] + Jv[1] * L[4 * c + 1] + Jv[2] * L[4 * c + 2] + Jv[3] * L[4 * c + 3])) as Vec4;
    };

    it('isometry_point and isometry_tangent are apply and applyTangent', () => {
        const p = exp([0.2, -0.6, 0.4]);
        close(glslPoint(inv, p), G.apply(inv, p), 1e-14);
        const v = G.tangent(p, [0.3, 0.5, -0.2, 0.1]);
        close(glslTangent(inv, v), G.applyTangent(inv, v), 1e-14);
    });

    it('isometry_direction maps a normal from the object frame to the world from G⁻¹ alone (the shift stripped)', () => {
        for (const n of [tangentAtOrigin([0, 1, 0]), tangentAtOrigin([0.6, 0, 0.8]), tangentAtOrigin([0.3, 0.4, 0.2])]) {
            close(glslDirection(inv, n), G.applyTangent(g, n), 1e-12);
        }
        // without stripping, e_y picks up the shift in its w component
        const L = inv.slice();
        const unstripped = [0, 1, 2, 3].map((c) => [1, 1, 1, -1][c] * (L[4 * c + 1]));
        expect(Math.abs(unstripped[3])).toBeGreaterThan(0.1);
    });
});

describe('the H²×R geodesic flow, distance and direction', () => {
    it('agrees with RK4 of the geodesic equations h″ = ⟨h′,h′⟩_H·h, y″ = 0 (vertical, near-vertical, horizontal, generic)', () => {
        const r = rng(11);
        const rays = [
            ...Array.from({ length: 14 }, () => randomRay(r)),
            randomRay(r, 1.5, 1), randomRay(r, 1.5, -1), randomRay(r, 1.5, 1 - 5e-13), randomRay(r, 1.5, 0), randomRay(r, 1.5, 0.3), randomRay(r, 0.5, -0.9),
        ];
        const rhs = (y: number[]): number[] => {
            const h: V4 = [y[0], y[1], y[2], y[3]], v: V4 = [y[4], y[5], y[6], y[7]];
            const k = hform(v, v);
            return [...v, k * h[0], 0, k * h[2], k * h[3]];
        };
        for (const { p, v } of rays) {
            let y = [...p, ...v];
            let t = 0;
            const dt = 1e-3;
            for (const T of [0.3, 1, 3]) {
                while (t < T - 1e-12) {
                    const k1 = rhs(y), k2 = rhs(y.map((x, i) => x + dt / 2 * k1[i]));
                    const k3 = rhs(y.map((x, i) => x + dt / 2 * k2[i])), k4 = rhs(y.map((x, i) => x + dt * k3[i]));
                    y = y.map((x, i) => x + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
                    t += dt;
                }
                const f = flow(p, v, T);
                const scale = Math.max(1, Math.abs(f.p[3]));
                close(f.p, y.slice(0, 4), 1e-9 * scale, 'point');
                close(f.v, y.slice(4, 8), 1e-9 * scale, 'velocity');
                expect(form(f.v, f.v)).toBeCloseTo(1, 10);
                expect(hform(f.p, f.v)).toBeCloseTo(0, 10);
            }
        }
    });

    it('distance(p, γ(t)) = t and directionTo(p, γ(t)) = v', () => {
        const r = rng(12);
        for (let k = 0; k < 20; k++) {
            const { p, v } = k === 0 ? randomRay(r, 1, 1) : k === 1 ? randomRay(r, 1, 0) : randomRay(r);
            for (const t of [1e-3, 0.3, 1, 3]) {
                const q = flow(p, v, t).p;
                expect(Math.abs(dist(p, q) - t)).toBeLessThan(1e-10 * Math.max(1, t));
                close(directionTo(p, q), v, 1e-7);
            }
        }
    });
});

describe('the H²×R area density J = d²·sinh(D_H)/D_H', () => {
    it('equals the Gram determinant of finite differences of exp_p over the sphere of directions', () => {
        const r = rng(13);
        let worstIso = Infinity;
        for (let k = 0; k < 20; k++) {
            const { p, v } = randomRay(r, 1.2, k === 0 ? 1 : k === 1 ? 0 : undefined);
            const R = 0.3 + 1.5 * r();
            const [e1, e2] = orthoPair(p, v);
            const h = 1e-5;
            const at = (w: V4) => flow(p, unit(w), R).p;
            const Y = [e1, e2].map((e) => lin(at(lin(v, 1, e, h)), 1 / (2 * h), at(lin(v, 1, e, -h)), -1 / (2 * h)));
            const g11 = form(Y[0], Y[0]), g12 = form(Y[0], Y[1]), g22 = form(Y[1], Y[1]);
            const Jfd = Math.sqrt(g11 * g22 - g12 * g12);
            const q = flow(p, v, R).p;
            expect(Math.abs(Jfd / areaDensity(p, q) - 1)).toBeLessThan(1e-6);
            expect(Math.abs(areaDensity(q, p) / areaDensity(p, q) - 1)).toBeLessThan(1e-12);   // reciprocity
            const { DH } = split(p, q);
            if (DH > 0.2 && Math.abs(R * R - DH * DH) > 0.04) worstIso = Math.min(worstIso, Math.abs(Jfd / (R * R) - 1), Math.abs(Jfd / (R * Math.sinh(R)) - 1));
        }
        // the isotropic candidates (d², d·sinh d) are far off wherever the geodesic is oblique
        expect(worstIso).toBeGreaterThan(5e-3);
    });

    it('a disk light: the quadrature with J equals π·Le·P(a cosine-distributed geodesic meets its front face) (no density used)', () => {
        const e = diskEmitter([0.6, 1.0, 0], -1, 1.2, 2);
        const x = exp([0.25, 0, -0.15]);
        const [t1, t2] = orthoPair(x, EY);
        const r = rng(14);
        const N = 200000;
        let hits = 0;
        const c = e.c;
        for (let i = 0; i < N; i++) {
            const u1 = r(), u2 = r();
            const rr = Math.sqrt(u1), phi = 2 * Math.PI * u2;
            const v = unit(lin(lin(t1, rr * Math.cos(phi), t2, rr * Math.sin(phi)), 1, EY, Math.sqrt(Math.max(0, 1 - u1))));
            // a geodesic reaching the disk is at most d(x, c) + ρ long (longer, nearly horizontal ones
            // lose their H² part's digits in fp64); the arrival climbs (v.y > 0): the downward face
            const t = (c[1] - x[1]) / v[1];
            if (t < dist(x, c) + e.rho && split(flow(x, v, t).p, c).DH <= e.rho) hits++;
        }
        const P = hits / N;
        const mc = Math.PI * e.Le * P, se = Math.PI * e.Le * Math.sqrt(P * (1 - P) / N);
        const quad = diskIrradiance(x, EY, e);
        expect(Math.abs(mc - quad) / se).toBeLessThan(4);
        // an isotropic density in the quadrature is many standard errors away
        expect(Math.abs(mc - diskIrradiance(x, EY, e, (a, b) => dist(a, b) ** 2)) / se).toBeGreaterThan(10);
    });

    it('a point light: I·cos/J equals I·4π·P(an isotropic geodesic from the light lands in a small receiver disk)/area', () => {
        const q = exp([0.9, 0.9, 0.3]);   // β near 45° from x
        const I = 1.5, delta = 0.15;
        const x = exp([0, 0, 0]);
        const r = rng(15);
        const N = 1000000;
        let hits = 0;
        for (let i = 0; i < N; i++) {
            const z = 2 * r() - 1, phi = 2 * Math.PI * r(), sz = Math.sqrt(1 - z * z);
            const v = G.applyTangent(G.transvection(G.log(q)), [sz * Math.cos(phi), z, sz * Math.sin(phi), 0]) as V4;
            if (v[1] >= 0) continue;
            // a geodesic reaching the disk has length at most d(q, x) + delta; longer ones (nearly
            // horizontal, t in the hundreds) lose every digit of their H² part in fp64
            const t = (x[1] - q[1]) / v[1];
            if (t < 3 && split(flow(q, v, t).p, x).DH <= delta) hits++;
        }
        const area = 2 * Math.PI * (Math.cosh(delta) - 1);
        const P = hits / N;
        const mc = I * 4 * Math.PI * P / area, se = I * 4 * Math.PI * Math.sqrt(P * (1 - P) / N) / area;
        // the formula averaged over the same small disk (H² polar coordinates about x)
        let avg = 0, w = 0;
        for (let i = 0; i < 40; i++) for (let j = 0; j < 64; j++) {
            const s = delta * (i + 0.5) / 40, ph = 2 * Math.PI * j / 64;
            const y = exp([s * Math.cos(ph), 0, s * Math.sin(ph)]);
            avg += Math.sinh(s) * pointIrradiance(y, EY, q, I); w += Math.sinh(s);
        }
        avg /= w;
        expect(Math.abs(mc - avg) / se).toBeLessThan(4);
        let iso = 0;
        for (let i = 0; i < 40; i++) for (let j = 0; j < 64; j++) {
            const s = delta * (i + 0.5) / 40, ph = 2 * Math.PI * j / 64;
            iso += Math.sinh(s) * pointIrradiance(exp([s * Math.cos(ph), 0, s * Math.sin(ph)]), EY, q, I, (a, b) => dist(a, b) ** 2);
        }
        expect(Math.abs(mc - iso / w) / se).toBeGreaterThan(5);
    });
});

describe('the H²×R shape roots against sphere tracing with the exact distance', () => {
    /** First t > 0 at which the marched geodesic reaches the surface (|sdf| < 1e-11), and the
     *  smallest |sdf| seen (to set aside grazing rays). */
    function march(p: V4, v: V4, s: Shape): { t: number | null; closest: number } {
        let t = 0, closest = Infinity;
        for (let i = 0; i < 200000 && t < 10; i++) {
            const d = Math.abs(shapeSdf(flow(p, v, t).p, s));
            if (t > 1e-9) closest = Math.min(closest, d);
            if (d < 1e-11 && t > 1e-9) return { t, closest };
            t += Math.max(d, 1e-12);
        }
        return { t: null, closest };
    }
    const shapes: Array<[string, Shape, (p: V4, v: V4) => number | null]> = [
        ['horizontal plane', { kind: 'plane', normal: [0, -2, 0], offset: 0.6 }, (p, v) => planeRoot(p, v, { normal: [0, -2, 0], offset: 0.6 })],
        ['vertical plane', { kind: 'plane', normal: [1, 0, 0.5], offset: -0.3 }, (p, v) => planeRoot(p, v, { normal: [1, 0, 0.5], offset: -0.3 })],
        ['disk', { kind: 'disk', radius: 0.7, normal: [0, 1, 0] }, (p, v) => diskRoot(p, v, { radius: 0.7 })],
        ['cylinder', { kind: 'cylinder', radius: 0.5, halfHeight: 0.4 }, (p, v) => cylinderRoot(p, v, { radius: 0.5, halfHeight: 0.4 })],
        ['ball (Newton, the GLSL body)', { kind: 'sphere', radius: 0.6 }, (p, v) => ballRootNewton(p, v, { radius: 0.6 })],
        ['ball (golden section and bisection)', { kind: 'sphere', radius: 0.6 }, (p, v) => ballRootBisect(p, v, { radius: 0.6 })],
    ];
    for (const [name, shape, root] of shapes) {
        it(`${name}: the same first hit`, () => {
            const r = rng(name.length * 97 + 3);
            let hits = 0, compared = 0;
            for (let k = 0; k < 300; k++) {
                // aim at a random point near the shape, from a random start (some inside)
                const p = exp([2.4 * r() - 1.2, 2.4 * r() - 1.2, 2.4 * r() - 1.2]);
                const aim = exp([1.2 * r() - 0.6, 1.2 * r() - 0.6, 1.2 * r() - 0.6]);
                if (dist(p, aim) < 1e-3) continue;
                const v = k % 25 === 0 ? (unit([0, Math.sign(aim[1] - p[1]) || 1, 0, 0]) as V4) : directionTo(p, aim);
                const m = march(p, v, shape);
                if (m.closest < 1e-6 && m.t === null) continue;   // grazing within rounding of the surface
                if (shape.kind === 'disk' && m.t === null && m.closest < 1e-6) continue;
                const t0 = root(p, v);
                const t = t0 !== null && t0 < 10 ? t0 : null;   // the march stops at MAX_DIST
                compared++;
                if (m.t === null) { expect(t, `ray ${k}: root ${t}, march none`).toBeNull(); continue; }
                expect(t, `ray ${k}: march ${m.t}`).not.toBeNull();
                expect(Math.abs((t as number) - m.t)).toBeLessThan(1e-7 * Math.max(1, m.t));
                hits++;
            }
            expect(compared).toBeGreaterThan(250);
            expect(hits).toBeGreaterThan(40);
        });
    }

    it('the normals are unit, tangent and the gradient of the signed distance', () => {
        const r = rng(21);
        const cases: Shape[] = [{ kind: 'sphere', radius: 0.6 }, { kind: 'cylinder', radius: 0.5, halfHeight: 0.4 }, { kind: 'plane', normal: [1, 0, 0.5], offset: -0.3 }];
        for (const s of cases) {
            for (let k = 0; k < 20; k++) {
                let p = exp([2 * r() - 1, 2 * r() - 1, 2 * r() - 1]);
                if (s.kind === 'plane') {   // onto the plane, along the geodesic perpendicular to it
                    const N = shapeNormal(p, s);
                    p = flow(p, unit(G.tangent(p, N) as V4), -shapeSdf(p, s)).p;
                    expect(Math.abs(shapeSdf(p, s))).toBeLessThan(1e-12);
                }
                const n = shapeNormal(p, s);
                expect(form(n, n)).toBeCloseTo(1, 10);
                expect(hform(p, n)).toBeCloseTo(0, 10);
                // directional derivative of the sdf along n is 1 (h small, away from edges)
                const h = 1e-6;
                const dd = (shapeSdf(flow(p, unit(n), h).p, s) - shapeSdf(flow(p, unit(n), -h).p, s)) / (2 * h);
                if (s.kind === 'cylinder') {
                    const a = Math.asinh(Math.hypot(p[0], p[2])) - s.radius, b = Math.abs(p[1]) - s.halfHeight;
                    if (Math.abs(a - b) < 0.05 || (a > 0 && b > 0)) continue;   // edges, and the outside corner region
                }
                expect(dd).toBeCloseTo(1, 5);
            }
        }
    });
});

describe('the H²×R camera frame and sky key', () => {
    const poses: Array<[Vec3Tuple, Vec3Tuple]> = [[[0, 0.8, 0.8], [0, 0, 0]], [[0.9, 0.3, 0.8], [-0.3, 0.1, -0.4]], [[0.2, -0.5, -1.1], [0.6, 0.4, 0.3]]];

    it('is an orthonormal tangent frame at exp_o(position), forward reaches the target, up lies in the plane of forward and e_y', () => {
        for (const [position, target] of poses) {
            const b = curvedCameraBasis(G, position, target);
            close(b.position, exp(position), 1e-12);
            const P = b.position as V4, F = b.forward as V4, R = b.right as V4, U = b.up as V4;
            for (const v of [F, R, U]) {
                expect(hform(v, P)).toBeCloseTo(0, 10);
                expect(form(v, v)).toBeCloseTo(1, 10);
            }
            expect(form(F, R)).toBeCloseTo(0, 10);
            expect(form(F, U)).toBeCloseTo(0, 10);
            expect(form(R, U)).toBeCloseTo(0, 10);
            const T = exp(target);
            close(flow(P, F, dist(P, T)).p, T, 1e-9);
            // no roll: right is horizontal (⊥ e_y), so up is in the plane of forward and e_y
            expect(R[1]).toBeCloseTo(0, 12);
            expect(U[1]).toBeGreaterThan(0);
        }
    });

    it('the sky key is invariant along the flow, unit, the view direction at o, and (0, ±1, 0) for vertical rays', () => {
        const r = rng(31);
        for (let k = 0; k < 20; k++) {
            const { p, v } = randomRay(r);
            const k0 = skyKey(p, v);
            expect(Math.hypot(...k0)).toBeCloseTo(1, 12);
            const later = flow(p, v, 2.5);
            close(skyKey(later.p, later.v), k0, 1e-9);
            // the key is (sin β·ξ, cos β): ξ the H² part's ideal point (the Klein limit of γ(t)), β the
            // angle from the vertical
            const far = flow(p, v, 25).p;
            const xi = [far[0] / far[3], far[2] / far[3]];
            const sb = Math.sqrt(Math.max(0, 1 - v[1] * v[1]));
            close(k0, [sb * xi[0] / Math.hypot(xi[0], xi[1]), v[1], sb * xi[1] / Math.hypot(xi[0], xi[1])], 1e-6);
        }
        const d: V4 = unit([0.3, 0.5, -0.8, 0]);
        close(skyKey(O, d), [d[0], d[1], d[2]], 1e-14);
        close(skyKey(exp([0.7, 0.2, 0.4]), [0, 1, 0, 0]), [0, 1, 0], 1e-15);
        close(skyKey(exp([0.7, 0.2, 0.4]), [0, -1, 0, 0]), [0, -1, 0], 1e-15);
    });
});
