import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { resolveMeasurement } from '../../src/compiler/plan/measurement.js';
import { MATERIAL_MODELS } from '../../src/components/materials/index.js';
import { AOVS } from '../../src/components/aov/index.js';
import type { RenderStrategy } from '../../src/compiler/types.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';

// The first-hit pictures (components/aov; docs/claude-outputs-step6-plan.md §2): their linkage,
// the walk's single capture site, and the material albedo facts behind the albedo guide.

const withAovs = (aovs: string[], measurement: Partial<RenderStrategy['measurement']> = {}): RenderStrategy =>
    ({ ...minimalStrategy, measurement: { ...minimalStrategy.measurement, ...measurement, aovs } });
const fragmentOf = (strategy: RenderStrategy) => {
    const r = new Compiler().compile(minimalScene, strategy);
    return r.shaders.get(`${r.id}-main`)!.fragment;
};
const walkOf = (fragment: string) => fragment.slice(fragment.indexOf('Radiance transport_trace(Ray ray') + 1);

describe('the AOV capture in the walk', () => {
    it('exists only when AOVs are listed, with one out parameter each', () => {
        const none = fragmentOf(minimalStrategy);
        expect(none).toContain('Radiance transport_trace(Ray ray) {');
        expect(none).not.toMatch(/_aov\(/);
        const both = fragmentOf(withAovs(['albedo', 'normal']));
        expect(both).toContain('Radiance transport_trace(Ray ray, out vec3 aov_albedo, out vec3 aov_normal) {');
        expect(both).toContain('Radiance L = transport_trace(ray, albedo_sample, normal_sample);');
    });

    it('captures once, at bounce 0, with the path throughput, before the bounce-budget break', () => {
        for (const maxBounces of [0, 3]) {
            const walk = walkOf(fragmentOf(withAovs(['albedo', 'normal'], { maxBounces })));
            const capture = walk.indexOf('if (bounce == 0) {');
            expect(capture).toBeGreaterThan(walk.indexOf('Direction wo = -s.ray.direction;'));
            expect(capture).toBeLessThan(walk.indexOf(`if (bounce == ${maxBounces}) break;   // budget reached`));
            expect(walk.match(/aov_albedo = albedo_aov\(mat, hit, wo, props, s\.throughput\);/g)).toHaveLength(1);
            expect(walk.match(/aov_normal = normal_aov\(mat, hit, wo, props, s\.throughput\);/g)).toHaveLength(1);
            // Initialized to 0 on entry: a miss or an early event leaves the sample at 0.
            expect(walk.indexOf('aov_albedo = vec3(0.0);')).toBeLessThan(walk.indexOf('PathState s = path_state_init(ray);'));
        }
    });
});

describe('the albedo facts', () => {
    for (const [id, entry] of Object.entries(MATERIAL_MODELS)) {
        it(`${id}: its albedo fact names one of its Spectrum rows or a function its GLSL defines`, () => {
            const model = entry!;
            const fact = model.albedo;
            if ('row' in fact) {
                expect(model.properties.find((r) => r.name === fact.row)?.glslType).toBe('Spectrum');
            } else {
                expect(model.glsl).toMatch(new RegExp(`Spectrum ${fact.fn}\\(Hit \\w+, MaterialProperties \\w+\\)`));
            }
        });
    }

    it('the material_albedo dispatch exists only where an AOV requires it', () => {
        expect(fragmentOf(minimalStrategy)).not.toContain('material_albedo');
        expect(fragmentOf(withAovs(['normal']))).not.toContain('material_albedo');
        expect(fragmentOf(withAovs(['albedo']))).toContain('Spectrum material_albedo(int mat, Hit hit, MaterialProperties mp) {');
    });
});

describe('the AOV registry and the measurement', () => {
    it('every AOV file defines its function with the one shared signature', () => {
        for (const a of Object.values(AOVS)) {
            expect(a.glsl).toContain(`vec3 ${a.name}_aov(int mat, Hit hit, Direction wo, MaterialProperties props, Spectrum weight) {`);
        }
    });

    it('the resolved measurement (and so every stamp) omits aovs unless some are listed', () => {
        expect('aovs' in resolveMeasurement(minimalScene, minimalStrategy)).toBe(false);
        expect('aovs' in resolveMeasurement(minimalScene, withAovs([]))).toBe(false);
        expect(resolveMeasurement(minimalScene, withAovs(['normal', 'albedo'])).aovs).toEqual(['normal', 'albedo']);
    });
});
