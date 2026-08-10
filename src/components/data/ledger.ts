// components/data/ledger.ts — THE layout truth of rail v2 (fable-data-rail §4).
//
// One pure function assigns every tenant's REGION (base texel) in every channel and each
// channel's total. The Planner calls it to BAKE bases as literals; the App calls the SAME
// function to pack payloads at the same bases — the ordinal-truth pattern promoted from
// "who is tenant #k" to "where tenant #k's bytes live". Deterministic from COUNTS alone
// (the compiler never runs App-side builds): where a true size is build-dependent, the
// region is padded to a DECLARED bound, and the App asserts its packed size fits
// (assertFits — a violated bound is a loud error, never corruption).
//
// Padding bounds (each with its proof sketch):
//   BLAS nodes: a binary tree over T leaves (LEAF_SIZE ≥ 1) has ≤ 2T−1 nodes → 2(2T−1)
//   node texels (2 texels/node). TLAS over N instance boxes: same bound with T = N.
//   The 2T−1 bound itself is the tree family's fact — imported from accel/bvh.
// Pure TS, components-internal imports only (components purity).

import { bvhNodeBound } from '../accel/bvh/bvh.js';

export interface MeshSlot {
    /** Vertex-texel base (vertices/normals/uvs channels) — fetches add it to LOCAL vertex ids. */
    vbase: number;
    /** Triangle-texel base (indices channel) — fetches add it to LOCAL triangle ids. */
    tbase: number;
    /** Node-texel base (nodes channel) — fetches add it to LOCAL node texel ids. */
    nbase: number;
}

export interface BatchSlot {
    /** Records-channel base of the placement region (placementTexels per instance,
     *  TLAS-leaf order). */
    placementsBase: number;
    /** Nodes-channel base of the batch TLAS (padded to 2(2N−1) texels). */
    tlasBase: number;
    /** Records-channel base of the attrs region (attrTexels texels), or -1 when none. */
    attrsBase: number;
    /** nodesq-channel base of the batch's CWBVH nodes (fable-accel-cwbvh §6), or -1
     *  when the batch is cwbvh-ineligible (mesh prototype / frame tier — the v1 pins). */
    cwbvhNodesBase: number;
    /** Records-channel base of the CWBVH-order placement records twin (the leaf-order
     *  resolution: the wide tree's leaf permutation differs from the binary TLAS's),
     *  or -1 when ineligible. */
    cwbvhRecordsBase: number;
}

export interface MeshLightSlot {
    /** Vertices-channel base of the WORLD-position bake (vertexCount texels). */
    wposBase: number;
    /** Records-channel base of the cumulative-area CDF (triCount texels). */
    cdfBase: number;
}

export interface DataTenants {
    /** Standalone meshes (sceneMeshes order) THEN mesh prototypes (batch order) —
     *  one geometry slot each; PlannedMesh/prototype records carry their slot index. */
    meshes: ReadonlyArray<{ vertexCount: number; triCount: number }>;
    /** ALL instance batches, batch-ordinal order. placementTexels = the per-instance
     *  record stride (impl-plan-placement-fold: 2 = rigid frame, 1 = folded params —
     *  the dataTenants adapter is the ONE tier truth). attrTexels = attribute rows ×
     *  instances (0 = no attrs region). cwbvhNodeTexels/cwbvhRecordTexels = the CWBVH
     *  experiment's regions (fable-accel-cwbvh §6; 0 = batch ineligible — the
     *  adapter's ONE eligibility truth). */
    batches: ReadonlyArray<{ instanceCount: number; placementTexels: 1 | 2; attrTexels: number; cwbvhNodeTexels: number; cwbvhRecordTexels: number }>;
    /** Samplable mesh emitters, keyed by MESH ordinal (fable-mesh-lights) — the
     *  dataTenantsOf adapter is the ONE predicate that builds this list. */
    meshLights: ReadonlyArray<{ meshOrdinal: number; vertexCount: number; triCount: number }>;
    /** The scene TABLE (fable-object-tables — Stage B): leaf-list + analytic-record
     *  regions in `records`, the scene TLAS in `nodes`. Allocated whenever eligible
     *  objects exist (strategy-independent — 'unrolled' programs simply never read
     *  them, the always-upload precedent). null = no eligible objects. */
    sceneTable: { leafCount: number; analyticTexels: number } | null;
    /** The LIGHT tree (fable-light-bvh §5): the table rows + bit trails in `records`,
     *  the tree nodes in `nodes`. Allocated whenever the light roster is non-empty and
     *  tree-eligible (every kind declares treeBounds) — strategy-independent; 'power'
     *  programs never read it. tableTexels = count × the layout truth's row stride. */
    lightTree: { count: number; tableTexels: number } | null;
}

