import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RendererManager } from '../../src/app/RendererManager.js';
import { ParameterStore } from '../../src/app/ParameterStore.js';
import { EventBus } from '../../src/app/EventBus.js';
import { AppEvents } from '../../src/app/events.js';
import { fakeEngine, fakeCompiler, asEngine, type FakeEngine } from './fakes.js';
import type { ICompiler } from '../../src/compiler/types.js';

const scene = { id: 'scn', ambientSpace: { type: 'euclidean' as const }, objects: [], materials: {}, lights: [] };
const stratA = { id: 'a', measurement: { camera: { type: 'pinhole' as const, fov: 0.8 }, maxBounces: 1 }, estimator: { directLighting: 'none' as const, russianRoulette: null, accumulation: { type: 'average' as const } }, view: { tonemap: { type: 'reinhard' as const } } };

async function initialized(engine: FakeEngine) {
    const compiler = fakeCompiler();
    const parameterStore = new ParameterStore();
    const eventBus = new EventBus();
    const mgr = new RendererManager({ compiler: compiler as unknown as ICompiler, engine: asEngine(engine), parameterStore, eventBus });
    await mgr.initialize({ scene, strategies: [stratA] });
    return { mgr, compiler, parameterStore, eventBus };
}

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe('RendererManager.initialize', () => {
    it('compiles, loads, and selects the first renderer', async () => {
        const engine = fakeEngine();
        const { mgr } = await initialized(engine);
        expect(engine.loadRenderers).toHaveBeenCalledTimes(1);
        expect(engine.selectRenderer).toHaveBeenCalledWith('a-scn');
        expect(mgr.getActiveRendererId()).toBe('a-scn');
    });

    it('throws when given no strategies', async () => {
        const mgr = new RendererManager({ compiler: fakeCompiler() as unknown as ICompiler, engine: asEngine(fakeEngine()), parameterStore: new ParameterStore(), eventBus: new EventBus() });
        await expect(mgr.initialize({ scene, strategies: [] })).rejects.toThrow(/strategy/i);
    });
});

describe('RendererManager.initialize — a second call', () => {
    const stratB = { ...stratA, id: 'b' };

    it('on the same scene, recompiles every strategy together (one layout) and selects the new one', async () => {
        const engine = fakeEngine();
        const { mgr, compiler } = await initialized(engine);
        await mgr.initialize({ scene, strategies: [stratB] });
        const lastCall = compiler.compileScene.mock.calls.at(-1)!;
        expect(lastCall[1].map((s: { id: string }) => s.id)).toEqual(['a', 'b']);
        expect(engine.loadRenderer).toHaveBeenCalledWith('a-scn', expect.anything());   // reloaded on the new layout
        expect(engine.loadRenderer).toHaveBeenCalledWith('b-scn', expect.anything());
        expect(mgr.getActiveRendererId()).toBe('b-scn');
        mgr.selectRendererByStrategy('a');   // the first strategy is still loaded and selectable
        expect(mgr.getActiveRendererId()).toBe('a-scn');
    });

    it('on a different scene, unloads the old renderers first', async () => {
        const engine = fakeEngine();
        const { mgr, compiler } = await initialized(engine);
        const other = { ...scene, id: 'other' };
        await mgr.initialize({ scene: other, strategies: [stratB] });
        expect(engine.unloadRenderer).toHaveBeenCalledWith('a-scn');
        expect(compiler.compileScene.mock.calls.at(-1)![1].map((s: { id: string }) => s.id)).toEqual(['b']);
        expect(mgr.getActiveRendererId()).toBe('b-other');
    });
});

describe('RendererManager.recompile — atomicity', () => {
    it('a GPU validation failure leaves existing renderers untouched (no commit)', async () => {
        const engine = fakeEngine();
        const { mgr } = await initialized(engine);
        const activeBefore = mgr.getActiveRendererId();
        const sceneBefore = mgr.getScene();

        engine.validateRenderers.mockImplementation(() => { throw new Error('ERROR: 0:12: bad'); });
        expect(() => mgr.recompile()).toThrow();

        // Phase 3 (commit) never ran:
        expect(engine.loadRenderer).not.toHaveBeenCalled();
        expect(engine.clearAccumulation).not.toHaveBeenCalled();
        expect(mgr.getActiveRendererId()).toBe(activeBefore);
        expect(mgr.getScene()).toBe(sceneBefore);
    });

    it('a successful recompile commits: loadRenderer, reselect, resend, clear, emit', async () => {
        const engine = fakeEngine();
        const { mgr, parameterStore, eventBus } = await initialized(engine);
        parameterStore.set('camera.fov', 0.8);
        const resend = vi.spyOn(parameterStore, 'resendAll');
        const switched = vi.fn();
        eventBus.on(AppEvents.RENDERER_SWITCHED, switched);

        mgr.recompile();

        expect(engine.loadRenderer).toHaveBeenCalledTimes(1);
        expect(engine.selectRenderer).toHaveBeenLastCalledWith('a-scn');
        expect(resend).toHaveBeenCalled();
        expect(engine.clearAccumulation).toHaveBeenCalled();
        expect(switched).toHaveBeenCalledWith({ rendererId: 'a-scn' });
    });
});

describe('RendererManager.selectRenderer', () => {
    it('is a no-op when selecting the already-active renderer', async () => {
        const engine = fakeEngine();
        const { mgr } = await initialized(engine);
        engine.selectRenderer.mockClear();
        mgr.selectRenderer('a-scn');
        expect(engine.selectRenderer).not.toHaveBeenCalled();
    });

    it('warns and does nothing for an unknown renderer id', async () => {
        const engine = fakeEngine();
        const { mgr } = await initialized(engine);
        engine.selectRenderer.mockClear();
        mgr.selectRenderer('ghost');
        expect(engine.selectRenderer).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalled();
    });
});
