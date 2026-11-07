// tests/helpers/seifertWeberTwin.ts — float64 twin of the seifert-weber-windows witness
// (tests/witnesses/scenes/seifertWeberWitness.ts; docs/claude-2026-11-review/quotients-plan.md,
// Q2.6 witness 1).
//
// The scene: emissive spheres in the Dirichlet domain D of the Seifert–Weber space H³/Γ, seen by
// a pinhole camera in D with maxBounces 0, so a pixel reads the emission of the first sphere image
// its camera ray meets within the far clip R, or 0.
//
// This twin finds that first hit by BRUTE FORCE over the images γ·S of each sphere in the
// universal cover H³ (not by the cell walk the renderer runs). It builds Γ itself from the closed
// forms (the same formulas as components/quotient/seifert-weber, written out again here so that an
// edit to the occupant's data cannot move the twin with it), lists every cell γD that can meet the
// ball of radius R + r about the camera, and intersects the pixel ray with every sphere image in
// those cells. The camera ray is the pinhole occupant's (curvedTwins.ts, which the H³ witnesses
// share). Conventions: the hyperboloid model, ⟨a,b⟩ = a·b(xyz) − a_w·b_w, o = (0,0,0,1),
// column-major 4×4 matrices.

import type { Vec3Tuple } from '../../src/components/geometry/similarity.js';
import { curvedCameraRay, type V4 } from '../witnesses/scenes/curvedTwins.js';
import { hyperbolicGeometry } from '../../src/components/ambient/hyperbolic/hyperbolic.js';

type M4 = number[];

