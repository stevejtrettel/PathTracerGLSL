// app/ProductionOrchestrator.ts — Consolidates production render lifecycle
//
// Owns the full production sequence: lock params → resize → switch layout →
// reset accumulation → render → auto-export → restore layout/resolution → unlock.

import type { App } from './App.js';
import type { RenderCoordinator, ProgressInfo } from './RenderCoordinator.js';
import type { ParameterStore } from './ParameterStore.js';
import type { EventBus } from './EventBus.js';
import type { LayoutMode } from './layout/index.js';
import { AppEvents } from './events.js';

export interface ProductionOptions {
    width?: number;
    height?: number;
    autoSave?: boolean;
    autoExportPNG?: boolean;
    autoExportHDR?: boolean;
    autoExportAllAOVs?: boolean;
}

export class ProductionOrchestrator {
    private app: App;
    private coordinator: RenderCoordinator;
    private parameterStore: ParameterStore;
    private eventBus: EventBus;

    private previousLayoutMode: LayoutMode | null = null;
    private previousResolution: [number, number] | null = null;
    private profilingWasEnabled: boolean = false;
    private productionLayoutMode: LayoutMode = 'centered';

    constructor(
        app: App,
        coordinator: RenderCoordinator,
        parameterStore: ParameterStore,
        eventBus: EventBus,
    ) {
        this.app = app;
        this.coordinator = coordinator;
        this.parameterStore = parameterStore;
        this.eventBus = eventBus;

        // Production layout lifecycle: switch on start, restore on stop
        this.eventBus.on(AppEvents.RENDER_STARTED, (data: { mode: string }) => {
            if (data.mode === 'production') {
                if (this.app.hasLayout()) {
                    if (!this.previousLayoutMode) {
                        this.previousLayoutMode = this.app.getLayoutMode();
                        console.log(`Saved previous layout: ${this.previousLayoutMode}`);
                    }
                    this.app.setLayoutMode(this.productionLayoutMode);
                    console.log(`Switched to '${this.productionLayoutMode}' layout for production`);
                }
            }
        });

        this.eventBus.on(AppEvents.RENDER_STOPPED, () => {
            this.restoreProductionLayout();
            if (this.parameterStore.isLocked()) {
                this.parameterStore.unlock();
                console.log('Unlocked parameters on render stop');
            }
        });
    }

    async renderProduction(targetSamples: number, options?: ProductionOptions): Promise<void> {
        this.parameterStore.lock();

        const [originalWidth, originalHeight] = this.app.getCanvasSize();

        if (options?.width && options?.height) {
            if (options.width !== originalWidth || options.height !== originalHeight) {
                console.log(`Resizing for production: ${options.width}x${options.height}`);
                this.previousResolution = [originalWidth, originalHeight];
                this.app.resize(options.width, options.height);
            }
        }

        // Suspend GPU profiling during production — readPixels sync kills pipelining
        this.profilingWasEnabled = this.app.isProfilingEnabled();
        if (this.profilingWasEnabled) {
            this.app.disableProfiling();
        }

        this.coordinator.resetAccumulation('production_start');

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

            if (options?.autoExportPNG) { console.log('Auto-exporting PNG...'); this.app.exportPNG(); }
            if (options?.autoExportHDR) { console.log('Auto-exporting HDR...'); this.app.exportHDR(); }
            if (options?.autoExportAllAOVs) { console.log('Auto-exporting all AOVs...'); this.app.exportAllAOVs(); }
            if (options?.autoSave) { console.log('Auto-saving session...'); this.app.quickSave(); }
        } finally {
            this.parameterStore.unlock();
            if (this.profilingWasEnabled) {
                this.app.enableProfiling();
            }
        }
    }

    async extendProduction(additionalSamples: number): Promise<void> {
        const currentSamples = this.coordinator.getSampleCount();
        const newTarget = currentSamples + additionalSamples;

        console.log(`Extending production: +${additionalSamples} (${currentSamples} → ${newTarget})`);

        const wasLocked = this.parameterStore.isLocked();
        if (!wasLocked) {
            this.parameterStore.lock();
        }

        try {
            await this.coordinator.startProduction({
                targetSamples: newTarget
            });
        } finally {
            if (!wasLocked) {
                this.parameterStore.unlock();
            }
        }
    }

    private restoreProductionLayout(): void {
        if (this.previousLayoutMode && this.app.hasLayout()) {
            if (this.app.getLayoutMode() !== this.previousLayoutMode) {
                this.app.setLayoutMode(this.previousLayoutMode);
                console.log(`Restored layout to '${this.previousLayoutMode}'`);
            }
            this.previousLayoutMode = null;
        }

        if (this.previousResolution) {
            const [width, height] = this.previousResolution;
            console.log(`Restoring resolution: ${width}x${height}`);
            this.app.resize(width, height);
            this.previousResolution = null;
        }
    }
}
