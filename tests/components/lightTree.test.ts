// Light-tree builder invariants (fable-light-bvh §9): exact node count, Φ sums,
// trail replay, pmf normalization (the TS twin of the generated walk pair), the
// coincident-light power-proportional limit, and the 48-level trail cap.

import { describe, it, expect } from 'vitest';
import {
    buildLightTree, lightTreePmf, lightTreeImportance, LIGHT_TREE_MAX_DEPTH,
    type LightTreeResult,
} from '../../src/components/accel/light_tree/light_tree.js';

/** Deterministic pseudo-random (no Math.random in tests — reproducible failures). */
function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

function makeLights(n: number, rand: () => number): { boxes: Float64Array; powers: Float64Array } {
    const boxes = new Float64Array(6 * n);
    const powers = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const x = rand() * 20 - 10, y = rand() * 20 - 10, z = rand() * 20 - 10;
        const r = 0.05 + rand() * 0.3;
        boxes[6 * i] = x - r; boxes[6 * i + 1] = y - r; boxes[6 * i + 2] = z - r;
        boxes[6 * i + 3] = x + r; boxes[6 * i + 4] = y + r; boxes[6 * i + 5] = z + r;
        powers[i] = 0.1 + rand() * 10;
    }
    return { boxes, powers };
}

function subtreePhi(tree: LightTreeResult, ni: number, powers: Float64Array): number {
    const link = tree.nodes[ni * 8 + 7];
    if (link < 0) return powers[-link - 1];
    return subtreePhi(tree, ni + 1, powers) + subtreePhi(tree, link, powers);
}

describe('light tree builder', () => {
    const rand = lcg(7);
    const N = 97;
    const { boxes, powers } = makeLights(N, rand);
    const tree = buildLightTree(boxes, powers, N);

    it('emits exactly 2n−1 nodes (leaf = one light)', () => {
        expect(tree.nodeCount).toBe(2 * N - 1);
        // Every light appears in exactly one leaf.
        const seen = new Set<number>();
        for (let ni = 0; ni < tree.nodeCount; ni++) {
            const link = tree.nodes[ni * 8 + 7];
            if (link < 0) seen.add(-link - 1);
        }
        expect(seen.size).toBe(N);
    });

    it('every node Φ is its subtree power sum', () => {
        for (let ni = 0; ni < tree.nodeCount; ni++) {
            const phi = tree.nodes[ni * 8 + 3];
            expect(phi).toBeCloseTo(subtreePhi(tree, ni, powers), 3);
            expect(phi).toBeGreaterThan(0);
        }
    });

    it('trails replay to their own leaf and the descent pmf sums to 1', () => {
        // Random query points, including one INSIDE the cloud (the near-field clamp path).
        const points: Array<[number, number, number]> = [
            [30, 5, -8], [0, 0, 0], [-2, 3, 1], [0.01, -0.02, 0.03],
        ];
        for (const p of points) {
            let sum = 0;
            for (let li = 0; li < N; li++) {
                const pmf = lightTreePmf(tree, li, p);
                expect(pmf).toBeGreaterThan(0);   // normal-free importance never culls
                sum += pmf;
            }
            expect(sum).toBeCloseTo(1, 6);
        }
    });

    it('coincident lights descend power-proportionally', () => {
        // Three lights at ONE position (SAH has no plane): the median chain's Φ sums must
        // make selection exactly power-proportional — the correct coincident limit.
        const b = new Float64Array(18);
        for (let i = 0; i < 3; i++) {
            b[6 * i] = 1 - 0.1; b[6 * i + 1] = 2 - 0.1; b[6 * i + 2] = 3 - 0.1;
            b[6 * i + 3] = 1 + 0.1; b[6 * i + 4] = 2 + 0.1; b[6 * i + 5] = 3 + 0.1;
        }
        const pw = new Float64Array([1, 2, 5]);
        const t3 = buildLightTree(b, pw, 3);
        expect(t3.nodeCount).toBe(5);
        for (let li = 0; li < 3; li++) {
            expect(lightTreePmf(t3, li, [10, 0, 0])).toBeCloseTo(pw[li] / 8, 6);
        }
    });

    it('caps depth at the 48-level trail bound on adversarial spacing', () => {
        // Exponentially spaced points drive plain SAH into a linear spine (depth n−1);
        // the balanced fallback must keep depth ≤ 48 with every trail still valid.
        const n = 80;
        const b = new Float64Array(6 * n);
        const pw = new Float64Array(n).fill(1);
        for (let i = 0; i < n; i++) {
            const x = Math.pow(1.9, i * 0.5);
            b[6 * i] = x; b[6 * i + 1] = 0; b[6 * i + 2] = 0;
            b[6 * i + 3] = x; b[6 * i + 4] = 0; b[6 * i + 5] = 0;
        }
        const deep = buildLightTree(b, pw, n);
        expect(deep.maxDepth).toBeLessThanOrEqual(LIGHT_TREE_MAX_DEPTH);
        let sum = 0;
        for (let li = 0; li < n; li++) sum += lightTreePmf(deep, li, [0, 5, 0]);
        expect(sum).toBeCloseTo(1, 6);
    });

    it('handles the single-light tree (root is the leaf, pmf 1)', () => {
        const t1 = buildLightTree(new Float64Array([0, 0, 0, 1, 1, 1]), new Float64Array([3]), 1);
        expect(t1.nodeCount).toBe(1);
        expect(lightTreePmf(t1, 0, [4, 4, 4])).toBe(1);
    });

    it('is deterministic (same inputs → same nodes and trails)', () => {
        const again = buildLightTree(boxes, powers, N);
        expect(Array.from(again.nodes)).toEqual(Array.from(tree.nodes));
        expect(Array.from(again.trails)).toEqual(Array.from(tree.trails));
    });
});

