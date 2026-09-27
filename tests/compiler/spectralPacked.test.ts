import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { packSceneData } from '../../src/app/sceneData.js';
import { compiledJson } from '../helpers/compiledJson.js';
import { glslangCheck } from '../helpers/glslangCheck.js';
import { spectralPackedScene, packedStrategy } from '../witnesses/scenes/spectralPacked.js';
import type { InstancedObject, RenderStrategy, Vec3 } from '../../src/compiler/types.js';

const compiler = new Compiler();
const spectral = packedStrategy('mis', 'bvh');
const rgb: RenderStrategy = { ...spectral, id: 'rgb', measurement: { ...spectral.measurement, color: 'rgb' },
    estimator: { ...spectral.estimator, wavelengths: undefined } };

describe('spectral packed colours', () => {
    for (const packed of [false, true]) it(`compiles ${packed ? 'flat float32' : 'nested RGB'} attributes`, () => {
        const scene = structuredClone(spectralPackedScene);
        const batch = scene.objects[1] as InstancedObject;
        if (packed) for (const [key, values] of Object.entries(batch.attributes!)) {
            batch.attributes![key] = new Float32Array((values as number[][]).flat());
        }
        const renderer = compiler.compile(scene, spectral);
        for (const [id, shader] of renderer.shaders) glslangCheck(shader.fragment, 'frag', id);
    });
    it('preserves authored packed bytes and renderer output across mixed-model order', async () => {
        const forward = compiler.compileScene(spectralPackedScene, [rgb, spectral]);
        const reverse = compiler.compileScene(spectralPackedScene, [spectral, rgb]);
        const rgbOnly = compiler.compileScene(spectralPackedScene, [rgb]);
        const spectralOnly = compiler.compileScene(spectralPackedScene, [spectral]);
        for (const other of [reverse, rgbOnly, spectralOnly]) {
            expect(compiledJson(other.sceneData)).toBe(compiledJson(forward.sceneData));
            for (const renderer of other.renderers) {
                expect(compiledJson(renderer)).toBe(compiledJson(forward.renderers.find(r => r.id === renderer.id)));
            }
        }
        expect(compiledJson(await packSceneData(spectralOnly.sceneData))).toBe(compiledJson(await packSceneData(rgbOnly.sceneData)));
    });
    const invalidAttributes: Array<[string, number[] | Vec3[] | Float32Array]> = [
        ['albedo', [[0.2, 1.1, 0.4], [0, 0, 0], [0, 0, 0]]],
        ['albedo', [-0.1, 0, 0]],
        ['emission', [[1, -0.1, 2], [0, 0, 0], [0, 0, 0]]],
        ['albedo', new Float32Array([0, 0, 0, 0, 2, 0, 0, 0, 0])],
        ['emission', new Float32Array([0, 0, 0, 0, -1, 0, 0, 0, 0])],
    ];
    for (const [key, values] of invalidAttributes) it(`rejects invalid ${key} in ${values instanceof Float32Array ? 'packed' : 'array'} attributes`, () => {
        const scene = structuredClone(spectralPackedScene);
        (scene.objects[1] as InstancedObject).attributes![key] = values;
        expect(() => compiler.compile(scene, spectral)).toThrow(new RegExp(`attribute '${key}'`));
        expect(() => compiler.compile(scene, rgb)).not.toThrow();
    });
});
