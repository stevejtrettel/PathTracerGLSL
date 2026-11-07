// tests/witnesses/scenes/curvedMaterialTwins.ts
// fp64 twins for the curved-space material and sphere-light witnesses (h3Witness.ts, s3Witness.ts),
// written once against a small per-space geometry (`Space`, built from h3Twins.ts and s3Twins.ts):
//   - specularRadiance: the expected value of a camera ray in a box of six emissive walls holding a
//     mirror ball and a glass ball, computed exactly by recursion over the delta choices (mirror:
//     Schlick F·L(reflected); glass: F·L(reflected) + (1 − F)·η²·L(refracted), η = n_i/n_t, exact
//     dielectric Fresnel) up to maxBounces scattering events — the formulas of mirror.glsl,
//     dielectric.glsl and core/math.glsl, with the directions, cosines and roots in the space's metric;
//   - ggxRadiance: the radiance a GGX receiver point sends along wo under a disk light,
//     ∫ Le·f(wi, wo)·cos_x·cos_y / A(r) dA (summed over both arcs in S³), with f transcribed from
//     ggx.glsl and core/microfacet.glsl (its twin is components/materials/ggx/ggx.test.ts) and
//     evaluated on metric invariants (n·wi, n·wo, n·h, wo·h);
//   - sphereIrradiance: the irradiance a one-sided receiver point gets from a ball emitter of
//     radiance Le, Le·∫ over the forward cap of g(n·ω) dω with g = max(0, ·) in H³ and |·| in S³
//     (the backward cone of directions that pass −x adds max(0, −n·ω)); the cap's half-angle is
//     sin α = S(R)/S(d), clamped to π/2 in S³ when −x lies in the ball.
// tests/witnesses/curvedMaterialTwins.test.ts checks each against an independent estimate.

import type { WitnessRegion } from '../types.js';
import type { Vec3Tuple } from '../../../src/components/geometry/similarity.js';
import { gaussLegendre, regionMean, type V4 } from './curvedTwins.js';
import * as H from './h3Twins.js';
import * as S from './s3Twins.js';
import { cameraBasis } from '../../../src/components/camera/basis.js';

export type RGB = [number, number, number];

/** What the twins need of a space. */
export interface Space {
    name: 'euclidean' | 'hyperbolic' | 'spherical';
    form(a: V4, b: V4): number;
    exp(v: Vec3Tuple): V4;
    /** The point and velocity at arc length t along the geodesic (p, v). */
    flow(p: V4, v: V4, t: number): { pos: V4; vel: V4 };
    dist(p: V4, q: V4): number;
    /** Unit initial direction at p of the (short) geodesic to q. */
    directionTo(p: V4, q: V4): V4;
    /** The plane body's normal 4-vector for an authored plane {normal, offset} (plane_N). */
    planeN(normal: Vec3Tuple, offset: number): V4;
    /** The first crossing t > 0 of the geodesic (p, v) with the plane ⟨x, N⟩ = 0, or null. */
    planeRoot(p: V4, v: V4, N: V4): number | null;
    /** The entry and exit arc lengths of the geodesic (p, v) on the ball of radius R about c (null
     *  when it misses). H³: the two real roots, entry < exit. S³: φ ∓ β mod 2π. */
    ballRoots(p: V4, v: V4, c: V4, R: number): { entry: number; exit: number } | null;
    /** S(r): sinh r or sin r (the area density is S(r)², a circle of radius s has length 2π S(s)). */
    S(r: number): number;
    /** S³: two geodesics join two points, and both carry light. */
    twoArcs: boolean;
    cameraRay(pose: { position: Vec3Tuple; target: Vec3Tuple }, fov: number, size: [number, number], fx: number, fy: number): { p: V4; v: V4 };
    tangentPair(c: V4, m: V4): [V4, V4];
    diskEmitter(position: Vec3Tuple, normal: Vec3Tuple, rho: number, Le: number): { c: V4; m: V4; rho: number; Le: number };
}

