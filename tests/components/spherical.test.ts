// The CPU geometry of S³ (components/ambient/spherical/spherical.ts) and the arithmetic of the S³
// occupant's GLSL that the light bodies and shapes rest on, through TS transcriptions: the
// row-vector product isometry_direction(G⁻¹, v) = v·G⁻¹ = G·v, the arc-aware shadow aim, the
// geodesic flow's arrival velocity on each arc, the plane root and the closed-form ball root
// (checked against marching the geodesic).

import { describe, it, expect } from 'vitest';
import { sphericalGeometry as S } from '../../src/components/ambient/spherical/spherical.js';
import { ORIGIN, mat4Apply, mat4Multiply, placementIsometry, tangentAtOrigin, type Mat4, type Vec4 } from '../../src/components/ambient/isometry.js';
import { curvedCameraBasis } from '../../src/components/camera/basis.js';
import { quatFromAxisAngle, quatRotate, type Vec3Tuple } from '../../src/components/geometry/similarity.js';

const close = (a: number[], b: number[], tol: number) => {
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i]), `component ${i}: ${a[i]} vs ${b[i]}`).toBeLessThan(tol);
};
const dot = (a: Vec4, b: Vec4) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const lin = (a: Vec4, s: number, b: Vec4, t: number): Vec4 => [0, 1, 2, 3].map((i) => a[i] * s + b[i] * t) as Vec4;
const norm = (a: Vec4) => Math.sqrt(dot(a, a));
const vectors: Vec3Tuple[] = [[0.3, -0.2, 0.5], [1.2, 0.4, -0.7], [0, 0, 2.5], [-0.01, 0.002, 0.003]];

// TS transcriptions of spherical.glsl.
const distance = (a: Vec4, b: Vec4) => 2 * Math.atan2(norm(lin(a, 1, b, -1)), norm(lin(a, 1, b, 1)));
const directionTo = (from: Vec4, to: Vec4): Vec4 => {
    const c = lin(to, 1, from, -1);
    const w = lin(c, 1, from, -dot(from, c));
    return lin(w, 1 / norm(w), w, 0);
};
const aim = (from: Vec4, along: Vec4, to: Vec4): { dir: Vec4; remaining: number } => {
    const d = distance(from, to), u = directionTo(from, to);
    return dot(along, u) > 0 ? { dir: u, remaining: d } : { dir: lin(u, -1, u, 0), remaining: 2 * Math.PI - d };
};
const flow = (p: Vec4, v: Vec4, t: number) => ({ pos: lin(p, Math.cos(t), v, Math.sin(t)), vel: lin(p, -Math.sin(t), v, Math.cos(t)) });
const mod = (x: number, m: number) => x - m * Math.floor(x / m);
const planeRoot = (p: Vec4, v: Vec4, N: Vec4): number => {
    let t = mod(Math.atan2(-dot(p, N), dot(v, N)), Math.PI);
    if (t <= 0) t += Math.PI;
    return t;
};
const ballRoot = (p: Vec4, v: Vec4, R: number): number | null => {
    const c = [p[1] * v[2] - p[2] * v[1], p[2] * v[0] - p[0] * v[2], p[0] * v[1] - p[1] * v[0]];
    const k = c[0] * c[0] + c[1] * c[1] + c[2] * c[2];
    const disc = Math.sin(R) ** 2 - k;
    if (disc < 0) return null;
    const phi = Math.atan2(v[3], p[3]), alpha = Math.atan2(Math.sqrt(disc), Math.cos(R));
    const inside = Math.atan2(Math.hypot(p[0], p[1], p[2]), p[3]) < R;
    const t = mod(inside ? phi + alpha : phi - alpha, 2 * Math.PI);
    return t > 0 ? t : null;
};

/** A random point of S³ and a unit tangent vector there (deterministic). */
function randomRay(seed: number): { p: Vec4; v: Vec4 } {
    let s = seed;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
    let p: Vec4 = [rnd(), rnd(), rnd(), rnd()];
    p = lin(p, 1 / norm(p), p, 0);
    let v: Vec4 = [rnd(), rnd(), rnd(), rnd()];
    v = lin(v, 1, p, -dot(v, p));
    return { p, v: lin(v, 1 / norm(v), v, 0) };
}

