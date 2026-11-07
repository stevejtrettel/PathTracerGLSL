import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { planRenderers } from '../../src/compiler/plan/Planner.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import { cauchyIndex } from '../../src/components/color/spectra/cauchy/cauchy.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';
import { boxMesh } from '../witnesses/scenes/meshWitness.js';
import { glslangCheck } from '../helpers/glslangCheck.js';
import { compiledJson } from '../helpers/compiledJson.js';
import type { SceneDescription, RenderStrategy } from '../../src/compiler/types.js';
import { indexReferenceNM } from '../../src/components/color/values.js';
import { sellmeierIndex } from '../../src/components/color/spectra/sellmeier/sellmeier.js';
import { N_BK7, N_SF11 } from '../../src/authoring/opticalGlass.js';
const compiler = new Compiler();
const spectral: RenderStrategy = { ...minimalStrategy, measurement: { ...minimalStrategy.measurement, color: 'spectral' } };
const fixture = (): SceneDescription => ({ ...structuredClone(minimalScene), materials: {
    sphere: { model: 'dielectric', ior: { cauchy: [1.5, 0.01] } }, ground: { model: 'lambert', albedo: 0.5 },
} });
function program(scene: SceneDescription, strategy = spectral) {
    return planRenderers(analyze(scene), scene, [strategy], new DiagnosticBag(), []).plans[0].program;
}
describe('Cauchy authoring and dispersion planning', () => {
    it('uses micrometre coefficients and the fixed RGB d-line reference', () => {
        expect(cauchyIndex({ cauchy: [1.5, 0.01, 0.001] }, 500)).toBeCloseTo(1.556, 12);
        const scene = fixture();
        const ref = structuredClone(scene);
        ref.materials.sphere.ior = cauchyIndex({ cauchy: [1.5, 0.01] }, indexReferenceNM);
        expect(compiledJson(compiler.compile(scene, minimalStrategy))).toBe(compiledJson(compiler.compile(ref, minimalStrategy)));
    });
    it('zero dispersion is identical to a scalar index', () => {
        const scene = fixture(); scene.materials.sphere.ior = { cauchy: [1.5, 0, 0] };
        const ref = structuredClone(scene); ref.materials.sphere.ior = 1.5;
        expect(compiledJson(compiler.compile(scene, spectral))).toBe(compiledJson(compiler.compile(ref, spectral)));
    });
    for (const bad of [[0, 0.01], [1.5, -0.01], [1.5, 0, -0.001], [1.5], [1.5, Infinity], [1.5, 0, 0, 0]]) {
        it(`rejects invalid Cauchy coefficients ${bad}`, () => {
            const scene = fixture(); scene.materials.sphere.ior = { cauchy: bad } as never;
            expect(() => compiler.compile(scene, spectral)).toThrow(/Cauchy/);
        });
    }
    it('rejects Cauchy on a radiometric or spatial-index field', () => {
        const scene = fixture(); scene.materials.ground.albedo = { cauchy: [1.5, 0.01] } as never;
        expect(() => compiler.compile(scene, spectral)).toThrow(/index form/);
        delete scene.materials.ground.albedo;
        scene.materials.ground.medium = { ior: { cauchy: [1.5, 0.01] } as never };
        expect(() => compiler.compile(scene, spectral)).toThrow(/medium\.ior cannot be a Cauchy value/);
    });
    for (const model of ['dielectric', 'rough_dielectric']) for (const objectDispatch of ['unrolled', 'table'] as const) {
        it(`compiles ${model}, ${objectDispatch}, with collapse before NEE`, () => {
            const scene = fixture(); scene.materials.sphere.model = model;
            const choice = { ...spectral, estimator: { ...spectral.estimator, objectDispatch } };
            const renderer = compiler.compile(scene, choice);
            for (const [id, shader] of renderer.shaders) glslangCheck(shader.fragment, 'frag', id);
            const source = [...renderer.shaders.values()].find(s => s.fragment.includes('transport_trace'))!.fragment;
            const walk = source.slice(source.indexOf('Radiance transport_trace(Ray ray) {'));
            expect(walk.indexOf('kernel_score_emitter_hit')).toBeLessThan(walk.indexOf('collapse_wavelengths(s)'));
            expect(walk.indexOf('if (bounce ==')).toBeLessThan(walk.indexOf('collapse_wavelengths(s)'));
            expect(walk.indexOf('collapse_wavelengths(s)')).toBeLessThan(walk.indexOf('light_sample_direct(s'));
            expect(program(scene, choice).dispersion).toEqual({ indexMaterials: [0], regions: [1] });
            expect(program(scene, choice).spectrumKinds.map((k) => k.id)).toEqual(['cauchy']);
        });
    }
    it('records only index consumers and real interiors', () => {
        const scene = fixture();
        scene.objects = [{ ...boxMesh([1, 1, 1], false), kind: 'mesh', material: 'sphere' }];
        expect(program(scene).dispersion?.regions).toEqual([]);
        scene.objects[0] = { ...scene.objects[0], closed: true } as never;
        expect(program(scene).dispersion?.regions).toEqual([0]);
        scene.materials.ground = { model: 'mirror', albedo: 1 };
        expect(program(scene).dispersion?.indexMaterials).toEqual([0]);
    });
    it('plans dispersive interiors for instanced glass', () => {
        const scene = fixture();
        scene.objects = [{ kind: 'instanced', prototype: { type: 'sphere', parameters: { radius: 1 }, material: 'sphere' },
            placements: [{ position: [-1, 0, 0] }, { position: [1, 0, 0] }] }];
        expect(program(scene).dispersion).toEqual({ indexMaterials: [0], regions: [0] });
        expect(program(scene).spectrumKinds.map((k) => k.id)).toEqual(['cauchy']);
        for (const [id, shader] of compiler.compile(scene, spectral).shaders) glslangCheck(shader.fragment, 'frag', id);
    });
    it('retains constant-index data under mixed renderer ordering', () => {
        const scene = fixture(); const choices = [spectral, { ...minimalStrategy, id: 'rgb' }];
        const a = compiler.compileScene(scene, choices), b = compiler.compileScene(scene, [...choices].reverse());
        expect(compiledJson(a.sceneData)).toBe(compiledJson(b.sceneData));
        for (const r of a.renderers) expect(compiledJson(r)).toBe(compiledJson(b.renderers.find(v => v.id === r.id)));
    });
});

