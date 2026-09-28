import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { spectralMediumBound } from '../../src/components/color/spectral/majorant.js';
import { mediaStrategy, spectralSlab } from '../witnesses/scenes/spectralMedia.js';
import { glslangCheck } from '../helpers/glslangCheck.js';

const compiler = new Compiler();
const scene = () => {
    const s = structuredClone(spectralSlab);
    s.materials.ink.medium = {
        sigma_a: { param: 'glow.a', default: [0.2, 0.4, 0.8], min: 0, max: 4 },
        sigma_s: { param: 'glow.s', default: 0.1, min: 0, max: 4 },
        emission: { param: 'glow.e', default: [0.4, 0.8, 1.2], min: 0, max: 4 },
    };
    return s;
};
const base = mediaStrategy('emission');
const tracked = { ...base, estimator: { ...base.estimator, volumeSampling: 'delta-tracking' as const } };
describe('spectral volume emission', () => {
    it('derives the rate from both live extinction inputs, including scalar writes and vacuum', () => {
        const compiled = compiler.compile(scene(), tracked);
        const rate = compiled.uniforms.find(u => u.uniform === 'u_majorant_1')!;
        expect(rate.parameters).toEqual(['glow.a', 'glow.s']);
        for (const [a, s, ceiling] of [[0, 0, 1e-6], [[0.2, 0.4, 0.8], 0.1, 0.9],
            [[0.8, 0.1, 0.2], [0.2, 1.8, 0.1], 1.9], [4, 3, 7]] as const)
            expect(rate.compute({ 'glow.a': a, 'glow.s': s })).toBe(spectralMediumBound(ceiling).majorant);
    });
    for (const scattering of ['full', 'ignored'] as const) for (const expression of [false, true])
        it(`compiles ${scattering} emission, expression=${expression}`, () => {
            const s = scene();
            if (expression) Object.assign(s.materials.ink.medium!, {
                emission: { kind: 'glsl', source: 'vec3(0.4,0.8,1.2)*(1.0+p.z*p.z)' }, majorant: 2,
            });
            const choice = { ...tracked, measurement: { ...base.measurement, scattering },
                estimator: { ...tracked.estimator, volumeSampling: expression || scattering === 'full' ? 'delta-tracking' as const : 'analytic' as const } };
            for (const [id, shader] of compiler.compile(s, choice).shaders) glslangCheck(shader.fragment, 'frag', id);
        });
    it('keeps tracking MIS and GRIN gated, and checks emission and derived-rate domains', () => {
        expect(() => compiler.compile(scene(), { ...tracked, estimator: { ...tracked.estimator, directLighting: 'mis' } })).toThrow();
        for (const invalid of [{ emission: -1 }, { emission: { blackbody: { kelvin: 3000 } } },
            { sigma_a: 2 ** 18 }, { sigma_s: { param: 's', default: 1, max: 2 ** 18 } }, { ior: 1.5 }]) {
            const s = scene(); Object.assign(s.materials.ink.medium!, invalid);
            expect(() => compiler.compile(s, tracked)).toThrow(/spectral medium/);
        }
    });
});
