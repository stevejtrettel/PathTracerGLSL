// app/ProductionOrchestrator.ts — Consolidates production render lifecycle
//
// Owns the full production sequence: lock params → resize → switch layout →
// reset accumulation → render → auto-export → restore layout/resolution → unlock.

import type { App } from './App.js';
import type { RenderCoordinator, ProgressInfo } from './RenderCoordinator.js';
import type { ParameterStore } from './ParameterStore.js';
import type { LayoutMode } from './layout/index.js';
import type { Tile } from './tiling.js';

export interface ProductionOptions {
    width?: number;
    height?: number;
    autoSave?: boolean;
    autoExportPNG?: boolean;
    autoExportHDR?: boolean;
    autoExportAllAOVs?: boolean;
}

/**
 * Production session phase.
 * - idle:    no production; nothing saved.
 * - active:  render in progress; params locked, production layout+resolution
 *            applied, profiling suspended.
 * - settled: render finished (complete or stopped) but still showing the
 *            production view; params unlocked and profiling restored, but the
 *            layout+resolution stay so the result can be viewed / manually
 *            exported until the user leaves via exitProduction().
 */
type ProductionPhase = 'idle' | 'active' | 'settled';

export class ProductionOrchestrator {
    private app: App;
    private coordinator: RenderCoordinator;
    private parameterStore: ParameterStore;

    private phase: ProductionPhase = 'idle';
    private previousLayoutMode: LayoutMode | null = null;
    private previousResolution: [number, number] | null = null;
    private profilingWasEnabled: boolean = false;
    private productionLayoutMode: LayoutMode = 'centered';
    // A tiled job has set a pixel offset and a full-image size on the App. They are part of
    // the production view, so leaving production clears them — whichever call leaves it.
    private tileView = false;
    // Each run (render, extend, tiled job) takes a token when it goes active; its `finally`
    // settles or exits only if it is still the current run. A stopped run's promise settles
    // a microtask AFTER stop() returns, by which time a new session may already be active —
    // without the token that stale finally unlocked the new session's parameters mid-render.
    private runId = 0;

    constructor(
        app: App,
        coordinator: RenderCoordinator,
        parameterStore: ParameterStore,
    ) {
        this.app = app;
        this.coordinator = coordinator;
        this.parameterStore = parameterStore;
    }

    async renderProduction(targetSamples: number, options?: ProductionOptions): Promise<void> {
        const run = this.beginProduction(options);
        try {
            await this.coordinator.startProduction({
                targetSamples,
                onProgress: (info: ProgressInfo) => {
                    if (info.samples % 100 === 0) {
                        const pct = info.percentComplete?.toFixed(1) || '0.0';
                        console.log(`Production: ${info.samples}/${targetSamples} (${pct}%)`);
                    }
                }
            });

            // Auto-export runs here — still at target resolution, before exitProduction ever
            // restores — so a completed render is saved before it can be discarded on return
            // to interactive. Every buffer is READ before the first await: each export reads
            // its pixels synchronously when called and only its encoding is async, so starting
            // them all and then waiting means a stop during an encode (which resizes and clears
            // the buffer) cannot change what the later exports save.
            const saves: Promise<void>[] = [];
            if (options?.autoExportPNG) { console.log('Auto-exporting PNG...'); saves.push(this.app.exportPNG()); }
            if (options?.autoExportHDR) { console.log('Auto-exporting HDR...'); this.app.exportHDR(); }
            if (options?.autoExportAllAOVs) { console.log('Auto-exporting all AOVs...'); saves.push(this.app.exportAllAOVs()); }
            await Promise.all(saves);
            if (options?.autoSave) { console.log('Auto-saving session...'); this.app.quickSave(); }
        } finally {
            // Render settled (completed or stopped): unlock + restore profiling, but
            // keep the production view (layout/resolution) for viewing/export.
            this.settleProduction(run);
        }
    }

    async extendProduction(additionalSamples: number): Promise<void> {
        if (this.phase === 'idle') {
            throw new Error('No production render to extend');
        }
        if (this.phase === 'active') {
            // Refuse BEFORE touching the lock: letting startProduction throw here would run
            // the finally below and unlock the render that is still going.
            throw new Error('A production render is already in progress');
        }

        const currentSamples = this.coordinator.getSampleCount();
        const newTarget = currentSamples + additionalSamples;
        console.log(`Extending production: +${additionalSamples} (${currentSamples} → ${newTarget})`);

        // Re-enter active from the settled view: re-lock, but keep the already-saved
        // prior state and current resolution (no resize, no accumulation reset — the
        // coordinator resets only if the camera moved, via its dirty flag).
        const run = ++this.runId;
        this.parameterStore.lock();
        this.phase = 'active';
        try {
            await this.coordinator.startProduction({ targetSamples: newTarget });
        } finally {
            this.settleProduction(run);
        }
    }

