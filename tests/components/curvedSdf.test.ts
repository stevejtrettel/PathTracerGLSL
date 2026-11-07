// The curved march and its fields in fp64 (tests/witnesses/scenes/curvedSdfTwins.ts): the generated
// march loop transcribed and run along geodesics of H³ and S³ against closed-form roots (the ball
// and plane bodies) and brute-force roots (a capped tube, the smooth-union sculpture, including
// origins inside its bound, which in S³ meet it again only after going around); the tangent-frame
// 4-tap normal against analytic normals; the 1-Lipschitz property of every helper; and the Klein
// chart's distance bound in H³.

import { describe, it, expect } from 'vitest';
import {
    H3, S3, O, type Space, type Field, march, ballInterval, ballRoot, planeRoot, bruteRoot, marchEpsilon, MARCH_CLEARANCE,
    sdfPoint, sdfBall, sdfPlane, sdfTube, smoothIntersection, fdNormal, gradient, sculptureField, cavityField,
    SCULPTURE, klein, apply,
} from '../witnesses/scenes/curvedSdfTwins.js';
import type { V4 } from '../witnesses/scenes/curvedTwins.js';
import { placementIsometry } from '../../src/components/ambient/isometry.js';
import { quatFromAxisAngle } from '../../src/components/geometry/similarity.js';

function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const unit3 = (r: () => number): [number, number, number] => {
    const z = 2 * r() - 1, phi = 2 * Math.PI * r(), s = Math.sqrt(1 - z * z);
    return [s * Math.cos(phi), s * Math.sin(phi), z];
};
const scale3 = (v: [number, number, number], s: number): [number, number, number] => [v[0] * s, v[1] * s, v[2] * s];
const unitT = (S: Space, v: V4): V4 => { const k = 1 / Math.sqrt(S.form(v, v)); return [v[0] * k, v[1] * k, v[2] * k, v[3] * k]; };
/** A random point within `radius` of o and a random unit tangent there. */
function randomRay(S: Space, r: () => number, radius: number): { p: V4; v: V4 } {
    const p = sdfPoint(S, scale3(unit3(r), radius * Math.cbrt(r())));
    const w = unit3(r);
    return { p, v: unitT(S, S.tangent(p, [w[0], w[1], w[2], 2 * r() - 1])) };
}
/** A random point within `radius` of o (object frame) and the unit direction from it toward a random
 *  point within `aim` of o, so the rays meet a small object often. */
function aimedRay(S: Space, r: () => number, radius: number, aim: number): { p: V4; v: V4 } {
    const p = sdfPoint(S, scale3(unit3(r), radius * Math.cbrt(r())));
    const q = sdfPoint(S, scale3(unit3(r), aim * Math.cbrt(r())));
    return { p, v: S.directionTo(p, q) };
}
const angle = (S: Space, a: V4, b: V4): number => Math.acos(Math.max(-1, Math.min(1, S.form(a, b))));

/** The object's placement for the off-origin tests: g = T(position)·R(rotation), world → object by G⁻¹. */
function placement(S: Space): number[] {
    const g = placementIsometry(S.geom, [0.25, -0.15, 0.1], quatFromAxisAngle([0.3, 1, -0.2], 0.7), [0, 0, 0]);
    return S.geom.inverse(g);
}

interface Tally { hits: number; agreed: number; graze: number }

/** Marches `f` (object frame, bounded by a ball of radius `bound`, or unbounded) along the ray and
 *  compares with `reference` (the true first crossing). A miss where the reference hits is allowed
 *  only when the ray dips into the shape by less than the stall band (its most negative f/(16·ε) is
 *  above −1); a hit where the reference misses must sit within the stall band (a graze commit). A
 *  marched hit never lies past the reference root, and the field there is within the stall band. */
