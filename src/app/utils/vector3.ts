// math/vector3.ts
// Basic 3D vector utilities

export type Vec3 = [number, number, number];

/**
 * Normalize a vector to unit length
 */
export function vec3Normalize(v: Vec3): Vec3 {
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (len === 0) return [0, 0, 1];
    return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Cross product of two vectors
 */
export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

/**
 * Dot product of two vectors
 */
export function vec3Dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Check if vector is zero
 */
export function vec3IsZero(v: Vec3): boolean {
    return v[0] === 0 && v[1] === 0 && v[2] === 0;
}

/**
 * Vector length/magnitude
 */
export function vec3Length(v: Vec3): number {
    return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/**
 * Add two vectors
 */
export function vec3Add(a: Vec3, b: Vec3): Vec3 {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/**
 * Subtract vectors (a - b)
 */
export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * Scale vector by scalar
 */
export function vec3Scale(v: Vec3, s: number): Vec3 {
    return [v[0] * s, v[1] * s, v[2] * s];
}

/**
 * Negate vector
 */
export function vec3Negate(v: Vec3): Vec3 {
    return [-v[0], -v[1], -v[2]];
}

/**
 * Rotate vector around axis by angle (radians)
 * Uses Rodrigues' rotation formula
 */
export function vec3Rotate(v: Vec3, axis: Vec3, angle: number): Vec3 {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const t = 1 - c;

    const dot = vec3Dot(v, axis);
    const cross = vec3Cross(axis, v);

    return [
        v[0] * c + cross[0] * s + axis[0] * dot * t,
        v[1] * c + cross[1] * s + axis[1] * dot * t,
        v[2] * c + cross[2] * s + axis[2] * dot * t
    ];
}

/**
 * Linear interpolation between two vectors
 */
export function vec3Lerp(a: Vec3, b: Vec3, t: number): Vec3 {
    return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t
    ];
}
