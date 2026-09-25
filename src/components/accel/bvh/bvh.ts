// components/accel/bvh/bvh.ts — binned-SAH BVH builder (impl-plan-mesh-bvh v1; audit
// batch 3 moved it to accel/ — the spatial-index SUBSTRATE family; typed-array core
// Aug 8 2026 — the fable-instance-clouds §8 "~500k+ dataset" trigger, fired by
// steiner/crixxi/octic at 724k/745k/1.4M).
//
// Pure TS ("precompute the HOW" — the GPU consumes a flat node array, never builds).
// `buildBVHNodesFlat` is the SAH core over ANY flat AABB list — one builder, many
// feeders: the mesh BLAS (triangle boxes, `buildBVH` below), the instance TLAS
// (placement boxes, intersection/instancing), and whatever indexes next. Build is
// shared and execution-agnostic; QUERIES live with their domains (the ray walks read
// this node layout via accel/bvh/bvh.glsl + the generated TLAS walk).
//
// ALLOCATION DISCIPLINE (the Aug 8 rewrite): the old core built per-item AABB objects,
// per-split bin-box object arrays, and a growing number[] — tens of millions of
// short-lived allocations at 1M items, and GC dominated build time. This core touches
// ONLY preallocated flat arrays. The ALGORITHM is unchanged and every float op keeps
// its original order/precision (f64 box math, f32 centroid/area stores — matching the
// old object fields), so output is BYTE-IDENTICAL to the previous builder — enforced
// by the reference-twin gate in tests/components/bvhFlat.test.ts.
//
// Node encoding (2 RGBA32F texels — no bit-packing, no usampler2D; impl-plan-mesh-bvh §3):
//   texel 0 = (min.x, min.y, min.z, A)
//   texel 1 = (max.x, max.y, max.z, B)
//   A >= 0  → LEAF:     count = A,  offset = B
//   A <  0  → INTERNAL: splitAxis = -A - 1 (0|1|2),  rightChild = B,  leftChild = nodeIdx + 1

export const BVH_LEAF_SIZE = 2;   // stop splitting at ≤ this many triangles
/** Leaf size for the instance-cloud TLAS — MEASURED, not assumed (the accel research
 *  batch, Aug 9 2026). The collapsing argument (Meister 2021 §4.6: cheap primitives →
 *  bigger leaves) predicted 4–8 should win; the perf-cloud sweep REFUTED it:
 *  200k spheres @512², params tier, M1 Pro — leaf 2: 31.3, leaf 4: 32.9, leaf 8:
 *  38.1 ms/frame. With t-pruned ordered traversal a sphere test (1 texel + quadratic)
 *  costs about as much as a node step, so the tree's extra culling beats the saved
 *  fetches — the implicit c_node ≈ c_prim of the plain area·count SAH matches this
 *  hardware. Kept separate from BVH_LEAF_SIZE so the next accel occupant can re-run
 *  the sweep without touching mesh BLAS trees. */
export const TLAS_LEAF_SIZE = 2;
export const BVH_BINS = 12;       // SAH candidate planes per axis
/** GLSL traversal stack depth (bvh.glsl). A well-balanced SAH tree needs ~2·log₂(N)+slack,
 *  so 64 covers millions of items; buildBVHNodesFlat warns if a (degenerate) tree would
 *  exceed it — the walk guards against overflow but would silently drop subtrees past the
 *  stack. ONE source: the feature emits `#define BVH_STACK_DEPTH` from this const. */
export const BVH_STACK_DEPTH = 64;
/** The Ize 2013 far-plane pad (~2 ulps): fp32 slab arithmetic can shrink the interval so
 *  tf < tn by an ulp on a true hit — the multiply keeps the interval alive. Conservative
 *  only. ONE source for every slab test: the feature emits `#define BVH_TFAR_PAD` from
 *  this const (bvh.glsl + the cwbvh walk read the define; cwbvhNearestRef reads this). */
export const BVH_TFAR_PAD = 1.00000024;

