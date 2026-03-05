// compiler/plan/Planner.ts

import type { SceneDescription, RenderStrategy, SDFObject, StandardSDF, MaterialModel } from '../types.js';
import type { SceneFeatures } from '../analyze/types.js';
import type { RenderPlan, PlannedSDFObject, PlannedMaterial, PlannedLight, PlannedUniform } from './types.js';

export function plan(features: SceneFeatures, scene: SceneDescription, strategy: RenderStrategy): RenderPlan {
    // --- Assign material IDs ---
    const materials: PlannedMaterial[] = [];
    let materialIndex = 0;
    for (const [name, mat] of scene.materials) {
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

        const matId = materialIdMap.get(sdfObj.material);
        if (matId === undefined) {
            throw new Error(`Planner: object references unknown material '${sdfObj.material}'`);
        }

        objects.push({
            index: objectIndex++,
            materialId: matId,
            sdfType: sdf.type,
            parameters: sdf.parameters,
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
                color: light.color ?? [1.0, 1.0, 1.0],
            });
        }
    }

    // --- Decide what code to emit ---
    const brdfModels = new Set<MaterialModel>(features.materials.models);
    const emitNEE = strategy.transport.directLighting !== 'none' && features.lighting.totalLightCount > 0;
    const emitRussianRoulette = strategy.transport.russianRoulette.enabled;
    const russianRouletteStartDepth = strategy.transport.russianRoulette.startDepth;
    const maxBounces = strategy.transport.maxBounces;
    const unrollSDFDispatch = objects.length <= 8;

    // --- Uniforms ---
    const uniforms: PlannedUniform[] = [
        { name: 'u_resolution', type: 'vec2', parameterPath: 'engine.resolution' },
        { name: 'u_sampleCount', type: 'int', parameterPath: 'engine.sampleCount' },
        { name: 'u_frameIndex', type: 'int', parameterPath: 'engine.frameIndex' },
        { name: 'u_time', type: 'float', parameterPath: 'engine.time' },
        { name: 'u_pixelOffset', type: 'vec2', parameterPath: 'engine.pixelOffset', default: [0, 0] },
        { name: 'u_imageSize', type: 'vec2', parameterPath: 'engine.imageSize' },
        { name: 'u_cameraPosition', type: 'vec3', parameterPath: 'camera.position', default: [0, 0, 8] },
        { name: 'u_cameraTarget', type: 'vec3', parameterPath: 'camera.target', default: [0, 0, 0] },
    ];

    return {
        features,
        objects,
        materials,
        lights,
        brdfModels,
        emitNEE,
        emitRussianRoulette,
        russianRouletteStartDepth,
        maxBounces,
        unrollSDFDispatch,
        uniforms,
    };
}

function resolveColorProperty(value: number | number[] | string | undefined, fallback: number[]): number[] | string {
    if (value === undefined) return fallback;
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return [value, value, value];
    return value;
}

function resolveScalarProperty(value: number | number[] | string | undefined, fallback: number): number | string {
    if (value === undefined) return fallback;
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return value;
    return value[0];
}
