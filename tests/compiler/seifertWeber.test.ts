// Seifert–Weber programs (components/quotient/seifert-weber): pt, pt-nee and pt-mis compile and
// pass the glslang static check, and the generated parts are the ones the quotients plan's Q2.3
// names: the walk over the cell query, the group's const tables, the crossing cap, the image
// wrappers, wo read from hit.arrival, and the camera pose reduced into D. A non-quotient H³
// program reports image 0 and the flow's arrival direction from its dispatcher.

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { glslangCheck } from '../helpers/glslangCheck.js';
import { withPose } from '../../src/authoring/strategy.js';
import { swFaceNormals, swConstantsGLSL } from '../../src/components/quotient/seifert-weber/seifert-weber.js';
import { hyperbolicGeometry } from '../../src/components/ambient/hyperbolic/hyperbolic.js';
import type { RenderStrategy, SceneDescription, Vec3 } from '../../src/compiler/types.js';
import type { Vec4 } from '../../src/components/ambient/isometry.js';

const compiler = new Compiler();

const swScene: SceneDescription = {
    id: 'sw-test',
    ambientSpace: { type: 'hyperbolic', quotient: { kind: 'seifert-weber' } },
    objects: [
        { type: 'sphere', parameters: { center: [0.3, -0.2, 0.1], radius: 0.3 }, material: 'clay' },
        { type: 'sphere', parameters: { center: [-0.4, 0.3, -0.2], radius: 0.15 }, material: 'glow' },
    ],
    materials: {
        clay: { model: 'lambert', albedo: [0.7, 0.7, 0.7] },
        glow: { model: 'lambert', albedo: [0, 0, 0], emission: [4, 4, 4], sampleAsLight: false },
    },
    lights: [{ kind: 'disk', position: [0, 0.5, 0], normal: [0, -1, 0], radius: 0.2, emission: 5 }],
};

const base: RenderStrategy = withPose({
    id: 'pt',
    measurement: { camera: { type: 'pinhole', fov: 1.0 }, maxBounces: 4, farClip: 6 },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
}, [0, 0.1, 0.7], [0, 0, 0]);
const strategies: RenderStrategy[] = [
    base,
    { ...base, id: 'pt-nee', estimator: { ...base.estimator, directLighting: 'nee' } },
    { ...base, id: 'pt-mis', estimator: { ...base.estimator, directLighting: 'mis' } },
];

const fragments = (scene: SceneDescription, list: RenderStrategy[]) =>
    compiler.compileScene(scene, list).renderers.map((r) => [...r.shaders.entries()].find(([id]) => id.endsWith('-main'))![1].fragment);

describe('Seifert–Weber programs', () => {
    it('pt, pt-nee and pt-mis compile and pass the glslang static check', () => {
        const compiled = compiler.compileScene(swScene, strategies);
        for (const r of compiled.renderers) {
            for (const [sid, program] of r.shaders) glslangCheck(program.fragment, 'frag', sid);
        }
    }, 60000);

    it('walk the cells over the cell query, with the group tables and the crossing cap', () => {
        const [pt, nee, mis] = fragments(swScene, strategies);
        for (const glsl of [pt, nee, mis]) {
            expect(glsl).toContain(swConstantsGLSL());
            expect(glsl).toContain('#define QUOTIENT_MAX_CROSSINGS 56');        // ⌈4·6⌉ + 32
            expect(glsl).toContain('#define MAX_DIST 6.0');
            expect(glsl).toContain('bool scene_intersect_cell(Ray ray, float t_far, out Hit hit) {');
            expect(glsl).toContain('hit.image = quotient_image_index(n, first_face);');
            expect(glsl).toContain('Direction wo = -hit.arrival;');
            expect(glsl).not.toContain('torus');
        }
        // The any-hit walk exists where the opaque shadow query does, and a capped shadow ray is
        // occluded.
        expect(pt).not.toContain('bool scene_intersect_any(');
        for (const glsl of [nee, mis]) {
            const any = glsl.slice(glsl.indexOf('bool scene_intersect_any(Ray ray, float maxDist) {'));
            expect(any.slice(0, any.indexOf('\n}'))).toMatch(/return true;\s*\/\/ the crossing cap/);
        }
    });

    it('draws NEE images from the 13-entry table and names a BSDF hit by hit.image', () => {
        const [, nee, mis] = fragments(swScene, strategies);
        for (const glsl of [nee, mis]) {
            expect(glsl).toContain('int j = min(int(random() * 13.0), 12);');
            expect(glsl).toContain('ls.wi = quotient_image_direction(j, ls.wi);');
        }
        expect(mis).toContain('int j = light_hit.image;');
        expect(nee).toContain('if (hit.image < 0) return 1.0;');
    });

    it('reduces the camera pose into D', () => {
        // A camera 1.4 from o along a face direction lies beyond that face (r_in = 0.996).
        const u: Vec3 = [swFaceNormals[0][0], swFaceNormals[0][1], swFaceNormals[0][2]];
        const n = Math.hypot(...u);
        const far = withPose(base, [1.4 * u[0] / n, 1.4 * u[1] / n, 1.4 * u[2] / n], [0, 0, 0]);
        const renderer = compiler.compileScene(swScene, [far]).renderers[0];
        const position = renderer.uniforms.find((x) => x.uniform === 'u_cameraPosition')!;
        const p = position.compute({ 'camera.position': far.measurement.camera.position, 'camera.target': [0, 0, 0] }) as Vec4;
        expect(Math.max(...swFaceNormals.map((N) => hyperbolicGeometry.form(N, p)))).toBeLessThanOrEqual(0);
        // Unreduced, the point would be exp_o of the authored position, beyond face 0.
        expect(hyperbolicGeometry.form(swFaceNormals[0], hyperbolicGeometry.exp(far.measurement.camera.position as Vec3))).toBeGreaterThan(0);
        // The live closure reduces too.
        const moved = position.compute({ 'camera.position': [-1.4 * u[0] / n, -1.4 * u[1] / n, -1.4 * u[2] / n], 'camera.target': [0, 0, 0] }) as Vec4;
        expect(Math.max(...swFaceNormals.map((N) => hyperbolicGeometry.form(N, moved)))).toBeLessThanOrEqual(0);
    });

    it('a non-quotient H³ program reports image 0 and the flow\'s arrival direction', () => {
        const plain: SceneDescription = { ...swScene, id: 'h3-plain', ambientSpace: { type: 'hyperbolic' } };
        const [glsl] = fragments(plain, [{ ...base, measurement: { ...base.measurement, farClip: undefined } }]);
        expect(glsl).toContain('hit.image = 0;');
        expect(glsl).toContain('hit.arrival = ambient_flow(ray, hit.t).direction;');
        expect(glsl).toContain('Direction wo = -hit.arrival;');
        expect(glsl).not.toContain('PAIRING');
    });
});