/** The binary-BVH stack-DFS walk skeleton — THE one emitter for every generated walk over
 *  the 2-texel node format on `u_data_nodes` (the instance TLAS occupant AND the scene-table
 *  walks; the walk-emitter consolidation, Aug 10 2026 — this skeleton previously existed as
 *  byte-identical copies, and one static sibling had already drifted). Lines are emitted at
 *  4-space function-body indent. `nodesBase` is the walk's baked node region base; `bound`
 *  is the pruning distance expression (`hit.t` nearest / `maxDist` any); `leafRange` lines
 *  land inside the leaf branch (relative indent 0) with `off`/`cnt` in scope. `range`
 *  swaps the slab test for its entry/exit form, putting `lt0`/`lt1` (the node-box ray
 *  interval) in leaf scope — the LEAF_SDF march consumes it (impl-plan-sdf-accel T3). */
export function bvhWalkLines(nodesBase: number, bound: string, leafRange: string[], range = false): string[] {
    return [
        '    vec3 inv = 1.0 / ray.direction;   // hoisted — the slab test takes it',
        '    int stack[BVH_STACK_DEPTH]; int ptr = 0; stack[0] = 0;',
        '    while (ptr >= 0) {',
        '        int ni = stack[ptr]; ptr--;',
        `        vec4 n0 = texelFetch(u_data_nodes, data_texel1d(uint(${nodesBase} + ni * 2)), 0);`,
        `        vec4 n1 = texelFetch(u_data_nodes, data_texel1d(uint(${nodesBase} + ni * 2 + 1)), 0);`,
        ...(range
            ? ['        float lt0, lt1;',
               `        if (!bvh_aabb_hit_range(n0.xyz, n1.xyz, ray.origin, inv, ${bound}, lt0, lt1)) continue;`]
            : [`        if (!bvh_aabb_hit(n0.xyz, n1.xyz, ray.origin, inv, ${bound})) continue;`]),
        '        if (n0.w >= 0.0) {',
        '            int off = int(n1.w), cnt = int(n0.w);',
        ...leafRange.map((l) => '            ' + l),
        '        } else {',
        '            int axis = int(-n0.w - 1.0); int L = ni + 1; int R = int(n1.w);',
        '            bool nf = ray.direction[axis] >= 0.0;',
        '            if (ptr + 2 < BVH_STACK_DEPTH) { stack[++ptr] = nf ? R : L; stack[++ptr] = nf ? L : R; }',
        '        }',
        '    }',
    ];
}

export interface BVHResult {
    /** Flat node array, 8 floats per node (2 RGBA32F texels). */
    nodes: Float32Array;
    nodeCount: number;
    /** Triangle vertex indices re-emitted in BVH-leaf order (length 3·T) — the new index texture. */
    reindexedTriangles: Uint32Array;
    /** Max stack depth a DFS traversal needs (for sizing BVH_STACK_DEPTH). */
    maxDepth: number;
    /** The root node's local AABB — the prototype box when this mesh is an instance prototype. */
    rootBox: AABB;
}

interface AABB { min: [number, number, number]; max: [number, number, number]; }

function emptyAABB(): AABB { return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; }
function growPoint(b: AABB, p: [number, number, number]): void {
    for (let a = 0; a < 3; a++) { if (p[a] < b.min[a]) b.min[a] = p[a]; if (p[a] > b.max[a]) b.max[a] = p[a]; }
}
/** The binned-SAH build MECHANICS, shared by every tree this family builds (the builder
 *  consolidation, Aug 10 2026 — the light tree previously forked ~150 lines of this
 *  scaffolding, with an accidentally O(BINS²) sweep). One recursion, parameterized by
 *  exactly the two mathematical inputs the builds differ in — the per-item WEIGHT in the
 *  split cost (omitted → count: Σ1 is exact in f64, so the weighted cost degenerates
 *  bit-for-bit to the old area·count cost — the byte gate holds) and the STOP policy
 *  (leafSize / alwaysSplit / the depth-capped sorted-median fallback) — plus emit
 *  callbacks so each feeder owns its node format. Flat scalars throughout (the Aug 8
 *  allocation discipline). */
