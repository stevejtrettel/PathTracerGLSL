// compiler/generate/features/camera.ts
// Camera: the ray-generation snippet + its uniforms and UI parameters.
// (The TAN_FOV define stays in ShaderBuilder.buildHeader for step i-a; it moves
// here as a uniform in proving case (a) — see docs/impl-plan-2.10-contributions.md.)

import type { RenderPlan, ProgramDescription } from '../../plan/types.js';
import type { DiagnosticBag } from '../../../errors/core/DiagnosticBag.js';
import { emptyContribution, type FeatureContribution } from './types.js';

import cameraPinholeGLSL from '../glsl/camera_pinhole.glsl?raw';

export function contributeCamera(plan: RenderPlan, bag: DiagnosticBag): FeatureContribution {
    const program = plan.program;
    return {
        ...emptyContribution(),
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
}

function cameraOrigin(program: ProgramDescription): string {
    if (program.camera.type === 'pinhole') return 'glsl/camera_pinhole.glsl';
    return `generated:camera-${program.camera.type}`;
}

function buildCameraSource(program: ProgramDescription, bag: DiagnosticBag): string {
    if (program.camera.type === 'pinhole') {
        return cameraPinholeGLSL;
    }
    bag.error('invalid-setting', `Camera type '${(program.camera as any).type}' not yet supported`).add();
    return '// unsupported camera';
}
