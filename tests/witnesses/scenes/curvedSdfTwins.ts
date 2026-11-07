// tests/witnesses/scenes/curvedSdfTwins.ts
// fp64 twins of marched signed-distance fields in H³ and S³: the space's flow and distance, the
// curved SDF vocabulary (components/ambient/sdf.glsl and the sdf_plane / sdf_tube helpers of
// hyperbolic.glsl and spherical.glsl), the generated march loop (emitSdfIntersect in
// components/geometry/index.ts) and the tangent-frame 4-tap normal (emitCurvedSdfNormal), each
// transcribed line for line. tests/components/curvedSdf.test.ts checks them against closed-form roots
// and brute force; the witness values of curvedSdfWitness.ts are computed from them.

import type { Vec3Tuple } from '../../../src/components/geometry/similarity.js';
import type { CurvedGeometry } from '../../../src/components/ambient/isometry.js';
import { hyperbolicGeometry } from '../../../src/components/ambient/hyperbolic/hyperbolic.js';
import { sphericalGeometry } from '../../../src/components/ambient/spherical/spherical.js';
import type { V4 } from './curvedTwins.js';

export type SpaceName = 'hyperbolic' | 'spherical';

const lin = (a: V4, s: number, b: V4, t: number): V4 => [a[0] * s + b[0] * t, a[1] * s + b[1] * t, a[2] * s + b[2] * t, a[3] * s + b[3] * t];
const sub = (a: V4, b: V4): V4 => lin(a, 1, b, -1);
const len3 = (p: V4): number => Math.hypot(p[0], p[1], p[2]);
export const O: V4 = [0, 0, 0, 1];

/** One curved space in fp64: the form, the flow, the distance, exp_o, the plane and tube helpers. */
export interface Space {
    name: SpaceName;
    geom: CurvedGeometry;
    /** The search interval: MAX_DIST of the occupant (10 in H³, 2π in S³). */
    maxDist: number;
    form(a: V4, b: V4): number;
    /** The point and arrival velocity at arc length t along (p, v). */
    flow(p: V4, v: V4, t: number): { pos: V4; vel: V4 };
    dist(a: V4, b: V4): number;
    /** The tangent vector at p of length 1 pointing along the geodesic to q (the short arc in S³). */
    directionTo(p: V4, q: V4): V4;
    planeVector(n: Vec3Tuple, offset: number): V4;
    planeDistance(p: V4, N: V4): number;
    /** Distance from p to the geodesic through a with unit tangent u ∈ T_a. */
    lineDistance(p: V4, a: V4, u: V4): number;
    /** p projected onto T_x (the component of v orthogonal to the point x). */
    tangent(x: V4, v: V4): V4;
}

export const H3: Space = {
    name: 'hyperbolic',
    geom: hyperbolicGeometry,
    maxDist: 10,
    form: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] - a[3] * b[3],
    flow: (p, v, t) => ({ pos: lin(p, Math.cosh(t), v, Math.sinh(t)), vel: lin(p, Math.sinh(t), v, Math.cosh(t)) }),
    dist(a, b) {
        const c = sub(a, b);
        return 2 * Math.asinh(0.5 * Math.sqrt(Math.max(H3.form(c, c), 0)));
    },
    directionTo(p, q) {
        const c = sub(q, p);
        const w = lin(c, 1, p, H3.form(p, c));
        return lin(w, 1 / Math.sqrt(H3.form(w, w)), w, 0);
    },
    planeVector: (n, off) => [Math.cosh(off) * n[0], Math.cosh(off) * n[1], Math.cosh(off) * n[2], -Math.sinh(off)],
    planeDistance(p, N) {
        const s = H3.form(p, N);
        return Math.sign(s) * Math.asinh(Math.abs(s));
    },
    lineDistance(p, a, u) {
        const w = lin(lin(p, 1, a, H3.form(p, a)), 1, u, -H3.form(p, u));
        return Math.asinh(Math.sqrt(Math.max(H3.form(w, w), 0)));
    },
    tangent: (x, v) => lin(v, 1, x, H3.form(v, x)),
};

