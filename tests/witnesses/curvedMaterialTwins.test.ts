// The curved-material and sphere-light witnesses' expected values (scenes/curvedMaterialWitness.ts)
// recomputed by their twins (scenes/curvedMaterialTwins.ts), and the twins checked against what they
// rest on: the box is closed, a white box makes the mirror read its Schlick F and the glass ball
// conserve energy, the ball roots against marching, the GGX quadrature against cosine-sampled ray
// hits on the light, the cap quadrature against its closed form and against cosine-sampled hit-or-miss
// tests on the ball, and the readout windows covered by what they claim to read.

import { describe, it, expect } from 'vitest';
import {
    E3, H3, S3, specularFirstHit, specularRadiance, ggxEval, diskRadiance, sphereIrradiance, sphereSin2Max, receiverWindowMean, schlick,
    type Space, type SpecularScene,
} from './scenes/curvedMaterialTwins.js';
import { regionMean, type V4 } from './scenes/curvedTwins.js';
import {
    CM_SIZE, SPECULAR, SPECULAR_CAMERA, SPECULAR_FOV, SPECULAR_MIRROR_WINDOW, SPECULAR_GLASS_WINDOW, SPECULAR_MEANS,
    RECEIVER_RHO, RECEIVER_CAMERA, RECEIVER_FOV, RECEIVER_WINDOW, RECEIVER_ALBEDO, GGX, GGX_LIGHT, GGX_MEANS,
    SPHERE_LIGHTS, SPHERE_BLOCKER, SPHERE_MEANS,
} from './scenes/curvedMaterialWitness.js';

const lin = (a: V4, s: number, b: V4, t: number): V4 => [a[0] * s + b[0] * t, a[1] * s + b[1] * t, a[2] * s + b[2] * t, a[3] * s + b[3] * t];
const O: V4 = [0, 0, 0, 1];
const Y: V4 = [0, 1, 0, 0];
const spaces: Array<[string, Space]> = [['hyperbolic', H3], ['spherical', S3]];

/** Deterministic uniform numbers. */
function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** A cosine-distributed unit tangent at x about the unit normal n. */
function cosineDirection(sp: Space, x: V4, n: V4, u1: number, u2: number): V4 {
    const [t1, t2] = sp.tangentPair(x, n);
    const r = Math.sqrt(u1), phi = 2 * Math.PI * u2;
    const a = r * Math.cos(phi), b = r * Math.sin(phi), c = Math.sqrt(Math.max(0, 1 - u1));
    return [0, 1, 2, 3].map((k) => a * t1[k] + b * t2[k] + c * n[k]) as V4;
}

const specularRay = (sp: Space) => (x: number, y: number) => sp.cameraRay(SPECULAR_CAMERA, SPECULAR_FOV, CM_SIZE, x, y);