interface BVHCoreOpts {
    leafSize: number;
    /** Per-item split-cost weight (the light tree's Φ). Omitted → count-weighted SAH. */
    weights?: Float64Array;
    /** Never stop by SAH choice above leafSize (leaf-size-1 trees split ALWAYS; where SAH
     *  finds no plane the fallback splits). */
    alwaysSplit?: boolean;
    /** Depth cap (the light tree's 48-level trail bound): while depth + ⌈log₂ count⌉ would
     *  exceed it, splits go through the balanced fallback — depth ≤ cap by construction. */
    depthCap?: number;
    /** Fallback split when SAH has no plane (or the cap bites): 'median' halves the range
     *  as-is (the ray builder's degenerate guard); 'sorted-median' sorts the slice by
     *  centroid on the widest axis first (the light tree — coincident centroids become
     *  power-proportional chains). */
    fallback: 'median' | 'sorted-median';
    /** Leaf over order[start, start+count). Bounds are the node box; w = subtree weight
     *  (0 without weights); lo/hi = the 24+24-bit left/right trail down to this leaf. */
    emitLeaf(nodeIdx: number, start: number, count: number, mnx: number, mny: number, mnz: number, mxx: number, mxy: number, mxz: number, w: number, lo: number, hi: number, order: Uint32Array): void;
    /** Internal node, called AFTER both children emitted (left child = nodeIdx + 1). */
    emitInternal(nodeIdx: number, axis: number, rightIdx: number, mnx: number, mny: number, mnz: number, mxx: number, mxy: number, mxz: number, w: number): void;
}

