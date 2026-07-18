// compiler/analyze/Analyzer.ts

import type { SceneDescription, MaterialProperty } from '../types.js';
import { isGlslExpression, isHeterogeneousMedium, isEmissiveMedium } from '../types.js';
import type { SceneFeatures } from './types.js';
import { PRIMITIVES, resolveBackend } from '../../components/geometry/index.js';
import { LIGHT_KINDS } from '../../components/lights/index.js';

/** A medium coefficient is "possibly nonzero" if it's a nonzero constant or {param}-driven
 *  (a live parameter can become nonzero at runtime, so the code path must exist). */
function mayBeNonzero(prop: MaterialProperty | undefined): boolean {
    if (prop === undefined) return false;
    if (typeof prop === 'number') return prop !== 0;
    if (Array.isArray(prop)) return prop.some((c) => c !== 0);
    return true; // {param} or GLSL expression — either can be nonzero at runtime
}

/** Nonzero CONSTANT only — {param}/expression are false (the v1 sampleAsLight restriction). */
function isConstantNonzero(prop: MaterialProperty | undefined): boolean {
    if (prop === undefined) return false;
    if (typeof prop === 'number') return prop !== 0;
    if (Array.isArray(prop)) return prop.some((c) => c !== 0);
    return false;
}

export function analyze(scene: SceneDescription): SceneFeatures {
    // --- Geometry ---
    let sdfCount = 0;
    let analyticCount = 0;
    let meshCount = 0;

    // Backend is RESOLVED, not authored (B1): analytic if the primitive provides it,
    // else sdf; per-object pins override. Unregistered types count nowhere — the
    // Planner diagnoses them.
    for (const obj of scene.objects) {
        if ('kind' in obj) { meshCount++; continue; }
        const backend = resolveBackend(obj.type, obj.backend);
        if (backend === 'sdf') sdfCount++;
        else if (backend === 'analytic') analyticCount++;
    }

    // --- Materials (no per-model registry-shadow flags — the Validator checks model
    // registration per material; 'none' is structural vocabulary, §3.6) ---
    let hasProcedural = false;

    // --- Media (§3.5/§3.6, fable-volumetric-component.md) ---
    let hasMedia = scene.ambientMedium !== undefined;
    let hasScatteringMedia = false;
    // ambientMedium is a material NAME — its medium block is censused by the loop below.
    let hasHeterogeneousMedia = false;
    let hasEmissiveMedia = false;
    let hasNullInterfaces = false;

    for (const mat of Object.values(scene.materials)) {
        if (mat.model === 'none') hasNullInterfaces = true;

        if (mat.medium !== undefined) {
            hasMedia = true;
            if (mayBeNonzero(mat.medium.sigma_s)) hasScatteringMedia = true;
            if (isHeterogeneousMedium(mat.medium)) hasHeterogeneousMedia = true;
            if (isEmissiveMedium(mat.medium)) hasEmissiveMedia = true;
        }

        // Check for procedural properties (GLSL expressions)
        for (const prop of [mat.albedo, mat.roughness, mat.ior, mat.emission]) {
            if (isGlslExpression(prop)) {
                hasProcedural = true;
                break;
            }
        }
    }

    // --- Lighting (census REGISTRY-DERIVED — the lights-door rule: adding a kind must
    // not touch this site; the descriptor's `delta` fact is the classification) ---
    let deltaLightCount = 0;
    let areaLightCount = 0;
    let unknownKindLightCount = 0;

    for (const light of scene.lights) {
        const d = LIGHT_KINDS[light.kind];
        if (d === undefined) unknownKindLightCount++;   // 'directional' (reserved) + typos — Validator rejects each
        else if (d.delta) deltaLightCount++;
        else areaLightCount++;
    }

    // §6.2 registry, sampleAsLight route: emissive analytic quad/sphere OBJECTS are samplable
    // (default true for those shapes). V1: CONSTANT nonzero emission only — param/procedural
    // emitters stay path-only under the default (explicit `true` on those is a Validator error).
    let samplableEmitterCount = 0;
    for (const obj of scene.objects) {
        if ('kind' in obj) continue;
        if (resolveBackend(obj.type, obj.backend) !== 'analytic') continue;
        if (PRIMITIVES[obj.type]?.samplableAsLight !== true) continue;
        const mat = scene.materials[obj.material];
        if (mat === undefined || mat.sampleAsLight === false) continue;
        if (isConstantNonzero(mat.emission)) samplableEmitterCount++;
    }

    // Unknown kinds COUNT here deliberately: totalLightCount is about authoring INTENT —
    // a scene whose only light is a typo'd/reserved kind should get the kind rejection,
    // not a misleading "scene has no lights" on top of it.
    const totalLightCount = deltaLightCount + areaLightCount + unknownKindLightCount + samplableEmitterCount;

    // --- Environment as a light (T3/T4, D6): tabulated kinds default TRUE, constant opt-in, none never.
    const env = scene.environment;
    let envSamplable = false;
    if (env?.type === 'image' || env?.type === 'procedural') {
        envSamplable = env.sampleAsLight !== false;
    } else if (env?.type === 'constant') {
        envSamplable = env.sampleAsLight === true
            && (env.intensity ?? 1) > 0
            && env.color.some((c) => c > 0);
    }

    return {
        ambientSpace: scene.ambientSpace.type,
        geometry: {
            hasSDFs: sdfCount > 0,
            hasAnalytic: analyticCount > 0,
            hasMeshes: meshCount > 0,
            sdfCount,
            analyticCount,
        },
        materials: {
            hasProcedural,
        },
        lighting: {
            deltaLightCount,
            areaLightCount,
            unknownKindLightCount,
            samplableEmitterCount,
            totalLightCount,
        },
        media: {
            hasMedia,
            hasScatteringMedia,
            hasHeterogeneousMedia,
            hasEmissiveMedia,
            hasNullInterfaces,
        },
        environment: {
            samplable: envSamplable,
        },
    };
}
