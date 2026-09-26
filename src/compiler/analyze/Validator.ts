// compiler/analyze/Validator.ts

import type { SceneFeatures } from './types.js';
import type { SceneDescription, RenderStrategy, Vec3, PrimitiveObject, MeshObject } from '../types.js';
import { isGlslExpression, isHeterogeneousMedium, isValueParam, isBlackbody, mediumRoutesToTracking, mediumMayScatter, mediumIsDeflecting, isEmissiveMedium, hasConstantNonzeroEmission, isMeshObject, isInstancedObject, isPrimitiveObject, RESERVED_PARAM_PATHS, RESERVED_PARAM_PREFIXES } from '../types.js';
import { paramToUniform } from '../../components/glsl-format.js';
import type { DiagnosticBag } from '../../errors/core/DiagnosticBag.js';
import { MATERIAL_MODELS, EMISSION_KEY } from '../../components/materials/index.js';
import { LIGHT_KINDS, LIGHT_SELECTIONS, DEFAULT_LIGHT_SELECTION, applyAuthoredDefaults } from '../../components/lights/index.js';
import { samplableEmitterObjects, batchLightEligible, batchNeedsInterior, keepsLocalFrame } from '../plan/dataTenants.js';
import { foldBlackbody } from '../../components/lights/blackbody.js';
import { AMBIENT_SPACES } from '../../components/ambient/index.js';
import { ACCUMULATORS } from '../../components/accumulator/index.js';
import { ENV_CHARTS } from '../../components/env/index.js';
import { PRIMITIVES, primitiveBounds, primitiveIsBounded, resolveBackend, resolvePrimitiveValues, type PrimitiveParamSpec } from '../../components/geometry/index.js';
import { BOUND_FIELDS, checkBoundContainment, checkConservativeness } from '../../components/geometry/boundCheck.js';
import { MARCHED_TABLE_THRESHOLD, MESH_TRAVERSALS, INSTANCE_ACCELS, OBJECT_DISPATCHES, DEFAULT_MESH_TRAVERSAL, DEFAULT_INSTANCE_ACCEL, DEFAULT_OBJECT_DISPATCH } from '../../components/intersection/index.js';
import { meshClosedness } from '../../components/intersection/mesh/topology.js';
import { isDrivenTransform } from '../../components/geometry/similarity.js';
import { placementCount } from '../../components/intersection/instancing/instancing.js';
import { nodeTexelBound } from '../../components/data/ledger.js';
import { DATA_TEX_WIDTH } from '../../components/data/pack.js';
import { CAMERA_MODELS } from '../../components/camera/index.js';
import { isTonemapSupported } from '../../components/tonemap/index.js';
import { isMediumModelSupported } from '../../components/volume_scattering/index.js';
import { validateSceneProperties, validatePropertyValue, constraintViolation } from './propertyValidation.js';
import { batchPlacementRecordOf } from '../plan/dataTenants.js';

/** HG anisotropy margin: |g| = 1 exactly is NaN in hg_sample/hg_eval. */
const MAX_PHASE_G = 0.99;
/** Models whose interaction_surface_emission dispatch reads mp.emission (the phantom-light
 *  rule) — DERIVED from the registry's capabilities.emissive, the same fact the emission
 *  gate compiles from (a hardcoded set here would go stale the day a new emissive-capable
 *  model landed, erroring on legitimate emitters). */
const EMITTING_MODELS = new Set<string>(
    Object.entries(MATERIAL_MODELS).filter(([, d]) => d?.capabilities.emissive).map(([id]) => id));

/**
 * Validate scene + strategy against current compiler capabilities.
 *
 * Populates the provided DiagnosticBag with errors/warnings using
 * proper error codes from the error system.
 */
