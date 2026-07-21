// The rail v2 ledger (fable-data-rail §4): region assignment must be deterministic,
// disjoint, order-stable, and honest about its padding bounds.

import { describe, it, expect } from 'vitest';
import { planDataLayout, nodeTexelBound, assertFits, type DataTenants } from '../../src/components/data/ledger.js';

const T: DataTenants = {
    meshes: [
        { vertexCount: 24, triCount: 12 },    // slot 0 (a cube)
        { vertexCount: 594, triCount: 1152 }, // slot 1 (the cactus)
    ],
    batches: [
        { instanceCount: 3, attrTexels: 3 },  // batch 0: 3 instances, 1 attr row
        { instanceCount: 500, attrTexels: 0 },
    ],
    meshLights: [{ meshOrdinal: 1, vertexCount: 594, triCount: 1152 }],
};

describe('data rail ledger', () => {
    it('assigns disjoint, ordered regions and consistent totals', () => {
        const L = planDataLayout(T);
        // Geometry slots pack contiguously.
        expect(L.meshes[0]).toEqual({ vbase: 0, tbase: 0, nbase: 0 });
        expect(L.meshes[1]).toEqual({ vbase: 24, tbase: 12, nbase: nodeTexelBound(12) });
        // Light wpos regions live in vertices AFTER mesh geometry.
        expect(L.meshLights.get(1)!.wposBase).toBe(24 + 594);
        expect(L.totals.vertices).toBe(24 + 594 + 594);
        // normals/uvs span only mesh geometry (no light bakes).
        expect(L.totals.normals).toBe(24 + 594);
        // Records: batch 0 placements (6) + attrs (3), batch 1 placements (1000), then the CDF.
        expect(L.batches[0]).toMatchObject({ placementsBase: 0, attrsBase: 6 });
        expect(L.batches[1].placementsBase).toBe(9);
        expect(L.batches[1].attrsBase).toBe(-1);
        expect(L.meshLights.get(1)!.cdfBase).toBe(9 + 1000);
        expect(L.totals.records).toBe(9 + 1000 + 1152);
        // Nodes: BLAS bounds then TLAS bounds, disjoint.
        expect(L.batches[0].tlasBase).toBe(nodeTexelBound(12) + nodeTexelBound(1152));
        expect(L.totals.nodes).toBe(nodeTexelBound(12) + nodeTexelBound(1152) + nodeTexelBound(3) + nodeTexelBound(500));
    });

    it('the node bound holds for real SAH trees (LEAF_SIZE ≥ 1 ⇒ ≤ 2T−1 nodes)', () => {
        expect(nodeTexelBound(1)).toBe(2);      // one leaf = one node = 2 texels
        expect(nodeTexelBound(0)).toBe(0);
        expect(nodeTexelBound(1152)).toBe(2 * (2 * 1152 - 1));
    });

    it('assertFits errors loudly on a violated bound', () => {
        expect(() => assertFits('test', 10, 8)).toThrow(/padding bound/);
        expect(() => assertFits('test', 8, 8)).not.toThrow();
    });

    it('is deterministic (same input → identical layout)', () => {
        expect(planDataLayout(T)).toEqual(planDataLayout(T));
    });
});
