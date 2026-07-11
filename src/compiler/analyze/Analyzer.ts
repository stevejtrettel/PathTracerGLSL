// compiler/analyze/Analyzer.ts

import type { SceneDescription, MaterialProperty } from '../types.js';
import { isGlslExpression } from '../types.js';
import type { SceneFeatures } from './types.js';

/** A medium coefficient is "possibly nonzero" if it's a nonzero constant or {param}-driven
 *  (a live parameter can become nonzero at runtime, so the code path must exist). */
function mayBeNonzero(prop: MaterialProperty | undefined): boolean {
    if (prop === undefined) return false;
    if (typeof prop === 'number') return prop !== 0;
    if (Array.isArray(prop)) return prop.some((c) => c !== 0);
    return true; // {param} or GLSL expression (the latter is rejected by the Validator)
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

    for (const obj of scene.objects) {
        switch (obj.kind) {
            case 'sdf': sdfCount++; break;
            case 'analytic': analyticCount++; break;
            case 'mesh': meshCount++; break;
        }
    }

    // --- Materials ---
    let hasLambert = false;
    let hasDisney = false;
    let hasDielectric = false;
    let hasEmissive = false;
    let hasProcedural = false;

    // --- Media (§3.5/§3.6, fable-volumetric-component.md) ---
    let hasMedia = scene.ambientMedium !== undefined;
    let hasScatteringMedia = false;
    let hasNullInterfaces = false;

    for (const mat of Object.values(scene.materials)) {
        if (mat.model === 'lambert') hasLambert = true;
        if (mat.model === 'disney') hasDisney = true;
        if (mat.model === 'dielectric') hasDielectric = true;
        if (mat.model === 'emissive') hasEmissive = true;
        if (mat.model === 'none') hasNullInterfaces = true;

        if (mat.medium !== undefined) {
            hasMedia = true;
            if (mayBeNonzero(mat.medium.sigma_s)) hasScatteringMedia = true;
        }

        // Check for procedural properties (GLSL expressions)
        for (const prop of [mat.albedo, mat.roughness, mat.ior, mat.emission]) {
            if (isGlslExpression(prop)) {
                hasProcedural = true;
                break;
            }
        }
    }

    // --- Lighting ---
    let pointLightCount = 0;
    let directionalLightCount = 0;
    let areaLightCount = 0;

    for (const light of scene.lights) {
        switch (light.kind) {
            case 'point': pointLightCount++; break;
            case 'directional': directionalLightCount++; break;
            case 'quad': areaLightCount++; break;
            case 'sphere': areaLightCount++; break;
        }
    }

    // §6.2 registry, sampleAsLight route: emissive analytic quad/sphere OBJECTS are samplable
    // (default true for those shapes). V1: CONSTANT nonzero emission only — param/procedural
    // emitters stay path-only under the default (explicit `true` on those is a Validator error).
    let samplableEmitterCount = 0;
    for (const obj of scene.objects) {
        if (obj.kind !== 'analytic') continue;
        if (obj.shape.type !== 'quad' && obj.shape.type !== 'sphere') continue;
        const mat = scene.materials[obj.material];
        if (mat === undefined || mat.sampleAsLight === false) continue;
        if (isConstantNonzero(mat.emission)) samplableEmitterCount++;
    }

    const totalLightCount = pointLightCount + directionalLightCount + areaLightCount + samplableEmitterCount;

    // --- Environment as a light (T3, D6): image default TRUE, constant opt-in, none/procedural never.
    const env = scene.environment;
    let envSamplable = false;
    if (env?.type === 'image') {
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
            hasLambert,
            hasDisney,
            hasDielectric,
            hasEmissive,
            hasProcedural,
        },
        lighting: {
            pointLightCount,
            directionalLightCount,
            areaLightCount,
            samplableEmitterCount,
            totalLightCount,
        },
        media: {
            hasMedia,
            hasScatteringMedia,
            hasNullInterfaces,
        },
        environment: {
            samplable: envSamplable,
        },
    };
}
