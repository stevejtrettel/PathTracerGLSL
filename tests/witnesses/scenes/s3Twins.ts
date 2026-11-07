// tests/witnesses/scenes/s3Twins.ts
// fp64 twins for the S³ witnesses (s3Witness.ts): the expected radiance of a lambert disk receiver
// lit by a disk light or by point lights, averaged over the witness readout window exactly as the
// runner reads it. The formulas are the verified ones of
// docs/claude-2026-11-review/curved/light-sampling-twins (geom.ts, irradiance.ts, pointlight.ts):
//   - two geodesics join x to a light point y: the short arc (length d, leaving along u, arriving
//     with velocity −direction_to(y, x)) and the long arc (length 2π − d, leaving along −u, arriving
//     with velocity +direction_to(y, x)); both have the area density A = sin² d;
//   - the irradiance sums both arcs, each with its receiver and emitter cosines clamped at 0;
//   - an on-axis disk at distance D of radius ρ, seen through either arc, gives E = Le·π·sin²β with
//     tan β = tan ρ / sin D;
//   - a point light gives E = I·|cos θ|/sin² d (the long arc lights the side facing away from it).
// Off-axis receiver points have no closed form for the disk, so E is a quadrature over the disk in
// geodesic polar coordinates about its center (dA = sin s ds dφ); tests/witnesses/s3Twins.test.ts
// checks it against the on-axis closed form and against an independent cosine-sampled estimate.
// Nothing occludes an arc in these scenes (the receiver's great sphere is crossed only at x and at
// −x, outside the receiver; the light's at y and at −y, outside the light), which the test checks.

import type { WitnessRegion } from '../types.js';
import type { Vec3Tuple } from '../../../src/components/geometry/similarity.js';
import { sphericalGeometry } from '../../../src/components/ambient/spherical/spherical.js';
import { curvedCameraRay, curvedFisheyeRay, gaussLegendre, regionMean, type V4 } from './curvedTwins.js';

export const dot = (a: V4, b: V4): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const lin = (a: V4, s: number, b: V4, t: number): V4 => [a[0] * s + b[0] * t, a[1] * s + b[1] * t, a[2] * s + b[2] * t, a[3] * s + b[3] * t];
export const exp = (v: Vec3Tuple): V4 => sphericalGeometry.exp(v) as V4;
export const O: V4 = [0, 0, 0, 1];

/** Geodesic distance of the short arc, by the chord form 2·atan2(|p − q|, |p + q|). */
export function dist(p: V4, q: V4): number {
    const a = lin(p, 1, q, -1), b = lin(p, 1, q, 1);
    return 2 * Math.atan2(Math.sqrt(dot(a, a)), Math.sqrt(dot(b, b)));
}

/** Unit initial direction at p of the short arc to q: q = cos d·p + sin d·u. */
export function directionTo(p: V4, q: V4): V4 {
    const d = dist(p, q);
    return lin(q, 1 / Math.sin(d), p, -Math.cos(d) / Math.sin(d));
}

/** The point and velocity at arc length t along the geodesic (p, v). */
export function flow(p: V4, v: V4, t: number): { pos: V4; vel: V4 } {
    return { pos: lin(p, Math.cos(t), v, Math.sin(t)), vel: lin(p, -Math.sin(t), v, Math.cos(t)) };
}

/** The two crossings in [0, 2π) of the geodesic (p, v) with the great sphere x·N = 0, ascending. */
export function planeRoots(p: V4, v: V4, N: V4): [number, number] {
    const P = dot(p, N), W = dot(v, N);
    const t0 = ((Math.atan2(-P, W) % Math.PI) + Math.PI) % Math.PI;
    return [t0, t0 + Math.PI];
}

/** An orthonormal pair spanning the tangent plane at c orthogonal to the unit tangent m. */
export function tangentPair(c: V4, m: V4): [V4, V4] {
    const axes: V4[] = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    const pick = (others: V4[]): V4 => {
        let best: V4 = [0, 0, 0, 0], bl = -1;
        for (const e of axes) {
            let w = lin(e, 1, c, -dot(e, c));
            for (const o of others) w = lin(w, 1, o, -dot(w, o));
            const l2 = dot(w, w);
            if (l2 > bl) { bl = l2; best = w; }
        }
        return lin(best, 1 / Math.sqrt(bl), best, 0);
    };
    const t1 = pick([m]);
    return [t1, pick([m, t1])];
}

/** A one-sided geodesic disk emitter: center c, unit normal m ∈ T_c (the side it emits to; as a
 *  4-vector it is the great sphere's normal everywhere on it), geodesic radius rho, radiance Le. */
export interface DiskEmitter { c: V4; m: V4; rho: number; Le: number }

/** The disk light an authored S³ disk light {position, normal, radius, emission} makes: the center
 *  exp_o(position) and the normal carried there by the transvection. */
