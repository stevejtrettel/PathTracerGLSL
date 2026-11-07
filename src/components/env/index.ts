// Environment-chart registry (estimator pick-one axis — plan D11: WHICH chart the env
// sampler's CDF table lives in; radiance is chart-independent). A chart occupant = one
// folder (env_chart_uv / env_chart_dir / env_texel_dOmega behind the pinned seam names)
// + one line below (D3: the name-ternaries in generate/features/environment.ts and
// EnvironmentBake.ts are dead). `sampler_cdf.glsl` at the family root is the SHARED
// chart-independent sampler both charts feed (structure-test allowlisted).
// A chart's GLSL is keyed by ambient space (descriptors.ts SpaceBodies): the charts serve
// only sky SAMPLING (the image lookup reads EQUIRECT_MAP whichever chart samples).

import equirectGLSL from './equirect/equirect.glsl?raw';
import equirectMapGLSL from './equirect/equirect_map.glsl?raw';
import octahedralGLSL from './octahedral/octahedral.glsl?raw';
import type { GlslFile, SpaceBodies } from '../descriptors.js';

/** The equirect mapping, equirect_uv (equirect/equirect_map.glsl): read by the equirect chart,
 *  and by the image environment's radiance lookup whichever chart samples it (the map itself is
 *  equirect). */
export const EQUIRECT_MAP: GlslFile = { origin: 'components/env/equirect/equirect_map.glsl', source: equirectMapGLSL };

export interface EnvChartDescriptor {
    /** Registry key — `estimator.envSampler` (Validator-gated). */
    id: string;
    /** Per space: the chart seam (env_chart_uv/dir/sample, env_texel_dOmega). */
    glsl: SpaceBodies;
    /** Files the chart's GLSL calls into, included before it wherever the chart is. */
    needs: GlslFile[];
}

/** The chart a sampled sky uses when the strategy names none. */
export const DEFAULT_ENV_CHART = 'equirect';

export const ENV_CHARTS: Record<string, EnvChartDescriptor> = {
    equirect: {
        id: 'equirect',
        glsl: { euclidean: { origin: 'components/env/equirect/equirect.glsl', source: equirectGLSL } },
        needs: [EQUIRECT_MAP],
    },
    octahedral: {
        id: 'octahedral',
        glsl: { euclidean: { origin: 'components/env/octahedral/octahedral.glsl', source: octahedralGLSL } },
        needs: [],
    },
};

/** The env extern-texture naming contract (E6): the compiler's `extern:` sources, the
 *  app's load orchestration, and the engine's registration all speak THESE names —
 *  declared once, here, beside the charts. Variant tables append envVariantSuffix
 *  (generate/features/environment.ts) per (chart, compensation). */
export const ENV_EXTERN_NAMES = { map: 'env_map', cond: 'env_cdf_cond', marg: 'env_cdf_marg' } as const;
