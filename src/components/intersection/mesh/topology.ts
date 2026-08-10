// components/intersection/mesh/topology.ts — closedness facts (fable-mesh-containment).
//
// Pure mesh-topology math, CPU-side: the Validator turns the authored `closed: true`
// INTENT into proven FACT with these checks, and the Planner bakes the local box for the
// containment query's root-box early-out. Pure TS (components purity).
//
// THE welding subtlety: indexed meshes routinely SPLIT vertices at shared positions (the
// OBJ corner-dedup splits on differing vt/vn; generated fixtures push per-face corners),
// so topological edges computed on RAW indices would call a geometrically closed cube
// "full of holes." All edge accounting therefore runs on POSITION-WELDED canonical ids
// (exact float match — split corners carry bit-identical coordinates by construction).

import type { AABB } from '../../accel/bvh/bvh.js';

export interface MeshClosedness {
    /** Every welded edge is shared by exactly two triangles (no holes, no fins). */
    watertight: boolean;
    /** Each shared edge is traversed in OPPOSITE directions by its two faces —
     *  all faces agree which side is out. Only meaningful when watertight. */
    consistent: boolean;
    /** Signed volume > 0: the agreed side actually points OUT (cross(e1,e2) outward). */
    outward: boolean;
    boundaryEdges: number;      // edges with one face (holes)
    nonManifoldEdges: number;   // edges with more than two faces (fins/junk)
    flippedEdges: number;       // two faces traversing the SAME direction (inverted patch)
    /** Σ det(a,b,c)/6 — the enclosed volume for outward-wound watertight meshes. */
    volume: number;
}

/** Weld positions to canonical vertex ids (exact-match), then account edges. */
export function meshClosedness(positions: Float32Array, indices: Uint32Array): MeshClosedness {
    const canon = new Map<string, number>();
    const weld = (vi: number): number => {
        const key = `${positions[vi * 3]}|${positions[vi * 3 + 1]}|${positions[vi * 3 + 2]}`;
        let id = canon.get(key);
        if (id === undefined) { id = canon.size; canon.set(key, id); }
        return id;
    };

    // Per undirected edge (min,max): forward = traversed min→max, backward = max→min.
    const edges = new Map<string, { f: number; b: number }>();
    let volume = 0;
    for (let t = 0; t < indices.length; t += 3) {
        const ia = indices[t] * 3, ib = indices[t + 1] * 3, ic = indices[t + 2] * 3;
        // Signed volume on RAW positions (welding is irrelevant to the integral):
        // det(a,b,c)/6 = a · (b × c) / 6, summed over faces (divergence theorem).
        const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
        const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
        const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];
        volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;

        const w = [weld(indices[t]), weld(indices[t + 1]), weld(indices[t + 2])];
        for (let k = 0; k < 3; k++) {
            const u = w[k], v = w[(k + 1) % 3];
            if (u === v) continue;   // degenerate sliver edge after welding — surfaces elsewhere
            const key = u < v ? `${u}_${v}` : `${v}_${u}`;
            let e = edges.get(key);
            if (e === undefined) { e = { f: 0, b: 0 }; edges.set(key, e); }
            if (u < v) e.f++; else e.b++;
        }
    }

    let boundaryEdges = 0, nonManifoldEdges = 0, flippedEdges = 0;
    for (const e of edges.values()) {
        const total = e.f + e.b;
        if (total === 1) boundaryEdges++;
        else if (total > 2) nonManifoldEdges++;
        else if (e.f !== 1) flippedEdges++;   // total === 2, same direction twice
    }

    const watertight = boundaryEdges === 0 && nonManifoldEdges === 0;
    const consistent = watertight && flippedEdges === 0;
    return {
        watertight, consistent,
        outward: consistent && volume > 0,
        boundaryEdges, nonManifoldEdges, flippedEdges, volume,
    };
}

/** The mesh's local AABB (min/max over positions) — baked into the generated containment
 *  query as the root-box early-out (outside the box IS outside the mesh, no traversal). */
export function meshLocalBox(positions: Float32Array): AABB {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
        for (let a = 0; a < 3; a++) {
            const v = positions[i + a];
            if (v < min[a]) min[a] = v;
            if (v > max[a]) max[a] = v;
        }
    }
    return { min, max };
}
