import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';
import { glslangCheck } from '../helpers/glslangCheck.js';
import { resolveMeasurement } from '../../src/compiler/plan/measurement.js';
import { compiledJson } from '../helpers/compiledJson.js';
import type { SceneDescription, RenderStrategy } from '../../src/compiler/types.js';

const compiler = new Compiler();
const strategy: RenderStrategy = { ...minimalStrategy, measurement: { ...minimalStrategy.measurement, color: 'spectral' } };
describe('spectral foundation', () => {
    it('shares authored data without making either renderer depend on colour-model order', () => {
        const rgb = { ...minimalStrategy, id: 'rgb' };
        const spectral = { ...strategy, id: 'spectral' };
        const forward = compiler.compileScene(minimalScene, [rgb, spectral]);
        const reversed = compiler.compileScene(minimalScene, [spectral, rgb]);
        expect(compiledJson(forward.sceneData)).toBe(compiledJson(reversed.sceneData));
        for (const choice of [rgb, spectral]) {
            const single = compiler.compileScene(minimalScene, [choice]);
            const renderer = single.renderers[0];
            expect(compiledJson(forward.renderers.find(r => r.id === renderer.id))).toBe(compiledJson(renderer));
            expect(compiledJson(reversed.renderers.find(r => r.id === renderer.id))).toBe(compiledJson(renderer));
            expect(compiledJson(single.sceneData)).toBe(compiledJson(forward.sceneData));
        }
    });
    for (const wavelengths of ['uniform', 'visible'] as const) for (const directLighting of ['none', 'nee', 'mis'] as const) {
        it(`${wavelengths}, ${directLighting}`, () => {
            const renderer = compiler.compile(minimalScene, { ...strategy, estimator: { ...strategy.estimator, wavelengths, directLighting } });
            for (const [id, shader] of renderer.shaders) glslangCheck(shader.fragment, 'frag', id);
            const refs = renderer.pipeline.passes.flatMap(p => Object.values(p.inputs?.textures ?? {}));
            expect(refs).toContain('extern:jh-cie1931-d65-v1-coefficients');
            expect(refs).toContain('extern:jh-cie1931-d65-v1-curves');
            expect(resolveMeasurement(minimalScene, strategy).sensor).toBe('cie1931');
        });
    }
    it('rejects incompatible sensor and RGB wavelength proposals', () => {
        expect(() => compiler.compile(minimalScene, { ...strategy, measurement: { ...strategy.measurement, sensor: 'ideal' } })).toThrow(/sensor/);
        expect(() => compiler.compile(minimalScene, { ...minimalStrategy, estimator: { ...minimalStrategy.estimator, wavelengths: 'visible' } })).toThrow(/wavelengths/);
    });
    const unsupported: Array<[string, (s: SceneDescription) => void]> = [
        ['emissive media', s => { s.materials.sphere.medium = { sigma_a: 0.1, emission: 0.2 }; }],
        ['blackbody', s => { s.lights[0].emission = { blackbody: { kelvin: 3000 } }; }],
        ['gain', s => { s.materials.sphere.albedo = 2; }],
        ['negative', s => { s.materials.sphere.albedo = [-0.1, 0, 0]; }],
    ];
    for (const [name, edit] of unsupported) it(`rejects ${name} until its spectral stage`, () => {
        const scene = structuredClone(minimalScene); edit(scene);
        expect(() => compiler.compile(scene, strategy)).toThrow();
    });
});
