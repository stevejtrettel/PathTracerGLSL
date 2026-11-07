// tests/witnesses/scenes/curvedShapeTwins.ts
// fp64 TS transcriptions of the curved box, cylinder and quad bodies and of the curved quad light
// (components/geometry/{box,cylinder,quad}/*_{hyperbolic,spherical}.glsl,
// components/lights/quad/quad_{hyperbolic,spherical}.glsl), with independent membership tests that
// decide inside/outside from chart coordinates and axis distances — never from the face normals the
// bodies use — for the marched checks in tests/components/curvedShapes.test.ts. The derivations are
// in docs/claude-2026-11-review/curved/next-shapes-plan.md §2–§4.
//
// Every shape is in its own frame, canonical at o = (0,0,0,1). T(x) = tanh x (H³), tan x (S³).

import { hyperbolicGeometry } from '../../../src/components/ambient/hyperbolic/hyperbolic.js';
import { sphericalGeometry } from '../../../src/components/ambient/spherical/spherical.js';
import { mat4Apply, placementIsometry, type Mat4 } from '../../../src/components/ambient/isometry.js';
import { quatFromAxisAngle, IDENTITY_QUAT } from '../../../src/components/geometry/similarity.js';
import { curvedCameraRay, gaussLegendre, regionMean } from './curvedTwins.js';
import type { WitnessRegion } from '../types.js';
import { SHAPES_SIZE, type ShapesFixture } from './curvedShapesWitness.js';

export type Space = 'H3' | 'S3';
export type V4 = [number, number, number, number];

export const form = (S: Space, a: V4, b: V4): number =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + (S === 'H3' ? -1 : 1) * a[3] * b[3];
export const lin = (a: V4, s: number, b: V4, t: number): V4 => [a[0] * s + b[0] * t, a[1] * s + b[1] * t, a[2] * s + b[2] * t, a[3] * s + b[3] * t];
export const scale = (a: V4, s: number): V4 => [a[0] * s, a[1] * s, a[2] * s, a[3] * s];
const Tf = (S: Space, x: number) => (S === 'H3' ? Math.tanh(x) : Math.tan(x));
const Cf = (S: Space, x: number) => (S === 'H3' ? Math.cosh(x) : Math.cos(x));
const Sf = (S: Space, x: number) => (S === 'H3' ? Math.sinh(x) : Math.sin(x));
const mod = (x: number, m: number) => x - m * Math.floor(x / m);
const TWO_PI = 2 * Math.PI;

/** The point and velocity at arc length t along the geodesic (p, v). */
export function flow(S: Space, p: V4, v: V4, t: number): { pos: V4; vel: V4 } {
    if (S === 'H3') return { pos: lin(p, Math.cosh(t), v, Math.sinh(t)), vel: lin(p, Math.sinh(t), v, Math.cosh(t)) };
    return { pos: lin(p, Math.cos(t), v, Math.sin(t)), vel: lin(p, -Math.sin(t), v, Math.cos(t)) };
}

/** v projected to T_p and normalized in the metric. */
export function tangentUnit(S: Space, p: V4, v: V4): V4 {
    const w = lin(v, 1, p, S === 'H3' ? form(S, v, p) : -form(S, v, p));
    return scale(w, 1 / Math.sqrt(form(S, w, w)));
}

// ---------------------------------------------------------------------------
// Intervals along the geodesic. H³: X = e^{2t} ∈ (0, ∞); a half-space ⟨x, N⟩ ≤ 0 is
// (P + W)·X + (P − W) ≤ 0. S³: T = tan(t − φ) ∈ R on the arc with x_w > 0; a half-space is
// (aP + bW) + (aW − bP)·T ≤ 0. Both: c0 + c1·u ≤ 0.
// ---------------------------------------------------------------------------

interface Interval { lo: number; hi: number }

