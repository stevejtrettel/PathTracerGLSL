// compiler/generate/features/lighting.ts
// Direct lighting (NEE): the per-scene light-sampling dispatch. Only present when
// the plan enables NEE (scene has lights and the strategy asks for direct lighting).

import type { RenderPlan, PlannedLight } from '../../plan/types.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import { formatFloat, formatVec3 } from './glsl-format.js';

export function contributeLighting(plan: RenderPlan): FeatureContribution {
    if (plan.program.lighting === null) {
        return emptyContribution();
    }
    return {
        ...emptyContribution(),
        blocks: [
            { origin: 'generated:light-sampling', source: generateLightSampling(plan.lights) },
        ],
    };
}

// ============================================================================
// Generated light sampling (per-scene codegen)
// ============================================================================

function generateLightSampling(lights: PlannedLight[]): string {
    const lines: string[] = [];
    lines.push('// Generated light sampling');

    if (lights.length === 0) {
        lines.push('LightSample lighting_sample(Point p) {');
        lines.push('    LightSample ls;');
        lines.push('    ls.pdf = 0.0;');
        lines.push('    return ls;');
        lines.push('}');
        return lines.join('\n');
    }

    if (lights.length === 1) {
        const light = lights[0];
        lines.push('LightSample lighting_sample(Point p) {');
        lines.push('    LightSample ls;');

        if (light.kind === 'point') {
            const pos = formatVec3(light.position!);
            const radiance = formatVec3(light.color.map(c => c * light.intensity));
            lines.push(`    vec3 light_vector = ${pos} - p;`);
            lines.push(`    ls.distance = length(light_vector);`);
            lines.push(`    ls.wi = normalize(light_vector);`);
            lines.push(`    ls.position = ${pos};`);
            lines.push(`    ls.radiance = ${radiance} / (ls.distance * ls.distance);`);
            lines.push(`    ls.pdf = 1.0;`);
        }

        lines.push('    return ls;');
        lines.push('}');
    } else {
        lines.push('LightSample lighting_sample(Point p) {');
        lines.push('    LightSample ls;');
        lines.push(`    float light_choice = random() * ${formatFloat(lights.length)};`);

        for (let i = 0; i < lights.length; i++) {
            const light = lights[i];
            const cond = i === 0 ? `if` : `else if`;
            lines.push(`    ${cond} (light_choice < ${formatFloat(i + 1)}) {`);

            if (light.kind === 'point') {
                const pos = formatVec3(light.position!);
                const radiance = formatVec3(light.color.map(c => c * light.intensity));
                lines.push(`        vec3 light_vector = ${pos} - p;`);
                lines.push(`        ls.distance = length(light_vector);`);
                lines.push(`        ls.wi = normalize(light_vector);`);
                lines.push(`        ls.position = ${pos};`);
                lines.push(`        ls.radiance = ${radiance} / (ls.distance * ls.distance);`);
            }

            lines.push(`    }`);
        }

        lines.push(`    ls.pdf = ${formatFloat(1.0 / lights.length)};`);
        lines.push('    return ls;');
        lines.push('}');
    }

    return lines.join('\n');
}
