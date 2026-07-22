// TS twin of this occupant's velocity-Verlet integrator of the Sharma ray ODE
// (fable-variable-ior.md). NOT the GPU code — a re-implementation of the SAME algorithm (like the
// octahedral TS twin) to validate the physics the GLSL walker relies on: the ray ODE dr/dt = T,
// dT/dt = n·∇n (= ∇(n²/2), a Hamiltonian system) must
//   (1) travel STRAIGHT when n is constant (∇n = 0), and
//   (2) conserve BOUGUER'S INVARIANT |r × T| = n·r·sin φ for a spherically-symmetric n(r) — the
//       GRIN analog of angular momentum, the sharpest reference-free correctness gate. Symplectic
//       Verlet keeps it BOUNDED (RK4 would let it drift).
// If the ODE were the wrong equation, (2) drifts.

import { describe, it, expect } from 'vitest';

type V = [number, number, number];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V): number => Math.hypot(a[0], a[1], a[2]);

/** The conservative force F(r) = n·∇n (∇n by central differences — mirrors grin_force). */
function force(n: (p: V) => number, p: V): V {
    const e = 1e-4;
    const g: V = [
        (n([p[0] + e, p[1], p[2]]) - n([p[0] - e, p[1], p[2]])) / (2 * e),
        (n([p[0], p[1] + e, p[2]]) - n([p[0], p[1] - e, p[2]])) / (2 * e),
        (n([p[0], p[1], p[2] + e]) - n([p[0], p[1], p[2] - e])) / (2 * e),
    ];
    return mul(g, n(p));
}

/** One velocity-Verlet step of (r, T) with carried force F — mirrors grin.glsl's Verlet loop.
 *  Returns [r_next, T_next, F_next] (F_next is reused as the next step's F). */
function verlet(n: (p: V) => number, r: V, T: V, F: V, h: number): [V, V, V] {
    const T_half = add(T, mul(F, h / 2));
    const r_next = add(r, mul(T_half, h));
    const F_next = force(n, r_next);
    const T_next = add(T_half, mul(F_next, h / 2));
    return [r_next, T_next, F_next];
}

/** The adaptive step — mirrors grin.glsl's strong-field limiters (transcribed from the
 *  reference odeMarch): h·n ≤ DS_MAX (coordinate cap — |T| = n makes a fixed parameter
 *  step's coordinate jump blow up near a black-hole point) and h·|∇n| ≤ DTOL (field-change
 *  cap, |∇n| = |F|/n). Far from mass neither binds and h = STEP. */
const GRIN_STEP = 0.02, GRIN_DS_MAX = 0.05, GRIN_DTOL = 0.05;
function stepSize(nVal: number, F: V): number {
    let h = Math.min(GRIN_STEP, GRIN_DS_MAX / nVal);
    h = Math.min(h, (GRIN_DTOL * nVal) / Math.max(len(F), 1e-6));
    return h;
}

