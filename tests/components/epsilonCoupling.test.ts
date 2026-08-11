// The epsilon-coupling gate (fable-sdf-contract §4's derived-coupling rule — the old
// tracer's AT_THRESH lesson, made enforceable): any tolerance that must CONTAIN
// another is a RELATIONSHIP, not two independent numbers. The §4.2 classification
// probes step EPS_INTERFACE off the surface and must clear the marcher's worst
// accepted residual; the refinement bug proved what happens when a residual outruns
// the band (contour rings, wrong-side speckle). Until the constants are emitted from
// one derivation, this test IS the coupling: edit either file and the relationship
// re-checks here instead of silently breaking on the GPU.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string): string => readFileSync(join(__dirname, '../../src/glsl/core', p), 'utf8');

const define = (src: string, name: string): number => {
    const m = src.match(new RegExp(`#define\\s+${name}\\s+([0-9.eE+-]+)`));
    if (!m) throw new Error(`${name} not found`);
    return Number(m[1]);
};

describe('march ↔ classification epsilon coupling', () => {
    const march = read('march.glsl');
    const math = read('math.glsl');
    const MARCH_EPSILON = define(march, 'MARCH_EPSILON');
    const MARCH_EPSILON_MAX = define(march, 'MARCH_EPSILON_MAX');
    const EPS_INTERFACE = define(math, 'EPS_INTERFACE');

    it('EPS_INTERFACE is the documented 10× MARCH_EPSILON', () => {
        expect(EPS_INTERFACE).toBeCloseTo(10 * MARCH_EPSILON, 12);
    });

    it('the classification probe clears the worst accepted residual (2× margin)', () => {
        // march_epsilon(t) caps at MARCH_EPSILON_MAX; a probe at EPS_INTERFACE must
        // clear an accepted point sitting a full acceptance radius off the surface,
        // with the factor-2 margin the march.glsl comment promises.
        expect(EPS_INTERFACE).toBeGreaterThanOrEqual(2 * MARCH_EPSILON_MAX);
    });

    it('the cap is coarser than the base epsilon (the t-growth has headroom)', () => {
        expect(MARCH_EPSILON_MAX).toBeGreaterThan(MARCH_EPSILON);
    });
});
