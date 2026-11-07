// The H³ witnesses' expected values (scenes/h3Witness.ts) recomputed by their twin
// (scenes/h3Twins.ts), and the twin checked against what it rests on: the on-axis closed form of a
// disk light, an independent cosine-sampled Monte Carlo estimate of off-axis irradiance (ray–disk
// intersections only, no area density), full coverage of the readout windows, the limit that
// defines the sky key, and a marched ball test against the closed-form one.

import { describe, it, expect } from 'vitest';
import {
    windowMean, diskEmitter, diskIrradiance, diskIrradianceOnAxis, pointIrradiance, exp, flow, planeRoot, dist, form, tangentPair,
    regionMean, cameraRay, fisheyeRay, skyKey, hitsBall, type V4,
} from './scenes/h3Twins.js';
import {
    H3_SIZE, H3_WINDOW, H3_FOV, H3_RECEIVER, H3_CAMERA, H3_DISK_LIGHT, H3_POINT_LIGHTS, H3_DISK_WINDOW_MEAN, H3_POINT_WINDOW_MEAN, H3_FURNACE_VALUE,
    H3_SKY_CAMERA, H3_SKY_HIDDEN_BALL, H3_SKY_PINHOLE_FOV, H3_SKY_FISHEYE_FOV, H3_SKY_PINHOLE_MEAN, H3_SKY_FISHEYE_MEAN,
    H3_BALL, H3_BALL_CAMERA, H3_BALL_FOV, H3_BALL_WINDOW, H3_BALL_FRAME_MEAN,
} from './scenes/h3Witness.js';
import { hyperbolicGeometry } from '../../src/components/ambient/hyperbolic/hyperbolic.js';
import { placementIsometry, mat4Apply, ORIGIN } from '../../src/components/ambient/isometry.js';
import { quatFromAxisAngle } from '../../src/components/geometry/similarity.js';

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
        const lights = H3_POINT_LIGHTS.map((l) => ({ q: exp(l.position), I: l.emission }));
        const E = (x: V4, n: V4) => lights.reduce((s, l) => s + pointIrradiance(x, n, l.q, l.I), 0);
        const m = windowMean(H3_CAMERA, H3_FOV, H3_SIZE, H3_WINDOW, H3_RECEIVER, E, 2);
        expect(Math.abs(m.mean - H3_POINT_WINDOW_MEAN)).toBeLessThan(2e-5);
    });

    it('the sky key is the limit of the ray point\'s direction from o', () => {
        const p = exp(H3_SKY_CAMERA.position);
        const { v } = fisheyeRay(H3_SKY_CAMERA, H3_SKY_FISHEYE_FOV, H3_SIZE, 17.3, 101.6);
        const far = flow(p, v, 25);
        const l = Math.hypot(far[0], far[1], far[2]);
        skyKey(p, v).forEach((k, i) => expect(k).toBeCloseTo(far[i] / l, 12));
    });

    it('the fisheye ray is a unit tangent at the camera point, along forward at the image center', () => {
        const p = exp(H3_SKY_CAMERA.position);
        const { v } = fisheyeRay(H3_SKY_CAMERA, H3_SKY_FISHEYE_FOV, H3_SIZE, 3.5, 7.25);
        expect(form(v, v)).toBeCloseTo(1, 12);
        expect(form(v, p)).toBeCloseTo(0, 12);
        const center = fisheyeRay(H3_SKY_CAMERA, H3_SKY_FISHEYE_FOV, H3_SIZE, H3_SIZE[0] / 2 + 1e-9, H3_SIZE[1] / 2).v;
        const pin = cameraRay(H3_SKY_CAMERA, H3_SKY_PINHOLE_FOV, H3_SIZE, H3_SIZE[0] / 2, H3_SIZE[1] / 2).v;
        center.forEach((x, i) => expect(x).toBeCloseTo(pin[i], 8));
    });

    it('no sample point of either sky camera meets the hidden ball', () => {
        const c = exp(H3_SKY_HIDDEN_BALL.center);
        let hits = 0;
        const count = (p: V4, v: V4): [number, number, number] => { if (hitsBall(p, v, c, H3_SKY_HIDDEN_BALL.radius)) hits++; return [0, 0, 0]; };
        regionMean((x, y) => cameraRay(H3_SKY_CAMERA, H3_SKY_PINHOLE_FOV, H3_SIZE, x, y), H3_SIZE, undefined, count, 4);
        regionMean((x, y) => fisheyeRay(H3_SKY_CAMERA, H3_SKY_FISHEYE_FOV, H3_SIZE, x, y), H3_SIZE, undefined, count, 4);
        expect(hits).toBe(0);
    });

    it('the sky frame means are the stated constants', () => {
        const sky = (p: V4, v: V4): [number, number, number] => { const k = skyKey(p, v); return [1 + k[0], 1 + k[1], 1 + k[2]]; };
        const pin = regionMean((x, y) => cameraRay(H3_SKY_CAMERA, H3_SKY_PINHOLE_FOV, H3_SIZE, x, y), H3_SIZE, undefined, sky, 2);
        const fish = regionMean((x, y) => fisheyeRay(H3_SKY_CAMERA, H3_SKY_FISHEYE_FOV, H3_SIZE, x, y), H3_SIZE, undefined, sky, 2);
        pin.forEach((m, i) => expect(Math.abs(m - H3_SKY_PINHOLE_MEAN[i])).toBeLessThan(2e-6));
        fish.forEach((m, i) => expect(Math.abs(m - H3_SKY_FISHEYE_MEAN[i])).toBeLessThan(2e-6));
    });

    const ballCenter = mat4Apply(placementIsometry(
        hyperbolicGeometry, H3_BALL.position, quatFromAxisAngle([0, 0, 1], H3_BALL.angle), H3_BALL.center,
    ), ORIGIN) as V4;
    const ballRay = (x: number, y: number) => cameraRay(H3_BALL_CAMERA, H3_BALL_FOV, H3_SIZE, x, y);

    it('the closed-form ball test agrees with marching the ray', () => {
        for (let y = 0.5; y < H3_SIZE[1]; y += 7) {
            for (let x = 0.5; x < H3_SIZE[0]; x += 5) {
                const { p, v } = ballRay(x, y);
                let marched = false;
                for (let t = 0; t < 6 && !marched; t += 1e-3) marched = dist(flow(p, v, t), ballCenter) <= H3_BALL.radius;
                const closest = Math.abs(Math.acosh(Math.max(1, Math.sqrt(form(p, ballCenter) ** 2 - form(v, ballCenter) ** 2))) - H3_BALL.radius);
                if (closest > 1e-3) expect(hitsBall(p, v, ballCenter, H3_BALL.radius)).toBe(marched);
            }
        }
    });

    it('the ball window lies inside the ball\'s image, with margin, and the frame mean is the stated constant', () => {
        const radiance = (p: V4, v: V4): [number, number, number] => {
            const L = hitsBall(p, v, ballCenter, H3_BALL.radius) ? H3_BALL.albedo : 1;
            return [L, L, L];
        };
        const w = H3_BALL_WINDOW;
        const wide = { x: w.x - 0.01, y: w.y - 0.01, w: w.w + 0.02, h: w.h + 0.02 };
        expect(regionMean(ballRay, H3_SIZE, wide, radiance, 4)[0]).toBe(H3_BALL.albedo);
        expect(Math.abs(regionMean(ballRay, H3_SIZE, undefined, radiance, 4)[0] - H3_BALL_FRAME_MEAN)).toBeLessThan(2e-5);
    });
});
