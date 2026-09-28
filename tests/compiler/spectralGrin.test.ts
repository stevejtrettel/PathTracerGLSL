import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import type { MediumDescription } from '../../src/compiler/types.js';
import { spectralSlab, mediaStrategy } from '../witnesses/scenes/spectralMedia.js';
import { glslangCheck } from '../helpers/glslangCheck.js';

const compiler = new Compiler();
const strategy = mediaStrategy('grin');
const media: MediumDescription[] = [
    { ior: 1, sigma_a: [0.1, 0.3, 0.7], emission: [0.3, 0.2, 0.1] },
    {
        ior: { param: 'lens.index', default: 1.2, min: 1, max: 2 },
        sigma_s: { param: 'lens.s', default: [0.1, 0.3, 0.7], min: 0, max: 1 },
    },
    {
        ior: { kind: 'glsl', source: '1.2+0.01*p.x' },
        sigma_a: { kind: 'glsl', source: 'vec3(0.1,0.3,0.7)*(1.0+p.z*p.z)' },
        emission: { kind: 'glsl', source: 'vec3(0.2)' },
    },
];

describe('spectral wavelength-independent GRIN', () => {
    for (const [i, medium] of media.entries()) {
        for (const directLighting of ['none', 'nee', 'mis'] as const) {
            it(`compiles field ${i}, ${directLighting}, without tracking or a density ceiling`, () => {
                const scene = structuredClone(spectralSlab);
                scene.materials.ink.medium = medium;
                scene.lights = [{ kind: 'directional', direction: [0, 0, -1], emission: 1 }];
                const renderer = compiler.compile(scene, {
                    ...strategy, estimator: { ...strategy.estimator, directLighting },
                });
                for (const [id, shader] of renderer.shaders) {
                    glslangCheck(shader.fragment, 'frag', id);
                    expect(shader.fragment).not.toContain('float sigma_scale');
                    expect(shader.fragment).not.toContain('medium_sample_delta(');
                }
            });
        }
    }

    const unsupported: Array<[string, MediumDescription]> = [
        ['emissive scattering', { ior: 1, sigma_s: 0.1, emission: 1 }],
        ['expression absorption with scattering', { ior: 1, sigma_s: 0.1, sigma_a: { kind: 'glsl', source: '0.1' } }],
    ];
    for (const [name, medium] of unsupported) {
        it(`retains the curved-transport restriction on ${name}`, () => {
            const scene = structuredClone(spectralSlab);
            scene.materials.ink.medium = medium;
            expect(() => compiler.compile(scene, strategy)).toThrow(/deflecting medium/);
        });
    }
});
