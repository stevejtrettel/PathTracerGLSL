// components/accel/cwbvh/cwbvh.ts — the compressed wide (8-ary) BVH build core.
//
// TRANSCRIBED from Ylitie, Karras, Laine — "Efficient Incoherent Ray Traversal on
// GPUs through Compressed Wide BVHs" (HPG 2017); design authority + the declared
// deviations ledger: docs/fable-accel-cwbvh.md. Every equation reference below is to
// the paper. Pure TS (components purity): input is the SAME flat box list the binary
// builder takes; the binary binned-SAH tree (leaf size 1) is the collapse input, so
// there is ONE build-quality truth (bvh/bvh.ts) and this file only re-SHAPES it.
//
// Pipeline: binary SAH (leaf 1) → bottom-up collapse DP (Eq. 4–8) → slot assignment
// (Garanzha–Loop octant heuristic — declared deviation from the paper's auction
// solver, §3.4 "essentially identical") → conservative quantization (Eq. 1–2, floor
// lo / ceil hi against per-node power-of-two grids — boxes only GROW, so traversal
// is exact: extra tests, never missed hits) → the 80-byte node packed into 5 RGBA32UI
// texels (20 u32 per node; layout table in the design doc §2 — the GLSL decode
// mirrors it, pinned by the round-trip vitest).
//
// The node format (80 B):
//   u32[ 0.. 2]  p.xyz as floatBits          (quantization origin = node box lo)
//   u32[ 3]      e_x | e_y<<8 | e_z<<16 | imask<<24   (e = fp32 BIASED exponent byte)
//   u32[ 4]      child node base index
//   u32[ 5]      prim (leaf item) base index
//   u32[ 6..7]   meta[0..3], meta[4..7]      (per-slot byte, see metaByte below)
//   u32[ 8..13]  q_lo.x[8] q_lo.y[8] q_lo.z[8]  (4 bytes per u32, slot-indexed)
//   u32[14..19]  q_hi.x[8] q_hi.y[8] q_hi.z[8]
//
// meta byte: empty slot = 0; internal child = 0b001_(slot+24); leaf child =
// (unary count ≤ 3)<<5 | itemOffset (< 24). The +24 bias and unary counts make ONE
// hitmask insert (`hits |= (meta>>5) << bitIndex`) serve both child kinds (§4.3):
// internal bits land in 24..31 (slot ^ octinv keeps them there), leaf item bits land
// at their offsets in 0..23 — one bit per ITEM.

import { buildBVHNodesFlat, bvhNodeBound, BVH_TFAR_PAD } from '../bvh/bvh.js';

/** u32 words per packed wide node (5 RGBA32UI texels). */
export const CWBVH_NODE_WORDS = 20;
export const CWBVH_NODE_TEXELS = 5;
/** Leaf-child caps — fixed by the meta-byte encoding, not tunable (unary count in 3
 *  bits; item offsets addressable in 5 bits below the +24 internal bias). */
export const CWBVH_MAX_PRIMS_PER_LEAF = 3;
export const CWBVH_MAX_PRIMS_PER_NODE = 24;
/** Collapse SAH constants (paper §5.1). cPrim is a BUILD KNOB (design doc §4): the
 *  paper's 0.3 assumes triangles; our leaf-size sweep measured a params-tier sphere
 *  test ≈ a node step, so 1.0 is the second perf-witness arm. */
export const CWBVH_C_NODE = 1.0;
export const CWBVH_C_PRIM_DEFAULT = 0.3;
/** Wide-walk stack depth: tree depth is ~log₈ N (+ leaf groups), so 24 covers any
 *  realistic tree with a wide margin (the binary walk needs 64). */
export const CWBVH_STACK_DEPTH = 24;

/** Ledger padding bound (fable-data-rail §4 style): wide internal nodes branch ≥ 2
 *  (a DP distribute always yields ≥ 2 members) and item-carrying nodes number ≤ N,
 *  so nodeCount ≤ 2N−1; texels = 5 per node. The packer assertFits the real count. */
export function cwbvhNodeTexelBound(itemCount: number): number {
    return CWBVH_NODE_TEXELS * bvhNodeBound(itemCount);
}

