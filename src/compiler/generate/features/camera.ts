// compiler/generate/features/camera.ts
// Camera: the ray-generation snippet + its uniforms, defines, and UI parameters.
//
// This feature owns the SHARED camera plumbing — the look-at uniforms, the image size,
// and the fov Value<number> → TAN_FOV block (a constant bakes to `#define TAN_FOV
// <literal>`; a { param } becomes the `u_tanFov` uniform aliased via `#define TAN_FOV
// u_tanFov`, so the occupant GLSL is unchanged either way). WHICH ray-generation body and
// any MODEL-UNIQUE params come from the camera registry (components/camera/index.ts):
// adding a camera is one folder + one registry line, no edit here.

import { isValueParam } from '../../types.js';
import type { RenderPlan } from '../../plan/types.js';
import type { DiagnosticBag } from '../../../errors/core/DiagnosticBag.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import { formatFloat } from '../../../components/glsl-format.js';
import { cameraModel } from '../../../components/camera/index.js';

export function contributeCamera(plan: RenderPlan, _bag: DiagnosticBag): FeatureContribution {
    const cam = plan.program.measurement.camera;
    const model = cameraModel(cam.type);

    const contribution: FeatureContribution = {
        ...emptyContribution('camera'),
        provides: [{ name: 'camera_generateRay', signature: 'Ray camera_generateRay(vec2 pixel, vec2 xiPixel, vec2 xiLens)' }],
        blocks: [{ origin: model.origin, source: model.glsl }],
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

    // fov is shared across projective cameras (pinhole + thin-lens); the Value<number>
    // treatment (const → define, param → live uniform) is identical for both.
    if ('fov' in cam) {
        const fov = cam.fov;
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

    // Model-unique live params (thin-lens aperture/focusDistance). Each is a slider that
    // triggers accumulation reset — these change the INTEGRAL (measurement §6.2).
    for (const p of model.params(cam)) {
        contribution.uniforms.push({ name: p.uniform, type: 'float', parameterPath: p.path, default: p.default });
        contribution.parameters[p.path] = {
            type: 'float',
            default: p.default,
            name: p.name,
            group: 'Camera',
            triggersReset: true,
            ...(p.range ? { range: p.range } : {}),
        };
    }

    return contribution;
}
