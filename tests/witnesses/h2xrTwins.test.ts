// The H²×R witnesses' expected values (scenes/h2xrWitness.ts) recomputed by their twin
// (scenes/h2xrTwins.ts, whose formulas tests/components/h2xr.test.ts checks against independent
// computations), the readout windows checked (covered by their object, unshadowed from the lights),
// and the values a wrong model would read, so a mutation's failure is predicted: isotropic densities
// (d², d·sinh d), the Euclidean disk-radius map with the curved pdf, the view direction in place of
// the sky key, and the ball's height shift dropped (the placement decode).

import { describe, it, expect } from 'vitest';
import {
    windowMean, diskEmitter, diskIrradiance, diskPoint, pointIrradiance, place, firstHit, regionMean, cameraRay, fisheyeRay, skyKey, exp, dist,
    directionTo, areaDensity, form, type Placed, type Hit, type V4, type DiskEmitter,
} from './scenes/h2xrTwins.js';
import {
    H2XR_SIZE, H2XR_FURNACE_VALUE, H2XR_RECEIVER, H2XR_DISK_CAMERA, H2XR_DISK_FOV, H2XR_DISK_WINDOW, H2XR_DISK_LIGHT, H2XR_DISK_WINDOW_MEAN,
    H2XR_POINT_CAMERA, H2XR_POINT_FOV, H2XR_POINT_LIGHTS, H2XR_BALL, H2XR_COLUMN, H2XR_WALL, H2XR_POINT_WINDOWS, H2XR_POINT_WINDOW_MEANS,
    H2XR_SKY_CAMERA, H2XR_SKY_PINHOLE_FOV, H2XR_SKY_FISHEYE_FOV, H2XR_SKY_BALL, H2XR_SKY_OBJECTS, H2XR_SKY_PINHOLE_MEAN, H2XR_SKY_FISHEYE_MEAN,
} from './scenes/h2xrWitness.js';
import { h2xrGeometry as G } from '../../src/components/ambient/h2xr/h2xr.js';

const iso = (a: V4, b: V4) => dist(a, b) ** 2;
const isoSinh = (a: V4, b: V4) => { const d = dist(a, b); return d * Math.sinh(d); };

// h2xr-disk-light
const light = diskEmitter(H2XR_DISK_LIGHT.position, -1, H2XR_DISK_LIGHT.radius, H2XR_DISK_LIGHT.emission);
const receiverObjs: Placed[] = [place('D', { kind: 'disk', radius: H2XR_RECEIVER.rho, normal: [0, 1, 0] })];
const diskWindow = (E: (x: V4, n: V4) => number, region = H2XR_DISK_WINDOW) =>
    windowMean(H2XR_DISK_CAMERA, H2XR_DISK_FOV, H2XR_SIZE, region, receiverObjs, 'D', H2XR_RECEIVER.albedo, (h) => E(h.x, h.n));

/** The irradiance the disk light's estimator converges to with the Euclidean uniform-area radius map
 *  r = ρ√u in place of sinh(r/2) = √u·sinh(ρ/2) but the curved pdf: ∫ f·q/p dA, where q/p is the
 *  ratio of the wrong sample density to the uniform-area one. Per unit area (dA = sinh r dr dφ),
 *  q = (2r/ρ²)/(2π·sinh r) and p = 1/(2π(cosh ρ − 1)), so q/p = 2r(cosh ρ − 1)/(ρ²·sinh r). */
function diskIrradianceWrongRadius(x: V4, n: V4, e: DiskEmitter): number {
    const ratio = (s: number) => 2 * s * (Math.cosh(e.rho) - 1) / (e.rho * e.rho * Math.sinh(s));
    const ns = 16, nphi = 32;
    let sum = 0;
    for (let i = 0; i < ns; i++) {
        const s = e.rho * (i + 0.5) / ns;
        for (let j = 0; j < nphi; j++) {
            const y = diskPoint(e, s, 2 * Math.PI * j / nphi);
            const cx = form(n, directionTo(x, y)), cy = form([0, e.facing, 0, 0], directionTo(y, x));
            if (cx <= 0 || cy <= 0) continue;
            sum += (e.rho / ns) * (2 * Math.PI / nphi) * Math.sinh(s) * ratio(s) * e.Le * cx * cy / areaDensity(x, y);
        }
    }
    return sum;
}