    /**
     * A tiled production (TiledRenderer): ONE locked session — the parameters cannot change
     * between tiles — in which the canvas is resized to each tile in turn, offset into the
     * full image, and rendered to `spp`. `onTile` reads the finished tile back before the
     * next one starts. Always leaves production at the end, finished or not: what the
     * canvas holds then is a single tile, not a result to look at.
     */
    async renderTiles(
        imageSize: [number, number],
        tiles: readonly Tile[],
        spp: number,
        onTile: (tile: Tile, index: number) => void,
    ): Promise<void> {
        const run = this.beginProduction();
        this.previousResolution = this.app.getCanvasSize();
        this.app.setImageSize(imageSize[0], imageSize[1]);
        this.tileView = true;
        try {
            for (const [index, tile] of tiles.entries()) {
                this.app.resize(tile.width, tile.height);
                this.app.setPixelOffset(tile.x, tile.y);
                this.coordinator.resetAccumulation('tile');
                await this.coordinator.startProduction({ targetSamples: spp });
                onTile(tile, index);
            }
        } finally {
            // Not if a newer session has already replaced this one: whatever left this session
            // (App.stop → exitProduction) has already cleared the tile view.
            if (run === this.runId) this.exitProduction();
        }
    }

    /** No production session is active or on display. */
    isIdle(): boolean { return this.phase === 'idle'; }
    /** A finished production is on display (rendering stopped at its target). */
    isSettled(): boolean { return this.phase === 'settled'; }

    /**
     * Restore the interactive view when leaving a production session. Idempotent —
     * a no-op when idle, so App.start()/stop() can call it unconditionally.
     */
    exitProduction(): void {
        if (this.phase === 'idle') return;

        // Ensure params/profiling are restored even if we abort straight from 'active'.
        this.settleProduction();

        if (this.tileView) {
            this.app.clearPixelOffset();
            this.app.clearImageSize();
            this.tileView = false;
        }

        if (this.previousLayoutMode && this.app.hasLayout()) {
            if (this.app.getLayoutMode() !== this.previousLayoutMode) {
                this.app.setLayoutMode(this.previousLayoutMode);
                console.log(`Restored layout to '${this.previousLayoutMode}'`);
            }
        }
        if (this.previousResolution) {
            const [width, height] = this.previousResolution;
            console.log(`Restoring resolution: ${width}x${height}`);
            this.app.resize(width, height);
        }

        this.previousLayoutMode = null;
        this.previousResolution = null;
        this.phase = 'idle';
    }

    private beginProduction(options?: ProductionOptions): number {
        if (this.phase === 'active') {
            throw new Error('A production render is already in progress');
        }
        // A finished render still on display (settled, not yet dismissed) is replaced: leave
        // its view first, so the new session saves the interactive state, not the old view.
        if (this.phase === 'settled') this.exitProduction();

        // Save prior state for exitProduction to restore.
        this.previousLayoutMode = this.app.getLayoutMode();
        this.profilingWasEnabled = this.app.isProfilingEnabled();

        // Apply the production view. Active from the lock on, so that if anything below
        // throws (a resize can: framebuffer allocation), exitProduction unwinds it — the
        // lock is never left held with the phase still 'idle'.
        const run = ++this.runId;
        this.parameterStore.lock();
        this.phase = 'active';
        try {
            if (this.app.hasLayout()) {
                this.app.setLayoutMode(this.productionLayoutMode);
            }
            if (options?.width && options?.height) {
                const [originalWidth, originalHeight] = this.app.getCanvasSize();
                if (options.width !== originalWidth || options.height !== originalHeight) {
                    console.log(`Resizing for production: ${options.width}x${options.height}`);
                    this.previousResolution = [originalWidth, originalHeight];
                    this.app.resize(options.width, options.height);
                }
            }
            // Suspend GPU profiling during production — readPixels sync kills pipelining.
            if (this.profilingWasEnabled) {
                this.app.disableProfiling();
            }
            this.coordinator.resetAccumulation('production_start');
        } catch (error) {
            this.exitProduction();
            throw error;
        }
        return run;
    }

    /** Unlock and restore profiling, keeping the view. `run` (when given) must still be the
     *  current run — a stale run's finally is a no-op. */
    private settleProduction(run: number = this.runId): void {
        if (run !== this.runId || this.phase !== 'active') return;
        this.parameterStore.unlock();
        if (this.profilingWasEnabled) {
            this.app.enableProfiling();
        }
        this.phase = 'settled';
    }
}
