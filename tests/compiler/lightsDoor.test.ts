// The lights DOOR test (the cylinder test's sibling): adding a hittable light kind must
// be one GLSL file + one descriptor + one registry line — NOTHING else. This test
// registers a synthetic kind directly into LIGHT_KINDS (mutate + restore; vitest's
// worker-per-file isolation keeps other suites clean) and compiles a scene that lights
// door-shaped regressions up:
//   - the scene has NO lambert material and the kind is not quad/sphere, so any
//     hardcoded kind list in census/planning/validation fails it (the backing lambert
//     material must flow from the DESUGAR into program.materials.models);
//   - glslang parses the result, so a missing include (lambert_*, <kind>_light_*)
//     fails here instead of at the GPU.
// The kind's math is quad's (uniform parallelogram, one-sided) under new symbols — the
// door test proves the DOOR, not new sampling math.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { analyze } from '../../src/compiler/analyze/Analyzer.js';
import { LIGHT_KINDS } from '../../src/components/lights/index.js';
import { quadLightDescriptor } from '../../src/components/lights/quad/quad.js';
import type { LightKindDescriptor } from '../../src/components/descriptors.js';
import type { SceneDescription, RenderStrategy, LightDescription } from '../../src/compiler/types.js';
import { glslangCheck } from '../helpers/glslangCheck.js';

// Quad's math under the synthetic kind's symbols (struct name = Doortest + 'Light').
const doortestGLSL = quadLightDescriptor.glsl
    .replace(/quad_light_/g, 'doortest_light_')
    .replace(/QuadLight/g, 'DoortestLight');

const doortestDescriptor: LightKindDescriptor = {
    ...quadLightDescriptor,
    kind: 'doortest',
    glsl: doortestGLSL,
};

beforeAll(() => {
    LIGHT_KINDS['doortest'] = doortestDescriptor;
});
afterAll(() => {
    delete LIGHT_KINDS['doortest'];
});

const doortestLight = {
    kind: 'doortest', corner: [-0.5, 3.98, -0.5], edge1: [1, 0, 0], edge2: [0, 0, 1], emission: 12,
} as unknown as LightDescription;

// Deliberately lambert-free: ggx floor + walls. The ONLY route for lambert into the
// program is the desugared __light_0 backing material.
const scene: SceneDescription = {
    id: 'lights-door',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'metal' },
        { type: 'sphere', parameters: { center: [0, 1, 0], radius: 1 }, material: 'metal' },
    ],
    materials: {
        metal: { model: 'ggx', f0: [0.9, 0.7, 0.4], roughness: 0.3 },
    },
    lights: [doortestLight],
};

const strategies: RenderStrategy[] = (['nee', 'mis'] as const).map((dl) => ({
    id: `door-${dl}`,
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 4 },
    estimator: { directLighting: dl, russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
}));

describe('lights door: a registry-only kind addition works end to end', () => {
    it('the Analyzer census classifies the new kind by its descriptor delta fact', () => {
        const f = analyze(scene);
        expect(f.lighting.areaLightCount).toBe(1);
        expect(f.lighting.unknownKindLightCount).toBe(0);
        expect(f.lighting.totalLightCount).toBe(1);
    });

    for (const strategy of strategies) {
        it(`compiles + glslang-links under ${strategy.id} (backing lambert + kind symbols present)`, () => {
            const renderer = new Compiler().compile(scene, strategy);
            const main = [...renderer.shaders.entries()].find(([id]) => id.endsWith('-main'));
            expect(main).toBeDefined();
            const frag = main![1].fragment;
            // The desugared backing material must pull lambert into the program even
            // though no authored material uses it and the kind is not quad/sphere.
            expect(frag).toContain('lambert_emission');
            expect(frag).toContain('doortest_light_sample');
            if (strategy.id === 'door-mis') expect(frag).toContain('doortest_light_pdf');
            for (const [shaderId, prog] of renderer.shaders) {
                glslangCheck(prog.vertex, 'vert', `${shaderId} [vertex]`);
                glslangCheck(prog.fragment, 'frag', `${shaderId} [fragment]`);
            }
        }, 30000);
    }
});