// h2xr-point-light
const pointObjs: Placed[] = [
    place('disk', { kind: 'disk', radius: H2XR_RECEIVER.rho, normal: [0, 1, 0] }),
    place('wall', { kind: 'plane', normal: H2XR_WALL.normal, offset: H2XR_WALL.offset }),
    place('ball', { kind: 'sphere', radius: H2XR_BALL.radius }, H2XR_BALL.center, H2XR_BALL.position, H2XR_BALL.angle),
    place('column', { kind: 'cylinder', radius: H2XR_COLUMN.radius, halfHeight: H2XR_COLUMN.halfHeight }, H2XR_COLUMN.center),
];
const lights = H2XR_POINT_LIGHTS.map((l) => ({ q: exp(l.position), I: l.emission }));
const pointE = (density?: (a: V4, b: V4) => number) => (h: Hit) => lights.reduce((s, l) => s + pointIrradiance(h.x, h.n, l.q, l.I, density), 0);
type WindowKey = keyof typeof H2XR_POINT_WINDOWS;
const tagOf = (k: WindowKey) => (k === 'cap' ? 'column' : k);
function pointWindow(k: WindowKey, density?: (a: V4, b: V4) => number) {
    const objs = pointObjs;
    return windowMean(H2XR_POINT_CAMERA, H2XR_POINT_FOV, H2XR_SIZE, H2XR_POINT_WINDOWS[k], objs, tagOf(k), 0.5, (h) => {
        // the cap window must see the cap (vertical normal), the column window the wall
        if (k === 'cap' && Math.abs(h.n[1]) < 0.5) return NaN;
        if (k === 'column' && Math.abs(h.n[1]) > 0.5) return NaN;
        return pointE(density)(h);
    }, lights.map((l) => l.q));
}

// h2xr-sky
function skyObjects(ballG?: { g: number[] }): Placed[] {
    const ball = place('ball', { kind: 'sphere', radius: H2XR_SKY_BALL.radius }, H2XR_SKY_BALL.center, H2XR_SKY_BALL.position, H2XR_SKY_BALL.angle);
    if (ballG !== undefined) { ball.g = ballG.g; ball.inv = G.inverse(ballG.g); }
    return [
        ball,
        place('cylinder', { kind: 'cylinder', radius: H2XR_SKY_OBJECTS.cylinder.radius, halfHeight: H2XR_SKY_OBJECTS.cylinder.halfHeight }, H2XR_SKY_OBJECTS.cylinder.center),
        place('wall', { kind: 'plane', normal: H2XR_SKY_OBJECTS.wall.normal, offset: H2XR_SKY_OBJECTS.wall.offset }),
        place('floor', { kind: 'plane', normal: H2XR_SKY_OBJECTS.floor.normal, offset: H2XR_SKY_OBJECTS.floor.offset }),
        place('disk', { kind: 'disk', radius: H2XR_SKY_OBJECTS.disk.radius, normal: H2XR_SKY_OBJECTS.disk.normal }, H2XR_SKY_OBJECTS.disk.center),
    ];
}
function skyMean(fisheye: boolean, objs: Placed[], key: (p: V4, v: V4) => [number, number, number] = skyKey, sub = 2): [number, number, number] {
    const ray = (fx: number, fy: number) => (fisheye ? fisheyeRay(H2XR_SKY_CAMERA, H2XR_SKY_FISHEYE_FOV, H2XR_SIZE, fx, fy) : cameraRay(H2XR_SKY_CAMERA, H2XR_SKY_PINHOLE_FOV, H2XR_SIZE, fx, fy));
    return regionMean(ray, H2XR_SIZE, undefined, (p, v) => {
        if (firstHit(objs, p, v) !== null) return [0, 0, 0];
        const k = key(p, v);
        return [1 + k[0], 1 + k[1], 1 + k[2]];
    }, sub);
}

