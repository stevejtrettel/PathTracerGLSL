// compiler/analyze/Validator.ts

import type { SceneFeatures } from './types.js';
import type { SceneDescription, RenderStrategy } from '../types.js';
import { isGlslExpression } from '../types.js';
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
