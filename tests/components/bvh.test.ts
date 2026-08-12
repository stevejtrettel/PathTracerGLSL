// tests/components/bvh.test.ts — the binned-SAH BVH builder (impl-plan-mesh-bvh).
// Pure-TS validation BEFORE any GLSL: structural invariants + a brute-vs-BVH nearest-hit
// cross-check (the TS traversal mirror must visit the same nearest triangle brute force finds).

import { describe, it, expect } from 'vitest';
import { buildBVH } from '../../src/components/accel/bvh/bvh.js';

type V3 = [number, number, number];

// Deterministic PRNG (no Math.random → reproducible failures).
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** A random triangle soup: N triangles with vertices scattered in a cube. */
function randomMesh(N: number, seed: number): { positions: Float32Array; indices: Uint32Array } {
    const r = rng(seed);
    const pos: number[] = [];
    const idx: number[] = [];
    for (let t = 0; t < N; t++) {
        const cx = r() * 10 - 5, cy = r() * 10 - 5, cz = r() * 10 - 5;   // triangle near a random centre
        const base = pos.length / 3;
        for (let k = 0; k < 3; k++) pos.push(cx + r() * 2 - 1, cy + r() * 2 - 1, cz + r() * 2 - 1);
        idx.push(base, base + 1, base + 2);
    }
    return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

function rayTri(ro: V3, rd: V3, a: V3, b: V3, c: V3): number {
    const e1: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const det = -(rd[0] * n[0] + rd[1] * n[1] + rd[2] * n[2]);
    if (Math.abs(det) < 1e-12) return Infinity;
    const inv = 1 / det;
    const ao: V3 = [ro[0] - a[0], ro[1] - a[1], ro[2] - a[2]];
    const dao: V3 = [ao[1] * rd[2] - ao[2] * rd[1], ao[2] * rd[0] - ao[0] * rd[2], ao[0] * rd[1] - ao[1] * rd[0]];
    const u = (e2[0] * dao[0] + e2[1] * dao[1] + e2[2] * dao[2]) * inv;
    const v = -(e1[0] * dao[0] + e1[1] * dao[1] + e1[2] * dao[2]) * inv;
    const t = (ao[0] * n[0] + ao[1] * n[1] + ao[2] * n[2]) * inv;
    const w = 1 - u - v;
    const E = 1e-6;
    if (u >= -E && v >= -E && w >= -E && t > 1e-4) return t;
    return Infinity;
}

function vert(pos: Float32Array, i: number): V3 { return [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]; }

function bruteNearest(pos: Float32Array, idx: Uint32Array, ro: V3, rd: V3): number {
    let best = Infinity;
    for (let t = 0; t < idx.length / 3; t++) {
        const d = rayTri(ro, rd, vert(pos, idx[t * 3]), vert(pos, idx[t * 3 + 1]), vert(pos, idx[t * 3 + 2]));
        if (d < best) best = d;
    }
    return best;
}

function aabbHit(bmin: V3, bmax: V3, ro: V3, rd: V3, tmax: number): boolean {
    let tn = 0, tf = tmax;
    for (let a = 0; a < 3; a++) {
        const inv = 1 / rd[a];
        let t0 = (bmin[a] - ro[a]) * inv, t1 = (bmax[a] - ro[a]) * inv;
        if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
        if (t0 > tn) tn = t0; if (t1 < tf) tf = t1;
    }
    return tf >= tn;
}

/** TS mirror of the GLSL BVH walk — traverse the built nodes + reindexed triangles. */
function bvhNearest(nodes: Float32Array, reidx: Uint32Array, pos: Float32Array, ro: V3, rd: V3): number {
    let tmax = Infinity;
    const stack: number[] = [0];
    while (stack.length) {
        const ni = stack.pop()!;
        const o = ni * 8;
        const bmin: V3 = [nodes[o], nodes[o + 1], nodes[o + 2]];
        const bmax: V3 = [nodes[o + 4], nodes[o + 5], nodes[o + 6]];
        if (!aabbHit(bmin, bmax, ro, rd, tmax)) continue;
        const A = nodes[o + 3];
        if (A >= 0) {
            const count = A, offset = nodes[o + 7];
            for (let i = offset; i < offset + count; i++) {
                const d = rayTri(ro, rd, vert(pos, reidx[i * 3]), vert(pos, reidx[i * 3 + 1]), vert(pos, reidx[i * 3 + 2]));
                if (d < tmax) tmax = d;
            }
        } else {
            stack.push(ni + 1, nodes[o + 7]);   // left (implicit), right
        }
    }
    return tmax;
}

describe('buildBVH', () => {
    it('leaf ranges exactly partition [0, T) and every node bounds contains its triangles', () => {
        const { positions, indices } = randomMesh(300, 1);
        const T = indices.length / 3;
        const { nodes, nodeCount, reindexedTriangles } = buildBVH(positions, indices);

        const leaves: Array<[number, number]> = [];
        for (let ni = 0; ni < nodeCount; ni++) {
            const o = ni * 8, A = nodes[o + 3];
            if (A >= 0) {
                leaves.push([nodes[o + 7], nodes[o + 7] + A]);
                // bounds contain the leaf's triangles
                for (let i = nodes[o + 7]; i < nodes[o + 7] + A; i++) {
                    for (let k = 0; k < 3; k++) {
                        const v = vert(positions, reindexedTriangles[i * 3 + k]);
                        for (let a = 0; a < 3; a++) {
                            expect(v[a]).toBeGreaterThanOrEqual(nodes[o + a] - 1e-4);
                            expect(v[a]).toBeLessThanOrEqual(nodes[o + 4 + a] + 1e-4);
                        }
                    }
                }
            } else {
                const right = nodes[o + 7];
                expect(ni + 1).toBeLessThan(nodeCount);   // left child exists
                expect(right).toBeGreaterThan(ni);        // right child ahead, in range
                expect(right).toBeLessThan(nodeCount);
            }
        }
        // Leaves, sorted by offset, tile [0, T) with no gap/overlap.
        leaves.sort((a, b) => a[0] - b[0]);
        let cursor = 0;
        for (const [start, end] of leaves) { expect(start).toBe(cursor); expect(end).toBeGreaterThan(start); cursor = end; }
        expect(cursor).toBe(T);
    });

    it('brute-force and BVH find the SAME nearest hit for random rays', () => {
        const { positions, indices } = randomMesh(400, 7);
        const { nodes, reindexedTriangles } = buildBVH(positions, indices);
        const r = rng(99);
        let tested = 0;
        for (let s = 0; s < 500; s++) {
            const ro: V3 = [r() * 20 - 10, r() * 20 - 10, r() * 20 - 10];
            let rd: V3 = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1];
            const l = Math.hypot(...rd) || 1; rd = [rd[0] / l, rd[1] / l, rd[2] / l];
            const brute = bruteNearest(positions, indices, ro, rd);
            const bvh = bvhNearest(nodes, reindexedTriangles, positions, ro, rd);
            if (brute === Infinity) { expect(bvh).toBe(Infinity); }
            else { expect(Math.abs(brute - bvh)).toBeLessThan(1e-3); tested++; }
        }
        expect(tested).toBeGreaterThan(20);   // the rays actually hit geometry sometimes
    });

    it('handles a single-triangle mesh (root is a leaf)', () => {
        const { nodes, nodeCount, reindexedTriangles } = buildBVH(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint32Array([0, 1, 2]));
        expect(nodeCount).toBe(1);
        expect(nodes[3]).toBe(1);   // A = count = 1 (leaf)
        expect(nodes[7]).toBe(0);   // offset 0
        expect(Array.from(reindexedTriangles)).toEqual([0, 1, 2]);
    });
});

