// The surface Russian-roulette rule. A path can reach it with exactly zero throughput (a medium
// absorbed it, or the wavelength collapse zeroed its last live lane), and random() returns
// exactly 0 with probability 2^-24; the rule must end such a path before dividing by its
// survival probability, or 0/0 leaves the pixel NaN.

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';

describe('surface roulette', () => {
    it('ends a zero-throughput path before drawing or dividing', () => {
        const header = 'bool roulette(inout PathState s, int bounce) {';
        const source = [...new Compiler().compile(minimalScene, minimalStrategy).shaders.values()]
            .map((s) => s.fragment).find((f) => f.includes(header));
        expect(source).toBeDefined();
        const start = source!.indexOf(header);
        const body = source!.slice(start, source!.indexOf('\n}', start));
        const guard = body.indexOf('if (p_survive <= 0.0) return false;');
        const draw = body.indexOf('if (random() > p_survive)');
        const division = body.indexOf('s.throughput /= p_survive;');
        expect(draw).toBeGreaterThan(-1);
        expect(division).toBeGreaterThan(-1);
        expect(guard).toBeGreaterThan(-1);
        expect(guard).toBeLessThan(draw);
    });
});
