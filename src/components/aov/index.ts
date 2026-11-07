// AOV registry (measurement family — `measurement.aovs`). An AOV occupant = one folder (the
// static GLSL computing its sample at the first surface a path reaches, and a descriptor)
// + one line below. Every occupant's GLSL defines one function with the same signature,
//     vec3 <name>_aov(int mat, Hit hit, Direction wo, MaterialProperties props, Spectrum weight)
// where `weight` is the path's throughput on arrival, so the walk calls each one alike. The
// compiler adds each listed AOV's picture after the main picture and the statistic, updates it
// by the accumulation mode's own rule, and links its GLSL (generate/features/aov.ts).

import type { PictureFacts } from '../../compiler/types.js';
import type { SpaceBodies } from '../descriptors.js';
import { albedo } from './albedo/albedo.js';
import { normal } from './normal/normal.js';

export interface AovDescriptor {
    /** Registry key — the name listed in `measurement.aovs`. Its function is `<name>_aov`. */
    name: string;
    /** Per space: the file defining `<name>_aov`. */
    glsl: SpaceBodies;
    /** The seams `<name>_aov` calls beyond core math. */
    requires: string[];
    /** The picture this AOV adds. */
    picture: PictureFacts;
}

export const AOVS: Record<string, AovDescriptor> = { albedo, normal };