export function validate(
    features: SceneFeatures,
    scene: SceneDescription,
    strategy: RenderStrategy,
    bag: DiagnosticBag,
): void {
    if (AMBIENT_SPACES[features.ambientSpace] === undefined) {   // D3: registry-gated (the door)
        bag.error('invalid-setting', `Ambient space '${features.ambientSpace}' not yet supported`)
            .add();
    }

    // Batch instance lights count as lights ONLY under the tree (fable-light-bvh §7):
    // under 'power' they are path-found, so an otherwise-unlit scene truly has no NEE
    // target and the error stands.
    const hasBatchLightsUnderTree = (strategy.estimator.lightSelection ?? DEFAULT_LIGHT_SELECTION) === 'bvh'
        && scene.objects.some((o) => isInstancedObject(o) && batchLightEligible(o, scene));
    if (strategy.estimator.directLighting !== 'none'
        && features.lighting.totalLightCount === 0
        && !features.environment.samplable
        && !hasBatchLightsUnderTree) {
        bag.error('incompatible-options',
            `Direct lighting '${strategy.estimator.directLighting}' requested but scene has no lights (a samplable environment counts — image env, or constant with sampleAsLight: true; instanced sphere emitters count under lightSelection 'bvh')`)
            .add();
    }

    // --- Lights (impl-plan-area-lights A0; degeneracy rules registry-driven — A3) ---
    for (let i = 0; i < scene.lights.length; i++) {
        const light = scene.lights[i];
        const d = LIGHT_KINDS[light.kind];
        // Unregistered kinds are REJECTED, never silently skipped (the Planner's skip is
        // the unreachable backstop) — a typo'd kind must not render the scene minus one
        // light with no diagnostic. ('directional' was reserved vocabulary with its own
        // message until impl-plan-directional-beam registered the real kind.)
        if (d === undefined) {
            bag.error('invalid-setting',
                `Light ${i}: unknown light kind '${light.kind}' (registered kinds: ${Object.keys(LIGHT_KINDS).join(', ')})`)
                .add();
            continue;
        }
        // Authored-input schema (C7 parity with geometry): unknown keys warn (typo class),
        // missing required / wrong shape error, then the row's declarative constraint
        // (D1: the shared RowConstraint vocabulary). Runs BEFORE the coupled rules so
        // validateAuthored may assume well-shaped input (a missing edge used to throw a
        // raw TypeError from inside the area formula). Row DEFAULTS are applied first
        // (the ONE framework application — the same record the Planner desugar sees),
        // so constraints and coupled rules judge the value that will actually be used.
        const authored = applyAuthoredDefaults(d, light as unknown as Record<string, unknown>);
        const known = new Set(['kind', 'emission', ...d.authoredParams.map((p) => p.name)]);
        for (const key of Object.keys(authored)) {
            if (!known.has(key)) {
                bag.warning('invalid-setting',
                    `Light ${i} (${light.kind}): unknown field '${key}' is ignored (valid: ${[...known].join(', ')})`)
                    .add();
            }
        }
        let shapesOk = true;
        for (const p of d.authoredParams) {
            const v = authored[p.name];
            if (v === undefined) {
                if (p.required) {
                    bag.error('invalid-setting', `Light ${i} (${light.kind}): required field '${p.name}' is missing`).add();
                    shapesOk = false;
                }
                continue;
            }
            const ok = p.shape === 'number'
                ? typeof v === 'number' && Number.isFinite(v)
                : Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number' && Number.isFinite(c));
            if (!ok) {
                bag.error('invalid-setting',
                    `Light ${i} (${light.kind}): field '${p.name}' must be a ${p.shape === 'number' ? 'finite number' : 'vec3 of finite numbers'}`)
                    .add();
                shapesOk = false;
                continue;
            }
            if (p.constraint !== undefined) {
                const violation = constraintViolation(v as number | number[], p.constraint);
                if (violation !== null) {
                    bag.error('invalid-setting', `Light ${i} (${light.kind}): '${p.name}' ${violation}`).add();
                }
            }
        }
        // emission (B2's universal radiometric word) — required, number|vec3, >= 0.
        // Negative radiance is non-physical: pt sees negative energy on every hit while the
        // power CDF floors at ~0 so NEE almost never samples it — the strategies diverge.
        // Driven-lights Stage A: emission may be a {param} — validate its DEFAULT (the
        // uniform's initial value AND the plan-time CDF bake; a driven light needs one). The
        // reserved-path/collision checks ride collectParamPaths automatically (ValueParam-shaped).
        const e = authored.emission;
        // Blackbody spelling (impl-plan-blackbody-uv): validate the DIALS — kelvin
        // (finite, > 0; constant or {param} default) and scale (finite, >= 0).
        if (isBlackbody(e)) {
            const { kelvin, scale } = e.blackbody;
            const kVal = isValueParam(kelvin) ? kelvin.default : kelvin;
            if (typeof kVal !== 'number' || !Number.isFinite(kVal) || kVal <= 0) {
                bag.error('invalid-setting', `Light ${i} (${light.kind}): blackbody kelvin must be a finite number > 0 (constant, or a {param} with a finite default)`).add();
            }
            const sVal = scale === undefined ? 1 : isValueParam(scale) ? (scale.default ?? 1) : scale;
            if (typeof sVal !== 'number' || !Number.isFinite(sVal) || sVal < 0) {
                bag.error('invalid-setting', `Light ${i} (${light.kind}): blackbody scale must be a finite number >= 0`).add();
            }
            continue;   // the generic shape/negativity checks below are for plain spectra
        }
        const eDriven = isValueParam(e);
        const eValue = eDriven ? (e as { default?: unknown }).default : e;
        const eChannels = typeof eValue === 'number' && Number.isFinite(eValue) ? [eValue]
            : Array.isArray(eValue) && eValue.length === 3 && eValue.every((c) => typeof c === 'number' && Number.isFinite(c)) ? eValue as number[]
            : null;
        if (e === undefined) {
            bag.error('invalid-setting', `Light ${i} (${light.kind}): required field 'emission' is missing (Le for area kinds, radiant intensity for delta — scalar broadcasts)`).add();
        } else if (eDriven && eValue === undefined) {
            bag.error('invalid-setting', `Light ${i} (${light.kind}): a driven emission {param: '${(e as { param?: string }).param}'} requires a 'default' (the uniform's initial value and the CDF bake)`).add();
        } else if (eChannels === null) {
            bag.error('invalid-setting', `Light ${i} (${light.kind}): emission must be a finite number or vec3${eDriven ? ' default' : ''}`).add();
        } else if (eChannels.some((c) => c < 0)) {
            bag.error('invalid-setting', `Light ${i}: emission must be >= 0 (negative radiance diverges pt vs pt-nee)`).add();
        }
        // Kind-specific degeneracy (near-zero quad area → Inf pdfs; non-positive sphere
        // radius): the kind DESCRIPTOR declares its rules; the Validator emits them —
        // only over well-shaped input.
        if (shapesOk && d.validateAuthored !== undefined) {
            for (const msg of d.validateAuthored(authored)) {
                bag.error('invalid-setting', `Light ${i}: ${msg}`).add();
            }
        }
    }

    // --- Per-object GEOMETRY validation, ONE truth (validateGeometryObject): backend
    // pins + descriptor degeneracy (B1 + audit C1), primitive parameter schemas (R3 /
    // review C7), and mesh buffer sanity (impl-plan-meshes). Instanced batches route
    // their PROTOTYPE through the SAME function in the instanced loop below — a
    // prototype IS an object description, so it gets full validation, never a shallow
    // parallel check (the audit's A3 finding).
    for (let i = 0; i < scene.objects.length; i++) {
        const obj = scene.objects[i];
        if (isInstancedObject(obj)) continue;   // prototype validated with its batch below
        validateGeometryObject(obj, `Object ${i}`, [`objects[${i}]`], bag);
    }

    // --- Finiteness (audit C6): a NaN/Inf anywhere in the scene reaches the GLSL number
    // formatter, which throws a raw unmapped Error. One central sweep; the formatter throw
    // stays as an unreachable backstop.
    validateFinite(scene.objects, 'objects', bag);
    validateFinite(scene.materials, 'materials', bag);
    validateFinite(scene.lights, 'lights', bag);
    validateFinite(scene.environment, 'environment', bag);

    // Expression-declared params (heterogeneous D4, general to any expression property):
    // each entry must be well-shaped, and its derived uniform must actually appear in
    // the expression source (C5 inert-knob class). The namespace/collision checks below
    // cover these paths automatically — GlslExpressionParam is ValueParam-shaped, so
    // collectParamPaths picks them up.
    validateExpressionParams(scene.materials, 'materials', bag);

    // --- Parameter namespace (naming batch N2 — audit P2/P3) ---
    // Reserved paths/prefixes are engine/app-minted channels (compiler/types.ts); an
    // authored param there silently fights the builtin. paramToUniform collisions
    // ('a.b_c' and 'a_b.c' → u_a_b_c) would silently SHARE one uniform.
    {
        const authored = new Set<string>();
        collectParamPaths(scene, authored);
        collectParamPaths(strategy.measurement, authored);
        const byUniform = new Map<string, string>();
        for (const path of authored) {
            if ((RESERVED_PARAM_PATHS as readonly string[]).includes(path)) {
                bag.error('invalid-setting',
                    `Parameter '${path}' is a reserved builtin channel (engine/app-minted — see RESERVED_PARAM_PATHS); choose another name`)
                    .add();
            }
            const prefix = RESERVED_PARAM_PREFIXES.find((p) => path.startsWith(p));
            if (prefix !== undefined) {
                bag.error('invalid-setting',
                    `Parameter '${path}' uses the reserved prefix '${prefix}' (engine/app-minted namespace); choose another name`)
                    .add();
            }
            // The path becomes a GLSL identifier (u_<path with dots → underscores>): anything but
            // dot-separated identifiers emits unparseable GLSL, and a double underscore is
            // reserved in GLSL ES (ANGLE rejects it — the Jul 17 reserved-`__` bug).
            if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(path) || paramToUniform(path).includes('__')) {
                bag.error('invalid-setting',
                    `Parameter '${path}' is not a valid name: use dot-separated identifiers (letters, digits, single underscores), e.g. 'key.tint'`)
                    .add();
            }
            const uniform = paramToUniform(path);
            const prior = byUniform.get(uniform);
            if (prior !== undefined && prior !== path) {
                bag.error('invalid-setting',
                    `Parameters '${prior}' and '${path}' both map to uniform '${uniform}' — dots and underscores collide in paramToUniform; rename one`)
                    .add();
            }
            byUniform.set(uniform, path);
        }
    }

    // Integer-like material names would silently reorder under JS key iteration
    // (integer-like string keys iterate FIRST) — with insertion-order material ids
    // (naming batch N1) that would scramble identity. Reject them.
    for (const name of Object.keys(scene.materials)) {
        if (/^(0|[1-9][0-9]*)$/.test(name)) {
            bag.error('invalid-setting',
                `Material name '${name}': integer-like names are reserved (JS iterates integer keys first, scrambling insertion-order material identity)`)
                .add();
        }
    }
    // Descriptor schemas choose scalar/spectrum shape today; their future domain metadata can
    // feed the same reusable validator without changing its behavior (propertyValidation.ts).
    validateSceneProperties(scene, bag);

    // sampleAsLight (§6.2 / V1-C2): explicit true demands an analytically samplable emitter —
    // an analytic quad/sphere object with CONSTANT nonzero emission. SDF emitters stay
    // path-only (they still glow; they converge slower — the honest open-question-#10 answer).
    for (const [name, mat] of Object.entries(scene.materials)) {
        if (mat.sampleAsLight !== true) continue;
        if (!samplableObjectUses(scene, name)) {
            bag.error('invalid-setting',
                `Material '${name}': sampleAsLight requires a samplable object using it — an analytic ${Object.entries(PRIMITIVES).filter(([, d]) => d.samplableAsLight === true).map(([t]) => t).join('/')} with constant placement (and, if rotated, a material that does not read uv), or a constant-placement MESH (fable-mesh-lights) — V1-C2: emissive SDF/custom shapes are path-only and still glow`)
                .add();
        }
        if (!hasConstantNonzeroEmission(mat.emission)) {   // C3: the ONE predicate
            bag.error('invalid-setting',
                `Material '${name}': sampleAsLight requires CONSTANT nonzero emission in v1 — {param}/procedural emitter power needs the light-registry accessor (deferred)`)
                .add();
        }
    }

    // --- Emission model discipline (audit: the phantom-light rule) ---
    // The registry admits emitters by shape + constant nonzero emission, but only models whose
    // surface-emission dispatch actually reads mp.emission may back a samplable light — a
    // dielectric/'none' "emitter" would receive NEE energy that BSDF paths can never see, and
    // pt vs pt-nee would converge to different images.
    for (const [name, mat] of Object.entries(scene.materials)) {
        if (name.startsWith('__light_')) {
            bag.error('invalid-setting',
                `Material '${name}': the '__light_' name prefix is reserved for desugared area-light materials — a user material with this prefix would be silently skipped by the light registry`)
                .add();
        }
        const e = mat.emission;
        const negativeEmission = typeof e === 'number' ? e < 0 : Array.isArray(e) ? e.some((c) => c < 0) : false;
        if (negativeEmission) {
            bag.error('invalid-setting', `Material '${name}': emission components must be >= 0`).add();
        }
        // Emission on a model whose emission dispatch returns zero — one rule, one diagnostic.
        // A CONSTANT nonzero emission (incl. a constant blackbody) that the light registry would
        // admit is a phantom light: an error. Otherwise the value is ignored: one warning, which
        // also covers {param} and formula emission (for model 'none', only a constant emission
        // is reported).
        const constantEmission = hasConstantNonzeroEmission(e);
        if (!EMITTING_MODELS.has(mat.model)
            && (constantEmission || (mat.model !== 'none' && emissionMayBeNonzero(e)))) {
            const wouldRegister = constantEmission && mat.sampleAsLight !== false && samplableObjectUses(scene, name);
            if (wouldRegister) {
                bag.error('invalid-setting',
                    `Material '${name}': model '${mat.model}' carries emission but its emission dispatch returns zero — as a samplable light this adds NEE energy BSDF paths never see (pt/pt-nee diverge). Use an emissive-capable model (${[...EMITTING_MODELS].join(', ')}) or set sampleAsLight: false`)
                    .add();
            } else {
                bag.warning('invalid-setting',
                    `Material '${name}': emission is set but model '${mat.model}' cannot emit (its emission is identically zero) — the value is ignored`)
                    .add();
            }
        }
    }

    // Model registration (the B1 treatment — model ids are strings, the registry + this
    // check gatekeep): unknown models are REJECTED with the registered set, never passed
    // through to emit calls on symbols no include defines. 'none' is structural
    // vocabulary (§3.6), not a registry key; 'emissive' keeps its migration message
    // (review C4: it used to fail at the GPU as an undeclared identifier).
    for (const [name, mat] of Object.entries(scene.materials)) {
        if (mat.model === 'none' || MATERIAL_MODELS[mat.model] !== undefined) continue;
        if (mat.model === 'emissive') {
            bag.error('invalid-setting',
                `Material '${name}': model 'emissive' is not a model — use emission on a surface model (e.g. lambert with albedo 0), or model 'none' with a medium block for a pure volume region`)
                .add();
        } else {
            bag.error('invalid-setting',
                `Material '${name}': unknown material model '${mat.model}' (registered models: ${Object.keys(MATERIAL_MODELS).join(', ')}; 'none' = no optical surface)`)
                .add();
        }
    }

    // --- Media (impl-plan-media M0; heterogeneous rules per fable-heterogeneous-media.md §2) ---
    for (const [name, mat] of Object.entries(scene.materials)) {
        if (mat.medium !== undefined) {
            for (const [prop, value] of Object.entries(mat.medium)) {
                if (!isGlslExpression(value)) continue;
                if (prop === 'sigma_a' || prop === 'sigma_s' || prop === 'emission') {
                    // Rule 1: an expression coefficient is legal ONLY under a declared
                    // ceiling — D1: the rendered medium IS the field min-scaled to σ̄
                    // (an expression ε needs per-position evaluation at σ̄-paced points,
                    // so it rides the same rule — impl-plan-medium-emission P5).
                    // DEFLECTING carve (impl-plan-grin-media): the GRIN walker paces by the
                    // ODE, not σ̄ — expression σ_a/ε there involve no ceiling and need no
                    // majorant (the D1 clamp never applies). Expression σ_s on a deflecting
                    // medium is rejected below regardless.
                    if (mat.medium.majorant === undefined && !mediumIsDeflecting(mat.medium)) {
                        bag.error('invalid-setting',
                            `Material '${name}': medium.${prop} is a GLSL expression but the medium declares no majorant — heterogeneous media require a density ceiling σ̄ (D1: the rendered medium IS min(σ, σ̄); fable-heterogeneous-media.md). Add majorant: <finite number > 0>`)
                            .add();
                    }
                } else if (prop === 'ior') {
                    // GRIN (fable-variable-ior): a spatial refractive index n(x) is the whole
                    // point of a deflecting medium — allowed, and needs NO majorant (n is not
                    // extinction; nothing clamps it). Deferred: n(λ) dispersion (no `λ` yet).
                } else {
                    // Rule 7: spatially-varying phase parameters are not in v1.
                    bag.error('invalid-setting',
                        `Material '${name}': medium.${prop} cannot be a GLSL expression — only σ_a/σ_s/emission (and ior) may vary spatially; phase parameters are constants or {param}`)
                        .add();
                }
            }
            // (The old "{param} coefficients need an authored majorant" error is DELETED —
            // batch 2 of impl-plan-env-power-selection: σ̄ for non-expression tracking
            // media is DERIVED from the live values (a compute-closure uniform), so the
            // requirement that rule enforced is now met structurally.)
            // Rule 2: majorant must be a positive finite number; a ceiling on a
            // non-expression medium is inert (σ̄ derives from the live values — C5 class).
            const maj = mat.medium.majorant;
            if (maj !== undefined) {
                if (typeof maj !== 'number' || !Number.isFinite(maj) || maj <= 0) {
                    bag.error('invalid-setting',
                        `Material '${name}': medium.majorant must be a finite number > 0 (got ${String(maj)})`)
                        .add();
                } else if (mediumIsDeflecting(mat.medium)) {
                    bag.warning('invalid-setting',
                        `Material '${name}': medium.majorant is declared on a DEFLECTING medium — the GRIN walker paces by the ODE, not σ̄, so the ceiling is ignored (impl-plan-grin-media)`)
                        .add();
                } else if (!isHeterogeneousMedium(mat.medium)) {
                    bag.warning('invalid-setting',
                        `Material '${name}': medium.majorant is declared but every coefficient is constant/{param} — σ̄ derives from the (live) values and the declaration is ignored`)
                        .add();
                }
            }
            if (mat.medium.model !== undefined && !isMediumModelSupported(mat.medium.model)) {
                bag.error('invalid-setting',
                    `Material '${name}': medium.model '${mat.medium.model}' is not a registered volume scattering model`)
                    .add();
            }
            // GRIN media matrix (impl-plan-grin-media — the Jul 22 batches lifted the v1
            // blanket rejections): a deflecting medium may EMIT (per-step collection with
            // the (n₀/n)² source factor) and SCATTER (channel-MIS in arc length), with two
            // declared cuts:
            // (a) emissive SCATTERING on bent arcs — the tracking-arm route the straight
            //     case uses does not exist for curves; reject the combination.
            if (mediumIsDeflecting(mat.medium) && mediumMayScatter(mat.medium) && isEmissiveMedium(mat.medium)) {
                bag.error('invalid-setting',
                    `Material '${name}': a deflecting medium cannot scatter AND emit in one region yet — remove sigma_s or emission (impl-plan-grin-media: emissive scattering along bent arcs is deferred)`)
                    .add();
            }
            // (b) HETEROGENEOUS scattering on bent arcs (the null-collision lottery along
            //     the curve) — the arc sampler's free-flight law needs constant σ_t; reject
            //     expression coefficients on a scattering deflecting medium.
            if (mediumIsDeflecting(mat.medium) && mediumMayScatter(mat.medium)
                && (isGlslExpression(mat.medium.sigma_s) || isGlslExpression(mat.medium.sigma_a))) {
                bag.error('invalid-setting',
                    `Material '${name}': a scattering deflecting medium needs CONSTANT (or {param}) coefficients — expression σ along a bent arc is the null-collision-on-curves sequel (impl-plan-grin-media)`)
                    .add();
            }
            // ONE ior truth (impl-plan-grin-interface): a deflecting medium's formula IS the
            // region's interface index — ior_of(region, p) emits it, and the wall's
            // Snell/Fresnel reads it at the hit point. A surface ior row authored ALONGSIDE
            // it would silently lose to the formula in the table — reject the ambiguity.
            if (mediumIsDeflecting(mat.medium) && (mat as unknown as Record<string, unknown>).ior !== undefined) {
                bag.error('invalid-setting',
                    `Material '${name}': ior is authored on both the material and its medium — the medium's ior (the n(x) field) is the ONE interface index, evaluated at the wall point; remove the material-level ior (impl-plan-grin-interface)`)
                    .add();
            }
            // |g| = 1 exactly is deterministic NaN in the HG sampler (d = 0 at the sampled pole)
            // → NaN prev_bsdf_pdf → NaN frame under MIS. Require a real margin.
            const g = mat.medium.phase_g;
            const gParam = g !== undefined && !isGlslExpression(g) && isValueParam(g) ? g : undefined;
            const gConst = typeof g === 'number' ? g
                : gParam !== undefined && typeof gParam.default === 'number' ? gParam.default : undefined;
            if (gConst !== undefined && Math.abs(gConst) > MAX_PHASE_G) {
                bag.error('invalid-setting',
                    `Material '${name}': medium.phase_g = ${gConst} — |g| must be <= ${MAX_PHASE_G} (|g| = 1 NaN-poisons the frame)`)
                    .add();
            }
            if (gParam !== undefined && ((gParam.min !== undefined && gParam.min < -MAX_PHASE_G) || (gParam.max !== undefined && gParam.max > MAX_PHASE_G))) {
                bag.warning('invalid-setting',
                    `Material '${name}': medium.phase_g parameter range exceeds ±${MAX_PHASE_G} — runtime values near |g| = 1 produce NaN`)
                    .add();
            }
        }
        if (mat.model === 'none' && mat.medium === undefined) {
            bag.error('invalid-setting',
                `Material '${name}': model 'none' (no optical surface, §3.6) requires a medium block — an object that neither reflects nor participates is invisible, which is an authoring error`)
                .add();
        }
    }

    // Env selection override (impl-plan-env-power-selection): a probability — an authored
    // value outside (0,1) ships an invalid selection draw (silent estimator wrongness, the
    // audit-H3 class). Inert-knob warning when nothing splits selection mass (C5 class).
    const envW = strategy.estimator.envSelectWeight;
    if (envW !== undefined) {
        if (typeof envW !== 'number' || !Number.isFinite(envW) || envW <= 0 || envW >= 1) {
            bag.error('invalid-setting',
                `estimator.envSelectWeight must be strictly inside (0, 1) — it is P(sample env) in the two-stage NEE selection (got ${String(envW)})`)
                .add();
        } else if (strategy.estimator.directLighting === 'none'
            || !features.environment.samplable
            || features.lighting.totalLightCount === 0) {
            bag.warning('invalid-setting',
                'estimator.envSelectWeight controls nothing here (needs NEE, a samplable environment, AND finite lights to split selection mass with) — the knob is inert; absent it would derive from the power partition anyway')
                .add();
        }
    }

    // The bounce and null-crossing budgets are spliced into the generated walk as integer
    // literals and counted with `<=` loops (`bounce <= N`; the shadow walker's
    // `crossed <= left`), so a budget must be a non-negative integer that leaves room for one
    // more increment in a 32-bit int: at most 2^31 − 2. Anything else emits GLSL that fails to
    // compile or never terminates.
    const maxLoopBudget = 2 ** 31 - 2;
    const isLoopBudget = (v: unknown): boolean =>
        typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= maxLoopBudget;
    const maxBounces = strategy.measurement.maxBounces;
    if (!isLoopBudget(maxBounces)) {
        bag.error('invalid-setting',
            `measurement.maxBounces must be an integer from 0 to ${maxLoopBudget} — the number of scattering events a path may have (got ${String(maxBounces)})`)
            .add();
    }
    const maxNullCrossings = strategy.measurement.maxNullCrossings;
    if (maxNullCrossings !== undefined && !isLoopBudget(maxNullCrossings)) {
        bag.error('invalid-setting',
            `measurement.maxNullCrossings must be an integer from 0 to ${maxLoopBudget} — the number of null interfaces a path may cross, its shadow rays included (got ${String(maxNullCrossings)})`)
            .add();
    }

    // Russian roulette's survival CEILING — a probability, same class of rule as
    // envSelectWeight. 1.0 is legal and means "never cap": survival is then the
    // throughput alone, which for a LOSSLESS path (clear glass) is 1 forever, so the
    // path only ends at measurement.maxBounces — i.e. termination becomes a truncation
    // again, which is precisely what this knob exists to avoid. 0 would kill every path
    // at startDepth. Neither is a compile error's business to guess at, so: reject the
    // impossible, warn on the one that silently hands termination back to the bias term.
    const rr = strategy.estimator.russianRoulette;
    if (rr !== null && rr !== undefined && rr.maxSurvival !== undefined) {
        const ms = rr.maxSurvival;
        if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0 || ms > 1) {
            bag.error('invalid-setting',
                `estimator.russianRoulette.maxSurvival must be in (0, 1] — it is the ceiling on the per-bounce survival probability (got ${String(ms)})`)
                .add();
        } else if (ms === 1) {
            bag.warning('invalid-setting',
                'estimator.russianRoulette.maxSurvival = 1 disables the cap: a lossless path (clear glass transmits at weight exactly 1) never dims, so RR can never end it and maxBounces truncation does — the bias this knob exists to replace')
                .add();
        }
    }

    // envSampler chart (C6: the open door — the last registry-shadow union): the
    // registry gatekeeps, exactly like every other family.
    const chart = strategy.estimator.envSampler;
    if (chart !== undefined && ENV_CHARTS[chart] === undefined) {
        bag.error('invalid-setting',
            `envSampler '${chart}' is not a registered environment chart (registered: ${Object.keys(ENV_CHARTS).join(', ')})`)
            .add();
    }

    // T5: a compensated env table deliberately has pdf = 0 where L > 0 — unbiased ONLY when
    // BSDF sampling covers those directions with MIS weighting. NEE-only would lose energy.
    if (strategy.estimator.envCompensation === true && strategy.estimator.directLighting !== 'mis') {
        bag.error('incompatible-options',
            `envCompensation requires directLighting 'mis' — a compensated importance table has deliberate pdf-0 regions that only MIS covers unbiasedly (got '${strategy.estimator.directLighting}')`)
            .add();
    }

    // The tracking-routing condition, computed ONCE (C6: the equiangular and
    // volumeSampling rules held byte-identical private copies) — impl-plan-medium-
    // emission P5: a constant-ε SCATTERING medium routes to the tracking arms too,
    // under the computed measurement only.
    const trackScattering = strategy.measurement.scattering ?? 'full';
    const sceneNeedsTracking = Object.values(scene.materials).some((m) =>
        m.medium !== undefined && mediumRoutesToTracking(
            m.medium, trackScattering === 'full' && mediumMayScatter(m.medium)));

    // Equiangular medium NEE — v1 scope pins (impl-plan-equiangular §3).
    if (strategy.estimator.mediumLightSampling === 'equiangular') {
        // Pin 2: placement-MIS is undesigned — the emitter-hit power heuristic assumes T2
        // samples directions from the previous vertex; equiangular samples (t, light).
        if (strategy.estimator.directLighting === 'mis') {
            bag.error('incompatible-options',
                `mediumLightSampling 'equiangular' with directLighting 'mis' is reserved — placement-MIS is undesigned (impl-plan-equiangular §3.2); use 'nee'`)
                .add();
        }
        // Pin 1: equiangular needs the light's position BEFORE choosing t — our area
        // samplers are solid-angle-from-p. Delta lights only until the p-independent
        // area arms land (reject-not-degrade). Registry-derived (the lights-door rule);
        // the explicit `!== undefined` guard matters — `!LIGHT_KINDS[k]?.delta` would
        // count UNREGISTERED kinds as area lights (they already get their own rejection).
        // Emissive OBJECTS come from the one census: they are samplable lights whether or
        // not the material says sampleAsLight: true (omitting it is the default), which
        // the earlier material-flag test missed — the generator then crashed on them.
        const hasAreaLight = scene.lights.some((l) => {
            const kind = LIGHT_KINDS[l.kind];
            return kind !== undefined && !kind.delta;
        }) || samplableEmitterObjects(scene).length > 0;
        if (hasAreaLight) {
            bag.error('incompatible-options',
                `mediumLightSampling 'equiangular' supports DELTA lights only in v1 — this scene has samplable area emitters (an area light, or an emissive object sampled as a light; set sampleAsLight: false on its material to keep it path-traced only)`)
                .add();
        }
        // Pin 1, environment half: the equiangular vertex samples delta lights only, but the
        // NEE combiner gives the sky weight 0 after every scattering event ("NEE already
        // counted it") — so a SAMPLED environment's single-scattered light would be counted
        // by nothing and silently vanish from the medium.
        if (features.environment.samplable) {
            bag.error('incompatible-options',
                `mediumLightSampling 'equiangular' samples delta lights only, so a samplable environment's light scattered in the medium would be lost — set the environment's sampleAsLight: false (it is then path-traced), or use 'vertex'`)
                .add();
        }
        // Isotropy pin (the spot lesson): the generated delta query returns an
        // intensity the equiangular estimate consumes DIRECTLY, so anisotropic delta
        // kinds (no deltaQuery fact) are rejected — an on-axis intensity would bias
        // the estimator, not just mis-sample it (deferred: direction-dependent query).
        const anisotropicDelta = scene.lights.find((l) => {
            const d = LIGHT_KINDS[l.kind];
            return d !== undefined && d.delta && d.deltaQuery === undefined;
        });
        if (anisotropicDelta !== undefined) {
            bag.error('incompatible-options',
                `mediumLightSampling 'equiangular' requires ISOTROPIC delta lights — kind '${anisotropicDelta.kind}' declares no delta query (its intensity is direction-dependent; the queried on-axis value would bias the estimate). Use 'vertex', or remove the '${anisotropicDelta.kind}' light`)
                .add();
        }
        // Deflecting media (impl-plan-grin-media): equiangular places its sample on the
        // STRAIGHT segment, but a scattering deflecting region's segments are BENT — the
        // placed point is not on the path. Reject the combination (the vertex estimator
        // handles bent events correctly via the arm-reported event ray).
        const deflectingScatterer = Object.entries(scene.materials).find(([, m]) =>
            m.medium !== undefined && mediumIsDeflecting(m.medium) && mediumMayScatter(m.medium));
        if (deflectingScatterer !== undefined) {
            bag.error('incompatible-options',
                `mediumLightSampling 'equiangular' cannot place samples inside a DEFLECTING medium (material '${deflectingScatterer[0]}' scatters along bent arcs — the straight-segment placement is off the path). Use 'vertex'`)
                .add();
        }
        // The C5 silent-inert rule: the knob must control something.
        if (strategy.estimator.directLighting === 'none' || !features.media.hasScatteringMedia) {
            bag.warning('invalid-setting',
                `mediumLightSampling 'equiangular' controls nothing here (needs directLighting 'nee' AND scattering media) — the knob is inert`)
                .add();
        }
        // Heterogeneous rule 8 (deferred-ledger pin enforced now): the equiangular
        // estimate's T(0,t) factor is the analytic closed form — a tracking-routed
        // medium would need ratio-tracked transmittance along the sampled segment.
        // (Checked against the ROUTING condition — sceneNeedsTracking below is hoisted
        // and shared with the volumeSampling rules: C6 killed the byte-identical twin.)
        if (sceneNeedsTracking) {
            bag.error('incompatible-options',
                `mediumLightSampling 'equiangular' does not support media on the null-collision arms — its transmittance factor is the analytic closed form (deferred: ratio-tracked T along the sampled segment); use 'vertex'`)
                .add();
        }
    }

    // volumeSampling axis (fable-heterogeneous-media.md §2 rules 3/4/6; the routing
    // condition extends per impl-plan-medium-emission P5: a constant-ε SCATTERING
    // medium routes to the tracking arms too — under the computed measurement only).
    const vs = strategy.estimator.volumeSampling;
    if (vs === 'raymarch' || vs === 'ratio-tracking') {
        // Rule 6, reject-not-remove: ray marching is biased (if ever added it is a
        // declared MEASUREMENT truncation, not an estimator); 'ratio-tracking' names a
        // distance-sampling variant we are not building.
        bag.error('invalid-setting',
            `volumeSampling '${vs}' not supported — use 'analytic' (constant/{param} media, exact) or 'delta-tracking' (heterogeneous media, null-collision)`)
            .add();
    }
    if (vs === 'delta-tracking') {
        // Rule 3: delta tracking's scatter-distance pdf is unknowable (it marginalizes
        // over phantom-collision chains), so MIS weights need the rescaled-probability
        // tallies — the deferred tally batch.
        if (strategy.estimator.directLighting === 'mis') {
            bag.error('incompatible-options',
                `volumeSampling 'delta-tracking' with directLighting 'mis' is reserved — delta tracking's distance pdf is unknowable, so MIS needs the probability-tally machinery (deferred batch); use 'nee' or 'none'`)
                .add();
        }
        // Rule 4a (C5 silent-inert): the knob must control something.
        if (!sceneNeedsTracking) {
            bag.warning('invalid-setting',
                `volumeSampling 'delta-tracking' controls nothing here — no medium has expression coefficients (or emission with scattering); constant media stay on the analytic arms`)
                .add();
        }
    } else if (sceneNeedsTracking) {
        // Rule 4b (reject-not-degrade): the analytic arms cannot evaluate σ(x), and the
        // analytic scattering arm has no emission source term.
        bag.error('incompatible-options',
            `This scene has media that need the null-collision arms (expression coefficients, or an emissive scattering medium) but volumeSampling is '${vs ?? 'analytic'}' — set estimator.volumeSampling: 'delta-tracking'`)
            .add();
    }
    // lightSelection axis (fable-light-bvh §2/§6): membership is REGISTRY-derived
    // (LIGHT_SELECTIONS — components/lights), and the 'bvh' occupant carries its v1
    // pins: constant emission only (the tree's Φ payload and the table rows are baked;
    // refit is a future batch), no equiangular (the medium-vertex pick entry lands with
    // the mis/tally batch), and every roster kind must declare treeBounds
    // (directional/beam are tree-ineligible — unbounded position; mesh is eligible
    // since the treeBounds 'data' form — reject-not-degrade).
    const lightSelection = strategy.estimator.lightSelection;
    if (lightSelection !== undefined && LIGHT_SELECTIONS[lightSelection] === undefined) {
        bag.error('invalid-setting',
            `estimator.lightSelection '${lightSelection}' is not a light-selection occupant — registered: ${Object.keys(LIGHT_SELECTIONS).join(', ')} (default '${DEFAULT_LIGHT_SELECTION}')`)
            .add();
    } else if (lightSelection === 'bvh') {
        // The roster's KINDS only — authored registered lights, then emissive objects (the
        // census). No values are computed, so a malformed light that failed its own checks
        // above cannot throw here.
        const roster = [
            ...scene.lights.filter((l) => LIGHT_KINDS[l.kind] !== undefined).map((l) => ({ kind: l.kind })),
            ...samplableEmitterObjects(scene),
        ];
        if (roster.length === 0 && !scene.objects.some((o) => isInstancedObject(o) && batchLightEligible(o, scene))) {
            // The C5 silent-inert rule (selection needs finite lights to select among).
            // Light-eligible batches count: a batch-lights-only scene (lights: [], one
            // emissive cloud — clebsch-glow) has an empty roster and a non-inert tree.
            bag.warning('invalid-setting',
                "estimator.lightSelection 'bvh' controls nothing here (no finite lights in the registry — an env-only or unlit scene never selects) — the knob is inert")
                .add();
        }
        for (const entry of roster) {
            if (LIGHT_KINDS[entry.kind]?.treeBounds === undefined) {
                bag.error('incompatible-options',
                    `estimator.lightSelection 'bvh' (v1) cannot serve light kind '${entry.kind}' — it declares no treeBounds fact (unbounded position or rail-resident geometry); registered tree-eligible kinds: ${Object.keys(LIGHT_KINDS).filter((k) => LIGHT_KINDS[k].treeBounds !== undefined).join(', ')}. Use 'power' for this scene.`)
                    .add();
            }
        }
        const drivenLight = scene.lights.find((l) => {
            const e = (l as { emission?: unknown }).emission;
            return isValueParam(e) || (isBlackbody(e) && (isValueParam(e.blackbody.kelvin) || isValueParam(e.blackbody.scale)));
        });
        if (drivenLight !== undefined) {
            bag.error('incompatible-options',
                `estimator.lightSelection 'bvh' (v1) requires CONSTANT light emission — a driven emission would need the tree's Φ payload and table rows refit on change (deferred). Use 'power', or make the '${drivenLight.kind}' light's emission constant.`)
                .add();
        }
        if (strategy.estimator.mediumLightSampling === 'equiangular') {
            bag.error('incompatible-options',
                "estimator.lightSelection 'bvh' with mediumLightSampling 'equiangular' is reserved — the delta-light query keeps the CDF path until the medium-vertex tree entry lands (fable-light-bvh §6). Use 'vertex'.")
                .add();
        }
    }

    // meshTraversal / instanceAccel axes (impl-plan-mesh-bvh / impl-plan-tlas):
    // estimator fields per the pinned taxonomy — pure computation, bias-free by
    // contract (their test obligation is the estimator-swap equality witness).
    // Membership is REGISTRY-derived (components/intersection — a new traversal engine
    // extends the valid set with no edit here); the enum rejection guards JSON-sourced
    // strategies, and the C5 silent-inert rule mirrors equiangular/delta-tracking above.
    const meshTraversal = strategy.estimator.meshTraversal;
    if (meshTraversal !== undefined && MESH_TRAVERSALS[meshTraversal] === undefined) {
        bag.error('invalid-setting',
            `estimator.meshTraversal '${meshTraversal}' is not a mesh traversal engine — registered: ${Object.keys(MESH_TRAVERSALS).join(', ')} (default '${DEFAULT_MESH_TRAVERSAL}')`)
            .add();
    } else if (meshTraversal !== undefined && !scene.objects.some(isMeshObject)) {
        bag.warning('invalid-setting',
            `estimator.meshTraversal controls nothing here (no mesh objects; instanced mesh prototypes always traverse their BLAS) — the knob is inert`)
            .add();
    }
    const objectDispatch = strategy.estimator.objectDispatch;
    if (objectDispatch !== undefined && OBJECT_DISPATCHES[objectDispatch] === undefined) {
        bag.error('invalid-setting',
            `estimator.objectDispatch '${objectDispatch}' is not a dispatch regime — registered: ${Object.keys(OBJECT_DISPATCHES).join(', ')} (default '${DEFAULT_OBJECT_DISPATCH}')`)
            .add();
    }
    // An explicit 'unrolled' on a scene full of MARCHED objects is a compile bomb, not
    // a slow render (impl-plan-sdf-as-shape T6): every marched object's arm carries its
    // own march loop, which the driver inlines and specialises. Measured on an M1 Pro:
    // 8 objects 0.9s to ready, 32 objects 7.9s, 128 objects NEVER FINISHED — the tab
    // just stops. The default already picks 'table' past the threshold; this is for the
    // scene that asks anyway, so the failure arrives as a sentence instead of a hang.
    if (objectDispatch === 'unrolled') {
        const marched = scene.objects.filter((o) => isPrimitiveObject(o)
            && resolveBackend(o.type, o.backend) === 'sdf').length;
        if (marched >= MARCHED_TABLE_THRESHOLD) {
            bag.warning('invalid-setting',
                `estimator.objectDispatch 'unrolled' with ${marched} marched objects: the shader emits one march loop PER OBJECT and compile time grows superlinearly (128 objects did not finish compiling on an M1 Pro). 'table' compiles in constant time — drop the pin unless this arm is a deliberate reference.`)
                .add();
        }
    }
    const instanceAccel = strategy.estimator.instanceAccel;
    if (instanceAccel !== undefined && INSTANCE_ACCELS[instanceAccel] === undefined) {
        bag.error('invalid-setting',
            `estimator.instanceAccel '${instanceAccel}' is not an instance traversal — registered: ${Object.keys(INSTANCE_ACCELS).join(', ')} (default '${DEFAULT_INSTANCE_ACCEL}')`)
            .add();
    } else if (instanceAccel !== undefined && !scene.objects.some(isInstancedObject)) {
        bag.warning('invalid-setting',
            `estimator.instanceAccel controls nothing here (no instanced objects) — the knob is inert`)
            .add();
    } else if (instanceAccel === 'cwbvh') {
        // The CWBVH experiment's v1 pins (fable-accel-cwbvh §6): params-tier analytic
        // batches without attributes only — mesh prototypes, frame-tier batches, and
        // attribute-carrying batches keep the binary TLAS's leaf-order semantics
        // (Hit.element) that the cwbvh leaf permutation does not preserve.
        for (const o of scene.objects) {
            if (!isInstancedObject(o)) continue;
            // ONE eligibility truth: the dataTenants adapter's tier decision + the
            // attrs exclusion — exactly the predicate that allocates the regions.
            const why = batchPlacementRecordOf(o, scene) !== 'params' ? 'a frame-tier placement record (mesh prototype / pin / uv-reading material / non-params shape)'
                : o.attributes !== undefined && Object.keys(o.attributes).length > 0 ? 'per-instance attributes'
                : null;
            if (why !== null) {
                bag.error('invalid-setting',
                    `estimator.instanceAccel 'cwbvh' (v1) cannot serve batch '${o.name ?? '<unnamed>'}' — it has ${why}; the cwbvh leaf order excludes these (fable-accel-cwbvh §6). Use 'tlas' for this scene.`)
                    .add();
            }
            // Instance lights under the tree bake light identity in BINARY-TLAS record
            // order (fable-light-bvh §7: Hit.element IS the light index — light_of is
            // `base + element`, and the tree/trails/pdf arms all read the binary-order
            // records). The cwbvh walk reports Hit.element in ITS OWN leaf order, so the
            // identity channel is wrong for every hit. Reject the combination outright
            // (strategy-independent of directLighting — the I12 precedent: an invariant
            // that only some estimator settings consume is still an invariant).
            if (lightSelection === 'bvh' && batchLightEligible(o, scene)) {
                bag.error('incompatible-options',
                    `estimator.instanceAccel 'cwbvh' with lightSelection 'bvh' cannot serve batch '${o.name ?? '<unnamed>'}' — its instances are tree lights, and light identity (Hit.element -> light_of) is baked in binary-TLAS record order, which the cwbvh leaf permutation does not preserve. Use 'tlas', or set sampleAsLight: false on the batch material.`)
                    .add();
            }
            // Containment (impl-plan-instanced-containment): the point descent walks the
            // BINARY TLAS's nodes and indexes placements by its leaf order. The same
            // permutation argument as the two rules above, one query shape over.
            if (batchNeedsInterior(o, scene)) {
                bag.error('incompatible-options',
                    `estimator.instanceAccel 'cwbvh' cannot serve batch '${o.name ?? '<unnamed>'}' — its prototype material needs an INTERIOR (transmissive or medium-carrying), and containment descends the binary TLAS in its record order, which the cwbvh leaf permutation does not preserve. Use 'tlas' for this scene.`)
                    .add();
            }
        }
    }

    const cameraType = strategy.measurement.camera.type;
    const cameraModelDesc = CAMERA_MODELS[cameraType];
    if (cameraModelDesc === undefined) {
        bag.error('invalid-setting',
            `Camera type '${cameraType}' not yet supported — no occupant in the camera registry (reserved-not-removed)`)
            .suggest(`Registered cameras: ${Object.keys(CAMERA_MODELS).join(', ')}`)
            .add();
    } else {
        // The model's authored-field schema (D2): the validation the old typed union used
        // to do at compile time, now registry-declared — unknown-key / required / shape /
        // enum / constraint, the lights loop's grammar.
        const authored = strategy.measurement.camera as unknown as Record<string, unknown>;
        const rows = cameraModelDesc.authoredParams ?? [];
        const known = new Set(['type', 'position', 'target', ...rows.map((r) => r.name)]);
        for (const key of Object.keys(authored)) {
            if (!known.has(key)) {
                bag.warning('invalid-setting',
                    `measurement.camera (${cameraType}): unknown field '${key}' is ignored (valid: ${[...known].join(', ')})`)
                    .add();
            }
        }
        // Whether every row is present when required and of the right shape — the camera's own
        // coupled rules (validateAuthored) may assume it.
        let wellShaped = true;
        for (const p of rows) {
            const v = authored[p.name];
            if (v === undefined) {
                if (p.required) {
                    bag.error('invalid-setting', `measurement.camera (${cameraType}): required field '${p.name}' is missing`).add();
                    wellShaped = false;
                }
                continue;
            }
            // 'value-number' unwraps a {param} spelling to its default for the checks below.
            const numeric = p.shape === 'value-number' && isValueParam(v) ? (v as { default?: unknown }).default : v;
            const shapeOk =
                p.shape === 'enum' ? typeof v === 'string' && (p.values ?? []).includes(v)
                : p.shape === 'vec3' ? isVec3(v)
                : typeof numeric === 'number' && Number.isFinite(numeric);
            if (!shapeOk) {
                const want = p.shape === 'enum' ? `one of ${(p.values ?? []).join(' | ')}`
                    : p.shape === 'vec3' ? 'a vec3 of finite numbers'
                    : p.shape === 'value-number' ? 'a finite number (or a {param} with a finite default)'
                    : 'a finite number';
                bag.error('invalid-setting', `measurement.camera (${cameraType}): field '${p.name}' must be ${want}`).add();
                wellShaped = false;
                continue;
            }
            if (p.constraint !== undefined && p.shape !== 'enum') {
                const violation = constraintViolation(numeric as number | number[], p.constraint);
                if (violation !== null) bag.error('invalid-setting', `measurement.camera (${cameraType}): '${p.name}' ${violation}`).add();
            }
        }
        if (wellShaped && cameraModelDesc.validateAuthored !== undefined) {
            for (const message of cameraModelDesc.validateAuthored(authored)) {
                bag.error('invalid-setting', `measurement.camera (${cameraType}): ${message}`).add();
            }
        }
    }
    // Camera pose (CameraPose): authored defaults of the always-live
    // camera.position/camera.target parameters. The strategy is outside the scene
    // finiteness sweep, so check shape here; a coincident pose has no view direction.
    {
        const cam = strategy.measurement.camera;
        for (const field of ['position', 'target'] as const) {
            if (cam[field] !== undefined && !isVec3(cam[field])) {
                bag.error('invalid-setting',
                    `measurement.camera.${field} must be a vec3 of finite numbers`)
                    .add();
            }
        }
        if (isVec3(cam.position) && isVec3(cam.target)
            && Math.hypot(cam.position[0] - cam.target[0], cam.position[1] - cam.target[1], cam.position[2] - cam.target[2]) < 1e-8) {
            bag.error('invalid-setting',
                `measurement.camera position and target coincide — the look-at frame is degenerate (no view direction)`)
                .add();
        }
    }
    if (strategy.measurement.color === 'spectral') {
        bag.error('invalid-setting',
            `color 'spectral' not yet supported — hero-wavelength transport is contracts §8; 'rgb' is the sole implemented color model (reserved-not-removed)`)
            .add();
    }

    // Enumerated measurement fields: an unknown value used to pass through the Planner and
    // silently mean something else ('none' for scattering turned the scattering arms OFF,
    // i.e. changed the integral, instead of failing).
    const measurementEnums: Array<[string, unknown, readonly string[]]> = [
        ['scattering', strategy.measurement.scattering, ['full', 'ignored']],
        ['shadows', strategy.measurement.shadows, ['opaque-dielectrics']],
        ['color', strategy.measurement.color, ['rgb', 'spectral']],
        ['response', strategy.measurement.response, ['radiance']],
    ];
    for (const [field, value, legal] of measurementEnums) {
        if (value !== undefined && !legal.includes(value as string)) {
            bag.error('invalid-setting', `measurement.${field} must be one of ${legal.map((v) => `'${v}'`).join(' | ')} (got ${JSON.stringify(value)})`).add();
        }
    }

    // Russian roulette's start depth is spliced into the walk as an integer comparison.
    if (rr !== null && rr !== undefined && rr.startDepth !== undefined
        && (typeof rr.startDepth !== 'number' || !Number.isInteger(rr.startDepth) || rr.startDepth < 0)) {
        bag.error('invalid-setting',
            `estimator.russianRoulette.startDepth must be a non-negative integer (got ${String(rr.startDepth)})`)
            .add();
    }

    // Exposure becomes a #define literal in the display shader.
    const exposure = strategy.view?.tonemap?.exposure;
    if (exposure !== undefined && (typeof exposure !== 'number' || !Number.isFinite(exposure) || exposure <= 0)) {
        bag.error('invalid-setting', `view.tonemap.exposure must be a finite number > 0 (got ${String(exposure)})`).add();
    }

    // Procedural environment: the bake program has no uniforms (v1 pin — a live uniform would
    // desync the direct-evaluated radiance from the frozen CDF), so a {param} in its formula
    // would reach GLSL undeclared; the table size becomes integer literals.
    const env = scene.environment;
    // A constant sky's radiance: the same spectrum rules as material and light values (the one
    // shared checker), since it is emitted radiance and feeds the env-selection power.
    if (env?.type === 'constant') {
        validatePropertyValue(env.color, { shape: 'spectrum', constraint: { kind: 'nonnegative' } }, 'environment.color', bag);
        const I = env.intensity;
        if (I !== undefined && (typeof I !== 'number' || !Number.isFinite(I) || I < 0)) {
            bag.error('invalid-setting', `environment.intensity must be a finite number >= 0 (got ${String(I)})`).add();
        }
    }
    if (env?.type === 'procedural') {
        const params = (env.glsl as { params?: unknown }).params;
        if (params !== undefined && (typeof params !== 'object' || params === null || Object.keys(params).length > 0)) {
            bag.error('invalid-setting',
                'environment (procedural): the formula cannot declare params — the sky is baked once into its sampling table, so a live slider would change the radiance without changing the table. Bake-on-change is deferred')
                .add();
        }
        const ts = env.tableSize;
        if (ts !== undefined && (!Array.isArray(ts) || ts.length !== 2 || !ts.every((n) => Number.isInteger(n) && n > 0))) {
            bag.error('invalid-setting', `environment.tableSize must be two positive integers [width, height] (got ${JSON.stringify(ts)})`).add();
        }
    }

    if (scene.ambientMedium !== undefined) {
        const ambient = scene.materials[scene.ambientMedium];
        if (ambient === undefined) {
            bag.error('missing-material',
                `ambientMedium references unknown material '${scene.ambientMedium}'`)
                .suggest(`Available materials: ${Object.keys(scene.materials).join(', ')}`)
                .add();
        } else {
            if (ambient.medium === undefined) {
                bag.error('invalid-setting',
                    `ambientMedium '${scene.ambientMedium}' has no medium block — the ambient region's material only contributes its medium (§2.4)`)
                    .add();
            }
            if (ambient.model !== 'none') {
                bag.warning('invalid-setting',
                    `ambientMedium '${scene.ambientMedium}' has surface model '${ambient.model}' — the ambient region has no boundary, so the surface model never runs (declare it 'none')`)
                    .add();
            }
        }
    }


    // Region-table (ior-class) constraints, STRUCTURAL (materials-§7 — no model name
    // here): the generated <row>_of table is region-indexed (no shading point), so a
    // GLSL expression on a transmissive model's region-table row is unrepresentable —
    // reject with a real diagnostic (the generator's throw is only a backstop). The
    // same row source authored on a NON-transmissive model is ignored (pinned to 1.0
    // in the table) — warn so the author isn't silently surprised.
    const regionTableSources = new Set(Object.values(MATERIAL_MODELS)
        .flatMap((d) => d?.properties.filter((p) => p.storage === 'region-table').map((p) => p.source as string) ?? []));
    for (const [name, mat] of Object.entries(scene.materials)) {
        const ownRegionRow = MATERIAL_MODELS[mat.model]?.properties.find((p) => p.storage === 'region-table');
        if (ownRegionRow !== undefined && isGlslExpression((mat as unknown as Record<string, unknown>)[ownRegionRow.source])) {
            bag.error('invalid-setting',
                `Material '${name}': ${ownRegionRow.source} cannot be a GLSL expression on the surface row — a spatial index is a medium: author it as medium: { ior: <formula> } (fable-variable-ior; use a constant or {param} here)`)
                .add();
        }
        for (const source of regionTableSources) {
            if (ownRegionRow?.source === source) continue;
            if ((mat as unknown as Record<string, unknown>)[source] !== undefined) {
                bag.warning('invalid-setting',
                    `Material '${name}': ${source} is ignored for model '${mat.model}' (non-transmissive regions are pinned to 1.0 in ${source}_of)`)
                    .add();
            }
        }

        // GGX roughness sanity: alpha = roughness² is clamped ≥ 1e-3 in ggx.glsl — a
        // roughness authored below ~0.032 silently renders rougher than asked; a true
        // mirror is a delta model (§3.1), not GGX at 0.
        // ACKNOWLEDGED model-by-name policy (warning-grade prose, not a domain): stays
        // hardcoded until a SECOND model needs a soft range — then it becomes row
        // metadata feeding propertyValidation (rule of three; don't build machinery
        // for one instance).
        if (mat.model === 'ggx' && typeof mat.roughness === 'number') {
            if (mat.roughness < 0.032 || mat.roughness > 1.0) {
                bag.warning('invalid-setting',
                    `Material '${name}': ggx roughness ${mat.roughness} outside [0.032, 1] — below the alpha clamp it renders as 0.032; mirrors belong to a delta model (§3.1)`)
                    .add();
            }
        }

        // Schema discipline (R2, the C5 silent-inert class): a {param}-DRIVEN property the
        // material's model doesn't read would be a live knob wired to nothing — warn.
        // (Constants on undeclared fields stay silent: harmless authoring slack.)
        // The property list is the registry-wide union of row sources (materials-§7) —
        // no hardcoded vocabulary here.
        if (mat.model !== 'none') {
            const declared = new Set(MATERIAL_MODELS[mat.model]?.properties.map((f) => f.source as string) ?? []);
            const allSources = new Set(Object.values(MATERIAL_MODELS).flatMap((d) => d?.properties.map((f) => f.source as string) ?? []));
            for (const prop of allSources) {
                const value = (mat as unknown as Record<string, unknown>)[prop];
                if (value !== undefined && isValueParam(value) && !declared.has(prop)) {
                    bag.warning('invalid-setting',
                        `Material '${name}': '${prop}' is {param}-driven but model '${mat.model}' does not read it — the knob would control nothing (schemas: fable-module-anatomy §3)`)
                        .add();
                }
            }
        }
    }

    // An empty scene cannot link: the intersection program (scene_intersect, scene_region_at,
    // material_of) is generated from the objects, and with none there is nothing to generate.
    // It used to pass here with a warning and fail later on internal seam errors. (A light in
    // fog with no surfaces is a meaningful scene; supporting it means emitting stubs — open.)
    if (scene.objects.length === 0) {
        bag.error('empty-scene', 'Scene has no objects — at least one is required (an object-free scene, e.g. a light in fog, is not supported yet)').add();
    }

    // Check for unsupported accumulation/tonemap types
    if (ACCUMULATORS[strategy.estimator.accumulation.type] === undefined) {   // D3: registry-gated
        bag.error('invalid-setting',
            `Accumulation type '${strategy.estimator.accumulation.type}' not yet supported`)
            .add();
    }
    if (!isTonemapSupported(strategy.view.tonemap.type)) {
        bag.error('invalid-setting',
            `Display/tonemap type '${strategy.view.tonemap.type}' not yet supported`)
            .add();
    }

    // Check for missing material references
    const materialNames = new Set(Object.keys(scene.materials));
    for (let i = 0; i < scene.objects.length; i++) {
        const obj = scene.objects[i];
        // Instanced batches carry the material on the prototype (it becomes the batch material).
        const mat = isInstancedObject(obj) ? obj.prototype.material : obj.material;
        if (!materialNames.has(mat)) {
            bag.error('missing-material', `Object ${i}: references unknown material '${mat}'`)
                .withOriginal('scene', [`objects[${i}]`, `material`])
                .suggest(`Available materials: ${[...materialNames].join(', ')}`)
                .add();
        }
    }

    // Instanced-batch validation (impl-plan-instancing v1: mesh + analytic prototypes, constant
    // placements, one shared material). SDF prototypes are rejected (deferred domain-repetition).
    // The prototype gets FULL per-object validation (schema/degeneracy/mesh sanity) via the same
    // validateGeometryObject as top-level objects; only batch-level rules live here.
    for (let i = 0; i < scene.objects.length; i++) {
        const obj = scene.objects[i];
        if (!isInstancedObject(obj)) continue;
        const count = placementCount(obj.placements);
        if (count === 0) {
            bag.error('invalid-setting', `Object ${i} (instanced): placements is empty — nothing to place`)
                .withOriginal('scene', [`objects[${i}]`, 'placements']).add();
        }
        if (Array.isArray(obj.placements)) {
            if (obj.placements.some((p) => isDrivenTransform(p))) {
                bag.error('invalid-setting', `Object ${i} (instanced): {param}-driven per-instance placements are not supported in v1 (constant placements only)`)
                    .withOriginal('scene', [`objects[${i}]`, 'placements']).add();
            } else {
                // The packed form's pins, for the Transform[] form: a similarity per placement
                // (finite, s > 0, one scale, a real rotation). Reported once, at the first bad
                // placement — a cloud can have millions.
                const bad = obj.placements.findIndex((t) => placementProblem(t) !== null);
                if (bad >= 0) {
                    bag.error('invalid-transform', `Object ${i} (instanced): placement ${bad}: ${placementProblem(obj.placements[bad])}`)
                        .withOriginal('scene', [`objects[${i}]`, `placements[${bad}]`]).add();
                }
            }
        } else {
            // PACKED placements (fable-instance-clouds §4): array-length arithmetic, the
            // s>0 similarity pin, unit orientations, finite positions, and the nodes-channel
            // ceiling — all reject-not-degrade (a NaN box or s≤0 would silently drop
            // instances from the TLAS; an oversized batch would fail at upload, not compile).
            const p = obj.placements;
            const badLen = (arr: Float32Array | undefined, per: number): boolean =>
                arr !== undefined && arr.length !== per * count;
            if (p.positions.length !== 3 * count || badLen(p.sizes, 1) || badLen(p.orientations, 4)) {
                bag.error('invalid-setting', `Object ${i} (instanced): packed placement arrays are not parallel — positions must be 3N, sizes N, orientations 4N for count ${count}`)
                    .withOriginal('scene', [`objects[${i}]`, 'placements']).add();
            } else {
                let finite = true;
                for (let j = 0; j < p.positions.length; j++) if (!Number.isFinite(p.positions[j])) { finite = false; break; }
                if (!finite) {
                    bag.error('invalid-setting', `Object ${i} (instanced): packed positions contain a non-finite value`)
                        .withOriginal('scene', [`objects[${i}]`, 'placements']).add();
                }
                if (p.sizes !== undefined) {
                    let ok = true;
                    for (let j = 0; j < p.sizes.length; j++) if (!(p.sizes[j] > 0) || !Number.isFinite(p.sizes[j])) { ok = false; break; }
                    if (!ok) {
                        bag.error('invalid-setting', `Object ${i} (instanced): packed sizes must be finite and > 0 (the similarity-scale pin, fable-transforms)`)
                            .withOriginal('scene', [`objects[${i}]`, 'placements']).add();
                    }
                }
                if (p.orientations !== undefined) {
                    let unit = true;
                    for (let j = 0; j < count; j++) {
                        const norm = Math.hypot(p.orientations[4 * j], p.orientations[4 * j + 1], p.orientations[4 * j + 2], p.orientations[4 * j + 3]);
                        if (Math.abs(norm - 1) > 1e-3) { unit = false; break; }
                    }
                    if (!unit) {
                        bag.error('invalid-setting', `Object ${i} (instanced): packed orientations must be unit quaternions ([x,y,z,w], |q| = 1 within 1e-3)`)
                            .withOriginal('scene', [`objects[${i}]`, 'placements']).add();
                    }
                }
            }
            if (nodeTexelBound(count) > DATA_TEX_WIDTH * DATA_TEX_WIDTH) {
                bag.error('invalid-setting', `Object ${i} (instanced): ${count} instances exceed the nodes-channel ceiling (~${Math.floor((DATA_TEX_WIDTH * DATA_TEX_WIDTH + 2) / 4)} per batch at DATA_TEX_WIDTH ${DATA_TEX_WIDTH}) — raise the width knob (fable-instance-clouds §8) or split the batch`)
                    .withOriginal('scene', [`objects[${i}]`, 'placements']).add();
            }
        }
        const proto = obj.prototype;
        validateGeometryObject(proto, `Object ${i} prototype`, [`objects[${i}]`, 'prototype'], bag);
        // (A closed mesh PROTOTYPE was rejected here until instanced containment landed —
        // impl-plan-instanced-containment. Solid instances now claim an interior through
        // the same three-tier query their un-instanced siblings use, so `closed: true`
        // is honoured on prototypes exactly as on top-level meshes.)
        if (!isMeshObject(proto)) {
            const backend = resolveBackend(proto.type, proto.backend);
            if (backend === undefined) {
                bag.error('missing-geometry', `Object ${i} (instanced): prototype primitive '${proto.type}' is not implemented`)
                    .withOriginal('scene', [`objects[${i}]`, 'prototype']).add();
            } else if (backend === 'sdf' && PRIMITIVES[proto.type]?.marchBound === 'unbounded') {
                // A marched prototype is instanceable (impl-plan-sdf-as-shape T7 — the
                // merge made the leaf item one line different), but an UNBOUNDED shape is
                // not: the leaf march needs a finite interval, and "always visited" has
                // no meaning inside a batch.
                bag.error('invalid-setting', `Object ${i} (instanced): '${proto.type}' declares marchBound 'unbounded' — a marched prototype needs a finite bound (the leaf march runs inside it)`)
                    .withOriginal('scene', [`objects[${i}]`, 'prototype']).add();
            } else if (!primitiveIsBounded(proto.type)) {
                // A1: the TLAS is a BVH over per-instance WORLD boxes, so the prototype
                // must declare a finite local box (descriptors.ts `bounds` fact). Absent =
                // unbounded (plane) — reject-not-degrade: a fabricated box would silently
                // drop instances under the default 'tlas' traversal. Strategy-independent
                // (a scene must not be valid under only one estimator setting).
                bag.error('invalid-setting', `Object ${i} (instanced): primitive '${proto.type}' declares no local bounds — an instance prototype needs a finite box (the TLAS is built over per-instance world boxes; unbounded primitives cannot be instanced)`)
                    .withOriginal('scene', [`objects[${i}]`, 'prototype']).add();
            }
        }
        if (proto.transform !== undefined) {
            bag.warning('invalid-setting', `Object ${i} (instanced): the prototype's transform is ignored — placements carry all world placement (impl-plan-instancing)`)
                .withOriginal('scene', [`objects[${i}]`, 'prototype']).add();
        }
        // Instanced emitters (fable-light-bvh §7 stage 2): a LIGHT-ELIGIBLE batch
        // (params-tier sphere prototype, constant emission) is samplable — but ONLY
        // under lightSelection 'bvh' (the power CDF never meets a 100k-entry bake;
        // path-found under 'power' is the same converged image, estimator-only).
        // Ineligible emissive batches stay path-found everywhere.
        {
            const pm = scene.materials[proto.material];
            if (pm !== undefined && pm.sampleAsLight !== false && hasConstantNonzeroEmission(
                isBlackbody(pm.emission) ? foldBlackbody(pm.emission) : pm.emission)) {
                const selection = strategy.estimator.lightSelection ?? DEFAULT_LIGHT_SELECTION;
                if (!batchLightEligible(obj, scene)) {
                    bag.warning('invalid-setting', `Object ${i} (instanced): the batch's emissive material is not samplable — only params-tier SPHERE batches carry per-instance light identity (fable-light-bvh §7); this batch is path-found only. Set sampleAsLight: false to silence this`)
                        .withOriginal('scene', [`objects[${i}]`, 'prototype']).add();
                } else if (selection !== 'bvh' && strategy.estimator.directLighting !== 'none') {
                    // Under directLighting 'none' the whole program is path-found —
                    // the hint would be noise on a deliberate pt arm.
                    bag.warning('invalid-setting', `Object ${i} (instanced): the batch's emitters are path-found under lightSelection '${selection}' — set estimator.lightSelection: 'bvh' to sample them per-instance (fable-light-bvh §7), or sampleAsLight: false to silence this`)
                        .withOriginal('scene', [`objects[${i}]`, 'prototype']).add();
                }
            }
        }
        // Per-instance ATTRIBUTES (fable-instance-attributes): keys must be field rows of
        // the prototype material's model; arrays parallel to placements; entries row-shaped
        // and finite. Emission is allowed ONLY on light-eligible batch shapes (fable-light-bvh
        // §7.1: the tree's per-instance Φ IS the per-instance selection structure the old
        // deferral was waiting for; under 'power' such a batch is path-found and the
        // hit-side attribute read is already exact). Region-indexed rows (ior) stay
        // excluded — batches are thin, and ior_of is region-keyed by construction.
        if (obj.attributes !== undefined && Object.keys(obj.attributes).length > 0) {
            const model = scene.materials[proto.material]?.model ?? '';
            const props = MATERIAL_MODELS[model]?.properties ?? [];
            const validKeys = props.filter((f) => f.storage === 'field' && f.source !== EMISSION_KEY).map((f) => f.source);
            for (const [key, arr] of Object.entries(obj.attributes)) {
                const row = props.find((f) => f.source === key);
                if (key === EMISSION_KEY && !(row !== undefined && !isMeshObject(proto) && proto.type === 'sphere' && batchPlacementRecordOf(obj, scene) === 'params')) {
                    bag.error('invalid-setting', `Object ${i} (instanced): attributes.${key} — per-instance emission is supported only on params-tier SPHERE batches (the light tree's per-instance rows, fable-light-bvh §7.1); this batch is ${isMeshObject(proto) ? 'a mesh prototype' : `'${proto.type}' / frame tier`}`)
                        .withOriginal('scene', [`objects[${i}]`, 'attributes']).add();
                    continue;
                }
                if (row === undefined || row.storage !== 'field') {
                    const why = row !== undefined
                        ? `${key} is region-indexed (${key}_of) — batches are thin (no interior); dielectric instances await containment`
                        : `not a row of model '${model}' (valid: ${validKeys.join(', ')})`;
                    bag.error('invalid-setting', `Object ${i} (instanced): attributes.${key} cannot vary per instance — ${why}`)
                        .withOriginal('scene', [`objects[${i}]`, 'attributes']).add();
                    continue;
                }
                // Rows feeding a DERIVED field (ggx roughness → alpha) are CPU-derived once
                // per material — a per-instance input would need per-instance derived slots
                // (precompute-and-ship an extra table column). Deferred; reject-not-degrade.
                const derived = MATERIAL_MODELS[model]?.derived?.find((d) => d.inputs.includes(key));
                if (derived !== undefined) {
                    bag.error('invalid-setting', `Object ${i} (instanced): attributes.${key} feeds the derived field '${derived.name}' — per-instance derived rows are deferred (the derived value is computed once per material)`)
                        .withOriginal('scene', [`objects[${i}]`, 'attributes']).add();
                    continue;
                }
                const spectrum = row.glslType === 'Spectrum';
                if (arr instanceof Float32Array) {
                    // Packed arm (fable-instance-clouds §4): N floats or 3N interleaved.
                    const expected = (spectrum ? 3 : 1) * count;
                    if (arr.length !== expected) {
                        bag.error('invalid-setting', `Object ${i} (instanced): attributes.${key} (packed) has ${arr.length} floats — a ${spectrum ? 'Spectrum' : 'float'} row over ${count} placements needs ${expected}`)
                            .withOriginal('scene', [`objects[${i}]`, 'attributes']).add();
                    } else {
                        let ok = true;
                        for (let j = 0; j < arr.length; j++) if (!Number.isFinite(arr[j])) { ok = false; break; }
                        if (!ok) {
                            bag.error('invalid-setting', `Object ${i} (instanced): attributes.${key} (packed) contains a non-finite value`)
                                .withOriginal('scene', [`objects[${i}]`, 'attributes']).add();
                        }
                    }
                    continue;
                }
                if (arr.length !== count) {
                    bag.error('invalid-setting', `Object ${i} (instanced): attributes.${key} has ${arr.length} entries for ${count} placements — the arrays must be parallel`)
                        .withOriginal('scene', [`objects[${i}]`, 'attributes']).add();
                }
                const bad = (arr as Array<number | number[]>).findIndex((v) =>
                    typeof v === 'number' ? !Number.isFinite(v)
                        : !(spectrum && isVec3(v) && v.every((c) => Number.isFinite(c))));
                if (bad !== -1) {
                    bag.error('invalid-setting', `Object ${i} (instanced): attributes.${key}[${bad}] must be a finite ${spectrum ? 'number or vec3' : 'number'}`)
                        .withOriginal('scene', [`objects[${i}]`, 'attributes']).add();
                }
            }
            // Exclusivity: the fill for this materialId becomes element-dependent, so sharing
            // it with any other object would silently change that object's shading. Explicit
            // error, never an auto-clone.
            const sharedWith = scene.objects.findIndex((o, j) => j !== i
                && (isInstancedObject(o) ? o.prototype.material : o.material) === proto.material);
            if (sharedWith !== -1) {
                bag.error('invalid-setting', `Object ${i} (instanced): material '${proto.material}' carries per-instance attributes but is also used by object ${sharedWith} — an attribute-carrying batch's material must be exclusive (give the batch its own material)`)
                    .withOriginal('scene', [`objects[${i}]`, 'attributes']).add();
            }
        }
    }

    // Transmissive-on-thin — ONE structural rule (audit A2): a region whose owner never
    // claims containment in scene_region_at has no interior, so ior_of falls to 1.0 and
    // the surface refracts as η = 1. The thin set today: zero-thickness primitives (the
    // descriptor `thin` fact), v0 meshes (surface-only — impl-plan-meshes §3), and v1
    // instanced batches (surface-only — impl-plan-instancing). Warn, don't error — the
    // surface still renders. When meshes gain containment (winding-number v2) they leave
    // the thin set and this rule stops firing for them with no edit here.
    for (let i = 0; i < scene.objects.length; i++) {
        const obj = scene.objects[i];
        const thinCase = isMeshObject(obj)
            ? (obj.closed === true ? null   // solid mesh: has an interior — the rule stops firing (the fact flipped)
                : 'an OPEN mesh (thin surface — declare `closed: true` on watertight geometry to give it an interior)')
            : isInstancedObject(obj)
                // A batch claiming an interior has left the thin set (the mesh precedent:
                // the fact flips and this rule stops firing with no edit). One that WANTS
                // an interior but cannot answer containment — an open mesh prototype, or a
                // thin primitive — still lands here, which is exactly the right diagnostic.
                ? (batchNeedsInterior(obj, scene) ? null
                    : isMeshObject(obj.prototype)
                        ? 'an instanced OPEN mesh prototype (declare `closed: true` on watertight geometry to give its instances an interior)'
                        : `an instanced batch of zero-thickness '${obj.prototype.type}' (no interior to refract into)`)
                : PRIMITIVES[obj.type]?.thin === true
                    ? `a zero-thickness '${obj.type}'`
                    : null;
        if (thinCase === null) continue;
        const matName = isInstancedObject(obj) ? obj.prototype.material : obj.material;
        if (MATERIAL_MODELS[scene.materials[matName]?.model ?? '']?.capabilities.transmission) {
            bag.warning('invalid-setting', `Object ${i}: a transmissive material on ${thinCase} has no interior region — it will refract as η = 1`)
                .withOriginal('scene', [`objects[${i}]`, 'material']).add();
        }
    }

    // Placement validation (docs/fable-transforms.md §7 + §6.1). The Transform type is
    // the first validator (scalar scale, axis-angle|quat rotation), but authored JS
    // can hand us anything — every rule re-checks at runtime with a diagnostic.
    for (let i = 0; i < scene.objects.length; i++) {
        const obj = scene.objects[i];
        if (isInstancedObject(obj)) continue;   // instanced placements validated above
        const t = obj.transform;
        if (!t) continue;

        // §6.1 pin 4: transforms NEVER accept GLSL expressions — a spatially-varying
        // transform is deformation (breaks the similarity contract and the SDF
        // distance bound), a different feature with different math.
        for (const [field, value] of Object.entries(t)) {
            if (isGlslExpression(value) || (typeof value === 'object' && value !== null && !Array.isArray(value)
                && isGlslExpression((value as { angle?: unknown }).angle))) {
                bag.error('invalid-transform',
                    `Object ${i}: transform.${field} cannot be a GLSL expression — a spatially-varying `
                    + `transform is deformation, not a placement (fable-transforms §6.1)`)
                    .withOriginal('scene', [`objects[${i}]`, `transform.${field}`])
                    .add();
            }
        }

        if (t.position !== undefined) {
            const pos = isValueParam(t.position) ? t.position.default : t.position;
            if (pos !== undefined && !isVec3(pos)) {
                bag.error('invalid-transform', `Object ${i}: transform.position${isValueParam(t.position) ? ' default' : ''} must be a vec3 of finite numbers`)
                    .withOriginal('scene', [`objects[${i}]`, `transform.position`])
                    .add();
            }
        }
        if (t.rotation !== undefined) {
            validateRotation(t.rotation, i, bag);
        }
        if (t.scale !== undefined) {
            validateScale(t.scale, i, bag);
        }

        // §6 pin: driven placement excludes SAMPLABLE emitters — their geometry is
        // baked as literals into the sampler/pdf arms and the compile-time power CDF.
        // Live light geometry is the deferred Value<T>-light-params batch (and must be
        // RIGID there — driven scale would silently stale the CDF). The MESH arm
        // (fable-mesh-lights): a driven-transform mesh with a samplable emissive material
        // silently degrades to path-only (the Planner skips it) — surface that as an error.
        if (isDrivenTransform(t) && isMeshObject(obj)) {
            const mat = scene.materials[obj.material];
            if (mat !== undefined && mat.sampleAsLight !== false && hasConstantNonzeroEmission(mat.emission)) {
                bag.error('invalid-transform',
                    `Object ${i}: a {param}-driven transform on a samplable MESH emitter is not supported — `
                    + `the light's world-space vertex/CDF tables are baked under constant placement (fable-mesh-lights §5). `
                    + `Set sampleAsLight: false to keep it path-traced only`)
                    .withOriginal('scene', [`objects[${i}]`, 'transform'])
                    .add();
            }
        }
        if (isDrivenTransform(t) && !('kind' in obj)
            && resolveBackend(obj.type, obj.backend) === 'analytic') {
            if (PRIMITIVES[obj.type]?.samplableAsLight === true) {
                const mat = scene.materials[obj.material];
                if (mat !== undefined && mat.sampleAsLight !== false && hasConstantNonzeroEmission(mat.emission)) {
                    bag.error('invalid-transform',
                        `Object ${i}: a {param}-driven transform on a samplable emitter is not supported — `
                        + `light geometry is compiled into the sampler/pdf/power-CDF as constants. `
                        + `Set sampleAsLight: false to keep it path-traced only, or wait for the `
                        + `Value<T> light-params batch (rigid-only)`)
                        .withOriginal('scene', [`objects[${i}]`, 'transform'])
                        .add();
                }
            }
        }
    }
}

