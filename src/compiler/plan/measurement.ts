// compiler/plan/measurement.ts
// The resolved measurement section (fable-strategy-taxonomy §2, §4): the authored fields with
// every default applied. The Planner records it in ProgramDescription.measurement, and the App
// writes it into export stamps, so a render's truncations are stated even where the author
// left them at their defaults.

import { COLOR_MODELS } from '../../components/color/index.js';
import { DEFAULT_PIXEL_MODEL } from '../../components/pixel/index.js';
import type { SceneDescription, RenderStrategy } from '../types.js';
import type { ProgramDescription } from './types.js';

/** Default for measurement.maxNullCrossings: paths may cross at most this many null interfaces. */
export const DEFAULT_MAX_NULL_CROSSINGS = 32;

export function resolveMeasurement(scene: SceneDescription, strategy: RenderStrategy): ProgramDescription['measurement'] {
    const m = strategy.measurement;
    return {
        // Straight-through: unregistered camera types are Validator-rejected upstream
        // (reject-not-remove), so the Planner never coerces — CameraDesc mirrors the
        // strategy's CameraDescription exactly.
        camera: m.camera,
        // Ambient space rides the SCENE (the geometry-of-space is part of the integral's
        // domain); non-registry types are Validator-rejected upstream.
        ambient: scene.ambientSpace?.type ?? 'euclidean',
        response: m.response ?? 'radiance',
        maxBounces: m.maxBounces,
        maxNullCrossings: m.maxNullCrossings ?? DEFAULT_MAX_NULL_CROSSINGS,
        scattering: m.scattering ?? 'full',
        microfacet: m.microfacet ?? 'single-scattering',
        shadows: m.shadows ?? 'opaque-dielectrics',
        color: m.color ?? 'rgb',
        sensor: m.sensor ?? COLOR_MODELS[m.color ?? 'rgb'].defaultSensor,
        pixel: m.pixel ?? DEFAULT_PIXEL_MODEL,
        ...(COLOR_MODELS[m.color ?? 'rgb'].version ? { colorModelVersion: COLOR_MODELS[m.color ?? 'rgb'].version } : {}),
        // Omitted when there are none, so stamps and programs without AOVs are unchanged.
        ...(m.aovs !== undefined && m.aovs.length > 0 ? { aovs: [...m.aovs] } : {}),
        // Present only when authored, so programs and stamps without them are unchanged; the
        // emitted far clip is farClipOf(ambient, farClip) (components/ambient).
        ...(m.farClip !== undefined ? { farClip: m.farClip } : {}),
        ...(scene.ambientSpace?.quotient !== undefined ? { quotient: scene.ambientSpace.quotient } : {}),
    };
}
