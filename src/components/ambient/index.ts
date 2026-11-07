// Ambient-space registry (the scene's pick-one family — the geometry of the space the light
// lives in; the scene's `ambientSpace.type` names the occupant). An ambient occupant = one
// folder (types.glsl: the Point and Direction types; <type>.glsl: the ambient_* functions,
// MAX_DIST and fp_uncertainty — the contract is in README.md) + one line below. A curved
// occupant also supplies its CPU geometry (<type>.ts, the CurvedGeometry of isometry.ts).
//
// Descriptors declare FACTS about one space; composition (where the blocks land in the
// program) stays in generate/features/core.ts. Origins are DERIVED from the key
// (components/ambient/<type>/types.glsl and <type>.glsl — the path convention is the one truth).

import euclideanTypesGLSL from './euclidean/types.glsl?raw';
import euclideanGLSL from './euclidean/euclidean.glsl?raw';
import hyperbolicTypesGLSL from './hyperbolic/types.glsl?raw';
import hyperbolicGLSL from './hyperbolic/hyperbolic.glsl?raw';
import { hyperbolicGeometry } from './hyperbolic/hyperbolic.js';
import sphericalTypesGLSL from './spherical/types.glsl?raw';
import sphericalGLSL from './spherical/spherical.glsl?raw';
import { sphericalGeometry } from './spherical/spherical.js';
import type { CurvedGeometry } from './isometry.js';

export interface AmbientDescriptor {
    /** Registry key — `scene.ambientSpace.type` (Validator-gated against this registry). */
    type: string;
    /** ?raw source defining `Point` and `Direction`, included right after the color model's types. */
    typesGLSL: string;
    /** ?raw source providing the ambient_* contract surface (trace-loop-contract). */
    glsl: string;
    /** Present exactly for a curved space: points are 4-vectors (`Point`/`Direction` are vec4),
     *  objects are placed by isometries (a mat4 each) and authored points mean exp_o(v). This is
     *  its CPU geometry. Absent for Euclidean space, whose points are vec3 and whose placements
     *  are similarities folded into the shapes' parameters. */
    curved?: CurvedGeometry;
}

export const AMBIENT_SPACES: Record<string, AmbientDescriptor> = {
    euclidean: { type: 'euclidean', typesGLSL: euclideanTypesGLSL, glsl: euclideanGLSL },
    hyperbolic: { type: 'hyperbolic', typesGLSL: hyperbolicTypesGLSL, glsl: hyperbolicGLSL, curved: hyperbolicGeometry },
    spherical: { type: 'spherical', typesGLSL: sphericalTypesGLSL, glsl: sphericalGLSL, curved: sphericalGeometry },
};

/** The CPU geometry of `space` when it is curved, else undefined (Euclidean, or unregistered —
 *  the Validator rejects the latter). */
export function curvedGeometryOf(space: string): CurvedGeometry | undefined {
    return AMBIENT_SPACES[space]?.curved;
}