/**
 * Per-object geometry validation — ONE truth for top-level objects AND instanced
 * prototypes (audit A3: a prototype is an object description; shallow parallel checks
 * silently skipped schema/degeneracy/index-range and let GPU garbage-fetches through).
 *
 * Primitives: backend-pin honorability (B1 + audit C1), descriptor degeneracy rules
 * (C5 — validateValues runs only over well-shaped required rows), and the parameter
 * schema (R3 / review C7: `{ r: 2 }` must not silently render a unit sphere — unknown
 * keys warn, missing required / wrong shape error). Unimplemented TYPES are the
 * caller's diagnostic (Planner for top-level, the instanced loop for prototypes).
 *
 * Meshes: buffer sanity — well-formed lengths and in-range indices (a malformed
 * buffer would silently texelFetch garbage vertices on the GPU).
 *
 * `label` prefixes messages (`Object 3`, `Object 3 prototype`); `path` prefixes
 * diagnostic origins (`objects[3]` / `objects[3].prototype`).
 */
function validateGeometryObject(obj: PrimitiveObject | MeshObject, label: string, path: string[], bag: DiagnosticBag): void {
    if ('kind' in obj) {
        const vertexCount = obj.positions.length / 3;
        // Finite as well as well-shaped: the scene-wide finiteness sweep skips typed arrays,
        // and a NaN vertex surfaced only later as a formatter error naming no object (or, on
        // a closed mesh, as "INWARD winding (volume NaN)").
        let nonFinite = -1;
        for (let k = 0; k < obj.positions.length; k++) if (!Number.isFinite(obj.positions[k])) { nonFinite = k; break; }
        const positionsOk = obj.positions.length > 0 && obj.positions.length % 3 === 0 && nonFinite < 0;
        if (nonFinite >= 0) {
            bag.error('invalid-setting', `${label} (mesh): vertex ${Math.floor(nonFinite / 3)} has a non-finite coordinate (${obj.positions[nonFinite]})`)
                .withOriginal('scene', [...path, 'positions']).add();
        } else if (!positionsOk) {
            bag.error('invalid-setting', `${label} (mesh): positions length ${obj.positions.length} is not a nonzero multiple of 3`)
                .withOriginal('scene', [...path, 'positions']).add();
        }
        let indicesOk = obj.indices.length > 0 && obj.indices.length % 3 === 0;
        if (!indicesOk) {
            bag.error('invalid-setting', `${label} (mesh): indices length ${obj.indices.length} is not a nonzero multiple of 3`)
                .withOriginal('scene', [...path, 'indices']).add();
        } else if (Number.isInteger(vertexCount)) {
            let maxIdx = -1;
            for (let k = 0; k < obj.indices.length; k++) if (obj.indices[k] > maxIdx) maxIdx = obj.indices[k];
            if (maxIdx >= vertexCount) {
                indicesOk = false;
                bag.error('invalid-setting', `${label} (mesh): vertex index ${maxIdx} out of range (only ${vertexCount} vertices)`)
                    .withOriginal('scene', [...path, 'indices']).add();
            }
        }
        if (obj.normals !== undefined && obj.normals.length !== obj.positions.length) {
            bag.error('invalid-setting', `${label} (mesh): normals length ${obj.normals.length} must match positions length ${obj.positions.length} (one normal per vertex)`)
                .withOriginal('scene', [...path, 'normals']).add();
        }
        if (obj.uvs !== undefined && obj.uvs.length !== vertexCount * 2) {
            bag.error('invalid-setting', `${label} (mesh): uvs length ${obj.uvs.length} must be 2× the vertex count (${vertexCount * 2})`)
                .withOriginal('scene', [...path, 'uvs']).add();
        }
        // `closed: true` — INTENT proven as FACT (fable-mesh-containment §2): watertight,
        // consistently wound, outward. Position-welded edge accounting (topology.ts), so
        // split-corner meshes check correctly. Reject-not-degrade: a leaky "solid" must
        // error loudly, never silently render η=1. Runs only on well-formed buffers.
        if (obj.closed === true && positionsOk && indicesOk) {
            const c = meshClosedness(obj.positions, obj.indices);
            if (!c.watertight) {
                bag.error('invalid-setting', `${label} (mesh): closed: true but the mesh is not watertight — ${c.boundaryEdges} boundary edge(s), ${c.nonManifoldEdges} non-manifold edge(s); a solid must bound a volume (leave \`closed\` off for open surfaces)`)
                    .withOriginal('scene', [...path, 'closed']).add();
            } else if (!c.consistent) {
                bag.error('invalid-setting', `${label} (mesh): closed: true but ${c.flippedEdges} edge(s) have same-direction winding — faces disagree on which side is out; fix the flipped patch`)
                    .withOriginal('scene', [...path, 'closed']).add();
            } else if (!c.outward) {
                bag.error('invalid-setting', `${label} (mesh): closed: true but the winding is INWARD (signed volume ${c.volume.toPrecision(4)} <= 0) — reverse the winding so normals face out`)
                    .withOriginal('scene', [...path, 'closed']).add();
            }
        }
        return;
    }

    const type = obj.type;
    const desc = type !== undefined ? PRIMITIVES[type] : undefined;
    if (desc !== undefined && obj.backend !== undefined
        && (obj.backend === 'sdf' ? !desc.provides.sdf : !desc.provides.analytic)) {
        bag.error('invalid-setting',
            `${label}: backend '${obj.backend}' pinned but primitive '${type}' does not provide it`)
            .withOriginal('scene', [...path, 'backend'])
            .add();
    }
    // Coupled degeneracy rules come from the DESCRIPTOR (C5: the last primitive
    // name-branch died here — quad's parallel-edges rule lives on quad.ts, ONE
    // formula with the quad light's). Runs only over well-shaped required rows.
    if (desc?.validateValues !== undefined) {
        const rowsOk = desc.params.every((s) => {
            const v = obj.parameters[s.name];
            if (v === undefined) return !s.required;
            return s.shape === 'number' ? typeof v === 'number' && Number.isFinite(v) : isVec3(v);
        });
        if (rowsOk) {
            // RESOLVED values (fable-sdf-contract §3's pin): a rule reading an
            // optional row (menger's iterations, apollonian's morph) must see the
            // default, not undefined — the same contract every descriptor function has.
            for (const msg of desc.validateValues(resolvePrimitiveValues(desc, obj.parameters))) {
                bag.error('invalid-setting', `${label} (${type}): ${msg}`)
                    .withOriginal('scene', path)
                    .add();
            }
        }
    }
    // Parameter schema (C7). Unimplemented types / unhonorable pins skip it — those
    // carry their own diagnostics.
    if (!desc || resolveBackend(type, obj.backend) === undefined) return;
    const params = (obj.parameters ?? {}) as Record<string, unknown>;
    const schema = desc.params;
    const known = new Map(schema.map((s) => [s.name, s]));
    for (const key of Object.keys(params)) {
        if (!known.has(key)) {
            bag.warning('invalid-setting',
                `${label} (${type}): unknown parameter '${key}' is ignored (valid: ${schema.map((s) => s.name).join(', ')})`)
                .add();
        }
    }
    for (const s of schema) {
        const v = params[s.name];
        if (v === undefined) {
            if (s.required) {
                bag.error('invalid-setting',
                    `${label} (${type}): required parameter '${s.name}' is missing`)
                    .add();
            }
            continue;
        }
        const shapeOk = s.shape === 'number'
            ? typeof v === 'number' && Number.isFinite(v)
            : Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number' && Number.isFinite(c));
        if (!shapeOk) {
            bag.error('invalid-setting',
                `${label} (${type}): parameter '${s.name}' must be a ${s.shape === 'number' ? 'finite number' : 'vec3 of finite numbers'}`)
                .add();
        } else {
            validatePrimitiveConstraint(s, v, `${label} (${type}): parameter '${s.name}'`, bag);
        }
    }

    // Scene-local fields (fable-sdf-contract §5.2): the declared bound is CHECKED
    // against the definition's own TS twin, over THIS object's resolved values — the
    // same gate registry occupants get in vitest (marchBound.test.ts), run where the
    // real parameter values are, so a value-dependent bound failure cannot hide. A
    // bound that clips is a compile error here, never silently chopped geometry on
    // the GPU. ~26³ twin evaluations per local object per compile: milliseconds, and
    // only for defineSDF shapes.
    if (desc.local === true && desc.fieldTwin !== undefined) {
        const rowsWellFormed = schema.every((s) => {
            const v = params[s.name];
            if (v === undefined) return !s.required;
            return s.shape === 'number' ? typeof v === 'number' && Number.isFinite(v) : isVec3(v);
        });
        const mb = desc.marchBound;
        if (rowsWellFormed && mb !== undefined && mb !== 'self' && mb !== 'unbounded') {
            const resolved = resolvePrimitiveValues(desc, obj.parameters);
            const boundDesc = PRIMITIVES[mb.type];
            const boundField = BOUND_FIELDS[mb.type];
            const box = primitiveBounds(desc.type, resolved);
            if (boundDesc !== undefined && boundField !== undefined && box !== null) {
                const boundValues = resolvePrimitiveValues(boundDesc, mb.values(resolved));
                const twin = desc.fieldTwin;
                const r = checkBoundContainment((p, v) => twin(p, v), resolved, boundField, boundValues, box);
                if (r.escaped > 0) {
                    bag.error('invalid-setting',
                        `${label} (${type}): the declared '${mb.type}' bound CLIPS the field at these values — ${r.escaped} interior sample(s) fall outside it (worst escape ${r.worst.toPrecision(3)}); enlarge the bound (a loose bound only costs march steps)`)
                        .withOriginal('scene', path)
                        .add();
                } else if (r.interior === 0) {
                    bag.warning('invalid-setting',
                        `${label} (${type}): the field has NO interior samples over its bound at these values — the shape may be empty, or the twin may not match the GLSL`)
                        .withOriginal('scene', path)
                        .add();
                }
                // The CONSERVATIVENESS gate (fable-sdf-contract §4's law): a field
                // claiming MORE distance than is true lets the marcher step through
                // walls — rendered as terraced rings that no epsilon can fix (the
                // glass-lab night). Directional slopes never exceed the true
                // Lipschitz constant, so worst > 1 (+FD grace) is proof of a lie.
                const cons = checkConservativeness((p, v) => twin(p, v), resolved, box);
                if (cons.worst > 1.02) {
                    bag.error('invalid-setting',
                        `${label} (${type}): the field OVERESTIMATES distance (sampled slope ${cons.worst.toPrecision(3)} at [${cons.at.map((x) => x.toPrecision(3)).join(', ')}]) — the marcher can step through walls (terraced-ring artifacts). Use a conservative estimate (the (f, ∇f, H) envelope — fable-sdf-contract §4)`)
                        .withOriginal('scene', path)
                        .add();
                }
            }
        }
    }
}

