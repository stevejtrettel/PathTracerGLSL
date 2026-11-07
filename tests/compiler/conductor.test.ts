// The conductor materials as the compiler sees them: what a program links for measured and plain
// optical constants in each color model, the live optical slider, and the energy-compensation
// rule for rough_conductor.

import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { validate } from '../../src/compiler/analyze/Validator.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import type { RenderStrategy, SceneDescription } from '../../src/compiler/types.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';
import { glslangCheck } from '../helpers/glslangCheck.js';

const compiler = new Compiler();
const GOLD = { eta: { measured: { table: 'metal-Au-eta' } }, k: { measured: { table: 'metal-Au-k' } } };

function scene(materials: Record<string, unknown>): SceneDescription {
    return { ...minimalScene, materials: { ...minimalScene.materials, ...materials } as SceneDescription['materials'] };
}
function strategy(color: 'rgb' | 'spectral', microfacet?: 'single-scattering' | 'energy-compensated'): RenderStrategy {
    return { ...minimalStrategy, measurement: { ...minimalStrategy.measurement, color, ...(microfacet ? { microfacet } : {}) } };
}
const main = (s: SceneDescription, st: RenderStrategy) => {
    const compiled = compiler.compile(s, st);
    return { id: `${compiled.id}-main`, fragment: compiled.shaders.get(`${compiled.id}-main`)!.fragment, compiled };
};
function errors(s: SceneDescription, st: RenderStrategy): string[] {
    const bag = new DiagnosticBag('test');
    validate(analyze(s), s, st, bag);
    return bag.getErrors().map((d) => d.message);
}

describe('conductor and rough_conductor', () => {
    it('spectral: links one measured helper per table named, and no other', () => {
        const s = scene({ sphere: { model: 'rough_conductor', ...GOLD, roughness: 0.3 }, ground: { model: 'conductor', ...GOLD } });
        const { id, fragment } = main(s, strategy('spectral'));
        expect(fragment).toContain('Spectrum measured_metal_Au_eta(Wavelengths wl)');
        expect(fragment).toContain('Spectrum measured_metal_Au_k(Wavelengths wl)');
        expect(fragment.match(/Spectrum measured_metal_\w+\(Wavelengths wl\)/g)).toHaveLength(2);
        expect(fragment).toContain('props.eta = measured_metal_Au_eta(wl);');
        expect(fragment).toContain('vec3 microfacet_to_local(');
        expect(fragment).not.toContain('microfacet_conductor_gain');
        glslangCheck(fragment, 'frag', id);
    }, 30000);

    it('RGB: the measured tables become their stand-in triples; no helper is linked', () => {
        const s = scene({ sphere: { model: 'rough_conductor', ...GOLD, roughness: 0.3 }, ground: { model: 'conductor', ...GOLD } });
        const { id, fragment } = main(s, strategy('rgb'));
        expect(fragment).not.toContain('measured_metal_');
        expect(fragment).toMatch(/props\.eta = color_lift_coefficient\(vec3\(0\.0[0-9]+, 0\.4[0-9]+, 1\.5[0-9]+\), wl\);/);
        glslangCheck(fragment, 'frag', id);
    }, 30000);

    it('the smooth conductor alone links no microfacet library', () => {
        const { fragment } = main(scene({ sphere: { model: 'conductor', ...GOLD } }), strategy('spectral'));
        expect(fragment).toContain('conductor_sample(');
        expect(fragment).not.toContain('vec3 microfacet_to_local(');
    });

    it('a scalar optical slider is a float widget on a vec3 uniform', () => {
        const s = scene({ sphere: { model: 'conductor', eta: 0.2, k: { param: 'metal.k', default: 3, min: 0.5, max: 8 } } });
        for (const color of ['rgb', 'spectral'] as const) {
            const { compiled } = main(s, strategy(color));
            expect(compiled.parameters!['metal.k']).toMatchObject({ type: 'float', default: 3, range: [0.5, 8] });
            const uniform = compiled.uniforms.find((u) => u.uniform === 'u_metal_k')!;
            expect(uniform.type).toBe('vec3');
            expect(uniform.compute({})).toEqual([3, 3, 3]);
            expect(uniform.compute({ 'metal.k': 5 })).toEqual([5, 5, 5]);
        }
    });

    it("rough_conductor has no energy gain: 'energy-compensated' rejects it; conductor and single scattering accept", () => {
        const rough = scene({ sphere: { model: 'rough_conductor', ...GOLD, roughness: 0.3 } });
        expect(errors(rough, strategy('rgb', 'energy-compensated'))).toEqual([
            "Material 'sphere': model 'rough_conductor' has no energy-compensation gain; measurement.microfacet 'energy-compensated' cannot render it (use 'single-scattering')",
        ]);
        expect(errors(rough, strategy('rgb', 'single-scattering'))).toEqual([]);
        expect(errors(scene({ sphere: { model: 'conductor', ...GOLD } }), strategy('spectral', 'energy-compensated'))).toEqual([]);
    });

    it('optical rows cannot vary per instance', () => {
        const s: SceneDescription = {
            ...minimalScene,
            materials: { ...minimalScene.materials, metal: { model: 'conductor' } },
            objects: [...minimalScene.objects, {
                kind: 'instanced',
                prototype: { type: 'sphere', parameters: { radius: 0.5 }, material: 'metal' },
                placements: [{ position: [0, 1, 0] }, { position: [2, 1, 0] }],
                attributes: { k: [1, 2] },
            } as never],
        };
        expect(errors(s, strategy('rgb')).some((e) => e.includes('attributes.k cannot vary per instance — an optical constant'))).toBe(true);
    });
});