describe('S³ CPU geometry', () => {
    it('exp_o lands on the sphere at distance |v|, and log_o inverts it', () => {
        for (const v of vectors) {
            const p = S.exp(v);
            expect(Math.abs(S.form(p, p) - 1)).toBeLessThan(1e-12);
            expect(Math.acos(p[3])).toBeCloseTo(Math.hypot(...v), 10);
            close(S.log(p), v, 1e-12);
        }
    });

    it('the transvection takes o to exp_o(v), is orthogonal, and its transpose undoes it', () => {
        for (const v of vectors) {
            const T = S.transvection(v);
            close(mat4Apply(T, ORIGIN), S.exp(v), 1e-12);
            for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
                const ei: Vec4 = [0, 0, 0, 0]; ei[i] = 1;
                const ej: Vec4 = [0, 0, 0, 0]; ej[j] = 1;
                expect(S.form(mat4Apply(T, ei), mat4Apply(T, ej))).toBeCloseTo(i === j ? 1 : 0, 12);
            }
            close(mat4Multiply(S.inverse(T), T), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 1e-12);
        }
    });

    it('the transvection carries the frame at o along the geodesic: its direction is moved to the arrival velocity', () => {
        const v: Vec3Tuple = [0.6, -0.3, 0.9];
        const d = Math.hypot(...v);
        const u: Vec4 = [v[0] / d, v[1] / d, v[2] / d, 0];
        close(mat4Apply(S.transvection(v), u), flow(ORIGIN, u, d).vel, 1e-12);
    });

    it('a placement T(position)·R(rotation)·T(pre) puts the shape center at exp_o(position)∘exp_o(R·pre)', () => {
        const q = quatFromAxisAngle([0, 0, 1], 0.7);
        const pre: Vec3Tuple = [0.4, 0, 0];
        const g = placementIsometry(S, [0.2, 0.5, -0.3], q, pre);
        close(mat4Apply(g, ORIGIN), mat4Apply(S.transvection([0.2, 0.5, -0.3]), S.exp(quatRotate(q, pre))), 1e-12);
    });

    it('isometry_direction: v·G⁻¹ (GLSL v·M is the row-vector product) equals G·v', () => {
        const g = placementIsometry(S, [0.5, -0.4, 0.8], quatFromAxisAngle([1, 1, 0], 1.1), [0.3, 0.1, 0]);
        const inv = S.inverse(g);
        const rowTimes = (v: Vec4, M: Mat4): Vec4 => [0, 1, 2, 3].map((c) => v[0] * M[4 * c] + v[1] * M[4 * c + 1] + v[2] * M[4 * c + 2] + v[3] * M[4 * c + 3]) as Vec4;
        for (const n of [tangentAtOrigin([0, 1, 0]), tangentAtOrigin([0.6, 0, 0.8])]) close(rowTimes(n, inv), mat4Apply(g, n), 1e-12);
    });

    it('the camera frame is orthonormal and tangent at exp_o(position), and its forward reaches the target', () => {
        for (const [position, target] of [[[0, 0.8, 0.8], [0, 0, 0]], [[1.5, 0.3, -1.0], [0.2, 0.1, 0.4]]] as Array<[Vec3Tuple, Vec3Tuple]>) {
            const b = curvedCameraBasis(S, position, target);
            close(b.position, S.exp(position), 1e-12);
            for (const v of [b.forward, b.right, b.up]) {
                expect(dot(v, b.position)).toBeCloseTo(0, 10);
                expect(dot(v, v)).toBeCloseTo(1, 10);
            }
            expect(dot(b.forward, b.right)).toBeCloseTo(0, 10);
            expect(dot(b.forward, b.up)).toBeCloseTo(0, 10);
            expect(dot(b.right, b.up)).toBeCloseTo(0, 10);
            const T = S.exp(target);
            close(flow(b.position, b.forward, distance(b.position, T)).pos, T, 1e-9);
        }
    });
});

