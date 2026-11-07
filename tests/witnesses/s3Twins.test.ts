// The S³ witnesses' expected values (scenes/s3Witness.ts) recomputed by their twin
// (scenes/s3Twins.ts), and the twin and the fixtures checked against what they rest on: the on-axis
// closed form of a disk light seen through the long arc, an independent cosine-sampled Monte Carlo
// estimate (ray–disk intersections only, no area density, the receiver free to occlude), full
// coverage of the readout window, the blocker lying on every long arc from the window, and the
// medium witness's lights lying outside every camera ray's geodesic.

import { describe, it, expect } from 'vitest';
import {
    windowMean, diskEmitter, diskIrradiance, diskIrradianceOnAxis, pointIrradiance, exp, flow, planeRoots, dist, dot, tangentPair,
    cameraRay, receiverHit, directionTo, O, type DiskEmitter,
} from './scenes/s3Twins.js';
import { gaussLegendre, regionMean, type V4 } from './scenes/curvedTwins.js';
import {
    S3_SIZE, S3_WINDOW, S3_FOV, S3_RECEIVER, S3_CAMERA, S3_DISK_LIGHT, S3_POINT_LIGHTS, S3_DISK_WINDOW_MEAN, S3_POINT_WINDOW_MEAN,
    S3_FURNACE_VALUE, S3_BLOCKER, S3_MEDIUM_CAMERA, s3Medium,
} from './scenes/s3Witness.js';

const Y: V4 = [0, 1, 0, 0];
const light = diskEmitter(S3_DISK_LIGHT.position, S3_DISK_LIGHT.normal, S3_DISK_LIGHT.radius, S3_DISK_LIGHT.emission);
const lin = (a: V4, s: number, b: V4, t: number): V4 => [0, 1, 2, 3].map((i) => a[i] * s + b[i] * t) as V4;

/** The first t in (0, 2π) at which the geodesic (p, v) meets the disk, or Infinity. */
function hitDisk(p: V4, v: V4, e: { c: V4; m: V4; rho: number }, tmin = 1e-9): number {
    for (const t of planeRoots(p, v, e.m)) {
        if (t > tmin && t < 2 * Math.PI && dist(flow(p, v, t).pos, e.c) <= e.rho) return t;
    }
    return Infinity;
}

/** The arc length in [0, 2π) at which the geodesic (p, v), starting outside the ball of radius R
 *  about c, enters it, or Infinity: γ(t)·c = a·cos t + b·sin t = A·cos(t − φ) must reach cos R. */
