// app/ProductionRenderManager.ts
// Manages production render lifecycle: resolution, layout, locking, auto-export

import type { RenderCoordinator } from './RenderCoordinator.js';
import type { ParameterStore } from './ParameterStore.js';
import type { EventBus } from './EventBus.js';
import type { AppLayout, LayoutMode } from './layout/index.js';
import { AppEvents } from './events.js';

export interface ProductionDeps {
    coordinator: RenderCoordinator;
    parameterStore: ParameterStore;
    eventBus: EventBus;
    gl: WebGL2RenderingContext;
    getLayout: () => AppLayout | null;
    setLayoutMode: (mode: LayoutMode) => void;
    resize: (w: number, h: number) => void;
    exportPNG: (filename?: string) => void;
    exportHDR: (filename?: string) => void;
    exportAllAOVs: () => void;
    quickSave: () => void;
}

/**
 * ProductionRenderManager - Manages production render lifecycle
 *
 * Handles:
 * - Layout switching to production mode and restoration
 * - Resolution changes for production and restoration
 * - Parameter locking/unlocking
 * - Auto-export on completion
 * - Extended renders (additional samples without reset)
 */
export class ProductionRenderManager {
    private coordinator: RenderCoordinator;
    private parameterStore: ParameterStore;
    private gl: WebGL2RenderingContext;
    private getLayout: () => AppLayout | null;
    private setLayoutMode: (mode: LayoutMode) => void;
    private resizeFn: (w: number, h: number) => void;
    private exportPNG: (filename?: string) => void;
    private exportHDR: (filename?: string) => void;
    private exportAllAOVs: () => void;
    private quickSave: () => void;

    // State that was previously duplicated in App.ts
    private previousLayoutMode: LayoutMode | null = null;
    private previousResolution: [number, number] | null = null;
    private productionLayoutMode: LayoutMode = 'centered';

    constructor(deps: ProductionDeps) {
        this.coordinator = deps.coordinator;
        this.parameterStore = deps.parameterStore;
        this.gl = deps.gl;
        this.getLayout = deps.getLayout;
        this.setLayoutMode = deps.setLayoutMode;
        this.resizeFn = deps.resize;
        this.exportPNG = deps.exportPNG;
        this.exportHDR = deps.exportHDR;
        this.exportAllAOVs = deps.exportAllAOVs;
        this.quickSave = deps.quickSave;

        // Subscribe to render lifecycle events for automatic layout switching
        deps.eventBus.on(AppEvents.RENDER_STARTED, (data: { mode: string }) => {
            if (data.mode === 'production') {
                const layout = this.getLayout();
                if (layout) {
                    // Only save previous layout if not already in production mode
                    // (prevents extended renders from overwriting the original layout)
                    if (!this.previousLayoutMode) {
                        this.previousLayoutMode = layout.mode;
                        console.log(`Saved previous layout: ${this.previousLayoutMode}`);
                    }
                    this.setLayoutMode(this.productionLayoutMode);
                    console.log(`Switched to '${this.productionLayoutMode}' layout for production`);
                }
            }
        });

        deps.eventBus.on(AppEvents.RENDER_STOPPED, () => {
            this.restoreLayout();
            // Ensure parameters are unlocked when stopping production
            if (this.parameterStore.isLocked()) {
                this.parameterStore.unlock();
                console.log('Unlocked parameters on render stop');
            }
        });
    }

    /**
     * Start production rendering (goal-driven, locked)
     *
     * Resets accumulation before starting.
     * Locks parameters during render.
     * Returns Promise that resolves when target samples reached.
     */
    async renderProduction(targetSamples: number, options?: {
        width?: number;
        height?: number;
        autoSave?: boolean;
        autoExportPNG?: boolean;
        autoExportHDR?: boolean;
        autoExportAllAOVs?: boolean;
    }): Promise<void> {
        // Lock parameters during production
        this.parameterStore.lock();

        // Handle resolution change
        const originalWidth = this.gl.canvas.width;
        const originalHeight = this.gl.canvas.height;

        if (options?.width && options?.height) {
            if (options.width !== originalWidth || options.height !== originalHeight) {
                console.log(`Resizing for production: ${options.width}x${options.height}`);
                this.previousResolution = [originalWidth, originalHeight];
                this.resizeFn(options.width, options.height);
            }
        }

        // Reset accumulation before production
        this.coordinator.resetAccumulation('production_start');

        try {
            await this.coordinator.startProduction({
                targetSamples,
                onProgress: (info) => {
                    // Log every 100 samples
                    if (info.samples % 100 === 0) {
                        const pct = info.percentComplete?.toFixed(1) || '0.0';
                        console.log(`Production: ${info.samples}/${targetSamples} (${pct}%)`);
                    }
                }
            });

            // Auto-export/save on successful completion
            if (options?.autoExportPNG) {
                console.log('Auto-exporting PNG...');
                await this.exportPNG();
            }
            if (options?.autoExportHDR) {
                console.log('Auto-exporting HDR...');
                await this.exportHDR();
            }
            if (options?.autoExportAllAOVs) {
                console.log('Auto-exporting all AOVs...');
                await this.exportAllAOVs();
            }
            if (options?.autoSave) {
                console.log('Auto-saving session...');
                this.quickSave();
            }
        } finally {
            // NOTE: We do NOT restore resolution or layout here.
            // We want the user to see the result.
            // Restoration happens when they click "Close" (triggers render.stopped).

            // Always unlock parameters when done (success or error)
            this.parameterStore.unlock();
        }
    }

    /**
     * Extend production render with additional samples (no reset)
     *
     * Parameters remain locked during extension.
     */
    async extendProduction(additionalSamples: number): Promise<void> {
        const currentSamples = this.coordinator.getSampleCount();
        const newTarget = currentSamples + additionalSamples;

        console.log(`Extending production: +${additionalSamples} (${currentSamples} → ${newTarget})`);

        // Lock parameters if not already locked
        const wasLocked = this.parameterStore.isLocked();
        if (!wasLocked) {
            this.parameterStore.lock();
        }

        try {
            await this.coordinator.startProduction({
                targetSamples: newTarget
            });
        } finally {
            // Only unlock if we locked it
            if (!wasLocked) {
                this.parameterStore.unlock();
            }
        }
    }

    /**
     * Restore the layout mode and resolution that was active before production render
     */
    private restoreLayout(): void {
        const layout = this.getLayout();

        // Restore layout
        if (this.previousLayoutMode && layout) {
            if (layout.mode !== this.previousLayoutMode) {
                this.setLayoutMode(this.previousLayoutMode);
                console.log(`Restored layout to '${this.previousLayoutMode}'`);
            }
            this.previousLayoutMode = null;
        }

        // Restore resolution
        if (this.previousResolution) {
            const [width, height] = this.previousResolution;
            console.log(`Restoring resolution: ${width}x${height}`);
            this.resizeFn(width, height);
            this.previousResolution = null;
        }
    }
}
