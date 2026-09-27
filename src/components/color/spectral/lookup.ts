import type { Vec3 } from '../../../compiler/types.js';
import { spectralData as data } from './data.js';

/** Trilinear lookup on the shipped RGBA float32 atlas; polynomial coordinate is (λ−360)/470. */
export function spectralCoefficients(rgb: Vec3, atlas: Float32Array): Vec3 {
    const channel = rgb[0] >= rgb[1] && rgb[0] >= rgb[2] ? 0 : rgb[1] >= rgb[2] ? 1 : 2;
    const z = rgb[channel];
    const x = rgb[(channel + 1) % 3] * (63 / z), y = rgb[(channel + 2) % 3] * (63 / z);
    const ix = Math.min(Math.floor(x), 62), iy = Math.min(Math.floor(y), 62);
    const fx = x - ix, fy = y - iy;
    let lo = 0, hi = 63;
    for (let step = 0; step < 6; ++step) {
        const mid = (lo + hi) >> 1;
        if (data.zNodes[mid] <= z) lo = mid;
        else hi = mid;
    }
    const fz = (z - data.zNodes[lo]) / (data.zNodes[lo + 1] - data.zNodes[lo]);
    const node = (x: number, y: number, z: number, c: number) => atlas[4 * (((channel * 64 + z) * 64 + y) * 64 + x) + c];
    const mix = (a: number, b: number, f: number) => a * (1 - f) + b * f;
    const plane = (z: number, c: number) => mix(
        mix(node(ix, iy, z, c), node(ix + 1, iy, z, c), fx),
        mix(node(ix, iy + 1, z, c), node(ix + 1, iy + 1, z, c), fx), fy);
    return [0, 1, 2].map(c => mix(plane(lo, c), plane(lo + 1, c), fz)) as Vec3;
}

export function evaluatePolynomial(c: Vec3, lambda: number): number {
    const t = (lambda - 360) / 470;
    const p = (c[0] * t + c[1]) * t + c[2];
    return 0.5 + 0.5 * p / Math.sqrt(1 + p * p);
}

/** CMF/D65 evaluation on the exact float32 samples supplied to the GPU. */
export function spectralCurves(lambda: number, curves: Float32Array): [number, number, number, number] {
    const x = (lambda - 360) / 5, i = Math.min(Math.floor(x), 93), f = x - i;
    return [0, 1, 2, 3].map(c => curves[4 * i + c] * (1 - f) + curves[4 * (i + 1) + c] * f) as [number, number, number, number];
}