function buildBVHCore(boxes: Float64Array, n: number, opts: BVHCoreOpts): { order: Uint32Array; nodeCount: number; maxDepth: number } {
    const { leafSize, weights, alwaysSplit = false, depthCap, fallback } = opts;
    // Centroids: f32 stores (matching the old core's Float32Array centroids exactly).
    const cx = new Float32Array(n), cy = new Float32Array(n), cz = new Float32Array(n);
    for (let t = 0; t < n; t++) {
        cx[t] = (boxes[6 * t] + boxes[6 * t + 3]) * 0.5;
        cy[t] = (boxes[6 * t + 1] + boxes[6 * t + 4]) * 0.5;
        cz[t] = (boxes[6 * t + 2] + boxes[6 * t + 5]) * 0.5;
    }
    // Hot loops select the axis ARRAY once, never per item (the old per-item
    // `centroid(t, axis)` closure was a branchy call in the innermost pass).
    const centroidOf = (a: number): Float32Array => (a === 0 ? cx : a === 1 ? cy : cz);

    // order[] is the working permutation of item ids; leaves become contiguous slices of it.
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;

    let nodeCount = 0;
    const bounds = new Float64Array(6);                 // current node's box
    const cb = new Float64Array(6);                     // centroid bounds
    const acc = new Float64Array(6);                    // sweep accumulator box
    const binBox = new Float64Array(3 * BVH_BINS * 6);   // all three axes, one binning pass
    const binCnt = new Int32Array(3 * BVH_BINS);
    const binW = new Float64Array(3 * BVH_BINS);         // per-bin weight (== count when unweighted)
    // f32 area stores — matching the old core's Float32Array sweeps (the SAH cost
    // comparisons happen on these f32-rounded values; keeping that keeps the tree).
    const leftArea = new Float32Array(BVH_BINS - 1), rightArea = new Float32Array(BVH_BINS - 1);
    const leftCnt = new Int32Array(BVH_BINS - 1), rightCnt = new Int32Array(BVH_BINS - 1);
    const leftW = new Float64Array(BVH_BINS - 1), rightW = new Float64Array(BVH_BINS - 1);
    let maxDepth = 0;

    const resetBox = (b: Float64Array, at: number): void => {
        b[at] = Infinity; b[at + 1] = Infinity; b[at + 2] = Infinity;
        b[at + 3] = -Infinity; b[at + 4] = -Infinity; b[at + 5] = -Infinity;
    };
    const growBox = (b: Float64Array, at: number, src: Float64Array, sat: number): void => {
        for (let a = 0; a < 3; a++) {
            if (src[sat + a] < b[at + a]) b[at + a] = src[sat + a];
            if (src[sat + 3 + a] > b[at + 3 + a]) b[at + 3 + a] = src[sat + 3 + a];
        }
    };
    const area = (b: Float64Array, at: number): number => {
        const dx = b[at + 3] - b[at], dy = b[at + 4] - b[at + 1], dz = b[at + 5] - b[at + 2];
        if (dx < 0 || dy < 0 || dz < 0) return 0;   // empty
        return 2 * (dx * dy + dy * dz + dz * dx);
    };
    const ceilLog2 = (c: number): number => (c <= 1 ? 0 : 32 - Math.clz32(c - 1));

    // Emit the subtree over order[start, end); returns the node's index. Left child is always the
    // node immediately after this one (implicit node+1), so we recurse LEFT first. lo/hi carry
    // the trail bits (LSB-first, 24 per half) — feeders without trails ignore them.
    const emit = (start: number, end: number, depth: number, lo: number, hi: number): number => {
        if (depth > maxDepth) maxDepth = depth;
        const nodeIdx = nodeCount++;

        // ONE fused pass: node bounds AND centroid bounds (independent min/max chains —
        // fusing cannot change either result) + the subtree weight when weighted.
        resetBox(bounds, 0);
        resetBox(cb, 0);
        let w = 0;
        for (let i = start; i < end; i++) {
            const t = order[i];
            const at = 6 * t;
            if (boxes[at] < bounds[0]) bounds[0] = boxes[at];
            if (boxes[at + 1] < bounds[1]) bounds[1] = boxes[at + 1];
            if (boxes[at + 2] < bounds[2]) bounds[2] = boxes[at + 2];
            if (boxes[at + 3] > bounds[3]) bounds[3] = boxes[at + 3];
            if (boxes[at + 4] > bounds[4]) bounds[4] = boxes[at + 4];
            if (boxes[at + 5] > bounds[5]) bounds[5] = boxes[at + 5];
            if (cx[t] < cb[0]) cb[0] = cx[t]; if (cx[t] > cb[3]) cb[3] = cx[t];
            if (cy[t] < cb[1]) cb[1] = cy[t]; if (cy[t] > cb[4]) cb[4] = cy[t];
            if (cz[t] < cb[2]) cb[2] = cz[t]; if (cz[t] > cb[5]) cb[5] = cz[t];
            if (weights !== undefined) w += weights[t];
        }
        const count = end - start;

        const makeLeaf = (): number => {
            opts.emitLeaf(nodeIdx, start, count, bounds[0], bounds[1], bounds[2], bounds[3], bounds[4], bounds[5], w, lo, hi, order);
            return nodeIdx;
        };

        if (count <= leafSize) return makeLeaf();

        // The depth cap: while slack = cap − depth − ⌈log₂ count⌉ > 0, SAH may skew freely
        // (worst case burns one slack level per split); at slack ≤ 0 the balanced split
        // preserves slack ≥ 0 down to the leaves — depth ≤ cap by construction.
        const balancedOnly = depthCap !== undefined && depth + ceilLog2(count) >= depthCap;

        // Binned SAH, best of all three axes. ALL THREE axes bin in ONE pass over the
        // range (the old core re-walked the range per axis — 3 passes). Per-axis bin
        // contents are accumulated in the same ascending item order as the per-axis
        // loops were, so every bin box/count — and hence every cost — is value-identical.
        let bestAxis = -1, bestSplit = -1, bestCost = Infinity;
        const v0 = cb[3] - cb[0] >= 1e-12, v1 = cb[4] - cb[1] >= 1e-12, v2 = cb[5] - cb[2] >= 1e-12;
        if (!balancedOnly && (v0 || v1 || v2)) {
            const s0 = v0 ? BVH_BINS / (cb[3] - cb[0]) : 0;
            const s1 = v1 ? BVH_BINS / (cb[4] - cb[1]) : 0;
            const s2 = v2 ? BVH_BINS / (cb[5] - cb[2]) : 0;
            const lo0 = cb[0], lo1 = cb[1], lo2 = cb[2];
            for (let b = 0; b < 3 * BVH_BINS; b++) { resetBox(binBox, 6 * b); binCnt[b] = 0; binW[b] = 0; }
            for (let i = start; i < end; i++) {
                const tri = order[i];
                const at = 6 * tri;
                const bx0 = boxes[at], bx1 = boxes[at + 1], bx2 = boxes[at + 2];
                const bx3 = boxes[at + 3], bx4 = boxes[at + 4], bx5 = boxes[at + 5];
                for (let axis = 0; axis < 3; axis++) {
                    let b: number;
                    if (axis === 0) { if (!v0) continue; b = Math.floor((cx[tri] - lo0) * s0); }
                    else if (axis === 1) { if (!v1) continue; b = Math.floor((cy[tri] - lo1) * s1); }
                    else { if (!v2) continue; b = Math.floor((cz[tri] - lo2) * s2); }
                    if (b < 0) b = 0; if (b >= BVH_BINS) b = BVH_BINS - 1;
                    const slot = axis * BVH_BINS + b;
                    binCnt[slot]++;
                    binW[slot] += weights !== undefined ? weights[tri] : 1;
                    const bt = 6 * slot;
                    if (bx0 < binBox[bt]) binBox[bt] = bx0;
                    if (bx1 < binBox[bt + 1]) binBox[bt + 1] = bx1;
                    if (bx2 < binBox[bt + 2]) binBox[bt + 2] = bx2;
                    if (bx3 > binBox[bt + 3]) binBox[bt + 3] = bx3;
                    if (bx4 > binBox[bt + 4]) binBox[bt + 4] = bx4;
                    if (bx5 > binBox[bt + 5]) binBox[bt + 5] = bx5;
                }
            }
            // Per-axis PREFIX/SUFFIX sweeps over the BVH_BINS-1 candidate planes (bins only —
            // cheap; the light tree's fork re-walked all bins per plane, ~12× the work).
            // Axis order ascending, bins ascending, strict `<` — the old tie-breaking.
            // Cost = A_L·w_L + A_R·w_R; unweighted w == count exactly (Σ1 exact in f64),
            // so this IS the old area·count cost bit-for-bit.
            for (let axis = 0; axis < 3; axis++) {
                if (axis === 0 ? !v0 : axis === 1 ? !v1 : !v2) continue;
                const base = axis * BVH_BINS;
                resetBox(acc, 0); let accCnt = 0; let accW = 0;
                for (let b = 0; b < BVH_BINS - 1; b++) {
                    growBox(acc, 0, binBox, 6 * (base + b)); accCnt += binCnt[base + b]; accW += binW[base + b];
                    leftArea[b] = area(acc, 0); leftCnt[b] = accCnt; leftW[b] = accW;
                }
                resetBox(acc, 0); accCnt = 0; accW = 0;
                for (let b = BVH_BINS - 1; b > 0; b--) {
                    growBox(acc, 0, binBox, 6 * (base + b)); accCnt += binCnt[base + b]; accW += binW[base + b];
                    rightArea[b - 1] = area(acc, 0); rightCnt[b - 1] = accCnt; rightW[b - 1] = accW;
                }
                for (let b = 0; b < BVH_BINS - 1; b++) {
                    if (leftCnt[b] === 0 || rightCnt[b] === 0) continue;
                    const cost = leftArea[b] * leftW[b] + rightArea[b] * rightW[b];
                    if (cost < bestCost) { bestCost = cost; bestAxis = axis; bestSplit = b; }
                }
            }
        }

        // SAH says don't split (or no valid split) → leaf — unless the feeder splits ALWAYS
        // (leaf-size-1 trees), where a plane-less range goes through the fallback instead.
        // (parentSA·w is the no-split cost; both sides miss the shared /parentSA factor.)
        if (!alwaysSplit) {
            const leafCost = area(bounds, 0) * (weights !== undefined ? w : count);
            if (bestAxis === -1 || bestCost >= leafCost) return makeLeaf();
        }

        let mid = -1;
        if (bestAxis !== -1) {
            // Partition order[start,end) by the winning axis/plane (Hoare-style in place).
            const plo = cb[bestAxis], scale = BVH_BINS / (cb[3 + bestAxis] - cb[bestAxis]);
            const cen = centroidOf(bestAxis);
            let m = start;
            for (let i = start; i < end; i++) {
                const tri = order[i];
                let b = Math.floor((cen[tri] - plo) * scale);
                if (b < 0) b = 0; if (b >= BVH_BINS) b = BVH_BINS - 1;
                if (b <= bestSplit) { const tmp = order[i]; order[i] = order[m]; order[m] = tmp; m++; }
            }
            if (m > start && m < end) mid = m;
        }
        if (mid === -1) {
            // Fallback split (no SAH plane / degenerate partition / the depth cap).
            if (fallback === 'sorted-median') {
                // Sort the slice by centroid along the widest axis and halve at the median.
                // With all-identical centroids the halves are arbitrary — boxes identical;
                // a weighted feeder's Φ sums keep the descent power-proportional (the
                // correct coincident-lights limit).
                const ext0 = cb[3] - cb[0], ext1 = cb[4] - cb[1], ext2 = cb[5] - cb[2];
                const axis = ext0 >= ext1 && ext0 >= ext2 ? 0 : ext1 >= ext2 ? 1 : 2;
                const cen = centroidOf(axis);
                const slice = Array.from(order.subarray(start, end));
                slice.sort((a, b) => cen[a] - cen[b]);
                order.set(slice, start);
            }
            mid = (start + end) >> 1;
        }

        // Emission fields cached BEFORE recursion (bounds/scratch are shared — children clobber them).
        const minx = bounds[0], miny = bounds[1], minz = bounds[2];
        const maxx = bounds[3], maxy = bounds[4], maxz = bounds[5];
        const rlo = depth < 24 ? lo | (1 << depth) : lo;
        const rhi = depth < 24 ? hi : hi | (1 << (depth - 24));
        emit(start, mid, depth + 1, lo, hi);   // left lands at nodeIdx + 1 (implicit — never stored); trail bit 0
        const rightIdx = emit(mid, end, depth + 1, rlo, rhi);   // right: bit 1 at this level

        opts.emitInternal(nodeIdx, bestAxis, rightIdx, minx, miny, minz, maxx, maxy, maxz, w);
        return nodeIdx;
    };

    if (n > 0) emit(0, n, 0, 0, 0);
    return { order, nodeCount, maxDepth };
}

