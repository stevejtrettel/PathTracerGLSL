// Ambient-space registry (measurement pick-one family — the GEOMETRY-of-space axis,
// the non-Euclidean seam). An ambient occupant = one folder (the ambient_* contract
// GLSL: ambient_geodesic / ambient_frame / ambient_dot / ambient_parallel_transport /
// ambient_direction_to)
// + one line below (D3: the door exists BEFORE the first curved-space occupant, so
// H³/Nil/Schwarzschild walk through a finished front door — the GGX lesson).
//
// Descriptors declare FACTS about one space; composition (where the block lands in the
// program) stays in generate/features/core.ts. Origin is DERIVED from the key
// (components/ambient/<type>/<type>.glsl — the path convention is the one truth).

import euclideanGLSL from './euclidean/euclidean.glsl?raw';

export interface AmbientDescriptor {
    /** Registry key — `scene.ambientSpace.type` (Validator-gated against this registry). */
    type: string;
    /** ?raw source providing the ambient_* contract surface (trace-loop-contract). */
    glsl: string;
}

export const AMBIENT_SPACES: Record<string, AmbientDescriptor> = {
    euclidean: { type: 'euclidean', glsl: euclideanGLSL },
};
