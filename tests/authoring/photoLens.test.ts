// thinLensFromPhoto: a photographic lens (focal length, f-number, focus distance, sensor height)
// converted to the object-space thin lens's fields. The check that matters is depth of field:
// for every depth z, the angular blur radius of the object-space model, R·|1/z − 1/F|, equals a
// real thin lens's blur-circle radius on the sensor divided by the image distance v,
// (f/2N)·|v_z − v|/(v_z·v), with v_z = z f/(z − f).

import { describe, it, expect } from 'vitest';
import { thinLensFromPhoto } from '../../src/authoring/photoLens.js';

const lens50 = { focalLengthMm: 50, fNumber: 1.8, focusDistance: 2, sensorHeightMm: 24, metersPerUnit: 1 };

describe('thinLensFromPhoto', () => {
    it('50 mm f/1.8 focused at 2 m on a 24 mm sensor', () => {
        const cam = thinLensFromPhoto(lens50);
        expect(cam.type).toBe('thinlens');
        expect(cam.aperture).toBeCloseTo(0.05 / 3.6, 12);   // f / 2N
        expect(cam.fov).toBeCloseTo(0.459728, 6);           // 2 atan(h / 2v), v = Ff/(F − f)
        expect(cam.focusDistance).toBe(2);
    });

    for (const metersPerUnit of [1, 0.01, 3.5]) {
        it(`object-space blur equals the real lens's blur at every depth (metersPerUnit ${metersPerUnit})`, () => {
            const fNumber = 2.8, f = 0.085, Fm = 3;
            const cam = thinLensFromPhoto({ focalLengthMm: 85, fNumber, focusDistance: Fm / metersPerUnit, sensorHeightMm: 24, metersPerUnit });
            const v = (Fm * f) / (Fm - f);
            for (const zm of [0.5, 0.9, 1.5, 2.999, 3.001, 5, 10, 100]) {
                const z = zm / metersPerUnit;
                const objectSpace = cam.aperture * Math.abs(1 / z - 1 / cam.focusDistance);
                const vz = (zm * f) / (zm - f);
                const real = (f / (2 * fNumber)) * Math.abs(vz - v) / (vz * v);
                // 1e-10: near the focus plane both sides are differences of close numbers.
                expect(Math.abs(objectSpace - real) / real).toBeLessThan(1e-10);
            }
        });
    }

    it('the field of view is the sensor height seen from the image distance', () => {
        const cam = thinLensFromPhoto({ ...lens50, focusDistance: 1e9 });
        // Focused at infinity, v → f: the familiar 2 atan(h / 2f).
        expect(cam.fov).toBeCloseTo(2 * Math.atan(0.012 / 0.05), 9);
    });

    it('throws when no real image exists (focus distance ≤ focal length)', () => {
        expect(() => thinLensFromPhoto({ ...lens50, focusDistance: 0.05 })).toThrow(/focal length/);
        expect(() => thinLensFromPhoto({ ...lens50, focusDistance: 0.04 })).toThrow(/focal length/);
        expect(() => thinLensFromPhoto({ ...lens50, focusDistance: 4, metersPerUnit: 0.01 })).toThrow(/focal length/);
    });

    it('throws on a missing, non-finite or non-positive input (no defaults)', () => {
        for (const key of Object.keys(lens50) as (keyof typeof lens50)[]) {
            for (const bad of [undefined, 0, -1, NaN, Infinity]) {
                expect(() => thinLensFromPhoto({ ...lens50, [key]: bad } as typeof lens50), `${key} = ${bad}`).toThrow(new RegExp(key));
            }
        }
    });
});