describe('GRIN ray ODE (velocity Verlet — TS twin of grin.glsl, fable-variable-ior)', () => {
    it('constant n ⇒ a straight line (∇n = 0 ⇒ F = 0, T unchanged)', () => {
        const n = () => 1.3;
        let r: V = [-2, 0.1, 0.05], T: V = mul([1, 0, 0], 1.3);   // T = n·(unit dir)
        const T0: V = [...T];
        let F = force(n, r);
        for (let i = 0; i < 200; i++) [r, T, F] = verlet(n, r, T, F, 0.02);
        expect(len(cross(T, T0))).toBeCloseTo(0, 9);        // direction never rotated
        expect(Math.abs(r[1] - 0.1)).toBeLessThan(1e-9);    // no y drift
        expect(Math.abs(r[2] - 0.05)).toBeLessThan(1e-9);   // no z drift
    });

    it('linear n² ⇒ an EXACT parabola (F-MIRAGE: constant force, Verlet reproduces the closed form)', () => {
        // n²(y) linear ⇒ the force ∇(n²/2) = (0, g, 0) is CONSTANT — the ray ODE is projectile
        // motion, r(t) = r0 + T0·t + ½·g·t²·ŷ exactly, and velocity Verlet is EXACT for constant
        // acceleration (its position update IS the second-order Taylor step, which terminates).
        // The only error left is the finite-difference ∇ of sqrt (curvature ~e²), so the gate is
        // 1e-5, not machine epsilon — it pins the ODE + integrator against a closed form the
        // Bouguer test can't (Bouguer checks a conserved quantity, not the trajectory itself).
        const n0 = 1.2, g = 0.3;
        const n = (p: V) => Math.sqrt(n0 * n0 + 2 * g * p[1]);
        const r0: V = [-1, 0, 0.2];
        const T0: V = mul([1, 0, 0], n(r0));   // T = n·(unit dir), rising toward higher n
        let r: V = [...r0], T: V = [...T0];
        let F = force(n, r);
        const h = 0.02;
        let maxErr = 0;
        for (let k = 1; k <= 300; k++) {
            [r, T, F] = verlet(n, r, T, F, h);
            const t = k * h;
            const exact: V = [r0[0] + T0[0] * t, r0[1] + T0[1] * t + 0.5 * g * t * t, r0[2] + T0[2] * t];
            maxErr = Math.max(maxErr, len(add(r, mul(exact, -1))));
        }
        expect(r[1]).toBeGreaterThan(1.0);       // the parabola genuinely climbed (not a trivial pass)
        expect(maxErr).toBeLessThan(1e-5);       // trajectory ≡ the closed form along the whole path
    });

    it("Bouguer's invariant |r × T| is conserved for a radial n(r) (the ODE is correct + symplectic)", () => {
        // A smooth spherically-symmetric bump at the origin — bends the ray.
        const n = (p: V) => 1.0 + 0.5 * Math.exp(-len(p) * len(p));
        // An OFF-AXIS ray (nonzero impact parameter) so |r × T| ≠ 0 and the bend is real.
        let r: V = [-2.5, 0.7, 0.0];
        const dir: V = [1, 0, 0];
        let T: V = mul(dir, n(r));
        let F = force(n, r);
        const bouguer0 = len(cross(r, T));
        expect(bouguer0).toBeGreaterThan(0.1);   // a genuine off-axis ray

        let maxDrift = 0, bent = false;
        for (let i = 0; i < 300; i++) {
            [r, T, F] = verlet(n, r, T, F, 0.02);
            maxDrift = Math.max(maxDrift, Math.abs(len(cross(r, T)) - bouguer0));
            if (len(cross(T, mul(dir, n(r)))) > 1e-3) bent = true;   // T rotated away from the entry dir
        }
        expect(bent).toBe(true);                 // the ray actually bent (not a trivial pass)
        expect(maxDrift).toBeLessThan(1e-3);     // Bouguer conserved along the whole path
    });

    it('Majumdar–Papapetrou flyby: adaptive steps hold Bouguer + the 4M/b deflection (black-hole field)', () => {
        // The MP optical index n = U², U = 1 + M/r (extremal charged hole; the +1 makes n → 1
        // at infinity — the Fermat form the walker needs). Photon sphere at r = M, critical
        // impact parameter b_c = 4M. This is THE strong-field case the adaptive limiters exist
        // for: with fixed h the coordinate jump h·n diverges near the hole. Two gates on an
        // escaping flyby:
        //   (1) Bouguer's invariant |r × T| conserved through the strong field — the integrator
        //       stays honest where the field is stiff;
        //   (2) the bending angle matches GR's weak-field deflection α ≈ 4M/b for b ≫ b_c
        //       (extremal RN's charge correction −3π M²/(4b²) is ~0.6% at b = 40M, inside the
        //       2% gate) — a REFERENCE-FREE pin of field + integrator end to end.
        const M = 0.1;
        const n = (p: V) => { const U = 1 + M / Math.max(len(p), 1e-6); return U * U; };
        const b = 40 * M;                        // weak-field flyby, well outside b_c = 4M
        let r: V = [-30 * M * 4, b, 0];          // start far out on the -x axis, offset by b
        const dir: V = [1, 0, 0];
        let T: V = mul(dir, n(r));
        let F = force(n, r);
        const bouguer0 = len(cross(r, T));

        let maxDrift = 0, minR = Infinity;
        for (let i = 0; i < 60000; i++) {
            const h = stepSize(len(T), F);       // the adaptive step (|T| = n carried invariant)
            [r, T, F] = verlet(n, r, T, F, h);
            maxDrift = Math.max(maxDrift, Math.abs(len(cross(r, T)) - bouguer0));
            minR = Math.min(minR, len(r));
            if (r[0] > 0 && len(r) > 30 * M * 4) break;   // escaped to the far side
        }
        expect(len(r)).toBeGreaterThan(30 * M * 4 - 1e-9);   // it escaped (b > b_c — not captured)
        expect(minR).toBeLessThan(b);                        // it genuinely dipped toward the hole
        expect(maxDrift / bouguer0).toBeLessThan(1e-3);      // Bouguer through the strong field

        // Deflection: angle between the exit tangent and the entry direction.
        const Tn = mul(T, 1 / len(T));
        const alpha = Math.acos(Math.max(-1, Math.min(1, Tn[0])));
        const alphaGR = (4 * M) / b;
        expect(Math.abs(alpha - alphaGR) / alphaGR).toBeLessThan(0.02);
    });
});
