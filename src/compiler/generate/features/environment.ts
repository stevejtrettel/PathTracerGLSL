// compiler/generate/features/environment.ts
// Environment: what a ray sees when it hits nothing (contracts §2.10 / review C3).
//
// Every kind fills the same function — `environment_radiance(vec3 dir) -> vec3` —
// with a different body + resources:
//   none     → black
//   constant → live u_environment_color * u_environment_intensity
//   image    → equirect lookup through the chart (env_equirect.glsl; T2). The radiance
//              texture arrives via `extern:env_map` — the app loads the .hdr into the
//              engine registry; the executor binds it like any pass input (§2.10).
//   procedural → T4 (bake-to-table); rejected with a diagnostic until then.

import type { RenderPlan } from '../../plan/types.js';
import type { PlannedUniform } from '../../plan/types.js';
import type { ParameterMetadata } from '../../../engine/types.js';
import type { DiagnosticBag } from '../../../errors/core/DiagnosticBag.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import envChartEquirectGLSL from '../glsl/env_chart_equirect.glsl?raw';
import envChartOctahedralGLSL from '../glsl/env_chart_octahedral.glsl?raw';
import envSamplerCdfGLSL from '../glsl/env_sampler_cdf.glsl?raw';

const ORIGIN = 'generated:environment';

// Shared azimuth rotation (used by the octahedral chart and procedural radiance bodies).
const ROTATE_BLOCK = {
    origin: 'generated:env-rotate',
    source: '// Azimuth rotation by +a (adds a to atan(z, x)) — the chart rotation in direction space\n'
        + 'vec3 env_rotate_y(vec3 d, float a) {\n'
        + '    float c = cos(a), s = sin(a);\n'
        + '    return vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z);\n'
        + '}',
};

/** T5 variant table suffix: which registered CDF pair this program samples. */
export function envVariantSuffix(chart: 'equirect' | 'octahedral', compensation: boolean): string {
    return (chart === 'octahedral' ? '_oct' : '') + (compensation ? '_comp' : '');
}

function chartBlock(chart: 'equirect' | 'octahedral') {
    return chart === 'octahedral'
        ? { origin: 'glsl/env_chart_octahedral.glsl', source: envChartOctahedralGLSL }
        : { origin: 'glsl/env_chart_equirect.glsl', source: envChartEquirectGLSL };
}

/** Per-chart table dimensions live on separate parameter paths (they differ: W×H vs N×N). */
function sizeParamPath(chart: 'equirect' | 'octahedral'): string {
    return chart === 'octahedral' ? 'env.sizeOct' : 'env.size';
}

// Constant env, samplable (D6 opt-in): uniform-sphere sampling, pdf = 1/(4π) exactly.
// The cheap path to the miss-MIS bookkeeping witnesses — no textures anywhere.
const CONSTANT_SAMPLER = `// Constant environment as a light (uniform sphere, T3)
float environment_pdf(vec3 dir) {
    return 1.0 / (4.0 * PI);
}
LightSample environment_sample(Point p, vec2 xi) {
    LightSample ls;
    float z = 1.0 - 2.0 * xi.x;
    float r = sqrt(max(0.0, 1.0 - z * z));
    float phi = TWO_PI * xi.y;
    ls.wi = vec3(r * cos(phi), z, r * sin(phi));
    ls.distance = 1.0e20;                                          // §6.1 environment convention
    ls.radiance = u_environment_color * u_environment_intensity;   // without visibility
    ls.pdf = 1.0 / (4.0 * PI);                                     // per-light; selection applied by lighting_sample
    ls.flags = 0u;                                                 // not delta — BSDF paths see the env on miss
    ls.light_id = -1;
    return ls;
}`;

