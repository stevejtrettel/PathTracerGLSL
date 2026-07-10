// compiler/generate/features/lighting.ts
// Direct lighting (NEE): per-kind sampler libraries + the generated selection dispatcher.
// Only present when the plan enables NEE (scene has lights and the strategy asks for direct
// lighting). Mirrors the material pattern: fixed per-kind GLSL (light_point.glsl) + a generated
// `lighting_sample` dispatcher that CDF-selects a light and calls its kind sampler (§6.1/§3.3).

import type { RenderPlan, PlannedLight } from '../../plan/types.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import type { ShaderBlock } from '../ShaderIR.js';
import { formatFloat, formatVec3, formatSpectrum } from './glsl-format.js';

import lightPointGLSL from '../glsl/light_point.glsl?raw';
import shadowOpaqueGLSL from '../glsl/shadow_opaque.glsl?raw';

export function contributeLighting(plan: RenderPlan): FeatureContribution {
    if (plan.program.lighting === null) {
        return emptyContribution();
    }

    const blocks: ShaderBlock[] = [];
    // Shadow query behind the §6.3 contract. Opaque specialization now (no media); the media
    // form (reference §4) is a separate file the Planner selects later. Wraps scene_intersect_any.
    blocks.push({ origin: 'glsl/shadow_opaque.glsl', source: shadowOpaqueGLSL });
    // Per-kind sampler libraries for the kinds present (declared before the dispatcher calls them).
    if (plan.lights.some((l) => l.kind === 'point')) {
        blocks.push({ origin: 'glsl/light_point.glsl', source: lightPointGLSL });
    }
    blocks.push({
        origin: 'generated:light-sampling',
        source: generateLightSampling(plan.lights, plan.program.lighting.selection),
    });

    return { ...emptyContribution(), blocks };
}

// ============================================================================
// Generated selection dispatcher (per-scene codegen)
// ============================================================================

function spectrumAverage(rgb: number[]): number {
    return (rgb[0] + rgb[1] + rgb[2]) / 3;
}

/** GLSL call that samples light `l` at point `p`, returning a LightSample. */
function sampleCall(l: PlannedLight): string {
    if (l.kind === 'point') {
        const pos = formatVec3(l.position!);                                  // geometric
        const intensity = formatSpectrum(l.color.map((c) => c * l.intensity)); // radiometric (§2.5)
        return `point_light_sample(${pos}, ${intensity}, p)`;
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
        lines.push(`    ls = ${sampleCall(lights[0])};`);
        lines.push('    ls.light_id = 0;');
    } else {
        // Compile-time power-weighted (or uniform) CDF over samplable lights.
        const weights = lights.map((l) =>
            selection === 'uniform' ? 1 : Math.max(1e-8, spectrumAverage(l.color.map((c) => c * l.intensity))),
        );
        const total = weights.reduce((a, b) => a + b, 0);
        const selectPdf = weights.map((w) => w / total);
        const cdf: number[] = [];
        let acc = 0;
        for (const sp of selectPdf) { acc += sp; cdf.push(acc); }

        lines.push('    int light_id; float select_pdf;');
        for (let i = 0; i < lights.length - 1; i++) {
            const kw = i === 0 ? 'if' : 'else if';
            lines.push(`    ${kw} (xi.x < ${formatFloat(cdf[i])}) { light_id = ${i}; select_pdf = ${formatFloat(selectPdf[i])}; }`);
        }
        const last = lights.length - 1;
        lines.push(`    else { light_id = ${last}; select_pdf = ${formatFloat(selectPdf[last])}; }`); // guaranteed — closes the fallthrough

        for (let i = 0; i < lights.length; i++) {
            if (i === 0) lines.push(`    if (light_id == ${i}) ls = ${sampleCall(lights[i])};`);
            else if (i < lights.length - 1) lines.push(`    else if (light_id == ${i}) ls = ${sampleCall(lights[i])};`);
            else lines.push(`    else ls = ${sampleCall(lights[i])};`); // else guarantees ls is assigned
        }

        lines.push('    ls.light_id = light_id;');
        lines.push('    ls.pdf *= select_pdf;'); // total = per-light × selection (§6.1)
    }

    lines.push('    return ls;');
    lines.push('}');
    return lines.join('\n');
}
