// S³ programs (the spherical occupant): the S³ witness scenes compile and pass the glslang static
// check, the compiler's placement and light rows are the isometry the design names, the curved
// light bodies receive the query and the transport's wo, and the Validator's rules report what they
// should in S³.

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { glslangCheck } from '../helpers/glslangCheck.js';
import { s3Suite, s3LongArc, s3Furnace, s3DirectNeeStrategy, s3DirectMisStrategy, s3FurnaceStrategy, S3_CAMERA, S3_DISK_LIGHT } from '../witnesses/scenes/s3Witness.js';
import { sphericalGeometry as S } from '../../src/components/ambient/spherical/spherical.js';
import { ORIGIN, mat4Apply, placementIsometry, tangentAtOrigin } from '../../src/components/ambient/isometry.js';
import { formatMat4, formatVec4 } from '../../src/components/glsl-format.js';
import { IDENTITY_QUAT } from '../../src/components/geometry/similarity.js';
import { withPose } from '../../src/authoring/strategy.js';
import type { RenderStrategy, SceneDescription } from '../../src/compiler/types.js';

const compiler = new Compiler();
const fragmentOf = (scene: SceneDescription, strategy: RenderStrategy): string =>
    [...compiler.compileScene(scene, [strategy]).renderers[0].shaders.entries()].find(([id]) => id.endsWith('-main'))![1].fragment;
const posedNee = withPose(s3DirectNeeStrategy, S3_CAMERA.position, S3_CAMERA.target);
const posedMis = withPose(s3DirectMisStrategy, S3_CAMERA.position, S3_CAMERA.target);

function errorsOf(scene: SceneDescription, strategy: RenderStrategy): string {
    try {
        compiler.compileScene(scene, [strategy]);
        return '';
    } catch (err) {
        return String(err);
    }
}

describe('S³ witness programs', () => {
    for (const [id, entry] of Object.entries(s3Suite)) {
        it(`${id} compiles and passes the glslang static check`, () => {
            const compiled = compiler.compileScene(entry.scene, entry.strategies);
            for (const r of compiled.renderers) {
                for (const [sid, program] of r.shaders) glslangCheck(program.fragment, 'frag', sid);
            }
        }, 60000);
    }
});