const lin = (a: V4, s: number, b: V4, t: number): V4 => [a[0] * s + b[0] * t, a[1] * s + b[1] * t, a[2] * s + b[2] * t, a[3] * s + b[3] * t];

export const H3: Space = {
    name: 'hyperbolic',
    form: H.form,
    exp: H.exp,
    flow: (p, v, t) => ({ pos: H.flow(p, v, t), vel: lin(p, Math.sinh(t), v, Math.cosh(t)) }),
    dist: H.dist,
    directionTo: H.directionTo,
    planeN: (n, h) => { const l = Math.hypot(...n); return [Math.cosh(h) * n[0] / l, Math.cosh(h) * n[1] / l, Math.cosh(h) * n[2] / l, -Math.sinh(h)]; },
    planeRoot: H.planeRoot,
    ballRoots(p, v, c, R) {
        // cosh dist(γ(t), c) = A cosh t + B sinh t = cosh R ⇒ (A+B)x² − 2 cosh R·x + (A−B) = 0, x = eᵗ.
        const A = -H.form(p, c), B = -H.form(v, c), C = Math.cosh(R);
        const disc = C * C - (A * A - B * B);
        if (disc < 0) return null;
        const r = Math.sqrt(disc);
        return { entry: Math.log((C - r) / (A + B)), exit: Math.log((C + r) / (A + B)) };
    },
    S: Math.sinh,
    twoArcs: false,
    cameraRay: H.cameraRay,
    tangentPair: H.tangentPair,
    diskEmitter: H.diskEmitter,
};

const mod2pi = (t: number) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

export const S3: Space = {
    name: 'spherical',
    form: S.dot,
    exp: S.exp,
    flow: S.flow,
    dist: S.dist,
    directionTo: S.directionTo,
    planeN: (n, h) => { const l = Math.hypot(...n); return [Math.cos(h) * n[0] / l, Math.cos(h) * n[1] / l, Math.cos(h) * n[2] / l, Math.sin(h)]; },
    planeRoot(p, v, N) {
        const [t0, t1] = S.planeRoots(p, v, N);
        return t0 > 1e-12 ? t0 : t1;
    },
    ballRoots(p, v, c, R) {
        // cos dist(γ(t), c) = A cos t + B sin t = M cos(t − φ) ≥ cos R inside the ball.
        const A = S.dot(p, c), B = S.dot(v, c), M = Math.hypot(A, B);
        if (M < Math.cos(R)) return null;
        const phi = Math.atan2(B, A), beta = Math.acos(Math.min(1, Math.cos(R) / M));
        return { entry: mod2pi(phi - beta), exit: mod2pi(phi + beta) };
    },
    S: Math.sin,
    twoArcs: true,
    cameraRay: S.cameraRay,
    tangentPair: S.tangentPair,
    diskEmitter: S.diskEmitter,
};

/** E³ in the same notation, the control: a point is (x, y, z, 1), a direction (x, y, z, 0), the form
 *  is the dot product of the first three coordinates, and a plane {normal, offset} is
 *  dot(p, normal) + offset = 0, N = (normal, offset), so ⟨p, N⟩ + N.w·p.w is its signed distance. */