export const S3: Space = {
    name: 'spherical',
    geom: sphericalGeometry,
    maxDist: 2 * Math.PI,
    form: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3],
    flow: (p, v, t) => ({ pos: lin(p, Math.cos(t), v, Math.sin(t)), vel: lin(p, -Math.sin(t), v, Math.cos(t)) }),
    dist(a, b) {
        const d = sub(a, b), s = lin(a, 1, b, 1);
        return 2 * Math.atan2(Math.sqrt(S3.form(d, d)), Math.sqrt(S3.form(s, s)));
    },
    directionTo(p, q) {
        const c = sub(q, p);
        const w = lin(c, 1, p, -S3.form(p, c));
        return lin(w, 1 / Math.sqrt(S3.form(w, w)), w, 0);
    },
    planeVector: (n, off) => [Math.cos(off) * n[0], Math.cos(off) * n[1], Math.cos(off) * n[2], Math.sin(off)],
    planeDistance: (p, N) => Math.asin(Math.max(-1, Math.min(1, S3.form(p, N)))),
    lineDistance(p, a, u) {
        const pa = S3.form(p, a), pu = S3.form(p, u);
        const w = lin(lin(p, 1, a, -pa), 1, u, -pu);
        return Math.atan2(Math.sqrt(S3.form(w, w)), Math.sqrt(pa * pa + pu * pu));
    },
    tangent: (x, v) => lin(v, 1, x, -S3.form(v, x)),
};

export const spaceOf = (name: SpaceName): Space => name === 'hyperbolic' ? H3 : S3;

// ---------------------------------------------------------------------------
// The SDF vocabulary (sdf.glsl and the occupants' sdf_plane / sdf_tube)
// ---------------------------------------------------------------------------

/** sdf_point: exp_o(v), an authored point. */
export const sdfPoint = (S: Space, v: Vec3Tuple): V4 => S.geom.exp(v) as V4;
export const sdfBall = (S: Space, p: V4, c: V4, r: number): number => S.dist(p, c) - r;
export const sdfPlane = (S: Space, p: V4, n: Vec3Tuple, offset: number): number => S.planeDistance(p, S.planeVector(n, offset));
export const sdfTube = (S: Space, p: V4, a: V4, u: V4, r: number): number => S.lineDistance(p, a, u) - r;
export function smoothUnion(a: number, b: number, k: number): number {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
}
export const smoothIntersection = (a: number, b: number, k: number): number => -smoothUnion(-a, -b, k);
export const smoothSubtraction = (a: number, b: number, k: number): number => smoothIntersection(a, -b, k);

/** A field in the object's frame. */
export type Field = (p: V4) => number;

// ---------------------------------------------------------------------------
// The generated march (emitSdfIntersect) and its tolerances (glsl/core/march.glsl, math.glsl)
// ---------------------------------------------------------------------------

export const MARCH_CLEARANCE = 0.001;
export const MAX_MARCH_STEPS = 512;
export const NORMAL_EPSILON = 0.001;
export const marchEpsilon = (t: number): number => Math.min(0.0005, 0.0001 * (1 + t));

export interface MarchOptions {
    steps?: number;
    epsilon?: (t: number) => number;
    /** The restart floor (MARCH_CLEARANCE in the generated loop). */
    floor?: number;
}

/** The generated `<type>_sdf_intersect` over [t0, t1] (no refinement): the nearest accepted t, or null. */
export function march(S: Space, f: Field, p: V4, v: V4, t0: number, t1: number, o: MarchOptions = {}): number | null {
    const eps = o.epsilon ?? marchEpsilon;
    const steps = o.steps ?? MAX_MARCH_STEPS;
    const at = (t: number) => f(S.flow(p, v, t).pos);
    let t = Math.max(t0, o.floor ?? MARCH_CLEARANCE);
    const tStop = t1 + eps(t1);
    if (t > tStop) return null;
    let tPrev = t;
    let dv = at(t);
    let bound = Math.abs(dv);
    for (let i = 0; i < steps; i++) {
        if (bound < eps(t)) return t;
        tPrev = t;
        t += bound;
        if (t > tStop) return null;
        const dn = at(t);
        if ((dn < 0) !== (dv < 0)) {
            let a = tPrev, b = t;
            const negA = dv < 0;
            for (let j = 0; j < 12; j++) {
                const m = 0.5 * (a + b);
                if ((at(m) < 0) === negA) a = m; else b = m;
            }
            return a;
        }
        dv = dn;
        bound = Math.abs(dv);
    }
    return bound < 16 * eps(t) && t <= tStop ? t : null;
}

