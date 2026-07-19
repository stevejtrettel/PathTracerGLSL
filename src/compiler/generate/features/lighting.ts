// compiler/generate/features/lighting.ts
// Direct lighting (NEE): per-kind sampler libraries + the generated selection dispatcher +
// the light_of region table (§6.2 registry). Only present when the plan enables NEE.
// Mirrors the material pattern: fixed per-kind GLSL (light_point/quad/sphere.glsl) + a
// generated `lighting_sample` that CDF-selects a light and calls its kind sampler (§6.1/§3.3).

import type { RenderPlan, PlannedLight } from '../../plan/types.js';
import { isValueParam } from '../../types.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import type { ShaderBlock } from '../ShaderIR.js';
import { formatFloat, formatSpectrum, formatVec3 } from '../../../components/glsl-format.js';
import { emitValue, mintValueUniform, type ParamValue } from '../values.js';
import { LIGHT_KINDS } from '../../../components/lights/index.js';
import type { LightKindDescriptor } from '../../../components/descriptors.js';
import { structFromRows } from '../schema.js';

import shadowOpaqueGLSL from '../../../components/transport/shadow/opaque/opaque.glsl?raw';
import shadowMediaGLSL from '../../../components/transport/shadow/media/media.glsl?raw';

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
    // CDF (rescaled). The env's power is load-time data the baked CDF can't absorb; the
    // uniform is the deliberate deviation from reference §8's compile-time ENV_SELECT_PDF
    // (same structure — see impl-plan-env-as-light D3). Arnold's dome-as-dedicated-technique
    // is the precedent for the two-stage shape.
    const envSamplable = plan.program.environmentSamplable;
    const env = plan.program.environment;
    // The uniform exists iff the selection draw is LIVE (finite lights split mass with
    // the env — the environmentSelectionLive decision). Env-only programs fold the
    // selection to the constant 1 on BOTH sides (sampler here, pdf in the combiner):
    // there is no other technique to absorb the remaining mass — changing 1.0 would be
    // bias, so no dead uniform is declared either.
    if (plan.program.environmentSelectionLive) {
        const envSelectDefault = (env.type === 'constant' || env.type === 'image') && env.selectWeight !== undefined
            ? env.selectWeight
            : 0.5;                                                       // plan O1 default
        // environment_sample/environment_pdf are declared by the T4 interface header even
        // though the environment feature's definitions assemble AFTER lighting.
        uniforms.push({ name: 'u_envSelectProb', type: 'float', parameterPath: 'env.selectProb', default: envSelectDefault });
        parameters['env.selectProb'] = {
            type: 'float', default: envSelectDefault, range: [0.05, 0.95],
            name: 'Env select P', group: 'Environment', triggersReset: true,
        };
    }
    // Shadow query behind the §6.3 contract — the compiler specializes: the boolean-fast-path
    // opaque form for media-free scenes, the spectral segment walker (composing the generated
    // medium_transmittance, seam 2) when media exist. The NEE call sites never change.
    if (plan.program.media.shadowWalker) {
        blocks.push({ origin: 'components/transport/shadow/media/media.glsl', source: shadowMediaGLSL });
        defines['MAX_SHADOW_SEGMENTS'] = '8';   // §6.3 pin; exhaustion is conservative (ZERO)
    } else {
        blocks.push({ origin: 'components/transport/shadow/opaque/opaque.glsl', source: shadowOpaqueGLSL });
    }

    // Per-kind sampler libraries for the kinds present (registry-driven, R1b; declared
    // before the dispatcher). Structs generated from the rows first (A1).
    const presentKinds = Object.keys(LIGHT_KINDS).filter((kind) => plan.lights.some((l) => l.kind === kind));
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

    // Hoisted light consts (struct-alignment batch, the N5 pattern): every light is
    // One accessor per light (`light_get_<id>()`), the single construction site shared by the
    // sampler dispatcher, the MIS pdf query, and the delta query — constants baked inside,
    // driven rows reading their uniforms (Model B).
    if (plan.lights.length > 0) {
        blocks.push({ origin: 'generated:light-accessors', source: generateLightAccessors(plan.lights) });
    }

    // Selection pdfs are computed ONCE and shared by the sampler and the MIS pdf query —
    // lighting_pdf must byte-match lighting_sample's selection (the env-sampling lesson,
    // pitfall 11, applied to the CDF).
    const selection = plan.program.estimator.lighting.selection;
    const selectPdf = computeSelectPdf(plan.lights, selection);

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
            for (const v of Object.values(l.values)) mintValueUniform(v as ParamValue, 'vec3', 'color', uniforms, parameters, seen);
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
                default: computeSelectPdf(plan.lights, selection),
                compute: (p) => computeSelectPdf(plan.lights, selection, p),
            });
            uniforms.push({
                name: 'u_light_cdf', type: 'float[]', arrayLength: n,
                parameterPath: paths[0], parameterPaths: paths,
                default: cumulative(computeSelectPdf(plan.lights, selection)),
                compute: (p) => cumulative(computeSelectPdf(plan.lights, selection, p)),
            });
        }
    }

    blocks.push({
        origin: 'generated:light-sampling',
        source: generateLightSampling(plan.lights, selectPdf, envSamplable, driven),
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
        blocks.push({ origin: 'generated:light-of', source: generateLightOf(samplable) });
        // The MIS pdf query (§6.1): only under 'mis' — its sole reader is the emitter-hit weight.
        if (plan.program.emitters.lightingPdf) {
            blocks.push({ origin: 'generated:lighting-pdf', source: generateLightingPdf(plan.lights, selectPdf, envSamplable, driven) });
        }
    }

    // T4 seams: the §6.1/§6.2/§6.3 direct-lighting contract surface.
    const provides = [
        { name: 'lighting_sample', signature: 'LightSample lighting_sample(Point p, vec2 xi)' },
        { name: 'shadow_transmittance', signature: 'Spectrum shadow_transmittance(Ray shadow_ray, Point light_p)' },
    ];
    if (plan.program.emitters.samplable) {
        provides.push({ name: 'light_of', signature: 'int light_of(int region)' });
    }
    if (plan.program.emitters.lightingPdf) {
        provides.push({ name: 'lighting_pdf', signature: 'float lighting_pdf(Point p, Direction wi, int light_id, Hit light_hit)' });
    }
    if (plan.program.estimator.mediumLightSampling === 'equiangular') {
        provides.push({ name: 'lighting_query_delta', signature: 'float lighting_query_delta(float uc, out Point pos, out Spectrum intensity)' });
    }
    const requires: string[] = [];
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

    return { ...emptyContribution('lighting'), blocks, defines, uniforms, parameters, provides, requires };
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
export function resolveLightValues(l: PlannedLight, params: Record<string, unknown> = {}): Record<string, number | number[]> {
    const out: Record<string, number | number[]> = {};
    for (const [k, v] of Object.entries(l.values)) {
        if (isValueParam(v)) {
            const raw = params[v.param] ?? v.default;
            out[k] = typeof raw === 'number' ? [raw, raw, raw] : raw as number[];
        } else {
            out[k] = v as number | number[];
        }
    }
    return out;
}

/** Emitted power for CDF selection — the kind descriptors carry the pbrt formulas
 *  (area-aware, pitfall 6). Reads RESOLVED values (driven rows substituted). Exported
 *  for the H6 invariant tests. */
export function lightPower(l: PlannedLight, params: Record<string, unknown> = {}): number {
    const d = LIGHT_KINDS[l.kind];
    return d !== undefined ? d.power(resolveLightValues(l, params)) : 1e-8;   // backstop; the Validator rejects unregistered kinds
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
    for (const l of lights) for (const v of Object.values(l.values)) if (isValueParam(v)) s.add(v.param);
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

/** GLSL call that samples light `l` at point `p` — kind sampler over the const/accessor. */
function sampleCall(l: PlannedLight, xiExpr: string): string {
    return `${lightKind(l).kind}_light_sample(${lightRef(l)}, p, ${xiExpr})`;
}

/** Compile-time selection pdfs — shared by lighting_sample and lighting_pdf.
 *  Exported for the H6 invariant tests. */
export function computeSelectPdf(lights: PlannedLight[], selection: 'uniform' | 'power', params: Record<string, unknown> = {}): number[] {
    if (lights.length === 0) return [];
    const weights = lights.map((l) => (selection === 'uniform' ? 1 : lightPower(l, params)));
    const total = weights.reduce((a, b) => a + b, 0);
    return weights.map((w) => w / total);
}

function generateLightSampling(lights: PlannedLight[], selectPdf: number[], envSamplable: boolean, driven: boolean): string {
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

function generateLightingPdf(lights: PlannedLight[], selectPdf: number[], envSamplable: boolean, driven: boolean): string {
    const lines: string[] = ['// Generated MIS pdf query (§6.1) — must mirror lighting_sample exactly'];
    // With a samplable env, every finite light's selection pdf carries the stage-0 factor —
    // exactly what the sampler applied. The env itself has no arm here (never hit; the miss
    // branch queries u_envSelectProb * environment_pdf directly, reference §8 line 3).
    const stage0 = envSamplable ? ' * (1.0 - u_envSelectProb)' : '';
    const sel = selectionExprs(selectPdf, driven && lights.length > 1);
    lines.push('float lighting_pdf(Point p, Direction wi, int light_id, Hit light_hit) {');
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
        // pure composition: selection pdf × the kind's solid-angle pdf.
        lines.push(`    if (light_id == ${l.id}) return ${select} * ${d.kind}_light_pdf(${lightRef(l)}, p, light_hit.p, wi);`);
    }
    lines.push('    return 0.0;');
    lines.push('}');
    return lines.join('\n');
}
