// components/ambient/hyperbolic/hyperbolic.ts
// The CPU geometry of H³ in the hyperboloid model (form ⟨a,b⟩ = a₁b₁ + a₂b₂ + a₃b₃ − a₄b₄,
// origin o = (0,0,0,1)) — the same space hyperbolic.glsl computes on the GPU.

import type { Vec3Tuple } from '../../geometry/similarity.js';
import type { CurvedGeometry, Mat4, Vec4 } from '../isometry.js';
import { mat4Multiply, mat4Transpose } from '../isometry.js';

/** J = diag(1,1,1,−1), the form's matrix. */
const J: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1];

export const hyperbolicGeometry: CurvedGeometry = {
    form: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] - a[3] * b[3],

    // exp_o(v) = (sinh|v|·v̂, cosh|v|).
    exp(v: Vec3Tuple): Vec4 {
        const d = Math.hypot(v[0], v[1], v[2]);
        if (d === 0) return [0, 0, 0, 1];
        const k = Math.sinh(d) / d;
        return [k * v[0], k * v[1], k * v[2], Math.cosh(d)];
    },

    // log_o(p) = asinh(|p.xyz|)·p.xyz/|p.xyz| (the asinh form keeps precision near o).
    log(p: Vec4): Vec3Tuple {
        const n = Math.hypot(p[0], p[1], p[2]);
        if (n === 0) return [0, 0, 0];
        const k = Math.asinh(n) / n;
        return [k * p[0], k * p[1], k * p[2]];
    },

    // T = I + sinh d·M + (cosh d − 1)·M² with M the boost generator along u = v̂
    // (M·e₄ = (u, 0), M·(u, 0) = e₄): T = [[I + (cosh d − 1)·u uᵀ, sinh d·u], [sinh d·uᵀ, cosh d]].
    transvection(v: Vec3Tuple): Mat4 {
        const d = Math.hypot(v[0], v[1], v[2]);
        const m: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        if (d === 0) return m;
        const u = [v[0] / d, v[1] / d, v[2] / d];
        const ch1 = Math.cosh(d) - 1, sh = Math.sinh(d);
        for (let c = 0; c < 3; c++) {
            for (let r = 0; r < 3; r++) m[4 * c + r] += ch1 * u[r] * u[c];
            m[4 * c + 3] = sh * u[c];   // row 4
            m[12 + c] = sh * u[c];      // column 4
        }
        m[15] = Math.cosh(d);
        return m;
    },

    // An isometry of the form satisfies gᵀ·J·g = J, so g⁻¹ = J·gᵀ·J.
    inverse: (g: Mat4): Mat4 => mat4Multiply(J, mat4Multiply(mat4Transpose(g), J)),
};
