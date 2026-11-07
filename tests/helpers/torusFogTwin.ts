// tests/helpers/torusFogTwin.ts — float64 twin of the torus-fog witness
// (tests/witnesses/scenes/torusWitness.ts; docs/claude-2026-11-review/quotients-plan.md, Q1.6
// witness 4).
//
// The scene: the cube 3-torus E³/Z³ (D = [−½, ½]³) filled with an absorbing, emitting fog
// (absorption σ_a, emission coefficient ε = σ_a·Le, no scattering) and one black sphere in D. A
// camera ray that first meets an image of the sphere at arc length t ≤ R reads the fog's glow
// along the segment, ε·(1 − e^{−σ_a·t})/σ_a = Le·(1 − e^{−σ_a·t}); one that meets nothing within
// the far clip R reads Le·(1 − e^{−σ_a·R}). The sphere is black, so nothing comes back from it.
//
// This twin finds the first hit by BRUTE FORCE over the sphere's lattice images (not by a cell
// walk), so it is independent of the walk it checks. It reproduces the camera exactly as the GPU
// forms it: the box pixel filter places a sample uniformly over the pixel square, the film point
// (px + u, py + v) maps to ndc = 2·film/size − 1 (origin bottom-left), x scaled by the aspect,
// and the direction is forward + ndc.x·tan(fov/2)·right + ndc.y·tan(fov/2)·up
// (components/pixel/box, components/camera/pinhole, components/camera/basis.ts).

import type { Vec3 } from '../../src/compiler/types.js';
import { cameraBasis } from '../../src/components/camera/basis.js';

export interface TorusFogGeometry {
    /** The sphere's center (in D) and radius. */
    center: Vec3;
    radius: number;
    camera: Vec3;
    target: Vec3;
    /** Vertical field of view (radians) and the image size in pixels. */
    fov: number;
    size: [number, number];
    /** The far clip R. */
    farClip: number;
}

/** First hit of a ray from o along unit d with the lattice images (cube period 1) of the sphere,
 *  within arc length tMax: its distance and the image's cell k, or null. Brute force over every
 *  image whose center lies within tMax + radius of o. */
export function firstImageHit(g: TorusFogGeometry, o: Vec3, d: Vec3, tMax: number): { t: number; k: Vec3 } | null {
    const reach = tMax + g.radius;
    const lo = [0, 1, 2].map((a) => Math.floor(o[a] - g.center[a] - reach));
    const hi = [0, 1, 2].map((a) => Math.ceil(o[a] - g.center[a] + reach));
    let best: { t: number; k: Vec3 } | null = null;
    for (let a = lo[0]; a <= hi[0]; a++) {
        for (let b = lo[1]; b <= hi[1]; b++) {
            for (let c = lo[2]; c <= hi[2]; c++) {
                const oc: Vec3 = [o[0] - (g.center[0] + a), o[1] - (g.center[1] + b), o[2] - (g.center[2] + c)];
                const B = oc[0] * d[0] + oc[1] * d[1] + oc[2] * d[2];
                const C = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - g.radius * g.radius;
                const disc = B * B - C;
                if (disc < 0) continue;
                const t = -B - Math.sqrt(disc);   // the near root: the camera is outside every image
                if (t > 0 && t <= tMax && (best === null || t < best.t)) best = { t, k: [a, b, c] };
            }
        }
    }
    return best;
}

/** The unit camera direction through film point (fx, fy) (pixel units, origin bottom-left). */
export function cameraDirection(g: TorusFogGeometry, fx: number, fy: number): Vec3 {
    const { forward, right, up } = cameraBasis(g.camera, g.target);
    const tanFov = Math.tan(g.fov / 2);
    const nx = (2 * fx / g.size[0] - 1) * (g.size[0] / g.size[1]);
    const ny = 2 * fy / g.size[1] - 1;
    const v: Vec3 = [0, 1, 2].map((a) => forward[a] + nx * tanFov * right[a] + ny * tanFov * up[a]) as Vec3;
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
}

/** What a film point sees: 'miss', or the hit's face-crossing count (Σ|k_i|, the camera being in
 *  D: a straight ray crosses each axis's faces monotonically) and its distance. */
export type FilmClass = { kind: 'miss' } | { kind: 'hit'; k: Vec3; crossings: number; t: number };

export function classify(g: TorusFogGeometry, fx: number, fy: number, tMax: number): FilmClass {
    const h = firstImageHit(g, g.camera, cameraDirection(g, fx, fy), tMax);
    if (h === null) return { kind: 'miss' };
    return { kind: 'hit', k: h.k, crossings: Math.abs(h.k[0]) + Math.abs(h.k[1]) + Math.abs(h.k[2]), t: h.t };
}

/** A window of pixels [x0, x0 + nx) × [y0, y0 + ny) (origin bottom-left). */
export interface PixelWindow { x0: number; y0: number; nx: number; ny: number }

/**
 * Certify a window: every film point of a (grid + 1)² lattice over each pixel of the window
 * grown by `margin` pixels sees the same thing — one sphere image (the same cell k) at a distance
 * at most R − slack, or nothing within R + slack. Returns that class, or null when the window is
 * not certified. The slack keeps the clip's own rounding from deciding a pixel.
 */
export function certifyWindow(g: TorusFogGeometry, w: PixelWindow, margin = 1, grid = 8, slack = 0.01): FilmClass | null {
    let first: FilmClass | null = null;
    for (let py = w.y0 - margin; py < w.y0 + w.ny + margin; py++) {
        for (let px = w.x0 - margin; px < w.x0 + w.nx + margin; px++) {
            for (let j = 0; j <= grid; j++) {
                for (let i = 0; i <= grid; i++) {
                    const c = classify(g, px + i / grid, py + j / grid, g.farClip + slack);
                    if (c.kind === 'hit' && c.t > g.farClip - slack) return null;
                    if (first === null) { first = c; continue; }
                    if (c.kind !== first.kind) return null;
                    if (c.kind === 'hit' && first.kind === 'hit' && (c.k[0] !== first.k[0] || c.k[1] !== first.k[1] || c.k[2] !== first.k[2])) return null;
                }
            }
        }
    }
    return first;
}

/** The fog's glow along a segment of length t: Le·(1 − e^{−σ_a·t}). */
export const fogGlow = (sigmaA: number, le: number, t: number): number => le * (1 - Math.exp(-sigmaA * t));

/** The expected mean of a window: each pixel's expectation is the average of the glow over its
 *  footprint (the box filter), taken here by an n×n midpoint rule; the window mean is the
 *  average over its pixels, as the witness runner averages them. */
export function windowMean(g: TorusFogGeometry, w: PixelWindow, sigmaA: number, le: number, n = 16): number {
    let sum = 0;
    for (let py = w.y0; py < w.y0 + w.ny; py++) {
        for (let px = w.x0; px < w.x0 + w.nx; px++) {
            let pix = 0;
            for (let j = 0; j < n; j++) {
                for (let i = 0; i < n; i++) {
                    const h = firstImageHit(g, g.camera, cameraDirection(g, px + (i + 0.5) / n, py + (j + 0.5) / n), g.farClip);
                    pix += fogGlow(sigmaA, le, h === null ? g.farClip : h.t);
                }
            }
            sum += pix / (n * n);
        }
    }
    return sum / (w.nx * w.ny);
}
