// The sheen model as the compiler sees it. It reads the frame maps of glsl/core/microfacet.glsl
// and no microfacet energy gain, so a program whose only microfacet occupant is sheen links that
// library and nothing of microfacet_energy, under either measurement.microfacet. Its roughness
// feeds the derived sheen_r, which has a per-hit form, so the roughness may vary over the surface.

import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import type { RenderStrategy, SceneDescription } from '../../src/compiler/types.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';
import { glslangCheck } from '../helpers/glslangCheck.js';

const compiler = new Compiler();
function strategy(color: 'rgb' | 'spectral', microfacet?: 'single-scattering' | 'energy-compensated'): RenderStrategy {
    return { ...minimalStrategy, measurement: { ...minimalStrategy.measurement, color, ...(microfacet ? { microfacet } : {}) } };
}
function withSphere(sphere: Record<string, unknown>, others: Record<string, unknown> = {}): SceneDescription {
    return {
        ...minimalScene,
        materials: { ...minimalScene.materials, sphere: { model: 'sheen', ...sphere }, ...others } as SceneDescription['materials'],
    };
}
const main = (scene: SceneDescription, st: RenderStrategy) => {
    const compiled = compiler.compile(scene, st);
    const textures = compiled.pipeline.passes.flatMap((p) => Object.values(p.inputs?.textures ?? {}));
    return { id: `${compiled.id}-main`, fragment: compiled.shaders.get(`${compiled.id}-main`)!.fragment, textures };
};

describe('sheen settings', () => {
    for (const color of ['rgb', 'spectral'] as const) {
        it(`${color}: links the frame maps and no energy gain, under either measurement.microfacet, with no diagnostics`, () => {
            const scene = withSphere({ albedo: [0.3, 0.1, 0.1], sheen_color: [1, 0.8, 0.8], sheen_weight: 1, sheen_roughness: 0.4 });
            expect(compiler.compileScene(scene, [strategy(color)]).warnings)
                .toEqual(compiler.compileScene(minimalScene, [strategy(color)]).warnings);
            for (const microfacet of ['single-scattering', 'energy-compensated'] as const) {
                const { id, fragment, textures } = main(scene, strategy(color, microfacet));
                expect(fragment).toContain('vec3 microfacet_to_local(');
                expect(fragment).not.toContain('microfacet_conductor_gain');
                expect(fragment).not.toContain('microfacet_dielectric_gain');
                expect(fragment).not.toContain('u_microfacetEnergy');
                expect(textures.some((t) => String(t).includes('energy'))).toBe(false);
                expect(fragment).toContain('sheen_sample(');
                glslangCheck(fragment, 'frag', id);
            }
        }, 30000);

        it(`${color}: beside ggx, ggx's gain is linked once`, () => {
            const { fragment } = main(withSphere({}, { ground: { model: 'ggx', f0: 0.9, roughness: 0.5 } }), strategy(color));
            expect(fragment.match(/vec3 microfacet_to_local\(/g)).toHaveLength(1);
            expect(fragment.match(/Spectrum microfacet_conductor_gain\(/g)).toHaveLength(1);
        });

        it(`${color}: sheen_weight and sheen_roughness lie in [0, 1]`, () => {
            expect(() => compiler.compile(withSphere({ sheen_weight: 1.2 }), strategy(color))).toThrow(/sheen_weight .*must be in \[0, 1\]/);
            expect(() => compiler.compile(withSphere({ sheen_roughness: -0.1 }), strategy(color))).toThrow(/sheen_roughness .*must be in \[0, 1\]/);
        });
    }

    it('a constant roughness is clamped on the host; a varying one per hit', () => {
        const baked = main(withSphere({ sheen_roughness: 0 }), strategy('rgb')).fragment;
        expect(baked).toMatch(/props\.sheen_r = 0\.01;/);
        const varying = main(withSphere({ sheen_roughness: { kind: 'glsl', source: '0.5 + 0.4 * sin(p.x)' } }), strategy('rgb')).fragment;
        expect(varying).toMatch(/props\.sheen_r = clamp\(props\.sheen_roughness, 0\.01, 1\.0\);/);
    });
});