// ── The POINT walk's traversal semantics (regression, Aug 11) ────────────────────
// bvhPointWalkLines emits GLSL, so nothing here executes it — but the property that
// broke is a property of the TRAVERSAL, not of the text, and it is checkable in TS
// against the same node array the GLSL reads. The bug: the walk took n1.w as the LEFT
// child and reconstructed the sibling as l + 1, whereas buildBVHCore stores n1.w = the
// RIGHT child with the LEFT implicit at ni + 1. It therefore descended the right subtree
// twice and NEVER VISITED THE LEFT ONE.
//
// It hid for months because a missed containment is only observable where region
// IDENTITY is read (ior_of, current_medium) and the walk's only consumers were opaque
// tabled scenes — a wrong region there changes no pixel. The invariant below is the one
// that fails immediately under the old indexing, with no GPU and no scene:
//
//    every item whose BOX contains p must be visited by the descent.
//
// (Sufficient, not merely necessary: a point outside a leaf's box cannot be inside the
// object that box bounds, so visiting every box-containing leaf is exactly the
// candidate set containment needs.)

/** TS mirror of the GLSL point walk — the SAME node decoding bvhPointWalkLines emits. */
function pointWalkVisits(nodes: Float32Array, p: V3): Set<number> {
    const visited = new Set<number>();
    const stack: number[] = [0];
    while (stack.length > 0) {
        const ni = stack.pop()!;
        const mn: V3 = [nodes[ni * 8], nodes[ni * 8 + 1], nodes[ni * 8 + 2]];
        const mx: V3 = [nodes[ni * 8 + 4], nodes[ni * 8 + 5], nodes[ni * 8 + 6]];
        const A = nodes[ni * 8 + 3], B = nodes[ni * 8 + 7];
        const inside = p[0] >= mn[0] && p[1] >= mn[1] && p[2] >= mn[2]
            && p[0] <= mx[0] && p[1] <= mx[1] && p[2] <= mx[2];
        if (!inside) continue;
        if (A >= 0) {
            for (let j = 0; j < A; j++) visited.add(B + j);   // leaf: [off, off + cnt)
        } else {
            stack.push(ni + 1, B);                            // LEFT implicit, RIGHT = B
        }
    }
    return visited;
}

