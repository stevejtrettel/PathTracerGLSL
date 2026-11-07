// The Seifert–Weber occupant: the group Γ of the dodecahedral space H³/Γ, computed in float64 from
// closed forms, and TypeScript twins of the numbering in seifert-weber.glsl (the vitest twins,
// the Validator and the camera read these). The math is in seifert-weber.md.
//
// Conventions (components/ambient/hyperbolic): points and tangent vectors are 4-vectors of R^{3,1}
// with ⟨a,b⟩ = a·b(xyz) − a_w·b_w, o = (0,0,0,1); matrices are column-major (GLSL's mat4 order,
// components/ambient/isometry.ts).

import type { Vec3Tuple } from '../../geometry/similarity.js';
import { mat4Apply, mat4Multiply, type Mat4, type Vec4 } from '../../ambient/isometry.js';
import { hyperbolicGeometry } from '../../ambient/hyperbolic/hyperbolic.js';
import { formatFloat } from '../../glsl-format.js';
import type { QuotientDescriptor } from '../index.js';
import seifertWeberGLSL from './seifert-weber.glsl?raw';

const SQ5 = Math.sqrt(5);
const PHI = (1 + SQ5) / 2;

/** The inradius of D: cosh² r_in = (5 + 2√5)/4, r_in = 0.99638. */
export const SW_INRADIUS = Math.acosh(Math.sqrt((5 + 2 * SQ5) / 4));
/** The circumradius of D: cosh R_c = (7 + 3√5)/4, R_c = 1.90285. */
export const SW_CIRCUMRADIUS = Math.acosh((7 + 3 * SQ5) / 4);
/** The twist of every face pairing: 3/10 of a turn. */
const TWIST = (3 * Math.PI) / 5;

/** The 12 unit face directions at o: face 2k is +u_k and face 2k + 1 is −u_k, with u_k over
 *  (0,1,φ), (0,1,−φ), (1,φ,0), (1,−φ,0), (φ,0,1), (−φ,0,1) normalized (thurston-rebuild's order). */
const FACE_DIRECTIONS: Vec3Tuple[] = [[0, 1, PHI], [0, 1, -PHI], [1, PHI, 0], [1, -PHI, 0], [PHI, 0, 1], [-PHI, 0, 1]]
    .flatMap((d) => {
        const n = Math.hypot(d[0], d[1], d[2]);
        const u: Vec3Tuple = [d[0] / n, d[1] / n, d[2] / n];
        return [u, [-u[0], -u[1], -u[2]] as Vec3Tuple];
    });

/** Outward unit normals N_i = (û_i·cosh r_in, sinh r_in) of D's faces: ⟨N_i, p⟩ = sinh of p's
 *  signed distance beyond face i, so D = {p : ⟨N_i, p⟩ ≤ 0 for every i}. */
export const swFaceNormals: readonly Vec4[] = FACE_DIRECTIONS.map((u) => [
    u[0] * Math.cosh(SW_INRADIUS), u[1] * Math.cosh(SW_INRADIUS), u[2] * Math.cosh(SW_INRADIUS), Math.sinh(SW_INRADIUS),
]);

