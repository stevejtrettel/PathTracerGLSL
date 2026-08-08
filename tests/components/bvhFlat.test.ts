// tests/components/bvhFlat.test.ts — the SAH-rewrite byte gate (fable-instance-clouds
// §8's typed-array-builder item, Aug 8 2026): the allocation-free flat core must be
// BYTE-IDENTICAL to the previous object-based builder — same nodes, same leaf
// permutation, same depth — on every input class. The OLD implementation lives here
// verbatim as the reference twin (deterministic, so equality is exact, not tolerance).
// Also gates the pack feeder: packInstanceBatch's inline corner transform vs the old
// transformAABB(similarityApplyPoint) path.

import { describe, it, expect } from 'vitest';
import { buildBVHNodes, buildBVHNodesFlat, buildBVH, transformAABB, type AABB } from '../../src/components/accel/bvh/bvh.js';
import { packInstanceBatch } from '../../src/components/intersection/instancing/instancing.js';
import { similarityApplyPoint, similarityFromTransform, quatNormalize, IDENTITY_QUAT, type Similarity } from '../../src/components/geometry/similarity.js';
import type { PackedPlacements } from '../../src/compiler/types.js';

// ─── The OLD builder, verbatim (pre-Aug-8 bvh.ts) — the reference twin ───────────
const BVH_LEAF_SIZE = 2;
const BVH_BINS = 12;
function emptyAABB(): AABB { return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; }
function growPoint(b: AABB, p: [number, number, number]): void {
    for (let a = 0; a < 3; a++) { if (p[a] < b.min[a]) b.min[a] = p[a]; if (p[a] > b.max[a]) b.max[a] = p[a]; }
}
function growAABB(b: AABB, o: AABB): void {
    for (let a = 0; a < 3; a++) { if (o.min[a] < b.min[a]) b.min[a] = o.min[a]; if (o.max[a] > b.max[a]) b.max[a] = o.max[a]; }
}
function surfaceArea(b: AABB): number {
    const dx = b.max[0] - b.min[0], dy = b.max[1] - b.min[1], dz = b.max[2] - b.min[2];
    if (dx < 0 || dy < 0 || dz < 0) return 0;
    return 2 * (dx * dy + dy * dz + dz * dx);
}
function referenceBuild(boxes: AABB[]): { nodes: Float32Array; nodeCount: number; order: Uint32Array; maxDepth: number } {
    const N = boxes.length;
    const cx = new Float32Array(N), cy = new Float32Array(N), cz = new Float32Array(N);
    for (let t = 0; t < N; t++) {
        cx[t] = (boxes[t].min[0] + boxes[t].max[0]) * 0.5;
        cy[t] = (boxes[t].min[1] + boxes[t].max[1]) * 0.5;
        cz[t] = (boxes[t].min[2] + boxes[t].max[2]) * 0.5;
    }
    const centroid = (t: number, a: number): number => (a === 0 ? cx[t] : a === 1 ? cy[t] : cz[t]);
    const order = new Uint32Array(N);
    for (let i = 0; i < N; i++) order[i] = i;
    const nodes: number[] = [];
    let maxDepth = 0;
    const emit = (start: number, end: number, depth: number): number => {
        if (depth > maxDepth) maxDepth = depth;
        const nodeIdx = nodes.length / 8;
        nodes.push(0, 0, 0, 0, 0, 0, 0, 0);
        const bounds = emptyAABB();
        for (let i = start; i < end; i++) growAABB(bounds, boxes[order[i]]);
        const count = end - start;
        const makeLeaf = () => {
            nodes[nodeIdx * 8 + 0] = bounds.min[0]; nodes[nodeIdx * 8 + 1] = bounds.min[1]; nodes[nodeIdx * 8 + 2] = bounds.min[2];
            nodes[nodeIdx * 8 + 3] = count;
            nodes[nodeIdx * 8 + 4] = bounds.max[0]; nodes[nodeIdx * 8 + 5] = bounds.max[1]; nodes[nodeIdx * 8 + 6] = bounds.max[2];
            nodes[nodeIdx * 8 + 7] = start;
        };
        if (count <= BVH_LEAF_SIZE) { makeLeaf(); return nodeIdx; }
        const cb = emptyAABB();
        for (let i = start; i < end; i++) growPoint(cb, [cx[order[i]], cy[order[i]], cz[order[i]]]);
        let bestAxis = -1, bestSplit = -1, bestCost = Infinity;
        for (let axis = 0; axis < 3; axis++) {
            const lo = cb.min[axis], hi = cb.max[axis];
            if (hi - lo < 1e-12) continue;
            const scale = BVH_BINS / (hi - lo);
            const binBox: AABB[] = Array.from({ length: BVH_BINS }, emptyAABB);
            const binCnt = new Int32Array(BVH_BINS);
            for (let i = start; i < end; i++) {
                const tri = order[i];
                let b = Math.floor((centroid(tri, axis) - lo) * scale);
                if (b < 0) b = 0; if (b >= BVH_BINS) b = BVH_BINS - 1;
                binCnt[b]++; growAABB(binBox[b], boxes[tri]);
            }
            const leftArea = new Float32Array(BVH_BINS - 1), leftCnt = new Int32Array(BVH_BINS - 1);
            const rightArea = new Float32Array(BVH_BINS - 1), rightCnt = new Int32Array(BVH_BINS - 1);
            let accBox = emptyAABB(), accCnt = 0;
            for (let b = 0; b < BVH_BINS - 1; b++) { growAABB(accBox, binBox[b]); accCnt += binCnt[b]; leftArea[b] = surfaceArea(accBox); leftCnt[b] = accCnt; }
            accBox = emptyAABB(); accCnt = 0;
            for (let b = BVH_BINS - 1; b > 0; b--) { growAABB(accBox, binBox[b]); accCnt += binCnt[b]; rightArea[b - 1] = surfaceArea(accBox); rightCnt[b - 1] = accCnt; }
            for (let b = 0; b < BVH_BINS - 1; b++) {
                if (leftCnt[b] === 0 || rightCnt[b] === 0) continue;
                const cost = leftArea[b] * leftCnt[b] + rightArea[b] * rightCnt[b];
                if (cost < bestCost) { bestCost = cost; bestAxis = axis; bestSplit = b; }
            }
        }
        const leafCost = surfaceArea(bounds) * count;
        if (bestAxis === -1 || bestCost >= leafCost) { makeLeaf(); return nodeIdx; }
        const lo = cb.min[bestAxis], scale = BVH_BINS / (cb.max[bestAxis] - cb.min[bestAxis]);
        let mid = start;
        for (let i = start; i < end; i++) {
            const tri = order[i];
            let b = Math.floor((centroid(tri, bestAxis) - lo) * scale);
            if (b < 0) b = 0; if (b >= BVH_BINS) b = BVH_BINS - 1;
            if (b <= bestSplit) { const tmp = order[i]; order[i] = order[mid]; order[mid] = tmp; mid++; }
        }
        if (mid === start || mid === end) mid = (start + end) >> 1;
        emit(start, mid, depth + 1);
        const rightIdx = emit(mid, end, depth + 1);
        nodes[nodeIdx * 8 + 0] = bounds.min[0]; nodes[nodeIdx * 8 + 1] = bounds.min[1]; nodes[nodeIdx * 8 + 2] = bounds.min[2];
        nodes[nodeIdx * 8 + 3] = -1 - bestAxis;
        nodes[nodeIdx * 8 + 4] = bounds.max[0]; nodes[nodeIdx * 8 + 5] = bounds.max[1]; nodes[nodeIdx * 8 + 6] = bounds.max[2];
        nodes[nodeIdx * 8 + 7] = rightIdx;
        return nodeIdx;
    };
    if (N > 0) emit(0, N, 0);
    return { nodes: new Float32Array(nodes), nodeCount: nodes.length / 8, order, maxDepth };
}
// ─────────────────────────────────────────────────────────────────────────────────

