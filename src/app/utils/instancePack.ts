// app/utils/instancePack.ts — the off-thread instance pack wrapper
// (fable-instance-clouds §8 stage 2). Same signature and BYTE-IDENTICAL output as the
// sync packInstanceBatch (same core runs, different thread); falls back to the sync
// path loudly-but-gracefully when Workers are unavailable or the worker fails to
// load, so no environment can lose the ability to render.

import { packInstanceBatch, type AttributeRowSpec, type PackedInstanceBatch, type ParamsRecordSpec } from '../../components/intersection/instancing/instancing.js';
import type { Similarity } from '../../components/geometry/similarity.js';
import type { PackedPlacements } from '../../compiler/types.js';
import type { PackRequest } from './packWorker.js';

export async function packInstanceBatchOffThread(
    localBox: { min: [number, number, number]; max: [number, number, number] },
    placements: Similarity[] | PackedPlacements,
    attrs?: AttributeRowSpec[],
    paramsRecord?: ParamsRecordSpec,
): Promise<PackedInstanceBatch> {
    if (typeof Worker === 'undefined') return packInstanceBatch(localBox, placements, attrs, paramsRecord);
    let worker: Worker | undefined;
    try {
        // The literal '.ts' path is what exists on disk — Vite's worker pipeline resolves
        // and bundles it (module worker), unlike bare module imports where the repo's
        // '.js' convention applies.
        worker = new Worker(new URL('./packWorker.ts', import.meta.url), { type: 'module' });
        const w = worker;
        return await new Promise<PackedInstanceBatch>((resolve, reject) => {
            w.onmessage = (e: MessageEvent<PackedInstanceBatch>) => resolve(e.data);
            w.onerror = (err) => reject(new Error(`pack worker failed: ${err.message ?? 'script error'}`));
            const req: PackRequest = { localBox, placements, ...(attrs !== undefined ? { attrs } : {}), ...(paramsRecord !== undefined ? { paramsRecord } : {}) };
            w.postMessage(req);
        });
    } catch (e) {
        console.warn('instance pack: worker unavailable, packing on the main thread (page may hitch)', e);
        return packInstanceBatch(localBox, placements, attrs, paramsRecord);
    } finally {
        worker?.terminate();
    }
}