describe('BVH point walk visits every box that contains the point', () => {
    it('finds the full candidate set on a tree with many internal nodes', async () => {
        const { buildBVHNodesFlat } = await import('../../src/components/accel/bvh/bvh.js');
        const r = rng(20260811);
        const N = 64;   // deep enough that most items sit in LEFT subtrees — 1-2 items would hide the bug
        const boxes = new Float64Array(6 * N);
        for (let i = 0; i < N; i++) {
            const cx = r() * 10 - 5, cy = r() * 10 - 5, cz = r() * 10 - 5;
            const h = 0.3 + r() * 0.9;
            boxes[6 * i] = cx - h; boxes[6 * i + 1] = cy - h; boxes[6 * i + 2] = cz - h;
            boxes[6 * i + 3] = cx + h; boxes[6 * i + 4] = cy + h; boxes[6 * i + 5] = cz + h;
        }
        const { nodes, order } = buildBVHNodesFlat(boxes, N);

        let probesWithHits = 0;
        for (let s = 0; s < 3000; s++) {
            const p: V3 = [r() * 12 - 6, r() * 12 - 6, r() * 12 - 6];
            // Brute force: which ORIGINAL items contain p?
            const expected = new Set<number>();
            for (let i = 0; i < N; i++) {
                if (p[0] >= boxes[6 * i] && p[1] >= boxes[6 * i + 1] && p[2] >= boxes[6 * i + 2]
                    && p[0] <= boxes[6 * i + 3] && p[1] <= boxes[6 * i + 4] && p[2] <= boxes[6 * i + 5]) {
                    expected.add(i);
                }
            }
            if (expected.size === 0) continue;
            probesWithHits++;
            // The walk reports LEAF-ORDER slots; `order` maps them back to original items.
            const got = new Set([...pointWalkVisits(nodes, p)].map((slot) => order[slot]));
            for (const item of expected) {
                expect(got.has(item), `point (${p.map((v) => v.toFixed(2)).join(', ')}) is inside item ${item}, but the descent never visited it`).toBe(true);
            }
        }
        // The probes have to actually land inside things, or the loop proves nothing.
        expect(probesWithHits).toBeGreaterThan(200);
    });
});