const dot3 = (a: V4, b: V4) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const E3: Space = {
    name: 'euclidean',
    form: dot3,
    exp: (v) => [v[0], v[1], v[2], 1],
    flow: (p, v, t) => ({ pos: lin(p, 1, v, t), vel: v }),
    dist: (p, q) => Math.sqrt(dot3(lin(p, 1, q, -1), lin(p, 1, q, -1))),
    directionTo(p, q) { const d = lin(q, 1, p, -1); return lin(d, 1 / Math.sqrt(dot3(d, d)), d, 0); },
    planeN: (n, h) => { const l = Math.hypot(...n); return [n[0] / l, n[1] / l, n[2] / l, h]; },
    planeRoot(p, v, N) {
        const W = dot3(v, N);
        if (W === 0) return null;
        const t = -(dot3(p, N) + N[3] * p[3]) / W;
        return t > 0 ? t : null;
    },
    ballRoots(p, v, c, R) {
        const oc = lin(p, 1, c, -1), b = dot3(oc, v), disc = b * b - (dot3(oc, oc) - R * R);
        if (disc < 0) return null;
        return { entry: -b - Math.sqrt(disc), exit: -b + Math.sqrt(disc) };
    },
    S: (r) => r,
    twoArcs: false,
    cameraRay(pose, fov, size, fx, fy) {
        const b = cameraBasis(pose.position, pose.target);
        const [W, H] = size;
        const a = ((2 * fx) / W - 1) * (W / H) * Math.tan(fov / 2), c = ((2 * fy) / H - 1) * Math.tan(fov / 2);
        const d: V4 = [0, 1, 2].map((i) => b.forward[i] + a * b.right[i] + c * b.up[i]).concat(0) as V4;
        return { p: [...pose.position, 1] as V4, v: lin(d, 1 / Math.sqrt(dot3(d, d)), d, 0) };
    },
    tangentPair() { throw new Error('E3.tangentPair: not used by the specular twin'); },
    diskEmitter() { throw new Error('E3.diskEmitter: not used by the specular twin'); },
};

const unit = (sp: Space, v: V4): V4 => lin(v, 1 / Math.sqrt(sp.form(v, v)), v, 0);

// ---------------------------------------------------------------------------
// The specular box
// ---------------------------------------------------------------------------

export interface SpecularScene {
    walls: Array<{ normal: Vec3Tuple; offset: number; emission: RGB }>;
    mirror: { center: Vec3Tuple; radius: number; f0: RGB };
    glass: { center: Vec3Tuple; radius: number; ior: number };
    maxBounces: number;
}

/** dielectric_fresnel (core/math.glsl): exact unpolarized reflectance, eta = n_i/n_t, TIR → 1. */
export function dielectricFresnel(cosI: number, eta: number): number {
    const sin2t = eta * eta * (1 - cosI * cosI);
    if (sin2t >= 1) return 1;
    const cosT = Math.sqrt(1 - sin2t);
    const rPar = (cosI - eta * cosT) / (cosI + eta * cosT);
    const rPerp = (eta * cosI - cosT) / (eta * cosI + cosT);
    return 0.5 * (rPar * rPar + rPerp * rPerp);
}

/** schlick_fresnel (core/math.glsl), one channel. */
export const schlick = (f0: number, cos: number): number => f0 + (1 - f0) * Math.pow(1 - cos, 5);

/** What a ray met first in the specular box. */
export type SpecularHit = { kind: 'wall'; index: number; t: number } | { kind: 'ball'; index: 0 | 1; t: number } | null;

/** The first thing the ray (p, v) meets: `inside` is the ball it travels in (its exit root is the
 *  only candidate on it), `left` the ball it just left outward (a convex ball is not met again before
 *  a wall). Ball 0 is the mirror, ball 1 the glass. */
export function specularFirstHit(sp: Space, scene: SpecularScene, p: V4, v: V4, inside = -1, left = -1): SpecularHit {
    let best: SpecularHit = null;
    const consider = (h: NonNullable<SpecularHit>) => { if (h.t > 0 && (best === null || h.t < best.t)) best = h; };
    if (inside < 0) {
        scene.walls.forEach((w, index) => {
            const t = sp.planeRoot(p, v, sp.planeN(w.normal, w.offset));
            if (t !== null) consider({ kind: 'wall', index, t });
        });
    }
    [scene.mirror, scene.glass].forEach((b, j) => {
        if (j === left) return;
        const r = sp.ballRoots(p, v, sp.exp(b.center), b.radius);
        if (r === null) return;
        if (j === inside) consider({ kind: 'ball', index: j as 0 | 1, t: r.exit });
        else if (inside < 0) consider({ kind: 'ball', index: j as 0 | 1, t: r.entry });
    });
    return best;
}

