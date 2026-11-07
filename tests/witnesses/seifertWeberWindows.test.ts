// tests/witnesses/seifertWeberWindows.test.ts — the seifert-weber-windows witness's windows are
// derived, and a wrong group would fail it.
//
// The fixture (scenes/seifertWeberWitness.ts) states each window as a literal, because the witness
// registry is loaded in the browser and has no business running the twin. This file reads the
// geometry back from the scene and strategy as authored, certifies every window with the float64
// twin (tests/helpers/seifertWeberTwin.ts: brute force over the sphere images in the cover), and
// shows that the same twin with a twist of 1/10 turn in place of 3/10 changes the value of the
// windows seen across one or two faces and of one of the three seen across three (the other two
// cross faces 1, 8 and 10, along which the wrong twists compose to the identity).

import { describe, it, expect } from 'vitest';
import {
    seifertWeberWindows, seifertWeberWindowsStrategy, SW_WINDOWS, SW_WINDOWS_IMAGE, SW_WINDOWS_R, swWindowValue, swWindowRegion,
    seifertWeberLights, seifertWeberLightsStrategies, SW_WINDOWS_CAP, SW_LIGHTS_CAP,
} from './scenes/seifertWeberWitness.js';
import { SwWindowsTwin, certifyWindow, pairings, type SwWindowsGeometry } from '../helpers/seifertWeberTwin.js';
import { swPairings, swReduce, swBallInside } from '../../src/components/quotient/seifert-weber/seifert-weber.js';
import { hyperbolicGeometry } from '../../src/components/ambient/hyperbolic/hyperbolic.js';
import { Compiler } from '../../src/compiler/Compiler.js';
import { witnessSuite } from './index.js';
import type { Vec3 } from '../../src/compiler/types.js';
import type { Vec4 } from '../../src/components/ambient/isometry.js';

const cam = seifertWeberWindowsStrategy.measurement.camera as unknown as { fov: number; position: Vec3; target: Vec3 };
const geometry: SwWindowsGeometry = {
    spheres: seifertWeberWindows.objects.map((o) => {
        if (!('parameters' in o) || o.type !== 'sphere') throw new Error('seifert-weber-windows: every object must be a sphere');
        const m = seifertWeberWindows.materials[o.material] as { emission: [number, number, number] };
        return { center: o.parameters.center as Vec3, radius: o.parameters.radius as number, emission: m.emission };
    }),
    camera: cam.position,
    target: cam.target,
    fov: cam.fov,
    size: SW_WINDOWS_IMAGE,
    farClip: seifertWeberWindowsStrategy.measurement.farClip as number,
};
const twin = new SwWindowsTwin(geometry);

describe('seifert-weber-windows scene', () => {
    it('is the scene the twin assumes: black emissive spheres in D, a camera in D, maxBounces 0, no lights', () => {
        expect(seifertWeberWindows.ambientSpace).toEqual({ type: 'hyperbolic', quotient: { kind: 'seifert-weber' } });
        expect(seifertWeberWindows.lights).toEqual([]);
        expect(seifertWeberWindows.environment).toBeUndefined();
        expect(seifertWeberWindowsStrategy.measurement.maxBounces).toBe(0);
        expect(geometry.farClip).toBe(SW_WINDOWS_R);
        for (const o of seifertWeberWindows.objects) {
            if (!('material' in o)) throw new Error('seifert-weber-windows: every object is a plain sphere');
            expect((seifertWeberWindows.materials[o.material] as { albedo: number }).albedo).toBe(0);
        }
        // The camera is in D (the reduction moves nothing) and outside every sphere.
        const p = hyperbolicGeometry.exp(geometry.camera) as Vec4;
        expect(swReduce(p, []).faces).toEqual([]);
        for (const s of geometry.spheres) {
            expect(swBallInside(hyperbolicGeometry.exp(s.center) as Vec4, s.radius)).toBe(true);
            expect(Math.acosh(-hyperbolicGeometry.form(p, hyperbolicGeometry.exp(s.center)))).toBeGreaterThan(s.radius);
        }
        expect(witnessSuite['seifert-weber-windows'].witness!.size).toEqual(SW_WINDOWS_IMAGE);
    });

    it('compiles without errors (the Validator accepts it)', () => {
        const compiler = new Compiler();
        for (const [scene, strategies] of [[seifertWeberWindows, [seifertWeberWindowsStrategy]], [seifertWeberLights, seifertWeberLightsStrategies]] as const) {
            const compiled = compiler.compileScene(scene, [...strategies]);
            expect(compiled.renderers.length).toBe(strategies.length);
        }
    }, 60000);

    it('the twin builds the occupant\'s group (to 1e-12)', () => {
        const mine = pairings();
        mine.forEach((g, i) => g.forEach((x, k) => expect(Math.abs(x - swPairings[i][k])).toBeLessThan(1e-12)));
    });

    it('reports the programs\' crossing caps', () => {
        expect(SW_WINDOWS_CAP).toBe(56);
        expect(SW_LIGHTS_CAP).toBe(64);
    });
});

