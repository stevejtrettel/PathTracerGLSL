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

import { packInstanceBatch, type AttributeRowSpec } from '../../components/intersection/instancing/instancing.js';
import type { Similarity } from '../../components/geometry/similarity.js';
import type { PackedPlacements } from '../../compiler/types.js';

export interface PackRequest {
    localBox: { min: [number, number, number]; max: [number, number, number] };
    placements: Similarity[] | PackedPlacements;
    attrs?: AttributeRowSpec[];
}

self.onmessage = (e: MessageEvent<PackRequest>) => {
    const { localBox, placements, attrs } = e.data;
    const packed = packInstanceBatch(localBox, placements, attrs);
    const transfers: ArrayBuffer[] = [packed.placements.buffer as ArrayBuffer, packed.nodes.buffer as ArrayBuffer];
    if (packed.attributes !== undefined) transfers.push(packed.attributes.buffer as ArrayBuffer);
    (self as unknown as Worker).postMessage(packed, transfers);
};