/** "Some SAMPLABLE object uses material `name`" — the geometry leg of the §6.2 emitter
 *  condition, shared by the sampleAsLight rule and the phantom-light rule (C3: the two
 *  inline scans were byte-identical and drifted only by luck). Samplable geometry = the
 *  census's geometry conditions (samplableEmitterObjects, dataTenants.ts), without its
 *  emission condition, which the rules check themselves: an analytic samplable primitive
 *  (quad/sphere/disk) with constant placement that does not keep a local frame, or a MESH
 *  with constant placement (fable-mesh-lights). (Until Sep 25 2026 the primitive leg skipped
 *  the placement and frame exclusions, so sampleAsLight: true on a driven, or a rotated
 *  uv-reading, shape passed here and was then silently dropped by the census.) */
function samplableObjectUses(scene: SceneDescription, name: string): boolean {
    return scene.objects.some((o) =>
        (isPrimitiveObject(o) && o.material === name && PRIMITIVES[o.type]?.samplableAsLight === true
            && resolveBackend(o.type, o.backend) === 'analytic'
            && !isDrivenTransform(o.transform) && !keepsLocalFrame(o, scene))
        || (isMeshObject(o) && o.material === name && !isDrivenTransform(o.transform)));
}

/** §7 rules 2: quaternion normalized-within-tolerance (warn + the Planner normalizes),
 *  error near zero; axis-angle rejects a zero axis. §6: quaternion and angle may be
 *  `{param}`-driven — their DEFAULTS get the same checks. */
