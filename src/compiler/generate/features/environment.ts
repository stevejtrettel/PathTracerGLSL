// compiler/generate/features/environment.ts
// Environment: what a ray sees when it hits nothing (contracts §2.10 / review C3).
//
// Every kind fills the same function — `environment_radiance(vec3 dir) -> vec3` —
// with a different body + resources:
//   none     → black
//   constant → baked (or {param}-driven) color * u_envIntensity
//   image    → equirect lookup through the chart (env_equirect.glsl; T2). The radiance
//              texture arrives via `extern:env_map` — the app loads the .hdr into the
//              engine registry; the executor binds it like any pass input (§2.10).
//   procedural → T4 (bake-to-table); rejected with a diagnostic until then.

import type { RenderPlan } from '../../plan/types.js';
import type { PlannedUniform } from '../../plan/types.js';
import type { ParameterMetadata } from '../../types.js';
import type { DiagnosticBag } from '../../../errors/core/DiagnosticBag.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import { formatSpectrum } from '../../../components/glsl-format.js';
import { emitValue, mintValueUniform, type ParamValue } from '../values.js';
import envChartEquirectGLSL from '../../../components/env/equirect/equirect.glsl?raw';
import envChartOctahedralGLSL from '../../../components/env/octahedral/octahedral.glsl?raw';
import envSamplerCdfGLSL from '../../../components/env/sampler_cdf.glsl?raw';

const ORIGIN = 'generated:environment';

// Shared azimuth rotation (used by the octahedral chart and procedural radiance bodies). The
// cos/sin of the rotation angle are CPU-precomputed and shipped as u_envRotCS (a DERIVED
// uniform — the GPU no longer takes a transcendental of a frame-constant angle per sample).
const ROTATE_BLOCK = {
    origin: 'generated:env-rotate',
    source: '// Azimuth rotation, cs = (cos a, sin a) shipped as u_envRotCS (negate .y for −a)\n'
        + 'vec3 env_rotate_cs(vec3 d, vec2 cs) {\n'
        + '    return vec3(cs.x * d.x - cs.y * d.z, d.y, cs.y * d.x + cs.x * d.z);\n'
        + '}',
};

/** The DERIVED rotation pair (cos, sin) of `env.rotation`, computed on the CPU and shipped —
 *  minted wherever ROTATE_BLOCK's matrix rotation is used (octahedral chart / procedural body).
 *  The additive-rotation paths (equirect chart, the image map lookup) keep `u_envRotation`. */
function rotCsUniform(rotation: number): PlannedUniform {
    return {
        name: 'u_envRotCS', type: 'vec2', parameterPath: 'env.rotation',
        default: [Math.cos(rotation), Math.sin(rotation)],
        compute: (p) => { const r = (p['env.rotation'] as number) ?? rotation; return [Math.cos(r), Math.sin(r)]; },
    };
}

/** T5 variant table suffix: which registered CDF pair this program samples. */
export function envVariantSuffix(chart: 'equirect' | 'octahedral', compensation: boolean): string {
    return (chart === 'octahedral' ? '_oct' : '') + (compensation ? '_comp' : '');
}

function chartBlock(chart: 'equirect' | 'octahedral') {
    return chart === 'octahedral'
        ? { origin: 'components/env/octahedral/octahedral.glsl', source: envChartOctahedralGLSL }
        : { origin: 'components/env/equirect/equirect.glsl', source: envChartEquirectGLSL };
}

/** Per-chart table dimensions live on separate parameter paths (they differ: W×H vs N×N). */
function sizeParamPath(chart: 'equirect' | 'octahedral'): string {
    return chart === 'octahedral' ? 'env.sizeOct' : 'env.size';
}

