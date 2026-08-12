// components/accel/light_tree/light_tree.ts — the LIGHT tree builder (fable-light-bvh §3.1).
//
// A FEEDER of the shared binned-SAH core (accel/bvh buildBVHCore — the builder
// consolidation, Aug 10 2026; previously a fork of the scaffolding with an O(BINS²)
// sweep). The build differs from the ray trees in exactly the core's parameters: the
// split cost is ENERGY-weighted (weights = Φ — the no-cones degenerate of the SAOH
// cost), leaves hold exactly ONE light (leafSize 1 + alwaysSplit), the 48-level trail
// cap rides the core's depthCap, and coincident lights (identical centroids — SAH has
// no plane) go through the sorted-median fallback into chains of identical-box internal
// nodes whose Φ sums keep the stochastic descent power-proportional among them — the
// correct limit, with no multi-light leaf format needed.
//
// Node encoding (2 RGBA32F texels — the ray-BVH layout with Φ in the axis slot; the
// light walk computes BOTH children's importance every step, so there is no near-child
// ordering to encode):
//   texel 0 = (min.x, min.y, min.z, Φ)       Φ = subtree emitted power, > 0
//   texel 1 = (max.x, max.y, max.z, link)    link >= 0 → INTERNAL, rightChild = link
//                                            link <  0 → LEAF, lightIndex = -link-1
//   left child = nodeIdx + 1 (implicit — never stored); leaf = exactly ONE light.
//
// Bit trails (Laine 2010 restart-trail encoding, per pbrt-v4 §12.6): per light, the
// root→leaf left/right decisions, LSB-first, split into two f32-exact 24-bit halves —
// trail texel .x = levels 0–23, .y = levels 24–47. The pmf walk consumes them in the
// same order the pick walk draws its randoms, so both compute the identical product.
// The core threads the bits through its recursion and hands them to emitLeaf.
//
// Pure TS, imports nothing from app/engine/compiler (components purity).

import { buildBVHCore, bvhNodeBound } from '../bvh/bvh.js';

export const LIGHT_TREE_MAX_DEPTH = 48;

export interface LightTreeResult {
    /** Flat node array, 8 floats per node (2 RGBA32F texels), EXACTLY 2n−1 nodes. */
    nodes: Float32Array;
    nodeCount: number;
    /** Per-light trail texels, 4 floats each: (lo 24 bits, hi 24 bits, 0, 0), light order. */
    trails: Float32Array;
    maxDepth: number;
}

/** Build the light tree over n lights: `boxes` = 6 f64 per light (min.xyz, max.xyz —
 *  degenerate boxes fine), `powers` = emitted power per light (> 0; the caller floors). */
export function buildLightTree(boxes: Float64Array, powers: Float64Array, n: number): LightTreeResult {
    if (n === 0) return { nodes: new Float32Array(0), nodeCount: 0, trails: new Float32Array(0), maxDepth: 0 };

    const nodes = new Float32Array(8 * bvhNodeBound(n));   // leaf size 1 + alwaysSplit ⇒ EXACTLY 2n−1
    const trails = new Float32Array(4 * n);
    const { nodeCount, maxDepth } = buildBVHCore(boxes, n, {
        leafSize: 1,
        weights: powers,
        alwaysSplit: true,
        depthCap: LIGHT_TREE_MAX_DEPTH,
        fallback: 'sorted-median',
        emitLeaf: (ni, start, _count, mnx, mny, mnz, mxx, mxy, mxz, phi, lo, hi, order) => {
            const light = order[start];
            nodes[ni * 8 + 0] = mnx; nodes[ni * 8 + 1] = mny; nodes[ni * 8 + 2] = mnz;
            nodes[ni * 8 + 3] = phi;
            nodes[ni * 8 + 4] = mxx; nodes[ni * 8 + 5] = mxy; nodes[ni * 8 + 6] = mxz;
            nodes[ni * 8 + 7] = -(light + 1);
            trails[light * 4] = lo;
            trails[light * 4 + 1] = hi;
        },
        emitInternal: (ni, _axis, rightIdx, mnx, mny, mnz, mxx, mxy, mxz, phi) => {
            nodes[ni * 8 + 0] = mnx; nodes[ni * 8 + 1] = mny; nodes[ni * 8 + 2] = mnz;
            nodes[ni * 8 + 3] = phi;
            nodes[ni * 8 + 4] = mxx; nodes[ni * 8 + 5] = mxy; nodes[ni * 8 + 6] = mxz;
            nodes[ni * 8 + 7] = rightIdx;
        },
    });
    return { nodes, nodeCount, trails, maxDepth };
}