/** The SAH core over a FLAT box list — `boxes` is 6 f64 per item (min.xyz, max.xyz).
 *  Float64Array deliberately: the old core held box coords as f64 object fields, and the
 *  SAH cost comparisons see f64 values — an f32 store here would perturb splits and break
 *  the byte gate. Returns the flat node array (2 texels/node) + the item ORDER permutation
 *  (leaves are contiguous ranges of it) + max depth. The caller re-emits its own per-item
 *  payload (triangle indices / placement rows) in `order`. A count-weighted feeder of
 *  buildBVHCore — output stays BYTE-IDENTICAL to the pre-consolidation builder (the
 *  bvhFlat reference-twin gate). */
export function buildBVHNodesFlat(boxes: Float64Array, n: number, leafSize: number = BVH_LEAF_SIZE, alwaysSplit: boolean = false): { nodes: Float32Array; nodeCount: number; order: Uint32Array; maxDepth: number } {
    // ONE allocation for the node array (≤ 2N−1 nodes over N leaves).
    const nodes = new Float32Array(n > 0 ? 8 * (2 * n - 1) : 0);
    const { order, nodeCount, maxDepth } = buildBVHCore(boxes, n, {
        leafSize,
        alwaysSplit,
        fallback: 'median',
        emitLeaf: (ni, start, count, mnx, mny, mnz, mxx, mxy, mxz) => {
            nodes[ni * 8 + 0] = mnx; nodes[ni * 8 + 1] = mny; nodes[ni * 8 + 2] = mnz;
            nodes[ni * 8 + 3] = count;         // A = count (>= 1 → leaf)
            nodes[ni * 8 + 4] = mxx; nodes[ni * 8 + 5] = mxy; nodes[ni * 8 + 6] = mxz;
            nodes[ni * 8 + 7] = start;         // B = offset
        },
        emitInternal: (ni, axis, rightIdx, mnx, mny, mnz, mxx, mxy, mxz) => {
            nodes[ni * 8 + 0] = mnx; nodes[ni * 8 + 1] = mny; nodes[ni * 8 + 2] = mnz;
            // A < 0 → internal, axis = -A-1. A fallback split has no SAH axis (−1), which would
            // encode A = 0 — an empty LEAF; the axis only orders the children, so use 0.
            nodes[ni * 8 + 3] = -1 - Math.max(axis, 0);
            nodes[ni * 8 + 4] = mxx; nodes[ni * 8 + 5] = mxy; nodes[ni * 8 + 6] = mxz;
            nodes[ni * 8 + 7] = rightIdx;      // B = right child index
        },
    });

    // The GLSL walk's fixed stack would silently drop subtrees past BVH_STACK_DEPTH (it guards the
    // array bound, so no crash — just missing geometry). Warn if a (near-)degenerate tree risks it.
    if (maxDepth >= BVH_STACK_DEPTH) {
        console.warn(`BVH depth ${maxDepth} >= BVH_STACK_DEPTH ${BVH_STACK_DEPTH} for ${n} items — the GLSL walk may drop deep subtrees; raise BVH_STACK_DEPTH or check for degenerate geometry.`);
    }

    // A VIEW, not a copy: `.slice` here copied ~90MB at 1.4M items (nodeCount ≈ 1.4N at
    // leaf size 2), doubling peak memory inside the pack worker right before transfer.
    // Every consumer handles views (App writes via subarray; the worker transfer moves
    // the whole underlying buffer — a move, not a copy). Accepted trade-off: a caller
    // that CACHES the result (App's packCached meshes) retains the oversized buffer —
    // bounded, since mesh BLAS node counts are far below cloud TLAS scale.
    return { nodes: nodes.subarray(0, nodeCount * 8), nodeCount, order, maxDepth };
}