function validateRotation(rotation: unknown, index: number, bag: DiagnosticBag): void {
    const at = (field: string) => [`objects[${index}]`, `transform.rotation${field}`] as [string, string];
    const checkQuat = (q: unknown, what: string): void => {
        if (!Array.isArray(q) || q.length !== 4 || q.some((c) => typeof c !== 'number' || !Number.isFinite(c))) {
            bag.error('invalid-transform', `Object ${index}: ${what} must be 4 finite numbers [x, y, z, w]`)
                .withOriginal('scene', at('')).add();
            return;
        }
        const norm = Math.hypot(q[0], q[1], q[2], q[3]);
        if (norm < 1e-6) {
            bag.error('invalid-transform', `Object ${index}: ${what} is degenerate (norm ${norm})`)
                .withOriginal('scene', at('')).add();
        } else if (Math.abs(norm - 1) > 1e-3) {
            bag.warning('invalid-transform',
                `Object ${index}: ${what} is not unit (norm ${norm.toFixed(4)}) — normalizing`)
                .withOriginal('scene', at('')).add();
        }
    };

    if (Array.isArray(rotation)) {
        checkQuat(rotation, 'quaternion rotation');
        return;
    }
    if (isValueParam(rotation)) {
        // Driven quaternion (the graph runtime's port): validate the default if given.
        if (rotation.default !== undefined) checkQuat(rotation.default, `rotation param '${rotation.param}' default`);
        return;
    }
    if (typeof rotation === 'object' && rotation !== null && 'axis' in rotation && 'angle' in rotation) {
        const aa = rotation as { axis: unknown; angle: unknown };
        if (!isVec3(aa.axis) || Math.hypot(...(aa.axis as Vec3)) < 1e-8) {
            bag.error('invalid-transform', `Object ${index}: rotation axis must be a nonzero vec3 of finite numbers (the axis is always constant — drive the angle)`)
                .withOriginal('scene', at('.axis')).add();
        }
        const angle = isValueParam(aa.angle) ? (aa.angle.default ?? 0) : aa.angle;
        if (typeof angle !== 'number' || !Number.isFinite(angle)) {
            bag.error('invalid-transform', `Object ${index}: rotation angle${isValueParam(aa.angle) ? ' default' : ''} must be a finite number (radians)`)
                .withOriginal('scene', at('.angle')).add();
        }
        return;
    }
    bag.error('invalid-transform',
        `Object ${index}: rotation must be axis-angle { axis, angle }, a quaternion [x, y, z, w], or a {param} quaternion`)
        .withOriginal('scene', at('')).add();
}