/** The expected radiance along the ray (p, v) after `events` scattering events (see the header). */
export function specularRadiance(sp: Space, scene: SpecularScene, p: V4, v: V4, events = 0, inside = -1, left = -1): RGB {
    const hit = specularFirstHit(sp, scene, p, v, inside, left);
    if (hit === null) return [0, 0, 0];
    if (hit.kind === 'wall') return scene.walls[hit.index].emission;
    if (events === scene.maxBounces) return [0, 0, 0];
    const ball = hit.index === 0 ? scene.mirror : scene.glass;
    const { pos: y, vel } = sp.flow(p, v, hit.t);
    const wo = lin(vel, -1, vel, 0);
    const out = lin(sp.directionTo(y, sp.exp(ball.center)), -1, y, 0);   // outward normal at y
    const n = inside === hit.index ? lin(out, -1, out, 0) : out;           // faces the arrival side
    const cosI = Math.min(1, Math.max(1e-6, sp.form(wo, n)));
    const reflected = unit(sp, lin(n, 2 * cosI, wo, -1));
    if (hit.index === 0) {
        const L = specularRadiance(sp, scene, y, reflected, events + 1, -1, 0);
        return [0, 1, 2].map((c) => schlick(scene.mirror.f0[c], cosI) * L[c]) as RGB;
    }
    const entering = inside !== 1;
    const eta = entering ? 1 / scene.glass.ior : scene.glass.ior;
    const F = dielectricFresnel(cosI, eta);
    const R = specularRadiance(sp, scene, y, reflected, events + 1, entering ? -1 : 1, entering ? 1 : -1);
    if (F >= 1) return R;
    const cosT = Math.sqrt(Math.max(0, 1 - eta * eta * (1 - cosI * cosI)));
    const refracted = unit(sp, lin(wo, -eta, n, eta * cosI - cosT));
    const T = specularRadiance(sp, scene, y, refracted, events + 1, entering ? 1 : -1, entering ? -1 : 1);
    return [0, 1, 2].map((c) => F * R[c] + (1 - F) * eta * eta * T[c]) as RGB;
}

// ---------------------------------------------------------------------------
// GGX under a disk light
// ---------------------------------------------------------------------------

/** ggx_eval on metric invariants (n, wi, wo unit tangents at one point): the bare BRDF
 *  F·D·G1(wi)·G1(wo)/(4|cos_i||cos_o|), α = max(1e-3, roughness²), Schlick at |wo·h|. */
export function ggxEval(sp: Space, n: V4, wi: V4, wo: V4, roughness: number, f0: number): number {
    const ci = sp.form(n, wi), co = sp.form(n, wo);
    if (ci * co <= 0) return 0;
    const a = Math.max(1e-3, roughness * roughness);
    const h = unit(sp, lin(wi, 1, wo, 1));
    const ch = sp.form(n, h);
    const t = ch * ch * (a * a - 1) + 1;
    const D = (a * a) / (Math.PI * t * t);
    const G1 = (c: number) => (2 * Math.abs(c)) / (Math.abs(c) + Math.sqrt(a * a + (1 - a * a) * c * c));
    const F = schlick(f0, Math.abs(sp.form(wo, h)));
    return F * D * G1(ci) * G1(co) / (4 * Math.abs(ci) * Math.abs(co));
}

/** Outgoing radiance of a receiver point x (unit normal n) whose BRDF, at a fixed wo, is f(wi), under
 *  a one-sided disk emitter e: ∫ Le·f(wi)·cos_x·cos_y / S(r)² dA, Gauss–Legendre in the geodesic
 *  radius and the trapezoid rule in φ, both arcs in S³ (wi = ±u, the emitter cosine against the arc's
 *  reversed arrival direction ∓back). */