describe('S³ occupant arithmetic', () => {
    it('the two arcs: the long arc leaves along −u, reaches the same point after 2π − d, and arrives with the opposite velocity', () => {
        for (let i = 0; i < 20; i++) {
            const { p } = randomRay(100 + i);
            const { p: q } = randomRay(900 + i);
            const d = distance(p, q), u = directionTo(p, q);
            const short = flow(p, u, d), long = flow(p, lin(u, -1, u, 0), 2 * Math.PI - d);
            close(short.pos, q, 1e-9);
            close(long.pos, q, 1e-9);
            close(long.vel, lin(short.vel, -1, short.vel, 0), 1e-9);
            // the short arc's reversed arrival is direction_to(q, p)
            close(lin(short.vel, -1, short.vel, 0), directionTo(q, p), 1e-9);
        }
    });

    it('ambient_aim follows the arc the ray is on, so a long-arc shadow ray keeps its far part in range', () => {
        const { p } = randomRay(7);
        const { p: q } = randomRay(8);
        const u = directionTo(p, q), d = distance(p, q);
        const onShort = aim(p, u, q);
        close(onShort.dir, u, 1e-12);
        expect(onShort.remaining).toBeCloseTo(d, 12);
        const onLong = aim(p, lin(u, -1, u, 0), q);
        close(onLong.dir, lin(u, -1, u, 0), 1e-12);
        expect(onLong.remaining).toBeCloseTo(2 * Math.PI - d, 12);
        // re-aimed partway along the long arc, past the antipode, the rest of the arc is the short arc
        const mid = flow(p, onLong.dir, 2 * Math.PI - d - 0.3 * d);
        const rest = aim(mid.pos, mid.vel, q);
        expect(rest.remaining).toBeCloseTo(0.3 * d, 9);
    });

    it('the plane root is the first crossing of the great sphere, at most π ahead', () => {
        for (let i = 0; i < 200; i++) {
            const { p, v } = randomRay(31 + i);
            const { p: N0 } = randomRay(5000 + i);
            const t = planeRoot(p, v, N0);
            expect(t).toBeGreaterThan(0);
            expect(t).toBeLessThanOrEqual(Math.PI);
            expect(Math.abs(dot(flow(p, v, t).pos, N0))).toBeLessThan(1e-12);
            // no crossing before t: the sign of x·N does not change on (0, t)
            const s0 = Math.sign(dot(p, N0));
            for (let k = 1; k < 50; k++) expect(Math.sign(dot(flow(p, v, (t * k) / 50).pos, N0))).toBe(s0);
        }
    });

    it('the closed-form ball root matches marching the geodesic, from outside and from inside', () => {
        let hits = 0;
        for (let i = 0; i < 200; i++) {
            const { p, v } = randomRay(77 + i);
            const R = 0.3 + (i % 7) * 0.35;   // up to 2.4 (past π/2: the ball holds a hemisphere)
            const t = ballRoot(p, v, R);
            // march: the first sign change of dist(o, γ(t)) − R on (0, 2π), refined by bisection
            const f = (s: number) => { const x = flow(p, v, s).pos; return Math.atan2(Math.hypot(x[0], x[1], x[2]), x[3]) - R; };
            let tm: number | null = null;
            const n = 2000;
            for (let k = 2; k <= n && tm === null; k++) {
                let a = (2 * Math.PI * (k - 1)) / n, b = (2 * Math.PI * k) / n;
                if (Math.sign(f(a)) === Math.sign(f(b))) continue;
                for (let it = 0; it < 50; it++) { const m = 0.5 * (a + b); if (Math.sign(f(m)) === Math.sign(f(a))) a = m; else b = m; }
                tm = 0.5 * (a + b);
            }
            if (tm === null) expect(t).toBeNull();
            else { expect(t).not.toBeNull(); expect(Math.abs(t! - tm)).toBeLessThan(1e-9); hits++; }
        }
        expect(hits).toBeGreaterThan(50);
    });
});