// Constant env, samplable (D6 opt-in): uniform-sphere sampling, pdf = 1/(4π) exactly.
// The cheap path to the miss-MIS bookkeeping witnesses — no textures anywhere.
// The pdf query is a separate generated block: its only readers are the MIS sites
// (environmentPdf decision); the sampler carries its own ls.pdf inline.
const CONSTANT_PDF = `float environment_pdf(vec3 dir) {
    return 1.0 / (4.0 * PI);
}`;
// The color is a SCENE_VALUE — `colorExpr` is its baked literal (constant) or `u_` name (driven).
const constantSampler = (colorExpr: string) => `// Constant environment as a light (uniform sphere, T3)
LightSample environment_sample(Point p, vec2 xi) {
    LightSample ls;
    float z = 1.0 - 2.0 * xi.x;
    float r = sqrt(max(0.0, 1.0 - z * z));
    float phi = TWO_PI * xi.y;
    ls.wi = vec3(r * cos(phi), z, r * sin(phi));
    ls.distance = 1.0e20;                                          // §6.1 environment convention
    ls.radiance = ${colorExpr} * u_envIntensity;         // without visibility
    ls.pdf = 1.0 / (4.0 * PI);                                     // per-light; selection applied by lighting_sample
    ls.flags = 0u;                                                 // not delta — BSDF paths see the env on miss
    ls.light_id = -1;
    return ls;
}`;

/** T4 seams: every env kind provides the radiance body; samplable envs add the §6.1 pair.
 *  The pdf query: 'generated' = emitted iff the environmentPdf decision (constant env),
 *  'component' = it rides inside sampler_cdf.glsl regardless (wholesale inclusion) so the
 *  provide is declared component-scoped for the seam-unused check. */
function envProvides(samplable: boolean, pdf: 'none' | 'generated' | 'component'): Array<{ name: string; signature: string; componentScoped?: boolean }> {
    const provides: Array<{ name: string; signature: string; componentScoped?: boolean }> =
        [{ name: 'environment_radiance', signature: 'vec3 environment_radiance(vec3 dir)' }];
    if (samplable) {
        provides.push({ name: 'environment_sample', signature: 'LightSample environment_sample(Point p, vec2 xi)' });
        if (pdf !== 'none') {
            provides.push({
                name: 'environment_pdf',
                signature: 'float environment_pdf(vec3 dir)',
                ...(pdf === 'component' ? { componentScoped: true } : {}),
            });
        }
    }
    return provides;
}

