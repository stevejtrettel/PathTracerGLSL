// Quotient registry (scene pick-at-most-one family — the group Γ of a closed manifold
// M = X/Γ, a property of the scene's ambient space). An occupant = one folder (<kind>.ts: the
// descriptor; <kind>.glsl: the static group math, the contract in README.md) + one line below.
// The walks across the fundamental domain's faces and the image-aware NEE/MIS wrappers are
// generated (generate/features/intersection.ts, lighting.ts) over these functions.

import type { QuotientDescription } from '../../compiler/types.js';
import type { Vec4 } from '../ambient/isometry.js';
import { TORUS } from './torus/torus.js';
import { SEIFERT_WEBER } from './seifert-weber/seifert-weber.js';

export interface QuotientDescriptor {
    /** Registry key — `scene.ambientSpace.quotient.kind`. */
    kind: string;
    /** The ambient space (AMBIENT_SPACES key) the group acts on. */
    space: string;
    /** ?raw source providing quotient_image_index, quotient_image_query, quotient_image_direction
     *  and the walk's helpers, included whole after the ambient occupant. */
    glsl: string;
    /** |S|: the number of images in the NEE image table. */
    imageCount: number;
    /** The least far clip: every image in the NEE table must lie within it of every point of D,
     *  so that a BSDF ray can reach every image NEE samples. `formula` names it in messages. */
    farClipFloor(q: QuotientDescription): { value: number; formula: string };
    /** The occupant's defines for one program (the group's constants, the walk's loop bound). */
    defines(q: QuotientDescription, farClip: number): Record<string, string>;
    /** GLSL const declarations emitted just before the occupant's block (tables a define cannot
     *  hold), when it has any. */
    constants?(q: QuotientDescription): string;
    /** Whether a homogeneous ambient fog is supported: the walk carries no medium state, and the
     *  transport loop reduces medium event points into D with quotient_reduce. */
    ambientFog: boolean;
    /** Present for a group acting on a curved space (whose objects are placed by isometries):
     *  whether the geodesic ball of `radius` about `center` lies inside D. The Validator's
     *  placement rule for such a group; a torus checks world boxes instead. */
    ballInside?(center: Vec4, radius: number): boolean;
    /** Present when the walk needs every ray to start in D: the camera pose moved into D (its
     *  point, and its frame vectors carried along), on the CPU. Absent when the walk starts
     *  anywhere. */
    reduceCamera?(point: Vec4, vectors: readonly Vec4[]): { point: Vec4; vectors: Vec4[] };
}

export const QUOTIENTS: Record<string, QuotientDescriptor> = {
    torus: TORUS,
    'seifert-weber': SEIFERT_WEBER,
};
