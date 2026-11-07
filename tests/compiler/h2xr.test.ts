// H²×R programs (the h2xr occupant): the H²×R witness scenes compile and pass the glslang static
// check, placements reach the shader in the occupant's encoding (the height shift in m[3][1]) and
// are applied through isometry_point/isometry_tangent, light rows are the placement applied, and the
// Validator's H²×R rules (the normal constraints, rotations about the vertical only, what is not
// built) report what they should.

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/compiler/Compiler.js';
import { glslangCheck } from '../helpers/glslangCheck.js';
import {
    h2xrSuite, h2xrFurnace, h2xrDiskLight, h2xrFurnaceStrategy, h2xrDirectNeeStrategy, H2XR_DISK_CAMERA, H2XR_DISK_LIGHT,
} from '../witnesses/scenes/h2xrWitness.js';
import { h2xrGeometry as G } from '../../src/components/ambient/h2xr/h2xr.js';
import { ORIGIN, placementIsometry, tangentAtOrigin } from '../../src/components/ambient/isometry.js';
import { formatMat4, formatVec4 } from '../../src/components/glsl-format.js';
import { IDENTITY_QUAT, quatFromAxisAngle } from '../../src/components/geometry/similarity.js';
import { withPose } from '../../src/authoring/strategy.js';
import type { RenderStrategy, SceneDescription } from '../../src/compiler/types.js';

const compiler = new Compiler();
const fragmentOf = (scene: SceneDescription, strategy: RenderStrategy): string =>
    [...compiler.compileScene(scene, [strategy]).renderers[0].shaders.entries()].find(([id]) => id.endsWith('-main'))![1].fragment;
const posedNee = withPose(h2xrDirectNeeStrategy, H2XR_DISK_CAMERA.position, H2XR_DISK_CAMERA.target);
const furnace = withPose(h2xrFurnaceStrategy, [0, 0, 0], [0, 0, -1]);

function errorsOf(scene: SceneDescription, strategy: RenderStrategy): string {
    try {
        compiler.compileScene(scene, [strategy]);
        return '';
    } catch (err) {
        return String(err);
    }
}

describe('H²×R witness programs', () => {
    for (const [id, entry] of Object.entries(h2xrSuite)) {
        it(`${id} compiles and passes the glslang static check`, () => {
            const compiled = compiler.compileScene(entry.scene, entry.strategies);
            for (const r of compiled.renderers) {
                for (const [sid, program] of r.shaders) glslangCheck(program.fragment, 'frag', sid);
            }
        }, 60000);
    }
});

describe('H²×R placements and light rows', () => {
    it('a disk light: the region is placed by T(center), applied through the occupant, and the light rows are that isometry applied', () => {
        const glsl = fragmentOf(h2xrDiskLight, posedNee);
        const g = placementIsometry(G, [0, 0, 0], IDENTITY_QUAT, H2XR_DISK_LIGHT.position as [number, number, number]);
        const inv = G.inverse(g);
        expect(inv[13]).toBeCloseTo(-H2XR_DISK_LIGHT.position[1], 14);   // the height shift, in m[3][1]
        expect(glsl).toContain(`const mat4 isometry_object_1 = ${formatMat4(inv)};`);
        expect(glsl).toContain('Ray lray = make_ray(isometry_point(isometry_object_1, ray.origin), isometry_tangent(isometry_object_1, ray.direction), ray.wl);');
        const center = formatVec4(G.apply(g, ORIGIN));
        const normal = formatVec4(G.applyTangent(g, tangentAtOrigin([0, -1, 0])));
        expect(glsl).toContain(`DiskLight(${center}, 1.2, ${normal},`);
        expect(glsl).toContain('Disk(1.2, Direction(0.0, -1.0, 0.0, 0.0))');
        expect(glsl).toContain('ls.radiance = l.radiance;');
        expect(glsl).toContain('h2xr_area_density(q.p, y)');
    });

    it('a {param}-driven transform becomes a mat4 uniform holding the encoded inverse', () => {
        const scene: SceneDescription = {
            ...h2xrDiskLight,
            objects: [{
                type: 'sphere', parameters: { center: [0.2, 0.1, 0], radius: 0.3 }, material: 'receiver',
                transform: { position: { param: 'ball.position', default: [0, 0.4, 0] }, rotation: { axis: [0, 1, 0], angle: { param: 'ball.angle', default: 0.5 } } },
            }],
        };
        const renderer = compiler.compileScene(scene, [posedNee]).renderers[0];
        const u = renderer.uniforms.find((x) => x.uniform === 'u_object0Isometry')!;
        expect(u.type).toBe('mat4');
        const moved = u.compute!({ 'ball.position': [0.1, -0.2, 0.3], 'ball.angle': 1.2 }) as number[];
        const want = G.inverse(placementIsometry(G, [0.1, -0.2, 0.3], quatFromAxisAngle([0, 1, 0], 1.2), [0.2, 0.1, 0]));
        moved.forEach((x, i) => expect(x).toBeCloseTo(want[i], 12));
        expect(moved[13]).toBeCloseTo(-(-0.2 + 0.1), 12);
    });

    it('the camera uniforms are the vec4 frame at exp_o(position)', () => {
        const renderer = compiler.compileScene(h2xrDiskLight, [posedNee]).renderers[0];
        const position = renderer.uniforms.find((x) => x.uniform === 'u_cameraPosition')!;
        expect(position.type).toBe('vec4');
        const p = position.compute!({ 'camera.position': H2XR_DISK_CAMERA.position, 'camera.target': H2XR_DISK_CAMERA.target }) as number[];
        G.exp(H2XR_DISK_CAMERA.position as [number, number, number]).forEach((x, i) => expect(p[i]).toBeCloseTo(x, 12));
    });
});

