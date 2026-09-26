// compiler/generate/features/lighting.ts
// Direct lighting (NEE): per-kind sampler libraries + the generated selection dispatcher +
// the light_of region table (§6.2 registry). Only present when the plan enables NEE.
// Mirrors the material pattern: fixed per-kind GLSL (light_point/quad/sphere.glsl) + a
// generated `lighting_sample` that CDF-selects a light and calls its kind sampler (§6.1/§3.3).

import type { RenderPlan, PlannedLight, AttributeValue } from '../../plan/types.js';
import { isAttributeValue } from '../../plan/types.js';
import { isValueParam, isBlackbody } from '../../types.js';
import { blackbodyRGB } from '../../../components/lights/blackbody.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import type { ShaderBlock } from '../ShaderIR.js';
import { formatFloat, formatSpectrum, formatVec3 } from '../../../components/glsl-format.js';
import { emitValue, mintValueUniform, type ParamValue } from '../values.js';
import { LIGHT_KINDS } from '../../../components/lights/index.js';
import { EMISSION_KEY } from '../../../components/materials/index.js';
import { PRIMITIVES } from '../../../components/geometry/index.js';
import type { LightKindDescriptor } from '../../../components/descriptors.js';
import { structFromRows } from '../schema.js';

import shadowOpaqueGLSL from '../../../components/transport/shadow/opaque/opaque.glsl?raw';
import shadowMediaGLSL from '../../../components/transport/shadow/media/media.glsl?raw';
import lightTreeGLSL from '../../../components/accel/light_tree/light_tree.glsl?raw';
import { lightTableLayout, type LightTableLayout } from '../../../components/lights/table.js';