/** The upper bound on binary-tree node count over `n` leaves-worth of items — a property
 *  of the tree, so it lives here (the ledger's float regions and cwbvh's integer regions
 *  both size by texelsPerNode × this). */
export function bvhNodeBound(n: number): number {
    return n > 0 ? 2 * n - 1 : 0;
}

export { buildBVHCore };
export type { BVHCoreOpts };

/** THE point-query walk (impl-plan-sdf-as-shape T6) — `bvhWalkLines`' sibling for
 *  classification rather than tracing: descend nodes whose box CONTAINS p, and run
 *  `leafRange` on the leaves that survive. Correct by containment: a point outside a
 *  leaf's box cannot be inside the object that box bounds, so a skipped leaf can never
 *  have claimed the point. Turns scene_region_at from a scan over every solid — one
 *  record fetch + field evaluation each, ONCE PER HIT — into a descent, which is what
 *  thousands of objects need. `off`/`cnt` are in scope inside the leaf branch. */
export function bvhPointWalkLines(nodesBase: number, leafRange: string[]): string[] {
    return [
        '    int stack[BVH_STACK_DEPTH]; int ptr = 0; stack[0] = 0;',
        '    while (ptr >= 0) {',
        '        int ni = stack[ptr]; ptr--;',
        `        vec4 n0 = texelFetch(u_data_nodes, data_texel1d(uint(${nodesBase} + ni * 2)), 0);`,
        `        vec4 n1 = texelFetch(u_data_nodes, data_texel1d(uint(${nodesBase} + ni * 2 + 1)), 0);`,
        '        if (!bvh_aabb_contains(n0.xyz, n1.xyz, p)) continue;',
        '        if (n0.w >= 0.0) {',
        '            int off = int(n1.w), cnt = int(n0.w);',
        ...leafRange.map((l) => '            ' + l),
        '        } else {',
        // The node layout is buildBVHCore's: LEFT is implicit at ni + 1 (never stored),
        // B = n1.w is the RIGHT child. This walk read n1.w as the left child and assumed
        // the sibling sat at l + 1, so it descended the right subtree twice and NEVER
        // VISITED THE LEFT ONE — silent for opaque tabled scenes (a missed containment
        // only matters where region identity is read: ior_of, current_medium), which is
        // why it survived until instanced dielectrics became its first real consumer
        // (glass instances in the left subtree reported no interior ⇒ η = 1 ⇒ invisible).
        // No traversal order here: containment visits every node whose box holds p.
        '            int L = ni + 1, R = int(n1.w);',
        '            if (ptr + 2 < BVH_STACK_DEPTH) { stack[++ptr] = L; stack[++ptr] = R; }',
        '        }',
        '    }',
    ];
}

