// compiler/generate/features/materials.ts
// Material models: fixed BRDF snippets + the per-scene material-property lookup.
// A material property that is a { param } (§2.8) becomes a uniform named from its
// parameter path (e.g. clay.albedo → u_clay_albedo) — live-editable, no recompile.

import { isGlslExpression, isHeterogeneousMedium, isValueParam, type Vec3, type ValueParam, type MaterialModel, type GlslExpression } from '../../types.js';
import type { RenderPlan, PlannedMaterial, PlannedMedium, PlannedUniform } from '../../plan/types.js';
import type { ParameterMetadata } from '../../types.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import type { ShaderBlock } from '../ShaderIR.js';
import { formatFloat, formatSpectrum, paramToUniform } from '../../../components/glsl-format.js';

import { MATERIAL_MODELS, materialModel, EMISSION_KEY } from '../../../components/materials/index.js';
import { PHASE_MODELS } from '../../../components/volume_scattering/index.js';
import { unionFields, defaultExpr } from '../schema.js';
import type { PropertySchema } from '../../../components/descriptors.js';
import mediumAnalyticGLSL from '../../../components/transport/volume/analytic/analytic.glsl?raw';
import mediumDeltaTrackingGLSL from '../../../components/transport/volume/delta_tracking/delta_tracking.glsl?raw';

/** Capability lookup over the descriptor registry (R1a — replaces the inline
 *  MODEL_HAS_NONDELTA_LOBES map). 'none' is a boundary classification, not a model:
 *  no surface, no lobes (§3.6). Unregistered models return undefined so callers keep
 *  the fail-safe polarity they need. */
function modelNonDeltaLobes(model: PlannedMaterial['model']): boolean | undefined {
    if (model === 'none') return false;
    return MATERIAL_MODELS[model]?.capabilities.nonDeltaLobes;
}

/** 'none' is a boundary classification (§3.6), never a surface-dispatch arm. */
function surfaceMaterials(materials: PlannedMaterial[]): PlannedMaterial[] {
    return materials.filter((m) => m.model !== 'none');
}

/**
 * Emissive at compile time: positive constant, or {param}/expression (may be nonzero at runtime).
 * `> 0` (not `!== 0`) so the gate can never disagree with the emission lookup, which only
 * fetches positive constants — negatives are Validator-rejected anyway (audit H1.3).
 */
function isEmissive(mat: PlannedMaterial): boolean {
    const e = mat.values[EMISSION_KEY];
    if (e === undefined) return false;   // model declares no emission row
    if (isValueParam(e) || isGlslExpression(e)) return true;
    return Array.isArray(e) && e.some((c) => c > 0);
}

/** Scattering at compile time: σ_s nonzero constant, or {param}/expression-driven. */
function isScattering(medium: PlannedMedium): boolean {
    if (isValueParam(medium.sigma_s) || isGlslExpression(medium.sigma_s)) return true;
    return medium.sigma_s.some((c) => c !== 0);
}

