// compiler/analyze/Validator.ts

import type { SceneFeatures } from './types.js';
import type { SceneDescription, RenderStrategy, Vec3 } from '../types.js';
import { isGlslExpression, isValueParam } from '../types.js';
import type { DiagnosticBag } from '../../errors/core/DiagnosticBag.js';

/** Minimum |edge1 × edge2| for quads (lights AND analytic objects) — near-zero areas make Inf pdfs. */
const MIN_QUAD_AREA = 1e-8;
/** HG anisotropy margin: |g| = 1 exactly is NaN in hg_sample/hg_eval. */
const MAX_PHASE_G = 0.99;
/** Models whose interaction_surface_emission dispatch reads mp.emission (the phantom-light rule). */
const EMITTING_MODELS = new Set<string>(['lambert']);

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

    if (strategy.transport.directLighting !== 'none'
        && features.lighting.totalLightCount === 0
        && !features.environment.samplable) {
        bag.error('incompatible-options',
            `Direct lighting '${strategy.transport.directLighting}' requested but scene has no lights (a samplable environment counts — image env, or constant with sampleAsLight: true)`)
            .add();
    }

    // --- Area lights (impl-plan-area-lights A0; thresholds hardened per the July 2026 audit) ---
    for (let i = 0; i < scene.lights.length; i++) {
        const light = scene.lights[i];
        if (light.kind === 'quad') {
            // Near-degenerate quads (area ~1e-20) pass an exact-zero test but produce Inf pdfs
            // in the sampler/lighting_pdf — require a real minimum area.
            if (quadCrossSq(light.edge1, light.edge2) < MIN_QUAD_AREA * MIN_QUAD_AREA) {
                bag.error('invalid-setting',
                    `Light ${i}: quad edges are parallel or near-parallel — area |edge1 × edge2| must be >= ${MIN_QUAD_AREA}`)
                    .add();
            }
        }
        if (light.kind === 'sphere' && light.radius <= 0) {
            bag.error('invalid-setting', `Light ${i}: sphere light radius must be > 0`).add();
        }
        // Negative radiance is non-physical: pt sees negative energy on every hit while the
        // power CDF floors at ~0 so NEE almost never samples it — the strategies diverge.
        if (light.intensity < 0) {
            bag.error('invalid-setting', `Light ${i}: intensity must be >= 0 (negative radiance diverges pt vs pt-nee)`).add();
        }
        const color = 'color' in light ? light.color : undefined;
        if (color !== undefined && color.some((c) => c < 0)) {
            bag.error('invalid-setting', `Light ${i}: color components must be >= 0`).add();
        }
    }

    // --- Analytic OBJECT degeneracy (audit C1): the light checks above never covered analytic
    // quad/sphere objects, which reach codegen where a zero cross product is NaN → a raw
    // formatter throw instead of a diagnostic (and near-zero areas make Inf pdfs if emissive).
    for (let i = 0; i < scene.objects.length; i++) {
        const obj = scene.objects[i];
        if (obj.kind !== 'analytic') continue;
        const shape = obj.shape;
        if (shape.type === 'quad') {
            const e1 = shape.parameters.edge1, e2 = shape.parameters.edge2;
            if (!isVec3(e1) || !isVec3(e2) || !isVec3(shape.parameters.corner)) {
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
        if (shape.type === 'sphere') {
            const r = shape.parameters.radius;
            if (typeof r !== 'number' || r <= 0) {
                bag.error('invalid-setting', `Object ${i}: analytic sphere radius must be a number > 0`)
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

    // sampleAsLight (§6.2 / V1-C2): explicit true demands an analytically samplable emitter —
    // an analytic quad/sphere object with CONSTANT nonzero emission. SDF emitters stay
    // path-only (they still glow; they converge slower — the honest open-question-#10 answer).
    for (const [name, mat] of Object.entries(scene.materials)) {
        if (mat.sampleAsLight !== true) continue;
        const analyticSamplable = scene.objects.some((o) =>
            o.kind === 'analytic' && (o.shape.type === 'quad' || o.shape.type === 'sphere') && o.material === name);
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
                o.kind === 'analytic' && (o.shape.type === 'quad' || o.shape.type === 'sphere') && o.material === name);
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

    const vi = strategy.transport.volumeIntegrator;
    if (vi === 'raymarch' || vi === 'delta-tracking' || vi === 'ratio-tracking') {
        bag.error('invalid-setting',
            `volumeIntegrator '${vi}' not yet supported — homogeneous media (V1-C1) are exact under 'analytic' (closed-form sampling); 'raymarch' is reserved for biased marching and the null-collision pair needs majorants`)
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
    }

    // Warn on empty scene
    if (scene.objects.length === 0) {
        bag.warning('empty-scene', 'Scene has no objects — nothing will be rendered').add();
    }

    // Check for unsupported accumulation/display types
    if (strategy.accumulation.type !== 'average') {
        bag.error('invalid-setting',
            `Accumulation type '${strategy.accumulation.type}' not yet supported`)
            .add();
    }
    if (strategy.display.type !== 'reinhard' && strategy.display.type !== 'none') {
        bag.error('invalid-setting',
            `Display/tonemap type '${strategy.display.type}' not yet supported`)
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

    // Check for unsupported transform features
    for (let i = 0; i < scene.objects.length; i++) {
        const obj = scene.objects[i];
        if (obj.transform?.rotation) {
            bag.error('invalid-transform', `Object ${i}: rotation transforms not yet supported`)
                .withOriginal('scene', [`objects[${i}]`, `transform.rotation`])
                .add();
        }
        if (obj.transform?.scale) {
            bag.error('invalid-transform', `Object ${i}: scale transforms not yet supported`)
                .withOriginal('scene', [`objects[${i}]`, `transform.scale`])
                .add();
        }
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