/** Object-input adapter for callers holding AABB[] (App-side world boxes etc.). */
export function buildBVHNodes(boxes: AABB[], leafSize: number = BVH_LEAF_SIZE): { nodes: Float32Array; nodeCount: number; order: Uint32Array; maxDepth: number } {
    const n = boxes.length;
    const flat = new Float64Array(6 * n);
    for (let t = 0; t < n; t++) {
        flat[6 * t] = boxes[t].min[0]; flat[6 * t + 1] = boxes[t].min[1]; flat[6 * t + 2] = boxes[t].min[2];
        flat[6 * t + 3] = boxes[t].max[0]; flat[6 * t + 4] = boxes[t].max[1]; flat[6 * t + 5] = boxes[t].max[2];
    }
    return buildBVHNodesFlat(flat, n, leafSize);
}

/** BLAS: a BVH over a triangle mesh. Computes per-triangle boxes (flat — no per-triangle
 *  objects), runs the shared core, and re-emits the triangle index in leaf order. */
export function buildBVH(positions: Float32Array, indices: Uint32Array): BVHResult {
    const T = indices.length / 3;
    const triBox = new Float64Array(6 * T);
    for (let t = 0; t < T; t++) {
        let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
        for (let k = 0; k < 3; k++) {
            const v = indices[t * 3 + k] * 3;
            const x = positions[v], y = positions[v + 1], z = positions[v + 2];
            if (x < minx) minx = x; if (x > maxx) maxx = x;
            if (y < miny) miny = y; if (y > maxy) maxy = y;
            if (z < minz) minz = z; if (z > maxz) maxz = z;
        }
        triBox[6 * t] = minx; triBox[6 * t + 1] = miny; triBox[6 * t + 2] = minz;
        triBox[6 * t + 3] = maxx; triBox[6 * t + 4] = maxy; triBox[6 * t + 5] = maxz;
    }
    const { nodes, nodeCount, order, maxDepth } = buildBVHNodesFlat(triBox, T);

    const reindexedTriangles = new Uint32Array(T * 3);
    for (let i = 0; i < T; i++) {
        const tri = order[i];
        reindexedTriangles[i * 3 + 0] = indices[tri * 3 + 0];
        reindexedTriangles[i * 3 + 1] = indices[tri * 3 + 1];
        reindexedTriangles[i * 3 + 2] = indices[tri * 3 + 2];
    }
    return { nodes, nodeCount, reindexedTriangles, maxDepth, rootBox: rootBoxOf(nodes, nodeCount) };
}

/** The root node's world-space box (index 0), or an empty box for an empty tree. Used as the
 *  prototype-local AABB when a mesh is an instance prototype (transformed per placement → TLAS). */
export function rootBoxOf(nodes: Float32Array, nodeCount: number): AABB {
    if (nodeCount === 0) return emptyAABB();
    return { min: [nodes[0], nodes[1], nodes[2]], max: [nodes[4], nodes[5], nodes[6]] };
}

/** World AABB of a local box under a similarity (8-corner transform) — for TLAS leaf boxes. */
export function transformAABB(local: AABB, apply: (p: [number, number, number]) => [number, number, number]): AABB {
    const out = emptyAABB();
    for (let c = 0; c < 8; c++) {
        growPoint(out, apply([
            (c & 1) ? local.max[0] : local.min[0],
            (c & 2) ? local.max[1] : local.min[1],
            (c & 4) ? local.max[2] : local.min[2],
        ]));
    }
    return out;
}

export type { AABB };
