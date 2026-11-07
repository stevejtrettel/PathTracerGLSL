// Quotient registry (measurement pick-at-most-one family — the group Γ of a closed manifold
// M = X/Γ, a property of the scene's ambient space). An occupant = one folder (<kind>.ts: the
// descriptor; <kind>.glsl: the static lattice math, the contract in README.md) + one line below.
// The walks across the fundamental domain's faces and the image-aware NEE/MIS wrappers are
// generated (generate/features/intersection.ts, lighting.ts) over these functions.

import type { QuotientDescription } from '../../compiler/types.js';
import { TORUS } from './torus/torus.js';

export interface QuotientDescriptor {
    /** Registry key — `scene.ambientSpace.quotient.kind`. */
    kind: string;
    /** The ambient space (AMBIENT_SPACES key) the group acts on. */
    space: string;
    /** ?raw source providing quotient_image_index/shift, quotient_image, quotient_reduce and the
     *  walk's helpers, included whole after the ambient occupant. */
    glsl: string;
    /** |S|: the number of images in the NEE image table. */
    imageCount: number;
    /** The diameter of the fundamental domain D. */
    diameter(q: QuotientDescription): number;
    /** The occupant's defines for one program (the group's constants, the walk's loop bound). */
    defines(q: QuotientDescription, farClip: number): Record<string, string>;
}

export const QUOTIENTS: Record<string, QuotientDescriptor> = {
    torus: TORUS,
};
