// The cube 3-torus occupant: facts about the lattice Γ = Lx·Z × Ly·Z × Lz·Z and TypeScript twins
// of the numbering in torus.glsl (the vitest twins and the Validator read these).

import type { Vec3 } from '../../../compiler/types.js';
import { formatFloat, formatVec3 } from '../../glsl-format.js';
import type { QuotientDescriptor } from '../index.js';
import torusGLSL from './torus.glsl?raw';

/** Image j of the 27-entry table names c_j = (⌊j/9⌋, ⌊j/3⌋ mod 3, j mod 3) − 1 (torus.glsl). */
export function torusImageOffset(j: number): Vec3 {
    return [Math.floor(j / 9) - 1, (Math.floor(j / 3) % 3) - 1, (j % 3) - 1];
}

/** The image of cell k (an integer vector), or −1 when k is not in {−1, 0, 1}³ (torus.glsl). */
export function torusImageIndex(k: Vec3): number {
    return k.every((v) => Math.abs(v) <= 1) ? (k[0] + 1) * 9 + (k[1] + 1) * 3 + (k[2] + 1) : -1;
}

/** The diameter of D = [−L/2, L/2]³: the length of its main diagonal. */
export function torusDiameter(size: Vec3): number {
    return Math.hypot(size[0], size[1], size[2]);
}

/** A bound on the cells the walk visits for one segment of length ≤ farClip. A segment of length
 *  R with unit direction d crosses at most R·|d_i|/L_i faces on axis i, plus one partial step at
 *  each end, so it visits at most 4 + R·Σ|d_i|/L_i ≤ 4 + R·√(Σ 1/L_i²) cells (Cauchy–Schwarz);
 *  one more absorbs rounding at the start cell. */
export function torusMaxCells(size: Vec3, farClip: number): number {
    return 5 + Math.ceil(farClip * Math.hypot(1 / size[0], 1 / size[1], 1 / size[2]));
}

export const TORUS: QuotientDescriptor = {
    kind: 'torus',
    space: 'euclidean',
    glsl: torusGLSL,
    imageCount: 27,
    diameter: (q) => torusDiameter(q.size),
    defines: (q, farClip) => ({
        TORUS_PERIOD: formatVec3(q.size),
        TORUS_MAX_CELLS: String(torusMaxCells(q.size, farClip)),
        TORUS_BIG: formatFloat(3.0e38),
    }),
};