const form = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] - a[3] * b[3];
const apply = (m: M4, v: readonly number[]): V4 => [0, 1, 2, 3].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]) as V4;
function multiply(a: M4, b: M4): M4 {
    const out = new Array<number>(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[4 * c + r] += a[4 * k + r] * b[4 * c + k];
    return out;
}
/** g⁻¹ = J·gᵀ·J for an isometry of the form (J = diag(1, 1, 1, −1)). */
function inverse(g: M4): M4 {
    const out = new Array<number>(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[4 * c + r] = g[4 * r + c] * (r === 3 ? -1 : 1) * (c === 3 ? -1 : 1);
    return out;
}
const O: V4 = [0, 0, 0, 1];
export const dist = (a: readonly number[], b: readonly number[]): number => Math.acosh(Math.max(1, -form(a, b)));
/** Whether two orbit points γ·o, γ'·o are the same: distinct ones are at least 2r_in ≈ 2 apart,
 *  and coordinates are compared (acosh near 1 would turn product rounding into ~1e-5). */
const sameCell = (a: V4, b: V4): boolean => a.every((x, k) => Math.abs(x - b[k]) <= 1e-7 * Math.abs(a[3]));

// ---- the group, from closed forms ----------------------------------------------------------------

const SQ5 = Math.sqrt(5);
const PHI = (1 + SQ5) / 2;
/** cosh² r_in = (5 + 2√5)/4. */
export const R_IN = Math.acosh(Math.sqrt((5 + 2 * SQ5) / 4));
/** cosh R_c = (7 + 3√5)/4. */
export const R_C = Math.acosh((7 + 3 * SQ5) / 4);

/** Face 2k has the unit direction +u_k at o, face 2k + 1 the direction −u_k. */
const U: Vec3Tuple[] = [[0, 1, PHI], [0, 1, -PHI], [1, PHI, 0], [1, -PHI, 0], [PHI, 0, 1], [-PHI, 0, 1]].flatMap((d) => {
    const n = Math.hypot(d[0], d[1], d[2]);
    return [[d[0] / n, d[1] / n, d[2] / n] as Vec3Tuple, [-d[0] / n, -d[1] / n, -d[2] / n] as Vec3Tuple];
});
/** Outward unit face normals: ⟨N_i, p⟩ = sinh of p's signed distance beyond face i. */
export const NORMALS: V4[] = U.map((u) => [u[0] * Math.cosh(R_IN), u[1] * Math.cosh(R_IN), u[2] * Math.cosh(R_IN), Math.sinh(R_IN)]);

/** The boost carrying o a distance s along the unit direction u. */
function boost(u: Vec3Tuple, s: number): M4 {
    const ch = Math.cosh(s), sh = Math.sinh(s);
    const m: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (let c = 0; c < 3; c++) {
        for (let r = 0; r < 3; r++) m[4 * c + r] += (ch - 1) * u[r] * u[c];
        m[4 * c + 3] = sh * u[c];
        m[12 + c] = sh * u[c];
    }
    m[15] = ch;
    return m;
}
/** The right-handed rotation by θ about the unit axis u through o. */
function spin(u: Vec3Tuple, theta: number): M4 {
    const c = Math.cos(theta), s = Math.sin(theta);
    // Rv = c·v + s·(u × v) + (1 − c)(u·v)u, column by column.
    const col = (e: Vec3Tuple): Vec3Tuple => {
        const cr: Vec3Tuple = [u[1] * e[2] - u[2] * e[1], u[2] * e[0] - u[0] * e[2], u[0] * e[1] - u[1] * e[0]];
        const d = u[0] * e[0] + u[1] * e[1] + u[2] * e[2];
        return [0, 1, 2].map((k) => c * e[k] + s * cr[k] + (1 - c) * d * u[k]) as Vec3Tuple;
    };
    const [a, b, d] = [col([1, 0, 0]), col([0, 1, 0]), col([0, 0, 1])];
    return [a[0], a[1], a[2], 0, b[0], b[1], b[2], 0, d[0], d[1], d[2], 0, 0, 0, 0, 1];
}

/** The pairings: a ray leaving D through face i continues from PAIRINGS[i] of its exit state.
 *  g_{2k} = (boost by 2r_in along −u_k)·(rotation by `twist` about u_k), g_{2k+1} = g_{2k}⁻¹. The
 *  Seifert–Weber space has twist 3π/5 (3/10 of a turn); `twist` is a parameter so that the
 *  witness's own test can show a wrong twist moves the windows. */
export function pairings(twist = (3 * Math.PI) / 5): M4[] {
    return [0, 1, 2, 3, 4, 5].flatMap((k) => {
        const u = U[2 * k];
        const g = multiply(boost([-u[0], -u[1], -u[2]], 2 * R_IN), spin(u, twist));
        return [g, inverse(g)];
    });
}

/** A convex region about the camera x: the geodesics from x of length ≤ `reach` whose initial
 *  direction lies within `half` (< π/2) of the unit tangent `axis` at x. In the Klein model
 *  centered at x it is a Euclidean cone cut by a Euclidean ball, so it is convex. */
export interface ViewCone { x: V4; axis: V4; half: number; reach: number }

const angleBetween = (a: V4, b: V4): number => Math.acos(Math.max(-1, Math.min(1, form(a, b))));

/** The unit direction at x of the geodesic to y, and the distance. */
function directionTo(x: V4, y: V4): { u: V4; d: number } {
    const d = dist(x, y);
    return { u: [0, 1, 2, 3].map((k) => (y[k] - Math.cosh(d) * x[k]) / Math.sinh(d)) as V4, d };
}

/**
 * Every element γ of Γ whose cell γD can meet the cone K, found by a breadth-first search over
 * face-adjacent cells (the cell across face j of γD is γ·g_j⁻¹·D = γ·g_{j xor 1}·D, so the
 * neighbors are γ·g_j over all j). A cell is kept unless one of two lower bounds rules it out:
 * x lies beyond one of γD's face planes by more than `reach` (max_i asinh⟨N_i, γ⁻¹x⟩), or the
 * ball B(γo, R_c) ⊇ γD lies outside the cone of directions. That keeps every cell that meets K,
 * and the cells meeting a convex set are connected through faces, so the search finds them all.
 * Cells are told apart by γ·o (Γ acts freely).
 */
export function cellsMeeting(k: ViewCone, gens: M4[] = pairings()): M4[] {
    const key = (g: M4) => { const p = apply(g, O); return `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`; };
    const mayMeet = (g: M4) => {
        const y = apply(inverse(g), k.x);
        for (const n of NORMALS) if (Math.asinh(form(n, y)) > k.reach) return false;
        const { u, d } = directionTo(k.x, apply(g, O));
        if (d <= R_C) return true;
        return angleBetween(u, k.axis) <= k.half + Math.asin(Math.min(1, Math.sinh(R_C) / Math.sinh(d)));
    };
    const identity: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const seen = new Set<string>([key(identity)]);
    const out: M4[] = [identity];
    for (let i = 0; i < out.length; i++) {
        for (const g of gens) {
            const h = multiply(out[i], g);
            const hk = key(h);
            if (seen.has(hk)) continue;
            seen.add(hk);
            if (mayMeet(h)) out.push(h);
        }
    }
    return out;
}

// ---- the scene and the camera rays ----------------------------------------------------------------

export interface SwSphere { center: Vec3Tuple; radius: number; emission: [number, number, number] }

export interface SwWindowsGeometry {
    spheres: SwSphere[];
    camera: Vec3Tuple;
    target: Vec3Tuple;
    /** Vertical field of view (radians) and the image size in pixels. */
    fov: number;
    size: [number, number];
    /** The far clip R. */
    farClip: number;
}

/** One sphere image: which sphere, its cell γ (γ·o identifies it), its center, the unit
 *  direction to it from the camera, and sin of its angular radius. */
export interface SwImage { sphere: number; gammaO: V4; c: V4; u: V4; sinA: number; coshR: number }

/** A camera ray's first hit: the sphere and the cell (γ·o) of the image, and the arc length. */
export type SwFilmClass = { kind: 'miss' } | { kind: 'hit'; sphere: number; gammaO: V4; t: number };

export class SwWindowsTwin {
    readonly g: SwWindowsGeometry;
    readonly gens: M4[];
    readonly cam: V4;

    constructor(g: SwWindowsGeometry, twist?: number) {
        this.g = g;
        this.gens = pairings(twist);
        this.cam = hyperbolicGeometry.exp(g.camera) as V4;
    }

    /** The camera ray through film point (fx, fy) (pixel units, origin bottom-left). */
    ray(fx: number, fy: number): { p: V4; v: V4 } {
        return curvedCameraRay(hyperbolicGeometry, { position: this.g.camera, target: this.g.target }, this.g.fov, this.g.size, fx, fy);
    }

    /** Every sphere image a camera ray through the film rectangle [x0, x1] × [y0, y1] can meet
     *  within the far clip: the images in the cells meeting the rectangle's view cone (whose axis
     *  is the ray through the rectangle's center and whose half-angle reaches its corners) whose
     *  angular disk comes within that half-angle of the axis (the directions meeting a geodesic
     *  ball of radius r at distance d form a round cone of half-angle asin(sinh r/sinh d)). */
    imagesFor(x0: number, y0: number, x1: number, y1: number): SwImage[] {
        const axis = this.ray((x0 + x1) / 2, (y0 + y1) / 2).v;
        let half = 0;
        for (const [fx, fy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) half = Math.max(half, angleBetween(this.ray(fx, fy).v, axis));
        const rMax = Math.max(...this.g.spheres.map((s) => s.radius));
        const cells = cellsMeeting({ x: this.cam, axis, half, reach: this.g.farClip + rMax + 0.05 }, this.gens);
        const out: SwImage[] = [];
        for (const gamma of cells) {
            this.g.spheres.forEach((s, sphere) => {
                const c = apply(gamma, hyperbolicGeometry.exp(s.center));
                const { u, d } = directionTo(this.cam, c);
                if (d - s.radius > this.g.farClip + 0.05) return;
                const sinA = Math.min(1, Math.sinh(s.radius) / Math.sinh(d));
                if (angleBetween(u, axis) > Math.asin(sinA) + half + 1e-9) return;
                out.push({ sphere, gammaO: apply(gamma, O), c, u, sinA, coshR: Math.cosh(s.radius) });
            });
        }
        return out;
    }

    /** What the film point (fx, fy) sees within arc length tMax, among `images`: the first hit.
     *  Along γ(t) = cosh t·p + sinh t·v, cosh d(γ(t), c) = A·cosh t + B·sinh t (A = −⟨p,c⟩,
     *  B = −⟨v,c⟩); setting it to cosh r with E = e^t gives (A+B)E² − 2cosh r·E + (A−B) = 0, whose
     *  smaller root is the entry (the camera is outside every image). */
    classify(fx: number, fy: number, tMax: number, images: SwImage[]): SwFilmClass {
        const { p, v } = this.ray(fx, fy);
        let best: SwFilmClass = { kind: 'miss' };
        let bestT = tMax;
        for (const im of images) {
            const A = -form(p, im.c), B = -form(v, im.c), C = im.coshR;
            const disc = C * C - A * A + B * B;
            if (disc < 0) continue;
            const t = Math.log((C - Math.sqrt(disc)) / (A + B));
            if (t > 0 && t <= bestT) { bestT = t; best = { kind: 'hit', sphere: im.sphere, gammaO: im.gammaO, t }; }
        }
        return best;
    }

    /** What the film point (fx, fy) sees when the ray is walked through D with this twin's
     *  pairings (the renderer's scheme, in float64): in each cell, the nearest sphere of D
     *  before the exit face, else the crossing. With a wrong group this is what a renderer with
     *  that group would show (brute force over the cover assumes the cells tile H³, which a
     *  wrong twist breaks). */
    walkClassify(fx: number, fy: number): { kind: 'miss' } | { kind: 'hit'; sphere: number; t: number } {
        let { p, v } = this.ray(fx, fy);
        let acc = 0;
        const centers = this.g.spheres.map((s) => hyperbolicGeometry.exp(s.center) as V4);
        for (let n = 0; n < 200; n++) {
            let tau = 1, face = -1;
            NORMALS.forEach((nn, i) => {
                const b = form(nn, v);
                if (b > 0) { const ti = Math.max(-form(nn, p) / b, 0); if (ti < tau) { tau = ti; face = i; } }
            });
            const tExit = Math.min(Math.atanh(tau), this.g.farClip - acc);
            let best = -1, bestT = tExit;
            centers.forEach((c, i) => {
                const A = -form(p, c), B = -form(v, c), C = Math.cosh(this.g.spheres[i].radius);
                const disc = C * C - A * A + B * B;
                if (disc < 0) return;
                const t = Math.log((C - Math.sqrt(disc)) / (A + B));
                if (t > 0 && t <= bestT) { bestT = t; best = i; }
            });
            if (best >= 0) return { kind: 'hit', sphere: best, t: acc + bestT };
            acc += Math.atanh(tau);
            if (acc >= this.g.farClip) return { kind: 'miss' };
            const q = p.map((x, k) => x + tau * v[k]) as V4;
            const w = v.map((x, k) => x + tau * p[k]) as V4;
            const pn = q.map((x) => x / Math.sqrt(-form(q, q))) as V4;
            const wt = w.map((x, k) => x + form(w, pn) * pn[k]) as V4;
            const vn = wt.map((x) => x / Math.sqrt(form(wt, wt))) as V4;
            p = apply(this.gens[face], pn);
            v = apply(this.gens[face], vn);
        }
        return { kind: 'miss' };
    }

    /** The faces a camera ray crosses before arc length t, by a float64 cell walk (exit face,
     *  pairing, renormalization), and the cell γD it is then in, as γ·o with γ = g_{f₁}⁻¹·g_{f₂}⁻¹·…
     *  over the faces crossed. */
    walk(fx: number, fy: number, t: number): { crossings: number; gammaO: V4; faces: number[] } {
        let { p, v } = this.ray(fx, fy);
        let acc = 0, crossings = 0;
        const faces: number[] = [];
        let gamma: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        for (;;) {
            let tau = 1, face = -1;
            NORMALS.forEach((n, i) => {
                const b = form(n, v);
                if (b > 0) { const ti = Math.max(-form(n, p) / b, 0); if (ti < tau) { tau = ti; face = i; } }
            });
            const tExit = Math.atanh(tau);
            if (acc + tExit >= t) return { crossings, gammaO: apply(gamma, O), faces };
            acc += tExit;
            const q = p.map((x, k) => x + tau * v[k]) as V4;
            const w = v.map((x, k) => x + tau * p[k]) as V4;
            const pn = q.map((x) => x / Math.sqrt(-form(q, q))) as V4;
            const wt = w.map((x, k) => x + form(w, pn) * pn[k]) as V4;
            const vn = wt.map((x) => x / Math.sqrt(form(wt, wt))) as V4;
            p = apply(this.gens[face], pn);
            v = apply(this.gens[face], vn);
            gamma = multiply(gamma, this.gens[face ^ 1]);
            faces.push(face);
            crossings++;
        }
    }
}

/** A window of pixels [x0, x0 + nx) × [y0, y0 + ny) (origin bottom-left). */
export interface PixelWindow { x0: number; y0: number; nx: number; ny: number }

/** A certified window: every film point sees one sphere image (the same sphere and cell) through
 *  `crossings` face crossings, or nothing within the far clip. */
export type SwCertified = { kind: 'miss' } | { kind: 'hit'; sphere: number; crossings: number; distance: number };

/**
 * Certify a window: every film point of a (grid + 1)² lattice over each pixel of the window grown
 * by `margin` pixels sees the same thing — one sphere image (the same sphere, the same cell, the
 * same crossing count) at an arc length at most R − slack, or nothing within R + slack. Returns
 * that class, or null when the window is not certified. The slack keeps the far clip's own
 * rounding from deciding a pixel.
 */
export function certifyWindow(twin: SwWindowsTwin, w: PixelWindow, margin = 1, grid = 8, slack = 0.01): SwCertified | null {
    const R = twin.g.farClip;
    const images = twin.imagesFor(w.x0 - margin, w.y0 - margin, w.x0 + w.nx + margin, w.y0 + w.ny + margin);
    let first: SwFilmClass | null = null;
    let crossings = -1, far = 0;
    for (let py = w.y0 - margin; py < w.y0 + w.ny + margin; py++) {
        for (let px = w.x0 - margin; px < w.x0 + w.nx + margin; px++) {
            for (let j = 0; j <= grid; j++) {
                for (let i = 0; i <= grid; i++) {
                    const fx = px + i / grid, fy = py + j / grid;
                    const c = twin.classify(fx, fy, R + slack, images);
                    if (c.kind === 'hit' && c.t > R - slack) return null;
                    if (first === null) first = c;
                    if (c.kind !== first.kind) return null;
                    if (c.kind === 'hit' && first.kind === 'hit') {
                        if (c.sphere !== first.sphere || !sameCell(c.gammaO, first.gammaO)) return null;
                        const walked = twin.walk(fx, fy, c.t);
                        // The brute-force image and the walk's cell agree (a twin consistency
                        // check, not a property of the renderer).
                        if (!sameCell(walked.gammaO, c.gammaO)) throw new Error(`twin: walk and brute force disagree at (${fx}, ${fy})`);
                        if (crossings >= 0 && walked.crossings !== crossings) return null;
                        crossings = walked.crossings;
                        far = Math.max(far, c.t);
                    }
                }
            }
        }
    }
    if (first === null || first.kind === 'miss') return { kind: 'miss' };
    return { kind: 'hit', sphere: first.sphere, crossings, distance: far };
}
