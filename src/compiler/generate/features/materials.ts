// compiler/generate/features/materials.ts
// Material models: fixed BRDF snippets + the per-scene material-property lookup.
// A material property that is a { param } (§2.8) becomes a uniform named from its
// parameter path (e.g. clay.albedo → u_clay_albedo) — live-editable, no recompile.

import { isGlslExpression, isValueParam, type Vec3, type ValueParam, type MaterialModel } from '../../types.js';
import type { RenderPlan, PlannedMaterial, PlannedUniform } from '../../plan/types.js';
import type { ParameterMetadata } from '../../../engine/types.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import type { ShaderBlock } from '../ShaderIR.js';
import { formatFloat, formatSpectrum } from './glsl-format.js';

import lambertGLSL from '../glsl/lambert.glsl?raw';

export function contributeMaterials(plan: RenderPlan): FeatureContribution {
    const blocks: ShaderBlock[] = [
        { origin: 'generated:material-lookup', source: generateMaterialLookup(plan.materials) },
    ];

    for (const model of plan.program.materials.models) {
        if (model === 'lambert') blocks.push({ origin: 'glsl/lambert.glsl', source: lambertGLSL });
    }

    // The generated §3.3 dispatch, after the model libraries it calls.
    blocks.push({ origin: 'generated:interaction-dispatch', source: generateInteractionDispatch(plan.materials) });

    // Scan every material's properties for { param } references → live uniforms.
    const uniforms: PlannedUniform[] = [];
    const parameters: Record<string, ParameterMetadata> = {};
    const seen = new Set<string>();
    for (const mat of plan.materials) {
        addParamUniform(mat.albedo, 'vec3', 'color', uniforms, parameters, seen);
        addParamUniform(mat.emission, 'vec3', 'color', uniforms, parameters, seen);
        addParamUniform(mat.roughness, 'float', 'float', uniforms, parameters, seen);
    }

    return { ...emptyContribution(), blocks, uniforms, parameters };
}

/** Uniform name from a parameter path: 'clay.albedo' → 'u_clay_albedo'. */
function paramToUniform(path: string): string {
    return 'u_' + path.replace(/\./g, '_');
}

function addParamUniform(
    prop: Vec3 | number | { source: string } | ValueParam<Vec3 | number>,
    glslType: 'vec3' | 'float',
    metaType: 'color' | 'float',
    uniforms: PlannedUniform[],
    parameters: Record<string, ParameterMetadata>,
    seen: Set<string>,
): void {
    if (!isValueParam(prop)) return;
    const path = prop.param;
    if (seen.has(path)) return; // materials may share one driven parameter (§2.8)
    seen.add(path);

    uniforms.push({
        name: paramToUniform(path),
        type: glslType,
        parameterPath: path,
        default: prop.default as number | number[] | undefined,
    });

    const seg = path.split('.');
    parameters[path] = {
        type: metaType,
        default: prop.default,
        name: capitalize(seg[seg.length - 1]),
        group: seg.length > 1 ? seg[0] : undefined,
        triggersReset: true,
        ...(prop.min !== undefined && prop.max !== undefined ? { range: [prop.min, prop.max] } : {}),
    };
}

function capitalize(s: string): string {
    return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

// ============================================================================
// Generated material lookup (per-scene codegen)
// ============================================================================

function generateMaterialLookup(materials: PlannedMaterial[]): string {
    const lines: string[] = [];
    lines.push('// Generated material properties lookup');
    lines.push('MaterialProperties scene_material_properties(int id, vec3 p) {');
    lines.push('    MaterialProperties props;');
    lines.push('    props.albedo = Spectrum(0.8);');       // §2.5: radiometric default via typedef, not raw vec3
    lines.push('    props.emission = SPECTRUM_ZERO;');
    lines.push('    props.emission_strength = 0.0;');
    lines.push('    props.roughness = 1.0;');

    for (let i = 0; i < materials.length; i++) {
        const mat = materials[i];
        const cond = i === 0 ? 'if' : 'else if';
        lines.push(`    ${cond} (id == ${mat.id}) {`);

        // albedo
        if (isValueParam(mat.albedo)) {
            lines.push(`        props.albedo = ${paramToUniform(mat.albedo.param)};`);
        } else if (isGlslExpression(mat.albedo)) {
            lines.push(`        props.albedo = ${mat.albedo.source};`);
        } else {
            lines.push(`        props.albedo = ${formatSpectrum(mat.albedo)};`);
        }

        // emission (+ strength)
        if (isValueParam(mat.emission)) {
            lines.push(`        props.emission = ${paramToUniform(mat.emission.param)};`);
            lines.push(`        props.emission_strength = 1.0;`);
        } else if (isGlslExpression(mat.emission)) {
            lines.push(`        props.emission = ${mat.emission.source};`);
        } else {
            const hasEmission = mat.emission[0] > 0 || mat.emission[1] > 0 || mat.emission[2] > 0;
            if (hasEmission) {
                lines.push(`        props.emission = ${formatSpectrum(mat.emission)};`);
                lines.push(`        props.emission_strength = 1.0;`);
            }
        }

        // roughness
        if (isValueParam(mat.roughness)) {
            lines.push(`        props.roughness = ${paramToUniform(mat.roughness.param)};`);
        } else if (isGlslExpression(mat.roughness)) {
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

// ============================================================================
// Generated surface-interaction dispatch (§3.3)
// ============================================================================
// One dispatcher per operation, switching on material id over ONLY the models
// present. Lambert-only collapses to a passthrough; a second model (dielectric)
// is additive — it just adds `if (mat == <ids>) return <model>_<op>(...)`.

function generateInteractionDispatch(materials: PlannedMaterial[]): string {
    // Group material ids by model, preserving first-appearance order.
    const order: MaterialModel[] = [];
    const idsByModel = new Map<MaterialModel, number[]>();
    for (const m of materials) {
        if (!idsByModel.has(m.model)) { idsByModel.set(m.model, []); order.push(m.model); }
        idsByModel.get(m.model)!.push(m.id);
    }
    const fallback = order[order.length - 1]; // the default arm

    const ops = [
        { name: 'sample',   ret: 'InteractionSample', params: 'int mat, Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u', args: 'wo, hit, mp, uc, u' },
        { name: 'eval',     ret: 'Spectrum',          params: 'int mat, Direction wi, Direction wo, Hit hit, MaterialProperties mp',    args: 'wi, wo, hit, mp' },
        { name: 'pdf',      ret: 'float',             params: 'int mat, Direction wi, Direction wo, Hit hit, MaterialProperties mp',    args: 'wi, wo, hit, mp' },
        { name: 'emission', ret: 'Spectrum',          params: 'int mat, Direction wo, Hit hit, MaterialProperties mp',                 args: 'wo, hit, mp' },
    ];

    const lines: string[] = ['// Generated surface-interaction dispatch (§3.3)'];
    for (const op of ops) {
        lines.push(`${op.ret} interaction_surface_${op.name}(${op.params}) {`);
        for (const model of order) {
            if (model === fallback) continue;
            const cond = idsByModel.get(model)!.map((id) => `mat == ${id}`).join(' || ');
            lines.push(`    if (${cond}) return ${model}_${op.name}(${op.args});`);
        }
        lines.push(`    return ${fallback}_${op.name}(${op.args});`);
        lines.push('}');
    }
    return lines.join('\n');
}
