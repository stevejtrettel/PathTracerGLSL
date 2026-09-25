// app/utils/lightTreeWorker.ts — the light-tree build WORKER entry (fable-light-bvh
// §7 — the "emissive clouds ≳100k" offload, trigger fired by clebsch-glow's 194k-leaf
// tree): runs buildLightTree (energy-weighted SAH + bit trails) off the main thread.
// App-side orchestration ONLY — the sync core stays in components/ (pure,
// vitest-tested); this file is plumbing, exactly the packWorker precedent.
//
// Protocol: ONE message in ({ boxes, powers, n }) → ONE message out (LightTreeResult),
// output buffers TRANSFERRED (worker-created). DEVIATION from packWorker's clone-in
// rule, deliberate and safe: the inputs are built by _uploadSceneGeometry solely for
// this call (never scene views, never reused), so the caller transfers them in too —
// no 11 MB copy at cloud scale.

import { buildLightTree } from '../../components/accel/light_tree/light_tree.js';
import { answerWorkerTask } from './worker.js';

export interface LightTreeRequest {
    boxes: Float64Array;
    powers: Float64Array;
    n: number;
}

self.onmessage = (e: MessageEvent<LightTreeRequest>) => answerWorkerTask(() => {
    const { boxes, powers, n } = e.data;
    const tree = buildLightTree(boxes, powers, n);
    return { result: tree, transfers: [tree.nodes.buffer as ArrayBuffer, tree.trails.buffer as ArrayBuffer] };
});
