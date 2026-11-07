import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { planRenderers } from '../../src/compiler/plan/Planner.js';
import { generate } from '../../src/compiler/generate/Generator.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import { validateCompiledRenderer } from '../../src/errors/compiler/validation.js';
import type { AccumulationDescription, CompiledRenderer } from '../../src/compiler/types.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';

// The planned picture list (docs/claude-outputs-accumulation.md §1–§3) generates the layout,
// outputs, previous-frame inputs, sampler declarations, exports, display input and LDR recipe.
// Each configuration states, as data, what that generation must produce.

const strategyWith = (accumulation: AccumulationDescription, aovs: readonly string[] = []) => ({
    ...minimalStrategy,
    measurement: { ...minimalStrategy.measurement, ...(aovs.length > 0 ? { aovs: [...aovs] } : {}) },
    estimator: { ...minimalStrategy.estimator, accumulation },
});
const RADIANCE = { view: 'tonemap', formats: ['hdr', 'png'] } as const;
const ALBEDO = { view: 'unit', formats: ['hdr', 'png'] } as const;
const NORMAL = { view: 'signed', formats: ['png'] } as const;

const cases = [
    {
        label: 'average',
        accumulation: { type: 'average' },
        format: 'rgba32f',
        output: 'accumulation_current',
        previous: { u_previous: 'accumulation_previous' },
        outputs: ['out vec4 fragColor;'],
        calls: ['vec3 radiance_new = average_update(radiance_previous, color, u_sampleCount);'],
        exports: { radiance: { bufferId: 'accumulation_previous', format: 'float', picture: { view: 'tonemap', formats: ['hdr', 'png'] } } },
        display: { u_radiance: 'accumulation_current' },
        recipe: { u_radiance: 'accumulation_previous' },
    },
    {
        label: 'average + variance',
        accumulation: { type: 'average', variance: true },
        format: ['rgba32f', 'rgba32f'],
        output: ['accumulation_current:0', 'accumulation_current:1'],
        previous: { u_previous: 'accumulation_previous', u_previousMoment: 'accumulation_previous:1' },
        outputs: ['layout(location = 0) out vec4 fragColor;', 'layout(location = 1) out vec4 fragMoment;'],
        calls: [
            'vec3 radiance_new = average_update(radiance_previous, color, u_sampleCount);',
            'vec3 variance_new = variance_update(variance_previous, radiance_previous, radiance_new, color, u_sampleCount);',
        ],
        exports: {
            radiance: { bufferId: 'accumulation_previous', format: 'float', picture: { view: 'tonemap', formats: ['hdr', 'png'] } },
            variance: { bufferId: 'accumulation_previous', format: 'float', attachment: 1, picture: { view: 'tonemap', formats: ['hdr', 'png'] } },
        },
        display: { u_radiance: 'accumulation_current', u_variance: 'accumulation_current:1' },
        recipe: { u_radiance: 'accumulation_previous', u_variance: 'accumulation_previous:1' },
    },
    {
        label: 'oneshot (reads no history)',
        accumulation: { type: 'oneshot' },
        format: 'rgba32f',
        output: 'accumulation_current',
        previous: {},
        outputs: ['out vec4 fragColor;'],
        calls: ['vec3 radiance_new = oneshot_update(color);'],
        exports: { radiance: { bufferId: 'accumulation_previous', format: 'float', picture: { view: 'tonemap', formats: ['hdr', 'png'] } } },
        display: { u_radiance: 'accumulation_current' },
        recipe: { u_radiance: 'accumulation_previous' },
    },
    {
        label: 'average + albedo',
        accumulation: { type: 'average' },
        aovs: ['albedo'],
        format: ['rgba32f', 'rgba32f'],
        output: ['accumulation_current:0', 'accumulation_current:1'],
        previous: { u_previous: 'accumulation_previous', u_previousAlbedo: 'accumulation_previous:1' },
        outputs: ['layout(location = 0) out vec4 fragColor;', 'layout(location = 1) out vec4 fragAlbedo;'],
        calls: [
            'vec3 radiance_new = average_update(radiance_previous, color, u_sampleCount);',
            'vec3 albedo_new = average_update(albedo_previous, albedo_sample, u_sampleCount);',
        ],
        exports: {
            radiance: { bufferId: 'accumulation_previous', format: 'float', picture: RADIANCE },
            albedo: { bufferId: 'accumulation_previous', format: 'float', attachment: 1, picture: ALBEDO },
        },
        display: { u_radiance: 'accumulation_current', u_albedo: 'accumulation_current:1' },
        recipe: { u_radiance: 'accumulation_previous', u_albedo: 'accumulation_previous:1' },
    },
    {
        label: 'oneshot + normal',
        accumulation: { type: 'oneshot' },
        aovs: ['normal'],
        format: ['rgba32f', 'rgba32f'],
        output: ['accumulation_current:0', 'accumulation_current:1'],
        previous: {},
        outputs: ['layout(location = 0) out vec4 fragColor;', 'layout(location = 1) out vec4 fragNormal;'],
        calls: ['vec3 radiance_new = oneshot_update(color);', 'vec3 normal_new = oneshot_update(normal_sample);'],
        exports: {
            radiance: { bufferId: 'accumulation_previous', format: 'float', picture: RADIANCE },
            normal: { bufferId: 'accumulation_previous', format: 'float', attachment: 1, picture: NORMAL },
        },
        display: { u_radiance: 'accumulation_current', u_normal: 'accumulation_current:1' },
        recipe: { u_radiance: 'accumulation_previous', u_normal: 'accumulation_previous:1' },
    },
    {
        label: 'average + variance + albedo + normal (all four attachments)',
        accumulation: { type: 'average', variance: true },
        aovs: ['albedo', 'normal'],
        format: ['rgba32f', 'rgba32f', 'rgba32f', 'rgba32f'],
        output: ['accumulation_current:0', 'accumulation_current:1', 'accumulation_current:2', 'accumulation_current:3'],
        previous: {
            u_previous: 'accumulation_previous', u_previousMoment: 'accumulation_previous:1',
            u_previousAlbedo: 'accumulation_previous:2', u_previousNormal: 'accumulation_previous:3',
        },
        outputs: [
            'layout(location = 0) out vec4 fragColor;', 'layout(location = 1) out vec4 fragMoment;',
            'layout(location = 2) out vec4 fragAlbedo;', 'layout(location = 3) out vec4 fragNormal;',
        ],
        calls: [
            'vec3 radiance_new = average_update(radiance_previous, color, u_sampleCount);',
            'vec3 variance_new = variance_update(variance_previous, radiance_previous, radiance_new, color, u_sampleCount);',
            'vec3 albedo_new = average_update(albedo_previous, albedo_sample, u_sampleCount);',
            'vec3 normal_new = average_update(normal_previous, normal_sample, u_sampleCount);',
        ],
        exports: {
            radiance: { bufferId: 'accumulation_previous', format: 'float', picture: RADIANCE },
            variance: { bufferId: 'accumulation_previous', format: 'float', attachment: 1, picture: RADIANCE },
            albedo: { bufferId: 'accumulation_previous', format: 'float', attachment: 2, picture: ALBEDO },
            normal: { bufferId: 'accumulation_previous', format: 'float', attachment: 3, picture: NORMAL },
        },
        display: {
            u_radiance: 'accumulation_current', u_variance: 'accumulation_current:1',
            u_albedo: 'accumulation_current:2', u_normal: 'accumulation_current:3',
        },
        recipe: {
            u_radiance: 'accumulation_previous', u_variance: 'accumulation_previous:1',
            u_albedo: 'accumulation_previous:2', u_normal: 'accumulation_previous:3',
        },
    },
] as const;