export interface CWBVHResult {
    /** Packed nodes, CWBVH_NODE_WORDS u32 per node. */
    nodes: Uint32Array;
    nodeCount: number;
    /** Item permutation: wide-leaf order → original item index (the binary builder's
     *  `order` contract — callers re-emit per-item payloads in this order). */
    order: Uint32Array;
    /** Max node-group stack depth a DFS traversal needs. */
    maxDepth: number;
}

const f32buf = new ArrayBuffer(4);
const f32view = new Float32Array(f32buf);
const u32view = new Uint32Array(f32buf);
const floatBits = (f: number): number => { f32view[0] = f; return u32view[0]; };
const bitsFloat = (u: number): number => { u32view[0] = u; return f32view[0]; };

/**
 * Build the compressed wide BVH over a flat AABB list (6 f64 per item — the same
 * input contract as buildBVHNodesFlat). Returns packed nodes + the item order.
 */
export function buildCWBVH(boxes: Float64Array, n: number, cPrim: number = CWBVH_C_PRIM_DEFAULT): CWBVHResult {
    if (n === 0) return { nodes: new Uint32Array(0), nodeCount: 0, order: new Uint32Array(0), maxDepth: 0 };

    // ── The binary SAH tree, ONE PRIM PER LEAF (collapse input only — the shipped
    // binary occupants keep their own leaf sizes). alwaysSplit makes "one prim per leaf"
    // true by construction: at leaf size 1 SAH already splits every range except the
    // degenerate ones (coincident centroids — duplicate rows in a cloud — or ties), which it
    // left as multi-prim leaves; four or more of those broke the DP invariant below and the
    // build threw (Sep 25 2026 audit). The fallback halves such ranges instead. ─────────
    const bin = buildBVHNodesFlat(boxes, n, 1, true);
    const bn = bin.nodes;                    // 8 f32 per node: (min,A),(max,B)
    const BN = bin.nodeCount;
    const isLeaf = (i: number): boolean => bn[8 * i + 3] >= 0;
    const rightOf = (i: number): number => bn[8 * i + 7];

    // Subtree prim ranges [start, end) into bin.order — contiguous by construction
    // (the builder partitions order in place) — plus f32 areas AND exact f64 subtree
    // boxes: quantization runs against the TRUE f64 item bounds, not the binary
    // nodes' f32-rounded stores (which can sit a half-ulp INSIDE the geometry), so
    // the wide tree is conservative w.r.t. the truth — strictly stronger than the
    // binary walk, whose half-ulp store shrinkage leans on the Ize pad alone.
    const start = new Uint32Array(BN);
    const end = new Uint32Array(BN);
    const areaOf = new Float32Array(BN);
    const fb = new Float64Array(6 * BN);   // exact per-node boxes
    // Post-order fill via the implicit-left layout: iterate nodes in REVERSE index
    // order — children always have larger indices than their parent, so both are
    // final when the parent is visited.
    for (let i = BN - 1; i >= 0; i--) {
        const dx = bn[8 * i + 4] - bn[8 * i], dy = bn[8 * i + 5] - bn[8 * i + 1], dz = bn[8 * i + 6] - bn[8 * i + 2];
        areaOf[i] = Math.max(0, 2 * (dx * dy + dy * dz + dz * dx));
        if (isLeaf(i)) {
            start[i] = bn[8 * i + 7];
            end[i] = start[i] + bn[8 * i + 3];
            for (let a = 0; a < 3; a++) { fb[6 * i + a] = Infinity; fb[6 * i + 3 + a] = -Infinity; }
            for (let k = start[i]; k < end[i]; k++) {
                const item = bin.order[k];
                for (let a = 0; a < 3; a++) {
                    fb[6 * i + a] = Math.min(fb[6 * i + a], boxes[6 * item + a]);
                    fb[6 * i + 3 + a] = Math.max(fb[6 * i + 3 + a], boxes[6 * item + 3 + a]);
                }
            }
        } else {
            start[i] = start[i + 1];
            end[i] = end[rightOf(i)];
            const l = i + 1, r = rightOf(i);
            for (let a = 0; a < 3; a++) {
                fb[6 * i + a] = Math.min(fb[6 * l + a], fb[6 * r + a]);
                fb[6 * i + 3 + a] = Math.max(fb[6 * l + 3 + a], fb[6 * r + 3 + a]);
            }
        }
    }
    const primsOf = (i: number): number => end[i] - start[i];

    // ── Collapse DP (Eq. 5–8): COST[n][i-1] = C(n, i), i ∈ [1, 7]. CHOICE at i=1:
    // 0 = leaf, 1 = internal; at i>1: 2 = carry C(n,i−1), 3 = distribute(n,i)
    // (the split k is recomputed at backtrack — deterministic argmin, no storage). ──
    const COST = new Float32Array(7 * BN);
    const CHOICE = new Uint8Array(7 * BN);
    const INF = Infinity;

    // C_distribute(n, j) = min over 0<k<j of C(left,k) + C(right,j−k), k,j−k ≤ 7 (Eq. 8).
    const distribute = (l: number, r: number, j: number): number => {
        let best = INF;
        for (let k = Math.max(1, j - 7); k < j && k <= 7; k++) {
            const c = COST[7 * l + k - 1] + COST[7 * r + (j - k) - 1];
            if (c < best) best = c;
        }
        return best;
    };

    for (let i2 = BN - 1; i2 >= 0; i2--) {
        const A = areaOf[i2];
        if (isLeaf(i2)) {
            // One prim: C(n, i) = A·1·cPrim for every i (Eq. 6; P ≤ P_max trivially).
            for (let i = 0; i < 7; i++) { COST[7 * i2 + i] = A * cPrim; CHOICE[7 * i2 + i] = 0; }
            continue;
        }
        const l = i2 + 1, r = rightOf(i2);
        const P = primsOf(i2);
        const cLeaf = P <= CWBVH_MAX_PRIMS_PER_LEAF ? A * P * cPrim : INF;   // Eq. 6
        const cInternal = distribute(l, r, 8) + A * CWBVH_C_NODE;           // Eq. 7
        if (cLeaf <= cInternal) { COST[7 * i2] = cLeaf; CHOICE[7 * i2] = 0; }
        else { COST[7 * i2] = cInternal; CHOICE[7 * i2] = 1; }
        for (let i = 2; i <= 7; i++) {
            const carry = COST[7 * i2 + i - 2];
            const dist = distribute(l, r, i);
            if (dist < carry) { COST[7 * i2 + i - 1] = dist; CHOICE[7 * i2 + i - 1] = 3; }
            else { COST[7 * i2 + i - 1] = carry; CHOICE[7 * i2 + i - 1] = 2; }
        }
    }

    // Forest expansion: the ≤ i wide-roots that C(n, i) chose (backtracking Eq. 5/8;
    // the distribute split re-derived by argmin — same comparisons as the DP).
    const forestOf = (node: number, i: number, out: number[]): void => {
        if (i === 1 || isLeaf(node)) { out.push(node); return; }
        const ch = CHOICE[7 * node + i - 1];
        if (ch === 2) { forestOf(node, i - 1, out); return; }
        const l = node + 1, r = rightOf(node);
        let bestK = -1, best = INF;
        for (let k = Math.max(1, i - 7); k < i && k <= 7; k++) {
            const c = COST[7 * l + k - 1] + COST[7 * r + (i - k) - 1];
            if (c < best) { best = c; bestK = k; }
        }
        forestOf(l, bestK, out);
        forestOf(r, i - bestK, out);
    };
    // A wide node built at binary node n owns the distribute(n, 8) forest as its
    // children (Eq. 7). C(n,1)=leaf members become LEAF children; internal members
    // become child wide nodes.
    const childrenOf = (node: number): number[] => {
        const out: number[] = [];
        if (isLeaf(node)) { out.push(node); return out; }
        const l = node + 1, r = rightOf(node);
        let bestK = -1, best = INF;
        for (let k = 1; k <= 7; k++) {
            const c = COST[7 * l + k - 1] + COST[7 * r + (8 - k) - 1];
            if (c < best) { best = c; bestK = k; }
        }
        forestOf(l, bestK, out);
        forestOf(r, 8 - bestK, out);
        return out;
    };
    const isLeafChild = (member: number): boolean => CHOICE[7 * member] === 0;

    // ── Pass 1: count wide nodes (two-pass emission — no growing arrays; the DP is
    // deterministic so both passes see identical decisions). ────────────────────
    let wideCount = 0;
    const countWide = (node: number): void => {
        wideCount++;
        for (const m of childrenOf(node)) if (!isLeafChild(m)) countWide(m);
    };
    countWide(0);

    const nodes = new Uint32Array(wideCount * CWBVH_NODE_WORDS);
    const order = new Uint32Array(n);
    let nodeCursor = 0;
    let itemCursor = 0;
    let maxDepth = 0;

    // ── Slot assignment (design doc §4): slot bit i = ((childCentroid − parentCentroid)_i > 0),
    // first-fit scan on collision. The diagonal ray d_s (bit 0 → +, 1 → −) that
    // "matches" slot s then reaches its child first — octant traversal order
    // approximates front-to-back with zero runtime sorting. ─────────────────────
    const slotFor = (node: number, px: number, py: number, pz: number): number => {
        const cx = (bn[8 * node] + bn[8 * node + 4]) * 0.5;
        const cy = (bn[8 * node + 1] + bn[8 * node + 5]) * 0.5;
        const cz = (bn[8 * node + 2] + bn[8 * node + 6]) * 0.5;
        return (cx - px > 0 ? 1 : 0) | (cy - py > 0 ? 2 : 0) | (cz - pz > 0 ? 4 : 0);
    };

    // ── Pass 2: emit. A node's internal children occupy a CONTIGUOUS block in SLOT
    // order (the traversal addresses child popc(imask & below(slot)) past childBase);
    // leaf children's items are appended in slot order (offsets < 24). DFS: reserve
    // the child block, then recurse in slot order (paper §3.3 layout preference). ──
    const emit = (node: number, wideIdx: number, depth: number): void => {
        if (depth > maxDepth) maxDepth = depth;
        const members = childrenOf(node);

        // Aggregate box (the node's own bounds — quantization frame, Eq. 1) from the
        // EXACT f64 subtree boxes.
        let bx0 = Infinity, by0 = Infinity, bz0 = Infinity, bx1 = -Infinity, by1 = -Infinity, bz1 = -Infinity;
        for (const m of members) {
            bx0 = Math.min(bx0, fb[6 * m]); by0 = Math.min(by0, fb[6 * m + 1]); bz0 = Math.min(bz0, fb[6 * m + 2]);
            bx1 = Math.max(bx1, fb[6 * m + 3]); by1 = Math.max(by1, fb[6 * m + 4]); bz1 = Math.max(bz1, fb[6 * m + 5]);
        }
        const pcx = (bx0 + bx1) * 0.5, pcy = (by0 + by1) * 0.5, pcz = (bz0 + bz1) * 0.5;

        // Quantization origin: f32 and ≤ the true lo (round-to-nearest could lift it
        // ABOVE lo, flipping inflation into deflation on the lo planes — the design
        // doc §3 degenerate/rounding pin). nextDown = one-ulp step toward −∞.
        const nextDown = (f: number): number => {
            if (f === 0) return -Math.pow(2, -149);
            const u = floatBits(f);
            return bitsFloat(f > 0 ? u - 1 : u + 1);
        };
        const f32Floor = (v: number): number => {
            const f = Math.fround(v);
            return f > v ? nextDown(f) : f;
        };

        // Slots: preferred octant, first-fit forward scan (wrap) on collision.
        const slotOf = new Int32Array(8).fill(-1);   // slot → member index (in `members`)
        for (let mi = 0; mi < members.length; mi++) {
            const want = slotFor(members[mi], pcx, pcy, pcz);
            let s = want;
            while (slotOf[s] >= 0) s = (s + 1) & 7;
            slotOf[s] = mi;
        }

        // Grid exponents (Eq. 1): smallest e with hi ≤ p + 2^e·255, as fp32 biased
        // exponent bytes — then VERIFIED in the f32 decode arithmetic (fround(p +
        // 255·2^e) must reach hi; bump e until it does). Zero extents take the
        // smallest normal exponent (byte 1).
        const p0 = f32Floor(bx0), p1 = f32Floor(by0), p2 = f32Floor(bz0);
        const expByte = (p: number, hi: number): number => {
            const extent = hi - p;
            let b: number;
            if (!(extent > 0)) b = 1;
            else b = Math.max(1, Math.ceil(Math.log2(extent / 255)) + 127);
            while (b < 255 && Math.fround(p + 255 * bitsFloat(b << 23)) < hi) b++;
            if (b > 254) throw new Error(`cwbvh: extent ${extent} exceeds the exponent range`);
            return b;
        };
        const ebx = expByte(p0, bx1), eby = expByte(p1, by1), ebz = expByte(p2, bz1);
        const sx = bitsFloat(ebx << 23), sy = bitsFloat(eby << 23), sz = bitsFloat(ebz << 23);

        const base = wideIdx * CWBVH_NODE_WORDS;
        nodes[base] = floatBits(p0);
        nodes[base + 1] = floatBits(p1);
        nodes[base + 2] = floatBits(p2);

        // Reserve the contiguous child block + the item run.
        let imask = 0;
        let internalCount = 0;
        for (let s = 0; s < 8; s++) if (slotOf[s] >= 0 && !isLeafChild(members[slotOf[s]])) internalCount++;
        const childBase = nodeCursor;
        nodeCursor += internalCount;
        const primBase = itemCursor;

        // Quantize per slot (Eq. 2: floor lo, ceil hi — conservative in f32: nudge
        // outward while the f32 decode p + q·2^e still misses the true bound).
        const qlo = new Uint8Array(24), qhi = new Uint8Array(24);
        const meta = new Uint8Array(8);
        const quant = (v: number, p: number, s: number, up: boolean): number => {
            let q = up ? Math.ceil((v - p) / s) : Math.floor((v - p) / s);
            q = Math.max(0, Math.min(255, q));
            // f32 decode guard: the traversal computes p + q·s in fp32 — walk q
            // outward until the decoded plane really contains v.
            while (up ? Math.fround(p + q * s) < v && q < 255 : Math.fround(p + q * s) > v && q > 0) q += up ? 1 : -1;
            return q;
        };
        // Empty slots: hi < lo ⇒ the slab test can never accept (paper convention).
        for (let s = 0; s < 8; s++) { qlo[s] = 255; qlo[8 + s] = 255; qlo[16 + s] = 255; qhi[s] = 0; qhi[8 + s] = 0; qhi[16 + s] = 0; }

        let internalSeen = 0;
        for (let s = 0; s < 8; s++) {
            const mi = slotOf[s];
            if (mi < 0) continue;
            const m = members[mi];
            qlo[s] = quant(fb[6 * m], p0, sx, false);
            qlo[8 + s] = quant(fb[6 * m + 1], p1, sy, false);
            qlo[16 + s] = quant(fb[6 * m + 2], p2, sz, false);
            qhi[s] = quant(fb[6 * m + 3], p0, sx, true);
            qhi[8 + s] = quant(fb[6 * m + 4], p1, sy, true);
            qhi[16 + s] = quant(fb[6 * m + 5], p2, sz, true);
            if (isLeafChild(m)) {
                const count = primsOf(m);
                if (count > CWBVH_MAX_PRIMS_PER_LEAF) throw new Error('cwbvh: leaf child over P_max (DP invariant broken)');
                const offset = itemCursor - primBase;
                if (offset + count > CWBVH_MAX_PRIMS_PER_NODE) throw new Error('cwbvh: node item run over 24 (DP invariant broken)');
                meta[s] = (((1 << count) - 1) << 5) | offset;   // unary count | offset
                for (let i = start[m]; i < end[m]; i++) order[itemCursor++] = bin.order[i];
            } else {
                imask |= 1 << s;
                meta[s] = 0b00100000 | (24 + s);
                internalSeen++;
            }
        }

        nodes[base + 3] = ebx | (eby << 8) | (ebz << 16) | (imask << 24);
        nodes[base + 4] = childBase;
        nodes[base + 5] = primBase;
        nodes[base + 6] = meta[0] | (meta[1] << 8) | (meta[2] << 16) | (meta[3] << 24);
        nodes[base + 7] = meta[4] | (meta[5] << 8) | (meta[6] << 16) | (meta[7] << 24);
        for (let w = 0; w < 6; w++) {
            const src = w < 3 ? qlo : qhi;
            const off = (w % 3) * 8;
            nodes[base + 8 + 2 * w] = src[off] | (src[off + 1] << 8) | (src[off + 2] << 16) | (src[off + 3] << 24);
            nodes[base + 9 + 2 * w] = src[off + 4] | (src[off + 5] << 8) | (src[off + 6] << 16) | (src[off + 7] << 24);
        }

        // Recurse into internal children in SLOT order — indices match the popc rule.
        let ci = 0;
        for (let s = 0; s < 8; s++) {
            const mi = slotOf[s];
            if (mi >= 0 && !isLeafChild(members[mi])) emit(members[mi], childBase + ci++, depth + 1);
        }
    };

    nodeCursor = 1;
    emit(0, 0, 1);
    if (nodeCursor !== wideCount) throw new Error(`cwbvh: emitted ${nodeCursor} nodes, counted ${wideCount}`);
    if (itemCursor !== n) throw new Error(`cwbvh: emitted ${itemCursor} items of ${n}`);
    return { nodes, nodeCount: wideCount, order, maxDepth };
}