export function diskRadiance(sp: Space, x: V4, n: V4, e: { c: V4; m: V4; rho: number; Le: number },
    f: (wi: V4) => number, ns = 48, nphi = 96): number {
    const [e1, e2] = sp.tangentPair(e.c, e.m);
    const [nodes, weights] = gaussLegendre(ns);
    let sum = 0;
    for (let i = 0; i < ns; i++) {
        const s = 0.5 * e.rho * (nodes[i] + 1);
        const ws = 0.5 * e.rho * weights[i] * sp.S(s);
        for (let j = 0; j < nphi; j++) {
            const phi = (2 * Math.PI * j) / nphi;
            const y = sp.flow(e.c, lin(e1, Math.cos(phi), e2, Math.sin(phi)), s).pos;
            const A = sp.S(sp.dist(x, y)) ** 2;
            const u = sp.directionTo(x, y), back = sp.directionTo(y, x);
            for (const sign of sp.twoArcs ? [1, -1] : [1]) {
                const wi = lin(u, sign, u, 0);
                const cx = sp.form(n, wi), cy = sign * sp.form(e.m, back);
                if (cx > 0 && cy > 0) sum += ws * (2 * Math.PI / nphi) * e.Le * f(wi) * cx * cy / A;
            }
        }
    }
    return sum;
}

// ---------------------------------------------------------------------------
// A ball emitter
// ---------------------------------------------------------------------------

/** sin²α of the forward cone of a ball of radius R seen from distance d (clamped to 1). */
export function sphereSin2Max(sp: Space, R: number, d: number): number {
    return Math.min(1, (sp.S(R) / sp.S(d)) ** 2);
}

/** Irradiance at a one-sided receiver point x (unit normal n) from a ball emitter of radius R about c
 *  and radiance Le: Le·∫ over the forward cap of g(n·ω) dω (see the header), Gauss–Legendre in the
 *  polar angle θ ∈ [0, α] (weight sin θ) and the trapezoid rule in φ. */
export function sphereIrradiance(sp: Space, x: V4, n: V4, c: V4, R: number, Le: number, nt = 48, nphi = 96): number {
    const d = sp.dist(x, c);
    const alpha = Math.asin(Math.sqrt(sphereSin2Max(sp, R, d)));
    const u = sp.directionTo(x, c);
    const [t1, t2] = sp.tangentPair(x, u);
    const [nodes, weights] = gaussLegendre(nt);
    const g = (c: number) => (sp.twoArcs ? Math.abs(c) : Math.max(0, c));
    let sum = 0;
    for (let i = 0; i < nt; i++) {
        const th = 0.5 * alpha * (nodes[i] + 1);
        const wt = 0.5 * alpha * weights[i] * Math.sin(th);
        for (let j = 0; j < nphi; j++) {
            const phi = (2 * Math.PI * j) / nphi;
            const w = [0, 1, 2, 3].map((k) => Math.cos(th) * u[k] + Math.sin(th) * (Math.cos(phi) * t1[k] + Math.sin(phi) * t2[k])) as V4;
            sum += wt * (2 * Math.PI / nphi) * g(sp.form(n, w));
        }
    }
    return Le * sum;
}

// ---------------------------------------------------------------------------
// The receiver window (the lambert or ggx disk of radius rho about o in the plane y = 0, normal +y)
// ---------------------------------------------------------------------------

/** The mean over the runner's readout window of radiance(x, n, wo) at the receiver point each camera
 *  ray meets first (wo: the arrival direction reversed); `missed` counts points that miss it, or that
 *  meet `blocker(p, v, t)` (something closer than the receiver) first. */
export function receiverWindowMean(
    sp: Space, pose: { position: Vec3Tuple; target: Vec3Tuple }, fov: number, size: [number, number], region: WitnessRegion | undefined,
    rho: number, radiance: (x: V4, n: V4, wo: V4) => number, sub = 2, blocker?: (p: V4, v: V4, t: number) => boolean,
): { mean: number; missed: number } {
    const N: V4 = [0, 1, 0, 0];
    let missed = 0;
    const [mean] = regionMean((fx, fy) => sp.cameraRay(pose, fov, size, fx, fy), size, region, (p, v) => {
        const t = sp.planeRoot(p, v, N);
        const hit = t === null ? null : sp.flow(p, v, t);
        if (t === null || hit === null || sp.dist(hit.pos, [0, 0, 0, 1]) > rho || (blocker !== undefined && blocker(p, v, t))) {
            missed++;
            return [0, 0, 0];
        }
        const L = radiance(hit.pos, N, lin(hit.vel, -1, hit.vel, 0));
        return [L, L, L];
    }, sub);
    return { mean, missed };
}