describe('seifert-weber-windows windows', () => {
    for (const w of SW_WINDOWS) {
        const name = `(${w.x0}, ${w.y0}) ${w.sphere === 'miss' ? 'miss' : `sphere ${w.sphere}, ${w.crossings} crossings`}`;
        it(`${name}: certified with a one-pixel margin`, () => {
            const c = certifyWindow(twin, w);
            expect(c).not.toBeNull();
            if (w.sphere === 'miss') expect(c!.kind).toBe('miss');
            else expect(c!.kind === 'hit' ? [c!.sphere, c!.crossings] : null).toEqual([w.sphere, w.crossings]);
        }, 60000);
    }

    it('covers 0, 1, 2 and 3 face crossings and misses', () => {
        const kinds = SW_WINDOWS.map((w) => (w.sphere === 'miss' ? -1 : Math.min(w.crossings!, 3)));
        for (const n of [-1, 0, 1, 2, 3]) expect(kinds).toContain(n);
    });

    it('the registry checks every window at its sphere\'s emission (or 0), on exactly its pixels', () => {
        const checks = witnessSuite['seifert-weber-windows'].witness!.checks;
        for (const w of SW_WINDOWS) {
            const r = swWindowRegion(w);
            // tools/witness.mjs regionBounds, transcribed.
            expect(Math.floor(r.x * SW_WINDOWS_IMAGE[0])).toBe(w.x0);
            expect(Math.floor(r.y * SW_WINDOWS_IMAGE[1])).toBe(w.y0);
            expect(Math.ceil((r.x + r.w) * SW_WINDOWS_IMAGE[0])).toBe(w.x0 + w.nx);
            expect(Math.ceil((r.y + r.h) * SW_WINDOWS_IMAGE[1])).toBe(w.y0 + w.ny);
            expect(checks.some((c) => c.kind === 'mean' && JSON.stringify(c.value) === JSON.stringify(swWindowValue(w))
                && JSON.stringify(c.region) === JSON.stringify(r))).toBe(true);
        }
    });

    it('walking the ray through D with the group gives the same picture as brute force over the cover', () => {
        for (const w of SW_WINDOWS) {
            for (const [fx, fy] of [[w.x0 + 0.5, w.y0 + 0.5], [w.x0 + w.nx - 0.5, w.y0 + w.ny - 0.5]]) {
                const walked = twin.walkClassify(fx, fy);
                expect(walked.kind === 'hit' ? walked.sphere : 'miss').toBe(w.sphere);
            }
        }
    });

    it('a twist of 1/10 turn in place of 3/10 changes the 1- and 2-crossing windows and one of the three 3-crossing windows', () => {
        // The wrong group's cells do not tile H³, so its picture is the walk's, not a sum over a
        // cover: each ray walked through D with the wrong pairings. The two twists differ by a
        // 1/5 turn about the face's axis, a symmetry of D, so the wrong walk is the right one
        // with a symmetry of D inserted at every crossing. A window changes unless those
        // symmetries compose to one fixing its sphere: the two 3-crossing windows (11, 28) and
        // (5, 20) both cross faces 1, 8 and 10, along which they compose to the identity (the
        // wrong walk meets the same sphere at the same arc length, to 1e-14).
        const wrong = new SwWindowsTwin(geometry, Math.PI / 5);
        const changed: string[] = [];
        for (const w of SW_WINDOWS) {
            if (w.sphere === 'miss' || w.crossings === 0) continue;
            // The mean over a 4×4 grid in each pixel, as the wrong group would render it.
            const mean = [0, 0, 0];
            for (let py = w.y0; py < w.y0 + w.ny; py++) {
                for (let px = w.x0; px < w.x0 + w.nx; px++) {
                    for (let j = 0; j < 4; j++) {
                        for (let i = 0; i < 4; i++) {
                            const c = wrong.walkClassify(px + (i + 0.5) / 4, py + (j + 0.5) / 4);
                            if (c.kind === 'hit') geometry.spheres[c.sphere].emission.forEach((e, k) => { mean[k] += e / (16 * w.nx * w.ny); });
                        }
                    }
                }
            }
            const expected = swWindowValue(w);
            if (Math.max(...mean.map((m, k) => Math.abs(m - expected[k]))) > 0.1) changed.push(`${w.x0},${w.y0}`);
        }
        expect(changed).toEqual(['28,106', '35,62', '141,16', '29,18', '67,33']);
        // The unchanged windows' faces.
        expect(twin.walk(11.5, 28.5, 3.3).faces).toEqual([1, 8, 10]);
        expect(twin.walk(5.5, 20.5, 3.45).faces).toEqual([1, 8, 10]);
    }, 120000);
});
