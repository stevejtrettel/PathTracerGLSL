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
// Pure TS, no imports (components purity).

export interface MeshSlot {
    /** Vertex-texel base (vertices/normals/uvs channels) — fetches add it to LOCAL vertex ids. */
    vbase: number;
    /** Triangle-texel base (indices channel) — fetches add it to LOCAL triangle ids. */
    tbase: number;
    /** Node-texel base (nodes channel) — fetches add it to LOCAL node texel ids. */
    nbase: number;
}

export interface BatchSlot {
    /** Records-channel base of the placement region (2 texels/instance, TLAS-leaf order). */
    placementsBase: number;
    /** Nodes-channel base of the batch TLAS (padded to 2(2N−1) texels). */
    tlasBase: number;
    /** Records-channel base of the attrs region (attrTexels texels), or -1 when none. */
    attrsBase: number;
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
    /** ALL instance batches, batch-ordinal order. attrTexels = attribute rows × instances
     *  (0 = no attrs region). */
    batches: ReadonlyArray<{ instanceCount: number; attrTexels: number }>;
    /** Samplable mesh emitters, keyed by MESH ordinal (fable-mesh-lights) — the
     *  dataTenantsOf adapter is the ONE predicate that builds this list. */
    meshLights: ReadonlyArray<{ meshOrdinal: number; vertexCount: number; triCount: number }>;
}

export interface DataLayout {
    /** Total texels per channel (0 = channel unused by this scene). */
    totals: { vertices: number; normals: number; uvs: number; indices: number; nodes: number; records: number };
    meshes: MeshSlot[];
    batches: BatchSlot[];
    /** By MESH ordinal. */
    meshLights: Map<number, MeshLightSlot>;
}

/** ≤ 2T−1 nodes over T leaves, 2 texels/node — the declared BLAS/TLAS padding bound. */
export function nodeTexelBound(leafCount: number): number {
    return leafCount > 0 ? 2 * (2 * leafCount - 1) : 0;
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
    const batches: BatchSlot[] = [];
    for (const b of t.batches) {
        const placementsBase = r; r += 2 * b.instanceCount;
        const attrsBase = b.attrTexels > 0 ? r : -1; r += b.attrTexels;
        const tlasBase = n; n += nodeTexelBound(b.instanceCount);
        batches.push({ placementsBase, tlasBase, attrsBase });
    }
    const meshLights = new Map<number, MeshLightSlot>();
    for (const l of t.meshLights) {
        meshLights.set(l.meshOrdinal, { wposBase: v, cdfBase: r });
        v += l.vertexCount;
        r += l.triCount;
    }
    return {
        totals: { vertices: v, normals: vertexChannelTotal(t), uvs: vertexChannelTotal(t), indices: tr, nodes: n, records: r },
        meshes, batches, meshLights,
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