export function contributeEnvironment(plan: RenderPlan, _bag: DiagnosticBag): FeatureContribution {
    const env = plan.program.environment;

    // The samplable decision is Planner-resolved (T2: single source of truth for lighting,
    // transport, and this feature — they must agree or the estimators diverge).
    const samplable = plan.program.environmentSamplable;

    if (env.type === 'constant') {
        const intensity = env.intensity ?? 1.0;
        // Sky color is a SCENE_VALUE (Model B): a constant bakes inline, a {param} becomes a
        // path-named uniform. Intensity is an always-live control (the owner-pinned exception),
        // under the SAME reserved `env.` path + u_envIntensity name as every other env kind.
        const colorExpr = emitValue(env.color as ParamValue, formatSpectrum as (x: never) => string);
        const uniforms: PlannedUniform[] = [
            { name: 'u_envIntensity', type: 'float', parameterPath: 'env.intensity', default: intensity },
        ];
        const parameters: Record<string, ParameterMetadata> = {
            'env.intensity': { type: 'float', default: intensity, range: [0, 5], name: 'Sky intensity', group: 'Environment', triggersReset: true },
        };
        mintValueUniform(env.color as ParamValue, 'vec3', 'color', uniforms, parameters, new Set());   // no-op if constant
        const blocks = [{ origin: ORIGIN, source: radianceFn(`return ${colorExpr} * u_envIntensity;`) }];
        if (samplable) blocks.push({ origin: 'generated:environment-sampler', source: constantSampler(colorExpr) });
        if (plan.program.environmentPdf) blocks.push({ origin: 'generated:environment-pdf', source: CONSTANT_PDF });
        return {
            ...emptyContribution('environment'),
            blocks,
            uniforms,
            parameters,
            provides: envProvides(samplable, plan.program.environmentPdf ? 'generated' : 'none'),
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
        const blocks = [
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
            const { chart, compensation } = plan.program.estimator.envSampler;
            const suffix = envVariantSuffix(chart, compensation);
            // env_rotate_y's only image-env caller is the octahedral chart (the equirect
            // chart and the fixed map lookup apply u_envRotation inline).
            blocks.unshift(chartBlock(chart));   // chart before radiance/sampler
            if (chart === 'octahedral') {
                blocks.unshift(ROTATE_BLOCK);        // rotate before its caller (the octahedral chart)
                uniforms.push(rotCsUniform(rotation));   // its matrix rotation ships u_envRotCS
            }
            blocks.push({ origin: 'components/env/sampler_cdf.glsl', source: envSamplerCdfGLSL });
            textures.push(
                { name: 'u_envCdfCond', source: `extern:env_cdf_cond${suffix}` },
                { name: 'u_envCdfMarg', source: `extern:env_cdf_marg${suffix}` },
            );
            uniforms.push({ name: 'u_envSize', type: 'vec2', parameterPath: sizeParamPath(chart), default: [1, 1] });
        }
        return {
            ...emptyContribution('environment'),
            blocks,
            uniforms,
            parameters,
            textures,
            provides: envProvides(samplable, samplable ? 'component' : 'none'),
        };
    }

    if (env.type === 'procedural') {
        // T4: the formula IS the radiance (direct-eval — sharp, resolution-free, D7); the
        // baked table exists only as CPU CDF food. No radiance texture at all: the sampler's
        // radiance is environment_radiance(ls.wi) by the T4 unification.
        const intensity = env.intensity ?? 1.0;
        const rotation = env.rotation ?? 0.0;
        // u_envRotation (the additive angle) is minted below ONLY for the equirect chart; the
        // radiance body + octahedral chart use the shipped cos/sin (u_envRotCS). The env.rotation
        // PARAMETER is always live (it drives both derived uniforms).
        const uniforms: PlannedUniform[] = [
            { name: 'u_envIntensity', type: 'float', parameterPath: 'env.intensity', default: intensity },
        ];
        const parameters: Record<string, ParameterMetadata> = {
            'env.intensity': { type: 'float', default: intensity, range: [0, 5], name: 'Env intensity', group: 'Environment', triggersReset: true },
            'env.rotation': { type: 'float', default: rotation, range: [-Math.PI, Math.PI], name: 'Env rotation', group: 'Environment', triggersReset: true },
        };
        const { chart, compensation } = plan.program.estimator.envSampler;
        const blocks = [
            ROTATE_BLOCK,   // the radiance body below always calls env_rotate_cs
            // env_rotate_y(dir, +rot) evaluates the formula at the TABLE azimuth — the exact
            // direction-space form of the chart's rotation term, so the direct-eval'd field
            // and the CDF (baked unrotated, sampled through the chart) agree under rotation.
            // GLSL params are value copies: reassigning `dir` scopes the rotation to the
            // formula without touching the author's expression.
            { origin: ORIGIN, source: radianceFn(`dir = env_rotate_cs(normalize(dir), u_envRotCS);\n    return (${env.glsl.source}) * u_envIntensity;`) },
        ];
        // Procedural radiance always uses the matrix rotation → always ships u_envRotCS.
        uniforms.push(rotCsUniform(rotation));
        const textures: FeatureContribution['textures'] = [];
        if (samplable) {
            const suffix = envVariantSuffix(chart, compensation);
            blocks.splice(1, 0, chartBlock(chart));   // chart before radiance/sampler
            blocks.push({ origin: 'components/env/sampler_cdf.glsl', source: envSamplerCdfGLSL });
            textures.push(
                { name: 'u_envCdfCond', source: `extern:env_cdf_cond${suffix}` },
                { name: 'u_envCdfMarg', source: `extern:env_cdf_marg${suffix}` },
            );
            uniforms.push({ name: 'u_envSize', type: 'vec2', parameterPath: sizeParamPath(chart), default: [1, 1] });
            // The equirect chart applies rotation ADDITIVELY (needs the angle, not cos/sin).
            if (chart === 'equirect') uniforms.push({ name: 'u_envRotation', type: 'float', parameterPath: 'env.rotation', default: rotation });
        }
        return {
            ...emptyContribution('environment'),
            blocks,
            uniforms,
            parameters,
            textures,
            provides: envProvides(samplable, samplable ? 'component' : 'none'),
        };
    }

    // none (and the fallback)
    return {
        ...emptyContribution('environment'),
        blocks: [{ origin: ORIGIN, source: radianceFn('return SPECTRUM_ZERO;') }],  // §2.5: radiometric, not raw vec3
        provides: envProvides(false, 'none'),
    };
}

function radianceFn(body: string): string {
    return `// Environment radiance\nvec3 environment_radiance(vec3 dir) {\n    ${body}\n}`;
}
