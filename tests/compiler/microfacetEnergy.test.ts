// measurement.microfacet as the compiler sees it. 'single-scattering' (the default) emits each
// present gain as the constant 1 and binds no table; 'energy-compensated' links
// microfacet_energy.glsl and binds the built-in energy table. The roughness rows of the two
// microfacet models, and ggx's f0, are constrained to [0, 1] in every program.

import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { validate } from '../../src/compiler/analyze/Validator.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import { resolveMeasurement } from '../../src/compiler/plan/measurement.js';
import type { RenderStrategy, SceneDescription } from '../../src/compiler/types.js';
import { BUILTIN_ASSETS } from '../../src/components/assets.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';
import { glslangCheck } from '../helpers/glslangCheck.js';

const compiler = new Compiler();
const TABLE = 'extern:ggx-smith-energy-v1';
const CONDUCTOR_ONE = 'Spectrum microfacet_conductor_gain(float mu_o, float a, Spectrum f_avg) {\n    return SPECTRUM_ONE;';
const DIELECTRIC_ONE = 'float microfacet_dielectric_gain(float mu_o, float a, float eta) {\n    return 1.0;';
const STATIC_FILE = 'vec4 microfacet_energy_slice(int k, float mu_o, float a) {';

function scene(materials: Record<string, unknown>): SceneDescription {
    return { ...minimalScene, materials: { ...minimalScene.materials, ...materials } as SceneDescription['materials'] };
}
function strategy(microfacet?: 'single-scattering' | 'energy-compensated', color: 'rgb' | 'spectral' = 'rgb'): RenderStrategy {
    return { ...minimalStrategy, measurement: { ...minimalStrategy.measurement, color, ...(microfacet ? { microfacet } : {}) } };
}
const GGX = { sphere: { model: 'ggx', f0: 0.9, roughness: 0.5 } };
const GLASS = { sphere: { model: 'rough_dielectric', ior: 1.5, roughness: 0.5 } };
const BOTH = { sphere: { model: 'ggx', f0: 0.9, roughness: 0.5 }, ground: { model: 'rough_dielectric', ior: 1.5, roughness: 0.5 } };

/** The main program's fragment and its bound texture references. */
function main(compiled: ReturnType<Compiler['compile']>) {
    const [id, shader] = [...compiled.shaders].find(([, s]) => s.fragment.includes('scene_material_properties('))!;
    const textures = compiled.pipeline.passes.flatMap((p) => Object.values(p.inputs?.textures ?? {}));
    return { id, fragment: shader.fragment, textures };
}

describe('measurement.microfacet: what the program links', () => {
    it("records 'single-scattering' as the default", () => {
        expect(resolveMeasurement(scene(GGX), strategy()).microfacet).toBe('single-scattering');
        expect(resolveMeasurement(scene(GGX), strategy('energy-compensated')).microfacet).toBe('energy-compensated');
    });

    it('single-scattering: each present gain is the constant 1, and no table is bound', () => {
        for (const [materials, conductor, dielectric] of [[GGX, true, false], [GLASS, false, true], [BOTH, true, true]] as const) {
            const { fragment, textures } = main(compiler.compile(scene(materials), strategy()));
            expect(fragment.includes(CONDUCTOR_ONE)).toBe(conductor);
            expect(fragment.includes(DIELECTRIC_ONE)).toBe(dielectric);
            expect(fragment).not.toContain(STATIC_FILE);
            expect(fragment).not.toContain('u_microfacetEnergy');
            expect(textures).not.toContain(TABLE);
        }
    });

    it('energy-compensated: the static gains and the table, in RGB and spectral programs', () => {
        for (const color of ['rgb', 'spectral'] as const) {
            for (const materials of [GGX, GLASS, BOTH]) {
                const { id, fragment, textures } = main(compiler.compile(scene(materials), strategy('energy-compensated', color)));
                expect(fragment).toContain(STATIC_FILE);
                expect(fragment).not.toContain(CONDUCTOR_ONE);
                expect(fragment).not.toContain(DIELECTRIC_ONE);
                expect(fragment).toMatch(/uniform highp sampler2D u_microfacetEnergy;/);
                expect(textures).toContain(TABLE);
                glslangCheck(fragment, 'frag', id);
            }
        }
    }, 30000);

    it('energy-compensated without a microfacet model links nothing', () => {
        const { fragment, textures } = main(compiler.compile(minimalScene, strategy('energy-compensated')));
        expect(fragment).not.toContain('microfacet_');
        expect(textures).not.toContain(TABLE);
    });

    it('the table the compiler names is a built-in asset of the right size', () => {
        const asset = BUILTIN_ASSETS.get(TABLE.slice('extern:'.length))!;
        expect(asset).toBeDefined();
        expect([asset.width, asset.height]).toEqual([32, 32 * 32]);
    });
});

describe('measurement.microfacet: validation', () => {
    function errors(materials: Record<string, unknown>, microfacet?: string): string {
        const s = scene(materials);
        const st = strategy();
        if (microfacet !== undefined) (st.measurement as { microfacet?: string }).microfacet = microfacet;
        const bag = new DiagnosticBag('test');
        validate(analyze(s), s, st, bag);
        return bag.getErrors().map((e) => e.message).join('\n');
    }

    it('accepts both values and rejects any other', () => {
        expect(errors(GGX, 'single-scattering')).toBe('');
        expect(errors(GGX, 'energy-compensated')).toBe('');
        expect(errors(GGX, 'multiple')).toMatch(/measurement\.microfacet must be one of 'single-scattering' \| 'energy-compensated'/);
    });

    it('roughness lies in [0, 1] on both microfacet models, constants and slider ends', () => {
        expect(errors({ sphere: { model: 'ggx', roughness: 1.2 } })).toMatch(/roughness must be in \[0, 1\]/);
        expect(errors({ sphere: { model: 'rough_dielectric', roughness: 1.2 } })).toMatch(/roughness must be in \[0, 1\]/);
        expect(errors({ sphere: { model: 'ggx', roughness: { param: 'r', default: 0.5, min: 0, max: 1.5 } } }))
            .toMatch(/roughness parameter max must be in \[0, 1\]/);
        expect(errors({ sphere: { model: 'ggx', roughness: 1 } })).toBe('');
    });

    it("ggx's f0 lies in [0, 1]", () => {
        expect(errors({ sphere: { model: 'ggx', f0: 1.1 } })).toMatch(/f0 must be in \[0, 1\]/);
        expect(errors({ sphere: { model: 'ggx', f0: [1, 0.5, 1.05] } })).toMatch(/f0 must be in \[0, 1\]/);
        expect(errors({ sphere: { model: 'ggx', f0: 1 } })).toBe('');
    });
});