function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Random box set with f32-quantized inputs (as real feeders produce). */
function randomBoxes(n: number, seed: number): AABB[] {
    const r = rng(seed);
    const out: AABB[] = [];
    for (let i = 0; i < n; i++) {
        const cx = Math.fround((r() * 2 - 1) * 20), cy = Math.fround((r() * 2 - 1) * 20), cz = Math.fround((r() * 2 - 1) * 20);
        const hx = Math.fround(0.01 + r() * 0.5), hy = Math.fround(0.01 + r() * 0.5), hz = Math.fround(0.01 + r() * 0.5);
        out.push({ min: [cx - hx, cy - hy, cz - hz], max: [cx + hx, cy + hy, cz + hz] });
    }
    return out;
}

function expectSameBuild(a: ReturnType<typeof referenceBuild>, b: ReturnType<typeof referenceBuild>): void {
    expect(b.nodeCount).toBe(a.nodeCount);
    expect(b.maxDepth).toBe(a.maxDepth);
    expect(Array.from(b.order)).toEqual(Array.from(a.order));
    expect(Array.from(b.nodes)).toEqual(Array.from(a.nodes));
}

describe('flat SAH core ≡ the old object-based builder (byte gate)', () => {
    for (const [label, boxes] of [
        ['uniform 500', randomBoxes(500, 11)],
        ['uniform 4096', randomBoxes(4096, 22)],
        ['clustered (SAH stress)', (() => {
            const r = rng(33);
            const out: AABB[] = [];
            for (let c = 0; c < 8; c++) {
                const ox = (c & 1) * 30, oy = ((c >> 1) & 1) * 30, oz = ((c >> 2) & 1) * 30;
                for (let i = 0; i < 300; i++) {
                    const x = Math.fround(ox + r()), y = Math.fround(oy + r()), z = Math.fround(oz + r());
                    out.push({ min: [x, y, z], max: [x + 0.02, y + 0.02, z + 0.02] });
                }
            }
            return out;
        })()],
        ['identical centroids (degenerate)', Array.from({ length: 50 }, (_, i) => ({
            min: [0, 0, 0] as [number, number, number], max: [1 + i * 1e-7, 1, 1] as [number, number, number],
        }))],
        ['collinear on x', Array.from({ length: 200 }, (_, i) => ({
            min: [i, 0, 0] as [number, number, number], max: [i + 0.5, 1, 1] as [number, number, number],
        }))],
        ['tiny (1 item)', randomBoxes(1, 44)],
        ['leaf-edge (3 items)', randomBoxes(3, 55)],
    ] as const) {
        it(label, () => {
            expectSameBuild(referenceBuild(boxes as AABB[]), buildBVHNodes(boxes as AABB[]));
        });
    }

    it('mesh BLAS feeder (buildBVH) matches reference on its triangle boxes', () => {
        const r = rng(66);
        const T = 900;
        const positions = new Float32Array(3 * 3 * T);
        for (let i = 0; i < positions.length; i++) positions[i] = (r() * 2 - 1) * 10;
        const indices = new Uint32Array(3 * T);
        for (let i = 0; i < indices.length; i++) indices[i] = i;   // disjoint triangles
        const triBox: AABB[] = [];
        for (let t = 0; t < T; t++) {
            const box = emptyAABB();
            for (let k = 0; k < 3; k++) {
                const v = indices[t * 3 + k] * 3;
                growPoint(box, [positions[v], positions[v + 1], positions[v + 2]]);
            }
            triBox.push(box);
        }
        const ref = referenceBuild(triBox);
        const got = buildBVH(positions, indices);
        expect(got.nodeCount).toBe(ref.nodeCount);
        expect(Array.from(got.nodes)).toEqual(Array.from(ref.nodes));
    });
});