export function contributeLighting(plan: RenderPlan): FeatureContribution {
    if (plan.program.estimator.lighting === null) {
        return emptyContribution('lighting');
    }

    const blocks: ShaderBlock[] = [];
    const defines: Record<string, string> = {};
    const uniforms: FeatureContribution['uniforms'] = [];
    const parameters: FeatureContribution['parameters'] = {};

    // Environment as a light (T3): the env joins selection through a TWO-STAGE draw —
    // stage 0 picks env-vs-finite with probability u_envSelectProb, stage 1 is the baked
    // CDF (rescaled). The two-stage shape is the exact FACTORIZATION of an (N+1)-entry
    // power CDF (env mass p vs finite mass 1−p, then the finite CDF within), so since
    // impl-plan-env-power-selection the env is selection-commensurable with every other
    // light: u_envSelectProb is a DERIVED uniform — the power partition Φ_env/(Φ_env+ΣΦ),
    // recomputed live from env intensity, the loaded table's luminance mass, and driven
    // emissions (the u_light_cdf closure's sibling). An authored estimator.envSelectWeight
    // overrides it with a constant (+ the slider), Validator-checked (0,1).
    const envSamplable = plan.program.environmentSamplable;
    // The uniform exists iff the selection draw is LIVE (finite lights split mass with
    // the env — the environmentSelectionLive decision). Env-only programs fold the
    // selection to the constant 1 on BOTH sides (sampler here, pdf in the combiner):
    // there is no other technique to absorb the remaining mass — changing 1.0 would be
    // bias, so no dead uniform is declared either.
    if (plan.program.environmentSelectionLive) {
        const override = plan.program.estimator.lighting.envSelectWeight;
        if (override !== undefined) {
            uniforms.push({ name: 'u_envSelectProb', type: 'float', parameterPath: 'env.selectProb', default: override });
            parameters['env.selectProb'] = {
                type: 'float', default: override, range: [0.05, 0.95],
                name: 'Env select P', group: 'Environment', triggersReset: true,
            };
        } else {
            // DERIVED (category 5): no slider — the probability rides its inputs' sliders
            // through the closure (a manual env.selectProb would fight the recompute).
            const deps = envSelectionDeps(plan);
            uniforms.push({
                name: 'u_envSelectProb', type: 'float',
                parameterPath: deps[0], parameterPaths: deps,
                default: envSelectionProbability(plan, {}),
                compute: (p) => envSelectionProbability(plan, p),
            });
        }
    }
    // Shadow query behind the §6.3 contract — the compiler specializes: the boolean-fast-path
    // opaque form for media-free scenes, the spectral segment walker (composing the generated
    // medium_transmittance, seam 2) when media exist. The NEE call sites never change.
    if (plan.program.media.shadowWalker) {
        blocks.push({ origin: 'components/transport/shadow/media/media.glsl', source: shadowMediaGLSL });
    } else {
        blocks.push({ origin: 'components/transport/shadow/opaque/opaque.glsl', source: shadowOpaqueGLSL });
    }

    // Selection occupant (fable-light-bvh §2/§7 — LIGHT_SELECTIONS registry id),
    // resolved BEFORE the kind census: batch instance lights (stage 2) exist only
    // under 'bvh' and pull the sphere kind in even when no registry light is one.
    const selection = plan.program.estimator.lighting.selection;
    const instanceLights = selection === 'bvh' ? (plan.lightTree?.instanceLights ?? []) : [];
    const bvh = selection === 'bvh' && (plan.lights.length > 0 || instanceLights.length > 0);
    if (bvh && plan.lightTree === undefined) {
        // The Validator's eligibility pin guarantees the tenant; this is the backstop.
        throw new Error("lighting: lightSelection 'bvh' but the plan carries no lightTree slot (roster ineligible — Validator should have rejected)");
    }
    // Batch light arms (fable-light-bvh §7/§7.1): the params-tier placement record IS
    // the sphere-light row; Le is the batch material's constant literal OR the minted
    // per-instance emission ATTRIBUTE ref (the same records row the hit-side fill
    // reads — sampler, pdf, and chance-hit emission share one storage truth).
    const batchArms: BatchLightArm[] = instanceLights.map((il) => {
        const b = plan.instanceBatches.find((x) => x.ordinal === il.ordinal);
        if (b === undefined) throw new Error(`lighting: instanceLights ordinal ${il.ordinal} has no planned batch`);
        const le = plan.materials[b.materialId]?.values[EMISSION_KEY];
        if (!Array.isArray(le) && !isAttributeValue(le)) throw new Error(`lighting: batch ${il.ordinal} light arm needs a constant or attribute vec3 emission (eligibility should have guaranteed it)`);
        return { base: il.base, count: il.count, region: b.index, placementsBase: b.slot.placementsBase, le: Array.isArray(le) ? le as number[] : le };
    });

    // Per-kind sampler libraries for the kinds present (registry-driven, R1b; declared
    // before the dispatcher). Structs generated from the rows first (A1).
    const presentKinds = Object.keys(LIGHT_KINDS).filter((kind) =>
        plan.lights.some((l) => l.kind === kind) || (kind === 'sphere' && batchArms.length > 0));
    if (presentKinds.length > 0) {
        blocks.push({
            origin: 'generated:light-structs',
            source: ['// Generated light structs (rows are the single source — A1)',
                ...presentKinds.map((kind) => {
                    const d = LIGHT_KINDS[kind];
                    const sn = kind[0].toUpperCase() + kind.slice(1) + 'Light';
                    return structFromRows(sn, [...d.params, ...(d.derivedFields ?? [])]);
                })].join('\n'),
        });
    }
    for (const kind of presentKinds) {
        blocks.push({ origin: `components/lights/${kind}/${kind}.glsl`, source: LIGHT_KINDS[kind].glsl });
    }

    // Under 'bvh' the registry lights are TABLE-resident and selection is the
    // generated tree-walk pair; the accessor/CDF machinery below is structurally
    // absent. Under 'power'/'uniform' nothing changes (the carve gate).
    const layout = bvh ? lightTableLayout(plan.lights.map((l) => l.kind)) : null;

    // Hoisted light consts (struct-alignment batch, the N5 pattern): every light is
    // One accessor per light (`light_get_<id>()`), the single construction site shared by the
    // sampler dispatcher, the MIS pdf query, and the delta query — constants baked inside,
    // driven rows reading their uniforms (Model B). Table-resident (bvh) programs read
    // records rows through the generated loaders instead — no accessors emitted.
    if (plan.lights.length > 0 && !bvh) {
        blocks.push({ origin: 'generated:light-accessors', source: generateLightAccessors(plan.lights) });
    }
    if (bvh && layout !== null && plan.lightTree !== undefined) {
        blocks.push({ origin: 'components/accel/light_tree/light_tree.glsl', source: lightTreeGLSL });
        if (plan.lights.length > 0) {
            blocks.push({ origin: 'generated:light-table-loaders', source: generateLightRowLoaders(layout, plan.lightTree) });
        }
        blocks.push({ origin: 'generated:light-tree-walks', source: generateLightTreeWalks(plan.lightTree) });
    }

    // Selection pdfs are computed ONCE and shared by the sampler and the MIS pdf query —
    // lighting_pdf must byte-match lighting_sample's selection (the env-sampling lesson,
    // pitfall 11, applied to the CDF). Inert under bvh (the tree IS the selection pdf).
    const selectPdf = bvh ? [] : computeSelectPdf(plan.lights, selection);

    // Driven-lights Stage A: literal→uniform substitutions + the CPU-recomputed selection
    // arrays. Constant scenes have driven=false → nothing below fires, byte-identical.
    const driven = plan.program.emitters.driven;
    if (driven) {
        const seen = new Set<string>();
        // Emission uniforms for driven DELTA lights (point/spot/…) via the shared minter — a
        // hittable light's emission rides the synthesized __light_n material's uniform (same
        // path, same name; merge dedups). mintValueUniform no-ops on constant rows.
        for (const l of plan.lights) {
            if (l.regionId !== undefined) continue;   // hittable: material owns the uniform
            for (const [row, v] of Object.entries(l.values)) {
                // The row's declared shape drives the uniform type — a driven float row
                // (e.g. a future driven cone angle) mints a float, not a mistyped vec3.
                const spec = LIGHT_KINDS[l.kind]?.params.find((p) => p.name === row);
                const isVec3 = (spec?.shape ?? 'vec3') === 'vec3';
                mintValueUniform(v as ParamValue, isVec3 ? 'vec3' : 'float', isVec3 ? 'color' : 'float', uniforms, parameters, seen, isVec3);   // E2: light radiometrics are HDR
            }
        }
        // Selection CDF + per-light select-pdf as CPU-computed float arrays (>1 light only;
        // a single light has select_pdf ≡ 1). ONE computeSelectPdf call per array, run at
        // plan time (default) and on any driven-emission change (compute) — the bake≡ship truth.
        if (plan.lights.length > 1) {
            const paths = drivenEmissionPaths(plan.lights);
            const n = plan.lights.length;
            uniforms.push({
                name: 'u_light_selpdf', type: 'float[]', arrayLength: n,
                parameterPath: paths[0], parameterPaths: paths,
                default: selectPdf,   // the ONE plan-time computation above
                compute: (p) => computeSelectPdf(plan.lights, selection, p),
            });
            uniforms.push({
                name: 'u_light_cdf', type: 'float[]', arrayLength: n,
                parameterPath: paths[0], parameterPaths: paths,
                default: cumulative(selectPdf),
                compute: (p) => cumulative(computeSelectPdf(plan.lights, selection, p)),
            });
        }
    }

    blocks.push({
        origin: 'generated:light-sampling',
        source: bvh && layout !== null && plan.lightTree !== undefined
            ? generateLightSamplingBvh(layout, plan.lightTree, plan.program.environmentSelectionLive, batchArms, plan.lights.filter((l) => l.mesh !== undefined))
            : generateLightSampling(plan.lights, selectPdf, envSamplable, plan.program.environmentSelectionLive, driven),
    });

    // Equiangular placement needs the light's POSITION before choosing t — a query the
    // solid-angle-from-p sampler cannot answer (impl-plan-equiangular). Emitted only under
    // the knob; the Validator has already guaranteed every light is delta (v1 pin 1).
    if (plan.program.estimator.mediumLightSampling === 'equiangular') {
        blocks.push({ origin: 'generated:lighting-query-delta', source: generateLightingQueryDelta(plan.lights, selectPdf, driven) });
    }

    // §6.2 registry table + the transport emission-bookkeeping gate: only when a samplable
    // NON-DELTA emitter exists (delta-only scenes preprocess to the pre-area-light program).
    // The DECISIONS are Planner-made (program.emitters, T2); the list is codegen data.
    const samplable = plan.lights.filter((l) => l.regionId !== undefined);
    if (plan.program.emitters.samplable) {
        blocks.push({ origin: 'generated:light-of', source: generateLightOf(samplable, batchArms) });
        // The MIS pdf query (§6.1): only under 'mis' — its sole reader is the emitter-hit weight.
        if (plan.program.emitters.lightingPdf) {
            blocks.push({
                origin: 'generated:lighting-pdf',
                source: bvh && layout !== null && plan.lightTree !== undefined
                    ? generateLightingPdfBvh(layout, plan.lightTree, plan.program.environmentSelectionLive, batchArms)
                    : generateLightingPdf(plan.lights, selectPdf, plan.program.environmentSelectionLive, driven),
                // (mesh pdf arms need no per-light bases — the mesh pdf is identity-free)
            });
        }
    }

    // T4 seams: the §6.1/§6.2/§6.3 direct-lighting contract surface.
    const provides = [
        { name: 'lighting_sample', signature: 'LightSample lighting_sample(LightQuery q, vec2 xi)' },
        { name: 'shadow_transmittance', signature: 'Spectrum shadow_transmittance(Ray shadow_ray, Point light_p, int crossings_left)' },
    ];
    if (plan.program.emitters.samplable) {
        provides.push({ name: 'light_of', signature: 'int light_of(int region, int element)' });
    }
    if (plan.program.emitters.lightingPdf) {
        provides.push({ name: 'lighting_pdf', signature: 'float lighting_pdf(LightQuery q, Direction wi, int light_id, Hit light_hit)' });
    }
    if (plan.program.estimator.mediumLightSampling === 'equiangular') {
        provides.push({ name: 'lighting_query_delta', signature: 'float lighting_query_delta(float uc, out Point pos, out Spectrum intensity)' });
    }
    const requires: string[] = [];
    // DATA-DRIVEN mesh lights (fable-mesh-lights, rail v2): the sampler reads three
    // CHANNELS — declared where consumed (merge dedups with the intersection feature's
    // declarations of the same channels). The rail's addressing (data_texel1d) is
    // provided by the intersection feature (a mesh light implies meshes).
    const textures: FeatureContribution['textures'] = [];
    if (plan.lights.some((l) => l.mesh !== undefined)) {
        textures.push(
            { name: 'u_data_indices', source: 'extern:data_indices' },
            { name: 'u_data_vertices', source: 'extern:data_vertices' },
            { name: 'u_data_records', source: 'extern:data_records' },
        );
        requires.push('data_texel1d');
    }
    // The light tree (fable-light-bvh §5): nodes + table/trails ride the shared
    // channels — declared where consumed (merge dedups with the intersection feature's
    // declarations); the rail's addressing comes from intersection's needDataRail,
    // which learned the bvh-selection condition.
    if (bvh) {
        textures.push(
            { name: 'u_data_nodes', source: 'extern:data_nodes' },
            { name: 'u_data_records', source: 'extern:data_records' },
        );
        requires.push('data_texel1d');
    }
    if (envSamplable) requires.push('environment_sample');
    // The env pdf query links only from the MIS sites (the environmentPdf decision):
    // under plain NEE the sampler carries its own ls.pdf and nothing queries by direction.
    if (plan.program.environmentPdf) requires.push('environment_pdf');
    if (plan.program.media.shadowWalker) {
        // shadow_media walks segments: re-spawned scene_intersect + the generated seams.
        requires.push('scene_intersect', 'material_of', 'material_has_medium', 'is_null_interface', 'medium_transmittance');
    } else {
        requires.push('scene_intersect_any');   // the §6.3 boolean fast path
    }

    return { ...emptyContribution('lighting'), blocks, defines, uniforms, parameters, textures, provides, requires };
}

