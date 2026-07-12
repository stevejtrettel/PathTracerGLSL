// compiler/generate/features/lighting.ts
// Direct lighting (NEE): per-kind sampler libraries + the generated selection dispatcher +
// the light_of region table (§6.2 registry). Only present when the plan enables NEE.
// Mirrors the material pattern: fixed per-kind GLSL (light_point/quad/sphere.glsl) + a
// generated `lighting_sample` that CDF-selects a light and calls its kind sampler (§6.1/§3.3).

import type { RenderPlan, PlannedLight } from '../../plan/types.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import type { ShaderBlock } from '../ShaderIR.js';
import { formatFloat, formatVec3, formatSpectrum } from './glsl-format.js';
import { quadNormal } from './intersection.js';

import lightPointGLSL from '../glsl/light_point.glsl?raw';
import lightQuadGLSL from '../glsl/light_quad.glsl?raw';
import lightSphereGLSL from '../glsl/light_sphere.glsl?raw';
import shadowOpaqueGLSL from '../glsl/shadow_opaque.glsl?raw';
import shadowMediaGLSL from '../glsl/shadow_media.glsl?raw';

export function contributeLighting(plan: RenderPlan): FeatureContribution {
    if (plan.program.estimator.lighting === null) {
        return emptyContribution();
    }

    const blocks: ShaderBlock[] = [];
    const defines: Record<string, string> = {};
    const uniforms: FeatureContribution['uniforms'] = [];
    const parameters: FeatureContribution['parameters'] = {};

    // Environment as a light (T3): the env joins selection through a TWO-STAGE draw —
    // stage 0 picks env-vs-finite with probability u_envSelectProb, stage 1 is the baked
    // CDF (rescaled). The env's power is load-time data the baked CDF can't absorb; the
    // uniform is the deliberate deviation from reference §8's compile-time ENV_SELECT_PDF
    // (same structure — see impl-plan-env-as-light D3). Arnold's dome-as-dedicated-technique
    // is the precedent for the two-stage shape.
    const envSamplable = plan.program.environmentSamplable;
    const env = plan.program.environment;
    const envSelectDefault = plan.lights.length === 0
        ? 1.0                                                            // env-only: certainty
        : ((env.type === 'constant' || env.type === 'image') && env.selectWeight !== undefined
            ? env.selectWeight
            : 0.5);                                                      // plan O1 default
    if (envSamplable) {
        // The forward declarations let lighting_sample call the env sampler even though the
        // environment feature's block assembles AFTER lighting (feature order is pinned).
        blocks.push({
            origin: 'generated:env-light-decls',
            source: '// Environment-as-light forward declarations (defined by the environment feature)\n'
                + 'LightSample environment_sample(Point p, vec2 xi);\n'
                + 'float environment_pdf(vec3 dir);',
        });
        uniforms.push({ name: 'u_envSelectProb', type: 'float', parameterPath: 'env.selectProb', default: envSelectDefault });
        if (plan.lights.length > 0) {
            // Live-tunable ONLY when finite lights exist: in an env-only scene there is no
            // other technique to absorb the remaining mass — changing 1.0 would be bias.
            parameters['env.selectProb'] = {
                type: 'float', default: envSelectDefault, range: [0.05, 0.95],
                name: 'Env select P', group: 'Environment', triggersReset: true,
            };
        }
    }
    // Shadow query behind the §6.3 contract — the compiler specializes: the boolean-fast-path
    // opaque form for media-free scenes, the spectral segment walker (composing the generated
    // medium_transmittance, seam 2) when media exist. The NEE call sites never change.
    if (plan.program.media.shadowWalker) {
        blocks.push({ origin: 'glsl/shadow_media.glsl', source: shadowMediaGLSL });
        defines['MAX_SHADOW_SEGMENTS'] = '8';   // §6.3 pin; exhaustion is conservative (ZERO)
    } else {
        blocks.push({ origin: 'glsl/shadow_opaque.glsl', source: shadowOpaqueGLSL });
    }

    // Per-kind sampler libraries for the kinds present (declared before the dispatcher).
    if (plan.lights.some((l) => l.kind === 'point')) {
        blocks.push({ origin: 'glsl/light_point.glsl', source: lightPointGLSL });
    }
    if (plan.lights.some((l) => l.kind === 'quad')) {
        blocks.push({ origin: 'glsl/light_quad.glsl', source: lightQuadGLSL });
    }
    if (plan.lights.some((l) => l.kind === 'sphere')) {
        blocks.push({ origin: 'glsl/light_sphere.glsl', source: lightSphereGLSL });
    }

    // Selection pdfs are computed ONCE and shared by the sampler and the MIS pdf query —
    // lighting_pdf must byte-match lighting_sample's selection (the env-sampling lesson,
    // pitfall 11, applied to the CDF).
    const selection = plan.program.estimator.lighting.selection;
    const selectPdf = computeSelectPdf(plan.lights, selection);

    blocks.push({
        origin: 'generated:light-sampling',
        source: generateLightSampling(plan.lights, selectPdf, envSamplable),
    });

    // §6.2 registry table + the transport emission-bookkeeping gate: only when a samplable
    // NON-DELTA emitter exists (delta-only scenes preprocess to the pre-area-light program).
    // The DECISIONS are Planner-made (program.emitters, T2); the list is codegen data.
    const samplable = plan.lights.filter((l) => l.regionId !== undefined);
    if (plan.program.emitters.samplable) {
        blocks.push({ origin: 'generated:light-of', source: generateLightOf(samplable) });
        defines['HAS_SAMPLABLE_EMITTERS'] = '';
        // The MIS pdf query (§6.1): only under 'mis' — its sole reader is the emitter-hit weight.
        if (plan.program.emitters.lightingPdf) {
            blocks.push({ origin: 'generated:lighting-pdf', source: generateLightingPdf(plan.lights, selectPdf, envSamplable) });
        }
    }

    return { ...emptyContribution(), blocks, defines, uniforms, parameters };
}