/** The interval narrowed by the linear condition c0 + c1·u ≤ 0 (null when empty). */
function linear(iv: Interval | null, c0: number, c1: number): Interval | null {
    if (iv === null) return null;
    if (c1 > 0) return clip(iv, -Infinity, -c0 / c1);
    if (c1 < 0) return clip(iv, -c0 / c1, Infinity);
    return c0 > 0 ? null : iv;
}
function clip(iv: Interval, lo: number, hi: number): Interval | null {
    const r = { lo: Math.max(iv.lo, lo), hi: Math.min(iv.hi, hi) };
    return r.lo <= r.hi ? r : null;
}

/** The set where qa·u² + 2·qb·u + qc ≤ 0, as at most two intervals. Stable roots: q = −qb − sign(qb)·√disc. */
function quadraticSet(qa: number, qb: number, qc: number): Interval[] {
    if (qa === 0) {
        const iv = linear({ lo: -Infinity, hi: Infinity }, qc, 2 * qb);
        return iv === null ? [] : [iv];
    }
    const disc = qb * qb - qa * qc;
    if (disc < 0) return qa > 0 ? [] : [{ lo: -Infinity, hi: Infinity }];
    const q = -qb - (qb >= 0 ? 1 : -1) * Math.sqrt(disc);
    const r1 = q / qa, r2 = q === 0 ? 0 : qc / q;
    const lo = Math.min(r1, r2), hi = Math.max(r1, r2);
    return qa > 0 ? [{ lo, hi }] : [{ lo: -Infinity, hi: lo }, { lo: hi, hi: Infinity }];
}

/** The first boundary crossing ahead among the endpoints of the intervals (finite ones only). */
function firstCrossing(S: Space, ivs: Interval[], a: number, b: number): number | null {
    let best: number | null = null;
    for (const iv of ivs) {
        for (const u of [iv.lo, iv.hi]) {
            if (!Number.isFinite(u)) continue;
            let t: number;
            if (S === 'H3') { if (!(u > 1)) continue; t = 0.5 * Math.log(u); }
            else { t = mod(Math.atan2(b + a * u, a - b * u), TWO_PI); if (!(t > 0)) continue; }
            if (best === null || t < best) best = t;
        }
    }
    return best;
}

/** The half-space conditions of the faces with normals Ns, as linear conditions in X (H³) or T (S³). */
function halfSpaces(S: Space, p: V4, v: V4, Ns: V4[]): Interval | null {
    let iv: Interval | null = S === 'H3' ? { lo: 0, hi: Infinity } : { lo: -Infinity, hi: Infinity };
    const a = p[3], b = v[3];
    for (const N of Ns) {
        const P = form(S, p, N), W = form(S, v, N);
        iv = S === 'H3' ? linear(iv, P - W, P + W) : linear(iv, a * P + b * W, a * W - b * P);
    }
    return iv;
}

// ---------------------------------------------------------------------------
// Box: half-widths h (geodesic distances from o to the faces).
// ---------------------------------------------------------------------------

/** The six outward face normals N_{i±}: (±cosh hᵢ·eᵢ, sinh hᵢ) in H³, (±cos hᵢ·eᵢ, −sin hᵢ) in S³. */
export function boxFaces(S: Space, h: number[]): V4[] {
    const out: V4[] = [];
    for (let i = 0; i < 3; i++) {
        for (const sg of [1, -1]) {
            const N: V4 = [0, 0, 0, S === 'H3' ? Math.sinh(h[i]) : -Math.sin(h[i])];
            N[i] = sg * Cf(S, h[i]);
            out.push(N);
        }
    }
    return out;
}

/** The S³ shape's smallest x_w: a geodesic whose largest x_w is not above it misses. */
export function boxMinW(h: number[]): number {
    return 1 / Math.sqrt(1 + h.reduce((s, x) => s + Math.tan(x) ** 2, 0));
}

export function boxIntersect(S: Space, p: V4, v: V4, h: number[]): number | null {
    const a = p[3], b = v[3];
    if (S === 'S3' && Math.hypot(a, b) <= boxMinW(h)) return null;
    const iv = halfSpaces(S, p, v, boxFaces(S, h));
    return iv === null ? null : firstCrossing(S, [iv], a, b);
}