export function contributeMaterials(plan: RenderPlan): FeatureContribution {
    // The union the resolver assigns = the union the struct declares (core emits the
    // struct from the same registry + models — one truth, two readers).
    const structFields = unionFields(
        plan.program.materials.models.map((m) => MATERIAL_MODELS[m]?.properties ?? []),
    );
    const blocks: ShaderBlock[] = [
        { origin: 'generated:material-lookup', source: generateMaterialLookup(plan.materials, structFields) },
    ];

    // Model includes from the registry (R1a): one line per model PRESENT, no per-model ifs.
    for (const model of plan.program.materials.models) {
        blocks.push({ origin: `components/materials/${model}/${model}.glsl`, source: materialModel(model).glsl });
    }

    // The generated §3.3 dispatch, after the model libraries it calls. Ops are seam
    // decisions (impl-plan-exact-linkage): eval's only caller is the light technique,
    // pdf's the surface MIS weight — a dispatch nothing links is not emitted.
    const { surfaceEval, surfacePdf } = plan.program.materials;
    blocks.push({ origin: 'generated:interaction-dispatch', source: generateInteractionDispatch(plan.materials, surfaceEval, surfacePdf) });

    // NEE guard (§6.2 / reference loop): at a pure-delta hit the eval is zero — transport skips
    // the shadow march. Constant-folds when the scene's materials are uniform in delta-ness.
    // Rides the eval decision: its only caller is the same light technique.
    if (surfaceEval) {
        blocks.push({ origin: 'generated:nondelta-guard', source: generateNondeltaGuard(plan.materials) });
    }

    // Emission gate (§6.2 / impl-plan-media M1.2): the emission fetch+dispatch sits behind this
    // compile-time table — the reference-loop pattern, and the fix for the review's
    // unguarded-emission-block finding. Emitted for EVERY scene (transport reads it unconditionally).
    blocks.push({ origin: 'generated:emissive-table', source: generateEmissiveTable(plan.materials) });

    // The volumetric component (fable-volumetric-component §2): media tables + the seam
    // dispatches, only when the scene has media. Media are "materials of the interior" (§3.5),
    // so their codegen lives here beside the material tables.
    const media = plan.program.media;
    const scatteringLive = media.scatteringArms;
    const wantsShadowMedia = media.shadowWalker;
    // Phase-parameter fields = the union of the PRESENT scattering models' schemas (§3.4)
    // — shared by the lookup codegen and the {param} scan below (one truth, two readers;
    // core.ts builds the MediumProperties struct from the same union).
    const phaseFields = unionFields(media.models.map((m) => PHASE_MODELS[m]?.properties ?? []));
    // is_null_interface has two callers: the walk's null branch (nullInterfaces) and the
    // static shadow_media walker, which probes it unconditionally (shadowWalker).
    const wantsNullTable = media.nullInterfaces || media.shadowWalker;
    if (media.present) {
        blocks.push({ origin: 'generated:media-tables', source: generateMediaTables(plan.materials, wantsNullTable) });
        blocks.push({ origin: 'generated:medium-properties', source: generateMediumProperties(plan.materials, plan.program.media.models, phaseFields) });
        // The 'analytic' strategy bodies (volumetric-component §4) — needed by the scattering
        // arms (seam 1) and by the spectral shadow walker's per-segment form (seam 2).
        if (scatteringLive || wantsShadowMedia) {
            blocks.push({ origin: 'components/transport/volume/analytic/analytic.glsl', source: mediumAnalyticGLSL });
        }
        // The null-collision bodies (fable-heterogeneous-media.md): included wholesale
        // (§2.12) iff some medium routes to them — a Planner decision. Must follow the
        // generated properties lookup (the loops re-fetch at every tentative collision).
        if (media.heterogeneousArms) {
            blocks.push({ origin: 'components/transport/volume/delta_tracking/delta_tracking.glsl', source: mediumDeltaTrackingGLSL });
        }
        if (scatteringLive) {
            // Emit each present scattering model's GLSL, then the dispatch that routes by
            // mp.model (twin of the surface interaction dispatch; eval/pdf are seam
            // decisions like the surface ops).
            for (const m of plan.program.media.models) {
                blocks.push({ origin: `components/volume_scattering/${m}/${m}.glsl`, source: PHASE_MODELS[m].glsl });
            }
            blocks.push({ origin: 'generated:medium-dispatch', source: generateMediumDispatch(plan.program.media.models, media.mediumEval, media.mediumPdf) });
        }
        blocks.push({ origin: 'generated:medium-sample', source: generateMediumSample(plan) });
        // Seam 2 dispatch — its only caller is shadow_media (lighting selects it when media+NEE).
        if (wantsShadowMedia) {
            blocks.push({ origin: 'generated:medium-transmittance', source: generateMediumTransmittance(plan.materials) });
        }
    }

    // {param} scan follows the schemas (R2): a material's model declares which fields
    // can become live uniforms — incl. region-table fields (ior) for declaring models.
    // A driven param on an UNDECLARED field is a Validator warning (the C5 silent-inert
    // class), not a silent uniform. Medium fields: RTE extinction + the medium's OWN
    // model's phase params (media are materials of the interior, §3.5).
    const uniforms: PlannedUniform[] = [];
    const parameters: Record<string, ParameterMetadata> = {};
    const seen = new Set<string>();
    for (const mat of plan.materials) {
        const schemas = mat.model === 'none' ? [] : (MATERIAL_MODELS[mat.model]?.properties ?? []);
        for (const f of schemas) {
            addParamUniform(
                mat.values[f.source] as Vec3 | number | GlslExpression | ValueParam<Vec3 | number>,
                f.glslType === 'Spectrum' ? 'vec3' : 'float',
                f.semantic === 'radiometric' ? 'color' : 'float',
                uniforms, parameters, seen,
            );
        }
        if (mat.medium !== null) {
            addParamUniform(mat.medium.sigma_a, 'vec3', 'color', uniforms, parameters, seen);
            addParamUniform(mat.medium.sigma_s, 'vec3', 'color', uniforms, parameters, seen);
            // Phase params follow the schemas — the medium's OWN model's rows, and only
            // when that model is LIVE in this program (media.models): a driven phase_g
            // in an absorbing-only program has no reader, so it earns no uniform (C5).
            const phaseRows = media.models.includes(mat.medium.model)
                ? PHASE_MODELS[mat.medium.model]?.properties ?? []
                : [];
            for (const f of phaseRows) {
                addParamUniform(
                    mat.medium.values[f.source] as number | ValueParam<number>,
                    f.glslType === 'Spectrum' ? 'vec3' : 'float',
                    f.semantic === 'radiometric' ? 'color' : 'float',
                    uniforms, parameters, seen,
                );
            }
        }
    }

    // No structural defines remain (item-9 commit D): media structs/helpers arrive via
    // core's conditionally-included structs_media/math_media blocks. MAX_NULL_COLLISIONS
    // is a NUMERIC knob (like MAX_SHADOW_SEGMENTS, per the house rule): the null-collision
    // loop budget — exhaustion is a conservative pass-through, a declared truncation.
    const defines: Record<string, string> = {};
    if (media.heterogeneousArms) defines['MAX_NULL_COLLISIONS'] = '64';

    // T4 seams: the §3.3/§3.4 interaction surface + capability gates (+ media seams when live).
    // Each entry mirrors its emission condition above — the interface header is truthful.
    const provides = [
        { name: 'scene_material_properties', signature: 'MaterialProperties scene_material_properties(int id, vec3 p)' },
        { name: 'interaction_surface_sample', signature: 'InteractionSample interaction_surface_sample(int mat, Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u)' },
        { name: 'interaction_surface_emission', signature: 'Spectrum interaction_surface_emission(int mat, Direction wo, Hit hit, MaterialProperties mp)' },
        { name: 'material_is_emissive', signature: 'bool material_is_emissive(int mat)' },
    ];
    if (surfaceEval) {
        provides.push(
            { name: 'interaction_surface_eval', signature: 'Spectrum interaction_surface_eval(int mat, Direction wi, Direction wo, Hit hit, MaterialProperties mp)' },
            { name: 'material_has_nondelta_lobes', signature: 'bool material_has_nondelta_lobes(int mat)' },
        );
    }
    if (surfacePdf) {
        provides.push({ name: 'interaction_surface_pdf', signature: 'float interaction_surface_pdf(int mat, Direction wi, Direction wo, Hit hit, MaterialProperties mp)' });
    }
    // Self-requires: the generated medium_sample/medium_transmittance bodies call the
    // properties lookup themselves — honest linkage for the seam-unused check.
    const requires: string[] = [];
    if (media.present) {
        requires.push('scene_medium_properties');
        provides.push(
            { name: 'material_has_medium', signature: 'bool material_has_medium(int mat)' },
            { name: 'scene_medium_properties', signature: 'MediumProperties scene_medium_properties(int mat, vec3 p)' },
            { name: 'medium_sample', signature: 'MediumSample medium_sample(int med, Ray ray, float t_max, vec2 xi)' },
        );
        if (wantsNullTable) {
            provides.push({ name: 'is_null_interface', signature: 'bool is_null_interface(int mat)' });
        }
        if (wantsShadowMedia) {
            provides.push({ name: 'medium_transmittance', signature: 'Spectrum medium_transmittance(int med, Ray ray, float len)' });
        }
        if (scatteringLive) {
            // The dispatch is the public seam (transport calls it); the per-model funcs
            // (hg_*/rayleigh_*) are internal, called only by the dispatch in this feature.
            provides.push(
                { name: 'interaction_medium_sample', signature: 'InteractionSample interaction_medium_sample(Direction wo, MediumProperties mp, vec2 xi)' },
            );
            if (media.mediumEval) {
                provides.push({ name: 'interaction_medium_eval', signature: 'Spectrum interaction_medium_eval(Direction wi, Direction wo, MediumProperties mp)' });
            }
            if (media.mediumPdf) {
                provides.push({ name: 'interaction_medium_pdf', signature: 'float interaction_medium_pdf(Direction wi, Direction wo, MediumProperties mp)' });
            }
        }
    }

    return { ...emptyContribution('materials'), blocks, defines, uniforms, parameters, provides, requires };
}

