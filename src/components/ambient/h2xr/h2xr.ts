// components/ambient/h2xr/h2xr.ts
// The CPU geometry of H²×R — the same space h2xr.glsl computes on the GPU. A point is
// (x, y, z, w): the height is y, and (x, z, w) lies on the hyperboloid x² + z² − w² = −1, w > 0.
// The origin is o = (0,0,0,1). The metric on tangent vectors is the Minkowski form
// a₁b₁ + a₂b₂ + a₃b₃ − a₄b₄ (the H² part's form plus the height's square).
//
// An isometry here is (B, c): B ∈ SO⁺(2,1) on (x, z, w) and a height shift c. It is not linear on
// the 4-vector (a translation of R is affine), so the mat4 holding it is an encoding: entry m[13]
// (column 3, row 1) is c, and the rest of m is B on (x, z, w) and the identity on y. The identity
// mat4 is the identity isometry. Rotations are those about the vertical axis only (the π-turns
// about a horizontal axis, an H² reflection with y ↦ −y, are isometries too but are not built).

import type { Quat, Vec3Tuple } from '../../geometry/similarity.js';
import type { CurvedGeometry, Mat4, Vec4 } from '../isometry.js';
import { mat4Apply, mat4Multiply, mat4Transpose, rotationAtOrigin } from '../isometry.js';
import type { RowConstraint } from '../../descriptors.js';
import { hyperbolicGeometry } from '../hyperbolic/hyperbolic.js';

/** The entry of the mat4 encoding that holds the height shift (column 3, row 1). */
export const H2XR_SHIFT = 13;

/** A row holding a vertical direction in H²×R (the disk's normal: disks are horizontal). */
export const H2XR_VERTICAL: RowConstraint = { kind: 'vertical' };
/** A row holding a direction that is vertical or horizontal (a plane's normal: the totally geodesic
 *  surfaces of H²×R are the horizontal planes H²×{c} and the vertical planes γ×R). */
export const H2XR_VERTICAL_OR_HORIZONTAL: RowConstraint = { kind: 'vertical-or-horizontal' };

const J: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1];

/** The metric on tangent vectors: the Minkowski form of R^{3,1}. */
const form = (a: Vec4, b: Vec4): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] - a[3] * b[3];

/** The form of R^{2,1} on the H² parts (x, z, w); y is ignored. */
export const h2Form = (a: Vec4, b: Vec4): number => a[0] * b[0] + a[2] * b[2] - a[3] * b[3];

/** m without its height shift: the linear part (B on (x, z, w), identity on y). */
function linear(m: Mat4): Mat4 {
    const l = m.slice();
    l[H2XR_SHIFT] = 0;
    return l;
}

const withShift = (m: Mat4, c: number): Mat4 => {
    m[H2XR_SHIFT] = c;
    return m;
};

export const h2xrGeometry: CurvedGeometry = {
    form,

    // exp_o(v) = (sinhc(s)·v.x, v.y, sinhc(s)·v.z, cosh s) with s = |(v.x, v.z)|.
    exp(v: Vec3Tuple): Vec4 {
        const s = Math.hypot(v[0], v[2]);
        const k = s === 0 ? 1 : Math.sinh(s) / s;
        return [k * v[0], v[1], k * v[2], Math.cosh(s)];
    },

    // log_o(p) = (asinhc(r)·p.x, p.y, asinhc(r)·p.z) with r = |(p.x, p.z)| (the asinh form keeps
    // precision near the vertical axis).
    log(p: Vec4): Vec3Tuple {
        const r = Math.hypot(p[0], p[2]);
        const k = r === 0 ? 1 : Math.asinh(r) / r;
        return [k * p[0], p[1], k * p[2]];
    },

    // The H² boost by (v.x, v.z) — H³'s transvection by the horizontal vector (v.x, 0, v.z), which
    // leaves row and column 1 alone — and the height shift v.y.
    transvection: (v: Vec3Tuple): Mat4 => withShift(hyperbolicGeometry.transvection([v[0], 0, v[2]]), v[1]),

    // (B, c)⁻¹ = (B⁻¹, −c), B⁻¹ = J·Bᵀ·J (the linear part preserves the form).
    inverse: (g: Mat4): Mat4 => withShift(mat4Multiply(J, mat4Multiply(mat4Transpose(linear(g)), J)), -g[H2XR_SHIFT]),

    // (B_a, c_a)∘(B_b, c_b) = (B_a·B_b, c_a + c_b): no isometry here flips the height.
    compose: (a: Mat4, b: Mat4): Mat4 => withShift(mat4Multiply(linear(a), linear(b)), a[H2XR_SHIFT] + b[H2XR_SHIFT]),

    // (B·(x, z, w), y + c).
    apply(g: Mat4, p: Vec4): Vec4 {
        const q = mat4Apply(linear(g), p);
        q[1] = p[1] + g[H2XR_SHIFT];
        return q;
    },

    applyTangent: (g: Mat4, v: Vec4): Vec4 => mat4Apply(linear(g), v),

    // diag(R, 1) is an isometry exactly when R fixes the vertical: a rotation about the y axis
    // (column and row 1 of R are e_y). That leaves the shift entry 0.
    rotation(q: Quat): Mat4 {
        const m = rotationAtOrigin(q);
        if (m[4] !== 0 || m[5] !== 1 || m[6] !== 0 || m[1] !== 0 || m[9] !== 0) {
            throw new Error('h2xr: a rotation about a non-vertical axis is not an isometry of H²×R built here (the Validator rejects it)');
        }
        return m;
    },

    // v + ⟨v, p_H⟩_H·p_H: the H² part projected onto T_{p_H}H² (⟨p_H, p_H⟩_H = −1); y is free.
    tangent(p: Vec4, v: Vec4): Vec4 {
        const k = h2Form(v, p);
        return [v[0] + k * p[0], v[1], v[2] + k * p[2], v[3] + k * p[3]];
    },
};
