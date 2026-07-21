// The sampler budget (fable-data-rail §5): rail v2 makes texture count ROLE-shaped, so
// even the heaviest scenes sit well under the WebGL2 floor of 16 fragment units. The
// Generator enforces the floor on EVERY compile (an over-budget program is an itemized
// CompilationError — glsl-compile therefore sweeps the whole suite); this test PINS the
// worst-case rosters so channel/texture creep is caught the day it's introduced.

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { cactiScene, cactiStrategy, cactiMisStrategy } from '../../demos/cactiScene.js';
import { forestScene, forestStrategy } from '../../demos/forestScene.js';
import { skyScene, skyMisStrategy } from '../witnesses/scenes/envScenes.js';
import { bazaarScene, bazaarTableStrategy } from '../witnesses/scenes/tableWitness.js';

const compiler = new Compiler();

function samplerCount(frag: string): number {
    return [...frag.matchAll(/uniform\s+sampler2D\s+\w+/g)].length;
}

function maxSamplers(scene: Parameters<Compiler['compile']>[0], strategy: Parameters<Compiler['compile']>[1]): number {
    const r = compiler.compile(scene, strategy);
    let max = 0;
    for (const [, s] of r.shaders) max = Math.max(max, samplerCount(s.fragment));
    return max;
}

describe('sampler budget (fable-data-rail §5)', () => {
    it('the cacti showcase (4 meshes + a mesh light + containment) fits the role-shaped budget', () => {
        // The scene that BROKE the per-object extern model (22+ units on a 16-unit GPU).
        expect(maxSamplers(cactiScene, cactiStrategy)).toBeLessThanOrEqual(13);
        expect(maxSamplers(cactiScene, cactiMisStrategy)).toBeLessThanOrEqual(13);
    });

    it('instancing + meshes (forest) fits', () => {
        expect(maxSamplers(forestScene, forestStrategy)).toBeLessThanOrEqual(13);
    });

    it('the scene table (bazaar, ~35 unique objects) fits the role-shaped budget', () => {
        expect(maxSamplers(bazaarScene, bazaarTableStrategy)).toBeLessThanOrEqual(13);
    });

    it('an env-heavy scene fits (the other big sampler spender)', () => {
        expect(maxSamplers(skyScene, skyMisStrategy)).toBeLessThanOrEqual(16);
    });
});
