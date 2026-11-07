// tests/witnesses/scenes/h2xrTwins.ts
// fp64 twins for the H²×R witnesses (h2xrWitness.ts) and for the occupant's math
// (tests/components/h2xr.test.ts). A point is (x, y, z, w): height y, and (x, z, w) on the
// hyperboloid x² + z² − w² = −1. Every formula of h2xr.glsl and of the H²×R bodies has its fp64
// transcription here; the derivations are in docs/claude-2026-11-review/curved/h2xr-plan.md:
//   - the geodesic flow: the H² part along an H² geodesic at speed s = |u| (u the horizontal part of
//     the velocity), the height linear: γ(t) = cosh(st)·p_H + t·sinhc(st)·u + (p.y + v.y·t)·e_y;
//   - distance √(D_H² + Δy²), D_H the H² distance;
//   - the area density J(p, q) = d²·sinh(D_H)/D_H (the Jacobi fields along a geodesic at angle β
//     from the vertical grow as sinh(t sin β)/sin β and as t), so dω = cos_q·dA/J and a point light
//     gives E = I·cos θ/J;
//   - the sky key (sin β·ξ, cos β) with ξ the ideal point of the H² part, in Klein coordinates.
// The witness expectations average the receivers' radiance over the runner's readout windows with
// the camera rays of curvedTwins.ts (the frame the compiler ships).

import type { WitnessRegion } from '../types.js';
import type { Vec3Tuple } from '../../../src/components/geometry/similarity.js';
import { quatFromAxisAngle, IDENTITY_QUAT } from '../../../src/components/geometry/similarity.js';
import { h2xrGeometry as G, h2Form } from '../../../src/components/ambient/h2xr/h2xr.js';
import { placementIsometry, ORIGIN, type Mat4 } from '../../../src/components/ambient/isometry.js';
import { curvedCameraRay, curvedFisheyeRay, gaussLegendre, regionMean, type V4 } from './curvedTwins.js';

export { gaussLegendre, regionMean, type V4 };

export const MAX_DIST = 10;
export const O: V4 = [0, 0, 0, 1];
export const EY: V4 = [0, 1, 0, 0];
export const form = (a: V4, b: V4): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] - a[3] * b[3];
export const hform = (a: V4, b: V4): number => h2Form(a, b);
export const lin = (a: V4, s: number, b: V4, t: number): V4 => [a[0] * s + b[0] * t, a[1] * s + b[1] * t, a[2] * s + b[2] * t, a[3] * s + b[3] * t];
export const exp = (v: Vec3Tuple): V4 => G.exp(v) as V4;
const H = (p: V4): V4 => [p[0], 0, p[2], p[3]];
export const unit = (v: V4): V4 => lin(v, 1 / Math.sqrt(form(v, v)), v, 0);
const sinhc = (x: number): number => (x === 0 ? 1 : Math.sinh(x) / x);
const asinhc = (x: number): number => (x === 0 ? 1 : Math.asinh(x) / x);

/** The geodesic flow from (p, v), v unit: the point and the arrival velocity at arc length t. */
export function flow(p: V4, v: V4, t: number): { p: V4; v: V4 } {
    const u = H(v);
    const s = Math.sqrt(Math.max(hform(u, u), 0));
    const c = Math.cosh(s * t), k = t * sinhc(s * t);
    const ph = H(p);
    const q = lin(ph, c, u, k);
    q[1] = p[1] + v[1] * t;
    const w = lin(ph, s * Math.sinh(s * t), u, c);
    w[1] = v[1];
    return { p: q, v: w };
}

/** The H² distance of two points (chord form) and the height difference b.y − a.y. */
export function split(a: V4, b: V4): { DH: number; dy: number } {
    const c = lin(H(a), 1, H(b), -1);
    return { DH: 2 * Math.asinh(Math.sqrt(Math.max(hform(c, c), 0)) / 2), dy: b[1] - a[1] };
}

export function dist(a: V4, b: V4): number {
    const { DH, dy } = split(a, b);
    return Math.hypot(DH, dy);
}

