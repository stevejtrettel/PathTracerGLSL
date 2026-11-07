// Bump mapping (materials/README, "Shading-normal perturbation"): the Validator rules for the
// `bump` meta-key, and the linkage — the shading-frame swap, the height dispatch and the masked
// interaction arms exist only in programs with a bumped material, and only for bumped ids.
import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { validate } from '../../src/compiler/analyze/Validator.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { DiagnosticBag } from '../../src/errors/core/DiagnosticBag.js';
import type { SceneDescription, RenderStrategy } from '../../src/compiler/types.js';
import { bumpTiltScene, bumpTiltMisStrategy, bumpSidesScene, bumpSidesNeeStrategy } from '../witnesses/scenes/bumpWitness.js';
import { exprConstRef, exprTwinStrategy } from '../witnesses/scenes/exprMaterialWitness.js';
import { glslangCheck } from '../helpers/glslangCheck.js';

const compiler = new Compiler();

function compiled(scene: SceneDescription, strategy: RenderStrategy) {
    return compiler.compile(scene, strategy);
}
function fragment(scene: SceneDescription, strategy: RenderStrategy): string {
    const shaders = [...compiled(scene, strategy).shaders.values()];
    return shaders.find((s) => s.fragment.includes('scene_material_properties'))!.fragment;
}

function errors(mutate: (s: SceneDescription) => void): string[] {
    const scene = structuredClone(bumpTiltScene);
    mutate(scene);
    const bag = new DiagnosticBag('test');
    validate(analyze(scene), scene, bumpTiltMisStrategy, bag);
    return bag.getErrors().map((e) => e.message);
}

describe('bump: Validator', () => {
    it('accepts the witness scenes', () => {
        expect(errors(() => {})).toEqual([]);
    });

    it('rejects bump on model none', () => {
        const msgs = errors((s) => { s.materials.tilted = { model: 'none', medium: { sigma_a: 1, sigma_s: 0 }, bump: { height: { kind: 'glsl', source: 'p.x' }, step: 0.01 } }; });
        expect(msgs.some((m) => /'tilted': bump/.test(m) && /none/.test(m))).toBe(true);
    });

    it('rejects a height that is not a GLSL expression', () => {
        const msgs = errors((s) => { (s.materials.tilted.bump as unknown as Record<string, unknown>).height = 0.5; });
        expect(msgs.some((m) => /bump\.height/.test(m))).toBe(true);
    });

    it('requires the step (no default length fits every scene)', () => {
        const msgs = errors((s) => { delete (s.materials.tilted.bump as unknown as Record<string, unknown>).step; });
        expect(msgs.some((m) => /bump\.step/.test(m))).toBe(true);
    });

    it('rejects a step that is not a finite number > 0', () => {
        for (const step of [0, -1e-3, Infinity]) {
            const msgs = errors((s) => { (s.materials.tilted.bump as unknown as Record<string, unknown>).step = step; });
            expect(msgs.some((m) => /bump\.step/.test(m)), String(step)).toBe(true);
        }
    });

    it('rejects unknown keys in the bump record', () => {
        const msgs = errors((s) => { (s.materials.tilted.bump as unknown as Record<string, unknown>).strength = 2; });
        expect(msgs.some((m) => /bump/.test(m) && /strength/.test(m))).toBe(true);
    });
});

describe('bump: linkage', () => {
    it('a bumped program swaps the frame in the walk, before the guides, NEE and sampling', () => {
        const src = fragment(bumpTiltScene, bumpTiltMisStrategy);
        const swap = src.indexOf('hit.frame = material_shading_frame(mat, hit, wo);');
        expect(swap).toBeGreaterThan(0);
        expect(swap).toBeLessThan(src.indexOf('light_sample_direct(s, hit, mat, wo, props);'));
        expect(swap).toBeLessThan(src.indexOf('kernel_sample_continuation(s, hit, mat, wo, props, bs)'));
        expect(src).toContain('float bump_height(int mat, Point p)');
        expect(src).toContain('Frame material_shading_frame(int mat, Hit hit, Direction wo)');
    });

    it('masks eval, pdf and sample of bumped ids only', () => {
        // tilted = material 0 (bumped), black = material 1 (not bumped).
        const src = fragment(bumpTiltScene, bumpTiltMisStrategy);
        expect(src).toMatch(/if \(mat == 0\) return shading_masked\(lambert_sample\(/);
        expect(src).toMatch(/if \(mat == 0\) return shading_side_consistent\(hit, wi\) \? lambert_eval\(/);
        expect(src).toMatch(/if \(mat == 0\) return shading_side_consistent\(hit, wi\) \? lambert_pdf\(/);
        expect(src).not.toMatch(/mat == 1\) return shading_/);
        expect(src).toMatch(/if \(mat == 0\) return shading_frame_perturbed\(hit, wo, bump_surface_gradient\(0, hit, 0\.01\)\);/);
    });

    it('groups bumped ids of one model into one arm', () => {
        const src = fragment(bumpSidesScene, bumpSidesNeeStrategy);
        expect(src).toMatch(/if \(mat == 0 \|\| mat == 1\) return shading_masked\(lambert_sample\(/);
    });

    it('includes the Perlin library for a bump height (it may call the noise)', () => {
        expect(fragment(bumpTiltScene, bumpTiltMisStrategy)).toContain('float perlin_noise(vec3 x)');
    });

    it('is absent from programs without a bumped material', () => {
        const src = fragment(exprConstRef, exprTwinStrategy);
        for (const symbol of ['material_shading_frame', 'bump_height', 'shading_side_consistent', 'shading_masked']) {
            expect(src).not.toContain(symbol);
        }
    });

    it('links with no missing or unused seams', () => {
        for (const [scene, strategy] of [[bumpTiltScene, bumpTiltMisStrategy], [bumpSidesScene, bumpSidesNeeStrategy]] as const) {
            const warnings = compiler.compileScene(scene, [strategy]).warnings;
            expect(warnings.filter((m) => /shading|bump/.test(m))).toEqual([]);
        }
    });

    it('compiles under glslang with a noise height and a declared slider', () => {
        const scene = structuredClone(bumpTiltScene);
        scene.materials.tilted.bump = {
            height: { kind: 'glsl', source: 'u_relief_depth * perlin_fbm(4.0 * p, 0.5, 4)', params: [{ param: 'relief.depth', default: 0.02, min: 0, max: 0.1 }] },
            step: 1e-3,
        };
        const result = compiled(scene, bumpTiltMisStrategy);
        expect(Object.keys(result.parameters ?? {})).toContain('relief.depth');
        glslangCheck(fragment(scene, bumpTiltMisStrategy), 'frag', 'bump-noise');
    }, 60_000);
});
