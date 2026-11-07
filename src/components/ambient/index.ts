// Ambient-space registry (the scene's pick-one family — the geometry of the space the light
// lives in; the scene's `ambientSpace.type` names the occupant). An ambient occupant = one
// folder (types.glsl: the Point and Direction types; <type>.glsl: the ambient_* functions and
// fp_uncertainty — the contract is in README.md) + one line below. Its default far clip is the
// descriptor's `farClip`, which core.ts emits as MAX_DIST. A curved occupant also supplies its
// CPU geometry (<type>.ts, the CurvedGeometry of isometry.ts).
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
    /** The space's default far clip (an arc length): nothing beyond it is geometry, and the
     *  environment is found there, by missed BSDF rays and by environment NEE alike. Emitted as
     *  `MAX_DIST` unless the measurement authors `farClip`. */
    farClip: number;
    /** Present exactly for a curved space: points are 4-vectors (`Point`/`Direction` are vec4),
     *  objects are placed by isometries (a mat4 each) and authored points mean exp_o(v). This is
     *  its CPU geometry. Absent for Euclidean space, whose points are vec3 and whose placements
     *  are similarities folded into the shapes' parameters. */
    curved?: CurvedGeometry;
}

export const AMBIENT_SPACES: Record<string, AmbientDescriptor> = {
    // 1000 is an absolute length, so it is a scene-scale truncation: geometry or an ambient
    // medium extending past 1000 units is cut.
    euclidean: { type: 'euclidean', typesGLSL: euclideanTypesGLSL, glsl: euclideanGLSL, farClip: 1000 },
    // 10 is an arc length: float32 cosh overflows near 89, and with the scene inside the working
    // radius the clip cuts only sub-pixel bands (hyperbolic/hyperbolic.md).
    hyperbolic: { type: 'hyperbolic', typesGLSL: hyperbolicTypesGLSL, glsl: hyperbolicGLSL, farClip: 10, curved: hyperbolicGeometry },
    // 2π is exact rather than a clip: every geodesic closes after 2π, so the first hit in
    // (0, 2π) is the first hit (spherical/spherical.md).
    spherical: { type: 'spherical', typesGLSL: sphericalTypesGLSL, glsl: sphericalGLSL, farClip: 2 * Math.PI, curved: sphericalGeometry },
};

/** The far clip a program uses (its `MAX_DIST`): the authored measurement.farClip, else the
 *  space's default. Throws on an unregistered space (the Validator rejects it upstream). */
export function farClipOf(ambient: string, authored: number | undefined): number {
    const d = AMBIENT_SPACES[ambient];
    if (d === undefined) throw new Error(`ambient space '${ambient}' has no occupant (Validator should have rejected it)`);
    return authored ?? d.farClip;
}

/** The CPU geometry of `space` when it is curved, else undefined (Euclidean, or unregistered —
 *  the Validator rejects the latter). */
export function curvedGeometryOf(space: string): CurvedGeometry | undefined {
    return AMBIENT_SPACES[space]?.curved;
}
