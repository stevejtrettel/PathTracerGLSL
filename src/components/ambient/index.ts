// Ambient-space registry (measurement pick-one family — the geometry of the space the
// light lives in). An ambient occupant = one folder (types.glsl: the Point and Direction
// types; <type>.glsl: the ambient_* functions and fp_uncertainty — the contract is in
// README.md) + one line below.
//
// Descriptors declare FACTS about one space; composition (where the blocks land in the
// program) stays in generate/features/core.ts. Origins are DERIVED from the key
// (components/ambient/<type>/types.glsl and <type>.glsl — the path convention is the one truth).

import euclideanTypesGLSL from './euclidean/types.glsl?raw';
import euclideanGLSL from './euclidean/euclidean.glsl?raw';

export interface AmbientDescriptor {
    /** Registry key — `scene.ambientSpace.type` (Validator-gated against this registry). */
    type: string;
    /** ?raw source defining `Point` and `Direction`, included right after the color model's types. */
    typesGLSL: string;
    /** ?raw source providing the ambient_* contract surface (trace-loop-contract). */
    glsl: string;
    /** The space's default far clip (an arc length): nothing beyond it is geometry, and the
     *  environment is found there, by missed BSDF rays and by environment NEE alike. Emitted as
     *  `MAX_DIST` unless the measurement authors `farClip`. */
    farClip: number;
}

export const AMBIENT_SPACES: Record<string, AmbientDescriptor> = {
    // 1000 is an absolute length, so it is a scene-scale truncation: geometry or an ambient
    // medium extending past 1000 units is cut.
    euclidean: { type: 'euclidean', typesGLSL: euclideanTypesGLSL, glsl: euclideanGLSL, farClip: 1000 },
};

/** The far clip a program uses (its `MAX_DIST`): the authored measurement.farClip, else the
 *  space's default. Throws on an unregistered space (the Validator rejects it upstream). */
export function farClipOf(ambient: string, authored: number | undefined): number {
    const d = AMBIENT_SPACES[ambient];
    if (d === undefined) throw new Error(`ambient space '${ambient}' has no occupant (Validator should have rejected it)`);
    return authored ?? d.farClip;
}
