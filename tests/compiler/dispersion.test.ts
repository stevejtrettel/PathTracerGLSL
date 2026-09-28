import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { planRenderers } from '../../src/compiler/plan/Planner.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import { cauchyIndex, indexReferenceNM } from '../../src/components/color/cauchy/cauchy.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';
import { boxMesh } from '../witnesses/scenes/meshWitness.js';
import { glslangCheck } from '../helpers/glslangCheck.js';
import { compiledJson } from '../helpers/compiledJson.js';
import type { SceneDescription, RenderStrategy } from '../../src/compiler/types.js';
const compiler = new Compiler();
const spectral: RenderStrategy = { ...minimalStrategy, measurement: { ...minimalStrategy.measurement, color: 'spectral' } };
const fixture = (): SceneDescription => ({ ...structuredClone(minimalScene), materials: {
    sphere: { model: 'dielectric', ior: { cauchy: [1.5, 0.01] } }, ground: { model: 'lambert', albedo: 0.5 },
} });
function program(scene: SceneDescription, strategy = spectral) {
    return planRenderers(analyze(scene), scene, [strategy], new DiagnosticBag()).plans[0].program;
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
        expect(() => compiler.compile(scene, spectral)).toThrow(/index form/);
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
        for (const [id, shader] of compiler.compile(scene, spectral).shaders) glslangCheck(shader.fragment, 'frag', id);
    });
    it('retains constant-index data under mixed renderer ordering', () => {
        const scene = fixture(); const choices = [spectral, { ...minimalStrategy, id: 'rgb' }];
        const a = compiler.compileScene(scene, choices), b = compiler.compileScene(scene, [...choices].reverse());
        expect(compiledJson(a.sceneData)).toBe(compiledJson(b.sceneData));
        for (const r of a.renderers) expect(compiledJson(r)).toBe(compiledJson(b.renderers.find(v => v.id === r.id)));
    });
});