describe('the planned picture list generates the pipeline', () => {
    for (const c of cases) {
        describe(c.label, () => {
            const r: CompiledRenderer = new Compiler().compile(minimalScene, strategyWith(c.accumulation as AccumulationDescription, 'aovs' in c ? c.aovs : []));
            const main = r.pipeline.passes.find((p) => p.id === 'pathtracer-pass')!;
            const display = r.pipeline.passes.find((p) => p.id === 'display-pass')!;
            const mainShader = r.shaders.get(`${r.id}-main`)!.fragment;

            it('lays out one attachment per picture and writes them in list order', () => {
                expect(r.pipeline.framebuffers.find((fb) => fb.id === 'accumulation')!.format).toEqual(c.format);
                expect(main.output).toEqual(c.output);
            });

            it('binds and declares each previous-frame sampler exactly when the mode reads history', () => {
                const bound = Object.fromEntries(Object.entries(main.inputs?.textures ?? {}).filter(([, ref]) => !ref.startsWith('extern:')));
                expect(bound).toEqual(c.previous);
                for (const name of Object.keys(c.previous)) expect(mainShader).toContain(`uniform sampler2D ${name};`);
                for (const name of ['u_previous', 'u_previousMoment', 'u_previousAlbedo', 'u_previousNormal']) {
                    if (!(name in c.previous)) expect(mainShader).not.toContain(`uniform sampler2D ${name};`);
                }
            });

            it('declares the fragment outputs from the list', () => {
                for (const line of c.outputs) expect(mainShader).toContain(line);
                expect(mainShader.match(/\bout vec4 /g)).toHaveLength(c.outputs.length);
            });

            it('generates one main() that updates and writes each picture by its rule', () => {
                const mainFn = mainShader.slice(mainShader.lastIndexOf('void main()'));
                expect(mainShader.match(/void main\(\)/g)).toHaveLength(1);
                for (const call of c.calls) expect(mainFn).toContain(call);
                expect(mainFn.match(/_update\(/g)).toHaveLength(c.calls.length);
                for (const line of c.outputs) {
                    const output = line.match(/out vec4 (\w+);/)![1];
                    expect(mainFn.match(new RegExp(`\\b${output} = vec4\\(`, 'g'))).toHaveLength(1);
                }
            });

            it('exports each picture after the frame, then the LDR output', () => {
                expect(Object.keys(r.exportTargets!)).toEqual([...Object.keys(c.exports), 'ldr']);
                for (const [name, target] of Object.entries(c.exports)) expect(r.exportTargets![name]).toEqual(target);
            });

            it('binds every picture to the display during the frame, and re-aims each after it in the view recipe', () => {
                const bound = Object.fromEntries(Object.entries(display.inputs?.textures ?? {}).filter(([, ref]) => !ref.startsWith('extern:')));
                expect(bound).toEqual(c.display);
                expect(r.ldrRecipe).toEqual({ passId: 'display-pass', inputs: c.recipe, output: 'ldr' });
            });

            it('chooses the displayed picture by u_picture only when there is more than one', () => {
                const displayShader = r.shaders.get(`${r.id}-display`)!.fragment;
                const many = Object.keys(c.display).length > 1;
                for (const sampler of Object.keys(c.display)) expect(displayShader).toContain(`uniform sampler2D ${sampler};`);
                expect(displayShader.includes('uniform int u_picture;')).toBe(many);
                expect(r.uniforms.some((u) => u.uniform === 'u_picture' && u.parameters.includes('renderer.picture'))).toBe(many);
            });

            it('shows each picture through its own view; data views only where a picture needs one', () => {
                const displayShader = r.shaders.get(`${r.id}-display`)!.fragment;
                const views: Record<string, string> = { tonemap: 'view_tonemap', unit: 'view_unit', signed: 'view_signed' };
                const dataViews = Object.values(c.exports).some((e) => e.picture.view !== 'tonemap');
                expect(displayShader.includes('vec3 view_unit(vec3 x)')).toBe(dataViews);
                if (!dataViews) return;   // the tonemap-only display is today's shader (checked above)
                for (const [name, e] of Object.entries(c.exports)) {
                    const sampler = `u_${name}`;
                    expect(displayShader).toContain(`color = ${views[e.picture.view]}(texture(${sampler}, uv).rgb);`);
                }
            });

            it('passes the compiled-renderer validation', () => {
                expect(validateCompiledRenderer(r).hasErrors()).toBe(false);
            });
        });
    }
});

describe('the WebGL2 draw-buffer floor', () => {
    it('rejects more than 4 pictures at compile time', () => {
        // No strategy can request five pictures yet, so the planned list is extended by hand.
        const features = analyze(minimalScene);
        const { plans } = planRenderers(features, minimalScene, [minimalStrategy], new DiagnosticBag('compiler'), []);
        const plan = plans[0];
        const extra = ['a', 'b', 'c', 'd'].map((name, i) => ({ name, output: `frag_${name}`, previous: null, attachment: i + 1, role: 'statistic' as const, update: 'unused', display: `u_${name}`, view: 'tonemap' as const, formats: [] }));
        const bag = new DiagnosticBag('compiler');
        generate({ ...plan, pipeline: { ...plan.pipeline, pictures: [...plan.pipeline.pictures, ...extra] } }, minimalScene, minimalStrategy, bag);
        expect(bag.getErrors().some((e) => /5 pictures.*4 draw buffers/.test(e.message))).toBe(true);
    });
});
