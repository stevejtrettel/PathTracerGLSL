// tests/witnesses/scenes/h3Twins.ts
// fp64 twins for the H³ witnesses (h3Witness.ts): the expected radiance of a lambert disk receiver
// lit by a disk light or a point light, averaged over the witness readout window exactly as the
// runner reads it. The formulas are the verified ones of
// docs/claude-2026-11-review/curved/light-sampling-twins (geom.ts, irradiance.ts, pointlight.ts):
//   - area → solid angle uses A(r) = sinh² r, with the emitter cosine taken against the geodesic's
//     arrival direction at the light point (= −direction_to(y, x));
//   - an on-axis disk at distance D of radius ρ gives E = Le·π·sin²β with tan β = tanh ρ / sinh D;
//   - a point light gives E = I·cos θ / sinh² d.
// Off-axis receiver points have no closed form for the disk, so E is a quadrature over the disk in
// geodesic polar coordinates about its center (dA = sinh s ds dφ); tests/witnesses/h3Twins.test.ts
// checks it against the on-axis closed form and against an independent cosine-sampled estimate.
// The camera ray of a pixel follows the pinhole and fisheye occupants (pinhole.glsl, fisheye.glsl)
// with the frame the compiler ships (curvedCameraBasis), and the window is the runner's
// regionBounds (both in curvedTwins.ts, shared with the S³ twin). The sky witnesses read the sky key normalize((p + v).xyz) (h3Twins.test.ts checks it
// against the direction of γ(t) from o as t grows) and a closed-form ball test (checked against
// marching the ray).

import type { WitnessRegion } from '../types.js';
import type { Vec3Tuple } from '../../../src/components/geometry/similarity.js';
import { hyperbolicGeometry } from '../../../src/components/ambient/hyperbolic/hyperbolic.js';
import { curvedCameraRay, curvedFisheyeRay, gaussLegendre, regionMean, type V4 } from './curvedTwins.js';

export { gaussLegendre, regionMean, type V4 };

export const form = (a: V4, b: V4): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] - a[3] * b[3];
const lin = (a: V4, s: number, b: V4, t: number): V4 => [a[0] * s + b[0] * t, a[1] * s + b[1] * t, a[2] * s + b[2] * t, a[3] * s + b[3] * t];
export const exp = (v: Vec3Tuple): V4 => hyperbolicGeometry.exp(v) as V4;

/** Geodesic distance (acosh is exact enough in fp64 at the separations used here). */
export function dist(p: V4, q: V4): number {
    return Math.acosh(Math.max(1, -form(p, q)));
}

/** Unit initial direction at p of the geodesic to q: q = cosh d·p + sinh d·u. */
export function directionTo(p: V4, q: V4): V4 {
    const d = dist(p, q);
    return lin(q, 1 / Math.sinh(d), p, -Math.cosh(d) / Math.sinh(d));
}

export function flow(p: V4, v: V4, t: number): V4 {
    return lin(p, Math.cosh(t), v, Math.sinh(t));
}

/** First t > 0 at which the geodesic (p, v) meets the totally geodesic plane ⟨x, N⟩ = 0. */
export function planeRoot(p: V4, v: V4, N: V4): number | null {
    const P = form(p, N), W = form(v, N);
    if (P * W >= 0 || Math.abs(W) <= Math.abs(P)) return null;
    return Math.atanh(-P / W);
}

/** An orthonormal pair spanning the tangent plane at c orthogonal to the unit tangent m. */
export function tangentPair(c: V4, m: V4): [V4, V4] {
    const axes: V4[] = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    const pick = (others: V4[]): V4 => {
        let best: V4 = [0, 0, 0, 0], bl = -1;
        for (const e of axes) {
            let w = lin(e, 1, c, form(e, c));
            for (const o of others) w = lin(w, 1, o, -form(w, o));
            const l2 = form(w, w);
            if (l2 > bl) { bl = l2; best = w; }
        }
        return lin(best, 1 / Math.sqrt(bl), best, 0);
    };
    const t1 = pick([m]);
    return [t1, pick([m, t1])];
}

/** A one-sided geodesic disk emitter: center c, unit normal m ∈ T_c (the side it emits to; as a
 *  4-vector it is the plane's normal everywhere on the plane), geodesic radius rho, radiance Le. */
export interface DiskEmitter { c: V4; m: V4; rho: number; Le: number }

/** The disk light an authored H³ disk light {position, normal, radius, emission} makes: the center
 *  exp_o(position) and the normal carried there by the transvection. */
export function diskEmitter(position: Vec3Tuple, normal: Vec3Tuple, rho: number, Le: number): DiskEmitter {
    const T = hyperbolicGeometry.transvection(position);
    const n = Math.hypot(...normal);
    const v: V4 = [normal[0] / n, normal[1] / n, normal[2] / n, 0];
    const m: V4 = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) m[r] = T[r] * v[0] + T[4 + r] * v[1] + T[8 + r] * v[2] + T[12 + r] * v[3];
    return { c: exp(position), m, rho, Le };
}

