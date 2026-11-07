// The curved shapes and quad-light witnesses' expected values (scenes/curvedShapesWitness.ts)
// recomputed by their twin (scenes/curvedShapeTwins.ts), and the fixtures checked against what they
// rest on: each readout window lies inside one lit face (4×4 points per pixel), the window means
// barely move between 2×2 and 4×4 points per pixel, the quad-light quadrature agrees with an
// independent cosine-sampled estimate (ray–quad intersections only, no area density), and the
// deliberate mutation of the quad-light pdf (w³ → w²) moves the expected mean by several times the
// witness tolerance.

import { describe, it, expect } from 'vitest';
import {
    type Space, type V4, form, lin, flow, tangentUnit, quadEmitter, quadIrradiance, quadIntersect, geometryOf,
    shapesWindowMean, shapesWindowFaces, type QuadEmitter,
} from './scenes/curvedShapeTwins.js';
import {
    H3_SHAPES, S3_SHAPES, H3_QUAD_LIGHT, S3_QUAD_LIGHT, H3_QUAD_WINDOW_MEAN, S3_QUAD_WINDOW_MEAN, type ShapesFixture,
} from './scenes/curvedShapesWitness.js';
import * as H from './scenes/h3Twins.js';
import * as Sp from './scenes/s3Twins.js';
import { H3_CAMERA, H3_FOV, H3_SIZE, H3_WINDOW, H3_RECEIVER } from './scenes/h3Witness.js';
import { S3_CAMERA, S3_FOV, S3_SIZE, S3_WINDOW, S3_RECEIVER } from './scenes/s3Witness.js';
import { mat4Apply, placementIsometry } from '../../src/components/ambient/isometry.js';
import { IDENTITY_QUAT } from '../../src/components/geometry/similarity.js';

const cases: Array<[Space, ShapesFixture]> = [['H3', H3_SHAPES], ['S3', S3_SHAPES]];

describe('curved shapes witness twins', () => {
    for (const [S, f] of cases) {
        it(`${S}: every window lies inside its one lit face`, () => {
            for (const w of f.windows) {
                const { faces, unlit } = shapesWindowFaces(S, f, w.region, 4);
                expect([...faces], w.label).toEqual([w.face]);
                expect(unlit, w.label).toBe(0);
            }
        });

        it(`${S}: the window means are the stated constants, and 4×4 points per pixel move them by < 1e-4`, () => {
            for (const w of f.windows) {
                const m2 = shapesWindowMean(S, f, w.region, 2);
                expect(Math.abs(m2 - w.mean), w.label).toBeLessThan(2e-7);
                expect(Math.abs(shapesWindowMean(S, f, w.region, 4) / m2 - 1), w.label).toBeLessThan(1e-4);
            }
        });
    }
});

/** A quad light's emitter and its placement's inverse (to test hits in its frame). */
function emitterOf(S: Space, l: { corner: [number, number, number]; edge1: [number, number, number]; edge2: [number, number, number]; emission: number }): { e: QuadEmitter; ginv: number[] } {
    const center: [number, number, number] = [0, 1, 2].map((i) => l.corner[i] + 0.5 * (l.edge1[i] + l.edge2[i])) as [number, number, number];
    const geom = geometryOf(S);
    return { e: quadEmitter(S, l.corner, l.edge1, l.edge2, l.emission), ginv: geom.inverse(placementIsometry(geom, [0, 0, 0], IDENTITY_QUAT, center)) };
}

function lcg(seed: number): () => number {
    let s = seed;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const quadCases = [
    { S: 'H3' as Space, light: H3_QUAD_LIGHT, mean: H3_QUAD_WINDOW_MEAN, windowMean: H.windowMean, pose: H3_CAMERA, fov: H3_FOV, size: H3_SIZE, window: H3_WINDOW, receiver: H3_RECEIVER },
    { S: 'S3' as Space, light: S3_QUAD_LIGHT, mean: S3_QUAD_WINDOW_MEAN, windowMean: Sp.windowMean, pose: S3_CAMERA, fov: S3_FOV, size: S3_SIZE, window: S3_WINDOW, receiver: S3_RECEIVER },
];

describe('curved quad-light witness twins', () => {
    for (const c of quadCases) {
        const { e, ginv } = emitterOf(c.S, c.light);

        it(`${c.S}: the quadrature agrees with cosine-sampled ray hits at an off-axis receiver point`, () => {
            const geom = geometryOf(c.S);
            const Y: V4 = [0, 1, 0, 0];
            const x = geom.exp([0.21, 0, 0.28]) as V4;   // 0.35 from o in the receiver's plane
            const n = tangentUnit(c.S, x, Y);
            const t1 = tangentUnit(c.S, x, [1, 0, 0, 0]);
            const t2v: V4 = [0, 0, 1, 0];
            let t2 = lin(t2v, 1, t1, -form(c.S, t2v, t1));
            t2 = tangentUnit(c.S, x, t2);
            const rnd = lcg(777);
            const N = 200000;
            const local = (v: V4) => mat4Apply(ginv, v) as V4;
            const lx = local(x);
            let hits = 0;
            for (let i = 0; i < N; i++) {
                const u1 = rnd(), u2 = rnd();
                const r = Math.sqrt(u1), phi = 2 * Math.PI * u2;
                const v = lin(lin(t1, r * Math.cos(phi), t2, r * Math.sin(phi)), 1, n, Math.sqrt(Math.max(0, 1 - u1)));
                const lv = local(v);
                const t = quadIntersect(c.S, lx, lv, c.light.edge1, c.light.edge2);
                if (t === null) continue;
                // the emitting face: the ray arrives against the quad's normal (ê1×ê2, 0) in its frame
                const arr = flow(c.S, lx, lv, t).vel;
                const e1 = c.light.edge1, e2 = c.light.edge2;
                const nq: V4 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0], 0];
                if (form(c.S, arr, nq) < 0) hits++;
            }
            const p = hits / N;
            const mc = Math.PI * e.Le * p, se = Math.PI * e.Le * Math.sqrt(p * (1 - p) / N);
            expect(p).toBeGreaterThan(0.05);
            expect(Math.abs(mc - quadIrradiance(c.S, x, n, e)) / se).toBeLessThan(4);
        });

        it(`${c.S}: the window lies inside the receiver and its mean is the stated constant`, () => {
            const m = c.windowMean(c.pose, c.fov, c.size, c.window, c.receiver, (x: V4, nx: V4) => quadIrradiance(c.S, x, nx, e), 2);
            expect(m.missed).toBe(0);
            expect(Math.abs(m.mean - c.mean)).toBeLessThan(2e-7);
        });

        it(`${c.S}: the pdf mutation w³ → w² would move the NEE mean by more than 5× the 0.002 tolerance`, () => {
            const mutated = c.windowMean(c.pose, c.fov, c.size, c.window, c.receiver, (x: V4, nx: V4) => quadIrradiance(c.S, x, nx, e, 24, (w) => w * w), 2);
            expect(Math.abs(mutated.mean - c.mean)).toBeGreaterThan(0.01);
        });
    }
});