// ============================================================================
// Generated region → light-id table (§6.2: identity lives on REGIONS, never materials —
// two panels sharing one emissive material are two lights)
// ============================================================================

function generateLightOf(samplable: PlannedLight[], batchArms: BatchLightArm[]): string {
    const lines: string[] = ['// Generated (region, element) -> samplable-light table (§6.2 + fable-light-bvh §7;'];
    lines.push('// -1 = path-only or non-emitter; element indexes batch instances, ignored elsewhere)');
    lines.push('int light_of(int region, int element) {');
    for (const l of samplable) {
        lines.push(`    if (region == ${l.regionId}) return ${l.id};`);
    }
    for (const a of batchArms) {
        lines.push(`    if (region == ${a.region}) return ${a.base} + element;   // batch instances (record order = element)`);
    }
    lines.push('    return -1;');
    lines.push('}');
    return lines.join('\n');
}

// ============================================================================
// Generated delta-light query — equiangular placement (impl-plan-equiangular)
// ============================================================================

/** Position + radiant intensity (color·intensity, WITHOUT 1/d² — §6.1 folds that at
 *  the estimate site) + selection pdf, selected by the SAME compile-time CDF as
 *  lighting_sample (one selection truth, two readers — the pitfall-11 discipline).
 *  Rows come from the kind's ISOTROPIC deltaQuery fact — never by hardcoded name
 *  (the spot lesson: an anisotropic delta's on-axis intensity would BIAS the
 *  equiangular estimate, so such kinds declare no fact and the Validator rejects
 *  them under 'equiangular'; every light reaching here is delta AND isotropic). */
function generateLightingQueryDelta(lights: PlannedLight[], selectPdf: number[], driven: boolean): string {
    const lines = [
        '// Generated delta-light query (equiangular placement): position + intensity + select pdf.',
        'float lighting_query_delta(float uc, out Point pos, out Spectrum intensity) {',
    ];
    // Same selection builder as the sampler — so the threshold (cdf) and the returned pdf are
    // driven-aware in lockstep (a driven delta light under equiangular now reads the live
    // u_light_cdf threshold, not a stale baked literal).
    const sel = selectionExprs(selectPdf, driven && lights.length > 1);
    const arm = (l: PlannedLight, i: number) => {
        const q = lightKind(l).deltaQuery!;   // Validator-guaranteed (the isotropy pin)
        // Position is geometry (constant in v1); intensity routes through the shared split.
        const intensityE = emitValue(l.values[q.intensityRow] as ParamValue, formatSpectrum as (x: never) => string);
        return [
            `pos = ${formatVec3(l.values[q.positionRow] as number[])};`,
            `intensity = ${intensityE};`,
            `return ${sel.selpdf(i)};`,
        ];
    };
    if (lights.length === 1) {
        lines.push(...arm(lights[0], 0).map((s) => `    ${s}`));
    } else {
        for (let i = 0; i < lights.length; i++) {
            if (i < lights.length - 1) {
                lines.push(`    if (uc < ${sel.cdf(i)}) { ${arm(lights[i], i).join(' ')} }`);
            } else {
                lines.push(`    ${arm(lights[i], i).join(' ')}`);   // last arm unconditional
            }
        }
    }
    lines.push('}');
    return lines.join('\n');
}

/** Substitute a light's driven RADIOMETRIC rows with concrete values (driven-lights
 *  Stage A) — a `ValueParam` row → `params[path] ?? default`, broadcasting a scalar to a
 *  Spectrum vec3 (§2.5); constant rows pass through. This is the ONE substitution truth:
 *  the plan-time bake calls it with `{}` (defaults) and the CDF compute closure with live
 *  store values, so `computeSelectPdf`/`power` see identical resolved values on both paths
 *  (the `similarityFromTransform` bake≡ship precedent). No-op for constant lights. */
export function resolveLightValues(l: Pick<PlannedLight, 'values'>, params: Record<string, unknown> = {}): Record<string, number | number[]> {
    const out: Record<string, number | number[]> = {};
    for (const [k, v] of Object.entries(l.values)) out[k] = resolveRadiometricValue(v, params);
    return out;
}

/** A radiometric value at the given parameter values — the ONE evaluator for driven
 *  radiometric values (light rows and the constant sky color): a `{param}` reads its
 *  value (a scalar broadcasts to a spectrum), a blackbody evaluates chroma × scale with
 *  its dials read live (the kelvin slider reshuffles the power CDF through the same
 *  body the bake used), and anything else is already a constant and passes through. */
function resolveRadiometricValue(v: unknown, params: Record<string, unknown>): number | number[] {
    if (isValueParam(v)) {
        const raw = params[v.param] ?? v.default;
        return typeof raw === 'number' ? [raw, raw, raw] : raw as number[];
    }
    if (isBlackbody(v)) {
        const { kelvin, scale } = v.blackbody;
        return blackbodyRGB(
            isValueParam(kelvin) ? ((params[kelvin.param] as number) ?? kelvin.default ?? 6500) : kelvin,
            scale === undefined ? 1 : isValueParam(scale) ? ((params[scale.param] as number) ?? scale.default ?? 1) : scale,
        );
    }
    return v as number | number[];
}

