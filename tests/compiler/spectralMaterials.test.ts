import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import type { SpectrumProperty } from '../../src/compiler/types.js';
import { MATERIAL_MODELS } from '../../src/components/materials/index.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';
import { spectralMaterials, spectralMaterialStrategies } from '../witnesses/scenes/spectralMaterials.js';
import { compiledJson } from '../helpers/compiledJson.js';
import { glslangCheck } from '../helpers/glslangCheck.js';

const compiler = new Compiler();
const strategy = { ...minimalStrategy, measurement: { ...minimalStrategy.measurement, color: 'spectral' as const } };

describe('spectral surface materials', () => {
    for (const [model, descriptor] of Object.entries(MATERIAL_MODELS)) {
        it(`compiles ${model} alone with its defaults`, () => {
            const scene = structuredClone(minimalScene);
            scene.materials = { sphere: { model }, ground: { model } };
            for (const [id, shader] of compiler.compile(scene, strategy).shaders)
                glslangCheck(shader.fragment, 'frag', id);
        });
        for (const row of descriptor!.properties) {
            if (row.semantic !== 'radiometric') continue;
            it(`validates ${model}.${row.source} through its declared role`, () => {
                const scene = structuredClone(minimalScene);
                scene.materials.sphere = { model };
                const material = scene.materials.sphere;
                const valid: SpectrumProperty[] = [0, [0.1, 0.4, 0.8], { param: 'color', default: [0.2, 0.5, 0.8], min: 0, max: 1 }];
                for (const value of valid) {
                    material[row.source] = value;
                    expect(() => compiler.compile(scene, strategy)).not.toThrow();
                }
                const invalid: SpectrumProperty[] = [-0.1, [0, NaN, 0], { param: 'color', default: 0.5, min: -1 },
                    { kind: 'glsl', source: 'vec3(0.5)' }, { blackbody: { kelvin: 3000 } },
                    ...(row.role === 'reflectance' ? [1.1, { param: 'color', default: 0.5, max: 2 }] : [])];
                for (const value of invalid) {
                    material[row.source] = value;
                    expect(() => compiler.compile(scene, strategy), `${model}.${row.source}: ${JSON.stringify(value)}`).toThrow();
                }
            });
        }
    }
    for (const wavelengths of ['uniform', 'visible'] as const) {
        it(`compiles all surface models together with ${wavelengths} sampling`, () => {
            for (const base of spectralMaterialStrategies) {
                const compiled = compiler.compile(spectralMaterials, { ...base, estimator: { ...base.estimator, wavelengths } });
                for (const [id, shader] of compiled.shaders) glslangCheck(shader.fragment, 'frag', id);
            }
        });
    }
    it('preserves mixed RGB/spectral renderer order and shared data', () => {
        const spectral = spectralMaterialStrategies[0];
        const rgb = { ...spectral, id: 'rgb', measurement: { ...spectral.measurement, color: 'rgb' as const },
            estimator: { ...spectral.estimator, wavelengths: undefined } };
        const forward = compiler.compileScene(spectralMaterials, [rgb, spectral]);
        const reversed = compiler.compileScene(spectralMaterials, [spectral, rgb]);
        expect(compiledJson(forward.sceneData)).toBe(compiledJson(reversed.sceneData));
        for (const r of forward.renderers) expect(compiledJson(r)).toBe(compiledJson(reversed.renderers.find(v => v.id === r.id)));
    });
    it('keeps emissive media gated even on an admitted glass surface', () => {
        const scene = structuredClone(spectralMaterials);
        scene.materials.glass.medium = { sigma_a: 0.1, emission: 0.2 };
        expect(() => compiler.compile(scene, spectralMaterialStrategies[0])).toThrow(/spectral medium/);
    });
});
