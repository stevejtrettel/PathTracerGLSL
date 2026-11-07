// The Perlin library (glsl/core/perlin.glsl) is in a program exactly when some material
// carries a GLSL-expression row: material rows are where author formulas can call it.
// Medium expressions do not include it, and programs without expressions are unchanged.
import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import type { SceneDescription } from '../../src/compiler/types.js';
import { exprConst, exprConstRef, exprTwinStrategy } from '../witnesses/scenes/exprMaterialWitness.js';
import { emitSwapScene, emitSwapStrategy } from '../witnesses/scenes/emissionWitness.js';
import { glslangCheck } from '../helpers/glslangCheck.js';

const compiler = new Compiler();

function fragment(scene: SceneDescription, strategy = exprTwinStrategy): string {
    const shaders = [...compiler.compile(scene, strategy).shaders.values()];
    return shaders.find((s) => s.fragment.includes('scene_material_properties'))!.fragment;
}

describe('Perlin library linkage', () => {
    it('is included when a material row is an expression, and the expression may call it', () => {
        const scene = structuredClone(exprConst);
        scene.materials.sphere.albedo = {
            kind: 'glsl',
            source: 'vec3(0.5) + 0.2 * vec3(perlin_noise(4.0 * p), perlin_fbm(2.0 * p, 0.5, 6), perlin_turbulence(p, 0.5, 4))',
        };
        const source = fragment(scene);
        expect(source).toContain('const int PERLIN_PERM[256]');
        expect(source.indexOf('float perlin_noise(vec3 x)')).toBeLessThan(source.indexOf('MaterialProperties scene_material_properties('));
        glslangCheck(source, 'frag', 'perlin-expression');
    }, 60_000);

    it('is absent from programs without material expressions', () => {
        expect(fragment(exprConstRef)).not.toContain('perlin_');
    });

    it('is absent when only a medium coefficient is an expression', () => {
        expect(fragment(emitSwapScene, emitSwapStrategy)).not.toContain('perlin_');
    });
});
