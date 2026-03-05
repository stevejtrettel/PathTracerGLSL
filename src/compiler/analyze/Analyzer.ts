// compiler/analyze/Analyzer.ts

import type { SceneDescription, RenderStrategy, MaterialModel } from '../types.js';
import type { SceneFeatures } from './types.js';

export function analyze(scene: SceneDescription, strategy: RenderStrategy): SceneFeatures {
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
    const models = new Set<MaterialModel>();
    let hasEmissive = false;
    let hasDielectrics = false;
    let hasProcedural = false;

    for (const [, mat] of scene.materials) {
        models.add(mat.model);
        if (mat.model === 'emissive') hasEmissive = true;
        if (mat.model === 'dielectric') hasDielectrics = true;

        // Check for procedural properties (GLSL string expressions)
        for (const prop of [mat.albedo, mat.roughness, mat.metallic, mat.ior, mat.emission]) {
            if (typeof prop === 'string') {
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
    const needsMIS = strategy.transport.directLighting === 'mis' && totalLightCount > 1;

    // --- Validation ---
    if (strategy.transport.directLighting === 'mis' && totalLightCount === 0) {
        throw new Error('Compiler: MIS requested but scene has no lights');
    }

    if (scene.ambientSpace.type !== 'euclidean') {
        throw new Error(`Compiler: ambient space '${scene.ambientSpace.type}' not yet supported`);
    }

    if (meshCount > 0) {
        throw new Error('Compiler: mesh objects not yet supported');
    }

    if (analyticCount > 0) {
        throw new Error('Compiler: analytic objects not yet supported');
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
            models,
            hasEmissive,
            hasDielectrics,
            hasProcedural,
        },
        lighting: {
            pointLightCount,
            directionalLightCount,
            totalLightCount,
            needsMIS,
        },
        strategy: {
            transport: strategy.transport,
            camera: strategy.camera,
            accumulation: strategy.accumulation,
            display: strategy.display,
        },
    };
}