function compare(S: Space, f: Field, p: V4, v: V4, bound: number | null, reference: number | null, tally: Tally, depth: () => number): void {
    const iv = bound === null ? [0, S.maxDist] as [number, number] : ballInterval(S, p, v, bound);
    const t = iv === null ? null : march(S, f, p, v, iv[0], Math.min(iv[1], S.maxDist));
    if (reference !== null) tally.hits++;
    if (t !== null) expect(Math.abs(f(S.flow(p, v, t).pos))).toBeLessThan(16 * marchEpsilon(t));
    if (t === null && reference !== null) {
        expect(depth()).toBeGreaterThan(-1);
        tally.graze++;
        return;
    }
    if (t === null || reference === null) { if (t !== null) tally.graze++; return; }
    tally.agreed++;
    expect(t).toBeLessThanOrEqual(reference + 1e-6);
}

/** The deepest penetration of the ray into the shape in stall-band units, min f/(16·march_epsilon(t)),
 *  sampled at 1e-3 over [from, to]. */
const minAbsAlong = (S: Space, f: Field, p: V4, v: V4, from: number, to: number) => () => {
    let m = Infinity;
    for (let t = from; t <= to; t += 1e-3) m = Math.min(m, f(S.flow(p, v, t).pos) / (16 * marchEpsilon(t)));
    return m;
};