/** §7 rules 1/3/5: strictly positive scalar scale — reflections (s < 0) rejected, not
 *  deferred; nonuniform scale is unrepresentable; extreme scale warns (scene-scale
 *  hygiene against the fixed world-space epsilons, not bias). */
function validateScale(scale: unknown, index: number, bag: DiagnosticBag): void {
    const at = [`objects[${index}]`, 'transform.scale'] as [string, string];
    if (Array.isArray(scale)) {
        bag.error('invalid-transform',
            `Object ${index}: nonuniform scale is not a transform — a similarity has one scale. `
            + `Shape stretching belongs in primitive parameters (e.g. box halfSize), not placement`)
            .withOriginal('scene', at).add();
        return;
    }
    if (isValueParam(scale)) {
        // Driven scale (§6): compile-time rules apply to the DEFAULT; runtime values
        // are floored by the compute guard rail (§6.1 pin 4), with the param's `min`
        // as the policy source — warn when it can't serve that role.
        if (scale.default !== undefined && (typeof scale.default !== 'number' || !(scale.default > 0))) {
            bag.error('invalid-transform', `Object ${index}: transform.scale param default must be > 0`)
                .withOriginal('scene', at).add();
        }
        if (scale.min === undefined || scale.min <= 0) {
            bag.warning('invalid-transform',
                `Object ${index}: driven transform.scale has no positive 'min' — runtime values `
                + `will be floored at 1e-6; set min > 0 to define the clamp policy`)
                .withOriginal('scene', at).add();
        }
        return;
    }
    if (typeof scale !== 'number' || !Number.isFinite(scale)) {
        bag.error('invalid-transform', `Object ${index}: transform.scale must be a finite number`)
            .withOriginal('scene', at).add();
        return;
    }
    if (scale <= 0) {
        bag.error('invalid-transform',
            `Object ${index}: transform.scale must be > 0 (reflections are rejected — a mirror `
            + `would silently flip the one-sided quad pin and frame handedness)`)
            .withOriginal('scene', at).add();
        return;
    }
    if (Math.abs(Math.log10(scale)) > 2) {
        // Analytic spawn offsets are fp-relative and scale-free since impl-plan-epsilon-
        // discipline; the MARCHED tier's clearances are still world-fixed, so the warning
        // stays for scenes that march.
        bag.warning('invalid-transform',
            `Object ${index}: transform.scale ${scale} is extreme — the marched tier's world-space `
            + `clearances (MARCH_EPSILON, MARCH_CLEARANCE, EPS_INTERFACE) are fixed; consider rescaling the scene`)
            .withOriginal('scene', at).add();
    }
}