/** The parameter paths a radiometric value reads (a {param}, or a blackbody's driven dials). */
function radiometricValueDeps(v: unknown): string[] {
    if (isValueParam(v)) return [v.param];
    if (isBlackbody(v)) {
        const { kelvin, scale } = v.blackbody;
        return [...(isValueParam(kelvin) ? [kelvin.param] : []), ...(scale !== undefined && isValueParam(scale) ? [scale.param] : [])];
    }
    return [];
}

/** Emitted power for CDF selection — the kind descriptors carry the pbrt formulas
 *  (area-aware, pitfall 6). Reads RESOLVED values (driven rows substituted). Exported
 *  for the H6 invariant tests. */
export function lightPower(l: PlannedLight, params: Record<string, unknown> = {}): number {
    const d = LIGHT_KINDS[l.kind];
    return d !== undefined ? d.power(resolveLightValues(l, params), l.powerCtx) : 1e-8;   // backstop; the Validator rejects unregistered kinds
}

function lightKind(l: PlannedLight): LightKindDescriptor {
    const d = LIGHT_KINDS[l.kind];
    if (d === undefined) throw new Error(`lighting: unsupported light kind '${l.kind}' (Validator should have rejected it)`);
    return d;
}

// ============================================================================
// Driven-lights Stage A: CPU-side minting (the precompute-and-ship rule)
// ============================================================================

/** Distinct driven-emission parameter paths across all lights — the `parameterPaths` the
 *  selection arrays depend on (any one changing recomputes the whole CDF). */
function drivenEmissionPaths(lights: PlannedLight[]): string[] {
    const s = new Set<string>();
    for (const l of lights) for (const v of Object.values(l.values)) {
        if (isValueParam(v)) s.add(v.param);
        else if (isBlackbody(v)) {   // driven dials feed the CDF closures too
            if (isValueParam(v.blackbody.kelvin)) s.add(v.blackbody.kelvin.param);
            if (v.blackbody.scale !== undefined && isValueParam(v.blackbody.scale)) s.add(v.blackbody.scale.param);
        }
    }
    return [...s];
}

/** Cumulative sum — the selection CDF from per-light selection pdfs (shipped, not derived on the GPU). */
function cumulative(sp: number[]): number[] {
    const out: number[] = [];
    let acc = 0;
    for (const s of sp) { acc += s; out.push(acc); }
    return out;
}

/** THE ONE builder + reader for the selection CDF (G1/G2): the prefix-sum is computed once
 *  (via `cumulative`), and every reader — the sampler, the MIS pdf query, the equiangular delta
 *  query — asks for the SAME `cdf(i)` / `selpdf(i)` expression. When the arrays are live
 *  (`useArrays` = driven emission AND >1 light, exactly when contributeLighting mints them) the
 *  reader reads the shipped `u_light_cdf`/`u_light_selpdf`; otherwise it bakes the literal. This
 *  kills the three independent prefix-sums that previously had to agree by hand. */
function selectionExprs(selectPdf: number[], useArrays: boolean): { cdf: (i: number) => string; selpdf: (i: number) => string } {
    const cdf = cumulative(selectPdf);
    return {
        cdf: (i) => useArrays ? `u_light_cdf[${i}]` : formatFloat(cdf[i]),
        selpdf: (i) => useArrays ? `u_light_selpdf[${i}]` : formatFloat(selectPdf[i]),
    };
}

/** `<Kind>Light(…rows[, …derived])` — the struct ctor from the descriptor's rows
 *  (row order = ctor order; radiometric values via formatSpectrum, §2.5). The lights
 *  twin of geometry's emitCtor — all compile-time literals until Value<T> lights. */
/** How every reader names light `l`'s struct: always the accessor `light_get_<id>()`
 *  (Model B — structure is uniform-shaped; a driven light MUST use an accessor since a const
 *  can't read a uniform, so a constant light does too, baking its literals inside). */
function lightRef(l: PlannedLight): string {
    return `light_get_${l.id}()`;
}

function lightCtor(l: PlannedLight): string {
    const d = lightKind(l);
    const structName = d.kind[0].toUpperCase() + d.kind.slice(1) + 'Light';
    const args = d.params.map((row) => {
        // The constant/driven split is emitValue's: a driven radiometric row reads its uniform
        // (for a HITTABLE light the SAME one the synthesized material's emission declares),
        // a constant row bakes its literal via the row's formatter.
        const fmt = (row.shape === 'number' ? formatFloat
            : row.semantic === 'radiometric' ? formatSpectrum : formatVec3) as (x: never) => string;
        return emitValue(l.values[row.name] as ParamValue, fmt);
    });
    // Derived fields (quad normal/area) read GEOMETRY rows, constant in v1 — pass RESOLVED
    // values so the signature stays on concrete numbers (the driven-row substitution is inert
    // here: geometry is never driven in Stage A).
    const derived = (d.derivedCtorFields?.(resolveLightValues(l)) ?? [])
        .map((v) => (Array.isArray(v) ? formatVec3(v) : formatFloat(v)));
    return `${structName}(${[...args, ...derived].join(', ')})`;
}

/** One nullary accessor per light (§6.1), `light_get_<id>()` — the uniform structural shape.
 *  A constant light bakes its literals inside; a driven light reads its uniforms. The GPU
 *  inlines a constant accessor to nothing, so this costs nothing and unifies the readers. */
function generateLightAccessors(lights: PlannedLight[]): string {
    const lines = ['// Generated light accessors (§6.1) — constants baked inline, driven read u_'];
    for (const l of lights) {
        const d = lightKind(l);
        const structName = d.kind[0].toUpperCase() + d.kind.slice(1) + 'Light';
        lines.push(`${structName} light_get_${l.id}() { return ${lightCtor(l)}; }`);
    }
    return lines.join('\n');
}

/** GLSL call that samples light `l` at point `p` — kind sampler over the const/accessor.
 *  DATA-DRIVEN kinds (mesh — fable-mesh-lights) take their rail textures as args: the
 *  shared index texture (the intersection feature's extern, merge-deduped) + the light's
 *  world-position and area-CDF textures. */
function sampleCall(l: PlannedLight, xiExpr: string): string {
    if (l.mesh !== undefined) {
        const m = l.mesh;
        return `mesh_light_sample(${lightRef(l)}, u_data_indices, u_data_vertices, u_data_records, ${m.tbase}, ${m.wposBase}, ${m.cdfBase}, ${m.triCount}, q.p, ${xiExpr})`;
    }
    return `${lightKind(l).kind}_light_sample(${lightRef(l)}, q.p, ${xiExpr})`;
}

// ============================================================================
// Env selection probability — the DERIVED power partition (impl-plan-env-power-selection):
// the env is one more entry in the power CDF; the two-stage draw is its factorization.
// ============================================================================

