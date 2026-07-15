// components/transport/techniques/equiangular.ts
// Equiangular medium NEE — glue for the T2 placement variant (impl-plan-equiangular).
// The MATH lives in equiangular.glsl (static); this file declares the inclusion and
// the seams. No carried state, no combiner call in v1 (nee-only, weight 1 —
// placement-MIS is the deferred exit). The technique replaces light_medium.glsl's
// at-vertex site: the walk emits ONE of the two at the medium sites, per the
// estimator.mediumLightSampling axis — the roster in action.

import type { ShaderBlock } from '../../../../compiler/generate/ShaderIR.js';
import type { Flags } from '../../flags.js';
import equiangularGLSL from './equiangular.glsl?raw';

export function equiangularBlocks(f: Flags): ShaderBlock[] {
    if (!f.equiangular) return [];
    return [{ origin: 'components/transport/techniques/equiangular/equiangular.glsl', source: equiangularGLSL }];
}

export function equiangularRequires(f: Flags): string[] {
    if (!f.equiangular) return [];
    return ['lighting_query_delta', 'shadow_transmittance', 'scene_medium_properties', 'interaction_medium_eval'];
}
