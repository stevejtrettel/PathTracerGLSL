// compiler/analyze/Analyzer.ts

import type { SceneDescription } from '../types.js';
import { isGlslExpression } from '../types.js';
import type { SceneFeatures } from './types.js';

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

    for (const mat of Object.values(scene.materials)) {
        if (mat.model === 'lambert') hasLambert = true;
        if (mat.model === 'disney') hasDisney = true;
        if (mat.model === 'dielectric') hasDielectric = true;
        if (mat.model === 'emissive') hasEmissive = true;

        // Check for procedural properties (GLSL expressions)
        for (const prop of [mat.albedo, mat.roughness, mat.metallic, mat.ior, mat.emission]) {
            if (isGlslExpression(prop)) {
                hasProcedural = true;
                break;
            }
        }
    }

    // --- Lighting ---
    let pointLightCount = 0;
    let directionalLightCount = 0;

    for (const light of scene.lights) {
        switch (light.kind) {
            case 'point': pointLightCount++; break;
            case 'directional': directionalLightCount++; break;
        }
    }

    const totalLightCount = pointLightCount + directionalLightCount;

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
            totalLightCount,
        },
    };
}
