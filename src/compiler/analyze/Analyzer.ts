// compiler/analyze/Analyzer.ts

import { emissionMayBeNonzero } from '../../components/color/values.js';
import type { SceneDescription } from '../types.js';
import { isEmissiveMedium, mediumMayScatter } from '../types.js';
import type { SceneFeatures } from './types.js';
import { samplableEmitterObjects } from '../plan/dataTenants.js';


/** Scattering is computed in this program: some medium may scatter and the measurement does
 *  not ignore scattering. The program then links the phase model of every medium. */
export function scatteringComputed(features: SceneFeatures, scattering: 'full' | 'ignored'): boolean {
    return features.media.hasScatteringMedia && scattering === 'full';
}

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
    // so the no-lights check never stacks on a per-light kind rejection) + every scene
    // object that becomes a samplable light (the one census, shared with the Validator
    // and the light roster).
    const totalLightCount = scene.lights.length + samplableEmitterObjects(scene).length;

    // --- Environment as a light (T3/T4, D6): tabulated kinds default TRUE, constant opt-in, none never.
    const env = scene.environment;
    let envSamplable = false;
    if (env?.type === 'image' || env?.type === 'procedural') {
        envSamplable = env.sampleAsLight !== false;
    } else if (env?.type === 'constant') {
        // color is now a SCENE_VALUE (SpectrumValue): a driven {param} color counts as
        // maybe-nonzero (the maybe-emitting rule); a constant is checked directly.
        const c = env.color;
        const colorMaybeNonzero = emissionMayBeNonzero(c);
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
