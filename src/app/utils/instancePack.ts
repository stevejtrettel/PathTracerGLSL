// app/utils/instancePack.ts — the off-thread instance pack wrapper
// (fable-instance-clouds §8 stage 2). Same signature and BYTE-IDENTICAL output as the
// sync packInstanceBatch (same core runs, different thread). Plumbing rides the shared
// runInWorker skeleton; the policy here: inputs CLONE in (the scene's typed arrays —
// .inst table views — must not detach; packWorker documents this), small batches pack
// synchronously (the shared threshold — worker spin-up costs more than the build).

import { packInstanceBatch, placementCount, type AttributeRowSpec, type PackedInstanceBatch, type ParamsRecordSpec } from '../../components/intersection/instancing/instancing.js';
import type { Similarity } from '../../components/geometry/similarity.js';
import type { PackedPlacements } from '../../compiler/types.js';
import type { PackRequest } from './packWorker.js';
import type { AABB } from '../../components/accel/bvh/bvh.js';
import { runInWorker, WORKER_MIN_ITEMS } from './worker.js';

export async function packInstanceBatchOffThread(
    localBox: AABB,
    placements: Similarity[] | PackedPlacements,
    attrs?: AttributeRowSpec[],
    paramsRecord?: ParamsRecordSpec,
): Promise<PackedInstanceBatch> {
    if (placementCount(placements) < WORKER_MIN_ITEMS) return packInstanceBatch(localBox, placements, attrs, paramsRecord);
    const req: PackRequest = { localBox, placements, ...(attrs !== undefined ? { attrs } : {}), ...(paramsRecord !== undefined ? { paramsRecord } : {}) };
    return runInWorker(
        'instance pack',
        // The literal '.ts' path is what exists on disk — Vite's worker pipeline resolves
        // and bundles it (module worker), unlike bare module imports where the repo's
        // '.js' convention applies.
        () => new Worker(new URL('./packWorker.ts', import.meta.url), { type: 'module' }),
        req,
        [],   // clone-in: see header
        () => packInstanceBatch(localBox, placements, attrs, paramsRecord),
    );
}