/** The outward normal: the face whose ⟨p, N⟩ is largest (the face p lies on). */
export function boxNormal(S: Space, p: V4, h: number[]): V4 {
    let best = boxFaces(S, h)[0], bv = -Infinity;
    for (const N of boxFaces(S, h)) { const x = form(S, p, N); if (x > bv) { bv = x; best = N; } }
    return best;
}

export function boxSdf(S: Space, p: V4, h: number[]): number {
    let s = -Infinity;
    for (let i = 0; i < 3; i++) s = Math.max(s, Math.abs(p[i]) * Cf(S, h[i]) - p[3] * (S === 'H3' ? Math.sinh(h[i]) : Math.sin(h[i])));
    return S === 'H3' ? Math.asinh(s) : Math.asin(Math.max(-1, Math.min(1, s)));
}

/** Independent membership: the chart box |xᵢ/x_w| ≤ T(hᵢ) with x_w > 0. */
export function boxInside(S: Space, x: V4, h: number[]): boolean {
    if (!(x[3] > 0)) return false;
    for (let i = 0; i < 3; i++) if (Math.abs(x[i] / x[3]) > Tf(S, h[i])) return false;
    return true;
}

// ---------------------------------------------------------------------------
// Cylinder: tube of radius r about the y-axis geodesic, caps at axial distance ±h.
// ---------------------------------------------------------------------------

export function capFaces(S: Space, h: number): V4[] {
    const w = S === 'H3' ? Math.sinh(h) : -Math.sin(h);
    return [[0, Cf(S, h), 0, w], [0, -Cf(S, h), 0, w]];
}

export function cylinderIntersect(S: Space, p: V4, v: V4, r: number, h: number): number | null {
    const a = p[3], b = v[3];
    if (S === 'S3' && Math.hypot(a, b) <= Math.cos(r) * Math.cos(h)) return null;
    const caps = halfSpaces(S, p, v, capFaces(S, h));
    if (caps === null) return null;
    const P = [p[0], p[2]], V = [v[0], v[2]];
    const s2 = Sf(S, r) ** 2;
    let tube: Interval[];
    if (S === 'H3') {
        // 4X(|γ_xz|² − S²) = α X² + 2β X + γ̂.
        const pv = [P[0] + V[0], P[1] + V[1]], mv = [P[0] - V[0], P[1] - V[1]];
        const alpha = pv[0] ** 2 + pv[1] ** 2, gamma = mv[0] ** 2 + mv[1] ** 2;
        const beta = P[0] ** 2 + P[1] ** 2 - V[0] ** 2 - V[1] ** 2 - 2 * s2;
        tube = quadraticSet(alpha, beta, gamma);
    } else {
        // (|Ṽ|² − A²S²)T² + 2(P̃·Ṽ)T + (|P̃|² − A²S²), P̃ = aP + bV, Ṽ = aV − bP.
        const A2 = a * a + b * b;
        const Pt = [a * P[0] + b * V[0], a * P[1] + b * V[1]], Vt = [a * V[0] - b * P[0], a * V[1] - b * P[1]];
        tube = quadraticSet(Vt[0] ** 2 + Vt[1] ** 2 - A2 * s2, Pt[0] * Vt[0] + Pt[1] * Vt[1], Pt[0] ** 2 + Pt[1] ** 2 - A2 * s2);
    }
    const ivs = tube.map((iv) => clip(iv, caps.lo, caps.hi)).filter((iv): iv is Interval => iv !== null);
    return firstCrossing(S, ivs, a, b);
}

/** The tube's signed distance and the caps', whose larger picks the face p lies on. */
function cylinderTerms(S: Space, p: V4, r: number, h: number): { tube: number; cap: number } {
    const s = Math.hypot(p[0], p[2]);
    const c = S === 'H3' ? Math.abs(p[1]) * Math.cosh(h) - p[3] * Math.sinh(h) : Math.abs(p[1]) * Math.cos(h) - p[3] * Math.sin(h);
    return S === 'H3'
        ? { tube: Math.asinh(s) - r, cap: Math.asinh(c) }
        : { tube: Math.atan2(s, Math.hypot(p[1], p[3])) - r, cap: Math.asin(Math.max(-1, Math.min(1, c))) };
}

