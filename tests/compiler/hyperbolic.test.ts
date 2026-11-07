// H³ programs (the hyperbolic occupant): the H³ witness scenes compile and pass the glslang static
// check, the compiler's placement and light rows are the isometry the design names, and the
// Validator's curved-space rules report what they should.

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { glslangCheck } from '../helpers/glslangCheck.js';
import { h3Suite, h3DiskLight, h3Furnace, h3DirectNeeStrategy, h3FurnaceStrategy, H3_CAMERA } from '../witnesses/scenes/h3Witness.js';
import { hyperbolicGeometry as H } from '../../src/components/ambient/hyperbolic/hyperbolic.js';
import { ORIGIN, mat4Apply, placementIsometry, tangentAtOrigin } from '../../src/components/ambient/isometry.js';
import { formatMat4, formatVec4 } from '../../src/components/glsl-format.js';
import { IDENTITY_QUAT, quatFromAxisAngle } from '../../src/components/geometry/similarity.js';
import { withPose } from '../../src/authoring/strategy.js';
import type { RenderStrategy, SceneDescription } from '../../src/compiler/types.js';

const compiler = new Compiler();
const fragmentOf = (scene: SceneDescription, strategy: RenderStrategy): string =>
    [...compiler.compileScene(scene, [strategy]).renderers[0].shaders.entries()].find(([id]) => id.endsWith('-main'))![1].fragment;
const posedNee = withPose(h3DirectNeeStrategy, H3_CAMERA.position, H3_CAMERA.target);

function errorsOf(scene: SceneDescription, strategy: RenderStrategy): string {
    try {
        compiler.compileScene(scene, [strategy]);
        return '';
    } catch (err) {
        return String(err);
    }
}

describe('H³ witness programs', () => {
    for (const [id, entry] of Object.entries(h3Suite)) {
        it(`${id} compiles and passes the glslang static check`, () => {
            const compiled = compiler.compileScene(entry.scene, entry.strategies);
            for (const r of compiled.renderers) {
                for (const [sid, program] of r.shaders) glslangCheck(program.fragment, 'frag', sid);
            }
        }, 60000);
    }
});

describe('H³ placements and light rows', () => {
    it('a disk light: the region is placed by T(center) and the light rows are that isometry applied', () => {
        const glsl = fragmentOf(h3DiskLight, posedNee);
        const g = placementIsometry(H, [0, 0, 0], IDENTITY_QUAT, [0, 1, 0]);
        expect(glsl).toContain(`const mat4 isometry_object_1 = ${formatMat4(H.inverse(g))};`);
        const center = formatVec4(mat4Apply(g, ORIGIN));
        const normal = formatVec4(mat4Apply(g, tangentAtOrigin([0, -1, 0])));
        expect(glsl).toContain(`DiskLight(${center}, 1.2, ${normal},`);
        // the shape keeps its intrinsic rows: radius and the normal as a tangent vector at o
        expect(glsl).toContain('Disk(1.2, Direction(0.0, -1.0, 0.0, 0.0))');
        expect(glsl).toMatch(/struct Disk \{\s*float radius;\s*Direction normal;\s*\}/);
    });

    it('a constant transform and a point row fold into one isometry T(position)·R(rotation)·T(center)', () => {
        const rotation = quatFromAxisAngle([0, 0, 1], 0.5);
        const scene: SceneDescription = {
            ...h3DiskLight,
            objects: [{ type: 'sphere', parameters: { center: [0.2, 0, 0], radius: 0.3 }, transform: { position: [0, 0.4, 0], rotation }, material: 'receiver' }],
        };
        const glsl = fragmentOf(scene, posedNee);
        const g = placementIsometry(H, [0, 0.4, 0], rotation, [0.2, 0, 0]);
        expect(glsl).toContain(`const mat4 isometry_object_0 = ${formatMat4(H.inverse(g))};`);
        expect(glsl).toMatch(/struct Sphere \{\s*float radius;\s*\}/);
    });

    it('a {param}-driven transform becomes a mat4 uniform whose value is the same inverse isometry', () => {
        const scene: SceneDescription = {
            ...h3DiskLight,
            objects: [{ type: 'sphere', parameters: { center: [0.2, 0, 0], radius: 0.3 }, transform: { position: { param: 'ball.position', default: [0, 0.4, 0] } }, material: 'receiver' }],
        };
        const renderer = compiler.compileScene(scene, [posedNee]).renderers[0];
        const u = renderer.uniforms.find((x) => x.uniform === 'u_object0Isometry')!;
        expect(u.type).toBe('mat4');
        const moved = u.compute!({ 'ball.position': [0.1, -0.2, 0.3] }) as number[];
        const want = H.inverse(placementIsometry(H, [0.1, -0.2, 0.3], IDENTITY_QUAT, [0.2, 0, 0]));
        moved.forEach((x, i) => expect(x).toBeCloseTo(want[i], 12));
    });

    it('the h3-sky-ball witness reaches its ball through the mat4 uniform', () => {
        const entry = h3Suite['h3-sky-ball'];
        const r = compiler.compileScene(entry.scene, entry.strategies).renderers[0];
        expect(r.uniforms.find((x) => x.uniform === 'u_object0Isometry')!.type).toBe('mat4');
        const glsl = [...r.shaders.values()].map((p) => p.fragment).join('\n');
        expect(glsl).toContain('uniform mat4 u_object0Isometry;');
        expect(glsl).not.toContain('const mat4 isometry_object_0');
    });

    it('the camera uniforms are the vec4 frame at exp_o(position)', () => {
        const renderer = compiler.compileScene(h3DiskLight, [posedNee]).renderers[0];
        const position = renderer.uniforms.find((x) => x.uniform === 'u_cameraPosition')!;
        expect(position.type).toBe('vec4');
        const p = position.compute!({ 'camera.position': H3_CAMERA.position, 'camera.target': H3_CAMERA.target }) as number[];
        H.exp(H3_CAMERA.position as [number, number, number]).forEach((x, i) => expect(p[i]).toBeCloseTo(x, 12));
        expect(renderer.uniforms.find((x) => x.uniform === 'u_cameraForward')!.type).toBe('vec4');
    });
});

