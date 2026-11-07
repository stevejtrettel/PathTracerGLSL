// components/ambient/spherical/spherical.ts
// The CPU geometry of S³ in the unit-sphere model (form ⟨a,b⟩ = a·b of R⁴, origin o = (0,0,0,1))
// — the same space spherical.glsl computes on the GPU.

import type { Vec3Tuple } from '../../geometry/similarity.js';
import type { CurvedGeometry, Mat4, Vec4 } from '../isometry.js';
import type { RowConstraint } from '../../descriptors.js';
import { mat4Transpose } from '../isometry.js';

/** The domain of a geodesic radius in S³ (a ball's, a disk's): (0, π). π is the diameter of the
 *  space: the ball of radius π is all of S³, and a disk of radius ρ ≥ π is not the region the disk
 *  bodies intersect and sample. The rows that hold such a radius declare it as their spherical
 *  SpaceConstraints entry. */
export const SPHERICAL_RADIUS: RowConstraint = { kind: 'interval', min: 0, max: Math.PI };

/** The domain of a half-extent in S³ that must stay below π/2: a box's half-sizes, a cylinder's
 *  radius and half-height. The shape then lies in the open hemisphere about its center, where its
 *  bounding great spheres enclose it; at π/2 a pair of a box's faces (or a cylinder's caps)
 *  coincide, and a tube of radius ≥ π/2 about a great circle is no longer the region about it. */
export const SPHERICAL_HALF_EXTENT: RowConstraint = { kind: 'interval', min: 0, max: Math.PI / 2 };

export const sphericalGeometry: CurvedGeometry = {
    form: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3],

    // exp_o(v) = (sin|v|·v̂, cos|v|).
    exp(v: Vec3Tuple): Vec4 {
        const d = Math.hypot(v[0], v[1], v[2]);
        if (d === 0) return [0, 0, 0, 1];
        const k = Math.sin(d) / d;
        return [k * v[0], k * v[1], k * v[2], Math.cos(d)];
    },

    // log_o(p) = atan2(|p.xyz|, p.w)·p.xyz/|p.xyz| (the short arc; undefined at the antipode −o).
    log(p: Vec4): Vec3Tuple {
        const n = Math.hypot(p[0], p[1], p[2]);
        if (n === 0) return [0, 0, 0];
        const k = Math.atan2(n, p[3]) / n;
        return [k * p[0], k * p[1], k * p[2]];
    },

    // The rotation by d in the plane of e₄ and u = v̂: T = I + sin d·M + (1 − cos d)·M² with
    // M·e₄ = (u, 0), M·(u, 0) = −e₄: T = [[I + (cos d − 1)·u uᵀ, sin d·u], [−sin d·uᵀ, cos d]].
    transvection(v: Vec3Tuple): Mat4 {
        const d = Math.hypot(v[0], v[1], v[2]);
        const m: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        if (d === 0) return m;
        const u = [v[0] / d, v[1] / d, v[2] / d];
        const c1 = Math.cos(d) - 1, s = Math.sin(d);
        for (let c = 0; c < 3; c++) {
            for (let r = 0; r < 3; r++) m[4 * c + r] += c1 * u[r] * u[c];
            m[4 * c + 3] = -s * u[c];   // row 4
            m[12 + c] = s * u[c];       // column 4
        }
        m[15] = Math.cos(d);
        return m;
    },

    // An isometry of S³ is orthogonal: g⁻¹ = gᵀ.
    inverse: (g: Mat4): Mat4 => mat4Transpose(g),
};