describe('H²×R witness twins', () => {
    it('the furnace value is Σ_{k≤6} 0.8^k', () => {
        expect(H2XR_FURNACE_VALUE).toBeCloseTo(3.951424, 12);
    });

    it('the disk-light window is covered by the receiver, and its mean is the stated constant', () => {
        const wide = { x: 0.35, y: 0.35, w: 0.3, h: 0.3 };
        expect(diskWindow(() => 1, wide).missed).toBe(0);
        const m = diskWindow((x, n) => diskIrradiance(x, n, light, undefined, 16, 32));
        console.log('disk-light window mean', m.mean.toFixed(7));
        expect(Math.abs(m.mean - H2XR_DISK_WINDOW_MEAN)).toBeLessThan(2e-5);
    }, 60000);

    it('the disk-light window mean moves with an isotropic density or the Euclidean radius map', () => {
        // what wrong models read (each must be far outside the witness tolerance 0.002)
        const isoMean = diskWindow((x, n) => diskIrradiance(x, n, light, iso, 16, 32)).mean;
        const sinhMean = diskWindow((x, n) => diskIrradiance(x, n, light, (a, b) => Math.sinh(dist(a, b)) ** 2, 16, 32)).mean;
        const radiusMean = diskWindow((x, n) => diskIrradianceWrongRadius(x, n, light)).mean;
        console.log('disk-light: d² density', isoMean.toFixed(4), 'sinh² d', sinhMean.toFixed(4), 'Euclidean radius map', radiusMean.toFixed(4));
        for (const wrong of [isoMean, sinhMean, radiusMean]) expect(Math.abs(wrong - H2XR_DISK_WINDOW_MEAN)).toBeGreaterThan(0.006);
    }, 60000);

    it('every point-light window is covered by its surface and unshadowed, and its mean is the stated constant', () => {
        const results: Array<[WindowKey, ReturnType<typeof pointWindow>, number, number]> = [];
        for (const k of Object.keys(H2XR_POINT_WINDOWS) as WindowKey[]) {
            const m = pointWindow(k);
            const isoMean = pointWindow(k, iso).mean, sinhMean = pointWindow(k, isoSinh).mean;
            console.log(`point-light ${k}: ${m.mean.toFixed(7)} (missed ${m.missed}, shadowed ${m.shadowed}); d² ${isoMean.toFixed(4)}, d·sinh d ${sinhMean.toFixed(4)}`);
            results.push([k, m, isoMean, sinhMean]);
        }
        for (const [k, m, isoMean, sinhMean] of results) {
            expect(m.missed, k).toBe(0);
            expect(m.shadowed, k).toBe(0);
            expect(Number.isFinite(m.mean), k).toBe(true);
            expect(Math.abs(m.mean - H2XR_POINT_WINDOW_MEANS[k]), k).toBeLessThan(2e-5);
            expect(Math.abs(isoMean - m.mean), k).toBeGreaterThan(0.006);
            // the horizontal-only density d·sinh d is separated on every window but the wall (0.0015)
            if (k !== 'wall') expect(Math.abs(sinhMean - m.mean), k).toBeGreaterThan(0.006);
        }
    }, 120000);

    it('the sky frame means are the stated constants', () => {
        const objs = skyObjects();
        const pin = skyMean(false, objs), fish = skyMean(true, objs);
        for (let c = 0; c < 3; c++) {
            expect(Math.abs(pin[c] - H2XR_SKY_PINHOLE_MEAN[c])).toBeLessThan(2e-5);
            expect(Math.abs(fish[c] - H2XR_SKY_FISHEYE_MEAN[c])).toBeLessThan(2e-5);
        }
    }, 60000);

    it('the sky frame mean moves with the view direction as key, and with the ball\'s height shift dropped', () => {
        const viewDir = skyMean(false, skyObjects(), (_p, v) => [v[0], v[1], v[2]].map((x) => x / Math.hypot(v[0], v[1], v[2])) as [number, number, number]);
        // the ball without its height shift (isometry_point ignoring m[3][1]): its world center
        // lowered by the placement's shift
        const ball = place('ball', { kind: 'sphere', radius: H2XR_SKY_BALL.radius }, H2XR_SKY_BALL.center, H2XR_SKY_BALL.position, H2XR_SKY_BALL.angle);
        const c = G.apply(ball.g, [0, 0, 0, 1]) as V4;
        const objs = skyObjects();
        objs[0] = place('ball', { kind: 'sphere', radius: H2XR_SKY_BALL.radius }, G.log([c[0], c[1] - ball.g[13], c[2], c[3]]));
        const unshifted = skyMean(false, objs);
        console.log('sky with the view direction as key', viewDir.map((x) => x.toFixed(4)), '; ball without its height shift', unshifted.map((x) => x.toFixed(4)));
        expect(Math.max(...viewDir.map((x, k) => Math.abs(x - H2XR_SKY_PINHOLE_MEAN[k])))).toBeGreaterThan(0.006);
        expect(Math.max(...unshifted.map((x, k) => Math.abs(x - H2XR_SKY_PINHOLE_MEAN[k])))).toBeGreaterThan(0.006);
    }, 60000);
});

