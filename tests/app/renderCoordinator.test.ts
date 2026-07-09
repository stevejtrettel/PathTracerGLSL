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