/** TS twin of the GLSL importance (fable-light-bvh §3.2 v1.5) — change light_tree.glsl,
 *  change this. n = [0,0,0] (or omitted) = no orientation → normal-free; otherwise the
 *  one-sided horizon term cos(max(0, θi − θu)) with the inside-the-bounding-sphere and
 *  θi < θu escapes. `twoSided` mirrors LightQuery.two_sided (fable-rough-dielectric
 *  §3.3): sphere support ⇒ no cull, |·| shaping. This twin powers the vitest pmf gates. */
export function lightTreeImportance(bmin: [number, number, number], bmax: [number, number, number], phi: number, p: [number, number, number], n: [number, number, number] = [0, 0, 0], twoSided = false): number {
    const cx0 = (bmin[0] + bmax[0]) * 0.5, cy0 = (bmin[1] + bmax[1]) * 0.5, cz0 = (bmin[2] + bmax[2]) * 0.5;
    const ex = bmax[0] - bmin[0], ey = bmax[1] - bmin[1], ez = bmax[2] - bmin[2];
    const dx = cx0 - p[0], dy = cy0 - p[1], dz = cz0 - p[2];
    const d2raw = dx * dx + dy * dy + dz * dz;
    const diag2 = 0.25 * (ex * ex + ey * ey + ez * ez);
    const base = phi / Math.max(d2raw, Math.max(diag2, 1e-8));
    if (n[0] * n[0] + n[1] * n[1] + n[2] * n[2] < 0.5) return base;
    // Exact box-below-horizon cull (hereditary — boxes are exact child unions) + the
    // corner-based best-case-cosine shaping (v1.5.1 — direction-exact, no axis bias).
    const fx = n[0] >= 0 ? bmax[0] : bmin[0];
    const fy = n[1] >= 0 ? bmax[1] : bmin[1];
    const fz = n[2] >= 0 ? bmax[2] : bmin[2];
    let h = n[0] * (fx - p[0]) + n[1] * (fy - p[1]) + n[2] * (fz - p[2]);
    if (twoSided) {
        // max|n·(x−p)| via the mirror corner (bmin + bmax − far) — never culls.
        h = Math.max(h, -(n[0] * (bmin[0] + bmax[0] - fx - p[0])
            + n[1] * (bmin[1] + bmax[1] - fy - p[1])
            + n[2] * (bmin[2] + bmax[2] - fz - p[2])));
    } else if (h <= 0) {
        return 0;
    }
    let cosC = (n[0] * dx + n[1] * dy + n[2] * dz) / Math.sqrt(Math.max(d2raw, 1e-12));
    if (twoSided) cosC = Math.abs(cosC);
    const mx = Math.max(p[0] - bmin[0], bmax[0] - p[0]);
    const my = Math.max(p[1] - bmin[1], bmax[1] - p[1]);
    const mz = Math.max(p[2] - bmin[2], bmax[2] - p[2]);
    const lo = h / Math.sqrt(Math.max(mx * mx + my * my + mz * mz, 1e-12));
    return base * Math.min(1, Math.max(cosC, lo));
}

/** TS reference descent pmf: P(select `light` | p) by replaying its trail — the twin of
 *  the generated light_tree_pmf walk. Exported for the vitest invariants (Σ pmf = 1,
 *  trails reach their leaves). */
export function lightTreePmf(tree: LightTreeResult, light: number, p: [number, number, number], n: [number, number, number] = [0, 0, 0]): number {
    let lo = tree.trails[light * 4], hi = tree.trails[light * 4 + 1];
    let ni = 0, pmf = 1, lvl = 0;
    for (; ;) {
        const link = tree.nodes[ni * 8 + 7];
        if (link < 0) {
            return -link - 1 === light ? pmf : 0;   // trail must land on THIS light's leaf
        }
        const L = ni + 1, R = link;
        const child = (c: number): number => lightTreeImportance(
            [tree.nodes[c * 8], tree.nodes[c * 8 + 1], tree.nodes[c * 8 + 2]],
            [tree.nodes[c * 8 + 4], tree.nodes[c * 8 + 5], tree.nodes[c * 8 + 6]],
            tree.nodes[c * 8 + 3], p, n);
        const il = child(L), ir = child(R);
        const sum = il + ir;
        if (sum <= 0) return 0;
        const pl = il / sum;
        const bit = lvl < 24 ? (lo >>> lvl) & 1 : (hi >>> (lvl - 24)) & 1;
        if (bit === 0) { pmf *= pl; ni = L; } else { pmf *= 1 - pl; ni = R; }
        lvl++;
    }
}
