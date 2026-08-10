// app/utils/packWorker.ts — the instance-pack WORKER entry (fable-instance-clouds §8
// stage 2): runs packInstanceBatch (world boxes + binned SAH + placement records) off
// the main thread so a 1M-instance TLAS build never freezes the page. App-side
// orchestration ONLY — the sync core stays in components/ (pure, vitest-tested); this
// file is plumbing, exactly the env-bake precedent.
//
// Protocol: ONE message in ({ localBox, placements, attrs }) → ONE message out (the
// PackedInstanceBatch), output buffers TRANSFERRED (worker-created — nothing shared).
// Inputs arrive by structured clone (copy) deliberately: transferring them would
// detach the scene's typed arrays (the .inst table views), breaking later repacks.

import { packInstanceBatch, type AttributeRowSpec, type ParamsRecordSpec } from '../../components/intersection/instancing/instancing.js';
import type { Similarity } from '../../components/geometry/similarity.js';
import type { PackedPlacements } from '../../compiler/types.js';
import type { AABB } from '../../components/accel/bvh/bvh.js';

export interface PackRequest {
    localBox: AABB;
    placements: Similarity[] | PackedPlacements;
    attrs?: AttributeRowSpec[];
    /** Present iff the batch's tier is 'params' (impl-plan-placement-fold stage 3). */
    paramsRecord?: ParamsRecordSpec;
}

self.onmessage = (e: MessageEvent<PackRequest>) => {
    const { localBox, placements, attrs, paramsRecord } = e.data;
    const packed = packInstanceBatch(localBox, placements, attrs, paramsRecord);
    const transfers: ArrayBuffer[] = [packed.placements.buffer as ArrayBuffer, packed.nodes.buffer as ArrayBuffer];
    if (packed.attributes !== undefined) transfers.push(packed.attributes.buffer as ArrayBuffer);
    if (packed.cwbvh !== undefined) transfers.push(packed.cwbvh.nodes.buffer as ArrayBuffer, packed.cwbvh.records.buffer as ArrayBuffer);
    (self as unknown as Worker).postMessage(packed, transfers);
};