export interface SceneTableSlot {
    /** Records-channel base of the leaf list (1 texel per leaf, TLAS-leaf order). */
    leafListBase: number;
    /** Records-channel base of the analytic records (fixed stride, solids-first order). */
    analyticBase: number;
    /** Nodes-channel base of the scene TLAS (padded to 2(2L−1) texels). */
    tlasBase: number;
}

export interface LightTreeSlot {
    /** Records-channel base of the light table (count × stride texels, light-id order). */
    tableBase: number;
    /** Records-channel base of the bit trails (1 texel per light: two u24 halves). */
    trailsBase: number;
    /** Nodes-channel base of the light tree (2(2n−1) texels — EXACT at leaf = 1). */
    treeBase: number;
}

export interface DataLayout {
    /** Total texels per channel (0 = channel unused by this scene). */
    totals: { vertices: number; normals: number; uvs: number; indices: number; nodes: number; records: number; nodesq: number };
    meshes: MeshSlot[];
    batches: BatchSlot[];
    /** By MESH ordinal. */
    meshLights: Map<number, MeshLightSlot>;
    sceneTable?: SceneTableSlot;
    lightTree?: LightTreeSlot;
}

/** ≤ 2T−1 nodes over T leaves, 2 texels/node — the declared BLAS/TLAS padding bound. */
export function nodeTexelBound(leafCount: number): number {
    return 2 * bvhNodeBound(leafCount);
}

export function planDataLayout(t: DataTenants): DataLayout {
    let v = 0, tr = 0, n = 0, r = 0;
    const meshes: MeshSlot[] = [];
    for (const m of t.meshes) {
        meshes.push({ vbase: v, tbase: tr, nbase: n });
        v += m.vertexCount;
        tr += m.triCount;
        n += nodeTexelBound(m.triCount);
    }
    let nq = 0;
    const batches: BatchSlot[] = [];
    for (const b of t.batches) {
        const placementsBase = r; r += b.placementTexels * b.instanceCount;
        const attrsBase = b.attrTexels > 0 ? r : -1; r += b.attrTexels;
        const cwbvhRecordsBase = b.cwbvhRecordTexels > 0 ? r : -1; r += b.cwbvhRecordTexels;
        const tlasBase = n; n += nodeTexelBound(b.instanceCount);
        const cwbvhNodesBase = b.cwbvhNodeTexels > 0 ? nq : -1; nq += b.cwbvhNodeTexels;
        batches.push({ placementsBase, tlasBase, attrsBase, cwbvhNodesBase, cwbvhRecordsBase });
    }
    const meshLights = new Map<number, MeshLightSlot>();
    for (const l of t.meshLights) {
        meshLights.set(l.meshOrdinal, { wposBase: v, cdfBase: r });
        v += l.vertexCount;
        r += l.triCount;
    }
    let sceneTable: SceneTableSlot | undefined;
    if (t.sceneTable !== null && t.sceneTable.leafCount > 0) {
        const leafListBase = r; r += t.sceneTable.leafCount;
        const analyticBase = r; r += t.sceneTable.analyticTexels;
        const tlasBase = n; n += nodeTexelBound(t.sceneTable.leafCount);
        sceneTable = { leafListBase, analyticBase, tlasBase };
    }
    // The light tree (fable-light-bvh §5) — APPENDED LAST deliberately: every
    // pre-existing tenant's bases stay byte-stable under the carve gate.
    let lightTree: LightTreeSlot | undefined;
    if (t.lightTree !== null && t.lightTree.count > 0) {
        const tableBase = r; r += t.lightTree.tableTexels;
        const trailsBase = r; r += t.lightTree.count;
        const treeBase = n; n += nodeTexelBound(t.lightTree.count);
        lightTree = { tableBase, trailsBase, treeBase };
    }
    return {
        totals: { vertices: v, normals: vertexChannelTotal(t), uvs: vertexChannelTotal(t), indices: tr, nodes: n, records: r, nodesq: nq },
        meshes, batches, meshLights,
        ...(sceneTable !== undefined ? { sceneTable } : {}),
        ...(lightTree !== undefined ? { lightTree } : {}),
    };
}

/** normals/uvs regions exist only for MESH geometry slots (light wpos bakes live only in
 *  `vertices`), so those channels end at the last mesh's vertex span. */
function vertexChannelTotal(t: DataTenants): number {
    let v = 0;
    for (const m of t.meshes) v += m.vertexCount;
    return v;
}

/** The App-side bound assertion (fable-data-rail §4): a packed payload exceeding its
 *  ledger region is a broken padding bound — fail LOUDLY, never write out of region. */
export function assertFits(what: string, packedTexels: number, regionTexels: number): void {
    if (packedTexels > regionTexels) {
        throw new Error(`data rail: ${what} packed ${packedTexels} texels into a ${regionTexels}-texel region — a declared padding bound is wrong (fable-data-rail §4)`);
    }
}
