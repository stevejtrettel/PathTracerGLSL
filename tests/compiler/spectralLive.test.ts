import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { planRenderers } from '../../src/compiler/plan/Planner.js';
import { computeSelectPdf, envSelectionProbability } from '../../src/compiler/generate/features/lighting.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import { compiledJson } from '../helpers/compiledJson.js';
import { glslangCheck } from '../helpers/glslangCheck.js';
import { liveDefaults, liveChanged, liveStrategies, spectralLiveAt, type LiveColours } from '../witnesses/scenes/spectralLive.js';
import type { SpectrumProperty } from '../../src/compiler/types.js';

const compiler = new Compiler();
const scene = spectralLiveAt(liveDefaults, true);
const strategy = liveStrategies[0];
const renderer = compiler.compile(scene, strategy);

describe('live spectral colours', () => {
    for (const wavelengths of ['uniform', 'visible'] as const) for (const base of liveStrategies) {
        it(`compiles ${base.id} / ${wavelengths}`, () => {
            const compiled = compiler.compile(scene, { ...base, estimator: { ...base.estimator, wavelengths } });
            for (const [id, shader] of compiled.shaders) glslangCheck(shader.fragment, 'frag', id);
        });
    }
    it('keeps authored RGB uniforms and broadcasts scalar live writes at every colour site', () => {
        for (const [path, value] of Object.entries(liveDefaults)) {
            const uniform = renderer.uniforms.find(u => u.uniform === `u_${path.replaceAll('.', '_')}`)!;
            expect(uniform.type).toBe('vec3');
            expect(uniform.compute({})).toEqual(typeof value === 'number' ? [value, value, value] : value);
            for (const live of [0, 1, [0.1, 0.4, 0.8]]) {
                expect(uniform.compute({ [path]: live })).toEqual(typeof live === 'number' ? [live, live, live] : live);
            }
        }
    });
    it('updates finite-light and sky selection weights like the equivalent constant scene', () => {
        const dark: LiveColours = { ...liveChanged, 'lamp.emission': 0, 'sky.color': 0 };
        const finite = renderer.uniforms.find(u => u.uniform === 'u_light_selpdf')!;
        const sky = renderer.uniforms.find(u => u.uniform === 'u_envSelectProb')!;
        expect(finite.compute(liveChanged)).not.toEqual(finite.compute(liveDefaults));
        expect(sky.compute(liveChanged)).not.toEqual(sky.compute(liveDefaults));
        for (const values of [liveDefaults, liveChanged, dark]) {
            const constant = spectralLiveAt(values);
            const plan = planRenderers(analyze(constant), constant, [strategy], new DiagnosticBag('test'), []).plans[0];
            expect(finite.compute(values)).toEqual(computeSelectPdf(plan.lights, 'power'));
            expect(sky.compute(values)).toEqual(envSelectionProbability(plan));
        }
    });
    it('remains independent of RGB/spectral renderer order', () => {
        const rgb = { ...strategy, id: 'rgb', measurement: { ...strategy.measurement, color: 'rgb' as const },
            estimator: { ...strategy.estimator, wavelengths: undefined } };
        const forward = compiler.compileScene(scene, [rgb, strategy]);
        const reversed = compiler.compileScene(scene, [strategy, rgb]);
        expect(compiledJson(forward.sceneData)).toBe(compiledJson(reversed.sceneData));
        for (const r of forward.renderers) expect(compiledJson(r)).toBe(compiledJson(reversed.renderers.find(v => v.id === r.id)));
    });
    const invalid: Array<[string, SpectrumProperty]> = [
        ['missing default', { param: 'surface.albedo' }],
        ['negative default', { param: 'surface.albedo', default: [-0.1, 0.2, 0.4] }],
        ['gain default', { param: 'surface.albedo', default: 1.1 }],
        ['negative minimum', { param: 'surface.albedo', default: 0.5, min: -1 }],
        ['gain maximum', { param: 'surface.albedo', default: 0.5, max: 2 }],
        ['reversed bounds', { param: 'surface.albedo', default: 0.5, min: 0.8, max: 0.2 }],
    ];
    for (const [name, value] of invalid) it(`rejects ${name}`, () => {
        const bad = structuredClone(scene); bad.materials.surface.albedo = value;
        expect(() => compiler.compile(bad, strategy)).toThrow(/albedo/);
    });
    it('checks bounds on emission and sky colour too', () => {
        for (const site of ['material', 'light', 'sky']) {
            const bad = structuredClone(scene);
            const value = { param: 'bad.color', default: 0.5, min: -1 };
            if (site === 'material') bad.materials.surface.emission = value;
            if (site === 'light') bad.lights[1].emission = value;
            if (site === 'sky' && bad.environment?.type === 'constant') bad.environment.color = value;
            expect(() => compiler.compile(bad, strategy)).toThrow(/parameter min components must be >= 0/);
        }
    });
    it('preserves the existing restriction against driven tree-light emission', () => {
        expect(() => compiler.compile(scene, { ...strategy, estimator: { ...strategy.estimator, lightSelection: 'bvh' } })).toThrow(/CONSTANT light emission/);
    });
});