/** Irradiance at x (receiver unit normal nx ∈ T_x) from a disk emitter: ∫ Le·cos_x·cos_y / sinh² r dA,
 *  Gauss–Legendre in the geodesic radius s ∈ [0, ρ] and the trapezoid rule in φ (periodic). */
export function diskIrradiance(x: V4, nx: V4, e: DiskEmitter, ns = 48, nphi = 96): number {
    const [e1, e2] = tangentPair(e.c, e.m);
    const [nodes, weights] = gaussLegendre(ns);
    let sum = 0;
    for (let i = 0; i < ns; i++) {
        const s = 0.5 * e.rho * (nodes[i] + 1);
        const ws = 0.5 * e.rho * weights[i] * Math.sinh(s);
        for (let j = 0; j < nphi; j++) {
            const phi = (2 * Math.PI * j) / nphi;
            const y = flow(e.c, lin(e1, Math.cos(phi), e2, Math.sin(phi)), s);
            const r = dist(x, y);
            const cx = form(nx, directionTo(x, y));
            const cy = form(e.m, directionTo(y, x));
            if (cx <= 0 || cy <= 0) continue;
            sum += ws * (2 * Math.PI / nphi) * e.Le * cx * cy / Math.sinh(r) ** 2;
        }
    }
    return sum;
}

/** On-axis closed form: E = Le·π·sin²β, tan β = tanh ρ / sinh D. */
export function diskIrradianceOnAxis(D: number, rho: number, Le: number): number {
    const tb = Math.tanh(rho) / Math.sinh(D);
    return Le * Math.PI * (tb * tb) / (1 + tb * tb);
}

/** Point light of intensity I at q: E = I·max(cos θ, 0)/sinh² d. */
export function pointIrradiance(x: V4, nx: V4, q: V4, I: number): number {
    const c = form(nx, directionTo(x, q));
    return c <= 0 ? 0 : I * c / Math.sinh(dist(x, q)) ** 2;
}

/** The pinhole camera ray through film point (fx, fy) (curvedTwins.ts, in H³). */
export const cameraRay = (pose: { position: Vec3Tuple; target: Vec3Tuple }, fov: number, size: [number, number], fx: number, fy: number) =>
    curvedCameraRay(hyperbolicGeometry, pose, fov, size, fx, fy);

/** The equidistant fisheye ray through film point (fx, fy) (curvedTwins.ts, in H³). */
export const fisheyeRay = (pose: { position: Vec3Tuple; target: Vec3Tuple }, fov: number, size: [number, number], fx: number, fy: number) =>
    curvedFisheyeRay(hyperbolicGeometry, pose, fov, size, fx, fy);

/** The ideal endpoint of the ray (p, v) as a unit vector of R³: normalize((p + v).xyz). */
export function skyKey(p: V4, v: V4): [number, number, number] {
    const k = [p[0] + v[0], p[1] + v[1], p[2] + v[2]];
    const l = Math.hypot(k[0], k[1], k[2]);
    return [k[0] / l, k[1] / l, k[2] / l];
}

/** Whether the ray (p, v), starting outside the geodesic ball of radius R about c, meets it at some
 *  t > 0. Along γ(t), cosh dist(γ(t), c) = A·cosh t + B·sinh t with A = −⟨p, c⟩, B = −⟨v, c⟩; its
 *  minimum over t is √(A² − B²), reached where tanh t = −B/A (t > 0 iff B < 0). */
export function hitsBall(p: V4, v: V4, c: V4, R: number): boolean {
    const A = -form(p, c), B = -form(v, c);
    return B < 0 && Math.sqrt(A * A - B * B) <= Math.cosh(R);
}

/** A receiver: the lambert disk of geodesic radius rho about o in the plane y = 0 (normal +y). */
export interface Receiver { rho: number; albedo: number }

/** The mean over the runner's readout window of the receiver's radiance (albedo/π)·E(x) through the
 *  pinhole camera (regionMean). A point of the window that misses the receiver contributes 0, as in
 *  the render (no sky, nothing behind); `missed` counts them so a fixture can require full
 *  coverage. */
export function windowMean(
    pose: { position: Vec3Tuple; target: Vec3Tuple }, fov: number, size: [number, number], region: WitnessRegion,
    receiver: Receiver, irradiance: (x: V4, nx: V4) => number, sub = 2,
): { mean: number; missed: number } {
    const N: V4 = [0, 1, 0, 0];
    let missed = 0;
    const [mean] = regionMean((fx, fy) => cameraRay(pose, fov, size, fx, fy), size, region, (p, v) => {
        const t = planeRoot(p, v, N);
        if (t === null) { missed++; return [0, 0, 0]; }
        const x = flow(p, v, t);
        if (dist(x, [0, 0, 0, 1]) > receiver.rho) { missed++; return [0, 0, 0]; }
        const L = (receiver.albedo / Math.PI) * irradiance(x, N);
        return [L, L, L];
    }, sub);
    return { mean, missed };
}
