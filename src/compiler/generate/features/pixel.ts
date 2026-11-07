// compiler/generate/features/pixel.ts
// Pixel filter: the reconstruction kernel h_j(u) that turns a pixel center + a sub-pixel sample
// into a continuous film point, so the camera stays a pure film-point → ray map. The plan's
// resolved `measurement.pixel` names the PIXEL_MODELS occupant; its file is included whole.

import type { RenderPlan } from '../../plan/types.js';
import type { DiagnosticBag } from '../../../errors/core/DiagnosticBag.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import { PIXEL_MODELS } from '../../../components/pixel/index.js';

export function contributePixel(plan: RenderPlan, bag: DiagnosticBag): FeatureContribution {
    const id = plan.program.measurement.pixel;
    const model = PIXEL_MODELS[id];
    if (model === undefined) {
        // Backstop: the Validator gates measurement.pixel against the same registry.
        bag.error('invalid-setting', `Pixel filter '${id}' not yet supported`).add();
        return { ...emptyContribution('pixel'), blocks: [{ origin: `generated:pixel-${id}`, source: '// unsupported pixel filter' }] };
    }
    return {
        ...emptyContribution('pixel'),
        provides: [{ name: 'pixel_sample', signature: 'vec2 pixel_sample(vec2 coord, vec2 xi)' }],
        blocks: [{ origin: model.origin, source: model.glsl }],
    };
}