describe('pack feeder: inline corner transform ≡ transformAABB(similarityApplyPoint)', () => {
    const LOCAL: AABB = { min: [-1, -0.5, -1], max: [1, 0.7, 1] };

    function randomPacked(n: number, seed: number): PackedPlacements {
        const r = rng(seed);
        const positions = new Float32Array(3 * n), sizes = new Float32Array(n), orientations = new Float32Array(4 * n);
        for (let i = 0; i < n; i++) {
            positions[3 * i] = (r() * 2 - 1) * 15; positions[3 * i + 1] = (r() * 2 - 1) * 15; positions[3 * i + 2] = (r() * 2 - 1) * 15;
            sizes[i] = 0.05 + r();
            const u1 = r(), u2 = r() * 2 * Math.PI, u3 = r() * 2 * Math.PI;
            const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
            orientations[4 * i] = Math.fround(a * Math.sin(u2));
            orientations[4 * i + 1] = Math.fround(a * Math.cos(u2));
            orientations[4 * i + 2] = Math.fround(b * Math.sin(u3));
            orientations[4 * i + 3] = Math.fround(b * Math.cos(u3));
        }
        return { count: n, positions, sizes, orientations };
    }

    /** The OLD pack box path: per-instance Similarity + transformAABB + reference build. */
    function referencePackNodes(p: PackedPlacements): Float32Array {
        const boxes: AABB[] = [];
        for (let i = 0; i < p.count; i++) {
            const g: Similarity = {
                rotation: p.orientations !== undefined
                    ? quatNormalize([p.orientations[4 * i], p.orientations[4 * i + 1], p.orientations[4 * i + 2], p.orientations[4 * i + 3]])
                    : IDENTITY_QUAT,
                translation: [p.positions[3 * i], p.positions[3 * i + 1], p.positions[3 * i + 2]],
                scale: p.sizes !== undefined ? p.sizes[i] : 1,
            };
            boxes.push(transformAABB(LOCAL, (pt) => similarityApplyPoint(g, pt)));
        }
        const { nodes } = referenceBuild(boxes);
        return nodes;
    }

    it('packed arm: byte-identical nodes through the whole pack', () => {
        const p = randomPacked(700, 77);
        const got = packInstanceBatch(LOCAL, p);
        expect(Array.from(got.nodes.subarray(0, got.nodeCount * 8)))
            .toEqual(Array.from(referencePackNodes(p).subarray(0)));
    });

    it('Transform[] arm: byte-identical nodes through the whole pack', () => {
        const p = randomPacked(300, 88);
        const sims = Array.from({ length: p.count }, (_, i) => similarityFromTransform({
            position: [p.positions[3 * i], p.positions[3 * i + 1], p.positions[3 * i + 2]],
            rotation: [p.orientations![4 * i], p.orientations![4 * i + 1], p.orientations![4 * i + 2], p.orientations![4 * i + 3]] as [number, number, number, number],
            scale: p.sizes![i],
        }));
        const got = packInstanceBatch(LOCAL, sims);
        expect(Array.from(got.nodes.subarray(0, got.nodeCount * 8)))
            .toEqual(Array.from(referencePackNodes(p).subarray(0)));
    });

    it('flat-input core entry (buildBVHNodesFlat) matches the adapter', () => {
        const boxes = randomBoxes(256, 99);
        const flat = new Float64Array(6 * boxes.length);
        boxes.forEach((b, i) => {
            flat[6 * i] = b.min[0]; flat[6 * i + 1] = b.min[1]; flat[6 * i + 2] = b.min[2];
            flat[6 * i + 3] = b.max[0]; flat[6 * i + 4] = b.max[1]; flat[6 * i + 5] = b.max[2];
        });
        expectSameBuild(buildBVHNodes(boxes), buildBVHNodesFlat(flat, boxes.length));
    });
});
