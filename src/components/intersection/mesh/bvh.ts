// components/intersection/mesh/bvh.ts — binned-SAH BVH builder (impl-plan-mesh-bvh v1).
//
// Pure TS ("precompute the HOW" — the GPU consumes a flat node array, never builds). Takes a
// mesh's LOCAL positions + triangle indices, returns a flattened depth-first node array (2 texels
// / 8 floats per node) plus the triangle index re-emitted in BVH-LEAF order (leaves reference a
// contiguous [offset, offset+count) range). The GLSL walk (mesh.glsl) reads exactly this layout.
//
// Node encoding (2 RGBA32F texels — no bit-packing, no usampler2D; impl-plan-mesh-bvh §3):
//   texel 0 = (min.x, min.y, min.z, A)
//   texel 1 = (max.x, max.y, max.z, B)
//   A >= 0  → LEAF:     count = A,  offset = B
//   A <  0  → INTERNAL: splitAxis = -A - 1 (0|1|2),  rightChild = B,  leftChild = nodeIdx + 1

export const BVH_LEAF_SIZE = 2;   // stop splitting at ≤ this many triangles
export const BVH_BINS = 12;       // SAH candidate planes per axis
/** GLSL traversal stack depth (bvh_common.glsl). A well-balanced SAH tree needs ~2·log₂(N)+slack,
 *  so 64 covers millions of items; buildBVHNodes warns if a (degenerate) tree would exceed it —
 *  the walk guards against overflow but would silently drop subtrees past the stack. ONE source:
 *  the feature emits `#define BVH_STACK_DEPTH` from this const. */
export const BVH_STACK_DEPTH = 64;

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
function growAABB(b: AABB, o: AABB): void {
    for (let a = 0; a < 3; a++) { if (o.min[a] < b.min[a]) b.min[a] = o.min[a]; if (o.max[a] > b.max[a]) b.max[a] = o.max[a]; }
}
function surfaceArea(b: AABB): number {
    const dx = b.max[0] - b.min[0], dy = b.max[1] - b.min[1], dz = b.max[2] - b.min[2];
    if (dx < 0 || dy < 0 || dz < 0) return 0;   // empty
    return 2 * (dx * dy + dy * dz + dz * dx);
}

/** The SAH BVH core over ANY list of item AABBs — shared by the BLAS (items = triangles) and the
 *  TLAS (items = instance/object boxes). Returns the flat node array (2 texels/node) + the item
 *  ORDER permutation (leaves are contiguous ranges of it) + max depth. The caller re-emits its own
 *  per-item payload (triangle indices / placement rows) in `order`. */
