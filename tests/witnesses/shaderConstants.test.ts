// The witness expected values that depend on shader constants read those constants from the
// GLSL (shaderConstants.ts). These pins record the values they had when the constants were
// still copied into the fixtures, so the move is shown to change nothing — and a change to
// MAX_DIST or SHADOW_BACKOFF in math.glsl shows up here as a changed expectation.

import { describe, it, expect } from 'vitest';
import { MAX_DIST, SHADOW_BACKOFF } from './scenes/shaderConstants.js';
import { SUN_HAZE_CENTER } from './scenes/precisionWitness.js';
import { FOG_SKY_SIGMA } from './scenes/estimatorAgreementWitness.js';

describe('shader constants in witness expectations', () => {
    it('are read from math.glsl', () => {
        expect(MAX_DIST).toBe(1000);
        expect(SHADOW_BACKOFF).toBe(0.002);
    });

    it('give the expected values the fixtures held as copies', () => {
        expect(SUN_HAZE_CENTER).toBe(0.1837562403164599);
        expect(Math.exp(-FOG_SKY_SIGMA * MAX_DIST)).toBe(0.36787944117144233);
        expect(0.4 * Math.exp(-FOG_SKY_SIGMA * MAX_DIST) * Math.exp(-2.5 * FOG_SKY_SIGMA)).toBe(0.14678435649373858);
    });
});