/** Unit initial direction at a of the geodesic to b: normalize(asinhc(|w|)·w + Δy·e_y), w the H²
 *  log direction (b_H − a_H) + ⟨a_H, b_H − a_H⟩·a_H, of length sinh D_H. */
export function directionTo(a: V4, b: V4): V4 {
    const c = lin(H(b), 1, H(a), -1);
    const w = lin(c, 1, H(a), hform(H(a), c));
    const r = Math.sqrt(Math.max(hform(w, w), 0));
    const v = lin(w, asinhc(r), EY, b[1] - a[1]);
    return unit(v);
}

/** The area density J(a, b) = d²·sinhc(D_H). */
export function areaDensity(a: V4, b: V4): number {
    const { DH, dy } = split(a, b);
    return (DH * DH + dy * dy) * sinhc(DH);
}

/** The sky key of the ray (p, v): (s·ξ.x, v.y, s·ξ.z) normalized, ξ = (m.x, m.z)/m.w, m = s·p_H + u. */
export function skyKey(p: V4, v: V4): [number, number, number] {
    const u = H(v);
    const s = Math.sqrt(Math.max(hform(u, u), 0));
    if (s === 0) return [0, Math.sign(v[1]), 0];
    const m = lin(H(p), s, u, 1);
    const k: [number, number, number] = [s * m[0] / m[3], v[1], s * m[2] / m[3]];
    const l = Math.hypot(...k);
    return [k[0] / l, k[1] / l, k[2] / l];
}

// ---------------------------------------------------------------------------------------------
// Shapes, each in its own frame (canonical at o). Roots return the first t > 0 or null.
// ---------------------------------------------------------------------------------------------

export type Shape =
    | { kind: 'plane'; normal: Vec3Tuple; offset: number }
    | { kind: 'disk'; radius: number; normal: Vec3Tuple }
    | { kind: 'cylinder'; radius: number; halfHeight: number }
    | { kind: 'sphere'; radius: number };

/** The H² normal of a vertical plane: N = (cosh(off)·n.x, 0, cosh(off)·n.z, −sinh(off)). */
function verticalPlaneN(n: Vec3Tuple, off: number): V4 {
    const l = Math.hypot(n[0], n[2]);
    return [Math.cosh(off) * n[0] / l, 0, Math.cosh(off) * n[2] / l, -Math.sinh(off)];
}

export function planeRoot(p: V4, v: V4, pl: { normal: Vec3Tuple; offset: number }): number | null {
    const l = Math.hypot(...pl.normal);
    if (pl.normal[1] !== 0) {
        const ny = pl.normal[1] / l, off = pl.offset / l;
        if (v[1] === 0) return null;
        const t = -(p[1] * ny + off) / (v[1] * ny);
        return t > 0 ? t : null;
    }
    const N = verticalPlaneN(pl.normal, pl.offset / l);
    const u = H(v);
    const s = Math.sqrt(Math.max(hform(u, u), 0));
    const P = hform(p, N), W = hform(u, N);
    if (P * W >= 0 || s * Math.abs(P) >= Math.abs(W)) return null;
    const x = -s * P / W;
    return (-P / W) * (x === 0 ? 1 : Math.atanh(x) / x);
}

export function diskRoot(p: V4, v: V4, d: { radius: number }): number | null {
    if (v[1] === 0) return null;
    const t = -p[1] / v[1];
    if (!(t > 0)) return null;
    const h = flow(p, v, t).p;
    return h[0] * h[0] + h[2] * h[2] <= Math.sinh(d.radius) ** 2 ? t : null;
}

/** The capped cylinder: the tube interval (H³'s ball quadratic in e^τ on the H² part, τ = st) met
 *  with the slab interval; root selection by the inside test. */