describe('horizon term (fable-light-bvh §3.2 v1.5)', () => {
    // Two clean half-spaces around the y = 0 tangent plane (margins ≫ light radius, so
    // no bounding sphere straddles): with n = +y, every below light must be CULLED
    // (pmf exactly 0 — at an opaque receiver it contributes exactly 0, so the cull is
    // variance-only), every above light stays reachable, and the above mass sums to 1
    // (no ancestor here can have both children culled).
    const M = 40;
    const rand = lcg(21);
    const boxes = new Float64Array(6 * 2 * M);
    const powers = new Float64Array(2 * M);
    for (let i = 0; i < 2 * M; i++) {
        const above = i < M;
        const x = rand() * 10 - 5, z = rand() * 10 - 5;
        const y = (above ? 1 : -1) * (1.5 + rand() * 4);
        const r = 0.1;
        boxes[6 * i] = x - r; boxes[6 * i + 1] = y - r; boxes[6 * i + 2] = z - r;
        boxes[6 * i + 3] = x + r; boxes[6 * i + 4] = y + r; boxes[6 * i + 5] = z + r;
        powers[i] = 0.5 + rand() * 5;
    }
    const tree = buildLightTree(boxes, powers, 2 * M);
    const p: [number, number, number] = [0.3, 0, -0.2];
    const up: [number, number, number] = [0, 1, 0];

    it('culls below-horizon lights exactly, keeps above-horizon mass normalized', () => {
        let above = 0;
        for (let li = 0; li < 2 * M; li++) {
            const pmf = lightTreePmf(tree, li, p, up);
            if (li < M) {
                expect(pmf).toBeGreaterThan(0);
                above += pmf;
            } else {
                expect(pmf).toBe(0);
            }
        }
        expect(above).toBeCloseTo(1, 6);
    });

    it('normal-free query is unchanged by the upgrade (Σ pmf = 1 over ALL lights)', () => {
        let sum = 0;
        for (let li = 0; li < 2 * M; li++) sum += lightTreePmf(tree, li, p);
        expect(sum).toBeCloseTo(1, 6);
    });

    it('grazing clusters are down-weighted, dead-ahead clusters untouched', () => {
        const box: [number, number, number] = [4, 4, 4];
        const bmin: [number, number, number] = [box[0] - 0.2, box[1] - 0.2, box[2] - 0.2];
        const bmax: [number, number, number] = [box[0] + 0.2, box[1] + 0.2, box[2] + 0.2];
        const ahead = lightTreeImportance(bmin, bmax, 1, [4, 0, 4], [0, 1, 0]);       // cluster straight up
        const graze = lightTreeImportance(bmin, bmax, 1, [4, 3.9, -2], [0, 1, 0]);    // near the horizon
        const free = lightTreeImportance(bmin, bmax, 1, [4, 0, 4]);
        expect(ahead).toBeCloseTo(free, 10);   // θi ≈ 0 → full weight
        expect(graze).toBeLessThan(lightTreeImportance(bmin, bmax, 1, [4, 3.9, -2]));
        expect(graze).toBeGreaterThan(0);
    });
});

describe('lightQuery policy contract (fable-light-bvh §3.2 v1.5)', () => {
    it('every transmissive material model is pure-delta (NEE never runs there)', async () => {
        // The generated light_query_surface passes the shading normal UNCONDITIONALLY,
        // and the one-sided horizon cull is bias-safe only because no transmissive
        // material ever runs NEE (pure delta ⇒ the technique's nondelta guard skips
        // it, and prev_was_delta short-circuits the MIS weight). The day a
        // ROUGH-transmissive model (GGX-T) registers, this fails: extend the
        // constructor's policy (n = 0 or the AbsDot form for that model) FIRST.
        const { MATERIAL_MODELS } = await import('../../src/components/materials/index.js');
        for (const [name, d] of Object.entries(MATERIAL_MODELS)) {
            if (d !== undefined && d.capabilities.transmission) {
                expect(d.capabilities.nonDeltaLobes,
                    `model '${name}' is transmissive AND has non-delta lobes — light_query_surface's normal policy must learn it (fable-light-bvh §3.2 v1.5)`).toBe(false);
            }
        }
    });
});
