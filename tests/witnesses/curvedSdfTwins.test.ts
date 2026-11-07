// The marched-field witnesses' expected values (scenes/curvedSdfWitness.ts) recomputed by their fp64
// twin (scenes/curvedSdfTwins.ts): the ball's window mean from the closed-form hit and the analytic
// normal, the sculpture's from the exact first hit of its field, a central-difference normal and a
// shadow ray marched against the field. Each window must be fully covered by its object, and the S³
// ball's window must hold points lit through each arc.

import { describe, it, expect } from 'vitest';
import { H3, S3, type Space, type Field, ballRoot, exactHit, gradient, pointLight, sdfBall, sculptureField, apply } from './scenes/curvedSdfTwins.js';
import { curvedCameraRay, regionMean, type V4 } from './scenes/curvedTwins.js';
import {
    SDF_SIZE, SDF_WINDOW, SDF_FOV, SDF_ALBEDO, SDF_FURNACE_VALUE, SDF_BALL, SDF_BALL_WINDOW_MEAN, SDF_BLEND, SDF_BLEND_WINDOW_MEAN,
} from './scenes/curvedSdfWitness.js';
import { placementIsometry } from '../../src/components/ambient/isometry.js';
import { quatFromAxisAngle } from '../../src/components/geometry/similarity.js';

type SpaceKey = 'hyperbolic' | 'spherical';
const spaceOf = (k: SpaceKey): Space => k === 'hyperbolic' ? H3 : S3;

/** The ball witness's window: { mean, missed, short, long } (points lit through each arc). */
export function ballWindow(k: SpaceKey): { mean: number; missed: number; short: number; long: number } {
    const S = spaceOf(k), b = SDF_BALL[k];
    const C = S.geom.exp(b.center) as V4;
    const inv = S.geom.inverse(S.geom.transvection(b.center));
    const q = S.geom.exp(b.light.position) as V4;
    const world: Field = (p) => sdfBall(S, p, C, b.radius);
    let missed = 0, short = 0, long = 0;
    const [mean] = regionMean((fx, fy) => curvedCameraRay(S.geom, b.camera, SDF_FOV, SDF_SIZE, fx, fy), SDF_SIZE, SDF_WINDOW, (p, v) => {
        const t = ballRoot(S, apply(inv, p), apply(inv, v), b.radius);
        if (t === null) { missed++; return [0, 0, 0]; }
        const x = S.flow(p, v, t).pos;
        const n = S.directionTo(x, C).map((c) => -c) as V4;
        const { E, arc } = pointLight(S, world, x, n, q, b.light.emission);
        if (arc === 'short') short++;
        if (arc === 'long') long++;
        const L = (SDF_ALBEDO / Math.PI) * E;
        return [L, L, L];
    });
    return { mean, missed, short, long };
}

/** The sculpture witness's window: { mean, missed }. */
export function blendWindow(k: SpaceKey): { mean: number; missed: number } {
    const S = spaceOf(k), c = SDF_BLEND[k];
    const g = placementIsometry(S.geom, SDF_BLEND.transform.position, quatFromAxisAngle(SDF_BLEND.transform.rotation.axis, SDF_BLEND.transform.rotation.angle), [0, 0, 0]);
    const inv = S.geom.inverse(g);
    const local = sculptureField(S);
    const world: Field = (p) => local(apply(inv, p));
    const q = S.geom.exp(c.light.position) as V4;
    let missed = 0;
    const [mean] = regionMean((fx, fy) => curvedCameraRay(S.geom, c.camera, SDF_FOV, SDF_SIZE, fx, fy), SDF_SIZE, SDF_WINDOW, (p, v) => {
        const t = exactHit(S, world, p, v, 0, S.maxDist);
        if (t === null) { missed++; return [0, 0, 0]; }
        const x = S.flow(p, v, t).pos;
        const n = gradient(S, world, x);
        const L = (SDF_ALBEDO / Math.PI) * pointLight(S, world, x, n, q, c.light.emission).E;
        return [L, L, L];
    });
    return { mean, missed };
}

describe('curved marched-field witness twins', () => {
    it('the furnace value is Σ_{k≤6} 0.8^k', () => {
        expect(SDF_FURNACE_VALUE).toBeCloseTo(3.951424, 12);
    });

    it.each(['hyperbolic', 'spherical'] as const)('the %s ball window mean is the closed form, the window fully on the ball', (k) => {
        const w = ballWindow(k);
        expect(w.missed).toBe(0);
        if (k === 'spherical') {
            expect(w.short).toBeGreaterThan(50);
            expect(w.long).toBeGreaterThan(50);
        }
        expect(w.mean).toBeCloseTo(SDF_BALL_WINDOW_MEAN[k], 6);
    });

    it.each(['hyperbolic', 'spherical'] as const)('the %s sculpture window mean is the fp64 twin, the window fully on the sculpture', (k) => {
        const w = blendWindow(k);
        expect(w.missed).toBe(0);
        expect(w.mean).toBeCloseTo(SDF_BLEND_WINDOW_MEAN[k], 6);
    });
});
