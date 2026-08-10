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

/** Run `req` through a dedicated one-shot worker; fall back to `fallback()` (the sync
 *  core) when Workers are unavailable or the worker fails to load, so no environment
 *  can lose the ability to render. `transfers` lists input buffers to MOVE rather than
 *  copy — callers transferring inputs must guarantee they are not shared views (a
 *  failed worker LOAD throws before postMessage, so the fallback still sees them). */
export async function runInWorker<Req, Res>(
    label: string,
    makeWorker: () => Worker,
    req: Req,
    transfers: Transferable[],
    fallback: () => Res,
): Promise<Res> {
    if (typeof Worker === 'undefined') return fallback();
    let worker: Worker | undefined;
    try {
        worker = makeWorker();
        const w = worker;
        return await new Promise<Res>((resolve, reject) => {
            w.onmessage = (e: MessageEvent<Res>) => resolve(e.data);
            w.onerror = (err) => reject(new Error(`${label} worker failed: ${err.message ?? 'script error'}`));
            w.postMessage(req, transfers);
        });
    } catch (e) {
        console.warn(`${label}: worker unavailable, running on the main thread (page may hitch)`, e);
        return fallback();
    } finally {
        worker?.terminate();
    }
}