describe('H³ Validator rules', () => {
    const furnace = withPose(h3FurnaceStrategy, [0, 0, 0], [0, 0, -1]);

    it('accepts the furnace as authored', () => {
        expect(errorsOf(h3Furnace, furnace)).toBe('');
    });

    it('accepts a ball radius above π: the S³ radius domain applies in S³ only', () => {
        const ball = { ...h3DiskLight, objects: [{ type: 'sphere', parameters: { radius: 4 }, material: 'receiver' }] } as SceneDescription;
        expect(errorsOf(ball, posedNee)).toBe('');
    });

    it('rejects a curvature parameter', () => {
        expect(errorsOf({ ...h3Furnace, ambientSpace: { type: 'hyperbolic', parameters: { curvature: -2 } } }, furnace))
            .toContain('curvature fixed at magnitude 1');
    });

    it('rejects a missing camera pose', () => {
        expect(errorsOf(h3Furnace, h3FurnaceStrategy)).toContain('needs an authored camera position and target');
    });

    it('rejects a scale other than 1, a marched shape with no H³ body and a uv-reading material; accepts a marched ball', () => {
        const scaled = { ...h3Furnace, objects: [{ ...h3Furnace.objects[0], transform: { scale: 2 } }] } as SceneDescription;
        expect(errorsOf(scaled, furnace)).toContain('object scale other than 1: not implemented in hyperbolic space');
        const marched = { ...h3Furnace, objects: [{ type: 'sphere', parameters: { radius: 0.3 }, material: 'furnace', backend: 'sdf' }] } as SceneDescription;
        expect(errorsOf(marched, furnace)).toBe('');
        const torus = { ...h3Furnace, objects: [{ type: 'torus', parameters: { ringRadius: 0.5, tubeRadius: 0.1 }, material: 'furnace' }] } as SceneDescription;
        expect(errorsOf(torus, furnace)).toContain("primitive 'torus' has no hyperbolic implementation");
        const patterned = { ...h3Furnace, materials: { furnace: { model: 'lambert', albedo: { kind: 'glsl', source: 'vec3(fract(uv.x))' } } } } as unknown as SceneDescription;
        expect(errorsOf(patterned, furnace)).toContain('materials that read uv or hold GLSL expressions: not implemented in hyperbolic space');
    });

    it('accepts a sky looked up by BSDF rays and rejects one sampled as a light', () => {
        expect(errorsOf({ ...h3Furnace, environment: { type: 'constant', color: [0.2, 0.3, 0.5] } }, furnace)).toBe('');
        const sampled = withPose({ ...h3DirectNeeStrategy }, [0, 0, 0], [0, 0, -1]);
        expect(errorsOf({ ...h3Furnace, environment: { type: 'constant', color: [0.2, 0.3, 0.5], sampleAsLight: true } }, sampled))
            .toContain('an environment sampled as a light: not implemented in hyperbolic space');
    });

    it('rejects an occupant with no H³ body, naming it', () => {
        const box = { ...h3Furnace, objects: [{ type: 'box', parameters: { halfSize: [0.3, 0.3, 0.3] }, material: 'furnace' }] } as SceneDescription;
        expect(errorsOf(box, furnace)).toContain("primitive 'box' has no hyperbolic implementation");
        const sun = { ...h3DiskLight, lights: [{ kind: 'directional', direction: [0, -1, 0], emission: 1 }] } as SceneDescription;
        expect(errorsOf(sun, posedNee)).toContain("light kind 'directional' has no hyperbolic implementation");
    });
});
