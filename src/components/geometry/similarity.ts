// Euclidean similarity — the canonical internal placement (docs/fable-transforms.md §2).
//
// x ↦ s·R·x + t with s > 0 STRICTLY. Closed under composition (shear can never arise),
// closed-form inverse (no numerical mat4 inversion anywhere), normals transform by R
// alone. Reflections and nonuniform scale are unrepresentable by design — see the §1
// one-way doors before "extending" this type.
//
// Lives in components (the leaf layer) because geometry descriptors' fold functions and
// the Planner both consume it — same residency rule as quadNormal/canonicalPlane.

export type Vec3Tuple = [number, number, number];

/** Unit quaternion [x, y, z, w]. */
export type Quat = [number, number, number, number];

export interface Similarity {
    rotation: Quat;
    translation: Vec3Tuple;
    scale: number;   // s > 0 — the Validator rejects everything else before this type is built
}

export const IDENTITY_QUAT: Quat = [0, 0, 0, 1];

export const IDENTITY_SIMILARITY: Similarity = {
    rotation: IDENTITY_QUAT,
    translation: [0, 0, 0],
    scale: 1,
};

// ---------------------------------------------------------------------------
// Quaternion algebra (Hamilton convention; q = [v, w], rotation of p is q p q⁻¹)
// ---------------------------------------------------------------------------

export function quatMultiply(a: Quat, b: Quat): Quat {
    const [ax, ay, az, aw] = a;
    const [bx, by, bz, bw] = b;
    return [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ];
}

/** Conjugate = inverse for unit quaternions. */
export function quatConjugate(q: Quat): Quat {
    return [-q[0], -q[1], -q[2], q[3]];
}

export function quatNormalize(q: Quat): Quat {
    const len = Math.hypot(q[0], q[1], q[2], q[3]);
    return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

/** Axis-angle (radians) → unit quaternion. The axis need not be unit; a near-zero
 *  axis is a Validator error before this runs. */
export function quatFromAxisAngle(axis: Vec3Tuple, angle: number): Quat {
    const len = Math.hypot(axis[0], axis[1], axis[2]);
    const half = angle / 2;
    const s = Math.sin(half) / len;
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

/** Rotate a vector by a unit quaternion (no translation, no scale). */
export function quatRotate(q: Quat, v: Vec3Tuple): Vec3Tuple {
    // v' = v + 2·qv × (qv × v + w·v)   (the standard expansion, no trig)
    const [qx, qy, qz, qw] = q;
    const tx = 2 * (qy * v[2] - qz * v[1]);
    const ty = 2 * (qz * v[0] - qx * v[2]);
    const tz = 2 * (qx * v[1] - qy * v[0]);
    return [
        v[0] + qw * tx + qy * tz - qz * ty,
        v[1] + qw * ty + qz * tx - qx * tz,
        v[2] + qw * tz + qx * ty - qy * tx,
    ];
}

/** Column-major 3×3 rotation matrix of a unit quaternion (GLSL mat3 constructor order). */
export function quatToMat3(q: Quat): number[] {
    const [x, y, z, w] = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    // columns of R
    return [
        1 - (yy + zz), xy + wz, xz - wy,      // column 0
        xy - wz, 1 - (xx + zz), yz + wx,      // column 1
        xz + wy, yz - wx, 1 - (xx + yy),      // column 2
    ];
}

// ---------------------------------------------------------------------------
// Similarity algebra (docs/fable-transforms.md §2)
// ---------------------------------------------------------------------------

/** Apply g: x ↦ s·R·x + t. */
export function similarityApplyPoint(g: Similarity, p: Vec3Tuple): Vec3Tuple {
    const r = quatRotate(g.rotation, p);
    return [
        r[0] * g.scale + g.translation[0],
        r[1] * g.scale + g.translation[1],
        r[2] * g.scale + g.translation[2],
    ];
}

/** Apply the linear part WITHOUT scale: directions stay unit (normals: n' = R·n). */
export function similarityApplyDirection(g: Similarity, d: Vec3Tuple): Vec3Tuple {
    return quatRotate(g.rotation, d);
}

/** Apply the full linear part s·R (edges, non-unit tangent vectors). */
export function similarityApplyVector(g: Similarity, v: Vec3Tuple): Vec3Tuple {
    const r = quatRotate(g.rotation, v);
    return [r[0] * g.scale, r[1] * g.scale, r[2] * g.scale];
}

/** Composition: (b ∘ a)(x) = b(a(x)) = (s_b·s_a, R_b·R_a, s_b·R_b·t_a + t_b). */
export function similarityCompose(b: Similarity, a: Similarity): Similarity {
    const rotatedTa = quatRotate(b.rotation, a.translation);
    return {
        rotation: quatNormalize(quatMultiply(b.rotation, a.rotation)),
        translation: [
            b.scale * rotatedTa[0] + b.translation[0],
            b.scale * rotatedTa[1] + b.translation[1],
            b.scale * rotatedTa[2] + b.translation[2],
        ],
        scale: b.scale * a.scale,
    };
}

/** Closed-form inverse: (1/s, Rᵀ, −Rᵀt/s). */
export function similarityInverse(g: Similarity): Similarity {
    const rInv = quatConjugate(g.rotation);
    const rt = quatRotate(rInv, g.translation);
    const inv = 1 / g.scale;
    return {
        rotation: rInv,
        translation: [-rt[0] * inv, -rt[1] * inv, -rt[2] * inv],
        scale: inv,
    };
}

/** Node-local TRS (§2 pin): local→parent = T·R·S — scale, then rotate, then translate.
 *  This IS a similarity already; the constructor just names the convention. */
export function similarityFromTRS(translation: Vec3Tuple, rotation: Quat, scale: number): Similarity {
    return { rotation: quatNormalize(rotation), translation, scale };
}

const IDENTITY_EPS = 1e-12;

export function isIdentityRotation(q: Quat): boolean {
    // ±identity both rotate trivially (q and −q are the same rotation).
    return Math.abs(Math.abs(q[3]) - 1) < IDENTITY_EPS
        && Math.abs(q[0]) < IDENTITY_EPS && Math.abs(q[1]) < IDENTITY_EPS && Math.abs(q[2]) < IDENTITY_EPS;
}

export function isIdentityScale(s: number): boolean {
    return Math.abs(s - 1) < IDENTITY_EPS;
}

export function isIdentityTranslation(t: Vec3Tuple): boolean {
    return Math.abs(t[0]) < IDENTITY_EPS && Math.abs(t[1]) < IDENTITY_EPS && Math.abs(t[2]) < IDENTITY_EPS;
}

/** Lowering classification (docs/fable-transforms.md §5.2) — the wrapper emits only
 *  the tiers the authored transform needs. */
export type SimilarityKind = 'identity' | 'translation' | 'rigid' | 'similarity';

export function classifySimilarity(g: Similarity): SimilarityKind {
    if (!isIdentityScale(g.scale)) return 'similarity';
    if (!isIdentityRotation(g.rotation)) return 'rigid';
    if (!isIdentityTranslation(g.translation)) return 'translation';
    return 'identity';
}