/** The rotation by `angle` about the unit axis u through o (right-handed), column-major. */
function rotationAbout(u: Vec3Tuple, angle: number): Mat4 {
    const c = Math.cos(angle), s = Math.sin(angle), C = 1 - c;
    const [x, y, z] = u;
    // Rows of the 3×3 block: Rodrigues' formula.
    const r = [
        [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
        [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
        [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
    ];
    return [r[0][0], r[1][0], r[2][0], 0, r[0][1], r[1][1], r[2][1], 0, r[0][2], r[1][2], r[2][2], 0, 0, 0, 0, 1];
}

/** The face pairings: a ray leaving D through face i continues from PAIRING[i] of its exit
 *  state. g_{2k} = T(−2 r_in·u_k)·R(u_k, 3π/5) maps face 2k onto face 2k + 1 with a twist of
 *  3/10 of a turn, and g_{2k+1} = g_{2k}⁻¹. */
export const swPairings: readonly Mat4[] = [0, 1, 2, 3, 4, 5].flatMap((k) => {
    const u = FACE_DIRECTIONS[2 * k];
    const g = mat4Multiply(hyperbolicGeometry.transvection([-2 * SW_INRADIUS * u[0], -2 * SW_INRADIUS * u[1], -2 * SW_INRADIUS * u[2]]), rotationAbout(u, TWIST));
    return [g, hyperbolicGeometry.inverse(g)];
});

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** The NEE image table S13 (twin of seifert-weber.glsl): image 0 is the light in D, image 1 + f
 *  the light's copy in the cell across face f, g_f⁻¹·D. Seen from x, image j is the light in D
 *  seen from swImageMatrix(j)·x: I for j = 0, PAIRING[f] = g_f for j = 1 + f. */
export function swImageMatrix(j: number): Mat4 {
    return j === 0 ? IDENTITY : swPairings[j - 1];
}

/** The image a walk hit after `crossings` face crossings, the first through `firstFace`: 0 with
 *  none, 1 + firstFace with one, −1 otherwise (twin of quotient_image_index). Exact because
 *  D ∪ g_f⁻¹D is convex (dihedral angle 72° ≤ 90°), so a geodesic from D into the cell across
 *  face f crosses exactly one face. */
export function swImageIndex(crossings: number, firstFace: number): number {
    return crossings === 0 ? 0 : crossings === 1 ? 1 + firstFace : -1;
}

const form = hyperbolicGeometry.form;

/** The camera reduction: apply the pairing of the face p lies farthest beyond until p is in D,
 *  carrying `vectors` (tangent vectors at p) along; `faces` lists the pairings applied, in order.
 *  Each step lowers d(p, o) (face i bisects o and g_i⁻¹·o, D being the Dirichlet domain at o), so
 *  it ends. A point within 1e-9 of a face counts as inside: on a face, rounding could otherwise
 *  send it back and forth between the paired faces. */
export function swReduce(point: Vec4, vectors: readonly Vec4[]): { point: Vec4; vectors: Vec4[]; faces: number[] } {
    let p = point, vs = [...vectors];
    const faces: number[] = [];
    for (;;) {
        let worst = 1e-9, face = -1;
        for (let i = 0; i < 12; i++) {
            const s = form(swFaceNormals[i], p);
            if (s > worst) { worst = s; face = i; }
        }
        if (face < 0) return { point: p, vectors: vs, faces };
        const g = swPairings[face];
        p = mat4Apply(g, p);
        vs = vs.map((v) => mat4Apply(g, v));
        faces.push(face);
    }
}

/** Whether the geodesic ball of radius r about c lies inside D: ⟨N_i, c⟩ is the sinh of c's
 *  signed distance beyond face i, so the ball is on D's side of face i exactly when
 *  ⟨N_i, c⟩ ≤ −sinh r. D is the intersection of the 12 half-spaces. */
export function swBallInside(c: Vec4, r: number): boolean {
    return swFaceNormals.every((n) => form(n, c) <= -Math.sinh(r));
}

/** The far clip's floor 2R_c + 2r_in = 5.798: for x, y in D and γ in S13, d(x, γy) ≤ d(x, o) +
 *  d(o, γo) + d(γo, γy) ≤ R_c + 2r_in + R_c, so every image NEE samples is within the clip of
 *  every path vertex (and so reachable by a BSDF ray). */
export function swFarClipFloor(): number {
    return 2 * SW_CIRCUMRADIUS + 2 * SW_INRADIUS;
}

/** The walk's crossing cap for segments of length ≤ farClip: ⌈4·farClip⌉ + 32, a declared
 *  truncation (a segment that would cross more faces ends: a miss, or occluded for a shadow ray).
 *  The mean length between crossings is 0.960 (Kac), the twin's longest segments crossed 17
 *  faces at farClip 8 and 29 at 16, and edge and vertex passages add zero-length runs of up to 6. */
export function swMaxCrossings(farClip: number): number {
    return Math.ceil(4 * farClip) + 32;
}

/** The group's tables as GLSL const arrays, each entry rounded once to float32: FACE_N[i] the
 *  outward face normals and PAIRING[i] the pairings (column-major mat4). */
export function swConstantsGLSL(): string {
    const f = (x: number) => formatFloat(Math.fround(x));
    const n = swFaceNormals.map((v) => `vec4(${v.map(f).join(', ')})`);
    const g = swPairings.map((m) => `mat4(${m.map(f).join(', ')})`);
    return [
        `const vec4 FACE_N[12] = vec4[12](${n.join(', ')});`,
        `const mat4 PAIRING[12] = mat4[12](${g.join(', ')});`,
    ].join('\n');
}

export const SEIFERT_WEBER: QuotientDescriptor = {
    kind: 'seifert-weber',
    space: 'hyperbolic',
    glsl: seifertWeberGLSL,
    imageCount: 13,
    farClipFloor: () => ({ value: swFarClipFloor(), formula: '2R_c + 2r_in' }),
    defines: (_q, farClip) => ({ QUOTIENT_MAX_CROSSINGS: String(swMaxCrossings(farClip)) }),
    constants: swConstantsGLSL,
    ambientFog: false,
    ballInside: swBallInside,
    reduceCamera: (point, vectors) => {
        const r = swReduce(point, vectors);
        return { point: r.point, vectors: r.vectors };
    },
};