export function cylinderSdf(S: Space, p: V4, r: number, h: number): number {
    const { tube, cap } = cylinderTerms(S, p, r, h);
    return Math.max(tube, cap);
}

/** The outward normal: the cap's when its signed distance exceeds the tube's, else the velocity at
 *  p of the geodesic leaving the axis perpendicularly. */
export function cylinderNormal(S: Space, p: V4, r: number, h: number): V4 {
    const { tube, cap } = cylinderTerms(S, p, r, h);
    if (cap > tube) return capFaces(S, h)[p[1] >= 0 ? 0 : 1];
    const s = Math.hypot(p[0], p[2]);
    if (S === 'H3') {
        const C = Math.sqrt(1 + s * s);
        return [C * p[0] / s, (s / C) * p[1], C * p[2] / s, (s / C) * p[3]];
    }
    const c = Math.hypot(p[1], p[3]);
    return [c * p[0] / s, -(s / c) * p[1], c * p[2] / s, -(s / c) * p[3]];
}

/** Independent membership: distance to the axis ≤ r and axial coordinate within ±h. */
export function cylinderInside(S: Space, x: V4, r: number, h: number): boolean {
    const s = Math.hypot(x[0], x[2]);
    if (S === 'H3') return Math.asinh(s) <= r && Math.abs(Math.atanh(x[1] / x[3])) <= h;
    return Math.atan2(s, Math.hypot(x[1], x[3])) <= r && Math.abs(Math.atan2(x[1], x[3])) <= h;
}

// ---------------------------------------------------------------------------
// Quad: the rectangle centered at o with edges edge1, edge2 (tangent vectors at o, orthogonal),
// half-widths a = |edge1|/2, b = |edge2|/2; emitting side +ê1×ê2.
// ---------------------------------------------------------------------------

