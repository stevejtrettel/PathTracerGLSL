// The CPU geometry of H³ (components/ambient/hyperbolic/hyperbolic.ts), the shared isometry algebra
// (components/ambient/isometry.ts) and the curved camera frame (components/camera/basis.ts): what
// the compiler bakes into placements and camera uniforms. The GLSL helpers that read them are
// pinned here too, through TS transcriptions of their arithmetic: the column-major layout GLSL's
// mat4 constructor reads, and isometry_direction's row-vector product J·((J·v)·G⁻¹) = G·v.

import { describe, it, expect } from 'vitest';
import { hyperbolicGeometry as H } from '../../src/components/ambient/hyperbolic/hyperbolic.js';
import { ORIGIN, mat4Apply, mat4Multiply, placementIsometry, rotationAtOrigin, tangentAtOrigin, type Mat4, type Vec4 } from '../../src/components/ambient/isometry.js';
import { cameraBasis, curvedCameraBasis } from '../../src/components/camera/basis.js';
import { formatMat4 } from '../../src/components/glsl-format.js';
import { quatFromAxisAngle, quatRotate, type Vec3Tuple } from '../../src/components/geometry/similarity.js';

const close = (a: number[], b: number[], tol: number) => {
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i]), `component ${i}: ${a[i]} vs ${b[i]}`).toBeLessThan(tol);
};
const J: Vec4 = [1, 1, 1, -1];
const vectors: Vec3Tuple[] = [[0.3, -0.2, 0.5], [1.2, 0.4, -0.7], [0, 0, 2.5], [-0.01, 0.002, 0.003]];

describe('H³ CPU geometry', () => {
    it('exp_o lands on the hyperboloid at distance |v|, and log_o inverts it', () => {
        for (const v of vectors) {
            const p = H.exp(v);
            expect(Math.abs(H.form(p, p) + 1)).toBeLessThan(1e-12);
            expect(Math.acosh(p[3])).toBeCloseTo(Math.hypot(...v), 10);
            close(H.log(p), v, 1e-12);
        }
    });

    it('the transvection takes o to exp_o(v), preserves the form, and its exact inverse undoes it', () => {
        for (const v of vectors) {
            const T = H.transvection(v);
            close(mat4Apply(T, ORIGIN), H.exp(v), 1e-12);
            // gᵀ·J·g = J, column by column: ⟨T e_i, T e_j⟩ = J_ij.
            for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
                const ei: Vec4 = [0, 0, 0, 0]; ei[i] = 1;
                const ej: Vec4 = [0, 0, 0, 0]; ej[j] = 1;
                expect(H.form(mat4Apply(T, ei), mat4Apply(T, ej))).toBeCloseTo(i === j ? J[i] : 0, 10);
            }
            close(mat4Multiply(H.inverse(T), T), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 1e-12);
        }
    });

    it('the transvection carries the frame at o along the geodesic: its direction is moved to the arrival velocity', () => {
        const v: Vec3Tuple = [0.6, -0.3, 0.9];
        const d = Math.hypot(...v);
        const u: Vec4 = [v[0] / d, v[1] / d, v[2] / d, 0];
        // velocity of the geodesic o → exp(v) at arc length d: sinh d·o + cosh d·u
        close(mat4Apply(H.transvection(v), u), [Math.cosh(d) * u[0], Math.cosh(d) * u[1], Math.cosh(d) * u[2], Math.sinh(d)], 1e-12);
    });

    it('a placement T(position)·R(rotation)·T(pre) puts the shape center at exp_o(position)∘exp_o(R·pre)', () => {
        const q = quatFromAxisAngle([0, 0, 1], 0.7);
        const pre: Vec3Tuple = [0.4, 0, 0];
        const g = placementIsometry(H, [0.2, 0.5, -0.3], q, pre);
        close(mat4Apply(g, ORIGIN), mat4Apply(H.transvection([0.2, 0.5, -0.3]), H.exp(quatRotate(q, pre))), 1e-12);
        expect(rotationAtOrigin(q)[15]).toBe(1);
    });
});

