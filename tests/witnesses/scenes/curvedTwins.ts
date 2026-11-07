// tests/witnesses/scenes/curvedTwins.ts
// The parts of the curved-space witness twins (h3Twins.ts, s3Twins.ts) that do not depend on the
// space: the camera rays of the pinhole and fisheye occupants (pinhole.glsl, fisheye.glsl) with the
// frame the compiler ships (curvedCameraBasis), the runner's readout-region mean, and Gauss–Legendre
// quadrature.

import type { WitnessRegion } from '../types.js';
import type { Vec3Tuple } from '../../../src/components/geometry/similarity.js';
import type { CurvedGeometry } from '../../../src/components/ambient/isometry.js';
import { curvedCameraBasis } from '../../../src/components/camera/basis.js';

export type V4 = [number, number, number, number];

const unit = (geom: CurvedGeometry, v: V4): V4 => {
    const k = 1 / Math.sqrt(geom.form(v, v));
    return [v[0] * k, v[1] * k, v[2] * k, v[3] * k];
};

/** The pinhole camera ray through film point (fx, fy) (pixel units, origin bottom-left), in the
 *  curved space `geom`, with the frame the compiler ships (curvedCameraBasis). */
export function curvedCameraRay(geom: CurvedGeometry, pose: { position: Vec3Tuple; target: Vec3Tuple }, fov: number, size: [number, number], fx: number, fy: number): { p: V4; v: V4 } {
    const b = curvedCameraBasis(geom, pose.position, pose.target);
    const [W, H] = size;
    const a = ((2 * fx) / W - 1) * (W / H) * Math.tan(fov / 2);
    const c = ((2 * fy) / H - 1) * Math.tan(fov / 2);
    const d: V4 = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) d[i] = b.forward[i] + a * b.right[i] + c * b.up[i];
    return { p: b.position as V4, v: unit(geom, d) };
}

/** The equidistant fisheye ray through film point (fx, fy) (fisheye.glsl: θ = ρ·fov/2 about the
 *  view axis, ρ the aspect-corrected film radius; corners reach past the inscribed circle). */
export function curvedFisheyeRay(geom: CurvedGeometry, pose: { position: Vec3Tuple; target: Vec3Tuple }, fov: number, size: [number, number], fx: number, fy: number): { p: V4; v: V4 } {
    const b = curvedCameraBasis(geom, pose.position, pose.target);
    const [W, H] = size;
    const cx = ((2 * fx) / W - 1) * (W / H), cy = (2 * fy) / H - 1;
    const rho = Math.hypot(cx, cy);
    const theta = rho * fov / 2;
    const d: V4 = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) d[i] = Math.cos(theta) * b.forward[i] + Math.sin(theta) * ((cx / rho) * b.right[i] + (cy / rho) * b.up[i]);
    return { p: b.position as V4, v: unit(geom, d) };
}

/** The mean over the runner's readout region (default: the whole frame) of the per-ray RGB radiance
 *  `radiance(p, v)`, each pixel integrated over its footprint (box filter) with sub×sub stratified
 *  points. */
export function regionMean(
    ray: (fx: number, fy: number) => { p: V4; v: V4 }, size: [number, number], region: WitnessRegion | undefined,
    radiance: (p: V4, v: V4) => [number, number, number], sub = 2,
): [number, number, number] {
    const [W, H] = size;
    const r = region ?? { x: 0, y: 0, w: 1, h: 1 };
    const x0 = Math.max(0, Math.floor(r.x * W)), y0 = Math.max(0, Math.floor(r.y * H));
    const x1 = Math.min(W, Math.ceil((r.x + r.w) * W)), y1 = Math.min(H, Math.ceil((r.y + r.h) * H));
    const sum: [number, number, number] = [0, 0, 0];
    let n = 0;
    for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
            for (let sy = 0; sy < sub; sy++) {
                for (let sx = 0; sx < sub; sx++) {
                    const { p, v } = ray(px + (sx + 0.5) / sub, py + (sy + 0.5) / sub);
                    const L = radiance(p, v);
                    sum[0] += L[0]; sum[1] += L[1]; sum[2] += L[2];
                    n++;
                }
            }
        }
    }
    return [sum[0] / n, sum[1] / n, sum[2] / n];
}

/** Gauss–Legendre nodes and weights on [−1, 1] (Newton on the Legendre recurrence). */
export function gaussLegendre(n: number): [number[], number[]] {
    const x: number[] = [], w: number[] = [];
    for (let i = 0; i < n; i++) {
        let z = Math.cos(Math.PI * (i + 0.75) / (n + 0.5));
        let dp = 0;
        for (let it = 0; it < 100; it++) {
            let p0 = 1, p1 = z;
            for (let k = 2; k <= n; k++) { const p2 = ((2 * k - 1) * z * p1 - (k - 1) * p0) / k; p0 = p1; p1 = p2; }
            dp = n * (z * p1 - p0) / (z * z - 1);
            const dz = p1 / dp;
            z -= dz;
            if (Math.abs(dz) < 1e-15) break;
        }
        x.push(z);
        w.push(2 / ((1 - z * z) * dp * dp));
    }
    return [x, w];
}