/** What is wrong with one constant instance placement, or null. The rules of
 *  validateScale/validateRotation (object transforms), as a predicate. */
function placementProblem(t: unknown): string | null {
    if (t === null || typeof t !== 'object') return 'a placement must be a transform { position?, rotation?, scale? }';
    const { position, rotation, scale } = t as { position?: unknown; rotation?: unknown; scale?: unknown };
    if (position !== undefined && !isVec3(position)) return 'position must be a vec3 of finite numbers';
    if (scale !== undefined) {
        if (Array.isArray(scale)) return 'scale must be one number (a similarity has one scale; nonuniform scale is not a transform)';
        if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return `scale must be a finite number > 0 (got ${String(scale)})`;
    }
    if (rotation !== undefined) {
        if (Array.isArray(rotation)) {
            if (rotation.length !== 4 || rotation.some((c) => typeof c !== 'number' || !Number.isFinite(c))) return 'a quaternion rotation must be 4 finite numbers [x, y, z, w]';
            if (Math.hypot(...(rotation as number[])) < 1e-6) return 'the quaternion rotation is degenerate (norm ≈ 0)';
        } else if (typeof rotation === 'object' && rotation !== null && 'axis' in rotation && 'angle' in rotation) {
            const { axis, angle } = rotation as { axis: unknown; angle: unknown };
            if (!isVec3(axis) || Math.hypot(...(axis as Vec3)) < 1e-8) return 'the rotation axis must be a nonzero vec3 of finite numbers';
            if (typeof angle !== 'number' || !Number.isFinite(angle)) return 'the rotation angle must be a finite number (radians)';
        } else {
            return 'rotation must be axis-angle { axis, angle } or a quaternion [x, y, z, w]';
        }
    }
    return null;
}

