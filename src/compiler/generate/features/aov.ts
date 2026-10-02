// compiler/generate/features/aov.ts
// The first-hit pictures (components/aov): each listed AOV's static GLSL, providing
// `<name>_aov` for the walk's capture site and requiring what its descriptor declares.
// Programs that list no AOVs get an empty contribution.

import type { RenderPlan } from '../../plan/types.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import { AOVS } from '../../../components/aov/index.js';

export function contributeAov(plan: RenderPlan): FeatureContribution {
    const aovs = (plan.program.measurement.aovs ?? []).map((name) => AOVS[name]);
    return {
        ...emptyContribution('aov'),
        blocks: aovs.map((a) => ({ origin: `components/aov/${a.name}/${a.name}.glsl`, source: a.glsl })),
        provides: aovs.map((a) => ({
            name: `${a.name}_aov`,
            signature: `vec3 ${a.name}_aov(int mat, Hit hit, Direction wo, MaterialProperties props, Spectrum weight)`,
        })),
        requires: aovs.flatMap((a) => a.requires),
    };
}
