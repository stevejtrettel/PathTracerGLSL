// compiler/plan/Planner.ts

import type { SceneDescription, RenderStrategy, SDFObject, StandardSDF, AnalyticObject, StandardAnalytic, MaterialModel, Vec3, MaterialProperty, GlslExpression, ValueParam } from '../types.js';
import { isGlslExpression, isValueParam } from '../types.js';
import type { SceneFeatures } from '../analyze/types.js';
import { MATERIAL_MODELS } from '../../components/materials/index.js';
import type { DiagnosticBag } from '../../errors/core/DiagnosticBag.js';
import type { RenderPlan, PlannedSDFObject, PlannedAnalyticObject, PlannedMaterial, PlannedLight, ProgramDescription, PlannedPipeline } from './types.js';

/** SDF primitives the generator has arms for — anything else must diagnose here, not throw there. */
const IMPLEMENTED_SDF_TYPES = new Set<string>(['sphere', 'plane', 'box']);

export function plan(features: SceneFeatures, scene: SceneDescription, strategy: RenderStrategy, bag: DiagnosticBag): RenderPlan {
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
            roughness: resolveScalarProperty(mat.roughness, 0.5),   // matches ggx's schema default
            f0: resolveColorProperty(mat.f0, [0.9, 0.9, 0.9]),
            transmittance: resolveColorProperty(mat.transmittance, [1.0, 1.0, 1.0]),
            // Non-dielectrics default to 1.0 (vacuum-like): ior_of is only physically meaningful
            // for regions a transmitted ray can enter; opaque solids must not bend η ratios.
            ior: resolveScalarProperty(mat.ior, mat.model === 'dielectric' ? 1.5 : 1.0),
            medium: mat.medium === undefined ? null : {
                sigma_a: resolveColorProperty(mat.medium.sigma_a, [0.0, 0.0, 0.0]),
                sigma_s: resolveColorProperty(mat.medium.sigma_s, [0.0, 0.0, 0.0]),
                phase_g: resolveScalarProperty(mat.medium.phase_g, 0.0),
            },
        });
    }

    // Build name→id lookup for objects
    const materialIdMap = new Map<string, number>();
    for (const m of materials) {
        materialIdMap.set(m.name, m.id);
    }

    // --- Assign objects by geometry backend (SDF vs analytic) ---
    // `index` is assigned in scene order across BOTH backends: it is the globally-unique
    // region id (§2.3), so material_of() spans both lists and regions never collide.
    const objects: PlannedSDFObject[] = [];
    const analyticObjects: PlannedAnalyticObject[] = [];
    let objectIndex = 0;
    for (const obj of scene.objects) {
        if (obj.kind === 'sdf') {
            const sdfObj = obj as SDFObject;
            const sdf = sdfObj.sdf as StandardSDF;
            // Review C7 (partial): torus/capsule/custom exist in the type but have no generator
            // arm — a raw generator throw is not a diagnostic. Emit one here and skip the object.
            if (!IMPLEMENTED_SDF_TYPES.has(sdf.type)) {
                bag.error('missing-geometry',
                    `SDF primitive '${sdf.type}' is not implemented yet (available: ${[...IMPLEMENTED_SDF_TYPES].join(', ')})`)
                    .add();
                objectIndex++;   // keep region ids scene-order stable for the remaining objects
                continue;
            }
            const matId = materialIdMap.get(sdfObj.material)!;   // validated by Validator

            // Fold center parameter into translation to avoid double-offset. The generated
            // per-object wrapper handles positioning via translation; the SDF call is origin-centered.
            const { parameters, translation } = resolveSDFPositioning(sdf, sdfObj.transform?.position);

            objects.push({ index: objectIndex++, materialId: matId, sdfType: sdf.type, parameters, translation });
        } else if (obj.kind === 'analytic') {
            const anaObj = obj as AnalyticObject;
            const shape = anaObj.shape as StandardAnalytic;
            const matId = materialIdMap.get(anaObj.material)!;

            analyticObjects.push({
                index: objectIndex++,
                materialId: matId,
                shapeType: shape.type,
                parameters: shape.parameters,
            });
        }
        // mesh objects are not yet supported (deferred — see impl-plan-analytic-backend.md)
    }

    // --- Assign lights (the §6.2 samplable registry; order = light id = CDF order) ---
    const lights: PlannedLight[] = [];
    let lightIndex = 0;
    for (const light of scene.lights) {
        const color = ('color' in light ? light.color : undefined) ?? ([1.0, 1.0, 1.0] as Vec3);
        if (light.kind === 'point') {
            lights.push({
                id: lightIndex++,
                kind: 'point',
                position: light.position,
                intensity: light.intensity,
                color,
            });
        } else if (light.kind === 'quad' || light.kind === 'sphere') {
            // DESUGAR (§6.2): every hittable light is a region — synthesize the emissive
            // material + the analytic emitter object, then register the samplable entry.
            // Le = color·intensity, shared EXACTLY between the emission table and the sampler
            // (any mismatch makes pt and pt-nee converge to different images).
            const radiance: Vec3 = [color[0] * light.intensity, color[1] * light.intensity, color[2] * light.intensity];
            const matId = materialIndex++;
            materials.push({
                id: matId,
                name: `__light_${lightIndex}`,
                model: 'lambert',
                albedo: [0.0, 0.0, 0.0],
                emission: radiance,
                roughness: 1.0,
                f0: [0.9, 0.9, 0.9],
                transmittance: [1.0, 1.0, 1.0],
                ior: 1.0,
                medium: null,
            });
            const regionId = objectIndex++;
            if (light.kind === 'quad') {
                analyticObjects.push({
                    index: regionId,
                    materialId: matId,
                    shapeType: 'quad',
                    parameters: { corner: light.corner, edge1: light.edge1, edge2: light.edge2 },
                });
                lights.push({
                    id: lightIndex++, kind: 'quad', regionId,
                    corner: light.corner, edge1: light.edge1, edge2: light.edge2,
                    intensity: light.intensity, color,
                });
            } else {
                analyticObjects.push({
                    index: regionId,
                    materialId: matId,
                    shapeType: 'sphere',
                    parameters: { center: light.position, radius: light.radius },
                });
                lights.push({
                    id: lightIndex++, kind: 'sphere', regionId,
                    position: light.position, radius: light.radius,
                    intensity: light.intensity, color,
                });
            }
        }
        // directional: Validator-rejected; skipped here
    }

    // sampleAsLight route (§6.2): emissive analytic quad/sphere OBJECTS join the registry —
    // per REGION, so two objects sharing one emissive material become two lights. V1: constant
    // nonzero emission only (Analyzer/Validator enforce); Le read from the material constant.
    for (const planned of analyticObjects) {
        const mat = materials[planned.materialId];
        if (mat === undefined || mat.name.startsWith('__light_')) continue;   // synthesized: already registered
        if (planned.shapeType !== 'quad' && planned.shapeType !== 'sphere') continue;
        const sceneMat = scene.materials[mat.name];
        if (sceneMat === undefined || sceneMat.sampleAsLight === false) continue;
        if (!Array.isArray(mat.emission) || !mat.emission.some((c) => c !== 0)) continue;
        const Le = mat.emission as Vec3;
        // Registry stores color·intensity factored as (Le, 1.0) — samplers only consume the product.
        if (planned.shapeType === 'quad') {
            const p = planned.parameters;
            lights.push({
                id: lightIndex++, kind: 'quad', regionId: planned.index,
                corner: p.corner as Vec3, edge1: p.edge1 as Vec3, edge2: p.edge2 as Vec3,
                intensity: 1.0, color: Le,
            });
        } else {
            const p = planned.parameters;
            lights.push({
                id: lightIndex++, kind: 'sphere', regionId: planned.index,
                position: p.center as Vec3, radius: p.radius as number,
                intensity: 1.0, color: Le,
            });
        }
    }

    // --- Ambient medium (§2.4): material_of(-1) resolves to this id; -1 = vacuum ---
    const ambientMedium = scene.ambientMedium !== undefined
        ? materialIdMap.get(scene.ambientMedium) ?? -1   // unknown name already errored in the Validator
        : -1;

    // --- Build program description ---
    const program = planProgram(features, scene, strategy, lights);
    const pipeline = planPipeline(program);

    return {
        objects,
        analyticObjects,
        materials,
        lights,
        ambientMedium,
        program,
        pipeline,
    };
}

