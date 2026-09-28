import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import type { MediumDescription } from '../../src/compiler/types.js';
import { mediaStrategy, spectralSlab, spectralFog } from '../witnesses/scenes/spectralMedia.js';
import { glslangCheck } from '../helpers/glslangCheck.js';
import { compiledJson } from '../helpers/compiledJson.js';

const compiler = new Compiler();
const strategy = mediaStrategy('spectral');
describe('spectral homogeneous media', () => {
    for (const model of ['hg', 'rayleigh']) for (const scattering of ['full','ignored'] as const)
        for (const directLighting of ['none','nee','mis'] as const) {
            it(`compiles ${model}, ${scattering}, ${directLighting}`, () => {
                const scene = structuredClone(spectralFog);
                scene.materials.haze.medium!.model = model;
                const choice = { ...strategy, measurement: { ...strategy.measurement, scattering }, estimator: { ...strategy.estimator, directLighting } };
                for (const [id,shader] of compiler.compile(scene,choice).shaders) glslangCheck(shader.fragment,'frag',id);
            });
        }
    it('compiles live coefficient uniforms and equiangular lighting', () => {
        const scene = structuredClone(spectralFog);
        scene.lights = [{ kind: 'point', position: [0,1,0], emission: 1 }];
        scene.materials.haze.medium = { sigma_a: { param:'fog.a',default:0.1,min:0,max:3 },
            sigma_s: { param:'fog.s',default:[0.2,0.4,0.7],min:0,max:3 } };
        const choice = { ...strategy, estimator: { ...strategy.estimator, directLighting: 'nee' as const, mediumLightSampling:'equiangular' as const } };
        for (const [id,shader] of compiler.compile(scene,choice).shaders) glslangCheck(shader.fragment,'frag',id);
    });
    for (const medium of [
        { sigma_a: { kind:'glsl',source:'vec3(0.1)' } },
        { sigma_a:-0.1 }, { sigma_s:[0,NaN,1] },
        { sigma_a:{param:'bad',default:0.1,min:-1} },
        { sigma_s:{param:'bad',default:0.1,max:Infinity} },
    ] as MediumDescription[]) {
        it(`rejects unsupported medium ${JSON.stringify(medium)}`, () => {
            const scene = structuredClone(spectralSlab);
            scene.materials.ink.medium = medium;
            expect(() => compiler.compile(scene,strategy)).toThrow();
        });
    }
    it('preserves renderer order and shared authored data with RGB', () => {
        const rgb = { ...strategy,id:'rgb',measurement:{...strategy.measurement,color:'rgb' as const},estimator:{...strategy.estimator,wavelengths:undefined} };
        const a = compiler.compileScene(spectralFog,[rgb,strategy]);
        const b = compiler.compileScene(spectralFog,[strategy,rgb]);
        expect(compiledJson(a.sceneData)).toBe(compiledJson(b.sceneData));
        for (const r of a.renderers) expect(compiledJson(r)).toBe(compiledJson(b.renderers.find(v=>v.id===r.id)));
    });
});