describe('Sellmeier authoring', () => {
    // Independent rounded indices and spectral lines from the SCHOTT datasheet.
    it('N-SF11 reproduces its catalog n_d and Abbe number', () => {
        const [nd, nF, nC] = [587.5618, 486.1327, 656.2725].map((lambda) => sellmeierIndex(N_SF11, lambda));
        expect(Math.abs(nd - 1.78472)).toBeLessThan(0.000005);
        expect(Math.abs((nd - 1) / (nF - nC) - 25.68)).toBeLessThan(0.01);
    });
    for (const [lambda, n] of [[365.0146, 1.53627], [404.6561, 1.53024], [435.8343, 1.52668],
        [486.1327, 1.52238], [546.0740, 1.51872], [587.5618, 1.51680], [656.2725, 1.51432], [706.5188, 1.51289]]) {
        it(`matches the N-BK7 tabulated index at ${lambda} nm`, () => {
            expect(Math.abs(sellmeierIndex(N_BK7, lambda) - n)).toBeLessThan(0.000005);
        });
    }
    it('uses the d-line index in RGB and folds wavelength-independent coefficients', () => {
        const scene = fixture(); scene.materials.sphere.ior = N_BK7;
        const ref = structuredClone(scene); ref.materials.sphere.ior = sellmeierIndex(N_BK7, indexReferenceNM);
        expect(compiledJson(compiler.compile(scene, minimalStrategy))).toBe(compiledJson(compiler.compile(ref, minimalStrategy)));
        scene.materials.sphere.ior = { sellmeier: { B: [1.25, 0, 0], C: [0, 1, 2] } };
        ref.materials.sphere.ior = 1.5;
        expect(compiledJson(compiler.compile(scene, spectral))).toBe(compiledJson(compiler.compile(ref, spectral)));
    });
    for (const coefficients of [null, { B: [1, 2], C: [1, 2, 3] },
        { B: [-1, 0, 0], C: [1, 2, 3] }, { B: [Infinity, 0, 0], C: [1, 2, 3] },
        { B: [1, 0, 0], C: [NaN, 2, 3] }, { B: [1, 0, 0], C: [-0.1, 2, 3] },
        ...[0.36 ** 2, 0.5 ** 2, 0.83 ** 2, 0.8].map(c => ({ B: [1, 0, 0], C: [c, 2, 3] }))]) {
        it(`rejects malformed, singular or nonpositive Sellmeier ${JSON.stringify(coefficients)}`, () => {
            const scene = fixture(); scene.materials.sphere.ior = { sellmeier: coefficients } as never;
            expect(() => compiler.compile(scene, spectral)).toThrow(/Sellmeier/);
        });
    }
    it('rejects Sellmeier on reflectance and on the unsupported spatial medium index', () => {
        const scene = fixture(); scene.materials.ground.albedo = N_BK7 as never;
        expect(() => compiler.compile(scene, spectral)).toThrow(/Sellmeier is an index form/);
        delete scene.materials.ground.albedo;
        scene.materials.ground.medium = { ior: N_BK7 as never };
        expect(() => compiler.compile(scene, spectral)).toThrow(/medium\.ior cannot be a Sellmeier value/);
    });
    for (const model of ['dielectric', 'rough_dielectric']) for (const objectDispatch of ['unrolled', 'table'] as const) {
        it(`compiles ${model}/${objectDispatch} and includes only the used index helpers`, () => {
            const scene = fixture(); scene.materials.sphere = { model, ior: N_BK7 };
            const strategy = { ...spectral, estimator: { ...spectral.estimator, objectDispatch } };
            const p = program(scene, strategy);
            expect(p.dispersion).toEqual({ indexMaterials: [0], regions: [1] });
            expect(p.spectrumKinds.map((k) => k.id)).toEqual(['sellmeier']);
            const renderer = compiler.compile(scene, strategy);
            for (const [id, shader] of renderer.shaders) glslangCheck(shader.fragment, 'frag', id);
            const source = [...renderer.shaders.values()].map(s => s.fragment).join('\n');
            expect(source).toContain('sellmeier_index');
            expect(source).not.toContain('cauchy_index');
            // Both forms coexist without changing the material or transport contracts.
            scene.materials.ground = { model: 'dielectric', ior: { cauchy: [1.4, 0.01] } };
            expect(program(scene, strategy).spectrumKinds.map((k) => k.id)).toEqual(['cauchy', 'sellmeier']);
            for (const [id, shader] of compiler.compile(scene, strategy).shaders) glslangCheck(shader.fragment, 'frag', id);
        });
    }
});