// ============================================================================
// Program description — what the generated program does
// ============================================================================

function planProgram(features: SceneFeatures, scene: SceneDescription, strategy: RenderStrategy, lights: PlannedLight[]): ProgramDescription {
    // Surface models only, REGISTRY-DRIVEN (the extension-cost rule: adding a model must not
    // touch this site). 'none' is a boundary classification (§3.6) and 'emissive' is
    // Validator-rejected (C4) — neither is a registry key, so both fall out of the filter.
    // Registry insertion order pins the dispatch order (deterministic snapshots).
    const present = new Set(Object.values(scene.materials).map((m) => m.model));
    // Desugared area lights synthesize lambert emitter materials — a lambert-free scene with a
    // quad light still needs the lambert arms (else the emitter dispatches to a wrong fallback).
    if (scene.lights.some((l) => l.kind === 'quad' || l.kind === 'sphere')) {
        present.add('lambert');
    }
    const brdfModels = (Object.keys(MATERIAL_MODELS) as MaterialModel[]).filter((m) => present.has(m));

    // A samplable environment is a light for NEE purposes (T3) — an env-only scene under
    // 'nee'/'mis' gets the lighting infrastructure with an env-only lighting_sample.
    const envSamplable = features.environment.samplable;
    const hasLights = features.lighting.totalLightCount > 0 || envSamplable;
    const wantsNEE = strategy.estimator.directLighting !== 'none' && hasLights;
    const lighting = wantsNEE
        ? {
              method: (strategy.estimator.directLighting === 'mis' ? 'mis' : 'nee') as 'mis' | 'nee',
              selection: strategy.estimator.lightSelection ?? 'power',
          }
        : null;

    // Taxonomy §8 (the volumeIntegrator split): whether scattering is COMPUTED is a
    // measurement truncation (scattering 'ignored' renders scattering media absorbing-only);
    // HOW live scattering is sampled is the estimator's volumeSampling axis. Only 'analytic'
    // survives the Validator.
    const scattering = strategy.measurement.scattering ?? 'full';
    const scatteringArms = features.media.hasScatteringMedia
        && scattering === 'full'
        && (strategy.estimator.volumeSampling ?? 'analytic') === 'analytic';

    // §6.2: samplable-emitter machinery exists iff some light entered the registry with a
    // region (delta-only scenes compile to the pre-area-light program).
    const samplableEmitters = lights.some((l) => l.regionId !== undefined);

    return {
        measurement: {
            camera: strategy.measurement.camera.type === 'pinhole'
                ? { type: 'pinhole', fov: strategy.measurement.camera.fov }
                : { type: 'pinhole', fov: Math.PI / 4 }, // fallback, validator catches unsupported
            response: strategy.measurement.response ?? 'radiance',
            maxBounces: strategy.measurement.maxBounces,
            scattering,
            shadows: strategy.measurement.shadows ?? 'opaque-dielectrics',
            color: 'rgb',   // 'spectral' is Validator-rejected (reserved, contracts §8)
        },
        estimator: {
            lighting,
            russianRoulette: strategy.estimator.russianRoulette,
            volumeSampling: scatteringArms ? 'analytic' : 'none',
            // Placement is a decision only where a medium NEE estimate exists at all.
            mediumLightSampling: lighting !== null && scatteringArms
                ? (strategy.estimator.mediumLightSampling ?? 'vertex')
                : 'vertex',
            envSampler: {
                chart: strategy.estimator.envSampler ?? 'equirect',
                compensation: strategy.estimator.envCompensation ?? false,
            },
            accumulation: strategy.estimator.accumulation.type === 'exponential'
                ? { type: 'exponential', alpha: strategy.estimator.accumulation.alpha }
                : { type: strategy.estimator.accumulation.type },
        },
        view: {
            tonemap: strategy.view.tonemap.type === 'none'
                ? { type: 'none' }
                : { type: strategy.view.tonemap.type, exposure: strategy.view.tonemap.exposure },
        },
        intersection: { method: 'raymarch' },
        materials: { models: brdfModels },
        media: {
            present: features.media.hasMedia,
            scatteringArms,
            nullInterfaces: features.media.hasNullInterfaces,
            shadowWalker: features.media.hasMedia && lighting !== null,
        },
        emitters: {
            samplable: samplableEmitters,
            lightingPdf: samplableEmitters && lighting?.method === 'mis',
        },
        environment: scene.environment ?? { type: 'none' },
        environmentSamplable: envSamplable,
    };
}