function addParamUniform(
    prop: Vec3 | number | GlslExpression | ValueParam<Vec3 | number>,
    glslType: 'vec3' | 'float',
    metaType: 'color' | 'float',
    uniforms: PlannedUniform[],
    parameters: Record<string, ParameterMetadata>,
    seen: Set<string>,
): void {
    // Expression-declared params (heterogeneous D4, general to any expression property):
    // each becomes a live FLOAT uniform (v1) named from its path, exactly like a
    // ValueParam — the expression source references the derived name (u_fog_gain).
    if (isGlslExpression(prop)) {
        for (const p of prop.params ?? []) {
            if (seen.has(p.param)) continue; // expressions may share one driven parameter
            seen.add(p.param);
            uniforms.push({
                name: paramToUniform(p.param),
                type: 'float',
                parameterPath: p.param,
                default: p.default,
            });
            const seg = p.param.split('.');
            parameters[p.param] = {
                type: 'float',
                default: p.default,
                name: capitalize(seg[seg.length - 1]),
                group: seg.length > 1 ? seg[0] : undefined,
                triggersReset: true,
                ...(p.min !== undefined && p.max !== undefined ? { range: [p.min, p.max] } : {}),
            };
        }
        return;
    }
    if (!isValueParam(prop)) return;
    const path = prop.param;
    if (seen.has(path)) return; // materials may share one driven parameter (§2.8)
    seen.add(path);

    uniforms.push({
        name: paramToUniform(path),
        type: glslType,
        parameterPath: path,
        default: prop.default as number | number[] | undefined,
        // Spectrum properties deliberately accept achromatic scalar parameters. Preserve
        // that broadcast for live programmatic updates, not only for the planned default.
        ...(glslType === 'vec3' ? {
            compute: (params: Record<string, unknown>) => {
                const value = params[path] ?? prop.default;
                return typeof value === 'number' ? [value, value, value] : value as number[];
            },
        } : {}),
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

function generateMaterialLookup(materials: PlannedMaterial[], fields: PropertySchema[]): string {
    const lines: string[] = [];
    lines.push('// Generated material properties lookup — assignments follow the models\' schemas (§3.4):');
    lines.push('// a material sets exactly the fields its model reads, nothing else.');
    lines.push('MaterialProperties scene_material_properties(int id, vec3 p) {');
    lines.push('    MaterialProperties props;');
    // Defaults from the union schemas — the GLSL expression DERIVED from the row's
    // numeric default.
    for (const f of fields) {
        lines.push(`    props.${f.name} = ${defaultExpr(f)};`);
    }

    let arms = 0;
    for (const mat of materials) {
        const schemas = (mat.model === 'none' ? [] : (MATERIAL_MODELS[mat.model]?.properties ?? []))
            .filter((f) => f.storage === 'field');
        const body: string[] = [];
        for (const f of schemas) {
            const value = mat.values[f.source] as Vec3 | number | GlslExpression | ValueParam<Vec3 | number>;
            const target = `        props.${f.name}`;
            if (isValueParam(value)) {
                body.push(`${target} = ${paramToUniform(value.param)};`);
            } else if (isGlslExpression(value)) {
                body.push(`${target} = ${value.source};`);
            } else if (f.name === 'emission') {
                // Constant emission: assigned only when nonzero (the gate's `> 0` twin).
                const rgb = value as Vec3;
                if (rgb[0] > 0 || rgb[1] > 0 || rgb[2] > 0) {
                    body.push(`${target} = ${formatSpectrum(rgb)};`);
                }
            } else {
                body.push(`${target} = ${f.glslType === 'Spectrum' ? formatSpectrum(value as Vec3) : formatFloat(value as number)};`);
            }
        }
        if (body.length === 0) continue;   // 'none' / defaults-only materials earn no arm
        lines.push(`    ${arms === 0 ? 'if' : 'else if'} (id == ${mat.id}) {`);
        lines.push(...body);
        lines.push('    }');
        arms++;
    }

    lines.push('    return props;');
    lines.push('}');
    return lines.join('\n');
}

// ============================================================================
// Generated NEE guard — material_has_nondelta_lobes (reference loop / §6.2)
// ============================================================================

function generateNondeltaGuard(materials: PlannedMaterial[]): string {
    // Fail SAFE on models missing from the capability map: only an EXPLICIT `false` skips NEE.
    // (`!map[model]` treated unknown models as delta → a future model wired into the dispatch but
    // not this map would silently lose all direct lighting — review finding. Defaulting to true
    // costs at worst a wasted shadow ray.)
    const deltaIds = materials.filter((m) => modelNonDeltaLobes(m.model) === false).map((m) => m.id);
    const lines: string[] = ['// Generated NEE guard: pure-delta materials skip the shadow ray (eval ≡ 0)'];
    lines.push('bool material_has_nondelta_lobes(int mat) {');
    if (deltaIds.length === 0) {
        lines.push('    return true;');
    } else if (deltaIds.length === materials.length) {
        lines.push('    return false;');
    } else {
        lines.push(`    if (${deltaIds.map((id) => `mat == ${id}`).join(' || ')}) return false;`);
        lines.push('    return true;');
    }
    lines.push('}');
    return lines.join('\n');
}

// ============================================================================
// Generated emission gate — material_is_emissive (§6.2 / impl-plan-media M1.2)
// ============================================================================
// Transport fetches+dispatches emission only behind this compile-time table. Model 'none'
// materials are never emissive here: their boundary is not an optical surface (§3.6) —
// volumetric emission is the deferred MediumProperties.emission, a different term entirely.

function generateEmissiveTable(materials: PlannedMaterial[]): string {
    // Capability ∧ value (R2): a model that cannot emit (dielectric_emission ≡ 0) never
    // enters the gate even with an authored emission value — the Validator warns on that.
    const ids = materials
        .filter((m) => m.model !== 'none'
            && (MATERIAL_MODELS[m.model]?.capabilities.emissive ?? false)
            && isEmissive(m))
        .map((m) => m.id);
    const lines: string[] = ['// Generated emission gate: fetch/dispatch emission only where it can exist'];
    lines.push('bool material_is_emissive(int mat) {');
    if (ids.length === 0) {
        lines.push('    return false;');
    } else if (ids.length === materials.length) {
        lines.push('    return true;');
    } else {
        lines.push(`    return ${ids.map((id) => `mat == ${id}`).join(' || ')};`);
    }
    lines.push('}');
    return lines.join('\n');
}

// ============================================================================
// Generated media tables + the volumetric component dispatch
// (fable-volumetric-component §2; media are "materials of the interior", §3.5)
// ============================================================================

function generateMediaTables(materials: PlannedMaterial[], wantsNullTable: boolean): string {
    const lines: string[] = ['// Generated media capability tables (§3.5/§3.6)'];

    // Null interfaces: model 'none' — transport passes through, no optical event.
    // Emitted for the walk's null branch OR the shadow_media walker (its static body
    // probes it even in scenes with no 'none' material — the constant-false fold).
    if (wantsNullTable) {
        const nullIds = materials.filter((m) => m.model === 'none').map((m) => m.id);
        lines.push('bool is_null_interface(int mat) {');
        lines.push(nullIds.length === 0
            ? '    return false;'
            : `    return ${nullIds.map((id) => `mat == ${id}`).join(' || ')};`);
        lines.push('}');
    }

    // Media presence: gates the per-segment volumetric call site so it constant-folds away
    // whenever current_medium's material has no medium block (vacuum, plain solids' interiors).
    const mediumIds = materials.filter((m) => m.medium !== null).map((m) => m.id);
    lines.push('bool material_has_medium(int mat) {');
    lines.push(mediumIds.length === 0
        ? '    return false;'
        : `    return ${mediumIds.map((id) => `mat == ${id}`).join(' || ')};`);
    lines.push('}');

    return lines.join('\n');
}

function mediumPropertyExpr(prop: Vec3 | number | GlslExpression | ValueParam<Vec3 | number>, name: string, format: (v: never) => string): string {
    if (isValueParam(prop)) return paramToUniform(prop.param);
    if (isGlslExpression(prop)) {
        if (name === 'sigma_a' || name === 'sigma_s') {
            // Heterogeneous coefficient (fable-heterogeneous-media.md D4): the authored
            // formula of `p` (+ declared-param uniforms). Spectrum(...) broadcasts a
            // scalar-valued source and passes a vec3-valued one through; the max(…, 0.0)
            // floor makes coefficients nonnegative by definition (a formula that dips
            // negative is not a medium — σ < 0 would poison probabilities and weights).
            return `max(Spectrum(${prop.source}), 0.0)`;
        }
        // Backstop only — the Validator rejects spatially-varying phase parameters.
        throw new Error(`materials: medium.${name} cannot be a GLSL expression (only sigma_a/sigma_s may vary spatially)`);
    }
    return format(prop as never);
}

function generateMediumProperties(materials: PlannedMaterial[], models: string[], phaseFields: PropertySchema[]): string {
    const withMedium = materials.filter((m) => m.medium !== null);
    const hasModel = models.length > 0;         // the `model` field exists only when scattering is live
    // Field set = the PRESENT scattering models' schema union (§3.4 literal — the same
    // union core.ts builds the struct from). An absorbing-only program has extinction
    // fields and nothing else.
    const lines: string[] = ['// Generated medium-properties lookup (§3.5; heterogeneous media read p)'];
    lines.push('MediumProperties scene_medium_properties(int mat, vec3 p) {');
    lines.push('    MediumProperties m;');
    lines.push('    m.sigma_a = SPECTRUM_ZERO;');
    lines.push('    m.sigma_s = SPECTRUM_ZERO;');
    for (const f of phaseFields) lines.push(`    m.${f.name} = ${defaultExpr(f)};`);
    if (hasModel) lines.push('    m.model = 0;');
    for (let i = 0; i < withMedium.length; i++) {
        const mat = withMedium[i];
        const med = mat.medium!;
        const cond = i === 0 ? 'if' : 'else if';
        lines.push(`    ${cond} (mat == ${mat.id}) {   // '${mat.name}'`);
        lines.push(`        m.sigma_a = ${mediumPropertyExpr(med.sigma_a, 'sigma_a', formatSpectrum)};`);
        lines.push(`        m.sigma_s = ${mediumPropertyExpr(med.sigma_s, 'sigma_s', formatSpectrum)};`);
        if (isHeterogeneousMedium(med)) {
            // D1 clamp IN THE LOOKUP (fable-heterogeneous-media.md, amended Jul 17): the
            // rendered medium IS the proportionally clamped field — no caller can observe
            // the unclamped formula. Proportional scale preserves the albedo field; only
            // extinction saturates. Emitted ONLY for expression media (constant branches
            // are byte-identical to before).
            const maj = med.majorant;
            if (maj === undefined) {
                // Backstop — the Validator pairs expressions with a declared majorant.
                throw new Error(`materials: medium of '${mat.name}' has expression coefficients but no majorant`);
            }
            lines.push(`        float sigma_max = spectrum_max(m.sigma_a + m.sigma_s);   // D1: medium IS min(σ, σ̄)`);
            lines.push(`        float sigma_scale = sigma_max > ${formatFloat(maj)} ? ${formatFloat(maj)} / sigma_max : 1.0;`);
            lines.push('        m.sigma_a *= sigma_scale;');
            lines.push('        m.sigma_s *= sigma_scale;');
        }
        for (const f of phaseFields) {
            // Union fields of OTHER present models fall back to their row default —
            // this medium's values hold exactly its own model's rows.
            const value = med.values[f.source] as number | GlslExpression | ValueParam<number> | undefined;
            const format = f.glslType === 'Spectrum' ? formatSpectrum : formatFloat;
            lines.push(`        m.${f.name} = ${value === undefined ? defaultExpr(f) : mediumPropertyExpr(value, f.name, format as (v: never) => string)};`);
        }
        if (hasModel) lines.push(`        m.model = ${models.indexOf(med.model)};   // '${med.model}'`);
        lines.push('    }');
    }
    lines.push('    return m;');
    lines.push('}');
    return lines.join('\n');
}

// Generated volume-scattering dispatch — the twin of the surface interaction dispatch.
// interaction_medium_{sample,eval,pdf} route to the medium's model (hg_*/rayleigh_*/…) by
// mp.model (the registry index set in scene_medium_properties). One arm ⇒ a direct call,
// no branch. Called by the transport techniques (kernel/light/equiangular).
function generateMediumDispatch(models: string[], wantsEval: boolean, wantsPdf: boolean): string {
    const arms = (call: (m: string) => string): string[] => {
        const out: string[] = [];
        for (let i = 0; i < models.length - 1; i++) out.push(`    if (mp.model == ${i}) return ${call(models[i])};`);
        out.push(`    return ${call(models[models.length - 1])};`);
        return out;
    };
    const lines: string[] = ['// Generated volume-scattering dispatch (interaction_medium_* over mp.model)'];
    lines.push('InteractionSample interaction_medium_sample(Direction wo, MediumProperties mp, vec2 xi) {');
    lines.push(...arms((m) => `${m}_sample(wo, mp, xi)`));
    lines.push('}');
    if (wantsEval) {
        lines.push('Spectrum interaction_medium_eval(Direction wi, Direction wo, MediumProperties mp) {');
        lines.push(...arms((m) => `${m}_eval(wi, wo, mp)`));
        lines.push('}');
    }
    if (wantsPdf) {
        lines.push('float interaction_medium_pdf(Direction wi, Direction wo, MediumProperties mp) {');
        lines.push(...arms((m) => `${m}_pdf(wi, wo, mp)`));
        lines.push('}');
    }
    return lines.join('\n');
}

// Seam 1 of the volumetric component: medium_sample(med, ray, t_max, xi) — the segment decision.
// One dispatch over the media present, each arm specialized at compile time — the 2×2 of
// fable-heterogeneous-media.md (amended D2): constant/{param} media keep the exact closed
// forms; expression media route to the null-collision arms (either coefficient being an
// expression routes BOTH ways — the D1 clamp couples σ_a to σ_s(x) through the scale):
//   constant × absorbing    → deterministic Beer–Lambert, no RNG draw
//   constant × scattering   → the analytic channel-MIS body (volumetric-component §4)
//   expression × absorbing  → ratio-tracked pass-through (delta_tracking occupant)
//   expression × scattering → delta tracking (Kutz Alg. 4, delta_tracking occupant)
// Every arm assigns ms.radiance (mandatory — §3 partition rule; uninitialized GLSL is garbage).
function generateMediumSample(plan: RenderPlan): string {
    const withMedium = plan.materials.filter((m) => m.medium !== null);
    const scatteringLive = plan.program.media.scatteringArms;

    const lines: string[] = ['// Generated volumetric-component dispatch (seam 1, fable-volumetric-component §2)'];
    lines.push('MediumSample medium_sample(int med, Ray ray, float t_max, vec2 xi) {');
    lines.push('    MediumSample ms;');
    lines.push('    ms.scattered = false;');
    lines.push('    ms.t = t_max;');
    lines.push('    ms.weight = SPECTRUM_ONE;');
    lines.push('    ms.radiance = SPECTRUM_ZERO;');
    for (const mat of withMedium) {
        const med = mat.medium!;
        const scatters = scatteringLive && isScattering(med);
        if (isHeterogeneousMedium(med)) {
            const maj = formatFloat(requireMajorant(med, mat.name));
            lines.push(`    if (med == ${mat.id}) {   // '${mat.name}' — heterogeneous, ${scatters ? 'scattering (delta tracking)' : 'absorbing-only (ratio-tracked pass-through)'}`);
            lines.push(scatters
                ? `        return medium_sample_delta(${mat.id}, ${maj}, ray, t_max, xi);`
                : `        return medium_sample_ratio_absorb(${mat.id}, ${maj}, ray, t_max);`);
        } else {
            lines.push(`    if (med == ${mat.id}) {   // '${mat.name}' — ${scatters ? 'scattering (analytic channel-MIS)' : 'absorbing-only (deterministic)'}`);
            if (scatters) {
                lines.push(`        return medium_sample_analytic(scene_medium_properties(${mat.id}, ray.origin), t_max, xi);`);
            } else {
                lines.push(`        MediumProperties m = scene_medium_properties(${mat.id}, ray.origin);`);
                lines.push('        ms.weight = spectrum_exp(-m.sigma_a * t_max);');
            }
        }
        lines.push('    }');
    }
    lines.push('    return ms;');
    lines.push('}');
    return lines.join('\n');
}

/** Backstop — the Validator pairs expression coefficients with a declared majorant. */
function requireMajorant(med: PlannedMedium, name: string): number {
    if (med.majorant === undefined) {
        throw new Error(`materials: medium of '${name}' has expression coefficients but no majorant`);
    }
    return med.majorant;
}

// Seam 2 of the volumetric component: per-segment shadow transmittance over full σ_t.
// Called only by shadow_media's segment walker. Constant/{param} media: the analytic
// closed form (exact). Expression media: ratio tracking (delta_tracking occupant).
function generateMediumTransmittance(materials: PlannedMaterial[]): string {
    const withMedium = materials.filter((m) => m.medium !== null);
    const lines: string[] = ['// Generated volumetric-component dispatch (seam 2, fable-volumetric-component §2)'];
    lines.push('Spectrum medium_transmittance(int med, Ray ray, float len) {');
    for (const mat of withMedium) {
        if (isHeterogeneousMedium(mat.medium!)) {
            const maj = formatFloat(requireMajorant(mat.medium!, mat.name));
            lines.push(`    if (med == ${mat.id}) {   // '${mat.name}' — heterogeneous (ratio tracking)`);
            lines.push(`        return medium_transmittance_ratio(${mat.id}, ${maj}, ray, len);`);
        } else {
            lines.push(`    if (med == ${mat.id}) {   // '${mat.name}'`);
            lines.push(`        return medium_transmittance_analytic(scene_medium_properties(${mat.id}, ray.origin), len);`);
        }
        lines.push('    }');
    }
    lines.push('    return SPECTRUM_ONE;');
    lines.push('}');
    return lines.join('\n');
}

// ============================================================================
// Generated surface-interaction dispatch (§3.3)
// ============================================================================
// One dispatcher per operation, switching on material id over ONLY the models
// present. Lambert-only collapses to a passthrough; a second model (dielectric)
// is additive — it just adds `if (mat == <ids>) return <model>_<op>(...)`.

function generateInteractionDispatch(materials: PlannedMaterial[], wantsEval: boolean, wantsPdf: boolean): string {
    // Group SURFACE material ids by model, preserving first-appearance order. 'none' materials
    // never reach this dispatch: transport's null-interface branch continues before any surface
    // op (§3.6), so they contribute no arm.
    const surface = surfaceMaterials(materials);
    const order: MaterialModel[] = [];
    const idsByModel = new Map<MaterialModel, number[]>();
    for (const m of surface) {
        if (!idsByModel.has(m.model)) { idsByModel.set(m.model, []); order.push(m.model); }
        idsByModel.get(m.model)!.push(m.id);
    }
    const fallback = order[order.length - 1]; // the default arm

    // sample + emission are the kernel technique's unconditional surface; eval links only
    // from the light technique, pdf only from the surface MIS weight (seam decisions).
    const ops = [
        { name: 'sample',   ret: 'InteractionSample', params: 'int mat, Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u', args: 'wo, hit, mp, uc, u', zero: 'InteractionSample s; s.wi = wo; s.weight = SPECTRUM_ZERO; s.pdf = 0.0; s.flags = 0u; return s;' },
        ...(wantsEval ? [{ name: 'eval', ret: 'Spectrum', params: 'int mat, Direction wi, Direction wo, Hit hit, MaterialProperties mp', args: 'wi, wo, hit, mp', zero: 'return SPECTRUM_ZERO;' }] : []),
        ...(wantsPdf ? [{ name: 'pdf', ret: 'float', params: 'int mat, Direction wi, Direction wo, Hit hit, MaterialProperties mp', args: 'wi, wo, hit, mp', zero: 'return 0.0;' }] : []),
        { name: 'emission', ret: 'Spectrum',          params: 'int mat, Direction wo, Hit hit, MaterialProperties mp',                 args: 'wo, hit, mp', zero: 'return SPECTRUM_ZERO;' },
    ];

    const lines: string[] = ['// Generated surface-interaction dispatch (§3.3)'];
    for (const op of ops) {
        lines.push(`${op.ret} interaction_surface_${op.name}(${op.params}) {`);
        if (order.length === 0) {
            // Degenerate all-'none' scene (pure media, e.g. a fog ball under an environment):
            // no surface ops exist — zeroed stubs keep the transport template linkable.
            lines.push(`    ${op.zero}`);
        } else {
            for (const model of order) {
                if (model === fallback) continue;
                const cond = idsByModel.get(model)!.map((id) => `mat == ${id}`).join(' || ');
                lines.push(`    if (${cond}) return ${model}_${op.name}(${op.args});`);
            }
            lines.push(`    return ${fallback}_${op.name}(${op.args});`);
        }
        lines.push('}');
    }
    return lines.join('\n');
}
