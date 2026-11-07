// The thin_dielectric model's settings as the compiler sees them. Its index sheet_eta is a plain
// positive float field relative to the medium outside, so it lives beside the dielectric's
// region-table ior without touching it. A sheet passes light through without changing region,
// which the walk cannot track through media, so a scene with media rejects the model.

import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import type { RenderStrategy, SceneDescription } from '../../src/compiler/types.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';

const compiler = new Compiler();
const strategies: Record<'rgb' | 'spectral', RenderStrategy> = {
    rgb: minimalStrategy,
    spectral: { ...minimalStrategy, measurement: { ...minimalStrategy.measurement, color: 'spectral' } },
};

/** The minimal scene with its sphere made of glass and a pane of `pane` in front of it. */
function withPane(pane: Record<string, unknown>, extra: Partial<SceneDescription> = {}): SceneDescription {
    return {
        ...minimalScene,
        objects: [
            ...minimalScene.objects,
            { type: 'quad', parameters: { corner: [-1, -1, 2], edge1: [2, 0, 0], edge2: [0, 2, 0] }, material: 'pane' },
        ],
        materials: {
            ...minimalScene.materials,
            sphere: { model: 'dielectric', ior: 1.5 },
            pane: { model: 'thin_dielectric', ...pane },
        },
        ...extra,
    };
}

const fragmentOf = (scene: SceneDescription, strategy: RenderStrategy): string => {
    const r = compiler.compile(scene, strategy);
    return r.shaders.get(`${r.id}-main`)!.fragment;
};

describe('thin_dielectric settings', () => {
    for (const [color, strategy] of Object.entries(strategies)) {
        it(`${color}: beside a dielectric, sheet_eta is a struct field and ior stays in the region table, with no diagnostics`, () => {
            const scene = withPane({ sheet_eta: 1.5 });
            expect(compiler.compileScene(scene, [strategy]).warnings)
                .toEqual(compiler.compileScene(minimalScene, [strategy]).warnings);
            const fragment = fragmentOf(scene, strategy);
            expect(fragment).toMatch(/struct MaterialProperties \{[^}]*\bfloat sheet_eta;/);
            expect(fragment).not.toMatch(/struct MaterialProperties \{[^}]*\bfloat ior;/);
            expect(fragment).toMatch(/float ior_of\(int region/);
            expect(fragment).toContain('thin_dielectric_sample(');
        });

        it(`${color}: sheet_eta must be a positive number or a {param}, not a dispersive index`, () => {
            expect(() => compiler.compile(withPane({ sheet_eta: 0 }), strategy)).toThrow(/sheet_eta must be > 0/);
            expect(() => compiler.compile(withPane({ sheet_eta: { cauchy: [1.5, 0.01] } }), strategy))
                .toThrow(/sheet_eta: Cauchy is an index form/);
            expect(() => compiler.compile(withPane({ sheet_eta: { param: 'pane', default: 1.5, min: 1, max: 2 } }), strategy)).not.toThrow();
        });

        it(`${color}: any medium in the scene is an error`, () => {
            const fog = { model: 'none' as const, medium: { sigma_a: 0.1 } };
            const withFog = withPane({ sheet_eta: 1.5 }, { materials: { ...withPane({}).materials, fog }, ambientMedium: 'fog' });
            expect(() => compiler.compile(withFog, strategy))
                .toThrow(/Material 'pane': model 'thin_dielectric' passes light through its surface without changing region/);
            const tinted = withPane({ sheet_eta: 1.5, medium: { sigma_a: 0.1 } });
            expect(() => compiler.compile(tinted, strategy)).toThrow(/without changing region/);
        });
    }

    it('an ior authored on the pane is ignored, with the warning other non-transmissive models get', () => {
        const warnings = compiler.compileScene(withPane({ ior: 1.5 }), [minimalStrategy]).warnings;
        expect(warnings.some((w) => w.includes("Material 'pane': ior is ignored for model 'thin_dielectric'"))).toBe(true);
    });

    it('a {param} sheet_eta drives a uniform', () => {
        const driven = compiler.compile(withPane({ sheet_eta: { param: 'pane', default: 1.5, min: 1, max: 2 } }), minimalStrategy);
        const binding = driven.uniforms.find((u) => u.parameters.includes('pane'))!;
        expect(binding.compute({ pane: 1.7 })).toBe(1.7);
    });
});