export function diskEmitter(position: Vec3Tuple, normal: Vec3Tuple, rho: number, Le: number): DiskEmitter {
    const T = sphericalGeometry.transvection(position);
    const n = Math.hypot(...normal);
    const v: V4 = [normal[0] / n, normal[1] / n, normal[2] / n, 0];
    const m: V4 = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) m[r] = T[r] * v[0] + T[4 + r] * v[1] + T[8 + r] * v[2] + T[12 + r] * v[3];
    return { c: exp(position), m, rho, Le };
}

/** The receiver and emitter cosines of the two arcs from x (unit normal nx) to y on an emitter of
 *  normal m: short arc (u, arriving with −back), long arc (−u, arriving with +back), where
 *  back = direction_to(y, x). An emitter cosine is taken against the reversed arrival direction. */
export function arcCosines(x: V4, nx: V4, y: V4, m: V4): Array<{ cx: number; cy: number }> {
    const u = directionTo(x, y), back = directionTo(y, x);
    return [
        { cx: dot(nx, u), cy: dot(m, back) },
        { cx: -dot(nx, u), cy: -dot(m, back) },
    ];
}

/** Irradiance at x (receiver unit normal nx ∈ T_x) from a disk emitter over both arcs:
 *  ∫ Σ_arcs Le·max(cos_x, 0)·max(cos_y, 0) / sin² r dA, Gauss–Legendre in the geodesic radius
 *  s ∈ [0, ρ] and the trapezoid rule in φ (periodic). */
export function diskIrradiance(x: V4, nx: V4, e: DiskEmitter, ns = 48, nphi = 96): number {
    const [e1, e2] = tangentPair(e.c, e.m);
    const [nodes, weights] = gaussLegendre(ns);
    let sum = 0;
    for (let i = 0; i < ns; i++) {
        const s = 0.5 * e.rho * (nodes[i] + 1);
        const ws = 0.5 * e.rho * weights[i] * Math.sin(s);
        for (let j = 0; j < nphi; j++) {
            const phi = (2 * Math.PI * j) / nphi;
            const y = flow(e.c, lin(e1, Math.cos(phi), e2, Math.sin(phi)), s).pos;
            const A = Math.sin(dist(x, y)) ** 2;
            for (const { cx, cy } of arcCosines(x, nx, y, e.m)) {
                if (cx > 0 && cy > 0) sum += ws * (2 * Math.PI / nphi) * e.Le * cx * cy / A;
            }
        }
    }
    return sum;
}

/** On-axis closed form (either arc): E = Le·π·sin²β, tan β = tan ρ / sin D. */
export function diskIrradianceOnAxis(D: number, rho: number, Le: number): number {
    const tb = Math.tan(rho) / Math.sin(D);
    return Le * Math.PI * (tb * tb) / (1 + tb * tb);
}

/** Point light of intensity I at q over both arcs: E = I·|cos θ|/sin² d. */
export function pointIrradiance(x: V4, nx: V4, q: V4, I: number): number {
    return I * Math.abs(dot(nx, directionTo(x, q))) / Math.sin(dist(x, q)) ** 2;
}

export const cameraRay = (pose: { position: Vec3Tuple; target: Vec3Tuple }, fov: number, size: [number, number], fx: number, fy: number) =>
    curvedCameraRay(sphericalGeometry, pose, fov, size, fx, fy);
export const fisheyeRay = (pose: { position: Vec3Tuple; target: Vec3Tuple }, fov: number, size: [number, number], fx: number, fy: number) =>
    curvedFisheyeRay(sphericalGeometry, pose, fov, size, fx, fy);

/** A receiver: the lambert disk of geodesic radius rho about o in the great sphere y = 0 (normal +y). */
export interface Receiver { rho: number; albedo: number }

/** The receiver point a camera ray (p, v) sees first (null when it misses the receiver). */
export function receiverHit(p: V4, v: V4, receiver: Receiver): V4 | null {
    for (const t of planeRoots(p, v, [0, 1, 0, 0])) {
        if (t <= 0) continue;
        const x = flow(p, v, t).pos;
        if (dist(x, O) <= receiver.rho) return x;
    }
    return null;
}

/** The mean over the runner's readout window of the receiver's radiance (albedo/π)·E(x) through the
 *  pinhole camera (regionMean). A point of the window that misses the receiver contributes 0;
 *  `missed` counts them so a fixture can require full coverage. */
export function windowMean(
    pose: { position: Vec3Tuple; target: Vec3Tuple }, fov: number, size: [number, number], region: WitnessRegion,
    receiver: Receiver, irradiance: (x: V4, nx: V4) => number, sub = 2,
): { mean: number; missed: number } {
    const N: V4 = [0, 1, 0, 0];
    let missed = 0;
    const [mean] = regionMean((fx, fy) => cameraRay(pose, fov, size, fx, fy), size, region, (p, v) => {
        const x = receiverHit(p, v, receiver);
        if (x === null) { missed++; return [0, 0, 0]; }
        const L = (receiver.albedo / Math.PI) * irradiance(x, N);
        return [L, L, L];
    }, sub);
    return { mean, missed };
}