export function cylinderRoot(p: V4, v: V4, c: { radius: number; halfHeight: number }): number | null {
    let lo = -Infinity, hi = Infinity;
    if (v[1] === 0) { if (Math.abs(p[1]) > c.halfHeight) return null; } else {
        const a = (-c.halfHeight - p[1]) / v[1], b = (c.halfHeight - p[1]) / v[1];
        lo = Math.min(a, b); hi = Math.max(a, b);
    }
    const u = H(v);
    const s = Math.sqrt(Math.max(hform(u, u), 0));
    const sr = Math.sinh(c.radius);
    if (s === 0) {
        if (p[0] * p[0] + p[2] * p[2] > sr * sr) return null;
    } else {
        const uh = lin(u, 1 / s, u, 0);
        const cr = p[0] * uh[2] - p[2] * uh[0];
        const k = cr * cr;
        const disc = sr * sr - k;
        if (disc < 0) return null;
        const big = p[3] + Math.abs(uh[3]), small = (1 + k) / big;
        const apb = uh[3] >= 0 ? big : small, amb = uh[3] >= 0 ? small : big;
        const q = Math.cosh(c.radius) + Math.sqrt(disc);
        lo = Math.max(lo, Math.log(amb / q) / s);
        hi = Math.min(hi, Math.log(q / apb) / s);
    }
    if (!(lo < hi)) return null;
    const inside = p[0] * p[0] + p[2] * p[2] < sr * sr && Math.abs(p[1]) < c.halfHeight;
    const t = inside ? hi : lo;
    return t > 0 ? t : null;
}

/** The ball's f(t) = D_H(t)² + y(t)² − R² and its derivative 2·asinhc(r)·γ′.w + 2·y·v.y. */
function ballF(p: V4, v: V4, R: number, t: number): { f: number; fp: number } {
    const g = flow(p, v, t);
    const r = Math.hypot(g.p[0], g.p[2]);
    const D = Math.asinh(r);
    return { f: D * D + g.p[1] * g.p[1] - R * R, fp: 2 * asinhc(r) * g.v[3] + 2 * g.p[1] * v[1] };
}

/** The ball root by the GLSL body's convex Newton scheme (transcribed). */
export function ballRootNewton(p: V4, v: V4, b: { radius: number }): number | null {
    const R = b.radius;
    const inside = ballF(p, v, R, 0).f < 0;
    let t = inside ? 2 * R : 0;
    for (let i = 0; i < 24; i++) {
        const { f, fp } = ballF(p, v, R, t);
        if (i > 0 && f <= 0) return t > 0 ? t : null;
        if (inside ? fp <= 0 : fp >= 0) return null;
        const step = f / fp;
        t -= step;
        if (Math.abs(step) <= 1e-5 * (1 + t)) return t > 0 ? t : null;
    }
    return null;
}

/** The ball root by an independent method: the minimum of the convex f by golden-section search,
 *  then bisection on the side the root must lie (used to check the Newton body). */
export function ballRootBisect(p: V4, v: V4, b: { radius: number }, tMax = MAX_DIST): number | null {
    const R = b.radius;
    const f = (t: number) => ballF(p, v, R, t).f;
    const bisect = (a: number, c: number): number => {   // f(a), f(c) of opposite signs
        const fa = f(a);
        for (let i = 0; i < 64; i++) { const m = (a + c) / 2; if ((f(m) > 0) === (fa > 0)) a = m; else c = m; }
        return (a + c) / 2;
    };
    if (f(0) < 0) {
        let hi = 2 * R;
        while (f(hi) < 0) hi *= 2;
        return bisect(0, hi);
    }
    let a = 0, c = tMax;
    const gr = (Math.sqrt(5) - 1) / 2;
    for (let i = 0; i < 90; i++) {
        const x1 = c - gr * (c - a), x2 = a + gr * (c - a);
        if (f(x1) < f(x2)) c = x2; else a = x1;
    }
    const tm = (a + c) / 2;
    if (f(tm) > 0) return null;
    return bisect(0, tm);
}

export function shapeRoot(p: V4, v: V4, s: Shape): number | null {
    switch (s.kind) {
        case 'plane': return planeRoot(p, v, s);
        case 'disk': return diskRoot(p, v, s);
        case 'cylinder': return cylinderRoot(p, v, s);
        case 'sphere': return ballRootNewton(p, v, s);   // checked against ballRootBisect and sphere tracing (h2xr.test.ts)
    }
}

