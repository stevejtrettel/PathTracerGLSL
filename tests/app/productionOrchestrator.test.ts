import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProductionOrchestrator } from '../../src/app/ProductionOrchestrator.js';
import { ParameterStore } from '../../src/app/ParameterStore.js';
import type { App } from '../../src/app/App.js';
import type { RenderCoordinator } from '../../src/app/RenderCoordinator.js';

beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

function fakeApp(opts: { profiling?: boolean; hasLayout?: boolean } = {}) {
    const log: string[] = [];
    const app = {
        log,
        getLayoutMode: () => 'grid',
        hasLayout: () => opts.hasLayout ?? true,
        isProfilingEnabled: () => opts.profiling ?? false,
        setLayoutMode: vi.fn((m: string) => log.push(`layout:${m}`)),
        getCanvasSize: () => [400, 300] as [number, number],
        resize: vi.fn((w: number, h: number) => log.push(`resize:${w}x${h}`)),
        enableProfiling: vi.fn(() => log.push('enableProfiling')),
        disableProfiling: vi.fn(() => log.push('disableProfiling')),
        exportPNG: vi.fn(() => log.push('exportPNG')),
        exportHDR: vi.fn(() => log.push('exportHDR')),
        exportAllAOVs: vi.fn(() => log.push('exportAOVs')),
        quickSave: vi.fn(() => log.push('quickSave')),
    };
    return app;
}

function fakeCoordinator(startProduction: () => Promise<void>, sampleCount = 10) {
    return {
        startProduction: vi.fn(startProduction),
        getSampleCount: () => sampleCount,
        resetAccumulation: vi.fn(),
    };
}

const mk = (app: ReturnType<typeof fakeApp>, coord: ReturnType<typeof fakeCoordinator>, store = new ParameterStore()) =>
    ({ orch: new ProductionOrchestrator(app as unknown as App, coord as unknown as RenderCoordinator, store), store });

describe('ProductionOrchestrator — happy path', () => {
    it('locks params, resets accumulation, auto-exports, then unlocks', async () => {
        const app = fakeApp();
        const coord = fakeCoordinator(() => Promise.resolve());
        const { orch, store } = mk(app, coord);

        await orch.renderProduction(100, { autoExportHDR: true });

        expect(coord.resetAccumulation).toHaveBeenCalledWith('production_start');
        expect(app.exportHDR).toHaveBeenCalled();
        expect(store.isLocked()).toBe(false); // settled → unlocked
    });
});

describe('ProductionOrchestrator — phase guards', () => {
    it('beginProduction rejects a second concurrent production', async () => {
        const app = fakeApp();
        const coord = fakeCoordinator(() => new Promise<void>(() => {})); // never resolves
        const { orch, store } = mk(app, coord);

        orch.renderProduction(100).catch(() => {}); // enters 'active', stays there
        await expect(orch.renderProduction(100)).rejects.toThrow(/already in progress/i);
        expect(store.isLocked()).toBe(true);
    });

    it('extendProduction throws when idle', async () => {
        const { orch } = mk(fakeApp(), fakeCoordinator(() => Promise.resolve()));
        await expect(orch.extendProduction(50)).rejects.toThrow(/no production/i);
    });

    it('exitProduction is idempotent when idle (no resize, no throw)', () => {
        const app = fakeApp();
        const { orch } = mk(app, fakeCoordinator(() => Promise.resolve()));
        expect(() => orch.exitProduction()).not.toThrow();
        expect(app.resize).not.toHaveBeenCalled();
    });
});

describe('ProductionOrchestrator — ordering & profiling', () => {
    it('auto-export runs before exitProduction restores resolution', async () => {
        const app = fakeApp();
        const coord = fakeCoordinator(() => Promise.resolve());
        const { orch } = mk(app, coord);

        await orch.renderProduction(100, { width: 800, height: 600, autoExportHDR: true });
        orch.exitProduction();

        const exportIdx = app.log.indexOf('exportHDR');
        const restoreIdx = app.log.lastIndexOf('resize:400x300'); // restore to original size
        expect(exportIdx).toBeGreaterThanOrEqual(0);
        expect(restoreIdx).toBeGreaterThan(exportIdx);
    });

    it('suspends profiling during production and restores it when settled', async () => {
        const app = fakeApp({ profiling: true });
        const coord = fakeCoordinator(() => Promise.resolve());
        const { orch } = mk(app, coord);

        await orch.renderProduction(100);

        expect(app.disableProfiling).toHaveBeenCalled();
        expect(app.enableProfiling).toHaveBeenCalled();
        expect(app.log.indexOf('disableProfiling')).toBeLessThan(app.log.indexOf('enableProfiling'));
    });
});

describe('ProductionOrchestrator — tiled session', () => {
    const tiles = [
        { col: 0, row: 0, x: 0, y: 64, width: 64, height: 36 },
        { col: 0, row: 1, x: 0, y: 0, width: 64, height: 64 },
    ];

    function tiledApp() {
        const app = fakeApp();
        return Object.assign(app, {
            setImageSize: vi.fn((w: number, h: number) => app.log.push(`image:${w}x${h}`)),
            clearImageSize: vi.fn(() => app.log.push('clearImage')),
            setPixelOffset: vi.fn((x: number, y: number) => app.log.push(`offset:${x},${y}`)),
            clearPixelOffset: vi.fn(() => app.log.push('clearOffset')),
        });
    }

    it('holds ONE lock across all tiles, renders each at its offset, then restores the canvas', async () => {
        const app = tiledApp();
        const store = new ParameterStore();
        const lockedDuringTiles: boolean[] = [];
        const coord = fakeCoordinator(() => { lockedDuringTiles.push(store.isLocked()); return Promise.resolve(); });
        const { orch } = mk(app, coord, store);
        const seen: number[] = [];

        await orch.renderTiles([64, 100], tiles, 16, (_t, i) => { seen.push(i); app.log.push(`read:${i}`); });

        expect(lockedDuringTiles).toEqual([true, true]);
        expect(coord.startProduction).toHaveBeenCalledTimes(2);
        expect(coord.startProduction).toHaveBeenCalledWith({ targetSamples: 16 });
        expect(seen).toEqual([0, 1]);
        expect(app.log.filter(l => !l.startsWith('layout'))).toEqual([
            'image:64x100',
            'resize:64x36', 'offset:0,64', 'read:0',
            'resize:64x64', 'offset:0,0', 'read:1',
            'clearOffset', 'clearImage', 'resize:400x300',
        ]);
        expect(store.isLocked()).toBe(false);
        // Idle again: a normal production can start straight away.
        await expect(orch.renderProduction(10)).resolves.toBeUndefined();
    });

    it('a stop mid-job still clears the offset and restores the canvas', async () => {
        const app = tiledApp();
        let n = 0;
        const coord = fakeCoordinator(() => (n++ === 0 ? Promise.resolve() : Promise.reject(new Error('stopped'))));
        const { orch, store } = mk(app, coord);

        await expect(orch.renderTiles([64, 100], tiles, 16, () => {})).rejects.toThrow('stopped');
        expect(app.log.slice(-3)).toEqual(['clearOffset', 'clearImage', 'resize:400x300']);
        expect(store.isLocked()).toBe(false);
    });
});
