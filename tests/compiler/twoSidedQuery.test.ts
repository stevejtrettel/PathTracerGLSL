// The two-sided-query DOOR (fable-rough-dielectric §3.1/§3.3), built BEFORE the model
// it exists for — the v1.5 lightQuery pin's own demand ("extend the constructor's policy
// FIRST"). A synthetic material model declaring `support: 'sphere'` + non-delta lobes is
// registered directly into MATERIAL_MODELS (mutate + restore; vitest's worker-per-file
// isolation keeps other suites clean), and this test proves the whole chain fires off
// that ONE declared fact:
//   descriptor.support → modelTwoSidedShading → program.materials.twoSidedShading
//   → the generated material_two_sided predicate → light_query_surface's runtime arm
//   → LightQuery.two_sided → the light tree's disarmed cull.
// The synthetic model's MATH is ggx's under new symbols — this is a door test, not new
// BSDF math. When rough_dielectric lands (T2b), it walks through this same door and the
// registry-wide contract test in lightTree.test.ts covers it without an edit here.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { MATERIAL_MODELS } from '../../src/components/materials/index.js';
import { ggxDescriptor } from '../../src/components/materials/ggx/ggx.js';
import type { MaterialModelDescriptor } from '../../src/components/descriptors.js';
import type { SceneDescription, RenderStrategy } from '../../src/compiler/types.js';
import { glslangCheck } from '../helpers/glslangCheck.js';

const twosidedGLSL = ggxDescriptor.glsl.replace(/ggx_/g, 'twosided_');

const twosidedDescriptor: MaterialModelDescriptor = {
    ...ggxDescriptor,
    id: 'twosided',
    glsl: twosidedGLSL,
    capabilities: { ...ggxDescriptor.capabilities, support: 'sphere', nonDeltaLobes: true },
};

beforeAll(() => { MATERIAL_MODELS['twosided'] = twosidedDescriptor; });
afterAll(() => { delete MATERIAL_MODELS['twosided']; });

/** One sphere of the synthetic model + a lambert floor (so the predicate must be a
 *  RUNTIME test, not a folded constant — the interesting emission). */
function scene(model: string): SceneDescription {
    return {
        id: `two-sided-${model}`,
        ambientSpace: { type: 'euclidean' },
        objects: [
            { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor' },
            { type: 'sphere', parameters: { center: [0, 1, 0], radius: 1 }, material: 'glassy' },
        ],
        materials: {
            floor: { model: 'lambert', albedo: 0.5 },
            glassy: { model, f0: 0.05, roughness: 0.3 },
        },
        lights: [{ kind: 'quad', corner: [-0.5, 3, -0.5], edge1: [1, 0, 0], edge2: [0, 0, 1], emission: 12 }],
    };
}

const strategy = (selection: string, dl: 'nee' | 'mis'): RenderStrategy => ({
    id: `two-sided-${selection}-${dl}`,
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 4 },
    estimator: {
        directLighting: dl, lightSelection: selection,
        russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
});

function fragmentOf(sceneDesc: SceneDescription, strat: RenderStrategy): string {
    const renderer = new Compiler().compile(sceneDesc, strat);
    const main = [...renderer.shaders.entries()].find(([id]) => id.endsWith('-main'));
    expect(main).toBeDefined();
    return main![1].fragment;
}

describe('two-sided light query: the door opens off ONE declared fact', () => {
    it('a sphere-support non-delta model emits the predicate and the runtime arm', () => {
        const frag = fragmentOf(scene('twosided'), strategy('bvh', 'mis'));
        expect(frag).toContain('bool material_two_sided(int mat)');
        // The RUNTIME arm — not the folded constant (the scene also has lambert).
        expect(frag).toContain('return LightQuery(hit.p, hit.frame.n, material_two_sided(mat));');
        // The medium/camera queries stay one-sided-irrelevant (n = 0 says it already).
        expect(frag).toContain('LightQuery(p, vec3(0.0), false)');
    });

    it('a hemisphere-only scene carries NEITHER the predicate NOR a runtime bit', () => {
        // Exact linkage: the decision folds the question away entirely (this is the
        // shape EVERY existing scene keeps — the reason T1 changes no pixel).
        const frag = fragmentOf(scene('ggx'), strategy('bvh', 'mis'));
        expect(frag).not.toContain('material_two_sided');
        expect(frag).toContain('return LightQuery(hit.p, hit.frame.n, false);');
    });

    it('the predicate exists under power selection too (policy is selection-independent)', () => {
        // The CULL is the bvh occupant's, but the support fact is the material's: the
        // query says the same thing under any selection, so swapping the estimator axis
        // can never change what the BSDF claims about itself.
        const frag = fragmentOf(scene('twosided'), strategy('power', 'nee'));
        expect(frag).toContain('material_two_sided(mat)');
    });

    it('the REAL occupant walks through the same door', () => {
        // T2b's end-to-end: rough_dielectric declares support 'sphere' + non-delta lobes
        // and nothing else in the chain knows its name.
        const glass: SceneDescription = {
            id: 'two-sided-real',
            ambientSpace: { type: 'euclidean' },
            objects: [
                { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor' },
                { type: 'sphere', parameters: { center: [0, 1, 0], radius: 1 }, material: 'roughglass' },
            ],
            materials: {
                floor: { model: 'lambert', albedo: 0.5 },
                roughglass: { model: 'rough_dielectric', roughness: 0.2, ior: 1.5 },
            },
            lights: [{ kind: 'quad', corner: [-0.5, 3, -0.5], edge1: [1, 0, 0], edge2: [0, 0, 1], emission: 12 }],
        };
        const frag = fragmentOf(glass, strategy('bvh', 'mis'));
        expect(frag).toContain('bool material_two_sided(int mat)');
        expect(frag).toContain('return LightQuery(hit.p, hit.frame.n, material_two_sided(mat));');
        // Both lobes link: NEE evaluates it (non-delta) and MIS queries its pdf.
        expect(frag).toContain('rough_dielectric_eval');
        expect(frag).toContain('rough_dielectric_pdf');
        // ...and the transmissive half of its capabilities still holds (ior table, η² RR).
        expect(frag).toContain('ior_of');
        expect(frag).toContain('eta_scale');
    });

    for (const selection of ['power', 'bvh']) {
        it(`glslang-links under ${selection} selection`, () => {
            const renderer = new Compiler().compile(scene('twosided'), strategy(selection, 'mis'));
            for (const [shaderId, prog] of renderer.shaders) {
                glslangCheck(prog.vertex, 'vert', `${shaderId} [vertex]`);
                glslangCheck(prog.fragment, 'frag', `${shaderId} [fragment]`);
            }
        }, 30000);
    }
});
