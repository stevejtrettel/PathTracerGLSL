// tests/components/cwbvh.test.ts — the CWBVH core gates (fable-accel-cwbvh §7).
//
// Ground-truth strategy: the TS reference traversal (cwbvh.ts — the GLSL blueprint)
// is proven against BRUTE FORCE here; GLSL correctness then reduces to the bit-layout
// round-trip (decode mirrors pack) + the GPU equality witness.

import { describe, it, expect, vi } from 'vitest';
import {
    buildCWBVH,
    decodeCWBVHNode,
    cwbvhNearestRef,
    CWBVH_NODE_WORDS,
    CWBVH_MAX_PRIMS_PER_LEAF,
    CWBVH_MAX_PRIMS_PER_NODE,
    CWBVH_STACK_DEPTH,
} from '../../src/components/accel/cwbvh/cwbvh.js';

/** Seeded LCG (the perf-cloud pattern). */
function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** N random sphere boxes (center ± r) with distinct positions; returns boxes + the
 *  sphere params for brute-force ray tests. */
function sphereCloud(n: number, seed: number, extent = 10): { boxes: Float64Array; c: Float64Array; r: Float64Array } {
    const rnd = rng(seed);
    const boxes = new Float64Array(6 * n);
    const c = new Float64Array(3 * n), r = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        c[3 * i] = (rnd() * 2 - 1) * extent;
        c[3 * i + 1] = (rnd() * 2 - 1) * extent;
        c[3 * i + 2] = (rnd() * 2 - 1) * extent;
        r[i] = 0.05 + rnd() * 0.4;
        for (let a = 0; a < 3; a++) {
            boxes[6 * i + a] = c[3 * i + a] - r[i];
            boxes[6 * i + 3 + a] = c[3 * i + a] + r[i];
        }
    }
    return { boxes, c, r };
}

function raySphere(ro: number[], rd: number[], cx: number, cy: number, cz: number, rad: number): number {
    const ox = ro[0] - cx, oy = ro[1] - cy, oz = ro[2] - cz;
    const b = ox * rd[0] + oy * rd[1] + oz * rd[2];
    const cc = ox * ox + oy * oy + oz * oz - rad * rad;
    const disc = b * b - cc;   // rd assumed unit
    if (disc < 0) return Infinity;
    const s = Math.sqrt(disc);
    const t0 = -b - s, t1 = -b + s;
    if (t0 > 1e-4) return t0;
    if (t1 > 1e-4) return t1;
    return Infinity;
}

describe('cwbvh: structure invariants', () => {
    for (const n of [1, 2, 3, 7, 8, 25, 500]) {
        it(`every item exactly once; caps hold (n=${n})`, () => {
            const { boxes } = sphereCloud(n, 1000 + n);
            const w = buildCWBVH(boxes, n);
            expect(w.order.length).toBe(n);
            expect([...w.order].sort((a, b) => a - b)).toEqual([...Array(n).keys()]);
            expect(w.nodes.length).toBe(w.nodeCount * CWBVH_NODE_WORDS);
            for (let i = 0; i < w.nodeCount; i++) {
                const nd = decodeCWBVHNode(w.nodes, i);
                let items = 0, internal = 0;
                for (let s = 0; s < 8; s++) {
                    const m = nd.meta[s];
                    if (m === 0) {
                        expect(nd.qhi[s]).toBeLessThan(nd.qlo[s]);   // empty never intersects
                        continue;
                    }
                    const isInternal = (m & 0xe0) === 0x20 && (m & 0x1f) >= 24;
                    if (isInternal) {
                        expect((m & 0x1f) - 24).toBe(s);   // slot self-reference
                        expect((nd.imask >> s) & 1).toBe(1);
                        internal++;
                    } else {
                        const count = m >> 5 === 1 ? 1 : m >> 5 === 3 ? 2 : 7 === m >> 5 ? 3 : -1;
                        expect(count).toBeGreaterThan(0);
                        expect(count).toBeLessThanOrEqual(CWBVH_MAX_PRIMS_PER_LEAF);
                        expect((m & 0x1f) + count).toBeLessThanOrEqual(CWBVH_MAX_PRIMS_PER_NODE);
                        items += count;
                    }
                }
                expect(internal + (items > 0 ? 1 : 0)).toBeGreaterThan(0);   // no empty nodes
            }
        });
    }
});