export function contributeEnvironment(plan: RenderPlan, bag: DiagnosticBag): FeatureContribution {
    void bag;   // all four kinds are implemented (T4); kept for future env diagnostics
    const env = plan.program.environment;

    // The samplable decision is Planner-resolved (T2: single source of truth for lighting,
    // transport, and this feature — they must agree or the estimators diverge).
    const samplable = plan.program.environmentSamplable;

    if (env.type === 'constant') {
        const intensity = env.intensity ?? 1.0;
        const uniforms: PlannedUniform[] = [
            { name: 'u_environment_color', type: 'vec3', parameterPath: 'environment.color', default: env.color },
            { name: 'u_environment_intensity', type: 'float', parameterPath: 'environment.intensity', default: intensity },
        ];
        const parameters: Record<string, ParameterMetadata> = {
            'environment.color': { type: 'color', default: env.color, name: 'Sky color', group: 'Environment', triggersReset: true },
            'environment.intensity': { type: 'float', default: intensity, range: [0, 5], name: 'Sky intensity', group: 'Environment', triggersReset: true },
        };
        const blocks = [{ origin: ORIGIN, source: radianceFn('return u_environment_color * u_environment_intensity;') }];
        if (samplable) blocks.push({ origin: 'generated:environment-sampler', source: CONSTANT_SAMPLER });
        return {
            ...emptyContribution(),
            blocks,
            defines: samplable ? { ENV_SAMPLABLE: '' } : {},
            uniforms,
            parameters,
        };
    }

    if (env.type === 'image') {
        const intensity = env.intensity ?? 1.0;
        const rotation = env.rotation ?? 0.0;
        const uniforms: PlannedUniform[] = [
            { name: 'u_envIntensity', type: 'float', parameterPath: 'env.intensity', default: intensity },
            { name: 'u_envRotation', type: 'float', parameterPath: 'env.rotation', default: rotation },
        ];
        const parameters: Record<string, ParameterMetadata> = {
            'env.intensity': { type: 'float', default: intensity, range: [0, 5], name: 'Env intensity', group: 'Environment', triggersReset: true },
            'env.rotation': { type: 'float', default: rotation, range: [-Math.PI, Math.PI], name: 'Env rotation', group: 'Environment', triggersReset: true },
        };
        // RADIANCE IS CHART-INDEPENDENT (D11: the integrand is held fixed across samplers):
        // the map is equirect, so the lookup uses its own fixed equirect mapping — the
        // swappable env_chart_* seam belongs exclusively to the SAMPLER below.
        const { chart, compensation } = plan.program.estimator.envSampler;
        const blocks = [
            ROTATE_BLOCK,
            { origin: ORIGIN, source: '// Fixed equirect map lookup (sampler-chart-independent)\n'
                + 'vec2 env_map_uv(vec3 dir) {\n'
                + '    vec3 n = normalize(dir);\n'
                + '    return vec2((atan(n.z, n.x) + u_envRotation) * (1.0 / TWO_PI) + 0.5,\n'
                + '                acos(clamp(n.y, -1.0, 1.0)) * (1.0 / PI));\n'
                + '}\n'
                + radianceFn('return texture(u_envMap, env_map_uv(dir)).rgb * u_envIntensity;') },
        ];
        const textures = [{ name: 'u_envMap', source: 'extern:env_map' }];
        if (samplable) {
            const suffix = envVariantSuffix(chart, compensation);
            blocks.splice(1, 0, chartBlock(chart));   // chart before radiance/sampler
            blocks.push({ origin: 'glsl/env_sampler_cdf.glsl', source: envSamplerCdfGLSL });
            textures.push(
                { name: 'u_envCdfCond', source: `extern:env_cdf_cond${suffix}` },
                { name: 'u_envCdfMarg', source: `extern:env_cdf_marg${suffix}` },
            );
            uniforms.push({ name: 'u_envSize', type: 'vec2', parameterPath: sizeParamPath(chart), default: [1, 1] });
        }
        return {
            ...emptyContribution(),
            blocks,
            defines: samplable ? { ENV_SAMPLABLE: '' } : {},
            uniforms,
            parameters,
            textures,
        };
    }

    if (env.type === 'procedural') {
        // T4: the formula IS the radiance (direct-eval — sharp, resolution-free, D7); the
        // baked table exists only as CPU CDF food. No radiance texture at all: the sampler's
        // radiance is environment_radiance(ls.wi) by the T4 unification.
        const intensity = env.intensity ?? 1.0;
        const rotation = env.rotation ?? 0.0;
        const uniforms: PlannedUniform[] = [
            { name: 'u_envIntensity', type: 'float', parameterPath: 'env.intensity', default: intensity },
            { name: 'u_envRotation', type: 'float', parameterPath: 'env.rotation', default: rotation },
        ];
        const parameters: Record<string, ParameterMetadata> = {
            'env.intensity': { type: 'float', default: intensity, range: [0, 5], name: 'Env intensity', group: 'Environment', triggersReset: true },
            'env.rotation': { type: 'float', default: rotation, range: [-Math.PI, Math.PI], name: 'Env rotation', group: 'Environment', triggersReset: true },
        };
        const { chart, compensation } = plan.program.estimator.envSampler;
        const blocks = [
            ROTATE_BLOCK,
            // env_rotate_y(dir, +rot) evaluates the formula at the TABLE azimuth — the exact
            // direction-space form of the chart's rotation term, so the direct-eval'd field
            // and the CDF (baked unrotated, sampled through the chart) agree under rotation.
            // GLSL params are value copies: reassigning `dir` scopes the rotation to the
            // formula without touching the author's expression.
            { origin: ORIGIN, source: radianceFn(`dir = env_rotate_y(normalize(dir), u_envRotation);\n    return (${env.glsl.source}) * u_envIntensity;`) },
        ];
        const textures: FeatureContribution['textures'] = [];
        if (samplable) {
            const suffix = envVariantSuffix(chart, compensation);
            blocks.splice(1, 0, chartBlock(chart));   // chart before radiance/sampler
            blocks.push({ origin: 'glsl/env_sampler_cdf.glsl', source: envSamplerCdfGLSL });
            textures.push(
                { name: 'u_envCdfCond', source: `extern:env_cdf_cond${suffix}` },
                { name: 'u_envCdfMarg', source: `extern:env_cdf_marg${suffix}` },
            );
            uniforms.push({ name: 'u_envSize', type: 'vec2', parameterPath: sizeParamPath(chart), default: [1, 1] });
        }
        return {
            ...emptyContribution(),
            blocks,
            defines: samplable ? { ENV_SAMPLABLE: '' } : {},
            uniforms,
            parameters,
            textures,
        };
    }

    // none (and the fallback)
    return {
        ...emptyContribution(),
        blocks: [{ origin: ORIGIN, source: radianceFn('return SPECTRUM_ZERO;') }],  // §2.5: radiometric, not raw vec3
    };
}

function radianceFn(body: string): string {
    return `// Environment radiance\nvec3 environment_radiance(vec3 dir) {\n    ${body}\n}`;
}
