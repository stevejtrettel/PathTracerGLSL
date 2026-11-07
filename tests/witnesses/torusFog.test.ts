// tests/witnesses/torusFog.test.ts — the torus-fog witness's windows and values are derived.
//
// The fixture (scenes/torusWitness.ts) states each window's expected mean as a literal, because
// the witness registry is loaded in the browser and has no business running the twin. This file
// reads the geometry back from the scene and strategy as authored, certifies every window with
// the float64 twin (tests/helpers/torusFogTwin.ts: brute force over the sphere's lattice images),
// and recomputes every value, so a literal cannot drift from the scene it describes.

import { describe, it, expect } from 'vitest';
import {
    torusFog, torusFogStrategy, FOG_WINDOWS, fogWindowRegion, FOG_IMAGE, FOG_SIGMA_A, FOG_LE, FOG_R,
} from './scenes/torusWitness.js';
import { certifyWindow, windowMean, fogGlow, type TorusFogGeometry } from '../helpers/torusFogTwin.js';
import { witnessSuite } from './index.js';
import type { Vec3, MediumDescription } from '../../src/compiler/types.js';

const ball = torusFog.objects[0];
if (!('parameters' in ball) || ball.type !== 'sphere') throw new Error('torus-fog: the first object must be the sphere');
const cam = torusFogStrategy.measurement.camera as unknown as { fov: number; position: Vec3; target: Vec3 };

const geometry: TorusFogGeometry = {
    center: ball.parameters.center as Vec3,
    radius: ball.parameters.radius as number,
    camera: cam.position,
    target: cam.target,
    fov: cam.fov,
    size: FOG_IMAGE,
    farClip: torusFogStrategy.measurement.farClip as number,
};

describe('torus-fog scene', () => {
    it('is the scene the twin assumes: a unit cube torus, an absorbing fog with ε = σ_a·Le, a black sphere', () => {
        expect(torusFog.ambientSpace.quotient).toEqual({ kind: 'torus', size: [1, 1, 1] });
        const fog = torusFog.materials[torusFog.ambientMedium!].medium as MediumDescription;
        expect(fog.sigma_a).toBe(FOG_SIGMA_A);
        expect(fog.emission).toBe(FOG_SIGMA_A * FOG_LE);
        expect(fog.sigma_s ?? 0).toBe(0);
        expect(torusFog.materials[ball.material]).toEqual({ model: 'lambert', albedo: 0 });
        expect(torusFog.lights).toEqual([]);
        expect(geometry.farClip).toBe(FOG_R);
        expect(FOG_R).toBeGreaterThanOrEqual(2 * Math.sqrt(3));
        // The camera is in D and outside the sphere, so camera rays start in cell 0.
        expect(geometry.camera.every((v) => Math.abs(v) < 0.5)).toBe(true);
        expect(Math.hypot(...geometry.camera.map((v, a) => v - geometry.center[a]))).toBeGreaterThan(geometry.radius);
        const spec = witnessSuite['torus-fog'].witness!;
        expect(spec.size).toEqual(FOG_IMAGE);
    });

    it('a miss reads Le·(1 − e^{−σ_a·R}) = 0.864665', () => {
        expect(fogGlow(FOG_SIGMA_A, FOG_LE, FOG_R)).toBeCloseTo(0.864665, 6);
    });
});

describe('torus-fog windows', () => {
    for (const w of FOG_WINDOWS) {
        const name = `(${w.x0}, ${w.y0}) ${w.cell === 'miss' ? 'miss' : `cell ${w.cell.join(',')}`}`;
        it(`${name}: certified with a one-pixel margin, value ${w.value}`, () => {
            const c = certifyWindow(geometry, w);
            expect(c).not.toBeNull();
            if (w.cell === 'miss') expect(c!.kind).toBe('miss');
            else expect(c!.kind === 'hit' ? c!.k : null).toEqual(w.cell);
            expect(Math.abs(windowMean(geometry, w, FOG_SIGMA_A, FOG_LE) - w.value)).toBeLessThan(5e-6);
        });
    }

    it('covers 0, 1, 2 and more face crossings and misses', () => {
        const crossings = FOG_WINDOWS.map((w) => (w.cell === 'miss' ? -1 : w.cell.reduce((s, v) => s + Math.abs(v), 0)));
        for (const n of [-1, 0, 1, 2, 3]) expect(crossings).toContain(n);
    });

    it('each window region selects exactly its pixels (the runner rounds with floor and ceil)', () => {
        for (const w of FOG_WINDOWS) {
            const r = fogWindowRegion(w);
            // tools/witness.mjs regionBounds, transcribed.
            expect(Math.floor(r.x * FOG_IMAGE[0])).toBe(w.x0);
            expect(Math.floor(r.y * FOG_IMAGE[1])).toBe(w.y0);
            expect(Math.ceil((r.x + r.w) * FOG_IMAGE[0])).toBe(w.x0 + w.nx);
            expect(Math.ceil((r.y + r.h) * FOG_IMAGE[1])).toBe(w.y0 + w.ny);
        }
    });

    it('the registry checks every window', () => {
        const checks = witnessSuite['torus-fog'].witness!.checks;
        for (const w of FOG_WINDOWS) {
            expect(checks.some((c) => c.kind === 'mean' && c.value === w.value
                && JSON.stringify(c.region) === JSON.stringify(fogWindowRegion(w)))).toBe(true);
        }
    });
});
