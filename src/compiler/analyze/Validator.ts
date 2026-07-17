// compiler/analyze/Validator.ts

import type { SceneFeatures } from './types.js';
import type { SceneDescription, RenderStrategy, Vec3 } from '../types.js';
import { isGlslExpression, isValueParam, RESERVED_PARAM_PATHS, RESERVED_PARAM_PREFIXES } from '../types.js';
import { paramToUniform } from '../../components/glsl-format.js';
import type { DiagnosticBag } from '../../errors/core/DiagnosticBag.js';
import { MATERIAL_MODELS } from '../../components/materials/index.js';
import { LIGHT_KINDS } from '../../components/lights/index.js';
import { PRIMITIVES, resolveBackend, type PrimitiveParamSpec } from '../../components/geometry/index.js';
import { isDrivenTransform } from '../../components/geometry/similarity.js';
import { CAMERA_MODELS } from '../../components/camera/index.js';
import { isTonemapSupported } from '../../components/tonemap/index.js';
import { isMediumModelSupported } from '../../components/volume_scattering/index.js';
import { validateSceneProperties } from './propertyValidation.js';

/** Minimum |edge1 × edge2| for quads (lights AND analytic objects) — near-zero areas make Inf pdfs. */
const MIN_QUAD_AREA = 1e-8;
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
    if (features.ambientSpace !== 'euclidean') {
        bag.error('invalid-setting', `Ambient space '${features.ambientSpace}' not yet supported`)
            .add();
    }

    if (features.geometry.hasMeshes) {
        bag.error('missing-geometry', 'Mesh objects not yet supported')
            .add();
    }

    // Analytic objects (closed-form sphere/plane) are supported — the analytic geometry backend
    // (docs/impl-plan-analytic-backend.md). StandardAnalytic already constrains type to sphere|plane.

    if (features.lighting.directionalLightCount > 0) {
        bag.error('invalid-setting', 'Directional lights not yet supported')
            .add();
    }

    if (strategy.estimator.directLighting !== 'none'
        && features.lighting.totalLightCount === 0
        && !features.environment.samplable) {
        bag.error('incompatible-options',
            `Direct lighting '${strategy.estimator.directLighting}' requested but scene has no lights (a samplable environment counts — image env, or constant with sampleAsLight: true)`)
            .add();
    }

    // --- Lights (impl-plan-area-lights A0; degeneracy rules registry-driven — A3) ---
    for (let i = 0; i < scene.lights.length; i++) {
        const light = scene.lights[i];
        // Kind-specific degeneracy (near-zero quad area → Inf pdfs; non-positive sphere
        // radius): the kind DESCRIPTOR declares its rules; the Validator emits them.
        const d = LIGHT_KINDS[light.kind];
        if (d?.validateAuthored !== undefined) {
            for (const msg of d.validateAuthored(light as unknown as Record<string, unknown>)) {
                bag.error('invalid-setting', `Light ${i}: ${msg}`).add();
            }
        }
        // Negative radiance is non-physical: pt sees negative energy on every hit while the
        // power CDF floors at ~0 so NEE almost never samples it — the strategies diverge.
        const e = light.emission;
        const negative = typeof e === 'number' ? e < 0 : e.some((c) => c < 0);
        if (negative) {
            bag.error('invalid-setting', `Light ${i}: emission must be >= 0 (negative radiance diverges pt vs pt-nee)`).add();
        }
    }

    // --- Backend pins + analytic OBJECT degeneracy (B1 + audit C1). A pin the
    // primitive can't honor is an error; quad objects that reach the analytic
    // backend need non-degenerate edges (a zero cross product is NaN → a raw
    // formatter throw; near-zero areas make Inf pdfs if emissive).
    for (let i = 0; i < scene.objects.length; i++) {
        const obj = scene.objects[i];
        if ('kind' in obj) continue;
        const desc = PRIMITIVES[obj.type];
        if (desc !== undefined && obj.backend !== undefined
            && (obj.backend === 'sdf' ? !desc.provides.sdf : !desc.provides.analytic)) {
            bag.error('invalid-setting',
                `Object ${i}: backend '${obj.backend}' pinned but primitive '${obj.type}' does not provide it`)
                .withOriginal('scene', [`objects[${i}]`, 'backend'])
                .add();
        }
        if (resolveBackend(obj.type, obj.backend) !== 'analytic') continue;
        if (obj.type === 'quad') {
            const e1 = obj.parameters.edge1, e2 = obj.parameters.edge2;
            if (!isVec3(e1) || !isVec3(e2) || !isVec3(obj.parameters.corner)) {
                bag.error('invalid-setting',
                    `Object ${i}: analytic quad requires corner/edge1/edge2 as [x,y,z] arrays`)
                    .withOriginal('scene', [`objects[${i}]`])
                    .add();
            } else if (quadCrossSq(e1 as [number, number, number], e2 as [number, number, number]) < MIN_QUAD_AREA * MIN_QUAD_AREA) {
                bag.error('invalid-setting',
                    `Object ${i}: analytic quad edges are parallel or near-parallel — area |edge1 × edge2| must be >= ${MIN_QUAD_AREA}`)
                    .withOriginal('scene', [`objects[${i}]`])
                    .add();
            }
        }
    }

    // --- Finiteness (audit C6): a NaN/Inf anywhere in the scene reaches the GLSL number
    // formatter, which throws a raw unmapped Error. One central sweep; the formatter throw
    // stays as an unreachable backstop.
    validateFinite(scene.objects, 'objects', bag);
    validateFinite(scene.materials, 'materials', bag);
    validateFinite(scene.lights, 'lights', bag);
    validateFinite(scene.environment, 'environment', bag);

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
        const analyticSamplable = scene.objects.some((o) =>
            !('kind' in o) && resolveBackend(o.type, o.backend) === 'analytic'
            && PRIMITIVES[o.type]?.samplableAsLight === true && o.material === name);
        if (!analyticSamplable) {
            bag.error('invalid-setting',
                `Material '${name}': sampleAsLight requires an ANALYTIC quad or sphere object using it (V1-C2 — emissive SDF/custom shapes are path-only and still glow)`)
                .add();
        }
        const e = mat.emission;
        const constantEmission = typeof e === 'number' ? e !== 0 : Array.isArray(e) ? e.some((c) => c !== 0) : false;
        if (!constantEmission) {
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
        const nonzeroEmission = typeof e === 'number' ? e > 0 : Array.isArray(e) ? e.some((c) => c > 0) : false;
        const negativeEmission = typeof e === 'number' ? e < 0 : Array.isArray(e) ? e.some((c) => c < 0) : false;
        if (negativeEmission) {
            bag.error('invalid-setting', `Material '${name}': emission components must be >= 0`).add();
        }
        if (nonzeroEmission && !EMITTING_MODELS.has(mat.model)) {
            const wouldRegister = mat.sampleAsLight !== false && scene.objects.some((o) =>
                !('kind' in o) && resolveBackend(o.type, o.backend) === 'analytic'
                && PRIMITIVES[o.type]?.samplableAsLight === true && o.material === name);
            if (wouldRegister) {
                bag.error('invalid-setting',
                    `Material '${name}': model '${mat.model}' carries emission but its emission dispatch returns zero — as a samplable light this adds NEE energy BSDF paths never see (pt/pt-nee diverge). Use model 'lambert' (albedo 0 for a pure emitter) or set sampleAsLight: false`)
                    .add();
            } else {
                bag.warning('invalid-setting',
                    `Material '${name}': emission is ignored for model '${mat.model}' — its emission dispatch returns zero (only lambert emits in v1)`)
                    .add();
            }
        }
    }

    // Check for unsupported material models
    if (features.materials.hasDisney) {
        bag.error('invalid-setting', "Material model 'disney' not yet supported").add();
    }
    if (features.materials.hasEmissive) {
        // Review C4: 'emissive' flowed through the Planner into the dispatch and failed at the
        // GPU with an undeclared-identifier error instead of a diagnostic. Superseded by
        // emission on any surface model, and by model 'none' + medium for pure volume regions.
        bag.error('invalid-setting',
            "Material model 'emissive' is not a model — use emission on a surface model (e.g. lambert with albedo 0), or model 'none' with a medium block for a pure volume region")
            .add();
    }

    // --- Media (impl-plan-media M0; V1-C1 as rejections per §1.1) ---
    for (const [name, mat] of Object.entries(scene.materials)) {
        if (mat.medium !== undefined) {
            for (const [prop, value] of Object.entries(mat.medium)) {
                if (isGlslExpression(value)) {
                    bag.error('invalid-setting',
                        `Material '${name}': medium.${prop} is a GLSL expression — procedural media not yet supported (V1-C1); declare a majorant when they are (§3.5). Use a constant or {param}`)
                        .add();
                }
            }
            if (mat.medium.model !== undefined && !isMediumModelSupported(mat.medium.model)) {
                bag.error('invalid-setting',
                    `Material '${name}': medium.model '${mat.medium.model}' is not a registered volume scattering model`)
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

    // T5: a compensated env table deliberately has pdf = 0 where L > 0 — unbiased ONLY when
    // BSDF sampling covers those directions with MIS weighting. NEE-only would lose energy.
    if (strategy.estimator.envCompensation === true && strategy.estimator.directLighting !== 'mis') {
        bag.error('incompatible-options',
            `envCompensation requires directLighting 'mis' — a compensated importance table has deliberate pdf-0 regions that only MIS covers unbiasedly (got '${strategy.estimator.directLighting}')`)
            .add();
    }

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
        // area arms land (reject-not-degrade).
        const hasAreaLight = scene.lights.some((l) => l.kind === 'quad' || l.kind === 'sphere')
            || Object.values(scene.materials).some((m) => m.sampleAsLight === true);
        if (hasAreaLight) {
            bag.error('incompatible-options',
                `mediumLightSampling 'equiangular' supports DELTA lights only in v1 — this scene has samplable area emitters (deferred: p-independent area arms, impl-plan-equiangular §7)`)
                .add();
        }
        // The C5 silent-inert rule: the knob must control something.
        if (strategy.estimator.directLighting === 'none' || !features.media.hasScatteringMedia) {
            bag.warning('invalid-setting',
                `mediumLightSampling 'equiangular' controls nothing here (needs directLighting 'nee' AND scattering media) — the knob is inert`)
                .add();
        }
    }

    // Reserved strategy values (reject-not-remove — the axes exist in the types so the
    // design surface is visible; the implementations arrive later).
    const vs = strategy.estimator.volumeSampling;
    if (vs === 'raymarch' || vs === 'delta-tracking' || vs === 'ratio-tracking') {
        bag.error('invalid-setting',
            `volumeSampling '${vs}' not yet supported — homogeneous media (V1-C1) are exact under 'analytic' (closed-form sampling); 'raymarch' is reserved for biased marching and the null-collision pair needs majorants`)
            .add();
    }
    const cameraType = strategy.measurement.camera.type;
    if (CAMERA_MODELS[cameraType] === undefined) {
        const registered = Object.keys(CAMERA_MODELS).filter((t) => CAMERA_MODELS[t as keyof typeof CAMERA_MODELS] !== undefined);
        bag.error('invalid-setting',
            `Camera type '${cameraType}' not yet supported — no occupant in the camera registry (reserved-not-removed)`)
            .suggest(`Registered cameras: ${registered.join(', ')}`)
            .add();
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


    // Dielectric ior constraints: the generated ior_of table is region-indexed (no shading
    // point), so a GLSL-expression ior is unrepresentable — reject here with a real diagnostic
    // (the generator's throw is only a backstop). An ior on a NON-dielectric material is ignored
    // (pinned to 1.0 in the table) — warn so the author isn't silently surprised.
    for (const [name, mat] of Object.entries(scene.materials)) {
        if (mat.model === 'dielectric' && isGlslExpression(mat.ior)) {
            bag.error('invalid-setting',
                `Material '${name}': ior cannot be a GLSL expression — ior_of(region) is a region-indexed table with no shading point (use a constant or {param})`)
                .add();
        }
        if (mat.model !== 'dielectric' && mat.ior !== undefined) {
            bag.warning('invalid-setting',
                `Material '${name}': ior is ignored for model '${mat.model}' (non-transmissive regions are pinned to 1.0 in ior_of)`)
                .add();
        }

        // GGX roughness sanity: alpha = roughness² is clamped ≥ 1e-3 in ggx.glsl — a
        // roughness authored below ~0.032 silently renders rougher than asked; a true
        // mirror is a delta model (§3.1), not GGX at 0.
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
            // An emission VALUE on a model that cannot emit (its emission function ≡ 0).
            const emissiveCapable = MATERIAL_MODELS[mat.model]?.capabilities.emissive ?? false;
            const hasEmission = mat.emission !== undefined && !isValueParam(mat.emission) && !isGlslExpression(mat.emission)
                ? (typeof mat.emission === 'number' ? mat.emission > 0 : (mat.emission as Vec3).some((c) => c > 0))
                : mat.emission !== undefined;
            if (!emissiveCapable && hasEmission) {
                bag.warning('invalid-setting',
                    `Material '${name}': emission is set but model '${mat.model}' cannot emit (its emission is identically zero) — the value is ignored`)
                    .add();
            }
        }
    }

    // Geometry-primitive parameter schemas (R3 / review C7): `{ r: 2 }` must not silently
    // render a unit sphere. Unknown keys warn (typo class); missing required / wrong shape
    // error. Unimplemented primitive TYPES are the Planner's diagnostic, not ours.
    for (let i = 0; i < scene.objects.length; i++) {
        const obj = scene.objects[i];
        if ('kind' in obj) continue;   // mesh: rejected elsewhere
        const type = obj.type;
        const params = (obj.parameters ?? {}) as Record<string, unknown>;
        const desc = type !== undefined ? PRIMITIVES[type] : undefined;
        // Unimplemented types/unhonorable pins are diagnosed above / by the Planner.
        if (!desc || resolveBackend(type, obj.backend) === undefined) continue;
        const schema = desc.params;
        const known = new Map(schema.map((s) => [s.name, s]));
        for (const key of Object.keys(params)) {
            if (!known.has(key)) {
                bag.warning('invalid-setting',
                    `Object ${i} (${type}): unknown parameter '${key}' is ignored (valid: ${schema.map((s) => s.name).join(', ')})`)
                    .add();
            }
        }
        for (const s of schema) {
            const v = params[s.name];
            if (v === undefined) {
                if (s.required) {
                    bag.error('invalid-setting',
                        `Object ${i} (${type}): required parameter '${s.name}' is missing`)
                        .add();
                }
                continue;
            }
            const shapeOk = s.shape === 'number'
                ? typeof v === 'number' && Number.isFinite(v)
                : Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number' && Number.isFinite(c));
            if (!shapeOk) {
                bag.error('invalid-setting',
                    `Object ${i} (${type}): parameter '${s.name}' must be a ${s.shape === 'number' ? 'finite number' : 'vec3 of finite numbers'}`)
                    .add();
            } else {
                validatePrimitiveConstraint(s, v, `Object ${i} (${type}): parameter '${s.name}'`, bag);
            }
        }
    }

    // Warn on empty scene
    if (scene.objects.length === 0) {
        bag.warning('empty-scene', 'Scene has no objects — nothing will be rendered').add();
    }

    // Check for unsupported accumulation/tonemap types
    if (strategy.estimator.accumulation.type !== 'average'
        && strategy.estimator.accumulation.type !== 'variance'
        && strategy.estimator.accumulation.type !== 'oneshot') {
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
        if (!materialNames.has(obj.material)) {
            bag.error('missing-material', `Object ${i}: references unknown material '${obj.material}'`)
                .withOriginal('scene', [`objects[${i}]`, `material`])
                .suggest(`Available materials: ${[...materialNames].join(', ')}`)
                .add();
        }
    }

    // Placement validation (docs/fable-transforms.md §7 + §6.1). The Transform type is
    // the first validator (scalar scale, axis-angle|quat rotation), but authored JS
    // can hand us anything — every rule re-checks at runtime with a diagnostic.
    for (let i = 0; i < scene.objects.length; i++) {
        const obj = scene.objects[i];
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
        // RIGID there — driven scale would silently stale the CDF).
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

/** Constant nonzero emission — mirrors the Planner's sampleAsLight registry condition. */
function hasConstantNonzeroEmission(emission: unknown): boolean {
    if (typeof emission === 'number') return emission !== 0;
    if (Array.isArray(emission)) return emission.some((c) => typeof c === 'number' && c !== 0);
    return false;   // absent, param-driven, or GLSL: not a v1 samplable emitter
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
        bag.warning('invalid-transform',
            `Object ${index}: transform.scale ${scale} is extreme — world-space epsilons `
            + `(EPSILON, MARCH_EPSILON, EPS_INTERFACE) are fixed; consider rescaling the scene`)
            .withOriginal('scene', at).add();
    }
}

function validatePrimitiveConstraint(
    schema: PrimitiveParamSpec,
    value: unknown,
    label: string,
    bag: DiagnosticBag,
): void {
    const constraint = schema.constraint;
    if (constraint === undefined) return;
    if (constraint.kind === 'positive' && (value as number) <= 0) {
        bag.error('invalid-setting', `${label} must be > 0`).add();
    } else if (constraint.kind === 'positive-components' && (value as number[]).some((v) => v <= 0)) {
        bag.error('invalid-setting', `${label} components must be > 0`).add();
    } else if (constraint.kind === 'min-length' && Math.hypot(...value as number[]) < constraint.value) {
        bag.error('invalid-setting', `${label} length must be >= ${constraint.value}`).add();
    }
}

// ============================================================================
// Helpers (audit-hardening H1)
// ============================================================================

function quadCrossSq(e1: Vec3, e2: Vec3): number {
    const [ax, ay, az] = e1;
    const [bx, by, bz] = e2;
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    return cx * cx + cy * cy + cz * cz;
}

function isVec3(v: unknown): v is Vec3 {
    return Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number');
}

/** Recursive {param} path collector — mirrors validateFinite's walk so future
 *  Value<> fields are covered without a per-field list. */
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