function ballEntry(p: V4, v: V4, c: V4, R: number): number {
    const a = dot(p, c), b = dot(v, c), A = Math.hypot(a, b);
    if (A < Math.cos(R)) return Infinity;
    const t = Math.atan2(b, a) - Math.acos(Math.cos(R) / A);
    return ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/** Deterministic uniform numbers in [0, 1). */
function lcg(seed: number): () => number {
    let s = seed;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Disk irradiance with the Euclidean uniform-area radius map r = ρ√u in place of the curved one,
 *  but the curved pdf: each area element weighted by (that map's density)/(uniform density). */
function mutatedIrradiance(x: V4, e: DiskEmitter): number {
    const area = 4 * Math.PI * Math.sin(e.rho / 2) ** 2;
    const [e1, e2] = tangentPair(e.c, e.m);
    const [nodes, weights] = gaussLegendre(48);
    let sum = 0;
    for (let i = 0; i < 48; i++) {
        const s = 0.5 * e.rho * (nodes[i] + 1);
        const ws = 0.5 * e.rho * weights[i] * Math.sin(s) * (area * s / (Math.PI * e.rho * e.rho * Math.sin(s)));
        for (let j = 0; j < 96; j++) {
            const phi = (2 * Math.PI * j) / 96;
            const y = flow(e.c, lin(e1, Math.cos(phi), e2, Math.sin(phi)), s).pos;
            const back = directionTo(y, x), u = directionTo(x, y);
            for (const [cx, cy] of [[dot(Y, u), dot(e.m, back)], [-dot(Y, u), -dot(e.m, back)]]) {
                if (cx > 0 && cy > 0) sum += ws * (2 * Math.PI / 96) * e.Le * cx * cy / Math.sin(dist(x, y)) ** 2;
            }
        }
    }
    return sum;
}

describe('S³ witness twins', () => {
    it('the furnace value is Σ_{k≤6} 0.8^k', () => {
        expect(S3_FURNACE_VALUE).toBeCloseTo(3.951424, 12);
    });

    it('the disk quadrature equals the on-axis closed form Le·π·sin²β, tan β = tan ρ / sin D, through the long arc alone', () => {
        expect(diskIrradiance(O, Y, light)).toBeCloseTo(diskIrradianceOnAxis(1, S3_DISK_LIGHT.radius, S3_DISK_LIGHT.emission), 10);
        // facing the receiver instead, the light reaches its top through neither arc, and its bottom
        // through the short arc with the same value
        const facing = { ...light, m: lin(light.m, -1, light.m, 0) };
        expect(diskIrradiance(O, Y, facing)).toBe(0);
        expect(diskIrradiance(O, lin(Y, -1, Y, 0), facing)).toBeCloseTo(diskIrradiance(O, Y, light), 10);
    });

    it('the disk quadrature agrees with cosine-sampled ray hits at an off-axis receiver point, with the receiver free to occlude', () => {
        const x = flow(O, [0.6, 0, 0.8, 0], 0.35).pos;
        const [t1, t2] = tangentPair(x, Y);
        const rnd = lcg(12345);
        const N = 200000;
        const receiver = { c: O, m: Y, rho: S3_RECEIVER.rho };
        let hits = 0;
        for (let i = 0; i < N; i++) {
            const u1 = rnd(), u2 = rnd();
            const r = Math.sqrt(u1), phi = 2 * Math.PI * u2;
            const v = lin(lin(t1, r * Math.cos(phi), t2, r * Math.sin(phi)), 1, Y, Math.sqrt(Math.max(0, 1 - u1)));
            const t = hitDisk(x, v, light);
            if (t === Infinity || hitDisk(x, v, receiver, 1e-6) < t) continue;
            if (dot(flow(x, v, t).vel, light.m) < 0) hits++;   // arriving against the normal: the emitting face
        }
        const p = hits / N;
        const mc = Math.PI * light.Le * p;
        const se = Math.PI * light.Le * Math.sqrt(p * (1 - p) / N);
        expect(Math.abs(mc - diskIrradiance(x, Y, light)) / se).toBeLessThan(4);
    });

    it('the Euclidean radius map in place of the curved one would move E by about 3%', () => {
        const x = flow(O, [0.6, 0, 0.8, 0], 0.35).pos;
        expect(mutatedIrradiance(O, light) / diskIrradiance(O, Y, light) - 1).toBeCloseTo(-0.031, 3);
        expect(mutatedIrradiance(x, light) / diskIrradiance(x, Y, light) - 1).toBeCloseTo(-0.027, 3);
    });

    it('the readout window lies inside the receiver, with margin', () => {
        const wide = { x: 0.35, y: 0.35, w: 0.3, h: 0.3 };
        expect(windowMean(S3_CAMERA, S3_FOV, S3_SIZE, wide, S3_RECEIVER, () => 1, 2).missed).toBe(0);
    });

    it('the window means are the stated constants', () => {
        const disk = windowMean(S3_CAMERA, S3_FOV, S3_SIZE, S3_WINDOW, S3_RECEIVER, (x, n) => diskIrradiance(x, n, light, 16, 32), 2);
        expect(Math.abs(disk.mean - S3_DISK_WINDOW_MEAN)).toBeLessThan(2e-7);
        const lights = S3_POINT_LIGHTS.map((l) => ({ q: exp(l.position), I: l.emission }));
        const E = (x: V4, n: V4) => lights.reduce((s, l) => s + pointIrradiance(x, n, l.q, l.I), 0);
        expect(Math.abs(windowMean(S3_CAMERA, S3_FOV, S3_SIZE, S3_WINDOW, S3_RECEIVER, E, 2).mean - S3_POINT_WINDOW_MEAN)).toBeLessThan(2e-7);
    });

    it('the blocker lies on every long arc from the window to the light, beyond d, and hides no window pixel', () => {
        const c = exp(S3_BLOCKER.center);
        expect(dist(c, [0, 0, 0, -1])).toBeLessThan(1e-12);
        const [e1, e2] = tangentPair(light.c, light.m);
        const rnd = lcg(99);
        regionMean((fx, fy) => cameraRay(S3_CAMERA, S3_FOV, S3_SIZE, fx, fy), S3_SIZE, S3_WINDOW, (p, v) => {
            const x = receiverHit(p, v, S3_RECEIVER)!;
            expect(ballEntry(p, v, c, S3_BLOCKER.radius)).toBeGreaterThan(dist(p, x));   // the receiver is seen first
            for (let k = 0; k < 8; k++) {
                const s = S3_DISK_LIGHT.radius * Math.sqrt(rnd()), phi = 2 * Math.PI * rnd();
                const y = flow(light.c, lin(e1, Math.cos(phi), e2, Math.sin(phi)), s).pos;
                const d = dist(x, y);
                const w = lin(directionTo(x, y), -1, Y, 0);   // the long arc's direction
                // the long arc enters the blocker beyond d and before it reaches the light at 2π − d
                const t = ballEntry(x, w, c, S3_BLOCKER.radius);
                expect(t).toBeGreaterThan(d);
                expect(t).toBeLessThan(2 * Math.PI - d);
            }
            return [0, 0, 0];
        }, 1);
    });

    it('no camera ray of the medium witness meets a light on its whole period (the lights are out of frame)', () => {
        const lights = s3Medium.lights.map((l) => {
            const d = l as unknown as { position: [number, number, number]; normal: [number, number, number]; radius: number };
            return diskEmitter(d.position, d.normal, d.radius, 1);
        });
        let hits = 0;
        regionMean((fx, fy) => cameraRay(S3_MEDIUM_CAMERA, 1.0, [160, 120], fx, fy), [160, 120], undefined, (p, v) => {
            for (const e of lights) if (hitDisk(p, v, e) < Infinity) hits++;
            return [0, 0, 0];
        }, 2);
        expect(hits).toBe(0);
    });
});