// ============================================================================
// Generated region → light-id table (§6.2: identity lives on REGIONS, never materials —
// two panels sharing one emissive material are two lights)
// ============================================================================

function generateLightOf(samplable: PlannedLight[]): string {
    const lines: string[] = ['// Generated region -> samplable-light table (§6.2; -1 = path-only or non-emitter)'];
    lines.push('int light_of(int region) {');
    for (const l of samplable) {
        lines.push(`    if (region == ${l.regionId}) return ${l.id};`);
    }
    lines.push('    return -1;');
    lines.push('}');
    return lines.join('\n');
}

// ============================================================================
// Generated selection dispatcher (per-scene codegen)
// ============================================================================

function spectrumAverage(rgb: number[]): number {
    return (rgb[0] + rgb[1] + rgb[2]) / 3;
}

function quadArea(l: PlannedLight): number {
    const e1 = l.edge1!, e2 = l.edge2!;
    const cx = e1[1] * e2[2] - e1[2] * e2[1];
    const cy = e1[2] * e2[0] - e1[0] * e2[2];
    const cz = e1[0] * e2[1] - e1[1] * e2[0];
    return Math.hypot(cx, cy, cz);
}

/** Emitted power (watts-ish) for CDF selection — AREA-AWARE (pitfall 6: luminance-only
 *  weighting mis-prioritizes a big dim panel vs a tiny bright one). Formulas match pbrt's
 *  PowerLightSampler: point 4π·I, one-sided quad π·A·Le, sphere π·4πr²·Le.
 *  Exported for the H6 invariant tests. */
export function lightPower(l: PlannedLight): number {
    const avg = spectrumAverage(l.color.map((c) => c * l.intensity));
    switch (l.kind) {
        case 'point': return Math.max(1e-8, 4 * Math.PI * avg);
        case 'quad': return Math.max(1e-8, Math.PI * quadArea(l) * avg);
        case 'sphere': return Math.max(1e-8, Math.PI * 4 * Math.PI * l.radius! * l.radius! * avg);
        default: return 1e-8;
    }
}