describe.each(spaces)('curved material twins in %s space', (name, sp) => {
    const space = name as 'hyperbolic' | 'spherical';

    // ---- specular ----

    it('the specular box is closed: every camera ray meets a wall or a ball', () => {
        let misses = 0;
        regionMean(specularRay(sp), CM_SIZE, undefined, (p, v) => { if (specularFirstHit(sp, SPECULAR, p, v) === null) misses++; return [0, 0, 0]; }, 2);
        expect(misses).toBe(0);
    });

    it('the ball windows lie inside the images of their balls, with margin', () => {
        for (const [region, ball] of [[SPECULAR_MIRROR_WINDOW, 0], [SPECULAR_GLASS_WINDOW, 1]] as const) {
            const wide = { x: region.x - 0.01, y: region.y - 0.01, w: region.w + 0.02, h: region.h + 0.02 };
            let bad = 0;
            regionMean(specularRay(sp), CM_SIZE, wide, (p, v) => {
                const h = specularFirstHit(sp, SPECULAR, p, v);
                if (h === null || h.kind !== 'ball' || h.index !== ball) bad++;
                return [0, 0, 0];
            }, 4);
            expect(bad).toBe(0);
        }
    });

    it('the ball roots agree with marching the geodesic', () => {
        const c = sp.exp(SPECULAR.glass.center), R = SPECULAR.glass.radius;
        const { p, v } = specularRay(sp)(CM_SIZE[0] * 0.71, CM_SIZE[1] * 0.5);
        const r = sp.ballRoots(p, v, c, R)!;
        let entry = -1, exit = -1;
        for (let t = 0; t < 3; t += 1e-5) {
            const inside = sp.dist(sp.flow(p, v, t).pos, c) < R;
            if (inside && entry < 0) entry = t;
            if (!inside && entry >= 0) { exit = t; break; }
        }
        expect(Math.abs(r.entry - entry)).toBeLessThan(2e-5);
        expect(Math.abs(r.exit - exit)).toBeLessThan(2e-5);
    });

    it('in a white box the mirror reads its Schlick F and the glass ball loses only truncated paths', () => {
        const white: SpecularScene = { ...SPECULAR, walls: SPECULAR.walls.map((w) => ({ ...w, emission: [1, 1, 1] })) };
        const { p, v } = specularRay(sp)(CM_SIZE[0] * 0.29, CM_SIZE[1] * 0.55);
        const h = specularFirstHit(sp, white, p, v)!;
        expect(h.kind === 'ball' && h.index === 0).toBe(true);
        const { pos: y, vel } = sp.flow(p, v, h.t);
        const n = lin(sp.directionTo(y, sp.exp(SPECULAR.mirror.center)), -1, y, 0);
        const cos = sp.form(lin(vel, -1, vel, 0), n);
        const L = specularRadiance(sp, white, p, v);
        [0, 1, 2].forEach((c) => expect(L[c]).toBeCloseTo(schlick(SPECULAR.mirror.f0[c], cos), 12));
        const g = specularRadiance(sp, white, ...Object.values(specularRay(sp)(CM_SIZE[0] * 0.71, CM_SIZE[1] * 0.5)) as [V4, V4]);
        expect(g[0]).toBeLessThanOrEqual(1);
        expect(g[0]).toBeGreaterThan(0.999);
    });

    it('the specular window means are the stated constants (and 4×4 points per pixel suffice)', () => {
        const m = SPECULAR_MEANS[space];
        const read = (region: typeof SPECULAR_MIRROR_WINDOW, sub: number) =>
            regionMean(specularRay(sp), CM_SIZE, region, (p, v) => specularRadiance(sp, SPECULAR, p, v), sub);
        for (const [k, region] of [['mirror', SPECULAR_MIRROR_WINDOW], ['glass', SPECULAR_GLASS_WINDOW]] as const) {
            const got = read(region, 4), fine = read(region, 8);
            got.forEach((g, c) => expect(Math.abs(g - m[k][c])).toBeLessThan(1e-6));
            fine.forEach((f, c) => expect(Math.abs(f - got[c])).toBeLessThan(2e-4));
        }
    });

    // ---- ggx ----

    const light = GGX_LIGHT[space];
    const e = sp.diskEmitter(light.position, light.normal, light.radius, light.emission);

    it('the GGX quadrature agrees with cosine-sampled ray hits on the light', () => {
        // x 0.3 from o on the receiver, wo toward the camera; L = π·E[Le·f(w, wo)·hit] over cosine-
        // distributed w. A ray scores where it first crosses the light's plane (great sphere) inside the
        // disk on the emitting side; the back face is opaque and black.
        const x = sp.flow(O, [0.6, 0, 0.8, 0], 0.3).pos;
        const wo = sp.directionTo(x, sp.exp(RECEIVER_CAMERA.position));
        const f = (wi: V4) => ggxEval(sp, Y, wi, wo, GGX.roughness, GGX.f0);
        const rnd = rng(777);
        const N = 200000;
        let sum = 0, sum2 = 0;
        for (let i = 0; i < N; i++) {
            const w = cosineDirection(sp, x, Y, rnd(), rnd());
            let score = 0;
            const t = sp.planeRoot(x, w, e.m);
            for (const tc of t === null ? [] : sp.twoArcs ? [t, t + Math.PI] : [t]) {   // S³: two crossings, π apart
                const hit = sp.flow(x, w, tc);
                if (sp.dist(hit.pos, e.c) <= e.rho) { if (sp.form(hit.vel, e.m) < 0) score = Math.PI * e.Le * f(w); break; }
            }
            sum += score; sum2 += score * score;
        }
        const mc = sum / N, se = Math.sqrt((sum2 / N - mc * mc) / N);
        const quad = diskRadiance(sp, x, Y, e, f, 32, 64);
        expect(quad).toBeGreaterThan(0.05);
        expect(Math.abs(mc - quad) / se).toBeLessThan(4);
    });

    it('the GGX window mean is the stated constant', () => {
        const m = receiverWindowMean(sp, RECEIVER_CAMERA, RECEIVER_FOV, CM_SIZE, RECEIVER_WINDOW, RECEIVER_RHO,
            (x, n, wo) => diskRadiance(sp, x, n, e, (wi) => ggxEval(sp, n, wi, wo, GGX.roughness, GGX.f0), 16, 32), 2);
        expect(m.missed).toBe(0);
        expect(Math.abs(m.mean - GGX_MEANS[space])).toBeLessThan(2e-6);
    });
});

