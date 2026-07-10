// compiler/analyze/Validator.ts

import type { SceneFeatures } from './types.js';
import type { SceneDescription, RenderStrategy } from '../types.js';
import type { DiagnosticBag } from '../../errors/core/DiagnosticBag.js';

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

    if (strategy.transport.directLighting !== 'none' && features.lighting.totalLightCount === 0) {
        bag.error('incompatible-options',
            `Direct lighting '${strategy.transport.directLighting}' requested but scene has no lights`)
            .add();
    }

    // Check for unsupported material models
    if (features.materials.hasDisney) {
        bag.error('invalid-setting', "Material model 'disney' not yet supported").add();
    }
    if (features.materials.hasDielectric) {
        bag.error('invalid-setting', "Material model 'dielectric' not yet supported").add();
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
