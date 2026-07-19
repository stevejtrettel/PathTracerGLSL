// Split from materialsContract.test.ts (D5: a family's door regression fails a file
// named for that family).

import { describe, it, expect } from 'vitest';
import { VOLUME_SCATTERING_MODELS } from '../../src/components/volume_scattering/index.js';

describe('phase model GLSL symbols (<id>_eval/_sample/_pdf)', () => {
    for (const [id, d] of Object.entries(VOLUME_SCATTERING_MODELS)) {
        if (d === undefined) continue;
        it(`${id} defines all three ops`, () => {
            expect(new RegExp(`Spectrum\\s+${id}_eval\\s*\\(`).test(d.glsl), `${id}_eval`).toBe(true);
            expect(new RegExp(`InteractionSample\\s+${id}_sample\\s*\\(`).test(d.glsl), `${id}_sample`).toBe(true);
            expect(new RegExp(`float\\s+${id}_pdf\\s*\\(`).test(d.glsl), `${id}_pdf`).toBe(true);
        });
    }
});

/** SceneMaterial keys that are NOT properties (mirrors materialsContract's list). */
const RESERVED_KEYS = new Set(['model', 'medium', 'sampleAsLight']);

describe('volume-scattering model rows (second schema family)', () => {
    it('rows carry numeric defaults and never collide with meta-keys', () => {
        for (const [id, d] of Object.entries(VOLUME_SCATTERING_MODELS)) {
            if (d === undefined) continue;
            for (const f of d.properties) {
                expect(typeof f.default, `${id}.${f.name}`).toBe('number');
                expect(RESERVED_KEYS.has(f.source as string)).toBe(false);
            }
        }
    });
});