// ============================================================================
// TS decode + reference traversal — the tests' ground truth AND the blueprint the
// GLSL emitter mirrors line-for-line (round-trip vitest pins the bit layout).
// ============================================================================

export interface CWBVHNodeDecoded {
    p: [number, number, number];
    /** Decoded 2^e per axis. */
    scale: [number, number, number];
    imask: number;
    childBase: number;
    primBase: number;
    meta: Uint8Array;   // 8
    qlo: Uint8Array;    // 24, [axis*8 + slot]
    qhi: Uint8Array;
}

export function decodeCWBVHNode(nodes: Uint32Array, idx: number): CWBVHNodeDecoded {
    const b = idx * CWBVH_NODE_WORDS;
    const meta = new Uint8Array(8), qlo = new Uint8Array(24), qhi = new Uint8Array(24);
    for (let i = 0; i < 4; i++) meta[i] = (nodes[b + 6] >>> (8 * i)) & 0xff;
    for (let i = 0; i < 4; i++) meta[4 + i] = (nodes[b + 7] >>> (8 * i)) & 0xff;
    for (let w = 0; w < 6; w++) {
        const dst = w < 3 ? qlo : qhi;
        const off = (w % 3) * 8;
        for (let i = 0; i < 4; i++) dst[off + i] = (nodes[b + 8 + 2 * w] >>> (8 * i)) & 0xff;
        for (let i = 0; i < 4; i++) dst[off + 4 + i] = (nodes[b + 9 + 2 * w] >>> (8 * i)) & 0xff;
    }
    return {
        p: [bitsFloat(nodes[b]), bitsFloat(nodes[b + 1]), bitsFloat(nodes[b + 2])],
        scale: [
            bitsFloat((nodes[b + 3] & 0xff) << 23),
            bitsFloat(((nodes[b + 3] >>> 8) & 0xff) << 23),
            bitsFloat(((nodes[b + 3] >>> 16) & 0xff) << 23),
        ],
        imask: (nodes[b + 3] >>> 24) & 0xff,
        childBase: nodes[b + 4],
        primBase: nodes[b + 5],
        meta, qlo, qhi,
    };
}