describe('the E³ control (e3-specular)', () => {
    it('the box is closed, the windows lie inside their balls, and the window means are the stated constants', () => {
        const ray = specularRay(E3);
        let misses = 0;
        regionMean(ray, CM_SIZE, undefined, (p, v) => { if (specularFirstHit(E3, SPECULAR, p, v) === null) misses++; return [0, 0, 0]; }, 2);
        expect(misses).toBe(0);
        for (const [k, region, ball] of [['mirror', SPECULAR_MIRROR_WINDOW, 0], ['glass', SPECULAR_GLASS_WINDOW, 1]] as const) {
            let bad = 0;
            const got = regionMean(ray, CM_SIZE, region, (p, v) => {
                const h = specularFirstHit(E3, SPECULAR, p, v);
                if (h === null || h.kind !== 'ball' || h.index !== ball) bad++;
                return specularRadiance(E3, SPECULAR, p, v);
            }, 4);
            expect(bad).toBe(0);
            got.forEach((g, c) => expect(Math.abs(g - SPECULAR_MEANS.euclidean[k][c])).toBeLessThan(1e-6));
        }
    });
});

// ---- sphere lights ----

describe('sphere-light twins', () => {
    const cases = [
        { name: 'h3', sp: H3, light: SPHERE_LIGHTS.h3, value: () => SPHERE_MEANS.h3 },
        { name: 's3', sp: S3, light: SPHERE_LIGHTS.s3, value: () => SPHERE_MEANS.s3 },
        { name: 's3Antipodal', sp: S3, light: SPHERE_LIGHTS.s3Antipodal, value: () => RECEIVER_ALBEDO * SPHERE_LIGHTS.s3Antipodal.emission },
    ];

    it.each(cases)('$name: the cap quadrature agrees with cosine-sampled hit-or-miss tests on the ball', ({ sp, light }) => {
        const c = sp.exp(light.position);
        const x = sp.flow(O, [0.6, 0, 0.8, 0], 0.3).pos;
        const rnd = rng(4242);
        const N = 200000;
        let hits = 0;
        for (let i = 0; i < N; i++) {
            const w = cosineDirection(sp, x, Y, rnd(), rnd());
            const r = sp.ballRoots(x, w, c, light.radius);
            if (r !== null && (sp.twoArcs || r.entry > 0)) hits++;
        }
        const p = hits / N;
        const mc = Math.PI * light.emission * p, se = Math.PI * light.emission * Math.sqrt(p * (1 - p) / N);
        const quad = sphereIrradiance(sp, x, Y, c, light.radius, light.emission);
        // Where every direction meets the ball (the antipodal case) p = 1 and the estimate is exact.
        expect(Math.abs(mc - quad)).toBeLessThan(Math.max(4 * se, 1e-4 * quad));
    });

    it('the cap quadrature equals the projected cap Le·π·sin²α·|cos θ_c| for a cap above the horizon', () => {
        for (const { sp, light } of cases.slice(0, 2)) {
            const c = sp.exp(light.position);
            const x = sp.flow(O, [0.6, 0, 0.8, 0], 0.2).pos;
            const sin2 = sphereSin2Max(sp, light.radius, sp.dist(x, c));
            const closed = light.emission * Math.PI * sin2 * Math.abs(sp.form(Y, sp.directionTo(x, c)));
            expect(sphereIrradiance(sp, x, Y, c, light.radius, light.emission)).toBeCloseTo(closed, 9);
        }
    });

    it.each(cases)('$name: the window mean is the stated constant, and no camera ray meets the ball first', ({ sp, light, value }) => {
        const c = sp.exp(light.position);
        // The ball is met before the receiver when its entry root along the camera ray comes first.
        const blocker = (p: V4, v: V4, t: number) => { const r = sp.ballRoots(p, v, c, light.radius); return r !== null && r.entry > 0 && r.entry < t; };
        const m = receiverWindowMean(sp, RECEIVER_CAMERA, RECEIVER_FOV, CM_SIZE, RECEIVER_WINDOW, RECEIVER_RHO,
            (x, n) => (RECEIVER_ALBEDO / Math.PI) * sphereIrradiance(sp, x, n, c, light.radius, light.emission, 24, 48), 2, blocker);
        expect(m.missed).toBe(0);
        expect(Math.abs(m.mean - value())).toBeLessThan(2e-6);
    });

    it('the antipodal ball holds −x for every window point x (d ≥ π − R), and the S³ ball is seen only behind the horizon', () => {
        const ca = S3.exp(SPHERE_LIGHTS.s3Antipodal.position), cs = S3.exp(SPHERE_LIGHTS.s3.position);
        let bad = 0;
        receiverWindowMean(S3, RECEIVER_CAMERA, RECEIVER_FOV, CM_SIZE, { x: 0.36, y: 0.36, w: 0.28, h: 0.28 }, RECEIVER_RHO, (x) => {
            if (S3.dist(x, ca) < Math.PI - SPHERE_LIGHTS.s3Antipodal.radius) bad++;
            // the forward cone of the ball below lies entirely below the receiver's horizon
            const alpha = Math.asin(Math.sqrt(sphereSin2Max(S3, SPHERE_LIGHTS.s3.radius, S3.dist(x, cs))));
            if (Math.acos(-S3.form(Y, S3.directionTo(x, cs))) + alpha >= Math.PI / 2) bad++;
            return 0;
        }, 2);
        expect(bad).toBe(0);
    });

    it('every backward-cone geodesic from the window passes within the blocker before it reaches the light', () => {
        const c = S3.exp(SPHERE_LIGHTS.s3.position), b = S3.exp(SPHERE_BLOCKER.center);
        const rnd = rng(99);
        let bad = 0, n = 0;
        receiverWindowMean(S3, RECEIVER_CAMERA, RECEIVER_FOV, CM_SIZE, RECEIVER_WINDOW, RECEIVER_RHO, (x) => {
            for (let i = 0; i < 20; i++) {
                const w = cosineDirection(S3, x, Y, rnd(), rnd());
                const r = S3.ballRoots(x, w, c, SPHERE_LIGHTS.s3.radius);
                if (r === null) continue;
                n++;
                const rb = S3.ballRoots(x, w, b, SPHERE_BLOCKER.radius);
                if (rb === null || rb.entry > r.entry) bad++;
            }
            return 0;
        }, 1);
        expect(n).toBeGreaterThan(100);
        expect(bad).toBe(0);
    });
});
