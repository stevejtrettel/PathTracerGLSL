// runInWorker's fallback rule: a worker that fails AFTER receiving TRANSFERRED inputs must
// not fall back — the inputs are detached (zero-length) and the fallback would compute on
// empty arrays. Cloned inputs are intact, so that case still falls back.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { runInWorker } from '../../src/app/utils/worker.js';

/** A Worker whose script "fails to load" asynchronously, after postMessage — like a module
 *  worker with a bad URL. postMessage detaches transferred buffers, as the real one does. */
class FailingWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: { message: string }) => void) | null = null;
    postMessage(_req: unknown, transfers: Transferable[] = []): void {
        for (const t of transfers) structuredClone(t, { transfer: [t] });   // detach
        setTimeout(() => this.onerror?.({ message: 'script load failed' }), 0);
    }
    terminate(): void {}
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('runInWorker', () => {
    it('rejects (no fallback) when transferred inputs were detached by a failed worker', async () => {
        vi.stubGlobal('Worker', FailingWorker);
        const input = new Float64Array([1, 2, 3]);
        const fallback = vi.fn(() => input.length);
        await expect(runInWorker('test', () => new FailingWorker() as unknown as Worker, { input }, [input.buffer], fallback))
            .rejects.toThrow(/script load failed/);
        expect(fallback).not.toHaveBeenCalled();
        expect(input.length).toBe(0);   // what the fallback would have seen
    });

    it('falls back when the inputs were cloned (still intact)', async () => {
        vi.stubGlobal('Worker', FailingWorker);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const input = new Float64Array([1, 2, 3]);
        const result = await runInWorker('test', () => new FailingWorker() as unknown as Worker, { input }, [], () => input.length);
        expect(result).toBe(3);
    });

    it('falls back when the worker cannot even be created', async () => {
        vi.stubGlobal('Worker', FailingWorker);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const input = new Float64Array([1, 2, 3]);
        const result = await runInWorker('test', () => { throw new Error('no workers here'); }, { input }, [input.buffer], () => input.length);
        expect(result).toBe(3);
    });

    it('rejects (no fallback) when the WORK throws inside the worker', async () => {
        class ThrowingTaskWorker extends FailingWorker {
            postMessage(): void { setTimeout(() => this.onmessage?.({ data: { workerError: 'cwbvh: leaf child over P_max' } } as MessageEvent), 0); }
        }
        vi.stubGlobal('Worker', ThrowingTaskWorker);
        const fallback = vi.fn(() => 0);
        await expect(runInWorker('pack', () => new ThrowingTaskWorker() as unknown as Worker, {}, [], fallback))
            .rejects.toThrow(/pack: cwbvh: leaf child over P_max/);
        expect(fallback).not.toHaveBeenCalled();
    });
});
