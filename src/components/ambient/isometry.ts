// components/ambient/isometry.ts
// CPU algebra of the curved spaces, whose points are 4-vectors and whose objects are placed by
// isometries: what a curved occupant supplies (CurvedGeometry) and the pieces written once
// against it — column-major 4×4 matrices and a placement's isometry. Everything is fp64 and
// composed here; the GPU receives finished matrices and vectors (composing on the GPU drifts).
// The origin is o = (0,0,0,1) and an authored Vec3 naming a point means exp_o(v), the point at
// distance |v| from o in direction v̂ (in E³ that is v itself).

import type { Quat, Vec3Tuple } from '../geometry/similarity.js';
import { quatToMat3 } from '../geometry/similarity.js';

export type Vec4 = [number, number, number, number];
/** Column-major 4×4, GLSL's mat4 constructor order: entry (row r, column c) is m[4·c + r]. */
export type Mat4 = number[];

/** The CPU geometry of one curved space (components/ambient/<space>/<space>.ts). */
export interface CurvedGeometry {
    /** ⟨a, b⟩, the space's bilinear form on R⁴: the metric on tangent vectors. */
    form(a: Vec4, b: Vec4): number;
    /** exp_o(v): the point reached by walking |v| from o in direction v̂. */
    exp(v: Vec3Tuple): Vec4;
    /** log_o(p), the inverse of exp. */
    log(p: Vec4): Vec3Tuple;
    /** The transvection by v: the isometry moving o to exp_o(v) along the geodesic, carrying the
     *  frame at o along it (built from v, never from the endpoint, so it has no singularity). */
    transvection(v: Vec3Tuple): Mat4;
    /** The inverse of an isometry, exact (no numerical inversion). */
    inverse(g: Mat4): Mat4;
    /** The isometry a∘b (apply b, then a). */
    compose(a: Mat4, b: Mat4): Mat4;
    /** g applied to a point. */
    apply(g: Mat4, p: Vec4): Vec4;
    /** g's differential applied to a tangent vector (at any point). */
    applyTangent(g: Mat4, v: Vec4): Vec4;
    /** The isometry fixing o whose differential at o is the rotation q of the tangent space there
     *  (throws when q is not an isometry's differential in this space). */
    rotation(q: Quat): Mat4;
    /** The orthogonal projection (under the metric) of a vector onto the tangent space at p. */
    tangent(p: Vec4, v: Vec4): Vec4;
}

/** The isometry algebra of a space whose isometries are linear maps of R⁴ preserving `form` (H³,
 *  S³): the matrix product, the matrix applied to points and tangent vectors alike, the rotation
 *  diag(R, 1), and the tangent space at p as p's orthogonal complement. */
export function linearIsometries(form: (a: Vec4, b: Vec4) => number): Pick<CurvedGeometry, 'compose' | 'apply' | 'applyTangent' | 'rotation' | 'tangent'> {
    return {
        compose: mat4Multiply,
        apply: mat4Apply,
        applyTangent: mat4Apply,
        rotation: rotationAtOrigin,
        tangent(p: Vec4, v: Vec4): Vec4 {
            const k = form(v, p) / form(p, p);
            return [v[0] - k * p[0], v[1] - k * p[1], v[2] - k * p[2], v[3] - k * p[3]];
        },
    };
}

export const ORIGIN: Vec4 = [0, 0, 0, 1];

/** A tangent vector at o from its three spatial components. */
export function tangentAtOrigin(v: Vec3Tuple): Vec4 {
    return [v[0], v[1], v[2], 0];
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
    const m = new Array<number>(16).fill(0);
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            let s = 0;
            for (let k = 0; k < 4; k++) s += a[4 * k + r] * b[4 * c + k];
            m[4 * c + r] = s;
        }
    }
    return m;
}

export function mat4Transpose(m: Mat4): Mat4 {
    const t = new Array<number>(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) t[4 * r + c] = m[4 * c + r];
    return t;
}

export function mat4Apply(m: Mat4, v: Vec4): Vec4 {
    const out: Vec4 = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) out[r] = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3];
    return out;
}

/** The rotation fixing o: diag(R, 1) with R the quaternion's rotation of the tangent space at o. */
export function rotationAtOrigin(q: Quat): Mat4 {
    const R = quatToMat3(q);   // column-major 3×3
    return [R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1];
}

/**
 * An object's placement g = T(position)·R(rotation)·T(pre): the authored transform (a
 * transvection to exp_o(position), then a rotation about the object's own center) applied to a
 * shape first moved from o by `pre`, its point row (a sphere's center). In E³ this is the
 * similarity T·R·S with S = 1 and the center folded in.
 */
export function placementIsometry(geom: CurvedGeometry, position: Vec3Tuple, rotation: Quat, pre: Vec3Tuple): Mat4 {
    return geom.compose(geom.compose(geom.transvection(position), geom.rotation(rotation)), geom.transvection(pre));
}
