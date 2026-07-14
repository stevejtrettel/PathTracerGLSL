// compiler/generate/features/pixel.ts
// Pixel footprint: the reconstruction kernel h_j(u) that turns an integer pixel coord + a
// sub-pixel sample into a continuous film point. This is the sub-pixel placement that used
// to live inline in every camera; hoisting it makes the camera a pure film-point → ray map
// and makes the kernel a swappable measurement axis (box → tent → gaussian).
//
// Sole occupant 'box' (uniform footprint), included unconditionally — the sampler precedent
// (core.ts). A strategy knob arrives with the second occupant.

import type { RenderPlan } from '../../plan/types.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import { PIXEL_MODELS } from '../../../components/pixel/index.js';

export function contributePixel(_plan: RenderPlan): FeatureContribution {
    const box = PIXEL_MODELS.box;
    return {
        ...emptyContribution('pixel'),
        provides: [{ name: 'pixel_sample', signature: 'vec2 pixel_sample(vec2 coord, vec2 xi)' }],
        blocks: [{ origin: box.origin, source: box.glsl }],
    };
}
