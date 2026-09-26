import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RenderCoordinator } from '../../src/app/RenderCoordinator.js';
import { RenderStoppedError } from '../../src/errors/RenderErrors.js';
import { AppEvents } from '../../src/app/events.js';
import { fakeEngine, asEngine } from './fakes.js';

// Manual requestAnimationFrame: store the callback so tests step frames deterministically.
let rafCb: FrameRequestCallback | null = null;
function step() { const cb = rafCb; rafCb = null; cb?.(0); }

beforeEach(() => {
    rafCb = null;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafCb = cb; return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => { rafCb = null; });
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function makeEmitter() {
    const events: Array<{ event: string; data?: unknown }> = [];
    return { emit: (event: string, data?: unknown) => events.push({ event, data }), events };
}

describe('RenderCoordinator — FPS', () => {
    it('getFPS is 0 with no history', () => {
        expect(new RenderCoordinator(asEngine(fakeEngine())).getFPS()).toBe(0);
    });
});

describe('RenderCoordinator — deferred accumulation reset (#4)', () => {
    it('defers a reset requested while stopped, then consumes it at the next start', () => {
        const engine = fakeEngine();
        const rc = new RenderCoordinator(asEngine(engine));
        rc.requestAccumulationReset('camera'); // stopped → deferred, not applied now
        expect(engine.clearAccumulation).not.toHaveBeenCalled();
        rc.startInteractive();
        expect(engine.clearAccumulation).toHaveBeenCalledTimes(1);
    });

    it('applies a reset immediately when running', () => {
        const engine = fakeEngine();
        const rc = new RenderCoordinator(asEngine(engine));
        rc.startInteractive();
        rc.requestAccumulationReset('camera');
        expect(engine.clearAccumulation).toHaveBeenCalledTimes(1);
    });
});

describe('RenderCoordinator — production promise', () => {
    it('resolves when the sample goal is met', async () => {
        const engine = fakeEngine();
        engine.setSampleCount(5);
        const rc = new RenderCoordinator(asEngine(engine));
        const done = rc.startProduction({ targetSamples: 5 });
        step(); // one frame → checkGoalMet true → complete()
        await expect(done).resolves.toBeUndefined();
    });

    it('rejects with RenderStoppedError when stopped mid-render', async () => {
        const engine = fakeEngine();
        const rc = new RenderCoordinator(asEngine(engine));
        const done = rc.startProduction({ targetSamples: 1000 });
        rc.stop();
        await expect(done).rejects.toBeInstanceOf(RenderStoppedError);
    });

    it('forces a final 100% progress tick on completion (#7b)', async () => {
        const engine = fakeEngine();
        engine.setSampleCount(3); // renderFrame() bumps to 4 → exactly the target
        const rc = new RenderCoordinator(asEngine(engine));
        const progress = vi.fn();
        rc.onProgress = progress;
        const done = rc.startProduction({ targetSamples: 4 });
        step();
        await done;
        const last = progress.mock.calls.at(-1)![0];
        expect(last.state).toBe('complete');
        expect(last.percentComplete).toBe(100);
    });
});

describe('RenderCoordinator — mode guarding & events', () => {
    it('startInteractive throws while a production render is running', () => {
        const rc = new RenderCoordinator(asEngine(fakeEngine()));
        const done = rc.startProduction({ targetSamples: 1000 });
        done.catch(() => {}); // avoid unhandled rejection when we stop in teardown
        expect(() => rc.startInteractive()).toThrow(/production/i);
        rc.stop();
    });

    it('emits RENDER_STARTED through the injected emitter', () => {
        const emitter = makeEmitter();
        const rc = new RenderCoordinator(asEngine(fakeEngine()), emitter);
        rc.startInteractive();
        expect(emitter.events.some(e => e.event === AppEvents.RENDER_STARTED)).toBe(true);
    });
});

describe('RenderCoordinator — a frame that throws', () => {
    // Before the fix the loop just stopped scheduling frames: state stayed 'rendering', a
    // production render's promise never settled (so parameters stayed locked), and nothing
    // was reported.
    it('stops cleanly, rejects a pending production render, and reports the error', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const engine = fakeEngine();
        const boom = new Error('extern texture missing');
        engine.renderFrame.mockImplementation(() => { throw boom; });
        const emitter = makeEmitter();
        const rc = new RenderCoordinator(asEngine(engine), emitter);
        const done = rc.startProduction({ targetSamples: 64 });
        step();
        await expect(done).rejects.toBe(boom);
        expect(rc.getState()).toBe('stopped');
        expect(rafCb).toBeNull();   // no further frame scheduled
        const names = emitter.events.map((e) => e.event);
        expect(names).toContain(AppEvents.RENDER_ERROR);
        expect(names).toContain(AppEvents.RENDER_STOPPED);
        expect(emitter.events.find((e) => e.event === AppEvents.RENDER_ERROR)!.data).toEqual({ error: boom });
    });

    it('reports the error before the stop, each once', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const engine = fakeEngine();
        engine.renderFrame.mockImplementation(() => { throw new Error('boom'); });
        const emitter = makeEmitter();
        const rc = new RenderCoordinator(asEngine(engine), emitter);
        rc.startInteractive();
        step();
        const names = emitter.events.map((e) => e.event).filter((n) => n === AppEvents.RENDER_ERROR || n === AppEvents.RENDER_STOPPED);
        expect(names).toEqual([AppEvents.RENDER_ERROR, AppEvents.RENDER_STOPPED]);
    });

    it('an interactive render stops the same way', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const engine = fakeEngine();
        engine.renderFrame.mockImplementation(() => { throw new Error('boom'); });
        const rc = new RenderCoordinator(asEngine(engine), makeEmitter());
        rc.startInteractive();
        step();
        expect(rc.isRunning()).toBe(false);
        expect(rafCb).toBeNull();
    });
});