/** GLSL call that samples light `l` at point `p`. Area kinds consume `xiExpr` (a vec2). */
function sampleCall(l: PlannedLight, xiExpr: string): string {
    const Le = formatSpectrum(l.color.map((c) => c * l.intensity)); // radiometric (§2.5)
    if (l.kind === 'point') {
        return `point_light_sample(${formatVec3(l.position!)}, ${Le}, p)`;
    }
    if (l.kind === 'quad') {
        const n = quadNormal(l.edge1!, l.edge2!);
        return `quad_light_sample(${formatVec3(l.corner!)}, ${formatVec3(l.edge1!)}, ${formatVec3(l.edge2!)}, ${formatVec3(n)}, ${formatFloat(quadArea(l))}, ${Le}, p, ${xiExpr})`;
    }
    if (l.kind === 'sphere') {
        return `sphere_light_sample(${formatVec3(l.position!)}, ${formatFloat(l.radius!)}, ${Le}, p, ${xiExpr})`;
    }
    throw new Error(`lighting: unsupported light kind '${l.kind}'`);
}

/** Compile-time selection pdfs — shared by lighting_sample and lighting_pdf.
 *  Exported for the H6 invariant tests. */
export function computeSelectPdf(lights: PlannedLight[], selection: 'uniform' | 'power'): number[] {
    if (lights.length === 0) return [];
    const weights = lights.map((l) => (selection === 'uniform' ? 1 : lightPower(l)));
    const total = weights.reduce((a, b) => a + b, 0);
    return weights.map((w) => w / total);
}

function generateLightSampling(lights: PlannedLight[], selectPdf: number[], envSamplable: boolean): string {
    const lines: string[] = ['// Generated light selection dispatcher (§6.1)'];

    if (lights.length === 0) {
        if (envSamplable) {
            // Env-only: selection probability 1 — lighting_sample IS the env sampler.
            lines.push('LightSample lighting_sample(Point p, vec2 xi) {');
            lines.push('    return environment_sample(p, xi);');
            lines.push('}');
            return lines.join('\n');
        }
        lines.push('LightSample lighting_sample(Point p, vec2 xi) {');
        lines.push('    LightSample ls; ls.pdf = 0.0; return ls;'); // no samplable light → NEE skipped
        lines.push('}');
        return lines.join('\n');
    }

    // With a samplable env, the finite-light dispatcher keeps its exact body under a private
    // name and a two-stage wrapper owns the env-vs-finite draw (cdf_rescale on stage 0's
    // random — pitfall 4 applies across stages too).
    const finiteName = envSamplable ? 'lighting_sample_finite' : 'lighting_sample';

    lines.push(`LightSample ${finiteName}(Point p, vec2 xi) {`);
    lines.push('    LightSample ls;');

    if (lights.length === 1) {
        // Single light: selection is trivial (select_pdf = 1); total pdf = per-light pdf.
        lines.push(`    ls = ${sampleCall(lights[0], 'xi')};`);
        lines.push('    ls.light_id = 0;');
    } else {
        // Compile-time power-weighted (or uniform) CDF over samplable lights.
        const cdf: number[] = [];
        let acc = 0;
        for (const sp of selectPdf) { acc += sp; cdf.push(acc); }

        // Selection + cdf_rescale (pitfall 4: NEVER reuse the raw selection random for surface
        // sampling — recover a fresh stratified coordinate from the selection interval).
        lines.push('    int light_id; float select_pdf; float xr;');
        for (let i = 0; i < lights.length - 1; i++) {
            const kw = i === 0 ? 'if' : 'else if';
            const lo = i === 0 ? '0.0' : formatFloat(cdf[i - 1]);
            lines.push(`    ${kw} (xi.x < ${formatFloat(cdf[i])}) { light_id = ${i}; select_pdf = ${formatFloat(selectPdf[i])}; xr = (xi.x - ${lo}) / ${formatFloat(selectPdf[i])}; }`);
        }
        const last = lights.length - 1;
        const lastLo = formatFloat(cdf[last - 1]);
        // The final else closes the CDF — no fallthrough (pitfall 5: the old fallback masked an
        // uninitialized-LightSample bug).
        lines.push(`    else { light_id = ${last}; select_pdf = ${formatFloat(selectPdf[last])}; xr = (xi.x - ${lastLo}) / ${formatFloat(selectPdf[last])}; }`);
        lines.push('    vec2 light_xi = vec2(clamp(xr, 0.0, 0.9999999), xi.y);');

        for (let i = 0; i < lights.length; i++) {
            if (i === 0) lines.push(`    if (light_id == ${i}) ls = ${sampleCall(lights[i], 'light_xi')};`);
            else if (i < lights.length - 1) lines.push(`    else if (light_id == ${i}) ls = ${sampleCall(lights[i], 'light_xi')};`);
            else lines.push(`    else ls = ${sampleCall(lights[i], 'light_xi')};`); // else guarantees ls is assigned
        }

        lines.push('    ls.light_id = light_id;');
        lines.push('    ls.pdf *= select_pdf;'); // total = per-light × selection (§6.1)
    }

    lines.push('    return ls;');
    lines.push('}');

    if (envSamplable) {
        lines.push('');
        lines.push('// Two-stage selection (env-as-light D3): stage 0 picks env vs the finite set;');
        lines.push('// pdfs scale by the SAME uniform on both sides (and in lighting_pdf and the');
        lines.push("// miss-MIS weight) — the byte-match invariant extends across the stage.");
        lines.push('LightSample lighting_sample(Point p, vec2 xi) {');
        lines.push('    if (xi.x < u_envSelectProb) {');
        lines.push('        vec2 env_xi = vec2(clamp(xi.x / u_envSelectProb, 0.0, 0.9999999), xi.y);');
        lines.push('        LightSample ls = environment_sample(p, env_xi);');
        lines.push('        ls.pdf *= u_envSelectProb;');
        lines.push('        return ls;');
        lines.push('    }');
        lines.push('    float finite_x = clamp((xi.x - u_envSelectProb) / (1.0 - u_envSelectProb), 0.0, 0.9999999);');
        lines.push('    LightSample ls = lighting_sample_finite(p, vec2(finite_x, xi.y));');
        lines.push('    ls.pdf *= (1.0 - u_envSelectProb);');
        lines.push('    return ls;');
        lines.push('}');
    }

    return lines.join('\n');
}

