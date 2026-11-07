// components/camera/basis.ts
// The camera look-at frame — computed ONCE on the CPU and shipped as three vec3 uniforms
// (u_cameraForward / u_cameraRight / u_cameraUp), NOT rebuilt per ray on the GPU.
//
// This is the single source of truth for the orthonormal frame every camera occupant
// renders against; the camera feature (generate/features/camera.ts) mints the uniforms
// with a compute closure over camera.position + camera.target, so an OrbitControls drag
// re-runs THIS function on the CPU and re-uploads three vectors — no recompile, and the
// two normalizes + two crosses leave the per-pixel path entirely.
//
// The frame is projection-agnostic (equirect/fisheye/orthographic use it too), so aspect
// and u_tanFov scaling stay in-shader — they are cheap scalar work and would entangle the
// shared frame with per-projection concerns.

import type { Vec3Tuple } from '../geometry/similarity.js';
import { mat4Apply, mat4Multiply, tangentAtOrigin, type CurvedGeometry, type Vec4 } from '../ambient/isometry.js';

export interface CameraBasis {
    /** Unit view direction (position → target). */
    forward: Vec3Tuple;
    /** Unit screen-right. */
    right: Vec3Tuple;
    /** Unit screen-up (already unit: right ⊥ forward, both unit). */
    up: Vec3Tuple;
}

function sub(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}

function normalize(v: Vec3Tuple): Vec3Tuple {
    const len = Math.hypot(v[0], v[1], v[2]);
    // Match the shader's normalize(0) → NaN avoidance is unnecessary here: forward is
    // guarded below; right's cross is guarded by the up-reference switch. len is nonzero.
    return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * The look-at frame transcribed EXACTLY from the occupant GLSL it replaces (same
 * degenerate up-reference guard: forward ∥ ±Y makes cross(forward, +Y) zero-length, so
 * fall back to +Z as the reference).
 */
export function cameraBasis(position: Vec3Tuple, target: Vec3Tuple): CameraBasis {
    const forward = normalize(sub(target, position));
    const upRef: Vec3Tuple = Math.abs(forward[1]) > 0.999999 ? [0, 0, 1] : [0, 1, 0];
    const right = normalize(cross(forward, upRef));
    const up = cross(right, forward);
    return { forward, right, up };
}

/** The camera frame in a curved space: the camera point and an orthonormal tangent frame there,
 *  all 4-vectors (the uniforms u_cameraPosition/Forward/Right/Up). */
export interface CurvedCameraBasis {
    position: Vec4;
    forward: Vec4;
    right: Vec4;
    up: Vec4;
}

/**
 * The look-at frame in a curved space, by the TARGET-CENTERED up rule: pull the scene back by the
 * transvection T to the target, so the target sits at o and the camera at P′ = T⁻¹·exp_o(position);
 * take today's Euclidean look-at at o along −log_o(P′) (cameraBasis, its up rule included); push
 * that frame forward by T·T(log_o P′). An orbit at fixed elevation about the target is then an
 * exact rotation about the target's vertical geodesic (the origin-centered alternative rolls the
 * horizon by up to 54° in H³). The composed product loses orthonormality far from o in H³, so the
 * frame is Gram–Schmidt-ed under the form at P = exp_o(position), the authored camera point.
 * In E³ (exp = identity, T = translation) this is cameraBasis itself.
 */
export function curvedCameraBasis(geom: CurvedGeometry, position: Vec3Tuple, target: Vec3Tuple): CurvedCameraBasis {
    const T = geom.transvection(target);
    const v = geom.log(mat4Apply(geom.inverse(T), geom.exp(position)));
    const b = cameraBasis(v, [0, 0, 0]);
    const G = mat4Multiply(T, geom.transvection(v));
    const P = geom.exp(position);
    const pp = geom.form(P, P);
    const scale = (a: Vec4, k: number): Vec4 => [a[0] * k, a[1] * k, a[2] * k, a[3] * k];
    const minus = (a: Vec4, c: Vec4, k: number): Vec4 => [a[0] - k * c[0], a[1] - k * c[1], a[2] - k * c[2], a[3] - k * c[3]];
    const unit = (a: Vec4): Vec4 => scale(a, 1 / Math.sqrt(geom.form(a, a)));
    const tangent = (a: Vec4): Vec4 => minus(a, P, geom.form(a, P) / pp);   // onto T_P
    const forward = unit(tangent(mat4Apply(G, tangentAtOrigin(b.forward))));
    let right = tangent(mat4Apply(G, tangentAtOrigin(b.right)));
    right = unit(minus(right, forward, geom.form(right, forward)));
    let up = tangent(mat4Apply(G, tangentAtOrigin(b.up)));
    up = minus(up, forward, geom.form(up, forward));
    up = unit(minus(up, right, geom.form(up, right)));
    return { position: P, forward, right, up };
}