// ============================================================================
// Pipeline — derived from program description
// ============================================================================

function planPipeline(program: ProgramDescription): PlannedPipeline {
    // Variance accumulation adds a second-moment attachment to the SAME double_buffer
    // (MRT): mean and moment then ping-pong in lockstep by construction — one swap flips
    // both attachments, so they can never desynchronize. The display pass still reads
    // attachment 0 (the mean); the moment is instrumentation, exported via readBuffer.
    const variance = program.estimator.accumulation.type === 'variance';

    return {
        framebuffers: [
            variance
                ? { id: 'accumulation', type: 'double_buffer', format: ['rgba32f', 'rgba32f'] }
                : { id: 'accumulation', type: 'double_buffer', format: 'rgba32f' },
            { id: 'screen', type: 'screen' },
        ],
        passes: [
            {
                role: 'pathtracer',
                inputs: variance
                    ? { 'u_previous': 'accumulation_previous', 'u_previousMoment': 'accumulation_previous:1' }
                    : { 'u_previous': 'accumulation_previous' },
                output: variance
                    ? ['accumulation_current:0', 'accumulation_current:1']
                    : 'accumulation_current',
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
export function resolveSDFPositioning(
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

export function resolveColorProperty(value: MaterialProperty | undefined, fallback: Vec3): Vec3 | GlslExpression | ValueParam<Vec3> {
    if (value === undefined) return fallback;
    if (isGlslExpression(value)) return value;
    if (isValueParam(value)) return value as ValueParam<Vec3>;  // preserve — emitted as a uniform (§2.8)
    if (typeof value === 'number') return [value, value, value] as Vec3;
    return value;
}

export function resolveScalarProperty(value: MaterialProperty | undefined, fallback: number): number | GlslExpression | ValueParam<number> {
    if (value === undefined) return fallback;
    if (isGlslExpression(value)) return value;
    if (isValueParam(value)) return value as ValueParam<number>;  // preserve — emitted as a uniform (§2.8)
    if (typeof value === 'number') return value;
    // Vec3 passed for a scalar property — take first component (silent truncation)
    return value[0];
}
