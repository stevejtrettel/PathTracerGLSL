import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { spectralMediumBound, spectralCeilingRange } from '../../src/components/color/spectral/majorant.js';
import { mediaStrategy, spectralSlab } from '../witnesses/scenes/spectralMedia.js';
import { glslangCheck } from '../helpers/glslangCheck.js';

const compiler = new Compiler();
const base = mediaStrategy('tracking','nee');
const strategy = { ...base, estimator: { ...base.estimator, volumeSampling: 'delta-tracking' as const } };
function scene(ceiling = 1) {
    const s = structuredClone(spectralSlab);
    s.materials.ink.medium = { sigma_a: { kind:'glsl',source:'vec3(0.3,0.7,1.2)' },
        sigma_s:[0.1,0.2,0.4],majorant:ceiling };
    s.lights = [{ kind: 'directional', direction: [0,0,-1], emission: 1 }];
    return s;
}
describe('spectral tracking bounds', () => {
    it('rounds the error envelope outward from the actual float32 ceiling', () => {
        for (const a of [...spectralCeilingRange, 0.11772707849740982, 0.1, 1, 32]) {
            const {ceiling,majorant} = spectralMediumBound(a);
            const d = 2**-20, target = 4*ceiling*(1+d)**5/(1-d)**2;
            expect(ceiling).toBe(Math.fround(a));
            expect(majorant).toBe(Math.fround(majorant));
            expect(majorant).toBeGreaterThanOrEqual(target);
            expect(majorant).toBeLessThan(target*(1+2**-22));
            // A parser rounding the field up and the rate down must still be covered.
            const aBits = new Float32Array([ceiling]); new Uint32Array(aBits.buffer)[0]++;
            const mBits = new Float32Array([majorant]); new Uint32Array(mBits.buffer)[0]--;
            expect(mBits[0]).toBeGreaterThanOrEqual(4*aBits[0]*(1+d)**4/(1-d));
        }
    });
    for (const scattering of ['full','ignored'] as const) for (const directLighting of ['none','nee'] as const)
        it(`compiles ${scattering}, ${directLighting} with separate field and sampling ceilings`, () => {
            const s = scene(0.11772707849740982), bound = spectralMediumBound(s.materials.ink.medium!.majorant!);
            const choice = { ...strategy,measurement:{...strategy.measurement,scattering},estimator:{...strategy.estimator,directLighting} };
            for (const [id,shader] of compiler.compile(s,choice).shaders) {
                glslangCheck(shader.fragment,'frag',id);
                if (!shader.fragment.includes('scene_medium_properties')) continue;
                expect(shader.fragment).toContain('uniform highp sampler2D u_spectralCoefficients;');
                expect(shader.fragment).toContain('uniform highp sampler2D u_spectralCurves;');
                expect(shader.fragment).toContain(`sigma_max > ${bound.ceiling}`);
                expect(shader.fragment).toContain(`${bound.majorant}`);
            }
        });
    for (const a of [0,2**-61,2**19,Infinity,NaN]) it(`rejects uncertified ceiling ${a}`, () => {
        expect(() => compiler.compile(scene(a),strategy)).toThrow(/ceiling|majorant/);
    });
    it('keeps unsupported tracking combinations gated', () => {
        expect(() => compiler.compile(scene(),{...strategy,estimator:{...strategy.estimator,directLighting:'mis'}})).toThrow();
        expect(() => compiler.compile(scene(),{...strategy,estimator:{...strategy.estimator,mediumLightSampling:'equiangular'}})).toThrow();
    });
});
