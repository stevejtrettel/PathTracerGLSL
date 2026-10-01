import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { planRenderers } from '../../src/compiler/plan/Planner.js';
import { generate } from '../../src/compiler/generate/Generator.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import type { AccumulationDescription, CompiledRenderer } from '../../src/compiler/types.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';

// The planned picture list (docs/claude-outputs-accumulation.md §1–§3) generates the layout,
// outputs, previous-frame inputs, sampler declarations, exports, display input and LDR recipe.
// Each configuration states, as data, what that generation must produce.

const strategyWith = (accumulation: AccumulationDescription) =>
    ({ ...minimalStrategy, estimator: { ...minimalStrategy.estimator, accumulation } });

const cases = [
    {
        label: 'average',
        accumulation: { type: 'average' },
        format: 'rgba32f',
        output: 'accumulation_current',
        previous: { u_previous: 'accumulation_previous' },
        outputs: ['out vec4 fragColor;'],
        exports: { radiance: { bufferId: 'accumulation_previous', format: 'float' } },
    },
    {
        label: 'average + variance',
        accumulation: { type: 'average', variance: true },
        format: ['rgba32f', 'rgba32f'],
        output: ['accumulation_current:0', 'accumulation_current:1'],
        previous: { u_previous: 'accumulation_previous', u_previousMoment: 'accumulation_previous:1' },
        outputs: ['layout(location = 0) out vec4 fragColor;', 'layout(location = 1) out vec4 fragMoment;'],
        exports: {
            radiance: { bufferId: 'accumulation_previous', format: 'float' },
            variance: { bufferId: 'accumulation_previous', format: 'float', attachment: 1 },
        },
    },
    {
        label: 'oneshot (reads no history)',
        accumulation: { type: 'oneshot' },
        format: 'rgba32f',
        output: 'accumulation_current',
        previous: {},
        outputs: ['out vec4 fragColor;'],
        exports: { radiance: { bufferId: 'accumulation_previous', format: 'float' } },
    },
] as const;

describe('the planned picture list generates the pipeline', () => {
    for (const c of cases) {
        describe(c.label, () => {
            const r: CompiledRenderer = new Compiler().compile(minimalScene, strategyWith(c.accumulation as AccumulationDescription));
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
                for (const name of ['u_previous', 'u_previousMoment']) {
                    if (!(name in c.previous)) expect(mainShader).not.toContain(`uniform sampler2D ${name};`);
                }
            });

            it('declares the fragment outputs from the list', () => {
                for (const line of c.outputs) expect(mainShader).toContain(line);
                expect(mainShader.match(/\bout vec4 /g)).toHaveLength(c.outputs.length);
            });

            it('exports each picture after the frame, then the LDR output', () => {
                expect(Object.keys(r.exportTargets!)).toEqual([...Object.keys(c.exports), 'ldr']);
                for (const [name, target] of Object.entries(c.exports)) expect(r.exportTargets![name]).toEqual(target);
            });

            it('shows the main picture during the frame and re-aims the LDR recipe after it', () => {
                expect(display.inputs?.textures?.u_radiance).toBe('accumulation_current');
                expect(r.ldrRecipe).toEqual({ passId: 'display-pass', inputs: { u_radiance: 'accumulation_previous' }, output: 'ldr' });
            });
        });
    }
});

describe('the WebGL2 draw-buffer floor', () => {
    it('rejects more than 4 pictures at compile time', () => {
        // No strategy can request five pictures yet, so the planned list is extended by hand.
        const features = analyze(minimalScene);
        const { plans } = planRenderers(features, minimalScene, [minimalStrategy], new DiagnosticBag('compiler'));
        const plan = plans[0];
        const extra = ['a', 'b', 'c', 'd'].map((name, i) => ({ name, output: `frag_${name}`, previous: null, attachment: i + 1 }));
        const bag = new DiagnosticBag('compiler');
        generate({ ...plan, pipeline: { ...plan.pipeline, pictures: [...plan.pipeline.pictures, ...extra] } }, minimalScene, minimalStrategy, bag);
        expect(bag.getErrors().some((e) => /5 pictures.*4 draw buffers/.test(e.message))).toBe(true);
    });
});