function validatePrimitiveConstraint(
    schema: PrimitiveParamSpec,
    value: unknown,
    label: string,
    bag: DiagnosticBag,
): void {
    // The shared D1 interpreter — one message voice for every family's rows.
    if (schema.constraint === undefined) return;
    const violation = constraintViolation(value as number | number[], schema.constraint);
    if (violation !== null) bag.error('invalid-setting', `${label} ${violation}`).add();
}

// ============================================================================
// Helpers (audit-hardening H1)
// ============================================================================


/** May this authored emission be nonzero at runtime? Constants by value (some channel
 *  > 0), a blackbody by its scale (constant 0 → no, driven → maybe), and any {param} or
 *  GLSL expression → maybe. Covers every value spelling of SpectrumProperty. */
function emissionMayBeNonzero(e: unknown): boolean {
    if (e === undefined) return false;
    if (typeof e === 'number') return e > 0;
    if (Array.isArray(e)) return e.some((c) => typeof c === 'number' && c > 0);
    if (isBlackbody(e)) {
        const s = e.blackbody.scale;
        return s === undefined || isValueParam(s) || s !== 0;
    }
    return true;   // {param} or GLSL expression
}

function isVec3(v: unknown): v is Vec3 {
    return Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number');
}

/** Recursive {param} path collector — mirrors validateFinite's walk so future
 *  Value<> fields are covered without a per-field list. */
/**
 * Recursive sweep over GLSL expressions with declared params (heterogeneous D4).
 * Shape: `param` a string, `default` a finite number (v1: float params only). Inertness:
 * a declared param whose derived uniform never appears in the source drives nothing —
 * the C5 class. Finiteness of defaults also rides validateFinite; the shape check here
 * gives the authoring-time message.
 */
function validateExpressionParams(value: unknown, path: string, bag: DiagnosticBag): void {
    if (value === null || typeof value !== 'object') return;
    if (isGlslExpression(value)) {
        for (const p of value.params ?? []) {
            if (typeof p.param !== 'string' || p.param.length === 0
                || typeof p.default !== 'number' || !Number.isFinite(p.default)) {
                bag.error('invalid-setting',
                    `Expression at '${path}': params entries must be { param: string, default: finite number } (v1: float params only)`)
                    .add();
                continue;
            }
            if (!value.source.includes(paramToUniform(p.param))) {
                bag.warning('invalid-setting',
                    `Expression at '${path}' declares param '${p.param}' but its uniform '${paramToUniform(p.param)}' never appears in the source — the slider drives nothing`)
                    .add();
            }
        }
        return;
    }
    if (ArrayBuffer.isView(value)) return;
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) validateExpressionParams(value[i], `${path}[${i}]`, bag);
        return;
    }
    for (const [k, v] of Object.entries(value)) validateExpressionParams(v, `${path}.${k}`, bag);
}

function collectParamPaths(value: unknown, out: Set<string>): void {
    if (value === null || typeof value !== 'object') return;
    if (isValueParam(value)) {
        if (typeof value.param === 'string') out.add(value.param);
        return;
    }
    if (ArrayBuffer.isView(value)) return;
    if (Array.isArray(value)) {
        for (const v of value) collectParamPaths(v, out);
        return;
    }
    for (const v of Object.values(value)) collectParamPaths(v, out);
}

/**
 * Recursive finiteness sweep: every number reaching codegen must be finite, or the GLSL
 * number formatter throws a raw unmapped Error. Strings/booleans pass through; typed arrays
 * (mesh data) are skipped — meshes are rejected by their own rule.
 */
function validateFinite(value: unknown, path: string, bag: DiagnosticBag): void {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            bag.error('invalid-setting', `Scene value '${path}' is not finite (${value})`).add();
        }
        return;
    }
    if (value === null || typeof value !== 'object') return;
    if (ArrayBuffer.isView(value)) return;
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) validateFinite(value[i], `${path}[${i}]`, bag);
        return;
    }
    for (const [k, v] of Object.entries(value)) validateFinite(v, `${path}.${k}`, bag);
}
