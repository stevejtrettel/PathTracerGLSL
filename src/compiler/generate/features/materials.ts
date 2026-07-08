// compiler/generate/features/materials.ts
// Material models: fixed BRDF snippets + the per-scene material-property lookup.

import { isGlslExpression } from '../../types.js';
import type { RenderPlan, PlannedMaterial } from '../../plan/types.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import type { ShaderBlock } from '../ShaderIR.js';
import { formatFloat, formatVec3 } from './glsl-format.js';

import lambertGLSL from '../glsl/lambert.glsl?raw';

export function contributeMaterials(plan: RenderPlan): FeatureContribution {
    const blocks: ShaderBlock[] = [
        { origin: 'generated:material-lookup', source: generateMaterialLookup(plan.materials) },
    ];

    for (const model of plan.program.materials.models) {
        if (model === 'lambert') blocks.push({ origin: 'glsl/lambert.glsl', source: lambertGLSL });
    }

    return { ...emptyContribution(), blocks };
}

// ============================================================================
// Generated material lookup (per-scene codegen)
// ============================================================================

function generateMaterialLookup(materials: PlannedMaterial[]): string {
    const lines: string[] = [];
    lines.push('// Generated material properties lookup');
    lines.push('MaterialProperties scene_material_properties(int id, vec3 p) {');
    lines.push('    MaterialProperties props;');
    lines.push('    props.albedo = vec3(0.8);');
    lines.push('    props.emission = vec3(0.0);');
    lines.push('    props.emission_strength = 0.0;');
    lines.push('    props.roughness = 1.0;');

    for (let i = 0; i < materials.length; i++) {
        const mat = materials[i];
        const cond = i === 0 ? 'if' : 'else if';
        lines.push(`    ${cond} (id == ${mat.id}) {`);

        if (isGlslExpression(mat.albedo)) {
            lines.push(`        props.albedo = ${mat.albedo.source};`);
        } else {
            lines.push(`        props.albedo = ${formatVec3(mat.albedo)};`);
        }

        if (isGlslExpression(mat.emission)) {
            lines.push(`        props.emission = ${mat.emission.source};`);
        } else {
            const hasEmission = mat.emission[0] > 0 || mat.emission[1] > 0 || mat.emission[2] > 0;
            if (hasEmission) {
                lines.push(`        props.emission = ${formatVec3(mat.emission)};`);
                lines.push(`        props.emission_strength = 1.0;`);
            }
        }

        if (isGlslExpression(mat.roughness)) {
            lines.push(`        props.roughness = ${mat.roughness.source};`);
        } else {
            lines.push(`        props.roughness = ${formatFloat(mat.roughness)};`);
        }

        lines.push(`    }`);
    }

    lines.push('    return props;');
    lines.push('}');
    return lines.join('\n');
}
