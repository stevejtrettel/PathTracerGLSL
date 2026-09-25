// Path budgets and step limits in media: measurement.maxNullCrossings (a budget: one for the
// whole path, its shadow rays included) and the tracking loops' bound (a step limit, derived per
// segment so it never decides the picture — taxonomy §4.1). The GPU gate for the crossing budget
// is the null-budget witness; these check the plumbing and the bound's tail probability.

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { DEFAULT_MAX_NULL_CROSSINGS } from '../../src/compiler/plan/measurement.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { SceneDescription, RenderStrategy, MediumDescription } from '../../src/compiler/types.js';

function fogScene(medium: MediumDescription, box: { halfSize: number } | 'ambient'): SceneDescription {
    return {
        id: 'fog',
        ambientSpace: { type: 'euclidean' },
        objects: [
            { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor' },
            ...(box === 'ambient' ? [] : [{
                type: 'box', parameters: { center: [0, 1, 0], halfSize: [box.halfSize, box.halfSize, box.halfSize] }, material: 'fog',
            }]),
        ],
        materials: {
            floor: { model: 'lambert', albedo: 0.5 },
            fog: { model: 'none', medium },
        },
        lights: [{ kind: 'point', position: [0, 4, 0], emission: 10 }],
        ...(box === 'ambient' ? { ambientMedium: 'fog' } : {}),
    };
}

function strategy(directLighting: 'none' | 'nee', maxNullCrossings?: number): RenderStrategy {
    return {
        id: `pt-${directLighting}`,
        measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 4, ...(maxNullCrossings !== undefined ? { maxNullCrossings } : {}) },
        estimator: { directLighting, russianRoulette: null, volumeSampling: 'delta-tracking', accumulation: { type: 'average' } },
        view: { tonemap: { type: 'reinhard' } },
    };
}

const absorbing: MediumDescription = { sigma_a: [0.5, 0.5, 0.5] };
const exprFog = (majorant: number): MediumDescription => ({ sigma_s: { kind: 'glsl', source: '0.5 * exp(-p.y)' }, majorant });

function fragmentOf(scene: SceneDescription, strat: RenderStrategy): string {
    const renderer = new Compiler().compile(scene, strat);
    const main = [...renderer.shaders.entries()].find(([id]) => id.endsWith('-main'));
    return main![1].fragment;
}

const compileWarnings = (scene: SceneDescription): string[] =>
    new Compiler().compileScene(scene, [strategy('nee')]).warnings;

describe('measurement.maxNullCrossings', () => {
    it('defaults to 32 and reaches the walk as MAX_NULL_CROSSINGS', () => {
        expect(DEFAULT_MAX_NULL_CROSSINGS).toBe(32);
        expect(fragmentOf(fogScene(absorbing, { halfSize: 1 }), strategy('nee'))).toMatch(/#define MAX_NULL_CROSSINGS 32\b/);
        expect(fragmentOf(fogScene(absorbing, { halfSize: 1 }), strategy('nee', 5))).toMatch(/#define MAX_NULL_CROSSINGS 5\b/);
    });

    it('shadow rays spend the path\'s remaining budget — no separate segment limit', () => {
        const frag = fragmentOf(fogScene(absorbing, { halfSize: 1 }), strategy('nee'));
        expect(frag).not.toMatch(/MAX_SHADOW_SEGMENTS/);
        expect(frag).toMatch(/return MAX_NULL_CROSSINGS - s\.null_crossings;/);
        expect(frag).toMatch(/shadow_transmittance\(shadow_ray, light_p, shadow_crossings_left\(s\)\)/);
    });

    it('without null interfaces the budget is 0 and the walk keeps no counter', () => {
        const scene: SceneDescription = {
            id: 'no-media', ambientSpace: { type: 'euclidean' },
            objects: [{ type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor' }],
            materials: { floor: { model: 'lambert', albedo: 0.5 } },
            lights: [{ kind: 'point', position: [0, 4, 0], emission: 10 }],
        };
        const frag = fragmentOf(scene, strategy('nee'));
        expect(frag).not.toMatch(/MAX_NULL_CROSSINGS/);
        expect(frag).toMatch(/int shadow_crossings_left\(PathState s\) \{\s*return 0;/);
    });
});

describe('tracking loop bound (tracking_cap, delta_tracking.glsl)', () => {
    const glsl = readFileSync(join(__dirname, '../../src/components/transport/volume/delta_tracking/delta_tracking.glsl'), 'utf8');
    const define = (name: string): number => {
        const m = glsl.match(new RegExp(`#define\\s+${name}\\s+([0-9.eE+-]+)`));
        if (!m) throw new Error(`${name} not found`);
        return Number(m[1]);
    };
    const A = define('TRACKING_CAP_SIGMAS');
    const B = define('TRACKING_CAP_SLACK');
    const cap = (lambda: number): number => Math.ceil(lambda + A * Math.sqrt(lambda) + B);

    /** log P(N ≥ c) for N ~ Poisson(λ), summed upward in log space. */
    function logTail(lambda: number, c: number): number {
        if (lambda === 0) return c <= 0 ? 0 : -Infinity;
        let lp = -lambda + c * Math.log(lambda) - lgamma(c + 1);
        let total = lp;
        for (let k = c + 1; ; k++) {
            lp += Math.log(lambda) - Math.log(k);
            if (lp < total - 40) break;
            total = Math.max(total, lp) + Math.log1p(Math.exp(-Math.abs(total - lp)));
        }
        return total;
    }
    /** ln Γ(x), Lanczos (g = 7) — accurate far beyond what a 1e-10 threshold needs. */
    function lgamma(x: number): number {
        const g = 7;
        const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
            -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
        x -= 1;
        let a = c[0];
        const t = x + g + 0.5;
        for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
        return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
    }

    it('a walk runs out with probability below 1e-10 for every mean collision count λ', () => {
        // A walk over a segment with N ~ Poisson(λ) tentative collisions needs N + 1 iterations,
        // so it runs out iff N ≥ cap. The tail is worst as λ → ∞ (the normal 6.5σ tail, 4e-11).
        const lambdas = [0.001, 0.1, 0.5, 1, 2, 5, 10, 30, 100, 300, 1e3, 4.2e3, 8.2e3, 3e4, 1e5, 1e6];
        for (const lambda of lambdas) {
            expect(logTail(lambda, cap(lambda)) / Math.LN10).toBeLessThan(-10);
        }
    });

    it('the generated trackers bound each loop by its own segment, and nothing warns', () => {
        const scene = fogScene(exprFog(8.2), 'ambient');   // a fog to the far clip: λ up to 8200
        const frag = fragmentOf(scene, strategy('nee'));
        expect(frag).not.toMatch(/MAX_NULL_COLLISIONS/);
        expect(frag).toMatch(/int cap = tracking_cap\(sigma_bar \* t_max\);/);
        expect(frag).toMatch(/int cap = tracking_cap\(sigma_bar \* len\);/);
        expect(compileWarnings(scene)).toEqual([]);
    });
});
