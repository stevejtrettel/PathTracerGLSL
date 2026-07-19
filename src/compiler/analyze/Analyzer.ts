// compiler/analyze/Analyzer.ts

import type { SceneDescription } from '../types.js';
import { isEmissiveMedium, isValueParam, isBlackbody, mediumMayScatter, hasConstantNonzeroEmission } from '../types.js';
import type { SceneFeatures } from './types.js';
import { PRIMITIVES, resolveBackend } from '../../components/geometry/index.js';


export function analyze(scene: SceneDescription): SceneFeatures {
    // --- Media (§3.5/§3.6, fable-volumetric-component.md) ---
    // (No geometry backend counts, per-model flags, or heterogeneous flag here — C4:
    // the census carries exactly what Validator/Planner read; routing predicates like
    // mediumRoutesToTracking are computed at their decision sites from shared types.ts
    // predicates, never mirrored as census fields.)
    let hasMedia = scene.ambientMedium !== undefined;
    let hasScatteringMedia = false;
    // ambientMedium is a material NAME — its medium block is censused by the loop below.
    let hasEmissiveMedia = false;
    let hasNullInterfaces = false;

    for (const mat of Object.values(scene.materials)) {
        if (mat.model === 'none') hasNullInterfaces = true;

        if (mat.medium !== undefined) {
            hasMedia = true;
            if (mediumMayScatter(mat.medium)) hasScatteringMedia = true;   // the ONE census predicate (types.ts)
            if (isEmissiveMedium(mat.medium)) hasEmissiveMedia = true;
        }
    }

    // --- Lighting: every AUTHORED light counts (registered or not — authoring INTENT,
    // so the no-lights check never stacks on a per-light kind rejection) + emissive
    // analytic samplable OBJECTS entering the registry via sampleAsLight (§6.2; V1:
    // CONSTANT nonzero emission only — the C3 shared predicate).
    let totalLightCount = scene.lights.length;
    for (const obj of scene.objects) {
        if ('kind' in obj) continue;
        if (resolveBackend(obj.type, obj.backend) !== 'analytic') continue;
        if (PRIMITIVES[obj.type]?.samplableAsLight !== true) continue;
        const mat = scene.materials[obj.material];
        if (mat === undefined || mat.sampleAsLight === false) continue;
        if (hasConstantNonzeroEmission(mat.emission)) totalLightCount++;   // C3: the ONE predicate
    }

    // --- Environment as a light (T3/T4, D6): tabulated kinds default TRUE, constant opt-in, none never.
    const env = scene.environment;
    let envSamplable = false;
    if (env?.type === 'image' || env?.type === 'procedural') {
        envSamplable = env.sampleAsLight !== false;
    } else if (env?.type === 'constant') {
        // color is now a SCENE_VALUE (SpectrumValue): a driven {param} color counts as
        // maybe-nonzero (the maybe-emitting rule); a constant is checked directly.
        const c = env.color;
        const colorMaybeNonzero = isValueParam(c) || isBlackbody(c) ? true
            : typeof c === 'number' ? c > 0 : c.some((ch) => ch > 0);
        envSamplable = env.sampleAsLight === true && (env.intensity ?? 1) > 0 && colorMaybeNonzero;
    }

    return {
        ambientSpace: scene.ambientSpace.type,
        geometry: {
            hasMeshes: scene.objects.some((o) => 'kind' in o),
        },
        lighting: {
            totalLightCount,
        },
        media: {
            hasMedia,
            hasScatteringMedia,
            hasEmissiveMedia,
            hasNullInterfaces,
        },
        environment: {
            samplable: envSamplable,
        },
    };
}
