// compiler/plan/Planner.ts

import type { SceneDescription, RenderStrategy, SDFObject, StandardSDF, MaterialModel, Vec3, MaterialProperty, GlslExpression } from '../types.js';
import { isGlslExpression } from '../types.js';
import type { SceneFeatures } from '../analyze/types.js';
import type { RenderPlan, PlannedSDFObject, PlannedMaterial, PlannedLight, ProgramDescription, PlannedPipeline } from './types.js';

export function plan(features: SceneFeatures, scene: SceneDescription, strategy: RenderStrategy): RenderPlan {
    // --- Assign material IDs (sorted for deterministic ordering) ---
    const materials: PlannedMaterial[] = [];
    let materialIndex = 0;
    const sortedMaterials = Object.entries(scene.materials).sort(([a], [b]) => a.localeCompare(b));
    for (const [name, mat] of sortedMaterials) {
        materials.push({
            id: materialIndex++,
            name,
            model: mat.model,
            albedo: resolveColorProperty(mat.albedo, [0.8, 0.8, 0.8]),
            emission: resolveColorProperty(mat.emission, [0.0, 0.0, 0.0]),
            roughness: resolveScalarProperty(mat.roughness, 1.0),
        });
    }

    // Build name→id lookup for objects
    const materialIdMap = new Map<string, number>();
    for (const m of materials) {
        materialIdMap.set(m.name, m.id);
    }

    // --- Assign SDF objects ---
    const objects: PlannedSDFObject[] = [];
    let objectIndex = 0;
    for (const obj of scene.objects) {
        if (obj.kind !== 'sdf') continue;
        const sdfObj = obj as SDFObject;
        const sdf = sdfObj.sdf as StandardSDF;

        // Material reference already validated by Validator
        const matId = materialIdMap.get(sdfObj.material)!;

        // Fold center parameter into translation to avoid double-offset.
        // The generated per-object wrapper handles all positioning via translation,
        // and the SDF call is always origin-centered.
        const { parameters, translation } = resolveSDFPositioning(sdf, sdfObj.transform?.position);

        objects.push({
            index: objectIndex++,
            materialId: matId,
            sdfType: sdf.type,
            parameters,
            translation,
        });
    }

    // --- Assign lights ---
    const lights: PlannedLight[] = [];
    let lightIndex = 0;
    for (const light of scene.lights) {
        if (light.kind === 'point') {
            lights.push({
                id: lightIndex++,
                kind: 'point',
                position: light.position,
                intensity: light.intensity,
                color: light.color ?? [1.0, 1.0, 1.0] as Vec3,
            });
        }
    }

    // --- Build program description ---
    const program = planProgram(features, strategy);
    const pipeline = planPipeline(program);

    return {
        features,
        objects,
        materials,
        lights,
        program,
        pipeline,
    };
}

// ============================================================================
// Program description — what the generated program does
// ============================================================================

function planProgram(features: SceneFeatures, strategy: RenderStrategy): ProgramDescription {
    const brdfModels: MaterialModel[] = [];
    if (features.materials.hasLambert) brdfModels.push('lambert');
    if (features.materials.hasDisney) brdfModels.push('disney');
    if (features.materials.hasDielectric) brdfModels.push('dielectric');
    if (features.materials.hasEmissive) brdfModels.push('emissive');

    const hasLights = features.lighting.totalLightCount > 0;
    const wantsNEE = strategy.transport.directLighting !== 'none' && hasLights;

    return {
        intersection: { method: 'raymarch' },
        materials: { models: brdfModels },
        lighting: wantsNEE ? { method: 'nee' } : null,
        camera: strategy.camera.type === 'pinhole'
            ? { type: 'pinhole', fov: strategy.camera.fov }
            : { type: 'pinhole', fov: Math.PI / 4 }, // fallback, validator catches unsupported
        transport: {
            type: 'pathtracer',
            maxBounces: strategy.transport.maxBounces,
            russianRoulette: strategy.transport.russianRoulette.enabled
                ? { startDepth: strategy.transport.russianRoulette.startDepth }
                : null,
        },
        accumulation: strategy.accumulation.type === 'exponential'
            ? { type: 'exponential', alpha: strategy.accumulation.alpha }
            : { type: strategy.accumulation.type },
        tonemap: strategy.display.type === 'none'
            ? { type: 'none' }
            : { type: strategy.display.type, exposure: strategy.display.exposure },
    };
}

// ============================================================================
// Pipeline — derived from program description
// ============================================================================

function planPipeline(program: ProgramDescription): PlannedPipeline {
    // Currently all accumulation/tonemap types use the same 2-pass pipeline topology.
    // This will become conditional as more types are added (e.g., variance accumulation
    // may need additional framebuffers for moment tracking).
    void program;

    return {
        framebuffers: [
            { id: 'accumulation', type: 'double_buffer', format: 'rgba32f' },
            { id: 'screen', type: 'screen' },
        ],
        passes: [
            {
                role: 'pathtracer',
                inputs: { 'u_previous': 'accumulation_previous' },
                output: 'accumulation_current',
            },
            {
                role: 'display',
                inputs: { 'u_radiance': 'accumulation_current' },
                output: 'screen',
            },
        ],
        swaps: [{ buffers: ['accumulation'] }],
    };
}

/**
 * Fold any 'center' parameter from the SDF primitive into the translation vector.
 * This ensures the generated per-object wrapper handles all positioning, and the
 * SDF call is always origin-centered — preventing double-offset when both
 * parameters.center and transform.position are set.
 */
function resolveSDFPositioning(
    sdf: StandardSDF,
    transformPosition: Vec3 | undefined,
): { parameters: Record<string, number | number[]>; translation?: Vec3 } {
    const center = sdf.parameters.center as number[] | undefined;

    // Planes use normal+offset, not center — pass through unchanged
    if (!center || sdf.type === 'plane') {
        return {
            parameters: sdf.parameters,
            translation: transformPosition,
        };
    }

    // Merge center into translation, zero out center in parameters
    const tx = (transformPosition?.[0] ?? 0) + center[0];
    const ty = (transformPosition?.[1] ?? 0) + center[1];
    const tz = (transformPosition?.[2] ?? 0) + center[2];

    const parameters = { ...sdf.parameters, center: [0, 0, 0] };
    const translation: Vec3 = [tx, ty, tz];

    return { parameters, translation };
}

function resolveColorProperty(value: MaterialProperty | undefined, fallback: Vec3): Vec3 | GlslExpression {
    if (value === undefined) return fallback;
    if (isGlslExpression(value)) return value;
    if (typeof value === 'number') return [value, value, value] as Vec3;
    return value;
}

function resolveScalarProperty(value: MaterialProperty | undefined, fallback: number): number | GlslExpression {
    if (value === undefined) return fallback;
    if (isGlslExpression(value)) return value;
    if (typeof value === 'number') return value;
    // Vec3 passed for a scalar property — take first component (silent truncation)
    return value[0];
}
