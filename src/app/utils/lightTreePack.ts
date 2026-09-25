// app/utils/lightTreePack.ts — the off-thread light-tree build wrapper (fable-light-bvh
// §7). Same output as the sync buildLightTree (same core runs, different thread).
// Plumbing rides the shared runInWorker skeleton; the policy here: inputs TRANSFER in
// (they are built solely for this call — detaching costs nothing, copying ~11 MB at 194k
// leaves would). If the worker fails after receiving them, the arrays are detached and the
// build rejects rather than silently running on empty inputs (see runInWorker). Small
// rosters build synchronously (the shared threshold).

import { buildLightTree, type LightTreeResult } from '../../components/accel/light_tree/light_tree.js';
import type { LightTreeRequest } from './lightTreeWorker.js';
import { runInWorker, WORKER_MIN_ITEMS } from './worker.js';

export async function buildLightTreeOffThread(boxes: Float64Array, powers: Float64Array, n: number): Promise<LightTreeResult> {
    if (n < WORKER_MIN_ITEMS) return buildLightTree(boxes, powers, n);
    const req: LightTreeRequest = { boxes, powers, n };
    return runInWorker(
        'light tree',
        // The literal '.ts' path is what exists on disk — Vite's worker pipeline resolves
        // and bundles it (module worker), unlike bare module imports where the repo's
        // '.js' convention applies.
        () => new Worker(new URL('./lightTreeWorker.ts', import.meta.url), { type: 'module' }),
        req,
        [boxes.buffer as ArrayBuffer, powers.buffer as ArrayBuffer],   // transfer-in: see header
        () => buildLightTree(boxes, powers, n),
    );
}