export type V3 = [number, number, number];
const cross3 = (u: V3, w: V3): V3 => [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
const norm3 = (u: V3) => Math.hypot(u[0], u[1], u[2]);
const unit3 = (u: V3): V3 => { const n = norm3(u); return [u[0] / n, u[1] / n, u[2] / n]; };

export function quadNormal4(e1: V3, e2: V3): V4 {
    const n = unit3(cross3(e1, e2));
    return [n[0], n[1], n[2], 0];
}

/** The chart test |h·êᵢ| ≤ T(aᵢ)·h_w. */
function quadContains(S: Space, x: V4, e1: V3, e2: V3): boolean {
    const u1 = unit3(e1), u2 = unit3(e2);
    const d1 = x[0] * u1[0] + x[1] * u1[1] + x[2] * u1[2];
    const d2 = x[0] * u2[0] + x[1] * u2[1] + x[2] * u2[2];
    return Math.abs(d1) <= Tf(S, 0.5 * norm3(e1)) * x[3] && Math.abs(d2) <= Tf(S, 0.5 * norm3(e2)) * x[3];
}

export function quadIntersect(S: Space, p: V4, v: V4, e1: V3, e2: V3): number | null {
    const N = quadNormal4(e1, e2);
    const P = form(S, p, N), W = form(S, v, N);
    if (S === 'H3') {
        if (P * W >= 0 || Math.abs(W) <= Math.abs(P)) return null;
        const t = 0.5 * Math.log((W - P) / (W + P));
        return quadContains(S, flow(S, p, v, t).pos, e1, e2) ? t : null;
    }
    if (P === 0 && W === 0) return null;
    let t0 = mod(Math.atan2(-P, W), Math.PI);
    if (t0 <= 0) t0 += Math.PI;
    const x = flow(S, p, v, t0).pos;
    if (quadContains(S, x, e1, e2)) return t0;
    if (quadContains(S, scale(x, -1), e1, e2)) return t0 + Math.PI;
    return null;
}

/** Independent membership of a point of the quad's plane: the chart coordinates of x, by the
 *  gnomonic/Klein map, inside the rectangle. */
export function quadChart(x: V4, e1: V3, e2: V3): [number, number] {
    const u1 = unit3(e1), u2 = unit3(e2);
    return [(x[0] * u1[0] + x[1] * u1[1] + x[2] * u1[2]) / x[3], (x[0] * u2[0] + x[1] * u2[1] + x[2] * u2[2]) / x[3]];
}

// ---------------------------------------------------------------------------
// Quad light (world frame): center c, edge tangent vectors E1, E2 at c (lengths 2a, 2b).
// ---------------------------------------------------------------------------

/** The 4D cross product: X·d = det[E1; E2; d; c] (rows), so X ⊥ E1, E2, c (Euclidean dot). */
export function cross4(E1: V4, E2: V4, c: V4): V4 {
    const det3 = (r0: number[], r1: number[], r2: number[]) =>
        r0[0] * (r1[1] * r2[2] - r1[2] * r2[1]) - r0[1] * (r1[0] * r2[2] - r1[2] * r2[0]) + r0[2] * (r1[0] * r2[1] - r1[1] * r2[0]);
    // Expand det[E1; E2; d; c] along row 3 (d): the cofactor of column j is (−1)^{2+j}·minor.
    const minor = (j: number) => {
        const cols = [0, 1, 2, 3].filter((k) => k !== j);
        return det3(cols.map((k) => E1[k]), cols.map((k) => E2[k]), cols.map((k) => c[k]));
    };
    return [minor(0), -minor(1), minor(2), -minor(3)];
}

/** The quad light's unit normal at c: J·X normalized in the metric (J = diag(1,1,1,−1) in H³). */
export function quadLightNormal(S: Space, c: V4, E1: V4, E2: V4): V4 {
    const X = cross4(E1, E2, c);
    const N: V4 = S === 'H3' ? [X[0], X[1], X[2], -X[3]] : X;
    return scale(N, 1 / Math.sqrt(form(S, N, N)));
}

/** A chart-uniform sample of the quad: k = (T(a)(2ξ₁−1), T(b)(2ξ₂−1)), y = (c + k₁û₁ + k₂û₂)/√(1 ∓ |k|²). */
export function quadLightPoint(S: Space, c: V4, E1: V4, E2: V4, xi1: number, xi2: number): V4 {
    const l1 = Math.sqrt(form(S, E1, E1)), l2 = Math.sqrt(form(S, E2, E2));
    const k1 = Tf(S, 0.5 * l1) * (2 * xi1 - 1), k2 = Tf(S, 0.5 * l2) * (2 * xi2 - 1);
    const y = lin(lin(c, 1, E1, k1 / l1), 1, E2, k2 / l2);
    return scale(y, 1 / Math.sqrt(1 + (S === 'H3' ? -1 : 1) * (k1 * k1 + k2 * k2)));
}

/** The chart-uniform sampler's density with respect to area at a point y of the quad:
 *  1/(4·T(a)·T(b)·w³), w = −⟨y, c⟩ (H³) or y·c (S³). */
export function quadLightAreaPdf(S: Space, c: V4, E1: V4, E2: V4, y: V4): number {
    const w = S === 'H3' ? -form(S, y, c) : form(S, y, c);
    const A = Tf(S, 0.5 * Math.sqrt(form(S, E1, E1))), B = Tf(S, 0.5 * Math.sqrt(form(S, E2, E2)));
    return 1 / (4 * A * B * w * w * w);
}

/** The rectangle's area by Gauss–Bonnet: 2π − 4α (H³, cos α = sinh a sinh b), 4α − 2π (S³,
 *  cos α = −sin a sin b). */
export function quadArea(S: Space, a: number, b: number): number {
    if (S === 'H3') return 2 * Math.PI - 4 * Math.acos(Math.sinh(a) * Math.sinh(b));
    return 4 * Math.acos(-Math.sin(a) * Math.sin(b)) - 2 * Math.PI;
}

// ---------------------------------------------------------------------------
// Scenes (the witnesses' expected values): shapes placed by isometries g (world = g·local), the
// first hit of a world ray, a lambert surface's radiance under a point light over every geodesic
// from the hit to the light with its visibility, and a quad light's irradiance by quadrature.
// ---------------------------------------------------------------------------

export const geometryOf = (S: Space) => (S === 'H3' ? hyperbolicGeometry : sphericalGeometry);

/** A shape in its own frame (the twin intersectors above) and its placement. */
export type LocalShape =
    | { kind: 'box'; halfSize: number[] }
    | { kind: 'cylinder'; radius: number; halfHeight: number }
    | { kind: 'quad'; edge1: V3; edge2: V3 };
export interface PlacedShape { shape: LocalShape; g: Mat4; ginv: Mat4 }

/** The placement of an authored transform {position, rotation} applied to a shape first moved from o
 *  by `pre` (its center: the quad's corner + (edge1 + edge2)/2), as the compiler places it. */
export function place(S: Space, shape: LocalShape, position: V3, rotation?: { axis: V3; angle: number }, pre: V3 = [0, 0, 0]): PlacedShape {
    const geom = geometryOf(S);
    const g = placementIsometry(geom, position, rotation === undefined ? IDENTITY_QUAT : quatFromAxisAngle(rotation.axis, rotation.angle), pre);
    return { shape, g, ginv: geom.inverse(g) };
}

function localHit(S: Space, s: LocalShape, p: V4, v: V4): number | null {
    if (s.kind === 'box') return boxIntersect(S, p, v, s.halfSize);
    if (s.kind === 'cylinder') return cylinderIntersect(S, p, v, s.radius, s.halfHeight);
    return quadIntersect(S, p, v, s.edge1, s.edge2);
}
function localNormal(S: Space, s: LocalShape, x: V4): V4 {
    if (s.kind === 'box') return boxNormal(S, x, s.halfSize);
    if (s.kind === 'cylinder') return cylinderNormal(S, x, s.radius, s.halfHeight);
    return quadNormal4(s.edge1, s.edge2);
}

/** The first hit of the world ray (p, v) on (0, tmax): the shape's index, the point and the world
 *  normal (g applied to the local one). */
export function sceneHit(S: Space, shapes: PlacedShape[], p: V4, v: V4, tmax = S === 'H3' ? 10 : 2 * Math.PI): { index: number; t: number; x: V4; n: V4 } | null {
    let best: { index: number; t: number; x: V4; n: V4 } | null = null;
    shapes.forEach((sh, index) => {
        const lp = mat4Apply(sh.ginv, p) as V4, lv = mat4Apply(sh.ginv, v) as V4;
        const t = localHit(S, sh.shape, lp, lv);
        if (t === null || t >= tmax || (best !== null && t >= best.t)) return;
        const lx = flow(S, lp, lv, t).pos;
        best = { index, t, x: mat4Apply(sh.g, lx) as V4, n: mat4Apply(sh.g, localNormal(S, sh.shape, lx)) as V4 };
    });
    return best;
}

/** Geodesic distance (the short arc in S³). */
export function distance(S: Space, a: V4, b: V4): number {
    const c = lin(a, 1, b, -1);
    if (S === 'H3') return 2 * Math.asinh(0.5 * Math.sqrt(Math.max(form(S, c, c), 0)));
    const d = lin(a, 1, b, 1);
    return 2 * Math.atan2(Math.sqrt(form(S, c, c)), Math.sqrt(form(S, d, d)));
}

/** The geodesics from x to q: one in H³; the short arc (along u, length d) and the long arc (along
 *  −u, length 2π − d) in S³. */
function arcs(S: Space, x: V4, q: V4): Array<{ dir: V4; length: number }> {
    const u = tangentUnit(S, x, lin(q, 1, x, -1)), d = distance(S, x, q);
    return S === 'H3' ? [{ dir: u, length: d }] : [{ dir: u, length: d }, { dir: scale(u, -1), length: 2 * Math.PI - d }];
}

/** The radiance a camera ray (p, v) reads off a lambert scene (albedo ρ) lit by a point light of
 *  intensity I at q, maxBounces 1: (ρ/π)·Σ_arcs I·max(0, cos θ)·vis / S(d)², with cos θ against the
 *  normal turned toward the camera (an opaque surface is lit on the side it is seen from) and the
 *  visibility of each arc tested against every shape. 0 when the ray misses. */
export function pointLitRadiance(S: Space, shapes: PlacedShape[], p: V4, v: V4, q: V4, I: number, albedo: number): { L: number; index: number } {
    const hit = sceneHit(S, shapes, p, v);
    if (hit === null) return { L: 0, index: -1 };
    const arrival = flow(S, p, v, hit.t).vel;
    const n = form(S, hit.n, arrival) < 0 ? hit.n : scale(hit.n, -1);
    const A = (S === 'H3' ? Math.sinh(distance(S, hit.x, q)) : Math.sin(distance(S, hit.x, q))) ** 2;
    let E = 0;
    for (const arc of arcs(S, hit.x, q)) {
        const c = form(S, n, arc.dir);
        if (c <= 0) continue;
        // the shadow geodesic, started a hair off the surface on the lit side
        const o = flow(S, hit.x, n, 1e-9).pos;
        const dir = tangentUnit(S, o, arc.dir);
        const blocker = sceneHit(S, shapes, o, dir, arc.length - 1e-9);
        if (blocker === null) E += I * c / A;
    }
    return { L: (albedo / Math.PI) * E, index: hit.index };
}

/** A quad light in world coordinates: center c, edges E1, E2 (tangent at c), normal N, radiance Le. */
export interface QuadEmitter { c: V4; E1: V4; E2: V4; N: V4; Le: number }

/** The quad light an authored {corner, edge1, edge2} makes: placed by the transvection to its center
 *  corner + (edge1 + edge2)/2, the edges carried there. */
export function quadEmitter(S: Space, corner: V3, edge1: V3, edge2: V3, Le: number): QuadEmitter {
    const center: V3 = [corner[0] + 0.5 * (edge1[0] + edge2[0]), corner[1] + 0.5 * (edge1[1] + edge2[1]), corner[2] + 0.5 * (edge1[2] + edge2[2])];
    const g = placementIsometry(geometryOf(S), [0, 0, 0], IDENTITY_QUAT, center);
    const c = mat4Apply(g, [0, 0, 0, 1]) as V4;
    const E1 = mat4Apply(g, [...edge1, 0]) as V4, E2 = mat4Apply(g, [...edge2, 0]) as V4;
    return { c, E1, E2, N: quadLightNormal(S, c, E1, E2), Le };
}

/** Irradiance at x (unit normal nx) from a quad emitter: ∫ Le·Σ_arcs max(cos_x, 0)·max(cos_y, 0)/S(d)² dA
 *  over the rectangle, Gauss–Legendre in its chart coordinates with dA = w³·dk₁dk₂ (cos_y against
 *  the arc's reversed arrival direction: back = direction_to(y, x) for the short arc, −back for the
 *  long one). Nothing occludes in the quad-light witnesses. `density` replaces the area element's
 *  w³ (the mutation-size prediction of the witness test integrates with w² in its place). */
export function quadIrradiance(S: Space, x: V4, nx: V4, e: QuadEmitter, n = 24, density: (w: number) => number = (w) => w * w * w): number {
    const [nodes, weights] = gaussLegendre(n);
    const A = (S === 'H3' ? Math.tanh : Math.tan)(0.5 * Math.sqrt(form(S, e.E1, e.E1)));
    const B = (S === 'H3' ? Math.tanh : Math.tan)(0.5 * Math.sqrt(form(S, e.E2, e.E2)));
    let sum = 0;
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            const y = quadLightPoint(S, e.c, e.E1, e.E2, 0.5 * (nodes[i] + 1), 0.5 * (nodes[j] + 1));
            const w = S === 'H3' ? -form(S, y, e.c) : form(S, y, e.c);
            const dA = A * B * weights[i] * weights[j] * density(w);
            const d = distance(S, x, y);
            const Ad = (S === 'H3' ? Math.sinh(d) : Math.sin(d)) ** 2;
            const u = tangentUnit(S, x, lin(y, 1, x, -1)), back = tangentUnit(S, y, lin(x, 1, y, -1));
            const cases = S === 'H3' ? [[form(S, nx, u), form(S, e.N, back)]] : [[form(S, nx, u), form(S, e.N, back)], [-form(S, nx, u), -form(S, e.N, back)]];
            for (const [cx, cy] of cases) if (cx > 0 && cy > 0) sum += e.Le * cx * cy / Ad * dA;
        }
    }
    return sum;
}

