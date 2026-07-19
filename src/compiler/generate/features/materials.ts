// compiler/generate/features/materials.ts
// Material models: fixed BRDF snippets + the per-scene material-property lookup.
// A material property that is a { param } (§2.8) becomes a uniform named from its
// parameter path (e.g. clay.albedo → u_clay_albedo) — live-editable, no recompile.

import { isGlslExpression, isHeterogeneousMedium, isEmissiveMedium, mediumRoutesToTracking, mediumMayScatter, isValueParam, type Vec3, type ValueParam, type MaterialModel, type GlslExpression } from '../../types.js';
import type { RenderPlan, PlannedMaterial, PlannedMedium, PlannedUniform } from '../../plan/types.js';
import type { ParameterMetadata } from '../../types.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import type { ShaderBlock } from '../ShaderIR.js';
import { formatFloat, formatSpectrum } from '../../../components/glsl-format.js';
import { emitValue, mintValueUniform, type ParamValue } from '../values.js';

import { MATERIAL_MODELS, materialModel, modelStructFields, EMISSION_KEY } from '../../../components/materials/index.js';
import type { MaterialDerivedSpec } from '../../../components/descriptors.js';
import { VOLUME_SCATTERING_MODELS } from '../../../components/volume_scattering/index.js';
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

export function contributeMaterials(plan: RenderPlan): FeatureContribution {
    // The union the resolver assigns = the union the struct declares (core emits the
    // struct from the same registry + models — one truth, two readers; rows + D4
    // derived pseudo-rows via modelStructFields).
    const structFields = unionFields(
        plan.program.materials.models.map((m) => {
            const d = MATERIAL_MODELS[m];
            return d !== undefined ? modelStructFields(d) : [];
        }),
    );
    // DERIVED material fields (D4): per-material expressions — a baked literal for
    // constant inputs, a `u_<name>_<id>` compute-closure uniform for driven ones.
    const derivedByMat = new Map<number, DerivedExpr[]>();
    for (const mat of plan.materials) {
        const specs = mat.model === 'none' ? [] : (MATERIAL_MODELS[mat.model]?.derived ?? []);
        if (specs.length > 0) derivedByMat.set(mat.id, specs.map((s) => materialDerivedExpr(mat, s)));
    }
    const blocks: ShaderBlock[] = [
        { origin: 'generated:material-lookup', source: generateMaterialLookup(plan.materials, structFields, derivedByMat) },
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
    const phaseFields = unionFields(media.models.map((m) => VOLUME_SCATTERING_MODELS[m]?.properties ?? []));
    // is_null_interface has two callers: the walk's null branch (nullInterfaces) and the
    // static shadow_media walker, which probes it unconditionally (shadowWalker).
    const wantsNullTable = media.nullInterfaces || media.shadowWalker;
    // The tracking arms' σ̄ per medium (batch 2 of impl-plan-env-power-selection):
    // ONE routing computation shared by the arm emitter and the uniform minting below.
    const majorants = new Map<number, MajorantSpec>();
    for (const mat of plan.materials) {
        if (mat.medium === null) continue;
        const scatters = scatteringLive && mediumMayScatter(mat.medium);
        if (mediumRoutesToTracking(mat.medium, scatters)) majorants.set(mat.id, majorantSpec(mat));
    }
    if (media.present) {
        blocks.push({ origin: 'generated:media-tables', source: generateMediaTables(plan.materials, wantsNullTable) });
        blocks.push({ origin: 'generated:medium-properties', source: generateMediumProperties(plan.materials, plan.program.media.models, phaseFields, media.emission) });
        // The 'analytic' strategy bodies (volumetric-component §4) — needed by the scattering
        // arms (seam 1) and by the spectral shadow walker's per-segment form (seam 2).
        if (scatteringLive || wantsShadowMedia) {
            blocks.push({ origin: 'components/transport/volume/analytic/analytic.glsl', source: mediumAnalyticGLSL });
        }
        // The null-collision bodies (fable-heterogeneous-media.md): included wholesale
        // (§2.12) iff some medium routes to them — a Planner decision. Must follow the
        // generated properties lookup (the loops re-fetch at every tentative collision).
        if (media.heterogeneousArms) {
            // medium_emission (generated, impl-plan-medium-emission): the occupant's ONE
            // program-dependent field access, behind a generated body per the static-file
            // rule — ε when emissive media exist, the folded constant ZERO otherwise
            // (the combiner-weight pattern). Precedes the occupant that calls it.
            blocks.push({
                origin: 'generated:medium-emission',
                source: [
                    'Spectrum medium_emission(MediumProperties m) {',
                    media.emission
                        ? '    return m.emission;   // volume emission coefficient ε (P1)'
                        : '    return SPECTRUM_ZERO;   // no emissive media in this program — folds out',
                    '}',
                ].join('\n'),
            });
            blocks.push({ origin: 'components/transport/volume/delta_tracking/delta_tracking.glsl', source: mediumDeltaTrackingGLSL });
        }
        if (scatteringLive) {
            // Emit each present scattering model's GLSL, then the dispatch that routes by
            // mp.model (twin of the surface interaction dispatch; eval/pdf are seam
            // decisions like the surface ops).
            for (const m of plan.program.media.models) {
                blocks.push({ origin: `components/volume_scattering/${m}/${m}.glsl`, source: VOLUME_SCATTERING_MODELS[m].glsl });
            }
            blocks.push({ origin: 'generated:medium-dispatch', source: generateMediumDispatch(plan.program.media.models, media.mediumEval, media.mediumPdf) });
        }
        blocks.push({ origin: 'generated:medium-sample', source: generateMediumSample(plan, majorants) });
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
            mintValueUniform(
                mat.values[f.source] as Vec3 | number | GlslExpression | ValueParam<Vec3 | number>,
                f.glslType === 'Spectrum' ? 'vec3' : 'float',
                f.semantic === 'radiometric' ? 'color' : 'float',
                uniforms, parameters, seen,
                f.source === EMISSION_KEY,   // E2: emission is HDR; albedo/f0 stay swatches
            );
        }
        if (mat.medium !== null) {
            // E2: RTE coefficients are magnitudes (σ > 1 is routine) — HDR widgets.
            mintValueUniform(mat.medium.sigma_a, 'vec3', 'color', uniforms, parameters, seen, true);
            mintValueUniform(mat.medium.sigma_s, 'vec3', 'color', uniforms, parameters, seen, true);
            // ε rides the same machinery ({param} → vec3 uniform; expression → declared
            // float params) — but only when the field has a reader (media.emission, C5).
            if (media.emission) mintValueUniform(mat.medium.emission, 'vec3', 'color', uniforms, parameters, seen, true);   // ε: HDR
            // Phase params follow the schemas — the medium's OWN model's rows, and only
            // when that model is LIVE in this program (media.models): a driven phase_g
            // in an absorbing-only program has no reader, so it earns no uniform (C5).
            const phaseRows = media.models.includes(mat.medium.model)
                ? VOLUME_SCATTERING_MODELS[mat.medium.model]?.properties ?? []
                : [];
            for (const f of phaseRows) {
                mintValueUniform(
                    mat.medium.values[f.source] as number | ValueParam<number>,
                    f.glslType === 'Spectrum' ? 'vec3' : 'float',
                    f.semantic === 'radiometric' ? 'color' : 'float',
                    uniforms, parameters, seen,
                );
            }
        }
    }
    // DERIVED σ̄ uniforms for {param}-driven tracking media (batch 2) — no parameter
    // metadata of their own: they ride the σ params' sliders through their closures.
    for (const m of majorants.values()) if (m.uniform) uniforms.push(m.uniform);
    // DERIVED material-field uniforms (D4) — same discipline as the majorants.
    for (const list of derivedByMat.values()) for (const e of list) if (e.uniform) uniforms.push(e.uniform);

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

// ============================================================================
// Generated material lookup (per-scene codegen)
// ============================================================================

/** A D4 derived field's emitted form for ONE material: the expression the lookup arm
 *  assigns, plus the uniform when any input is driven (the majorantSpec pattern). */
type DerivedExpr = { name: string; expr: string; uniform?: PlannedUniform };

/** Resolve a spec's row inputs (constants + {param} substituted live) — the ONE
 *  substitution the plan-time bake and the compute closure share (bake ≡ ship). */
function resolveDerivedInputs(mat: PlannedMaterial, inputs: string[], params: Record<string, unknown> = {}): Record<string, number | number[]> {
    const out: Record<string, number | number[]> = {};
    for (const src of inputs) {
        const v = mat.values[src];
        out[src] = isValueParam(v)
            ? (params[v.param] ?? v.default) as number | number[]
            : v as number | number[];
    }
    return out;
}

function materialDerivedExpr(mat: PlannedMaterial, s: MaterialDerivedSpec): DerivedExpr {
    const fmt = (s.glslType === 'Spectrum' ? formatSpectrum : formatFloat) as (x: never) => string;
    const deps = s.inputs.map((src) => mat.values[src]).filter((v) => isValueParam(v)).map((v) => (v as ValueParam<number>).param);
    if (deps.length === 0) {
        return { name: s.name, expr: fmt(s.fn(resolveDerivedInputs(mat, s.inputs)) as never) };
    }
    const uName = `u_${s.name}_${mat.id}`;
    return {
        name: s.name,
        expr: uName,
        uniform: {
            name: uName,
            type: s.glslType === 'Spectrum' ? 'vec3' : 'float',
            parameterPath: deps[0], parameterPaths: deps,
            default: s.fn(resolveDerivedInputs(mat, s.inputs)),
            compute: (p) => s.fn(resolveDerivedInputs(mat, s.inputs, p)),
        },
    };
}

function generateMaterialLookup(materials: PlannedMaterial[], fields: PropertySchema[], derivedByMat: Map<number, DerivedExpr[]>): string {
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
            const value = mat.values[f.source] as ParamValue;
            const target = `        props.${f.name}`;
            const fmt = (f.glslType === 'Spectrum' ? formatSpectrum : formatFloat) as (x: never) => string;
            // Constant emission is assigned only when nonzero (the gate's `> 0` twin); a
            // driven/expression emission always assigns (it may be nonzero at runtime).
            if (f.name === 'emission' && !isValueParam(value) && !isGlslExpression(value)) {
                const rgb = value as Vec3;
                if (rgb[0] > 0 || rgb[1] > 0 || rgb[2] > 0) body.push(`${target} = ${formatSpectrum(rgb)};`);
                continue;
            }
            body.push(`${target} = ${emitValue(value, fmt)};`);
        }
        // DERIVED fields (D4): assigned after the rows they derive from.
        for (const e of derivedByMat.get(mat.id) ?? []) {
            body.push(`        props.${e.name} = ${e.expr};`);
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

// The constant/driven split is emitValue's; this adapter adds only the MEDIUM's expression
// policy (the third axis): a coefficient formula gets the nonnegativity floor, a phase-param
// formula is rejected (the Validator already guarantees phase params never vary spatially).
function mediumPropertyExpr(prop: ParamValue, name: string, format: (v: never) => string): string {
    const isCoefficient = name === 'sigma_a' || name === 'sigma_s' || name === 'emission';
    return emitValue(prop, format, (e) => {
        if (isCoefficient) {
            // Heterogeneous coefficient (fable-heterogeneous-media.md D4): the authored
            // formula of `p` (+ declared-param uniforms). Spectrum(...) broadcasts a scalar
            // source and passes a vec3 one through; the max(…, 0.0) floor makes coefficients
            // nonnegative by definition (σ < 0 would poison probabilities and weights).
            return `max(Spectrum(${e.source}), 0.0)`;
        }
        throw new Error(`materials: medium.${name} cannot be a GLSL expression (only sigma_a/sigma_s may vary spatially)`);
    });
}

function generateMediumProperties(materials: PlannedMaterial[], models: string[], phaseFields: PropertySchema[], wantsEmission: boolean): string {
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
    if (wantsEmission) lines.push('    m.emission = SPECTRUM_ZERO;');
    for (const f of phaseFields) lines.push(`    m.${f.name} = ${defaultExpr(f)};`);
    if (hasModel) lines.push('    m.model = 0;');
    for (let i = 0; i < withMedium.length; i++) {
        const mat = withMedium[i];
        const med = mat.medium!;
        const cond = i === 0 ? 'if' : 'else if';
        lines.push(`    ${cond} (mat == ${mat.id}) {   // '${mat.name}'`);
        lines.push(`        m.sigma_a = ${mediumPropertyExpr(med.sigma_a, 'sigma_a', formatSpectrum)};`);
        lines.push(`        m.sigma_s = ${mediumPropertyExpr(med.sigma_s, 'sigma_s', formatSpectrum)};`);
        if (wantsEmission && isEmissiveMedium(med)) {
            lines.push(`        m.emission = ${mediumPropertyExpr(med.emission, 'emission', formatSpectrum)};`);
        }
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
            if (wantsEmission && isEmissiveMedium(med)) {
                // P2 (owner-pinned): ε scales with the extinction — a clamped region
                // preserves its source function ε/σ_t, exactly as the scale preserves albedo.
                lines.push('        m.emission *= sigma_scale;');
            }
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
function generateMediumSample(plan: RenderPlan, majorants: Map<number, MajorantSpec>): string {
    const withMedium = plan.materials.filter((m) => m.medium !== null);
    const scatteringLive = plan.program.media.scatteringArms;

    const lines: string[] = ['// Generated volumetric-component dispatch (seam 1, fable-volumetric-component §2)'];
    lines.push('MediumSample medium_sample(int med, Ray ray, float t_max, vec2 xi) {');
    lines.push('    MediumSample ms;');
    lines.push('    ms.scattered = false;');
    lines.push('    ms.t = t_max;');
    lines.push('    ms.weight = SPECTRUM_ONE;');
    lines.push('    ms.radiance = SPECTRUM_ZERO;');
    const wantsEmission = plan.program.media.emission;
    for (const mat of withMedium) {
        const med = mat.medium!;
        const scatters = scatteringLive && mediumMayScatter(med);   // the ONE census predicate (types.ts)
        if (mediumRoutesToTracking(med, scatters)) {
            const maj = majorants.get(mat.id)!.expr;
            lines.push(`    if (med == ${mat.id}) {   // '${mat.name}' — tracking arms, ${scatters ? 'scattering (delta tracking)' : 'absorbing-only (ratio-tracked pass-through)'}`);
            lines.push(scatters
                ? `        return medium_sample_delta(${mat.id}, ${maj}, ray, t_max, xi);`
                : `        return medium_sample_ratio_absorb(${mat.id}, ${maj}, ray, t_max);`);
        } else {
            lines.push(`    if (med == ${mat.id}) {   // '${mat.name}' — ${scatters ? 'scattering (analytic channel-MIS)' : 'absorbing-only (deterministic)'}`);
            if (scatters) {
                lines.push(`        return medium_sample_analytic(scene_medium_properties(${mat.id}, ray.origin), t_max, xi);`);
            } else {
                lines.push(`        MediumProperties m = scene_medium_properties(${mat.id}, ray.origin);`);
                if (wantsEmission && isEmissiveMedium(med)) {
                    // Emission closed form (impl-plan-medium-emission E1.5): the exact
                    // ∫₀ᵗ e^{−σ_a s} ε ds = ε·(1−e^{−σ_a t})/σ_a. σ_a floored at 1e-6
                    // for BOTH factors so the pair stays consistent — the σ_a→0 limit
                    // ε·t is reached with relative error ~1e-6·t, below fp32 noise.
                    lines.push('        Spectrum sa = max(m.sigma_a, Spectrum(1e-6));');
                    lines.push('        ms.weight = spectrum_exp(-sa * t_max);');
                    lines.push('        ms.radiance = m.emission * (SPECTRUM_ONE - ms.weight) / sa;');
                } else {
                    lines.push('        ms.weight = spectrum_exp(-m.sigma_a * t_max);');
                }
            }
        }
        lines.push('    }');
    }
    lines.push('    return ms;');
    lines.push('}');
    return lines.join('\n');
}

/** Resolved max-channel σ_t of a NON-expression medium (constants + {param} substituted
 *  live) — THE derived majorant (impl-plan-env-power-selection batch 2): for constant and
 *  {param}-driven coefficients the exact ceiling IS the live extinction, so σ̄ can never
 *  go stale under a slider. Floored at 1e-6: sliding to vacuum keeps the tracking jump
 *  finite (one giant step → transmitted — the right physics, no ÷0). */
export function derivedMajorant(med: PlannedMedium, params: Record<string, unknown> = {}): number {
    const resolve = (v: Vec3 | GlslExpression | ValueParam<Vec3>): number[] => {
        if (isValueParam(v)) {
            const raw = params[v.param] ?? v.default;
            return typeof raw === 'number' ? [raw, raw, raw] : (raw as number[]) ?? [0, 0, 0];
        }
        return v as Vec3;   // expression media never reach here (authored-σ̄ route)
    };
    const a = resolve(med.sigma_a);
    const s = resolve(med.sigma_s);
    return Math.max(1e-6, ...a.map((x, i) => x + s[i]));
}

/** How a tracking-routed medium's σ̄ is spelled in the emitted arm (batch 2):
 *  - expression coefficients → the AUTHORED ceiling literal (D1: the medium IS min(σ, σ̄),
 *    clamped in the lookup; Validator-guaranteed present);
 *  - all-constant → the derived literal (P5 — byte-identical to before);
 *  - any {param} coefficient → a DERIVED `u_majorant_<id>` uniform whose compute closure
 *    re-derives max-channel σ_t from the live params (bake ≡ ship — the light-CDF sibling).
 *  Authored majorants on non-expression media are inert (Validator warns). */
type MajorantSpec = { expr: string; uniform?: PlannedUniform };

function majorantSpec(mat: PlannedMaterial): MajorantSpec {
    const med = mat.medium!;
    if (isHeterogeneousMedium(med)) {
        if (med.majorant === undefined) {
            // Backstop — the Validator pairs expression coefficients with a declared σ̄.
            throw new Error(`materials: medium of '${mat.name}' has expression coefficients but no majorant`);
        }
        return { expr: formatFloat(med.majorant) };
    }
    const deps = [med.sigma_a, med.sigma_s].filter((v) => isValueParam(v)).map((v) => (v as ValueParam<Vec3>).param);
    if (deps.length === 0) return { expr: formatFloat(derivedMajorant(med)) };
    const name = `u_majorant_${mat.id}`;
    return {
        expr: name,
        uniform: {
            name, type: 'float',
            parameterPath: deps[0], parameterPaths: deps,
            default: derivedMajorant(med),
            compute: (p) => derivedMajorant(med, p),
        },
    };
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
            // Expression media only on this arm — the AUTHORED ceiling (Validator-paired);
            // {param}/constant media take the exact analytic branch below.
            const maj = majorantSpec(mat).expr;
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
