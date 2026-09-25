// Declared path budgets in media: measurement.maxNullCrossings (one budget for the whole path,
// its shadow rays included) and the tracking arms' collision cap with the Planner's warning.
// The GPU gate for the crossing budget is the null-budget witness; these check the plumbing.

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { DEFAULT_MAX_NULL_CROSSINGS } from '../../src/compiler/plan/measurement.js';
import { MAX_NULL_COLLISIONS } from '../../src/compiler/plan/trackingBudget.js';
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

const budgetWarnings = (scene: SceneDescription): string[] =>
    new Compiler().compileScene(scene, [strategy('nee')]).warnings.filter((w) => w.includes('collision cap'));

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

describe('collision-cap warning (trackingBudget.ts)', () => {
    it('is quiet for a small expression fog box', () => {
        // σ̄·diagonal = 2 · 2√3 ≈ 7 ≪ cap/2
        expect(budgetWarnings(fogScene(exprFog(2), { halfSize: 1 }))).toEqual([]);
    });

    it('warns when σ̄ × the region\'s diagonal passes half the cap', () => {
        // halfSize 100 → diagonal 200√3 ≈ 346; σ̄ = 2 → ≈ 693 > 512
        const w = budgetWarnings(fogScene(exprFog(2), { halfSize: 100 }));
        expect(w).toHaveLength(1);
        expect(w[0]).toMatch(/Lower medium\.majorant/);
        expect(MAX_NULL_COLLISIONS / 2).toBeLessThan(2 * 200 * Math.sqrt(3));
    });

    it('warns for an ambient expression fog, recommending a bounded region', () => {
        const w = budgetWarnings(fogScene(exprFog(2), 'ambient'));   // 2 · 1000 > 512
        expect(w).toHaveLength(1);
        expect(w[0]).toMatch(/Enclose the fog in a bounded region/);
    });

    it('is quiet for an ambient expression fog inside a closed room of axis-aligned walls', () => {
        // A 4 × 3 × 6 room: the longest segment is its diagonal ≈ 7.8, so σ̄ = 8 gives ≈ 62.
        const walls: Array<[[number, number, number], number]> = [
            [[0, 1, 0], 0], [[0, -1, 0], 3], [[1, 0, 0], 2], [[-1, 0, 0], 2], [[0, 0, 1], 3], [[0, 0, -1], 3],
        ];
        const room: SceneDescription = {
            ...fogScene(exprFog(8), 'ambient'),
            objects: walls.map(([normal, offset]) => ({ type: 'plane', parameters: { normal, offset }, material: 'floor' })),
        };
        expect(budgetWarnings(room)).toEqual([]);
        // Open one side and the fog reaches the far clip again.
        const open: SceneDescription = { ...room, objects: room.objects.slice(0, 5) };
        expect(budgetWarnings(open)).toHaveLength(1);
    });

    it('is quiet for constant media: the derived σ̄ is σ_t, so no collision is null', () => {
        // A constant emissive scattering medium routes to tracking (the analytic arm has no
        // source term), but walks at σ̄ = σ_t and always stops at its first collision.
        const glow: MediumDescription = { sigma_a: [1, 1, 1], sigma_s: [2, 2, 2], emission: [1, 1, 1] };
        expect(budgetWarnings(fogScene(glow, 'ambient'))).toEqual([]);
    });
});