/** Plan-time scene-radius estimate from descriptor KINDS: over analytic + SDF objects and
 *  lights, max of |point rows| + Σ length-row extents, floored at 1. A declared heuristic —
 *  p_env is variance-only by construction, so a crude r shifts noise, never the mean. */
function sceneRadiusEstimate(plan: RenderPlan): number {
    let r = 1;
    const consider = (params: Record<string, number | number[]>, rows: ReadonlyArray<{ name: string; kind?: string }>) => {
        let center = 0, extent = 0;
        for (const row of rows) {
            const v = params[row.name];
            if (v === undefined || typeof v === 'object' && !Array.isArray(v)) continue;
            if (row.kind === 'point' && Array.isArray(v)) center = Math.max(center, Math.hypot(v[0], v[1], v[2]));
            if (row.kind === 'length') extent += Array.isArray(v) ? Math.max(...v) : (v as number);
        }
        r = Math.max(r, center + extent);
    };
    for (const o of plan.objects) consider(o.parameters, PRIMITIVES[o.type]?.params ?? []);
    for (const l of plan.lights) consider(resolveLightValues(l), LIGHT_KINDS[l.kind]?.params ?? []);
    return r;
}

/** P(select env) in the two-stage NEE draw, derived like every other light's selection:
 *  'uniform' → 1/(N+1); 'power' → Φ_env/(Φ_env + ΣΦ_light) with pbrt's infinite-light
 *  power Φ_env = 4π²r²·L̄·intensity. L̄: constant env = spectrum average of the (live)
 *  color; tabulated envs = the loaded table's luminance mass (env.totalWeight, the CDF
 *  builder's total with constants dropped) converted per chart — L̄ = 1 before the table
 *  loads (declared pre-load default; for MIS-compensated tables the mass is the
 *  COMPENSATED one, deliberately: selection tracks what the env technique samples).
 *  Clamped to [0.01, 0.99] (fp guard; degenerate power sets stay valid draws). */
export function envSelectionProbability(plan: RenderPlan, params: Record<string, unknown> = {}): number {
    const clampP = (p: number) => Math.min(0.99, Math.max(0.01, p));
    const lighting = plan.program.estimator.lighting;
    if (lighting === null) return 0.5;   // unreachable: selection is live only under NEE
    if (lighting.selection === 'uniform') return clampP(1 / (plan.lights.length + 1));

    const env = plan.program.environment;
    const intensity = (params['env.intensity'] as number)
        ?? (env.type !== 'none' ? env.intensity : 1.0);   // C2: plan-resolved
    let meanL = 1.0;
    if (env.type === 'constant') {
        const raw = resolveRadiometricValue(env.color, params);
        const arr = typeof raw === 'number' ? [raw, raw, raw] : raw;
        meanL = (arr[0] + arr[1] + arr[2]) / 3;
    } else if (env.type === 'image' || env.type === 'procedural') {
        const chart = plan.program.estimator.envSampler.chart;
        const total = params['env.totalWeight'] as number | undefined;
        const size = params[chart === 'octahedral' ? 'env.sizeOct' : 'env.size'] as number[] | undefined;
        if (total !== undefined && size !== undefined && size[0] > 0 && size[1] > 0) {
            // totalWeight = Σ Y·w with the chart constants dropped (build-environment-sampler):
            // equirect w = sinθ ⇒ ∫L dΩ = total·2π²/(WH); octahedral w = 1 ⇒ ∫L dΩ = total·4π/(WH).
            // L̄ = ∫L dΩ / 4π.
            const [w, h] = size;
            meanL = chart === 'octahedral' ? total / (w * h) : (total * Math.PI) / (2 * w * h);
        }
    }
    const r = sceneRadiusEstimate(plan);
    const phiEnv = 4 * Math.PI * Math.PI * r * r * meanL * intensity;
    const phiFin = plan.lights.reduce((acc, l) => acc + lightPower(l, params), 0);
    return clampP(phiEnv / Math.max(phiEnv + phiFin, 1e-20));
}

/** The parameter paths the derived p_env depends on (the closure's inputs). */
function envSelectionDeps(plan: RenderPlan): string[] {
    const env = plan.program.environment;
    const deps = new Set<string>(['env.intensity']);
    if (env.type === 'constant') {
        for (const p of radiometricValueDeps(env.color)) deps.add(p);
    } else if (env.type === 'image' || env.type === 'procedural') {
        deps.add('env.totalWeight');
        deps.add(plan.program.estimator.envSampler.chart === 'octahedral' ? 'env.sizeOct' : 'env.size');
    }
    for (const p of drivenEmissionPaths(plan.lights)) deps.add(p);
    return [...deps];
}

/** Compile-time selection pdfs — shared by lighting_sample and lighting_pdf.
 *  Exported for the H6 invariant tests. ('bvh' never calls this — the tree walk IS
 *  its selection pdf; any non-'uniform' id weighs by power.) */
export function computeSelectPdf(lights: PlannedLight[], selection: string, params: Record<string, unknown> = {}): number[] {
    if (lights.length === 0) return [];
    const weights = lights.map((l) => (selection === 'uniform' ? 1 : lightPower(l, params)));
    const total = weights.reduce((a, b) => a + b, 0);
    return weights.map((w) => w / total);
}