describe('cwbvh: conservative quantization (boxes only grow, in f32 decode arithmetic)', () => {
    const contains = (w: ReturnType<typeof buildCWBVH>, childBoxF32: (nodeIdx: number, slot: number) => number[] | null): void => {
        for (let i = 0; i < w.nodeCount; i++) {
            const nd = decodeCWBVHNode(w.nodes, i);
            for (let s = 0; s < 8; s++) {
                const truth = childBoxF32(i, s);
                if (truth === null) continue;
                for (let a = 0; a < 3; a++) {
                    const lo = Math.fround(nd.p[a] + nd.qlo[8 * a + s] * nd.scale[a]);
                    const hi = Math.fround(nd.p[a] + nd.qhi[8 * a + s] * nd.scale[a]);
                    expect(lo).toBeLessThanOrEqual(truth[a]);
                    expect(hi).toBeGreaterThanOrEqual(truth[3 + a]);
                }
            }
        }
    };

    it('random cloud: decoded slot boxes contain the union of their items', () => {
        const n = 300;
        const { boxes } = sphereCloud(n, 7);
        const w = buildCWBVH(boxes, n);
        // Reconstruct each slot's true box from the items its subtree covers, by
        // brute force: walk the wide tree collecting item ranges per slot.
        const itemBox = (item: number): number[] => [...boxes.slice(6 * item, 6 * item + 6)];
        const slotItems = (nodeIdx: number, slot: number): number[] => {
            const nd = decodeCWBVHNode(w.nodes, nodeIdx);
            const m = nd.meta[slot];
            if (m === 0) return [];
            if ((m & 0xe0) === 0x20 && (m & 0x1f) >= 24) {
                // Internal: all items below the child node.
                let popc = 0;
                for (let s2 = 0; s2 < slot; s2++) popc += (nd.imask >> s2) & 1;
                const child = nd.childBase + popc;
                const out: number[] = [];
                for (let s2 = 0; s2 < 8; s2++) out.push(...slotItems(child, s2));
                return out;
            }
            const count = m >> 5 === 1 ? 1 : m >> 5 === 3 ? 2 : 3;
            const off = m & 0x1f;
            const out: number[] = [];
            for (let k = 0; k < count; k++) out.push(w.order[nd.primBase + off + k]);
            return out;
        };
        contains(w, (i, s) => {
            const items = slotItems(i, s);
            if (items.length === 0) return null;
            const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
            for (const it2 of items) {
                const ib = itemBox(it2);
                for (let a = 0; a < 3; a++) { b[a] = Math.min(b[a], ib[a]); b[3 + a] = Math.max(b[3 + a], ib[3 + a]); }
            }
            return b;
        });
    });

    it('adversarial extents: zero-width axes, tiny and huge boxes', () => {
        // Coplanar zero-thickness boxes (quads-as-items), a near-point box, a huge box.
        const raw = [
            [0, 0, 0, 1, 1, 0],                      // zero extent in z
            [2, 0, 0, 3, 1, 0],                      // same plane
            [5, 5, 5, 5 + 1e-30, 5 + 1e-30, 5],      // essentially a point
            [-1e6, -1e6, -1e6, 1e6, 1e6, 1e6],       // huge
            [0.1, 0.2, 0.3, 0.1, 0.2, 0.3],          // exact point
        ];
        const n = raw.length;
        const boxes = new Float64Array(raw.flat());
        const w = buildCWBVH(boxes, n);
        // Every ORIGINAL box must be contained by the decoded box of the slot its
        // item landed in (transitively — checked at the leaf slot).
        for (let i = 0; i < w.nodeCount; i++) {
            const nd = decodeCWBVHNode(w.nodes, i);
            for (let s = 0; s < 8; s++) {
                const m = nd.meta[s];
                if (m === 0 || ((m & 0xe0) === 0x20 && (m & 0x1f) >= 24)) continue;
                const count = m >> 5 === 1 ? 1 : m >> 5 === 3 ? 2 : 3;
                for (let k = 0; k < count; k++) {
                    const item = w.order[nd.primBase + (m & 0x1f) + k];
                    for (let a = 0; a < 3; a++) {
                        const lo = Math.fround(nd.p[a] + nd.qlo[8 * a + s] * nd.scale[a]);
                        const hi = Math.fround(nd.p[a] + nd.qhi[8 * a + s] * nd.scale[a]);
                        expect(lo).toBeLessThanOrEqual(boxes[6 * item + a]);
                        expect(hi).toBeGreaterThanOrEqual(boxes[6 * item + 3 + a]);
                    }
                }
            }
        }
    });
});