/** Exact signed distance of each shape (the disk's: √(y² + max(D_H − ρ, 0)²), unsigned). */
export function shapeSdf(x: V4, s: Shape): number {
    const r = Math.hypot(x[0], x[2]);
    const D = Math.asinh(r);
    switch (s.kind) {
        case 'plane': {
            const l = Math.hypot(...s.normal);
            if (s.normal[1] !== 0) return x[1] * s.normal[1] / l + s.offset / l;
            const P = hform(x, verticalPlaneN(s.normal, s.offset / l));
            return Math.asinh(P);
        }
        case 'disk': return Math.hypot(x[1], Math.max(D - s.radius, 0));
        case 'cylinder': {
            const a = D - s.radius, b = Math.abs(x[1]) - s.halfHeight;
            return Math.hypot(Math.max(a, 0), Math.max(b, 0)) + Math.min(Math.max(a, b), 0);
        }
        case 'sphere': return Math.hypot(D, x[1]) - s.radius;
    }
}

/** The outward unit normal at a point x on the shape (its frame). */
export function shapeNormal(x: V4, s: Shape): V4 {
    const r = Math.hypot(x[0], x[2]);
    switch (s.kind) {
        case 'plane': {
            const l = Math.hypot(...s.normal);
            if (s.normal[1] !== 0) return [0, Math.sign(s.normal[1]), 0, 0];
            return verticalPlaneN(s.normal, s.offset / l);
        }
        case 'disk': return [0, Math.sign(s.normal[1]), 0, 0];
        case 'cylinder': {
            if (Math.asinh(r) - s.radius > Math.abs(x[1]) - s.halfHeight) return [x[3] * x[0] / r, 0, x[3] * x[2] / r, r];
            return [0, Math.sign(x[1]), 0, 0];
        }
        case 'sphere': {
            const k = asinhc(r);
            return unit([k * x[3] * x[0], x[1], k * x[3] * x[2], k * r * r]);
        }
    }
}

/** A placed object: its shape in its own frame and its placement g (world ← object). */
export interface Placed { shape: Shape; g: Mat4; inv: Mat4; tag: string }

/** The placement the compiler builds: g = T(position)·R(angle about y)·T(center row). */
export function place(tag: string, shape: Shape, center: Vec3Tuple = [0, 0, 0], position: Vec3Tuple = [0, 0, 0], angle = 0): Placed {
    const q = angle === 0 ? IDENTITY_QUAT : quatFromAxisAngle([0, 1, 0], angle);
    const g = placementIsometry(G, position, q, center);
    return { shape, g, inv: G.inverse(g), tag };
}

export interface Hit { t: number; obj: Placed; x: V4; n: V4; arrival: V4 }

/** The first hit of the ray (p, v) among the objects, within MAX_DIST. */
export function firstHit(objs: Placed[], p: V4, v: V4, tMax = MAX_DIST): Hit | null {
    let best: Hit | null = null;
    for (const o of objs) {
        const lp = G.apply(o.inv, p) as V4, lv = G.applyTangent(o.inv, v) as V4;
        const t = shapeRoot(lp, lv, o.shape);
        if (t === null || t >= tMax || (best !== null && t >= best.t)) continue;
        const local = flow(lp, lv, t);
        best = {
            t, obj: o,
            x: G.apply(o.g, local.p) as V4,
            n: G.applyTangent(o.g, shapeNormal(local.p, o.shape)) as V4,
            arrival: G.applyTangent(o.g, local.v) as V4,
        };
    }
    return best;
}

/** Whether the geodesic segment from x to q is blocked by an object (other than at its ends). */
export function blocked(objs: Placed[], x: V4, q: V4): boolean {
    const d = dist(x, q);
    const v = directionTo(x, q);
    const start = flow(x, v, 1e-7);
    const h = firstHit(objs, start.p, start.v, d - 2e-7);
    return h !== null;
}