// ============================================================================
// Generated MIS pdf query (§6.1): the density with which lighting_sample(p, ·) would have
// produced direction wi TOWARD THE LIGHT THAT WAS HIT — identity is known (light_of at the
// emitter hit), no search. Per-kind solid-angle pdf recomputed from the hit geometry, × the
// SAME baked selection pdf as the sampler. Delta lights are never queried (pitfall 12) and
// carry no arm; unknown ids return 0 (weight → 1 on the BSDF side, conservative).
// ============================================================================

function generateLightingPdf(lights: PlannedLight[], selectPdf: number[], envSamplable: boolean): string {
    const lines: string[] = ['// Generated MIS pdf query (§6.1) — must mirror lighting_sample exactly'];
    // With a samplable env, every finite light's selection pdf carries the stage-0 factor —
    // exactly what the sampler applied. The env itself has no arm here (never hit; the miss
    // branch queries u_envSelectProb * environment_pdf directly, reference §8 line 3).
    const stage0 = envSamplable ? ' * (1.0 - u_envSelectProb)' : '';
    lines.push('float lighting_pdf(Point p, Direction wi, int light_id, Hit light_hit) {');
    for (let i = 0; i < lights.length; i++) {
        const l = lights[i];
        if (l.regionId === undefined) continue;   // delta: not hittable, never queried
        const select = formatFloat(lights.length === 1 ? 1.0 : selectPdf[i]) + stage0;
        lines.push(`    if (light_id == ${l.id}) {`);
        if (l.kind === 'quad') {
            const n = quadNormal(l.edge1!, l.edge2!);
            lines.push(`        float cos_l = dot(${formatVec3(n)}, -wi);`);
            lines.push('        if (cos_l <= 0.0) return 0.0;');
            lines.push('        vec3 d = light_hit.p - p;');
            lines.push(`        return ${select} * dot(d, d) / (${formatFloat(quadArea(l))} * cos_l);`);
        } else {
            // sphere: the cone pdf depends only on p (same formula as the sampler).
            lines.push(`        vec3 to_c = ${formatVec3(l.position!)} - p;`);
            lines.push('        float dc2 = dot(to_c, to_c);');
            lines.push(`        if (dc2 <= ${formatFloat(l.radius! * l.radius!)}) return 0.0;   // inside: sampler punts too`);
            lines.push(`        float cos_max = sqrt(max(0.0, 1.0 - ${formatFloat(l.radius! * l.radius!)} / dc2));`);
            lines.push(`        return ${select} / (TWO_PI * max(1e-8, 1.0 - cos_max));`);
        }
        lines.push('    }');
    }
    lines.push('    return 0.0;');
    lines.push('}');
    return lines.join('\n');
}
