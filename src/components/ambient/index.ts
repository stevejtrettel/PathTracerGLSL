// Ambient-space registry (measurement pick-one family — the geometry of the space the
// light lives in). An ambient occupant = one folder (types.glsl: the Point and Direction
// types; <type>.glsl: the ambient_* functions, MAX_DIST and fp_uncertainty — the contract
// is in README.md) + one line below.
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
}

export const AMBIENT_SPACES: Record<string, AmbientDescriptor> = {
    euclidean: { type: 'euclidean', typesGLSL: euclideanTypesGLSL, glsl: euclideanGLSL },
};