// envSamplable: the sky has a sampler (a sky-only program samples it directly). selectionLive:
// the plan's environmentSelectionLive, whether the two-stage sky-vs-lights draw exists.
function generateLightSampling(lights: PlannedLight[], selectPdf: number[], envSamplable: boolean, selectionLive: boolean, driven: boolean): string {
    const lines: string[] = ['// Generated light selection dispatcher (§6.1)'];

    if (lights.length === 0) {
        if (envSamplable) {
            // Env-only: selection probability 1 — lighting_sample IS the env sampler.
            lines.push('LightSample lighting_sample(LightQuery q, vec2 xi) {');
            lines.push('    return environment_sample(q.p, xi);');
            lines.push('}');
            return lines.join('\n');
        }
        lines.push('LightSample lighting_sample(LightQuery q, vec2 xi) {');
        lines.push('    LightSample ls; ls.pdf = 0.0; return ls;'); // no samplable light → NEE skipped
        lines.push('}');
        return lines.join('\n');
    }

    // With a samplable env, the finite-light dispatcher keeps its exact body under a private
    // name and a two-stage wrapper owns the env-vs-finite draw (cdf_rescale on stage 0's
    // random — pitfall 4 applies across stages too).
    const finiteName = selectionLive ? 'lighting_sample_finite' : 'lighting_sample';

    lines.push(`LightSample ${finiteName}(LightQuery q, vec2 xi) {`);
    lines.push('    LightSample ls;');

    if (lights.length === 1) {
        // Single light: selection is trivial (select_pdf = 1); total pdf = per-light pdf.
        lines.push(`    ls = ${sampleCall(lights[0], 'xi')};`);
        lines.push('    ls.light_id = 0;');
    } else {
        // Power-weighted (or uniform) CDF over samplable lights, via the ONE selection builder.
        // Driven emission reads the shipped u_light_cdf/u_light_selpdf arrays (CPU-recomputed);
        // constant scenes bake the literals — byte-identical. The GPU never accumulates/normalizes.
        const sel = selectionExprs(selectPdf, driven && lights.length > 1);

        // Selection + cdf_rescale (pitfall 4: NEVER reuse the raw selection random for surface
        // sampling — recover a fresh stratified coordinate from the selection interval).
        lines.push('    int light_id; float select_pdf; float xr;');
        for (let i = 0; i < lights.length - 1; i++) {
            const kw = i === 0 ? 'if' : 'else if';
            const lo = i === 0 ? '0.0' : sel.cdf(i - 1);
            lines.push(`    ${kw} (xi.x < ${sel.cdf(i)}) { light_id = ${i}; select_pdf = ${sel.selpdf(i)}; xr = (xi.x - ${lo}) / ${sel.selpdf(i)}; }`);
        }
        const last = lights.length - 1;
        const lastLo = sel.cdf(last - 1);
        // The final else closes the CDF — no fallthrough (pitfall 5: the old fallback masked an
        // uninitialized-LightSample bug).
        lines.push(`    else { light_id = ${last}; select_pdf = ${sel.selpdf(last)}; xr = (xi.x - ${lastLo}) / ${sel.selpdf(last)}; }`);
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

    if (selectionLive) {
        lines.push('');
        lines.push('// Two-stage selection (env-as-light D3): stage 0 picks env vs the finite set;');
        lines.push('// pdfs scale by the SAME uniform on both sides (and in lighting_pdf and the');
        lines.push("// miss-MIS weight) — the byte-match invariant extends across the stage.");
        lines.push('LightSample lighting_sample(LightQuery q, vec2 xi) {');
        lines.push('    if (xi.x < u_envSelectProb) {');
        lines.push('        vec2 env_xi = vec2(clamp(xi.x / u_envSelectProb, 0.0, 0.9999999), xi.y);');
        lines.push('        LightSample ls = environment_sample(q.p, env_xi);');
        lines.push('        ls.pdf *= u_envSelectProb;');
        lines.push('        return ls;');
        lines.push('    }');
        lines.push('    float finite_x = clamp((xi.x - u_envSelectProb) / (1.0 - u_envSelectProb), 0.0, 0.9999999);');
        lines.push('    LightSample ls = lighting_sample_finite(q, vec2(finite_x, xi.y));');
        lines.push('    ls.pdf *= (1.0 - u_envSelectProb);');
        lines.push('    return ls;');
        lines.push('}');
    }

    return lines.join('\n');
}

// ============================================================================
// Generated MIS pdf query (§6.1): the density with which lighting_sample(q, ·) would have
// produced direction wi TOWARD THE LIGHT THAT WAS HIT — identity is known (light_of at the
// emitter hit), no search. Per-kind solid-angle pdf recomputed from the hit geometry, × the
// SAME baked selection pdf as the sampler. Delta lights are never queried (pitfall 12) and
// carry no arm; unknown ids return 0 (weight → 1 on the BSDF side, conservative).
// ============================================================================

function generateLightingPdf(lights: PlannedLight[], selectPdf: number[], selectionLive: boolean, driven: boolean): string {
    const lines: string[] = ['// Generated MIS pdf query (§6.1) — must mirror lighting_sample exactly'];
    // With the sky-vs-lights draw live (the plan's environmentSelectionLive), every finite light's
    // selection pdf carries the stage-0 factor — exactly what the sampler applied. The env itself
    // has no arm here (never hit; the miss branch queries u_envSelectProb * environment_pdf
    // directly, reference §8 line 3).
    const stage0 = selectionLive ? ' * (1.0 - u_envSelectProb)' : '';
    const sel = selectionExprs(selectPdf, driven && lights.length > 1);
    lines.push('float lighting_pdf(LightQuery q, Direction wi, int light_id, Hit light_hit) {');
    for (let i = 0; i < lights.length; i++) {
        const l = lights[i];
        if (l.regionId === undefined) continue;   // delta: not hittable, never queried
        const d = lightKind(l);
        if (d.delta) continue;                    // backstop; regionId already filtered
        // Selection pdf = same value the sampler used (the ONE selection builder): the shipped
        // array under driven emission, else the baked literal. Single light ⇒ selection ≡ 1.
        const selBase = lights.length === 1 ? '1.0' : sel.selpdf(i);
        const select = selBase + stage0;
        // The kind's density lives in its GLSL file, ADJACENT to its sampler (the §6.1
        // byte-match invariant is now two functions over one struct) — the arm here is
        // pure composition: selection pdf × the kind's solid-angle pdf. The mesh kind's
        // emitting normal varies per hit (unlike the quad's struct field), so its arm passes
        // the emitter hit's GEOMETRIC normal: the sampler converts area to solid angle with
        // the triangle's plane normal, and the two pdfs must agree (the shading normal of a
        // smooth mesh would not).
        if (l.mesh !== undefined) {
            lines.push(`    if (light_id == ${l.id}) return ${select} * mesh_light_pdf(${lightRef(l)}, q.p, light_hit.p, light_hit.ng, wi);`);
            continue;
        }
        lines.push(`    if (light_id == ${l.id}) return ${select} * ${d.kind}_light_pdf(${lightRef(l)}, q.p, light_hit.p, wi);`);
    }
    lines.push('    return 0.0;');
    lines.push('}');
    return lines.join('\n');
}

// ============================================================================
// Light-tree selection (fable-light-bvh) — the 'bvh' occupant: table-resident lights
// + the generated walk pair. All bases/strides are ledger-baked literals; the ONLY
// shared math (the importance measure) is the static light_tree.glsl, called from
// both walks with the SAME p_l arithmetic — the selectionExprs byte-match discipline
// transported to the tree.
// ============================================================================

type LightTreeSlotBaked = {
    treeBase: number; tableBase: number; trailsBase: number;
    strideTexels: number; count: number; registryCount: number;
    instanceLights: Array<{ ordinal: number; base: number; count: number }>;
};

/** One batch's instance-light arm (fable-light-bvh §7/§7.1): the global-index window
 *  [base, base+count), the batch's region, its placement-record base (the record IS
 *  the sphere-light row: center.xyz, radius), and Le — a baked constant, or the
 *  minted per-instance emission attribute ref (base/slot/count into records). */
interface BatchLightArm { base: number; count: number; region: number; placementsBase: number; le: number[] | AttributeValue }

/** The batch instance's SphereLight ctor from its placement record (params tier);
 *  attribute Le fetches the SAME records texel the hit-side fill reads (one truth). */
function batchSphereExpr(a: BatchLightArm, indexExpr: string): { fetch: string; ctor: string } {
    const leExpr = Array.isArray(a.le)
        ? formatSpectrum(a.le)
        : `texelFetch(u_data_records, data_texel1d(uint(${a.le.attribute.base} + (${indexExpr}) * ${a.le.attribute.count} + ${a.le.attribute.slot})), 0).xyz`;
    return {
        fetch: `vec4 rec = texelFetch(u_data_records, data_texel1d(uint(${a.placementsBase} + (${indexExpr}))), 0);`,
        ctor: `SphereLight(rec.xyz, rec.w, ${leExpr})`,
    };
}

function lightStructName(kind: string): string {
    return kind[0].toUpperCase() + kind.slice(1) + 'Light';
}

/** t<idx>.<comp> for payload float f (floats are packed 4/texel after the header). */
function texelFloatExpr(f: number): string {
    return `t${f >> 2}.${'xyzw'[f & 3]}`;
}

/** A row field's expression: swizzle when the vec3 sits inside one texel, gather when
 *  it spans a boundary (the layout packs floats positionally — fable-light-bvh §4). */
function fieldExpr(f: number, vec3: boolean): string {
    if (!vec3) return texelFloatExpr(f);
    const o = f & 3;
    if (o === 0) return `t${f >> 2}.xyz`;
    if (o === 1) return `t${f >> 2}.yzw`;
    return `vec3(${texelFloatExpr(f)}, ${texelFloatExpr(f + 1)}, ${texelFloatExpr(f + 2)})`;
}

/** One loader per present kind: `<Kind>Light <kind>_light_row(int li)` — positional
 *  float reads in ctor order (rows then derived), mirroring packLightTable exactly
 *  (the ONE layout truth on both sides). */
function generateLightRowLoaders(layout: LightTableLayout, slot: LightTreeSlotBaked): string {
    const lines: string[] = ['// Generated light-table row loaders (fable-light-bvh §4) — mirror packLightTable'];
    for (const kind of layout.kinds) {
        const d = LIGHT_KINDS[kind];
        const rows = [...d.params.map((r) => ({ vec3: r.shape === 'vec3' })), ...(d.derivedFields ?? []).map((r) => ({ vec3: r.shape === 'vec3' }))];
        const floats = rows.reduce((acc, r) => acc + (r.vec3 ? 3 : 1), 0);
        const texels = Math.ceil(floats / 4);
        lines.push(`${lightStructName(kind)} ${kind}_light_row(int li) {`);
        lines.push(`    int rb = ${slot.tableBase} + li * ${slot.strideTexels} + 1;`);
        for (let t = 0; t < texels; t++) {
            lines.push(`    vec4 t${t} = texelFetch(u_data_records, data_texel1d(uint(rb + ${t})), 0);`);
        }
        let f = 0;
        const args = rows.map((r) => { const e = fieldExpr(f, r.vec3); f += r.vec3 ? 3 : 1; return e; });
        lines.push(`    return ${lightStructName(kind)}(${args.join(', ')});`);
        lines.push('}');
    }
    return lines.join('\n');
}

/** The walk pair (fable-light-bvh §3.3) — BORN ADJACENT: same node fetches, same
 *  importance call, same `p_l` / `1.0 - p_l` expressions (never IR/sum — not bit-equal
 *  to 1 − IL/sum), so the pmf the MIS weight reads IS the pmf the sampler drew from.
 *  Fresh RNG per level (§3.4: pcg4d is counter-based — no stratification to preserve,
 *  and the papers' ξ-rescale exhausts fp32 by ~24 levels). The 48-iteration bound is
 *  the builder's enforced trail cap. */
function generateLightTreeWalks(slot: LightTreeSlotBaked): string {
    const TB = slot.treeBase;
    // The four child fetches + both importances, shared VERBATIM by the two walks.
    const step = [
        '        int L = ni + 1;',
        '        int R = int(n1.w);',
        `        vec4 l0 = texelFetch(u_data_nodes, data_texel1d(uint(${TB} + 2 * L)), 0);`,
        `        vec4 l1 = texelFetch(u_data_nodes, data_texel1d(uint(${TB} + 2 * L + 1)), 0);`,
        `        vec4 r0 = texelFetch(u_data_nodes, data_texel1d(uint(${TB} + 2 * R)), 0);`,
        `        vec4 r1 = texelFetch(u_data_nodes, data_texel1d(uint(${TB} + 2 * R + 1)), 0);`,
        '        float iw_l = light_tree_importance(l0.xyz, l1.xyz, l0.w, q);',
        '        float iw_r = light_tree_importance(r0.xyz, r1.xyz, r0.w, q);',
        '        float isum = iw_l + iw_r;',
    ];
    return [
        '// Generated light-tree walk pair (fable-light-bvh §3.3) — adjacent by construction.',
        'float random();   // ambient RNG (sampler family) — forward-declared, order-independent',
        '',
        '// Stochastic descent: importance-weighted child choice, product pmf out.',
        'int light_tree_pick(LightQuery q, float xi, out float pmf) {',
        '    pmf = 1.0;',
        '    int ni = 0;',
        `    vec4 n1 = texelFetch(u_data_nodes, data_texel1d(uint(${TB} + 1)), 0);`,
        '    for (int lvl = 0; lvl < 48; lvl++) {',
        '        if (n1.w < 0.0) break;',
        ...step,
        '        if (isum <= 0.0) { pmf = 0.0; return -1; }',
        '        float p_l = iw_l / isum;',
        '        if (xi < p_l) { pmf *= p_l; ni = L; n1 = l1; }',
        '        else { pmf *= (1.0 - p_l); ni = R; n1 = r1; }',
        '        xi = random();',
        '    }',
        '    return int(-n1.w - 1.0);',
        '}',
        '',
        '// MIS pmf: replay the light\'s stored bit trail (two u24 halves, LSB-first),',
        '// with the STORED query — the exact context the sampler drew from.',
        'float light_tree_pmf(LightQuery q, int light_index) {',
        `    vec4 trail = texelFetch(u_data_records, data_texel1d(uint(${slot.trailsBase} + light_index)), 0);`,
        '    uint tw = uint(trail.x);',
        '    float pmf = 1.0;',
        '    int ni = 0;',
        `    vec4 n1 = texelFetch(u_data_nodes, data_texel1d(uint(${TB} + 1)), 0);`,
        '    for (int lvl = 0; lvl < 48; lvl++) {',
        '        if (n1.w < 0.0) break;',
        '        if (lvl == 24) tw = uint(trail.y);',
        ...step,
        '        if (isum <= 0.0) return 0.0;',
        '        float p_l = iw_l / isum;',
        '        if ((tw & 1u) == 0u) { pmf *= p_l; ni = L; n1 = l1; }',
        '        else { pmf *= (1.0 - p_l); ni = R; n1 = r1; }',
        '        tw >>= 1u;',
        '    }',
        '    return pmf;',
        '}',
    ].join('\n');
}

/** The kind-dispatch header read, shared by the sampler and the pdf query. */
function lightKindHeaderExpr(slot: LightTreeSlotBaked): string {
    return `int(texelFetch(u_data_records, data_texel1d(uint(${slot.tableBase} + light_id * ${slot.strideTexels})), 0).x)`;
}

function generateLightSamplingBvh(layout: LightTableLayout, slot: LightTreeSlotBaked, selectionLive: boolean, batchArms: BatchLightArm[], meshLights: PlannedLight[]): string {
    const finiteName = selectionLive ? 'lighting_sample_finite' : 'lighting_sample';
    const R = slot.registryCount;
    const lines: string[] = ['// Generated light selection dispatcher (fable-light-bvh §3/§7): tree descent over'];
    lines.push('// the GLOBAL index space — [0, R) table-resident registry lights, then per-batch');
    lines.push('// instance windows whose placement records ARE the sphere-light rows.');
    lines.push(`LightSample ${finiteName}(LightQuery q, vec2 xi) {`);
    lines.push('    LightSample ls;');
    lines.push('    float select_pdf;');
    lines.push('    int light_id = light_tree_pick(q, xi.x, select_pdf);');
    lines.push('    if (light_id < 0) { ls.pdf = 0.0; return ls; }   // dead descent: unbiased zero-contribution event');
    lines.push('    vec2 light_xi = vec2(random(), xi.y);');
    let opened = false;
    if (R > 0) {
        lines.push(`    if (light_id < ${R}) {`);
        lines.push(`        int kind = ${lightKindHeaderExpr(slot)};`);
        layout.kinds.forEach((kind, code) => {
            const kw = code === 0 ? 'if' : 'else if';
            if (kind === 'mesh') {
                // DATA-DRIVEN kind (fable-mesh-lights): the row carries (radiance, area);
                // the CDF walk's rail bases are per-LIGHT baked constants — an id chain
                // inside the kind arm (mesh lights are few; the CDF-regime shape).
                lines.push(`        ${kw} (kind == ${code}) {`);
                lines.push('            MeshLight mrow = mesh_light_row(light_id);');
                meshLights.forEach((l, i) => {
                    const m = l.mesh!;
                    const mkw = i === 0 ? 'if' : 'else if';
                    lines.push(`            ${mkw} (light_id == ${l.id}) ls = mesh_light_sample(mrow, u_data_indices, u_data_vertices, u_data_records, ${m.tbase}, ${m.wposBase}, ${m.cdfBase}, ${m.triCount}, q.p, light_xi);`);
                });
                lines.push('            else { ls.pdf = 0.0; return ls; }   // defensive, never packed');
                lines.push('        }');
                return;
            }
            lines.push(`        ${kw} (kind == ${code}) ls = ${kind}_light_sample(${kind}_light_row(light_id), q.p, light_xi);`);
        });
        lines.push('        else { ls.pdf = 0.0; return ls; }   // unknown header — defensive, never packed');
        lines.push('    }');
        opened = true;
    }
    for (const a of batchArms) {
        const kw = opened ? 'else if' : 'if';
        lines.push(`    ${kw} (light_id < ${a.base + a.count}) {   // batch (region ${a.region}) instances`);
        const e = batchSphereExpr(a, `light_id - ${a.base}`);
        lines.push(`        ${e.fetch}`);
        lines.push(`        ls = sphere_light_sample(${e.ctor}, q.p, light_xi);`);
        lines.push('    }');
        opened = true;
    }
    lines.push('    else { ls.pdf = 0.0; return ls; }   // out of range — defensive, never picked');
    lines.push('    ls.light_id = light_id;');
    lines.push('    ls.pdf *= select_pdf;   // total = per-light × selection (§6.1)');
    lines.push('    return ls;');
    lines.push('}');
    if (selectionLive) {
        lines.push('');
        lines.push('// Two-stage selection (env-as-light D3): identical to the CDF regime — the tree');
        lines.push('// replaces only the finite stage; u_envSelectProb is the pInfinite stage.');
        lines.push('LightSample lighting_sample(LightQuery q, vec2 xi) {');
        lines.push('    if (xi.x < u_envSelectProb) {');
        lines.push('        vec2 env_xi = vec2(clamp(xi.x / u_envSelectProb, 0.0, 0.9999999), xi.y);');
        lines.push('        LightSample ls = environment_sample(q.p, env_xi);');
        lines.push('        ls.pdf *= u_envSelectProb;');
        lines.push('        return ls;');
        lines.push('    }');
        lines.push('    float finite_x = clamp((xi.x - u_envSelectProb) / (1.0 - u_envSelectProb), 0.0, 0.9999999);');
        lines.push('    LightSample ls = lighting_sample_finite(q, vec2(finite_x, xi.y));');
        lines.push('    ls.pdf *= (1.0 - u_envSelectProb);');
        lines.push('    return ls;');
        lines.push('}');
    }
    return lines.join('\n');
}

function generateLightingPdfBvh(layout: LightTableLayout, slot: LightTreeSlotBaked, selectionLive: boolean, batchArms: BatchLightArm[]): string {
    // Registry arms exist only for HITTABLE kinds present; delta kinds are never
    // queried, so the header check runs BEFORE the pmf walk (no wasted descent).
    // Batch arms replay the instance's trail and recompute the sphere pdf from its
    // placement record — the same row the sampler read.
    const stage0 = selectionLive ? ' * (1.0 - u_envSelectProb)' : '';
    const R = slot.registryCount;
    const lines: string[] = ['// Generated MIS pdf query (fable-light-bvh §3.3/§7) — the trail-replayed selection pmf'];
    lines.push('float lighting_pdf(LightQuery q, Direction wi, int light_id, Hit light_hit) {');
    if (R > 0) {
        lines.push(`    if (light_id < ${R}) {`);
        lines.push(`        int kind = ${lightKindHeaderExpr(slot)};`);
        layout.kinds.forEach((kind, code) => {
            const d = LIGHT_KINDS[kind];
            if (d.delta) return;   // delta: not hittable, never queried
            if (kind === 'mesh') {
                // The mesh pdf is IDENTITY-FREE (area measure over the row's world total)
                // — no rail bases needed; the emitting normal varies per hit, so the arm
                // passes the emitter hit's geometric normal (as in the CDF regime).
                lines.push(`        if (kind == ${code}) return light_tree_pmf(q, light_id)${stage0} * mesh_light_pdf(mesh_light_row(light_id), q.p, light_hit.p, light_hit.ng, wi);`);
                return;
            }
            lines.push(`        if (kind == ${code}) return light_tree_pmf(q, light_id)${stage0} * ${kind}_light_pdf(${kind}_light_row(light_id), q.p, light_hit.p, wi);`);
        });
        lines.push('        return 0.0;');
        lines.push('    }');
    }
    for (const a of batchArms) {
        lines.push(`    if (light_id < ${a.base + a.count}) {   // batch (region ${a.region}) instances`);
        const e = batchSphereExpr(a, `light_id - ${a.base}`);
        lines.push(`        ${e.fetch}`);
        lines.push(`        return light_tree_pmf(q, light_id)${stage0} * sphere_light_pdf(${e.ctor}, q.p, light_hit.p, wi);`);
        lines.push('    }');
    }
    lines.push('    return 0.0;');
    lines.push('}');
    return lines.join('\n');
}
