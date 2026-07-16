// Similarity algebra unit tests (docs/fable-transforms.md §8 "Vitest structural").
// Property style: compose/inverse round-trips, homomorphism (apply(compose) =
// apply∘apply), the TRS order pin, and the direction/vector split that carries the
// no-inverse-transpose guarantee.

import { describe, it, expect } from 'vitest';
import {
    IDENTITY_SIMILARITY,
    classifySimilarity,
    quatFromAxisAngle,
    quatMultiply,
    quatNormalize,
    quatRotate,
    quatToMat3,
    similarityApplyDirection,
    similarityApplyPoint,
    similarityApplyVector,
    similarityCompose,
    similarityFromTRS,
    similarityInverse,
    type Quat,
    type Similarity,
    type Vec3Tuple,
} from '../../src/components/geometry/similarity.js';

const EPS = 1e-12;

function expectVec3Close(actual: Vec3Tuple, expected: Vec3Tuple, eps = 1e-9): void {
    for (let i = 0; i < 3; i++) {
        expect(Math.abs(actual[i] - expected[i]), `component ${i}: ${actual} vs ${expected}`).toBeLessThan(eps);
    }
}

// Deterministic pseudo-random fixtures (no Math.random — reproducible failures).
const QUATS: Quat[] = [
    quatFromAxisAngle([0, 0, 1], Math.PI / 2),
    quatFromAxisAngle([1, 2, 3], 0.7),
    quatFromAxisAngle([-1, 0.5, 2], 2.4),
    quatNormalize([0.3, -0.4, 0.5, 0.6]),
];
const SIMS: Similarity[] = [
    { rotation: QUATS[0], translation: [10, 0, 0], scale: 1 },
    { rotation: QUATS[1], translation: [-2, 5, 1.5], scale: 3 },
    { rotation: QUATS[2], translation: [0.1, -0.2, 0.3], scale: 0.25 },
    IDENTITY_SIMILARITY,
];
const POINTS: Vec3Tuple[] = [[0, 0, 0], [1, 0, 0], [0.3, -1.7, 2.2], [-5, 4, -3]];

describe('quaternion algebra', () => {
    it('rotation by axis-angle matches the classic Rz(90°): +X → +Y', () => {
        const q = quatFromAxisAngle([0, 0, 1], Math.PI / 2);
        expectVec3Close(quatRotate(q, [1, 0, 0]), [0, 1, 0]);
        expectVec3Close(quatRotate(q, [0, 1, 0]), [-1, 0, 0]);
    });

    it('quatMultiply composes rotations: (a·b) v = a (b v)', () => {
        for (const a of QUATS) for (const b of QUATS) for (const p of POINTS) {
            expectVec3Close(quatRotate(quatMultiply(a, b), p), quatRotate(a, quatRotate(b, p)));
        }
    });

    it('quatToMat3 agrees with quatRotate (column-major)', () => {
        for (const q of QUATS) {
            const m = quatToMat3(q);
            for (const p of POINTS) {
                const viaMat: Vec3Tuple = [
                    m[0] * p[0] + m[3] * p[1] + m[6] * p[2],
                    m[1] * p[0] + m[4] * p[1] + m[7] * p[2],
                    m[2] * p[0] + m[5] * p[1] + m[8] * p[2],
                ];
                expectVec3Close(viaMat, quatRotate(q, p));
            }
        }
    });

    it('rotation preserves length (no scale leaks through the quat path)', () => {
        for (const q of QUATS) for (const p of POINTS) {
            const r = quatRotate(q, p);
            expect(Math.abs(Math.hypot(...r) - Math.hypot(...p))).toBeLessThan(1e-9);
        }
    });
});

