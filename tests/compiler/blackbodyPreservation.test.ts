import { computeSelectPdf, envSelectionProbability } from '../../src/compiler/generate/features/lighting.js';
import { planScene, planRenderers } from '../../src/compiler/plan/Planner.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import { LIGHT_KINDS } from '../../src/components/lights/index.js';
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { blackbodyRGB } from '../../src/components/color/blackbody/blackbody.js';
import { minimalStrategy } from '../witnesses/scenes/minimalScene.js';
import { compiledJson } from '../helpers/compiledJson.js';
import { blackbodyFixture, blackbodySites } from '../helpers/blackbodyFixtures.js';

const compiler = new Compiler();
describe('blackbody forms survive planning', () => {
    for (const site of blackbodySites) {
        it(site, () => {
            const form = { blackbody: { kelvin: 3200, scale: 5 } };
            const scene = blackbodyFixture(site, form);
            const bag = new DiagnosticBag('test');
            const shared = planScene(scene, bag);
            expect(shared.materials.find(m => m.name === 'lamp')!.values.emission).toEqual(form);
            if (['surface', 'mesh', 'point', 'quad'].includes(site)) {
                const light = shared.lights.at(-1)!;
                const row = LIGHT_KINDS[light.kind].params.find(p => p.semantic === 'radiometric')!;
                expect(light.values[row.name]).toEqual(form);
            }
            const plan = planRenderers(analyze(scene), scene, [minimalStrategy], bag).plans[0];
            if (site === 'sky') expect(plan.program.environment).toMatchObject({ color: form });
            expect(plan.program.emitters.driven).toBe(false);
        });
    }
});

describe('blackbody shared data is independent of strategy order', () => {
    for (const site of ['surface', 'mesh', 'point', 'quad', 'batch'] as const) {
        it(site, () => {
            const scene = blackbodyFixture(site, { blackbody: { kelvin: 3200, scale: 5 } });
            const strategies = ['power', 'bvh'].map(lightSelection => ({
                ...minimalStrategy, id: lightSelection,
                estimator: { ...minimalStrategy.estimator, lightSelection: lightSelection as 'power' | 'bvh' },
            }));
            const forward = compiler.compileScene(scene, strategies);
            const backward = compiler.compileScene(scene, [...strategies].reverse());
            expect(compiledJson(forward.sceneData)).toBe(compiledJson(backward.sceneData));
            for (const renderer of forward.renderers) {
                expect(compiledJson(backward.renderers.find(r => r.id === renderer.id))).toBe(compiledJson(renderer));
            }
        });
    }
});

describe('driven blackbody bindings and selection update together', () => {
    for (const site of ['point', 'quad', 'sky'] as const) {
        it(site, () => {
            const form = { blackbody: {
                kelvin: { param: 'lamp.kelvin', default: 3200 },
                scale: { param: 'lamp.scale', default: 5 },
            } };
            const scene = blackbodyFixture(site, form);
            const renderer = compiler.compile(scene, minimalStrategy);
            const rgb = renderer.uniforms.find(u => u.uniform === 'u_lamp_kelvin_blackbody')!;
            expect(rgb.compute({})).toEqual(blackbodyRGB(3200));
            for (const [kelvin, scale] of [[6500, 2], [2100, 0], [10000, 8]]) {
                const params = { 'lamp.kelvin': kelvin, 'lamp.scale': scale };
                expect(rgb.compute!(params)).toEqual(blackbodyRGB(kelvin));
                expect(renderer.uniforms.find(u => u.uniform === 'u_lamp_scale')!.parameters).toEqual(['lamp.scale']);
                const constantScene = blackbodyFixture(site, blackbodyRGB(kelvin, scale));
                const plan = planRenderers(analyze(constantScene), constantScene, [minimalStrategy], new DiagnosticBag('test')).plans[0];
                const select = renderer.uniforms.find(u => u.uniform === 'u_light_selpdf');
                if (site !== 'sky') {
                    expect(select).toBeDefined();
                    expect(select!.compute!(params)).toEqual(computeSelectPdf(plan.lights, 'power'));
                } else {
                    const envSelect = renderer.uniforms.find(u => u.uniform === 'u_envSelectProb')!;
                    expect(envSelect.compute!(params)).toEqual(envSelectionProbability(plan));
                }
            }
        });
    }
});