describe('cwbvh: reference traversal ≡ brute force', () => {
    for (const [n, seed] of [[50, 11], [300, 12], [1000, 13]] as const) {
        it(`nearest hits agree over random rays (n=${n})`, () => {
            const { boxes, c, r } = sphereCloud(n, seed);
            const w = buildCWBVH(boxes, n);
            const rnd = rng(seed * 7 + 1);
            let hits = 0;
            for (let q = 0; q < 200; q++) {
                const ro = [(rnd() * 2 - 1) * 25, (rnd() * 2 - 1) * 25, (rnd() * 2 - 1) * 25];
                // Aim at a random sphere with jitter — random directions at sparse
                // tiny spheres almost never hit, and the hit path is what's under test
                // (misses are exercised by the jitter overshoot + the aimed-past rays).
                const j = Math.floor(rnd() * n);
                let d = [
                    c[3 * j] + (rnd() * 2 - 1) * r[j] * 2 - ro[0],
                    c[3 * j + 1] + (rnd() * 2 - 1) * r[j] * 2 - ro[1],
                    c[3 * j + 2] + (rnd() * 2 - 1) * r[j] * 2 - ro[2],
                ];
                const len = Math.hypot(d[0], d[1], d[2]) || 1;
                d = [d[0] / len, d[1] / len, d[2] / len];
                // Brute force nearest.
                let bt = Infinity, bi = -1;
                for (let i = 0; i < n; i++) {
                    const t = raySphere(ro, d, c[3 * i], c[3 * i + 1], c[3 * i + 2], r[i]);
                    if (t < bt) { bt = t; bi = i; }
                }
                const res = cwbvhNearestRef(w, ro as [number, number, number], d as [number, number, number],
                    (item, tmax) => {
                        const t = raySphere(ro, d, c[3 * item], c[3 * item + 1], c[3 * item + 2], r[item]);
                        return t < tmax ? t : Infinity;
                    });
                expect(res.item).toBe(bi);
                if (bi >= 0) { expect(res.t).toBeCloseTo(bt, 9); hits++; }
            }
            expect(hits).toBeGreaterThan(20);   // the ray set genuinely exercises hits
        });
    }

    it('octant ordering visits near children first (t-pruning effectiveness)', () => {
        // A LONG line of spheres along +x (3+ tree levels): a +x ray entering at the
        // near end finds sphere 0 via the octant order, and t-pruning then culls the
        // far subtrees — queued SIBLING groups are still visited once each (the group
        // scheme tests children when their parent is opened, one level up from the
        // improved tmax), but their sub-trees never open. The walk must therefore
        // touch a small fraction of the tree, not half of it.
        const n = 512;
        const boxes = new Float64Array(6 * n);
        const c = new Float64Array(3 * n), r = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            c[3 * i] = i * 2; c[3 * i + 1] = 0; c[3 * i + 2] = 0; r[i] = 0.5;
            for (let a = 0; a < 3; a++) { boxes[6 * i + a] = c[3 * i + a] - 0.5; boxes[6 * i + 3 + a] = c[3 * i + a] + 0.5; }
        }
        const w = buildCWBVH(boxes, n);
        const test = (ro: [number, number, number], rd: [number, number, number]) =>
            cwbvhNearestRef(w, ro, rd, (item, tmax) => {
                const t = raySphere(ro, rd, c[3 * item], c[3 * item + 1], c[3 * item + 2], r[item]);
                return t < tmax ? t : Infinity;
            });
        const along = test([-5, 0, 0], [1, 0, 0]);       // hits sphere 0 immediately
        expect(along.item).toBe(0);
        expect(along.visitedNodes).toBeLessThan(w.nodeCount / 4);
    });

    it('empty and single-item trees', () => {
        expect(buildCWBVH(new Float64Array(0), 0).nodeCount).toBe(0);
        const one = buildCWBVH(new Float64Array([0, 0, 0, 1, 1, 1]), 1);
        expect(one.nodeCount).toBe(1);
        const res = cwbvhNearestRef(one, [0.5, 0.5, -5], [0, 0, 1], () => 5.5);
        expect(res.item).toBe(0);
        expect(res.t).toBe(5.5);
    });
});

// Coincident centroids (duplicate rows in a cloud, concentric shells) made the binary
// collapse input keep multi-item leaves; four or more broke the DP and the build threw
// (Sep 25 2026 audit). The input tree now splits every range down to single items.
describe('cwbvh: coincident centroids', () => {
    it('builds over 4 identical boxes and over a cloud with one point repeated 5 times', () => {
        const same = new Float64Array(6 * 4);
        for (let i = 0; i < 4; i++) same.set([-1, -1, -1, 1, 1, 1], 6 * i);
        expect(buildCWBVH(same, 4).order.length).toBe(4);

        const { boxes } = sphereCloud(1000, 77);
        for (let i = 1; i <= 5; i++) boxes.set(boxes.subarray(0, 6), 6 * i);   // items 1..5 = item 0
        const w = buildCWBVH(boxes, 1000);
        expect([...w.order].sort((a, b) => a - b)).toEqual([...Array(1000).keys()]);
    });
});

describe('CWBVH stack depth', () => {
    it('a 50k-item cloud sits far below the walk\'s stack, and builds without the depth warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { boxes } = sphereCloud(50_000, 7);
        const t = buildCWBVH(boxes, 50_000);
        expect(t.maxDepth).toBeLessThan(CWBVH_STACK_DEPTH / 2);
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});
