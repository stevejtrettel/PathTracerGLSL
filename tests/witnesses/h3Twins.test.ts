// The H³ witnesses' expected values (scenes/h3Witness.ts) recomputed by their twin
// (scenes/h3Twins.ts), and the twin checked against what it rests on: the on-axis closed form of a
// disk light, an independent cosine-sampled Monte Carlo estimate of off-axis irradiance (ray–disk
// intersections only, no area density), and full coverage of the readout window by the receiver.

import { describe, it, expect } from 'vitest';
import {
    windowMean, diskEmitter, diskIrradiance, diskIrradianceOnAxis, pointIrradiance, exp, flow, planeRoot, dist, form, tangentPair, type V4,
} from './scenes/h3Twins.js';
import {
    H3_SIZE, H3_WINDOW, H3_FOV, H3_RECEIVER, H3_CAMERA, H3_DISK_LIGHT, H3_POINT_LIGHT, H3_DISK_WINDOW_MEAN, H3_POINT_WINDOW_MEAN, H3_FURNACE_VALUE,
} from './scenes/h3Witness.js';

const O: V4 = [0, 0, 0, 1];
const Y: V4 = [0, 1, 0, 0];
const light = diskEmitter(H3_DISK_LIGHT.position, H3_DISK_LIGHT.normal, H3_DISK_LIGHT.radius, H3_DISK_LIGHT.emission);

describe('H³ witness twins', () => {
    it('the furnace value is Σ_{k≤6} 0.8^k', () => {
        expect(H3_FURNACE_VALUE).toBeCloseTo(3.951424, 12);
    });

    it('the disk quadrature equals the on-axis closed form Le·π·sin²β, tan β = tanh ρ / sinh D', () => {
        expect(diskIrradiance(O, Y, light)).toBeCloseTo(diskIrradianceOnAxis(1, H3_DISK_LIGHT.radius, H3_DISK_LIGHT.emission), 10);
    });

    it('the disk quadrature agrees with cosine-sampled ray hits at an off-axis receiver point', () => {
        // x on the receiver plane, 0.35 from o; E = π·Le·P(a cosine-distributed ray hits the
        // emitting face). Deterministic seed; 2·10⁵ rays.
        const x = flow(O, [0.6, 0, 0.8, 0], 0.35);
        const [t1, t2] = tangentPair(x, Y);
        let s = 12345;
        const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
        const N = 200000;
        let hits = 0;
        for (let i = 0; i < N; i++) {
            const u1 = rnd(), u2 = rnd();
            const r = Math.sqrt(u1), phi = 2 * Math.PI * u2;
            const a = r * Math.cos(phi), b = r * Math.sin(phi), c = Math.sqrt(Math.max(0, 1 - u1));
            const v = [0, 1, 2, 3].map((k) => a * t1[k] + b * t2[k] + c * Y[k]) as V4;
            const t = planeRoot(x, v, light.m);   // the light's plane: ⟨y, m⟩ = 0 through its center
            if (t === null) continue;
            const y = flow(x, v, t);
            const arrival = [0, 1, 2, 3].map((k) => Math.sinh(t) * x[k] + Math.cosh(t) * v[k]) as V4;
            if (dist(y, light.c) <= light.rho && form(arrival, light.m) < 0) hits++;
        }
        const p = hits / N;
        const mc = Math.PI * light.Le * p;
        const se = Math.PI * light.Le * Math.sqrt(p * (1 - p) / N);
        const quad = diskIrradiance(x, Y, light);
        expect(Math.abs(mc - quad) / se).toBeLessThan(4);
    });

    it('the readout window lies inside the receiver, with margin', () => {
        const wide = { x: 0.35, y: 0.35, w: 0.3, h: 0.3 };
        expect(windowMean(H3_CAMERA, H3_FOV, H3_SIZE, wide, H3_RECEIVER, () => 1, 2).missed).toBe(0);
    });

    it('the disk-light window mean is the stated constant', () => {
        const m = windowMean(H3_CAMERA, H3_FOV, H3_SIZE, H3_WINDOW, H3_RECEIVER, (x, n) => diskIrradiance(x, n, light, 16, 32), 2);
        expect(Math.abs(m.mean - H3_DISK_WINDOW_MEAN)).toBeLessThan(2e-5);
    });

    it('the point-light window mean is the stated constant', () => {
        const q = exp(H3_POINT_LIGHT.position);
        const m = windowMean(H3_CAMERA, H3_FOV, H3_SIZE, H3_WINDOW, H3_RECEIVER, (x, n) => pointIrradiance(x, n, q, H3_POINT_LIGHT.emission), 2);
        expect(Math.abs(m.mean - H3_POINT_WINDOW_MEAN)).toBeLessThan(2e-5);
    });
});
