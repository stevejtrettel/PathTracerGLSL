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
