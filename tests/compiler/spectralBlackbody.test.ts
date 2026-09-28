import { describe, expect, it } from 'vitest';
import { packLightTable, lightTableLayout } from '../../src/components/lights/table.js';
import { Compiler } from '../../src/compiler/Compiler.js';
import { blackbodyColor, planckShape } from '../../src/components/color/spectra/blackbody/blackbody.js';
import { blackbodyFixture, blackbodySites } from '../helpers/blackbodyFixtures.js';
import { planckReference } from '../helpers/planckReference.js';
import { minimalStrategy } from '../witnesses/scenes/minimalScene.js';
import { glslangCheck } from '../helpers/glslangCheck.js';
import { compiledJson } from '../helpers/compiledJson.js';
import type { RenderStrategy } from '../../src/compiler/types.js';

const compiler = new Compiler();
function strategy(color: 'rgb' | 'spectral', lightSelection: 'power' | 'bvh'): RenderStrategy {
    return { ...minimalStrategy, id: `${color}-${lightSelection}`,
        measurement: { ...minimalStrategy.measurement, color },
        estimator: { ...minimalStrategy.estimator, lightSelection } };
}
describe('Planck definition', () => {
    for (const T of [1000, 1667, 2900, 6500, 6600, 12000, 25000, 40000]) {
        it(`matches independent SI quadrature at ${T} K`, () => {
            const reference = planckReference(T);
            const color = blackbodyColor(T);
            color.rgb.forEach((v, c) => expect(v).toBeCloseTo(reference.rgb[c], 8));
            // Relative error: red-tail amplitudes exceed 200 at 1000 K and unit Y.
            for (const lambda of [360, 410, 555, 660, 830]) {
                const value = color.normalization * planckShape(lambda, T);
                expect(Math.abs(value / reference.spectrum(lambda) - 1)).toBeLessThan(1e-9);
            }
        });
    }
});
describe('blackbody renderer bindings', () => {
    for (const site of blackbodySites) for (const color of ['rgb', 'spectral'] as const) {
        for (const selection of ['power', 'bvh'] as const) {
            it(`${site}, ${color}, ${selection}`, () => {
                const scene = blackbodyFixture(site, { blackbody: { kelvin: 1000, scale: 2 } });
                for (const [id, shader] of compiler.compile(scene, strategy(color, selection)).shaders)
                    glslangCheck(shader.fragment, 'frag', id);
            });
        }
    }
    for (const site of blackbodySites) it(`preserves mixed-renderer shared data: ${site}`, () => {
        const scene = blackbodyFixture(site, { blackbody: { kelvin: 3200, scale: 2 } });
        const choices = [strategy('rgb', 'bvh'), strategy('spectral', 'bvh')];
        const a = compiler.compileScene(scene, choices), b = compiler.compileScene(scene, [...choices].reverse());
        expect(compiledJson(a.sceneData)).toBe(compiledJson(b.sceneData));
        for (const renderer of a.renderers)
            expect(compiledJson(renderer)).toBe(compiledJson(b.renderers.find(r => r.id === renderer.id)));
        for (const choice of choices)
            expect(compiledJson(compiler.compileScene(scene, [choice]).sceneData)).toBe(compiledJson(a.sceneData));
    });
    for (const value of [500, 40001, NaN, { param: 'k', default: 3000, min: 900 }, { param: 'k', default: 3000, max: 50000 }]) {
        it(`rejects out-of-domain temperature ${JSON.stringify(value)}`, () => {
            const scene = blackbodyFixture('quad', { blackbody: { kelvin: value } });
            expect(() => compiler.compile(scene, strategy('spectral', 'power'))).toThrow(/kelvin/);
        });
    }
    for (const color of ['rgb', 'spectral'] as const) it(`shares temperature without merging intensity: ${color}`, () => {
        const scene = blackbodyFixture('point', { blackbody: { kelvin: { param: 'lamp.kelvin', default: 3200 }, scale: 4 } });
        scene.materials.lamp.emission = { blackbody: { kelvin: { param: 'lamp.kelvin', default: 3200 }, scale: 1 } };
        const renderer = compiler.compile(scene, strategy(color, 'power'));
        const bindings = renderer.uniforms.filter(u => u.uniform === 'u_lamp_kelvin_blackbody');
        expect(bindings).toHaveLength(1);
        expect(bindings[0].parameters).toEqual(['lamp.kelvin']);
        const source = [...renderer.shaders.values()].find(s => s.fragment.includes('transport_trace'))!.fragment;
        expect(source).toContain('(4.0 * ');
        expect(source).toContain('(1.0 * ');
    });
});

it('packs the Planck tag and parameters beside unchanged RGB payloads', () => {
    const values = { position: [1, 2, 3], intensity: [4, 5, 6] };
    const lights = [
        { kind: 'point', values },
        { kind: 'point', values, emission: { blackbody: { kelvin: 1000, scale: 2 } } },
        { kind: 'point', values, emission: { blackbody: { kelvin: 12000, scale: 3 } } },
    ];
    const table = packLightTable(lights, lightTableLayout(['point']));
    // Point: one header + two payload texels, 12 floats per row.
    expect(Array.from(table.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(table.slice(12, 15))).toEqual([0, 1, 1000]);
    expect(Array.from(table.slice(24, 27))).toEqual([0, 1, 12000]);
    for (const [row, T, scale] of [[1, 1000, 2], [2, 12000, 3]]) {
        // The relative spectrum is one at 550 nm: the stored gain equals E(550).
        expect(table[row * 12 + 3]).toBeCloseTo(planckReference(T, scale).spectrum(550), 6);
        expect(Array.from(table.slice(row * 12 + 4, row * 12 + 10))).toEqual([1, 2, 3, 4, 5, 6]);
    }
});