describe('H²×R Validator rules', () => {
    it('accepts the furnace as authored', () => {
        expect(errorsOf(h2xrFurnace, furnace)).toBe('');
    });

    it('rejects a tilted plane normal and a tilted disk or disk-light normal', () => {
        const tiltedPlane = { ...h2xrFurnace, objects: [{ type: 'plane', parameters: { normal: [1, 1, 0], offset: 0.5 }, material: 'furnace' }] } as SceneDescription;
        expect(errorsOf(tiltedPlane, furnace)).toContain('must be vertical (x = z = 0) or horizontal (y = 0) in h2xr space');
        const tiltedDisk = { ...h2xrFurnace, objects: [{ type: 'disk', parameters: { radius: 0.3, normal: [0, 0, 1] }, material: 'furnace' }] } as SceneDescription;
        expect(errorsOf(tiltedDisk, furnace)).toContain('must be vertical (x = z = 0) in h2xr space');
        const tiltedLight = { ...h2xrDiskLight, lights: [{ ...h2xrDiskLight.lights[0], normal: [0.1, -1, 0] }] } as SceneDescription;
        expect(errorsOf(tiltedLight, posedNee)).toContain('must be vertical (x = z = 0) in h2xr space');
    });

    it('rejects a rotation about a non-vertical axis (constant or driven quaternion), accepts one about y', () => {
        // a non-emissive ball: a driven transform on a sampled emitter has its own error
        const rotated = (rotation: unknown) => ({
            ...h2xrFurnace,
            objects: [...h2xrFurnace.objects.slice(0, 6), { type: 'sphere', parameters: { radius: 0.1 }, material: 'matte', transform: { rotation } }],
            materials: { ...h2xrFurnace.materials, matte: { model: 'lambert', albedo: [0.5, 0.5, 0.5] } },
        }) as SceneDescription;
        const message = 'object rotations about a non-vertical axis: not implemented in h2xr space';
        expect(errorsOf(rotated({ axis: [1, 0, 0], angle: 0.3 }), furnace)).toContain(message);
        expect(errorsOf(rotated({ param: 'q', default: [0, 0, 0, 1] }), furnace)).toContain(message);
        expect(errorsOf(rotated({ axis: [0, 2, 0], angle: { param: 'a', default: 0.3 } }), furnace)).toBe('');
        expect(errorsOf(rotated([0, 0.38941834, 0, 0.92106099]), furnace)).toBe('');
    });

    it('rejects what is not built in H²×R, naming each', () => {
        const fog = { model: 'none' as const, medium: { sigma_a: [0.1, 0.1, 0.1] as [number, number, number], sigma_s: [0.5, 0.5, 0.5] as [number, number, number] } };
        const fogged = { ...h2xrFurnace, objects: [...h2xrFurnace.objects, { type: 'sphere', parameters: { radius: 0.1 }, material: 'fog' }], materials: { ...h2xrFurnace.materials, fog } } as SceneDescription;
        expect(errorsOf(fogged, furnace)).toContain('has no h2xr implementation');
        const box = { ...h2xrFurnace, objects: [{ type: 'box', parameters: { halfSize: [0.3, 0.3, 0.3] }, material: 'furnace' }] } as SceneDescription;
        expect(errorsOf(box, furnace)).toContain("primitive 'box' has no h2xr implementation");
        const sphereLight = { ...h2xrDiskLight, lights: [{ kind: 'sphere', position: [0, 1, 0], radius: 0.2, emission: 1 }] } as SceneDescription;
        expect(errorsOf(sphereLight, posedNee)).toContain("light kind 'sphere' has no h2xr implementation");
        const sampledSky = { ...h2xrFurnace, environment: { type: 'procedural', glsl: { kind: 'glsl', source: 'vec3(1.0)' } } } as SceneDescription;
        expect(errorsOf(sampledSky, withPose({ ...h2xrFurnaceStrategy, estimator: { ...h2xrFurnaceStrategy.estimator, directLighting: 'nee' } }, [0, 0, 0], [0, 0, -1])))
            .toContain('an environment sampled as a light: not implemented in h2xr space');
    });
});
