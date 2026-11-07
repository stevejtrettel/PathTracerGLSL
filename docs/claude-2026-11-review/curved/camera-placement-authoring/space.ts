// Minimal per-space CPU math for H3 (hyperboloid, form x1y1+x2y2+x3y3-x4y4, origin (0,0,0,1))
// and S3 (unit sphere in R4, origin (0,0,0,1)). float64. Matrices are row-major number[16]
// acting on column 4-vectors: (M v)_i = sum_j M[4i+j] v_j.
export type V4 = [number, number, number, number];
export type V3 = [number, number, number];
export type M4 = number[];
export type Space = 'H' | 'S';

export const O: V4 = [0, 0, 0, 1];
// sigma = -1 for H3 (w has a minus sign), +1 for S3
export const sig = (s: Space) => (s === 'H' ? -1 : 1);
export function form(s: Space, a: V4, b: V4): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + sig(s) * a[3] * b[3];
}
export function mul(A: M4, B: M4): M4 {
    const C = new Array(16).fill(0);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let x = 0; for (let k = 0; k < 4; k++) x += A[4 * i + k] * B[4 * k + j]; C[4 * i + j] = x; }
    return C;
}
export function apply(A: M4, v: V4): V4 {
    const r: number[] = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) r[i] = A[4 * i] * v[0] + A[4 * i + 1] * v[1] + A[4 * i + 2] * v[2] + A[4 * i + 3] * v[3];
    return r as V4;
}
export function transpose(A: M4): M4 { const T = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) T[4 * j + i] = A[4 * i + j]; return T; }
export const J = (s: Space): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, sig(s)];
/** Exact inverse of an isometry: H3: J g^T J; S3: g^T. */
export function isoInverse(s: Space, g: M4): M4 { return s === 'H' ? mul(J(s), mul(transpose(g), J(s))) : transpose(g); }

const ch = (s: Space, d: number) => (s === 'H' ? Math.cosh(d) : Math.cos(d));
const sh = (s: Space, d: number) => (s === 'H' ? Math.sinh(d) : Math.sin(d));

/** exp at the origin: the point reached by walking |v| along v/|v|. In E3 this is v itself. */
export function expO(s: Space, v: V3): V4 {
    const d = Math.hypot(v[0], v[1], v[2]);
    if (d === 0) return [0, 0, 0, 1];
    const k = sh(s, d) / d;
    return [k * v[0], k * v[1], k * v[2], ch(s, d)];
}
/** log at the origin (inverse of expO; S3: |v| <= pi, undefined at the antipode). */
export function logO(s: Space, P: V4): V3 {
    const n = Math.hypot(P[0], P[1], P[2]);
    if (n === 0) return [0, 0, 0];
    const d = s === 'H' ? Math.asinh(n) : Math.atan2(n, P[3]);
    return [P[0] * d / n, P[1] * d / n, P[2] * d / n];
}
/** The transvection along the geodesic o -> P that takes o to P.
 *  H3: [[I + p p^T/(1+w), p],[p^T, w]];  S3: [[I - p p^T/(1+w), p],[-p^T, w]] (singular at w = -1). */
export function transvection(s: Space, P: V4): M4 {
    const [x, y, z, w] = P; const p = [x, y, z];
    const c = (s === 'H' ? 1 : -1) / (1 + w);
    const M = new Array(16).fill(0);
    for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) M[4 * i + j] = (i === j ? 1 : 0) + c * p[i] * p[j]; M[4 * i + 3] = p[i]; M[12 + i] = (s === 'H' ? 1 : -1) * p[i]; }
    M[15] = w;
    return M;
}
/** Rotation fixing the origin, from a unit quaternion [x,y,z,w]. */
export function rotationFromQuat(q: [number, number, number, number]): M4 {
    const [x, y, z, w] = q;
    const R = [
        1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
        2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
        2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
    ];
    return [R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1];
}
/** Placement isometry g = T(position) * R(rotation), position in exp coordinates at the origin. */
export function placement(s: Space, position: V3, q: [number, number, number, number]): M4 {
    return mul(transvection(s, expO(s, position)), rotationFromQuat(q));
}
/** Decompose an isometry into (exp-coordinate position, rotation 3x3) — the inverse of placement(). */
export function decompose(s: Space, g: M4): { position: V3; R: M4 } {
    const P = apply(g, O);
    const R = mul(isoInverse(s, transvection(s, P)), g);
    return { position: logO(s, P), R };
}