describe('similarity algebra (fable-transforms §2)', () => {
    it('compose is a homomorphism: apply(b∘a, p) = apply(b, apply(a, p))', () => {
        for (const a of SIMS) for (const b of SIMS) for (const p of POINTS) {
            expectVec3Close(
                similarityApplyPoint(similarityCompose(b, a), p),
                similarityApplyPoint(b, similarityApplyPoint(a, p)),
            );
        }
    });

    it('inverse round-trips: g⁻¹(g(p)) = p and g(g⁻¹(p)) = p', () => {
        for (const g of SIMS) for (const p of POINTS) {
            expectVec3Close(similarityApplyPoint(similarityInverse(g), similarityApplyPoint(g, p)), p);
            expectVec3Close(similarityApplyPoint(g, similarityApplyPoint(similarityInverse(g), p)), p);
        }
    });

    it('g⁻¹∘g classifies as identity', () => {
        for (const g of SIMS) {
            const round = similarityCompose(similarityInverse(g), g);
            expect(classifySimilarity(round)).toBe('identity');
        }
    });

    it('TRS pin: local→parent applies scale, then rotation, then translation', () => {
        const q = quatFromAxisAngle([0, 0, 1], Math.PI / 2);
        const g = similarityFromTRS([10, 0, 0], q, 2);
        // p = (1,0,0): scale → (2,0,0), rotate 90° about z → (0,2,0), translate → (10,2,0)
        expectVec3Close(similarityApplyPoint(g, [1, 0, 0]), [10, 2, 0]);
    });

    it('the worked compound example (outer 90° + inner 90° + leaf offset)', () => {
        // outer: T(10,0,0)·Rz(90°); inner: T(2,0,0)·Rz(90°); sphere leaf offset (0,1,0).
        const rz90 = quatFromAxisAngle([0, 0, 1], Math.PI / 2);
        const outer = similarityFromTRS([10, 0, 0], rz90, 1);
        const inner = similarityFromTRS([2, 0, 0], rz90, 1);
        const leaf = similarityFromTRS([0, 1, 0], [0, 0, 0, 1], 1);
        const world = similarityCompose(similarityCompose(outer, inner), leaf);
        // outer maps inner origin to (10,2,0); composed rotation 180° maps (0,1,0) to (0,-1,0).
        expectVec3Close(similarityApplyPoint(world, [0, 0, 0]), [10, 1, 0]);
        // Local sphere center (1,0,0) lands at (10,2,0)+180°·(1,1,0)... directly: (9,1,0).
        expectVec3Close(similarityApplyPoint(world, [1, 0, 0]), [9, 1, 0]);
    });

    it('directions rotate without scale (normals need no inverse-transpose)', () => {
        for (const g of SIMS) {
            const d = similarityApplyDirection(g, [0, 0, 1]);
            expect(Math.abs(Math.hypot(...d) - 1)).toBeLessThan(1e-9);
        }
    });

    it('vectors carry s·R (edge lengths scale by exactly s)', () => {
        for (const g of SIMS) {
            const v = similarityApplyVector(g, [0, 3, 4]);
            expect(Math.abs(Math.hypot(...v) - 5 * g.scale)).toBeLessThan(1e-9);
        }
    });

    it('scale composes multiplicatively and stays positive', () => {
        for (const a of SIMS) for (const b of SIMS) {
            const c = similarityCompose(b, a);
            expect(Math.abs(c.scale - a.scale * b.scale)).toBeLessThan(EPS);
            expect(c.scale).toBeGreaterThan(0);
        }
    });
});

describe('classification (lowering tiers, §5.2)', () => {
    it('classifies each tier', () => {
        expect(classifySimilarity(IDENTITY_SIMILARITY)).toBe('identity');
        expect(classifySimilarity({ rotation: [0, 0, 0, 1], translation: [1, 2, 3], scale: 1 })).toBe('translation');
        expect(classifySimilarity({ rotation: QUATS[0], translation: [0, 0, 0], scale: 1 })).toBe('rigid');
        expect(classifySimilarity({ rotation: [0, 0, 0, 1], translation: [0, 0, 0], scale: 2 })).toBe('similarity');
    });

    it('−q classifies as identity rotation (double cover)', () => {
        expect(classifySimilarity({ rotation: [0, 0, 0, -1], translation: [0, 0, 0], scale: 1 })).toBe('identity');
    });
});
