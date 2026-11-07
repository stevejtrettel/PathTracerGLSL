// Derived material fields (MaterialDerivedSpec) as the compiler emits them. A derived field
// whose inputs are constants or {param}s is computed on the host: a baked literal, or a
// uniform whose compute closure runs `fn`. When an input varies over the surface (a GLSL
// expression or a per-instance attribute), a field with a per-hit form (`glsl`) is computed in
// the material lookup from its inputs' struct fields; a field without one (plastic's
// coat_fdr) keeps the Validator's constant-or-{param} rule.

import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import type { RenderStrategy, SceneDescription } from '../../src/compiler/types.js';
import { minimalScene, minimalStrategy } from '../witnesses/scenes/minimalScene.js';
import { glslangCheck } from '../helpers/glslangCheck.js';

const compiler = new Compiler();
const strategies: Record<'rgb' | 'spectral', RenderStrategy> = {
    rgb: minimalStrategy,
    spectral: { ...minimalStrategy, measurement: { ...minimalStrategy.measurement, color: 'spectral' } },
};
const PER_HIT_ALPHA = 'props.alpha = max(1e-3, props.roughness * props.roughness);';

function withSphere(sphere: Record<string, unknown>): SceneDescription {
    return { ...minimalScene, materials: { ...minimalScene.materials, sphere: sphere as never } };
}

const LOOKUP = 'MaterialProperties scene_material_properties(';

/** The compiled programs that hold the material lookup (the display pass has none). */
function lookupShaders(compiled: ReturnType<Compiler['compile']>): Array<[string, string]> {
    const out = [...compiled.shaders].filter(([, s]) => s.fragment.includes(LOOKUP)).map(([id, s]): [string, string] => [id, s.fragment]);
    expect(out.length).toBeGreaterThan(0);
    return out;
}

/** The material lookup's arm for one material id: the lines between `if (id == N) {` and `}`. */
function arm(fragment: string, id: number): string {
    const start = fragment.indexOf(`(id == ${id}) {`);
    expect(start, `arm for material ${id}`).toBeGreaterThan(-1);
    return fragment.slice(start, fragment.indexOf('}', start));
}

describe('derived material fields', () => {
    for (const model of ['ggx', 'rough_dielectric'] as const) {
        it(`${model}: a constant roughness bakes alpha on the host`, () => {
            const compiled = compiler.compile(withSphere({ model, roughness: 0.3 }), minimalStrategy);
            const text = arm(lookupShaders(compiled)[0][1], 1);
            expect(text).toContain('props.alpha = 0.09');
            expect(text).not.toContain(PER_HIT_ALPHA);
            expect(compiled.uniforms.some((u) => u.uniform.startsWith('u_alpha'))).toBe(false);
        });

        it(`${model}: a {param} roughness drives a host uniform computing alpha`, () => {
            const compiled = compiler.compile(withSphere({ model, roughness: { param: 'rough', default: 0.3, min: 0, max: 1 } }), minimalStrategy);
            const binding = compiled.uniforms.find((u) => u.uniform === 'u_alpha_1')!;
            expect(binding.parameters).toContain('rough');
            expect(binding.compute({ rough: 0.5 })).toBe(0.25);
            expect(binding.compute({ rough: 0.01 })).toBe(1e-3);
            expect(arm(lookupShaders(compiled)[0][1], 1)).toContain('props.alpha = u_alpha_1;');
        });

        for (const [color, strategy] of Object.entries(strategies)) {
            it(`${model} (${color}): an expression roughness computes alpha per hit from the struct field`, () => {
                const scene = withSphere({ model, roughness: { kind: 'glsl', source: '0.1 + 0.2 * clamp(p.y, 0.0, 1.0)' } });
                const compiled = compiler.compile(scene, strategy);
                expect(compiled.uniforms.some((u) => u.uniform.startsWith('u_alpha'))).toBe(false);
                for (const [id, fragment] of lookupShaders(compiled)) {
                    const text = arm(fragment, 1);
                    expect(text).toContain('props.roughness = 0.1 + 0.2 * clamp(p.y, 0.0, 1.0);');
                    // Assigned after the row it reads.
                    expect(text.indexOf(PER_HIT_ALPHA)).toBeGreaterThan(text.indexOf('props.roughness ='));
                    glslangCheck(fragment, 'frag', id);
                }
            });
        }
    }

    it('a per-instance roughness computes alpha per hit from the attribute it reads', () => {
        const scene: SceneDescription = {
            ...minimalScene,
            materials: { ...minimalScene.materials, metal: { model: 'ggx', f0: 0.9, roughness: 0.3 } },
            objects: [...minimalScene.objects, {
                kind: 'instanced',
                prototype: { type: 'sphere', parameters: { radius: 0.5 }, material: 'metal' },
                placements: [{ position: [0, 1, 0] }, { position: [2, 1, 0] }],
                attributes: { roughness: [0.1, 0.6] },
            } as never],
        };
        for (const [id, fragment] of lookupShaders(compiler.compile(scene, minimalStrategy))) {
            const text = arm(fragment, 2);
            expect(text).toMatch(/props\.roughness = [^;]*element[^;]*\.x;/);
            expect(text.indexOf(PER_HIT_ALPHA)).toBeGreaterThan(text.indexOf('props.roughness ='));
            glslangCheck(fragment, 'frag', id);
        }
    });

    it('a field without a per-hit form keeps the constant-or-{param} rule (plastic coat_eta)', () => {
        expect(() => compiler.compile(withSphere({ model: 'plastic', coat_eta: { kind: 'glsl', source: '1.5 + 0.1 * p.x' } }), minimalStrategy))
            .toThrow(/coat_eta feeds the derived field 'coat_fdr', which is computed on the host/);
        const scene: SceneDescription = {
            ...minimalScene,
            materials: { ...minimalScene.materials, coated: { model: 'plastic', coat_eta: 1.5 } },
            objects: [...minimalScene.objects, {
                kind: 'instanced',
                prototype: { type: 'sphere', parameters: { radius: 0.5 }, material: 'coated' },
                placements: [{ position: [0, 1, 0] }, { position: [2, 1, 0] }],
                attributes: { coat_eta: [1.4, 1.6] },
            } as never],
        };
        expect(() => compiler.compile(scene, minimalStrategy)).toThrow(/attributes\.coat_eta feeds the derived field 'coat_fdr'/);
    });
});