const popc8 = (v: number): number => {
    v = v - ((v >> 1) & 0x55);
    v = (v & 0x33) + ((v >> 2) & 0x33);
    return (v + (v >> 4)) & 0x0f;
};
/** find-MSB via the float-exponent trick — exact for x < 2^24 (design doc §5). */
const findMSB24 = (x: number): number => (floatBits(x) >>> 23) - 127;

/**
 * Scalar reference traversal (paper Alg. 1 shape — the GLSL walk mirrors this).
 * `itemTest(originalItemIndex, tmax)` returns the hit t or Infinity; the walk
 * returns the nearest item + t. Octant convention: oct bit i = (d_i < 0).
 */
export function cwbvhNearestRef(
    bvh: CWBVHResult,
    ro: [number, number, number],
    rd: [number, number, number],
    itemTest: (item: number, tmax: number) => number,
): { item: number; t: number; visitedNodes: number } {
    let tmax = Infinity, bestItem = -1, visited = 0;
    if (bvh.nodeCount === 0) return { item: -1, t: Infinity, visitedNodes: 0 };
    const oct = (rd[0] < 0 ? 1 : 0) | (rd[1] < 0 ? 2 : 0) | (rd[2] < 0 ? 4 : 0);
    const octinv = 7 - oct;
    // Clamp direction components away from zero BEFORE inverting: an exactly
    // axis-aligned ray gives inv = ∞ and the quantized slab then computes q·∞ with
    // q = 0 → NaN, which defeats every comparison and silently disables pruning
    // (conservative but catastrophic for cost — found by the octant-order test).
    // The finite huge inverse keeps the correct interval semantics. The GLSL walk
    // carries the same guard.
    const safe = (d: number): number => (Math.abs(d) < 1e-20 ? (d < 0 ? -1e-20 : 1e-20) : d);
    const inv = [1 / safe(rd[0]), 1 / safe(rd[1]), 1 / safe(rd[2])];

    // Stack of node groups: [base, hits, imask]. Hits bit for slot s sits at
    // (s ^ octinv); pop order = find-MSB. The root enters as a single-child
    // pseudo-group at slot 0 (imask bit 0 only → popc addressing yields index 0).
    const stack: Array<[number, number, number]> = [];
    let gBase = 0, gHits = 1 << ((0 ^ octinv) & 7), gImask = 1 << 0;

    for (;;) {
        if (gHits === 0) {
            const top = stack.pop();
            if (top === undefined) break;
            [gBase, gHits, gImask] = top;
            continue;
        }
        const bit = findMSB24(gHits);
        gHits &= ~(1 << bit);
        const slot = (bit ^ octinv) & 7;
        const childIdx = gBase + popc8(gImask & ((1 << slot) - 1));
        if (gHits !== 0) stack.push([gBase, gHits, gImask]);
        visited++;

        const nd = decodeCWBVHNode(bvh.nodes, childIdx);
        // Per-node ray transform (Eq. 10) then one-FMA slabs per plane (Eq. 11).
        const dq = [nd.scale[0] * inv[0], nd.scale[1] * inv[1], nd.scale[2] * inv[2]];
        const oq = [(nd.p[0] - ro[0]) * inv[0], (nd.p[1] - ro[1]) * inv[1], (nd.p[2] - ro[2]) * inv[2]];
        let hits = 0;   // node-child bits at 8..15 conceptually; keep two fields
        let leafBits = 0;
        for (let s = 0; s < 8; s++) {
            const m = nd.meta[s];
            if (m === 0) continue;
            let tn = 0, tf = tmax;
            for (let a = 0; a < 3; a++) {
                const lo = nd.qlo[8 * a + s] * dq[a] + oq[a];
                const hi = nd.qhi[8 * a + s] * dq[a] + oq[a];
                tn = Math.max(tn, Math.min(lo, hi));
                tf = Math.min(tf, Math.max(lo, hi));
            }
            tf *= BVH_TFAR_PAD;   // the Ize guard, matching the binary walk
            if (tf < tn) continue;
            const isInternal = (m & 0b11100000) === 0b00100000 && (m & 0x1f) >= 24;
            if (isInternal) hits |= 1 << ((((m & 0x1f) - 24) ^ octinv) & 7);
            else leafBits |= (m >>> 5) << (m & 0x1f);
        }

        // Drain leaf items (bit index = item offset from primBase).
        while (leafBits !== 0) {
            const ib = findMSB24(leafBits);
            leafBits &= ~(1 << ib);
            const t = itemTest(bvh.order[nd.primBase + ib], tmax);
            if (t < tmax) { tmax = t; bestItem = bvh.order[nd.primBase + ib]; }
        }
        if (hits !== 0) { gBase = nd.childBase; gHits = hits; gImask = nd.imask; }
        else gHits = 0;
    }
    return { item: bestItem, t: tmax, visitedNodes: visited };
}