export function buildBVHNodes(boxes: AABB[]): { nodes: Float32Array; nodeCount: number; order: Uint32Array; maxDepth: number } {
    const N = boxes.length;
    const cx = new Float32Array(N), cy = new Float32Array(N), cz = new Float32Array(N);
    for (let t = 0; t < N; t++) {
        cx[t] = (boxes[t].min[0] + boxes[t].max[0]) * 0.5;
        cy[t] = (boxes[t].min[1] + boxes[t].max[1]) * 0.5;
        cz[t] = (boxes[t].min[2] + boxes[t].max[2]) * 0.5;
    }
    const centroid = (t: number, a: number): number => (a === 0 ? cx[t] : a === 1 ? cy[t] : cz[t]);

    // order[] is the working permutation of item ids; leaves become contiguous slices of it.
    const order = new Uint32Array(N);
    for (let i = 0; i < N; i++) order[i] = i;

    const nodes: number[] = [];
    let maxDepth = 0;

    // Emit the subtree over order[start, end); returns the node's index. Left child is always the
    // node immediately after this one (implicit node+1), so we recurse LEFT first.
    const emit = (start: number, end: number, depth: number): number => {
        if (depth > maxDepth) maxDepth = depth;
        const nodeIdx = nodes.length / 8;
        nodes.push(0, 0, 0, 0, 0, 0, 0, 0);   // placeholder (filled below)

        const bounds = emptyAABB();
        for (let i = start; i < end; i++) growAABB(bounds, boxes[order[i]]);
        const count = end - start;

        const makeLeaf = () => {
            nodes[nodeIdx * 8 + 0] = bounds.min[0]; nodes[nodeIdx * 8 + 1] = bounds.min[1]; nodes[nodeIdx * 8 + 2] = bounds.min[2];
            nodes[nodeIdx * 8 + 3] = count;         // A = count (>= 1 → leaf)
            nodes[nodeIdx * 8 + 4] = bounds.max[0]; nodes[nodeIdx * 8 + 5] = bounds.max[1]; nodes[nodeIdx * 8 + 6] = bounds.max[2];
            nodes[nodeIdx * 8 + 7] = start;         // B = offset
        };

        if (count <= BVH_LEAF_SIZE) { makeLeaf(); return nodeIdx; }

        // Binned SAH over the CENTROID bounds, best of all three axes.
        const cb = emptyAABB();
        for (let i = start; i < end; i++) growPoint(cb, [cx[order[i]], cy[order[i]], cz[order[i]]]);

        let bestAxis = -1, bestSplit = -1, bestCost = Infinity;
        for (let axis = 0; axis < 3; axis++) {
            const lo = cb.min[axis], hi = cb.max[axis];
            if (hi - lo < 1e-12) continue;   // degenerate on this axis — no useful split
            const scale = BVH_BINS / (hi - lo);
            const binBox: AABB[] = Array.from({ length: BVH_BINS }, emptyAABB);
            const binCnt = new Int32Array(BVH_BINS);
            for (let i = start; i < end; i++) {
                const tri = order[i];
                let b = Math.floor((centroid(tri, axis) - lo) * scale);
                if (b < 0) b = 0; if (b >= BVH_BINS) b = BVH_BINS - 1;
                binCnt[b]++; growAABB(binBox[b], boxes[tri]);
            }
            // Prefix (left) and suffix (right) sweeps over the BVH_BINS-1 candidate planes.
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

        // SAH says don't split (or no valid split) → leaf. (parentSA·count is the no-split cost;
        // compare the raw split cost against it, both missing the shared /parentSA factor.)
        const leafCost = surfaceArea(bounds) * count;
        if (bestAxis === -1 || bestCost >= leafCost) { makeLeaf(); return nodeIdx; }

        // Partition order[start,end) by the winning axis/plane (Hoare-style in place).
        const lo = cb.min[bestAxis], scale = BVH_BINS / (cb.max[bestAxis] - cb.min[bestAxis]);
        let mid = start;
        for (let i = start; i < end; i++) {
            const tri = order[i];
            let b = Math.floor((centroid(tri, bestAxis) - lo) * scale);
            if (b < 0) b = 0; if (b >= BVH_BINS) b = BVH_BINS - 1;
            if (b <= bestSplit) { const tmp = order[i]; order[i] = order[mid]; order[mid] = tmp; mid++; }
        }
        // Degenerate partition guard (all to one side despite a "valid" plane) → median split.
        if (mid === start || mid === end) mid = (start + end) >> 1;

        const leftIdx = emit(start, mid, depth + 1);   // === nodeIdx + 1 (implicit left)
        const rightIdx = emit(mid, end, depth + 1);
        void leftIdx;

        nodes[nodeIdx * 8 + 0] = bounds.min[0]; nodes[nodeIdx * 8 + 1] = bounds.min[1]; nodes[nodeIdx * 8 + 2] = bounds.min[2];
        nodes[nodeIdx * 8 + 3] = -1 - bestAxis;    // A < 0 → internal, axis = -A-1
        nodes[nodeIdx * 8 + 4] = bounds.max[0]; nodes[nodeIdx * 8 + 5] = bounds.max[1]; nodes[nodeIdx * 8 + 6] = bounds.max[2];
        nodes[nodeIdx * 8 + 7] = rightIdx;         // B = right child index
        return nodeIdx;
    };

    if (N > 0) emit(0, N, 0);

    // The GLSL walk's fixed stack would silently drop subtrees past BVH_STACK_DEPTH (it guards the
    // array bound, so no crash — just missing geometry). Warn if a (near-)degenerate tree risks it.
    if (maxDepth >= BVH_STACK_DEPTH) {
        console.warn(`BVH depth ${maxDepth} >= BVH_STACK_DEPTH ${BVH_STACK_DEPTH} for ${N} items — the GLSL walk may drop deep subtrees; raise BVH_STACK_DEPTH or check for degenerate geometry.`);
    }

    return { nodes: new Float32Array(nodes), nodeCount: nodes.length / 8, order, maxDepth };
}

/** BLAS: a BVH over a triangle mesh. Computes per-triangle boxes, runs the shared core, and
 *  re-emits the triangle index in leaf order. Byte-identical to the pre-refactor builder. */
export function buildBVH(positions: Float32Array, indices: Uint32Array): BVHResult {
    const T = indices.length / 3;
    const triBox: AABB[] = new Array(T);
    for (let t = 0; t < T; t++) {
        const box = emptyAABB();
        for (let k = 0; k < 3; k++) {
            const v = indices[t * 3 + k] * 3;
            growPoint(box, [positions[v], positions[v + 1], positions[v + 2]]);
        }
        triBox[t] = box;
    }
    const { nodes, nodeCount, order, maxDepth } = buildBVHNodes(triBox);

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