describe.each([
    { S: H3, R: 0.6 },
    { S: S3, R: 0.5 },
])('curved march in $S.name', ({ S, R }) => {
    const inv = placement(S);

    it('a marched ball finds the closed-form root (sphere_intersect) on 2000 rays, inside and out', () => {
        const r = rng(7);
        const f: Field = (p) => sdfBall(S, p, O, R);
        const tally: Tally = { hits: 0, agreed: 0, graze: 0 };
        let inside = 0;
        for (let i = 0; i < 2000; i++) {
            const w = randomRay(S, r, 1.5);
            const p = apply(inv, w.p), v = apply(inv, w.v);
            if (f(p) < 0) inside++;
            if (Math.abs(f(p)) < 2 * MARCH_CLEARANCE) continue;   // spawned origins sit off the surface
            compare(S, f, p, v, R, ballRoot(S, p, v, R), tally, minAbsAlong(S, f, p, v, 0, S.maxDist));
        }
        expect(inside).toBeGreaterThan(50);
        expect(tally.hits).toBeGreaterThan(250);
        expect(tally.agreed).toBeGreaterThan(tally.hits - 10);
    });

    it('a marched plane finds the plane root (plane bodies) on 1000 rays', () => {
        const r = rng(11);
        for (const offset of [0, 0.4]) {
            const n: [number, number, number] = [0.36, 0.48, 0.8];
            const N = S.planeVector(n, offset);
            const f: Field = (p) => sdfPlane(S, p, n, offset);
            const tally: Tally = { hits: 0, agreed: 0, graze: 0 };
            for (let i = 0; i < 500; i++) {
                const { p, v } = randomRay(S, r, 1.5);
                if (Math.abs(f(p)) < 2 * MARCH_CLEARANCE) continue;
                const root = planeRoot(S, p, v, N);
                compare(S, f, p, v, null, root !== null && root <= S.maxDist ? root : null, tally, minAbsAlong(S, f, p, v, 0, S.maxDist));
            }
            expect(tally.hits).toBeGreaterThan(100);
            expect(tally.agreed).toBeGreaterThan(tally.hits - 5);
        }
    });

    it('a marched capped tube finds the brute-force root, bounded by a ball of radius 0.8', () => {
        const r = rng(13);
        const Y: V4 = [0, 1, 0, 0];
        const f: Field = (p) => Math.max(sdfTube(S, p, O, Y, 0.15), sdfPlane(S, p, [0, 1, 0], -0.4), sdfPlane(S, p, [0, -1, 0], -0.4));
        const tally: Tally = { hits: 0, agreed: 0, graze: 0 };
        for (let i = 0; i < 150; i++) {
            const { p, v } = aimedRay(S, r, 1.3, 0.5);
            if (Math.abs(f(p)) < 2 * MARCH_CLEARANCE) continue;
            // The reference ignores the bound: a bound that clipped the tube would fail here.
            const to = S.name === 'hyperbolic' ? 4 : S.maxDist;
            compare(S, f, p, v, 0.8, bruteRoot(S, f, p, v, MARCH_CLEARANCE, to, 2e-4), tally, minAbsAlong(S, f, p, v, 0, to));
        }
        expect(tally.hits).toBeGreaterThan(20);
    });

    it('a marched smooth-union sculpture finds the brute-force root from outside its bound and from its own surface', () => {
        const r = rng(17);
        const f = sculptureField(S);
        const to = S.name === 'hyperbolic' ? 4 : S.maxDist;
        const tally: Tally = { hits: 0, agreed: 0, graze: 0 };
        let surface = 0, aroundHits = 0;
        for (let i = 0; i < 160; i++) {
            let { p, v } = aimedRay(S, r, 1.3, 0.6);
            if (i % 2 === 1) {
                // A spawned ray: from a surface point of the sculpture, 1e-3 outside it, leaving outward
                // (inside its bound, outside the shape — every BSDF ray off the sculpture).
                const iv = ballInterval(S, p, v, SCULPTURE.bound);
                const t = iv === null ? null : march(S, f, p, v, iv[0], iv[1]);
                if (t === null) continue;
                const x = S.flow(p, v, t).pos;
                const n = gradient(S, f, x);
                p = S.flow(x, n, 1e-3).pos;
                const d = unit3(r);
                let dir = S.tangent(p, [d[0], d[1], d[2], 0]);
                const nn = S.tangent(p, n);
                if (S.form(dir, nn) < 0) dir = dir.map((c, k) => c - 2 * S.form(dir, nn) / S.form(nn, nn) * nn[k]) as V4;
                v = unitT(S, dir);
                surface++;
            }
            if (Math.abs(f(p)) < 5e-4) continue;
            const ref = bruteRoot(S, f, p, v, MARCH_CLEARANCE, to, 2e-4);
            const iv = ballInterval(S, p, v, SCULPTURE.bound);
            if (ref !== null && iv !== null && ref > (S.name === 'spherical' && iv[0] === 0 ? exitOf(S, p, v) : Infinity)) aroundHits++;
            compare(S, f, p, v, SCULPTURE.bound, ref, tally, minAbsAlong(S, f, p, v, 0, to));
        }
        expect(surface).toBeGreaterThan(40);
        expect(tally.hits).toBeGreaterThan(40);
        // In S³ some spawned rays meet the sculpture only after leaving the bound and coming back.
        if (S.name === 'spherical') expect(aroundHits).toBeGreaterThan(5);
    });

    it('the tangent-frame 4-tap normal is within 3e-3 rad of the true normal (ball, plane, tube)', () => {
        const r = rng(19);
        const Y: V4 = [0, 1, 0, 0];
        const n: [number, number, number] = [0, 0.6, 0.8];
        const fields: { f: Field; normal: (x: V4) => V4 }[] = [
            // The ball's outward normal: the direction at x away from its center.
            { f: (p) => sdfBall(S, p, O, R), normal: (x) => S.directionTo(x, O).map((c) => -c) as V4 },
            { f: (p) => sdfPlane(S, p, n, 0.2), normal: (x) => unitT(S, S.tangent(x, S.planeVector(n, 0.2))) },
            { f: (p) => sdfTube(S, p, O, Y, 0.15), normal: (x) => gradient(S, (p) => sdfTube(S, p, O, Y, 0.15), x) },
        ];
        let worst = 0;
        for (const { f, normal } of fields) {
            for (let i = 0; i < 300; i++) {
                const { p, v } = randomRay(S, r, 1.2);
                const t = march(S, f, p, v, 0, S.maxDist, { epsilon: () => 1e-9, steps: 100000, floor: 0 });
                if (t === null) continue;
                const { pos: x, vel } = S.flow(p, v, t);
                const nTrue = normal(x);
                const nFd = fdNormal(S, f, x, vel);
                worst = Math.max(worst, angle(S, nFd, nTrue));
            }
        }
        expect(worst).toBeLessThan(3e-3);
        expect(worst).toBeGreaterThan(1e-5);   // the FD error is real (first order in h)
    });

    it('every helper and both witness fields are 1-Lipschitz along geodesic distance', () => {
        const r = rng(23);
        const c = sdfPoint(S, [0.2, -0.3, 0.1]);
        const u = unitT(S, S.tangent(c, [0.5, 0.2, -0.4, 0.3]));
        const fields: Field[] = [
            (p) => sdfBall(S, p, c, 0.4),
            (p) => sdfPlane(S, p, [0.6, 0, 0.8], 0.3),
            (p) => sdfTube(S, p, c, u, 0.2),
            (p) => smoothIntersection(sdfBall(S, p, c, 0.5), sdfPlane(S, p, [0, 1, 0], 0.1), 0.2),
            sculptureField(S),
            cavityField(S),
        ];
        let worst = 0;
        for (let i = 0; i < 10000; i++) {
            const a = randomRay(S, r, 2.0);
            const q = i % 2 === 0 ? S.flow(a.p, a.v, 0.05 * r()).pos : randomRay(S, r, S.name === 'spherical' ? 3.1 : 2.0).p;
            const d = S.dist(a.p, q);
            if (d < 1e-9) continue;
            for (const f of fields) worst = Math.max(worst, Math.abs(f(a.p) - f(q)) / d);
        }
        expect(worst).toBeLessThanOrEqual(1 + 1e-9);
        expect(worst).toBeGreaterThan(0.99);   // the exact distances attain slope 1
    });
});

