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
        // batch 0: frame tier, 1 attr row — cwbvh-INELIGIBLE (zero regions)
        { instanceCount: 3, placementTexels: 2, attrTexels: 3, cwbvhNodeTexels: 0, cwbvhRecordTexels: 0 },
        // batch 1: params tier — cwbvh-eligible: 5(2N−1) node texels + N record-twin texels
        { instanceCount: 500, placementTexels: 1, attrTexels: 0, cwbvhNodeTexels: 5 * (2 * 500 - 1), cwbvhRecordTexels: 500 },
    ],
    meshLights: [{ meshOrdinal: 1, vertexCount: 594, triCount: 1152 }],
    sceneTable: { leafCount: 4, analyticTexels: 10 },   // 2 analytic × stride 5
    // 5 lights at row stride 3 (fable-light-bvh §5) — appended after everything above.
    lightTree: { count: 5, tableTexels: 15 },
    // 6 regions → 2 texels (4 ids/texel) — appended LAST (impl-plan-region-materials).
    regionMaterials: { count: 6 },
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
        // Records: batch 0 placements (3 × 2 texels) + attrs (3), batch 1 placements
        // (500 × 1 texel — the params tier stride) + its cwbvh record TWIN (500),
        // then the CDF.
        expect(L.batches[0]).toMatchObject({ placementsBase: 0, attrsBase: 6, cwbvhNodesBase: -1, cwbvhRecordsBase: -1 });
        expect(L.batches[1].placementsBase).toBe(9);
        expect(L.batches[1].attrsBase).toBe(-1);
        expect(L.batches[1].cwbvhRecordsBase).toBe(9 + 500);
        expect(L.batches[1].cwbvhNodesBase).toBe(0);
        expect(L.totals.nodesq).toBe(5 * (2 * 500 - 1));
        expect(L.meshLights.get(1)!.cdfBase).toBe(9 + 500 + 500);
        // Scene table: leaf list then analytic records after the CDF; TLAS after batch TLASes.
        expect(L.sceneTable!.leafListBase).toBe(9 + 500 + 500 + 1152);
        expect(L.sceneTable!.analyticBase).toBe(9 + 500 + 500 + 1152 + 4);
        // The light tree APPENDS LAST (fable-light-bvh §5 — pre-existing bases stay
        // byte-stable): table rows, then trails, then its nodes region.
        expect(L.lightTree!.tableBase).toBe(9 + 500 + 500 + 1152 + 4 + 10);
        expect(L.lightTree!.trailsBase).toBe(9 + 500 + 500 + 1152 + 4 + 10 + 15);
        // The region→material table appends LAST (impl-plan-region-materials):
        // ceil(6/4) = 2 texels after the light tree's records.
        expect(L.regionMaterials!.base).toBe(9 + 500 + 500 + 1152 + 4 + 10 + 15 + 5);
        expect(L.totals.records).toBe(9 + 500 + 500 + 1152 + 4 + 10 + 15 + 5 + 2);
        // Nodes: BLAS bounds then TLAS bounds, then the scene TLAS, disjoint.
        expect(L.batches[0].tlasBase).toBe(nodeTexelBound(12) + nodeTexelBound(1152));
        expect(L.sceneTable!.tlasBase).toBe(nodeTexelBound(12) + nodeTexelBound(1152) + nodeTexelBound(3) + nodeTexelBound(500));
        expect(L.lightTree!.treeBase).toBe(nodeTexelBound(12) + nodeTexelBound(1152) + nodeTexelBound(3) + nodeTexelBound(500) + nodeTexelBound(4));
        expect(L.totals.nodes).toBe(nodeTexelBound(12) + nodeTexelBound(1152) + nodeTexelBound(3) + nodeTexelBound(500) + nodeTexelBound(4) + nodeTexelBound(5));
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