// ---------------------------------------------------------------------------
// The shapes witnesses (curvedShapesWitness.ts): the fixture's shapes placed as the compiler places
// them, and each readout window's mean and the faces it covers.
// ---------------------------------------------------------------------------

export function shapesOf(S: Space, f: ShapesFixture): PlacedShape[] {
    const c = f.quad.corner, e1 = f.quad.edge1, e2 = f.quad.edge2;
    const center: V3 = [c[0] + 0.5 * (e1[0] + e2[0]), c[1] + 0.5 * (e1[1] + e2[1]), c[2] + 0.5 * (e1[2] + e2[2])];
    return [
        place(S, { kind: 'box', halfSize: f.box.halfSize }, f.box.position, f.box.rotation),
        place(S, { kind: 'cylinder', radius: f.cylinder.radius, halfHeight: f.cylinder.halfHeight }, f.cylinder.position, f.cylinder.rotation),
        place(S, { kind: 'quad', edge1: e1, edge2: e2 }, [0, 0, 0], undefined, center),
    ];
}

const shapesRay = (S: Space, f: ShapesFixture) => (fx: number, fy: number) =>
    curvedCameraRay(geometryOf(S), f.pose, f.fov, SHAPES_SIZE, fx, fy) as { p: V4; v: V4 };