describe('the Klein chart of H³', () => {
    it('never stretches distance: |k(p) − k(q)| ≤ d_H(p, q)', () => {
        const r = rng(29);
        let worst = 0;
        for (let i = 0; i < 10000; i++) {
            const a = randomRay(H3, r, 4);
            const q = i % 2 === 0 ? H3.flow(a.p, a.v, 0.01 * r()).pos : randomRay(H3, r, 4).p;
            const ka = klein(a.p), kq = klein(q);
            const dE = Math.hypot(ka[0] - kq[0], ka[1] - kq[1], ka[2] - kq[2]);
            worst = Math.max(worst, dE / H3.dist(a.p, q));
        }
        expect(worst).toBeLessThanOrEqual(1 + 1e-9);
    });

    it('a Euclidean sphere of radius tanh R in the chart is the ball of radius R, and marches to its root', () => {
        const R = 0.6;
        const f: Field = (p) => { const k = klein(p); return Math.hypot(k[0], k[1], k[2]) - Math.tanh(R); };
        const r = rng(31);
        for (let i = 0; i < 100; i++) {
            const d = unit3(r);
            const root = bruteRoot(H3, f, O, [d[0], d[1], d[2], 0], 0, 2, 1e-3);
            expect(Math.abs(root! - R)).toBeLessThan(1e-12);
        }
        let agreed = 0;
        for (let i = 0; i < 500; i++) {
            const { p, v } = randomRay(H3, r, 1.5);
            if (Math.abs(f(p)) < 2 * MARCH_CLEARANCE) continue;
            const ref = ballRoot(H3, p, v, R);
            const t = march(H3, f, p, v, 0, H3.maxDist);
            if (t === null || ref === null) continue;
            agreed++;
            expect(t).toBeLessThanOrEqual(ref + 1e-6);
            // The chart field's acceptance holds the true residual to march_epsilon·cosh²ρ.
            expect(Math.abs(sdfBall(H3, H3.flow(p, v, t).pos, O, R))).toBeLessThan(16 * marchEpsilon(t) * Math.cosh(R) ** 2);
        }
        expect(agreed).toBeGreaterThan(100);
    });
});

/** The exit of the S³ bound along (p, v) from an origin inside it (the first time the geodesic
 *  leaves the ball of radius SCULPTURE.bound). */
function exitOf(S: Space, p: V4, v: V4): number {
    const f: Field = (x) => sdfBall(S, x, O, SCULPTURE.bound);
    return bruteRoot(S, f, p, v, 0, S.maxDist, 1e-3) ?? S.maxDist;
}