/** Point-light irradiance I·max(cos θ, 0)/J at x (normal n), unshadowed. */
export function pointIrradiance(x: V4, n: V4, q: V4, I: number, density: (a: V4, b: V4) => number = areaDensity): number {
    const c = form(n, directionTo(x, q));
    return c <= 0 ? 0 : I * c / density(x, q);
}

/** A horizontal one-sided disk emitter: center c (a point), facing down (−e_y) or up, radius rho. */
export interface DiskEmitter { c: V4; facing: 1 | -1; rho: number; Le: number }

export function diskEmitter(position: Vec3Tuple, facingY: 1 | -1, rho: number, Le: number): DiskEmitter {
    return { c: exp(position), facing: facingY, rho, Le };
}

/** The point of the emitter at H² polar coordinates (s, φ) about its center. */
const emitterFrames = new WeakMap<DiskEmitter, Mat4>();
export function diskPoint(e: DiskEmitter, s: number, phi: number): V4 {
    let T = emitterFrames.get(e);
    if (T === undefined) { T = G.transvection(G.log(e.c)); emitterFrames.set(e, T); }
    return G.apply(T, exp([s * Math.cos(phi), 0, s * Math.sin(phi)])) as V4;
}

/** Irradiance at x (normal nx) from a horizontal disk emitter: ∫ Le·cos_x·cos_y/J dA, Gauss–Legendre
 *  in the H² radius s ∈ [0, ρ] (dA = sinh s ds dφ) and the trapezoid rule in φ. */
export function diskIrradiance(x: V4, nx: V4, e: DiskEmitter, density: (a: V4, b: V4) => number = areaDensity, ns = 48, nphi = 96): number {
    const [nodes, weights] = gaussLegendre(ns);
    const ny: V4 = [0, e.facing, 0, 0];
    let sum = 0;
    for (let i = 0; i < ns; i++) {
        const s = 0.5 * e.rho * (nodes[i] + 1);
        const ws = 0.5 * e.rho * weights[i] * Math.sinh(s);
        for (let j = 0; j < nphi; j++) {
            const y = diskPoint(e, s, (2 * Math.PI * j) / nphi);
            const cx = form(nx, directionTo(x, y));
            const cy = form(ny, directionTo(y, x));
            if (cx <= 0 || cy <= 0) continue;
            sum += ws * (2 * Math.PI / nphi) * e.Le * cx * cy / density(x, y);
        }
    }
    return sum;
}

/** The pinhole and fisheye camera rays in H²×R (curvedTwins.ts with this geometry). */
export const cameraRay = (pose: { position: Vec3Tuple; target: Vec3Tuple }, fov: number, size: [number, number], fx: number, fy: number) =>
    curvedCameraRay(G, pose, fov, size, fx, fy);
export const fisheyeRay = (pose: { position: Vec3Tuple; target: Vec3Tuple }, fov: number, size: [number, number], fx: number, fy: number) =>
    curvedFisheyeRay(G, pose, fov, size, fx, fy);

/** The mean over a readout window of the lambert radiance (albedo/π)·E of the first object hit,
 *  which must be the object tagged `tag` (a window point on another object, or on nothing, counts
 *  in `missed`), and unshadowed from every point light (`shadowed` counts the others). */
export function windowMean(
    pose: { position: Vec3Tuple; target: Vec3Tuple }, fov: number, size: [number, number], region: WitnessRegion,
    objs: Placed[], tag: string, albedo: number, irradiance: (h: Hit) => number, lightPoints: V4[] = [], sub = 2,
): { mean: number; missed: number; shadowed: number } {
    let missed = 0, shadowed = 0;
    const [mean] = regionMean((fx, fy) => cameraRay(pose, fov, size, fx, fy), size, region, (p, v) => {
        const h = firstHit(objs, p, v);
        if (h === null || h.obj.tag !== tag) { missed++; return [0, 0, 0]; }
        if (lightPoints.some((q) => blocked(objs, h.x, q))) shadowed++;
        const L = (albedo / Math.PI) * irradiance(h);
        return [L, L, L];
    }, sub);
    return { mean, missed, shadowed };
}

export { ORIGIN };