function n3(v: V3): V3 { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; }
function cross(a: V3, b: V3): V3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
/** The existing Euclidean look-at (components/camera/basis.ts), at the origin's tangent space. */
export function lookAt0(forward: V3): { f: V3; r: V3; u: V3 } {
    const f = n3(forward);
    const upRef: V3 = Math.abs(f[1]) > 0.999999 ? [0, 0, 1] : [0, 1, 0];
    const r = n3(cross(f, upRef));
    const u = cross(r, f);
    return { f, r, u };
}
const t4 = (v: V3): V4 => [v[0], v[1], v[2], 0];

/** Camera isometry, ORIGIN-centered up rule: G = T_P * R0, with R0 the E3 look-at at o of the
 *  direction toward the target pulled back by T_P^{-1}. Returns P, F, R, U as 4-vectors. */
export function cameraOriginCentered(s: Space, posV: V3, tgtV: V3) {
    const P = expO(s, posV), T = expO(s, tgtV);
    const TP = transvection(s, P);
    const f0 = logO(s, apply(isoInverse(s, TP), T));
    const b = lookAt0(f0);
    return { P, F: apply(TP, t4(b.f)), R: apply(TP, t4(b.r)), U: apply(TP, t4(b.u)) };
}
/** Camera isometry, TARGET-centered up rule (orbit-consistent): pull back by T_T so the target is
 *  the origin; P' = T_T^{-1} P; look along -log_o(P'); push forward by T_T * T_{P'}. */
export function cameraTargetCentered(s: Space, posV: V3, tgtV: V3) {
    const P = expO(s, posV), T = expO(s, tgtV);
    const TT = transvection(s, T);
    const Pp = apply(isoInverse(s, TT), P);
    const v = logO(s, Pp);
    const b = lookAt0([-v[0], -v[1], -v[2]]);
    const G = mul(TT, transvection(s, Pp));
    return { P: apply(G, O), F: apply(G, t4(b.f)), R: apply(G, t4(b.r)), U: apply(G, t4(b.u)) };
}
/** Orbit: the camera position (exp coordinates at the origin) at distance d from target T, in the
 *  direction u(az, el) expressed in T's transported frame — OrbitControls.sphericalToCartesian. */
export function orbitPosition(s: Space, tgtV: V3, d: number, az: number, el: number): V3 {
    const u: V3 = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
    const Pp = expO(s, [d * u[0], d * u[1], d * u[2]]);
    return logO(s, apply(transvection(s, expO(s, tgtV)), Pp));
}
/** Inverse of orbitPosition — OrbitControls.cartesianToSpherical. */
export function orbitParams(s: Space, tgtV: V3, posV: V3): { d: number; az: number; el: number } {
    const Pp = apply(isoInverse(s, transvection(s, expO(s, tgtV))), expO(s, posV));
    const v = logO(s, Pp); const d = Math.hypot(...v);
    return { d, az: Math.atan2(v[0], v[2]), el: Math.asin(v[1] / d) };
}
/** Fly (KeyboardControls.moveLocal): walk distance t from P along unit tangent D; returns the new
 *  point and the transported direction (geodesic flow). */
export function flow(s: Space, P: V4, D: V4, t: number): { P: V4; D: V4 } {
    const c = ch(s, t), sn = sh(s, t), k = s === 'H' ? 1 : -1;
    return {
        P: [c * P[0] + sn * D[0], c * P[1] + sn * D[1], c * P[2] + sn * D[2], c * P[3] + sn * D[3]],
        D: [k * sn * P[0] + c * D[0], k * sn * P[1] + c * D[1], k * sn * P[2] + c * D[2], k * sn * P[3] + c * D[3]],
    };
}
