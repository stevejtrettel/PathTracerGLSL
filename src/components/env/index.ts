// Environment-chart registry (estimator pick-one axis — plan D11: WHICH chart the env
// sampler's CDF table lives in; radiance is chart-independent). A chart occupant = one
// folder (env_chart_uv / env_chart_dir / env_texel_dOmega behind the pinned seam names)
// + one line below (D3: the name-ternaries in generate/features/environment.ts and
// EnvironmentBake.ts are dead). `sampler_cdf.glsl` at the family root is the SHARED
// chart-independent sampler both charts feed (structure-test allowlisted).
// Origin is DERIVED from the key (components/env/<id>/<id>.glsl).

import equirectGLSL from './equirect/equirect.glsl?raw';
import octahedralGLSL from './octahedral/octahedral.glsl?raw';

export interface EnvChartDescriptor {
    /** Registry key — `estimator.envSampler` (Validator-gated). */
    id: string;
    /** ?raw source providing the chart seam (env_chart_uv/dir, env_texel_dOmega). */
    glsl: string;
}

export const ENV_CHARTS: Record<string, EnvChartDescriptor> = {
    equirect: { id: 'equirect', glsl: equirectGLSL },
    octahedral: { id: 'octahedral', glsl: octahedralGLSL },
};
