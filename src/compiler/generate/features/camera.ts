// compiler/generate/features/camera.ts
// Camera: the ray-generation snippet + its uniforms, defines, and UI parameters.
//
// fov is a Value<number> (§2.8): a constant bakes to `#define TAN_FOV <literal>`;
// a { param } becomes the `u_tanFov` uniform (value = tan(fov/2)) with a live slider,
// aliased via `#define TAN_FOV u_tanFov` so camera_pinhole.glsl is unchanged either way.

import { isValueParam } from '../../types.js';
import type { RenderPlan, ProgramDescription } from '../../plan/types.js';
import type { DiagnosticBag } from '../../../errors/core/DiagnosticBag.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import { formatFloat } from '../../../components/glsl-format.js';

import cameraPinholeGLSL from '../../../components/camera/pinhole.glsl?raw';

export function contributeCamera(plan: RenderPlan, bag: DiagnosticBag): FeatureContribution {
    const program = plan.program;

    const contribution: FeatureContribution = {
        ...emptyContribution('camera'),
        provides: [{ name: 'camera_generateRay', signature: 'Ray camera_generateRay(vec2 pixel, vec2 xi)' }],
        blocks: [{ origin: cameraOrigin(program), source: buildCameraSource(program, bag) }],
        uniforms: [
            { name: 'u_cameraPosition', type: 'vec3', parameterPath: 'camera.position', default: [0, 0, 8] },
            { name: 'u_cameraTarget', type: 'vec3', parameterPath: 'camera.target', default: [0, 0, 0] },
            { name: 'u_imageSize', type: 'vec2', parameterPath: 'engine.imageSize' },
        ],
        parameters: {
            'camera.position': { type: 'vec3', default: [0, 0, 8], name: 'Position', group: 'Camera', triggersReset: true },
            'camera.target': { type: 'vec3', default: [0, 0, 0], name: 'Target', group: 'Camera', triggersReset: true },
        },
    };

    if (program.measurement.camera.type === 'pinhole') {
        const fov = program.measurement.camera.fov;
        if (isValueParam(fov)) {
            const path = fov.param;
            const def = fov.default ?? 0.8;
            contribution.defines['TAN_FOV'] = 'u_tanFov';
            contribution.uniforms.push({
                name: 'u_tanFov',
                type: 'float',
                parameterPath: path,
                default: Math.tan(def / 2),
                compute: (params) => Math.tan(((params[path] as number) ?? def) / 2),
            });
            contribution.parameters[path] = {
                type: 'float',
                default: def,
                name: 'FOV',
                group: 'Camera',
                triggersReset: true,
                ...(fov.min !== undefined && fov.max !== undefined ? { range: [fov.min, fov.max] } : {}),
            };
        } else {
            contribution.defines['TAN_FOV'] = formatFloat(Math.tan(fov / 2));
        }
    }

    return contribution;
}

function cameraOrigin(program: ProgramDescription): string {
    if (program.measurement.camera.type === 'pinhole') return 'components/camera/pinhole.glsl';
    return `generated:camera-${program.measurement.camera.type}`;
}

function buildCameraSource(program: ProgramDescription, bag: DiagnosticBag): string {
    if (program.measurement.camera.type === 'pinhole') {
        return cameraPinholeGLSL;
    }
    bag.error('invalid-setting', `Camera type '${(program.measurement.camera as any).type}' not yet supported`).add();
    return '// unsupported camera';
}
