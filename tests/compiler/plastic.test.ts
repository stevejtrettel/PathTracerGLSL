// The plastic model's settings as the compiler sees them: the base albedo is confined to
// [0, 1] in both color models (R/(1 − R·K) has a pole at R = 1/K and turns negative beyond
// it), and coat_eta feeds the host-derived coat_fdr, so it takes a positive constant or a
// {param}, whose live value recomputes K.

import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import type { RenderStrategy, SceneDescription } from '../../src/compiler/types.js';
import { diffuseFresnelReflectance } from '../../src/components/materials/plastic/plastic.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';

const compiler = new Compiler();
const strategies: Record<'rgb' | 'spectral', RenderStrategy> = {
    rgb: minimalStrategy,
    spectral: { ...minimalStrategy, measurement: { ...minimalStrategy.measurement, color: 'spectral' } },
};

function withSphere(sphere: Record<string, unknown>): SceneDescription {
    return { ...minimalScene, materials: { ...minimalScene.materials, sphere: { model: 'plastic', ...sphere } } };
}

describe('plastic settings', () => {
    for (const [color, strategy] of Object.entries(strategies)) {
        it(`${color}: albedo outside [0, 1] is rejected`, () => {
            for (const albedo of [1.1, [0.2, 1.2, 0.3], { param: 'base', default: 0.5, max: 1.5 }]) {
                expect(() => compiler.compile(withSphere({ albedo }), strategy), JSON.stringify(albedo))
                    .toThrow(/albedo .*must be in \[0, 1\]/);
            }
            expect(() => compiler.compile(withSphere({ albedo: [1, 0.5, 0] }), strategy)).not.toThrow();
        });

        it(`${color}: coat_eta must be a positive constant or a {param}`, () => {
            expect(() => compiler.compile(withSphere({ coat_eta: 0 }), strategy)).toThrow(/coat_eta must be > 0/);
            expect(() => compiler.compile(withSphere({ coat_eta: { kind: 'glsl', source: '1.5 + 0.1 * p.x' } }), strategy))
                .toThrow(/coat_eta feeds the derived field 'coat_fdr'/);
        });
    }

    it('a constant coat_eta is baked; a {param} coat_eta drives a uniform computing K', () => {
        const baked = compiler.compile(withSphere({ coat_eta: 1.5 }), minimalStrategy);
        expect(baked.uniforms.some((u) => u.uniform.startsWith('u_coat_fdr'))).toBe(false);

        const driven = compiler.compile(withSphere({ coat_eta: { param: 'coat', default: 1.5, min: 1, max: 2 } }), minimalStrategy);
        const binding = driven.uniforms.find((u) => u.uniform.startsWith('u_coat_fdr'))!;
        expect(binding.parameters).toContain('coat');
        expect(binding.compute({ coat: 1.5 })).toBe(diffuseFresnelReflectance(1.5));
        expect(binding.compute({ coat: 1.8 })).toBe(diffuseFresnelReflectance(1.8));
    });
});