/** The window's mean radiance through the fixture's pinhole camera (regionMean, sub×sub points
 *  per pixel). */
export function shapesWindowMean(S: Space, f: ShapesFixture, region: WitnessRegion, sub = 2): number {
    const shapes = shapesOf(S, f), q = geometryOf(S).exp(f.light.position) as V4;
    return regionMean(shapesRay(S, f), SHAPES_SIZE, region, (p, v) => {
        const L = pointLitRadiance(S, shapes, p, v, q, f.light.intensity, f.albedo).L;
        return [L, L, L];
    }, sub)[0];
}

/** The faces the window's points see ('box ±x/y/z' by the local normal, 'cylinder tube' or
 *  'cylinder cap', 'quad', 'miss'), and how many of them are unlit, at sub×sub points per pixel. */
export function shapesWindowFaces(S: Space, f: ShapesFixture, region: WitnessRegion, sub = 4): { faces: Set<string>; unlit: number } {
    const shapes = shapesOf(S, f), q = geometryOf(S).exp(f.light.position) as V4;
    const faces = new Set<string>();
    let unlit = 0;
    regionMean(shapesRay(S, f), SHAPES_SIZE, region, (p, v) => {
        const hit = sceneHit(S, shapes, p, v);
        if (hit === null) { faces.add('miss'); return [0, 0, 0]; }
        const sh = shapes[hit.index];
        const ln = mat4Apply(sh.ginv, hit.n) as V4;
        if (sh.shape.kind === 'box') {
            const a = [0, 1, 2].map((i) => Math.abs(ln[i]));
            const i = a.indexOf(Math.max(...a));
            faces.add(`box ${ln[i] > 0 ? '+' : '-'}${'xyz'[i]}`);
        } else if (sh.shape.kind === 'cylinder') faces.add(Math.abs(ln[1]) > 0.9 ? 'cylinder cap' : 'cylinder tube');
        else faces.add('quad');
        if (pointLitRadiance(S, shapes, p, v, q, f.light.intensity, f.albedo).L === 0) unlit++;
        return [0, 0, 0];
    }, sub);
    return { faces, unlit };
}
