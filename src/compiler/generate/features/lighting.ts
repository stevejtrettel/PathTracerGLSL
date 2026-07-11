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
    if (plan.program.lighting === null) {
        return emptyContribution();
    }

    const blocks: ShaderBlock[] = [];
    const defines: Record<string, string> = {};
    // Shadow query behind the §6.3 contract — the compiler specializes: the boolean-fast-path
    // opaque form for media-free scenes, the spectral segment walker (composing the generated
    // medium_transmittance, seam 2) when media exist. The NEE call sites never change.
    if (plan.features.media.hasMedia) {
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

    blocks.push({
        origin: 'generated:light-sampling',
        source: generateLightSampling(plan.lights, plan.program.lighting.selection),
    });

    // §6.2 registry table + the transport emission-bookkeeping gate: only when a samplable
    // NON-DELTA emitter exists (delta-only scenes preprocess to the pre-area-light program).
    const samplable = plan.lights.filter((l) => l.regionId !== undefined);
    if (samplable.length > 0) {
        blocks.push({ origin: 'generated:light-of', source: generateLightOf(samplable) });
        defines['HAS_SAMPLABLE_EMITTERS'] = '';
    }

    return { ...emptyContribution(), blocks, defines };
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
 *  PowerLightSampler: point 4π·I, one-sided quad π·A·Le, sphere π·4πr²·Le. */
function lightPower(l: PlannedLight): number {
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

function generateLightSampling(lights: PlannedLight[], selection: 'uniform' | 'power'): string {
    const lines: string[] = ['// Generated light selection dispatcher (§6.1)'];

    if (lights.length === 0) {
        lines.push('LightSample lighting_sample(Point p, vec2 xi) {');
        lines.push('    LightSample ls; ls.pdf = 0.0; return ls;'); // no samplable light → NEE skipped
        lines.push('}');
        return lines.join('\n');
    }

    lines.push('LightSample lighting_sample(Point p, vec2 xi) {');
    lines.push('    LightSample ls;');

    if (lights.length === 1) {
        // Single light: selection is trivial (select_pdf = 1); total pdf = per-light pdf.
        lines.push(`    ls = ${sampleCall(lights[0], 'xi')};`);
        lines.push('    ls.light_id = 0;');
    } else {
        // Compile-time power-weighted (or uniform) CDF over samplable lights.
        const weights = lights.map((l) => (selection === 'uniform' ? 1 : lightPower(l)));
        const total = weights.reduce((a, b) => a + b, 0);
        const selectPdf = weights.map((w) => w / total);
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
    return lines.join('\n');
}
