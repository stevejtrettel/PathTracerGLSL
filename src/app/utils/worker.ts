// app/utils/worker.ts — THE one off-thread run skeleton (the worker consolidation,
// Aug 10 2026: instancePack and lightTreePack carried verbatim copies of this wiring,
// and their policies had begun to diverge by accident rather than decision).
//
// What stays at each call site is exactly the POLICY: the worker constructor (the
// literal `new Worker(new URL('./x.ts', import.meta.url))` must appear at the call
// site — Vite's worker pipeline resolves it statically), the input-transfer rule
// (clone-in protects scene views; transfer-in is for arrays built solely for the
// call), the small-input sync gate, and the fallback. Everything here is plumbing:
// promise wiring, error mapping, loud-but-graceful main-thread fallback, terminate.

/** Below this item count the sync path is faster than worker spin-up — the ONE
 *  threshold policy (lightTreePack's gate, now shared; instancePack previously spun a
 *  worker for a 1-instance batch). */
export const WORKER_MIN_ITEMS = 4096;

/** The message a worker entry posts when the WORK itself throws (not the worker machinery).
 *  runInWorker rejects with it instead of falling back: the sync core would throw the same
 *  error on the main thread, after freezing the page for the whole build (a CWBVH over a
 *  1M-instance cloud did exactly that before failing, Sep 25 2026 audit). */
export interface WorkerTaskFailure { workerError: string }

export function isWorkerTaskFailure(data: unknown): data is WorkerTaskFailure {
    return typeof data === 'object' && data !== null && typeof (data as { workerError?: unknown }).workerError === 'string';
}

/** For worker entries: run the task, posting its result, or a WorkerTaskFailure if it throws. */
export function answerWorkerTask<Res>(task: () => { result: Res; transfers: Transferable[] }): void {
    const scope = self as unknown as Worker;
    try {
        const { result, transfers } = task();
        scope.postMessage(result, transfers);
    } catch (err) {
        scope.postMessage({ workerError: err instanceof Error ? err.message : String(err) } satisfies WorkerTaskFailure);
    }
}

class WorkerTaskError extends Error {}

/** Run `req` through a dedicated one-shot worker; fall back to `fallback()` (the sync
 *  core) when Workers are unavailable or the worker cannot be created, so no environment
 *  can lose the ability to render. `transfers` lists input buffers to MOVE rather than
 *  copy — callers transferring inputs must guarantee they are not shared views.
 *
 *  A worker can also fail AFTER postMessage (a module worker's script load failure arrives
 *  as an async error event). By then transferred inputs are detached — zero-length — so the
 *  fallback would silently compute on empty arrays; that case rejects instead. Cloned inputs
 *  are intact, so it still falls back. */
export async function runInWorker<Req, Res>(
    label: string,
    makeWorker: () => Worker,
    req: Req,
    transfers: Transferable[],
    fallback: () => Res,
): Promise<Res> {
    if (typeof Worker === 'undefined') return fallback();
    let worker: Worker | undefined;
    let posted = false;
    try {
        worker = makeWorker();
        const w = worker;
        return await new Promise<Res>((resolve, reject) => {
            w.onmessage = (e: MessageEvent<Res | WorkerTaskFailure>) => {
                if (isWorkerTaskFailure(e.data)) reject(new WorkerTaskError(`${label}: ${e.data.workerError}`));
                else resolve(e.data);
            };
            w.onerror = (err) => reject(new Error(`${label} worker failed: ${err.message ?? 'script error'}`));
            w.postMessage(req, transfers);
            posted = true;
        });
    } catch (e) {
        if (e instanceof WorkerTaskError) throw e;     // the work failed, not the worker: the sync core would too
        if (posted && transfers.length > 0) throw e;   // inputs are detached: no fallback possible
        console.warn(`${label}: worker unavailable, running on the main thread (page may hitch)`, e);
        return fallback();
    } finally {
        worker?.terminate();
    }
}