/** sphere_interval in the curved bodies: the bound's ray interval [t0, t1], or null. An origin inside
 *  the ball searches [0, MAX_DIST] in S³ (the geodesic comes back around) and [0, exit] in H³. */
export function ballInterval(S: Space, p: V4, v: V4, R: number): [number, number] | null {
    const cx = p[1] * v[2] - p[2] * v[1], cy = p[2] * v[0] - p[0] * v[2], cz = p[0] * v[1] - p[1] * v[0];
    const k = cx * cx + cy * cy + cz * cz;
    if (S.name === 'hyperbolic') {
        const sr = Math.sinh(R);
        const disc = sr * sr - k;
        if (disc < 0) return null;
        const big = p[3] + Math.abs(v[3]);
        const small = (1 + k) / big;
        const apb = v[3] >= 0 ? big : small, amb = v[3] >= 0 ? small : big;
        const q = Math.cosh(R) + Math.sqrt(disc);
        const t1 = Math.log(q / apb);
        if (t1 <= 0) return null;
        return [Math.max(Math.log(amb / q), 0), t1];
    }
    const disc = Math.sin(R) ** 2 - k;
    if (disc < 0) return null;
    const inside = Math.atan2(len3(p), p[3]) < R;
    if (inside) return [0, 2 * Math.PI];
    const phi = Math.atan2(v[3], p[3]);
    const alpha = Math.atan2(Math.sqrt(disc), Math.cos(R));
    const entry = ((phi - alpha) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    return [entry, entry + 2 * alpha];
}

/** sphere_intersect in the curved bodies (the closed-form nearest root ahead), or null. */
export function ballRoot(S: Space, p: V4, v: V4, R: number): number | null {
    const cx = p[1] * v[2] - p[2] * v[1], cy = p[2] * v[0] - p[0] * v[2], cz = p[0] * v[1] - p[1] * v[0];
    const k = cx * cx + cy * cy + cz * cz;
    if (S.name === 'hyperbolic') {
        const sr = Math.sinh(R);
        const disc = sr * sr - k;
        if (disc < 0) return null;
        const big = p[3] + Math.abs(v[3]);
        const small = (1 + k) / big;
        const apb = v[3] >= 0 ? big : small, amb = v[3] >= 0 ? small : big;
        const q = Math.cosh(R) + Math.sqrt(disc);
        const inside = p[0] ** 2 + p[1] ** 2 + p[2] ** 2 < sr * sr;
        const t = Math.log(inside ? q / apb : amb / q);
        return t > 0 ? t : null;
    }
    const disc = Math.sin(R) ** 2 - k;
    if (disc < 0) return null;
    const phi = Math.atan2(v[3], p[3]);
    const alpha = Math.atan2(Math.sqrt(disc), Math.cos(R));
    const inside = Math.atan2(len3(p), p[3]) < R;
    const x = inside ? phi + alpha : phi - alpha;
    const t = ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return t > 0 ? t : null;
}

/** The first t > 0 at which the geodesic (p, v) meets the plane ⟨x, N⟩ = 0 (hyperbolic_plane_root /
 *  spherical_plane_root), or null. */
export function planeRoot(S: Space, p: V4, v: V4, N: V4): number | null {
    const P = S.form(p, N), W = S.form(v, N);
    if (S.name === 'hyperbolic') {
        if (P * W >= 0 || Math.abs(W) <= Math.abs(P)) return null;
        return 0.5 * Math.log((W - P) / (W + P));
    }
    if (P === 0 && W === 0) return null;
    let t = ((Math.atan2(-P, W) % Math.PI) + Math.PI) % Math.PI;
    if (t <= 0) t += Math.PI;
    return t;
}

/** The first sign change of f along (p, v) in (from, to], by a scan at `step` and 60 bisections. */
export function bruteRoot(S: Space, f: Field, p: V4, v: V4, from: number, to: number, step = 1e-4): number | null {
    const at = (t: number) => f(S.flow(p, v, t).pos);
    let tPrev = from, fPrev = at(from);
    for (let t = from + step; t <= to + step; t += step) {
        const ft = at(Math.min(t, to));
        if ((ft < 0) !== (fPrev < 0)) {
            let a = tPrev, b = Math.min(t, to);
            for (let j = 0; j < 60; j++) {
                const m = 0.5 * (a + b);
                if ((at(m) < 0) === (fPrev < 0)) a = m; else b = m;
            }
            return 0.5 * (a + b);
        }
        tPrev = Math.min(t, to); fPrev = ft;
        if (t >= to) break;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Normals
// ---------------------------------------------------------------------------

/** The coordinate axis whose component orthogonal to x (onto T_x) and to the given unit tangents is
 *  longest, normalized (the occupants' tangent seed). */
function tangentSeed(S: Space, x: V4, others: V4[]): V4 {
    let best: V4 = [0, 0, 0, 0], bl = -1;
    for (let i = 0; i < 4; i++) {
        const e: V4 = [0, 0, 0, 0];
        e[i] = 1;
        let w = S.tangent(x, e);
        for (const o of others) w = lin(w, 1, o, -S.form(w, o));
        const l2 = S.form(w, w);
        if (l2 > bl) { bl = l2; best = w; }
    }
    return lin(best, 1 / Math.sqrt(bl), best, 0);
}

/** An orthonormal basis (t, b, n) of T_x with n = the unit tangent `seed` (ambient_frame). */
export function frameAt(S: Space, x: V4, seed: V4): [V4, V4, V4] {
    const n0 = S.tangent(x, seed);
    const n = lin(n0, 1 / Math.sqrt(S.form(n0, n0)), n0, 0);
    const t = tangentSeed(S, x, [n]);
    const b = tangentSeed(S, x, [n, t]);
    return [t, b, n];
}

const unitT = (S: Space, v: V4): V4 => lin(v, 1 / Math.sqrt(S.form(v, v)), v, 0);

/** The generated curved normal (emitCurvedSdfNormal): four taps at arc length h along the
 *  tetrahedral unit combinations of the frame of the arrival direction, Σ f_j k_j normalized. */
export function fdNormal(S: Space, f: Field, x: V4, arrival: V4, h = NORMAL_EPSILON): V4 {
    const [t, b, n] = frameAt(S, x, arrival);
    const k = 0.5773;
    const signs: [number, number, number][] = [[k, -k, -k], [-k, -k, k], [-k, k, -k], [k, k, k]];
    let g: V4 = [0, 0, 0, 0];
    for (const [a, c, d] of signs) {
        const dir = lin(lin(t, a, b, c), 1, n, d);
        g = lin(g, 1, dir, f(S.flow(x, dir, h).pos));
    }
    return unitT(S, g);
}

/** The fp64 reference gradient: central differences along an orthonormal frame at h = 1e-6. */
export function gradient(S: Space, f: Field, x: V4, h = 1e-6): V4 {
    const [t, b, n] = frameAt(S, x, tangentSeed(S, x, []));
    let g: V4 = [0, 0, 0, 0];
    for (const e of [t, b, n]) {
        const d = (f(S.flow(x, e, h).pos) - f(S.flow(x, e, -h).pos)) / (2 * h);
        g = lin(g, 1, e, d);
    }
    return unitT(S, g);
}

// ---------------------------------------------------------------------------
// The reference first hit and direct lighting (witness twins)
// ---------------------------------------------------------------------------

/** The exact first crossing of f along (p, v) in (from, to]: sphere tracing to |f| < 1e-11 (the field
 *  is a lower bound, so no step crosses the surface), then a bracket to the far side. */
export function exactHit(S: Space, f: Field, p: V4, v: V4, from: number, to: number): number | null {
    const at = (t: number) => f(S.flow(p, v, t).pos);
    let t = from;
    for (let i = 0; i < 200000; i++) {
        const d = at(t);
        if (Math.abs(d) < 1e-11) return t;
        t += Math.abs(d);
        if (t > to) return null;
    }
    throw new Error('exactHit: no convergence');
}

/** A point light seen from a one-sided surface point x with outward normal n: E = I·|cos θ|/A(d)
 *  along the arc that leaves into the upper hemisphere (H³: the one geodesic, when cos θ > 0; S³:
 *  the short arc when cos θ > 0, else the long arc of length 2π − d), when the field f (world frame)
 *  does not block it. Returns E and which arc. */
export function pointLight(S: Space, f: Field, x: V4, n: V4, q: V4, I: number): { E: number; arc: 'short' | 'long' | 'none' } {
    const d = S.dist(x, q);
    const u = S.directionTo(x, q);
    const c = S.form(n, u);
    let dir: V4, length: number, arc: 'short' | 'long';
    if (c > 0) { dir = u; length = d; arc = 'short'; }
    else if (S.name === 'spherical' && c < 0) { dir = lin(u, -1, u, 0); length = 2 * Math.PI - d; arc = 'long'; }
    else return { E: 0, arc: 'none' };
    // Leave the surface by 1e-7 along n, as the GPU spawn does (by hit.eps); then march to the light.
    const x1 = S.flow(x, n, 1e-7).pos;
    const dir1 = S.tangent(x1, dir);
    const blocked = exactHit(S, f, x1, unitT(S, dir1), 0, length - 1e-6) !== null;
    if (blocked) return { E: 0, arc: 'none' };
    const A = S.name === 'hyperbolic' ? Math.sinh(d) ** 2 : Math.sin(d) ** 2;
    return { E: I * Math.abs(c) / A, arc };
}

/** Apply a column-major mat4. */
export function apply(m: number[], v: V4): V4 {
    const out: V4 = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) out[r] = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3];
    return out;
}

// ---------------------------------------------------------------------------
// The witness fields (their GLSL is in curvedSdfWitness.ts, written against sdf.glsl)
// ---------------------------------------------------------------------------

/** The sculpture: two balls on the x axis smooth-unioned, and a tube along the y axis capped by two
 *  planes, smooth-unioned onto them. Its solid lies inside {min(pieces) ≤ k₁/4 + k₂/4}, within
 *  distance 0.7 of o in either space, so a ball of radius `bound` contains it. */
export const SCULPTURE = { offset: 0.3, radius: 0.3, k1: 0.2, tube: 0.12, half: 0.45, k2: 0.1, bound: 0.8 };

export function sculptureField(S: Space): Field {
    const c1 = sdfPoint(S, [SCULPTURE.offset, 0, 0]), c2 = sdfPoint(S, [-SCULPTURE.offset, 0, 0]);
    const Y: V4 = [0, 1, 0, 0];
    return (p) => {
        const balls = smoothUnion(sdfBall(S, p, c1, SCULPTURE.radius), sdfBall(S, p, c2, SCULPTURE.radius), SCULPTURE.k1);
        const tube = Math.max(sdfTube(S, p, O, Y, SCULPTURE.tube),
            sdfPlane(S, p, [0, 1, 0], -SCULPTURE.half), sdfPlane(S, p, [0, -1, 0], -SCULPTURE.half));
        return smoothUnion(balls, tube, SCULPTURE.k2);
    };
}

/** The furnace cavity: the complement of a smooth union of two balls about o (the solid is outside). */
export const CAVITY = { offset: 0.35, radius: 0.6, k: 0.3 };

export function cavityField(S: Space): Field {
    const c1 = sdfPoint(S, [CAVITY.offset, 0, 0]), c2 = sdfPoint(S, [-CAVITY.offset, 0, 0]);
    return (p) => -smoothUnion(sdfBall(S, p, c1, CAVITY.radius), sdfBall(S, p, c2, CAVITY.radius), CAVITY.k);
}

/** The Klein chart k(p) = p.xyz / p.w of H³. */
export const klein = (p: V4): [number, number, number] => [p[0] / p[3], p[1] / p[3], p[2] / p[3]];