describe('S³ placements, light rows and light calls', () => {
    it('a disk light: the region is placed by T(center) and the light rows are that isometry applied', () => {
        const glsl = fragmentOf(s3LongArc, posedNee);
        const g = placementIsometry(S, [0, 0, 0], IDENTITY_QUAT, S3_DISK_LIGHT.position as [number, number, number]);
        expect(glsl).toContain(`const mat4 isometry_object_1 = ${formatMat4(S.inverse(g))};`);
        const center = formatVec4(mat4Apply(g, ORIGIN));
        const normal = formatVec4(mat4Apply(g, tangentAtOrigin([0, -1, 0])));
        expect(glsl).toContain(`DiskLight(${center}, 1.2, ${normal},`);
        expect(glsl).toContain('Disk(1.2, Direction(0.0, -1.0, 0.0, 0.0))');
    });

    it('the curved light bodies take the query, and the MIS pdf takes the transport\'s wo', () => {
        const glsl = fragmentOf(s3LongArc, posedMis);
        expect(glsl).toContain('ls = disk_light_sample(light_get_0(wl), q, xi);');
        expect(glsl).toContain('disk_light_pdf(light_get_0(light_hit.wl), q, light_hit.p, wo)');
        expect(glsl).toContain('lighting_pdf(s.prev_query, wo, lid, hit)');
        // the query's normal faces the side the receiver is seen from
        expect(glsl).toMatch(/LightQuery light_query_surface\(int mat, Hit hit, Direction wo\) \{\s*Direction n = ambient_dot\(wo, hit\.frame\.n, hit\.p\) < 0\.0 \? -hit\.frame\.n : hit\.frame\.n;/);
    });

    it('the camera uniforms are the vec4 frame at exp_o(position)', () => {
        const renderer = compiler.compileScene(s3LongArc, [posedNee]).renderers[0];
        const position = renderer.uniforms.find((x) => x.uniform === 'u_cameraPosition')!;
        expect(position.type).toBe('vec4');
        const p = position.compute!({ 'camera.position': S3_CAMERA.position, 'camera.target': S3_CAMERA.target }) as number[];
        S.exp(S3_CAMERA.position as [number, number, number]).forEach((x, i) => expect(p[i]).toBeCloseTo(x, 12));
    });

    it('a {param}-driven transform becomes a mat4 uniform whose value is the inverse (transposed) isometry', () => {
        const scene: SceneDescription = {
            ...s3LongArc,
            objects: [{ type: 'sphere', parameters: { center: [0.2, 0, 0], radius: 0.3 }, transform: { position: { param: 'ball.position', default: [0, 0.4, 0] } }, material: 'receiver' }],
        };
        const renderer = compiler.compileScene(scene, [posedNee]).renderers[0];
        const u = renderer.uniforms.find((x) => x.uniform === 'u_object0Isometry')!;
        expect(u.type).toBe('mat4');
        const moved = u.compute!({ 'ball.position': [0.1, -0.2, 0.3] }) as number[];
        const want = S.inverse(placementIsometry(S, [0.1, -0.2, 0.3], IDENTITY_QUAT, [0.2, 0, 0]));
        moved.forEach((x, i) => expect(x).toBeCloseTo(want[i], 12));
    });
});

describe('S³ Validator rules', () => {
    const furnace = withPose(s3FurnaceStrategy, [0, 0, 0], [0, 0, -1]);

    it('accepts the furnace as authored', () => {
        expect(errorsOf(s3Furnace, furnace)).toBe('');
    });

    it('rejects a curvature parameter and a missing camera pose', () => {
        expect(errorsOf({ ...s3Furnace, ambientSpace: { type: 'spherical', parameters: { curvature: 2 } } }, furnace))
            .toContain('curvature fixed at magnitude 1');
        expect(errorsOf(s3Furnace, s3FurnaceStrategy)).toContain('needs an authored camera position and target');
    });

    it('rejects an environment: S³ has no sky', () => {
        expect(errorsOf({ ...s3Furnace, environment: { type: 'constant', color: [0.2, 0.3, 0.5] } }, furnace))
            .toContain('an environment: not implemented in spherical space');
    });

    it('rejects an ambient medium, a marched object and an occupant with no S³ body, naming each', () => {
        const fogged: SceneDescription = {
            ...s3Furnace, ambientMedium: 'fog',
            materials: { ...s3Furnace.materials, fog: { model: 'none', medium: { sigma_a: [0.1, 0.1, 0.1], sigma_s: [0, 0, 0] } } },
        };
        expect(errorsOf(fogged, furnace))
            .toContain('an ambient medium: not implemented in spherical space');
        const marched = { ...s3Furnace, objects: [{ type: 'sphere', parameters: { radius: 0.3 }, material: 'furnace', backend: 'sdf' }] } as SceneDescription;
        expect(errorsOf(marched, furnace)).toContain('marched objects: not implemented in spherical space');
        const box = { ...s3Furnace, objects: [{ type: 'box', parameters: { halfSize: [0.3, 0.3, 0.3] }, material: 'furnace' }] } as SceneDescription;
        expect(errorsOf(box, furnace)).toContain("primitive 'box' has no spherical implementation");
        const quad = { ...s3LongArc, lights: [{ kind: 'quad', corner: [0, 1, 0], edge1: [0.2, 0, 0], edge2: [0, 0, 0.2], emission: 1 }] } as SceneDescription;
        expect(errorsOf(quad, posedNee)).toContain("light kind 'quad' has no spherical implementation");
    });
});