describe('the GLSL side of a placement', () => {
    it('matrices are column-major: GLSL mat4(m0..m15)·v reads column c from m[4c..4c+3]', () => {
        const m = Array.from({ length: 16 }, (_, i) => i + 1);
        expect(formatMat4(m)).toBe(`mat4(${m.map((x) => `${x}.0`).join(', ')})`);
        for (let c = 0; c < 4; c++) {
            const e: Vec4 = [0, 0, 0, 0]; e[c] = 1;
            expect(mat4Apply(m, e)).toEqual(m.slice(4 * c, 4 * c + 4));
        }
    });

    it('isometry_direction: J·((J·v)·G⁻¹) — GLSL v·M is the row-vector product — equals G·v', () => {
        const g = placementIsometry(H, [0.5, -0.4, 0.8], quatFromAxisAngle([1, 1, 0], 1.1), [0.3, 0.1, 0]);
        const inv = H.inverse(g);
        const rowTimes = (v: Vec4, M: Mat4): Vec4 => [0, 1, 2, 3].map((c) => v[0] * M[4 * c] + v[1] * M[4 * c + 1] + v[2] * M[4 * c + 2] + v[3] * M[4 * c + 3]) as Vec4;
        for (const n of [tangentAtOrigin([0, 1, 0]), tangentAtOrigin([0.6, 0, 0.8])]) {
            const Jn = n.map((x, i) => x * J[i]) as Vec4;
            const out = rowTimes(Jn, inv).map((x, i) => x * J[i]);
            close(out, mat4Apply(g, n), 1e-12);
        }
    });
});

describe('the curved camera frame (target-centered up rule)', () => {
    const poses: Array<[Vec3Tuple, Vec3Tuple]> = [[[0, 0.8, 0.8], [0, 0, 0]], [[1.5, 0.3, -1.0], [0.2, 0.1, 0.4]], [[0, 0, 0], [0, 0, -1]]];

    it('is an orthonormal tangent frame at exp_o(position) whose forward points at the target', () => {
        for (const [position, target] of poses) {
            const b = curvedCameraBasis(H, position, target);
            close(b.position, H.exp(position), 1e-12);
            const F = b.forward, R = b.right, U = b.up, P = b.position;
            for (const v of [F, R, U]) {
                expect(H.form(v, P)).toBeCloseTo(0, 10);
                expect(H.form(v, v)).toBeCloseTo(1, 10);
            }
            expect(H.form(F, R)).toBeCloseTo(0, 10);
            expect(H.form(F, U)).toBeCloseTo(0, 10);
            expect(H.form(R, U)).toBeCloseTo(0, 10);
            // the geodesic from P along F reaches the target at their distance
            const T = H.exp(target);
            const d = Math.acosh(-H.form(P, T));
            close(P.map((x, i) => Math.cosh(d) * x + Math.sinh(d) * F[i]), T, 1e-9);
        }
    });

    it('with the target at o it is the Euclidean look-at carried to the camera point', () => {
        const position: Vec3Tuple = [0.5, 0.9, 1.3];
        const b = curvedCameraBasis(H, position, [0, 0, 0]);
        const e = cameraBasis(position, [0, 0, 0]);
        const T = H.transvection(position);
        close(b.right, mat4Apply(T, tangentAtOrigin(e.right)), 1e-12);
        close(b.up, mat4Apply(T, tangentAtOrigin(e.up)), 1e-12);
    });

    it('an orbit at fixed elevation is a rotation about the target: the frame expressed at the target does not roll', () => {
        const target: Vec3Tuple = [0.6, 0.2, -0.4];
        const TT = H.transvection(target), TTi = H.inverse(TT);
        // camera positions on the orbit: target ∘ exp_o(d·u(az, el)), expressed in exp coordinates at o
        const el = 0.4, d = 1.2;
        const ups = [0, 1.3, 2.6].map((az) => {
            const u: Vec3Tuple = [d * Math.cos(el) * Math.sin(az), d * Math.sin(el), d * Math.cos(el) * Math.cos(az)];
            const position = H.log(mat4Apply(TT, H.exp(u)));
            const b = curvedCameraBasis(H, position, target);
            return mat4Apply(TTi, b.up);   // the up vector pulled back so the target is at o
        });
        // pulled back, the camera sits on the sphere of radius d about o, and up has the same
        // component along the vertical +y-tangent transported there for every azimuth
        const heights = ups.map((u) => u[1]);
        for (const h of heights) expect(h).toBeCloseTo(heights[0], 9);
    });
});
