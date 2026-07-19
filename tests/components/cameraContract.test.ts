// Split from materialsContract.test.ts (D5: a family's door regression fails a file
// named for that family).

import { describe, it, expect } from 'vitest';
import { CAMERA_MODELS } from '../../src/components/camera/index.js';

describe('camera occupant GLSL symbols (the fixed camera_generateRay seam)', () => {
    for (const [type, d] of Object.entries(CAMERA_MODELS)) {
        if (d === undefined) continue;
        it(`${type} provides camera_generateRay(vec2, vec2)`, () => {
            expect(/Ray\s+camera_generateRay\s*\(\s*vec2\s+\w+\s*,\s*vec2\s+\w+\s*\)/.test(d.glsl)).toBe(true);
        });
    }
});
