// app/RenderCoordinator.ts — Manages render loop execution, pause/resume, FPS tracking

import { RenderStoppedError } from '../errors/RenderErrors.js';
import type { Engine } from '../engine/Engine.js';
import { AppEvents } from './events.js';

export type RenderMode = 'interactive' | 'production';
export type RenderState = 'rendering' | 'paused' | 'complete' | 'stopped';

export interface ProgressInfo {
    mode: RenderMode;
    state: RenderState;
    timestamp: number;
    samples: number;
    elapsedTime: number;
    fps: number;
    targetSamples?: number;     // production only
    percentComplete?: number;   // production only
}

export interface ProductionGoal {
    targetSamples: number;
    onProgress?: (info: ProgressInfo) => void;
    onComplete?: () => void;
}

export interface EventEmitter {
    emit(event: string, data?: any): void;
}

export class RenderCoordinator {
    private engine: Engine;
    private eventEmitter?: EventEmitter;

    private mode: RenderMode = 'interactive';
    private state: RenderState = 'stopped';
    private animationId?: number;
    private startTime = 0;

    private goal: ProductionGoal | null = null;
    private productionResolve?: () => void;
    private productionReject?: (reason: Error) => void;

    // Deferred accumulation reset: a triggersReset parameter change (e.g. camera
    // orbit) while stopped/complete sets this instead of clearing the buffer now,
    // so a frozen/completed image survives for export. Consumed at the next render
    // start, so the next render begins fresh — no ghosting of the old viewpoint.
    private accumulationDirty = false;

    private lastFrameTime = 0;
    private fpsHistory: number[] = [];
    private lastProgressTime = 0;
    private progressIntervalMs = 100; // Report progress at most ~10x/sec

    public onProgress?: (info: ProgressInfo) => void;

    constructor(engine: Engine, eventEmitter?: EventEmitter) {
        this.engine = engine;
        this.eventEmitter = eventEmitter;
    }

    // -- Public API --

    startInteractive(): void {
        if (this.mode === 'production' && this.isRunning()) {
            throw new Error('Cannot start interactive mode during production render. Stop first with stop().');
        }

        // Settle any non-stopped render before switching. For a paused/complete
        // production this rejects the pending promise, so renderProduction's
        // finally runs and params unlock (#2). Emits RENDER_STOPPED so the UI
        // panels react; layout/resolution restore is handled explicitly by
        // App.start → ProductionOrchestrator.exitProduction, not this event.
        if (this.state !== 'stopped') this.stopInternal(true);

        this.mode = 'interactive';
        this.state = 'rendering';
        this.goal = null;
        this.startTime = performance.now();
        this.lastFrameTime = this.startTime;
        this.fpsHistory = [];
        this.consumeDirtyReset();

        this.emit(AppEvents.RENDER_STARTED, { mode: 'interactive' });
        this.runLoop();
    }

    // Returns Promise that resolves when target samples reached, or rejects if stopped
    startProduction(goal: ProductionGoal): Promise<void> {
        if (this.mode === 'production' && this.isRunning()) {
            throw new Error('Production render already in progress. Stop first with stop().');
        }

        // Settle any non-stopped render before switching. false = no RENDER_STOPPED
        // (a fresh/extended production sets up its own view via beginProduction, and
        // a spurious STOPPED would just flicker the production panel).
        if (this.state !== 'stopped') this.stopInternal(false);

        this.mode = 'production';
        this.state = 'rendering';
        this.goal = goal;
        this.startTime = performance.now();
        this.lastFrameTime = this.startTime;
        this.fpsHistory = [];
        this.consumeDirtyReset();

        console.log(`Started production render: ${goal.targetSamples} samples`);
        this.emit(AppEvents.RENDER_STARTED, { mode: 'production', targetSamples: goal.targetSamples });

        return new Promise<void>((resolve, reject) => {
            this.productionResolve = resolve;
            this.productionReject = reject;
            this.runLoop();
        });
    }

    pause(): void {
        if (this.state !== 'rendering') return;
        this.state = 'paused';
        if (this.animationId !== undefined) {
            cancelAnimationFrame(this.animationId);
            this.animationId = undefined;
        }
        this.emit(AppEvents.RENDER_PAUSED);
    }

    resume(): void {
        if (this.state !== 'paused') return;
        this.state = 'rendering';
        this.lastFrameTime = performance.now();
        this.consumeDirtyReset();
        this.emit(AppEvents.RENDER_RESUMED);
        this.runLoop();
    }

    stop(): void { this.stopInternal(true); }

    resetAccumulation(reason: string = 'manual'): void {
        this.engine.clearAccumulation();
        this.startTime = performance.now();
        this.accumulationDirty = false;
        this.emit(AppEvents.ACCUMULATION_RESET, { reason });
    }

    /**
     * Reset accumulation now if rendering/paused, else defer to the next render
     * start. Use for parameter/camera changes that invalidate the image but must
     * not wipe a frozen or completed buffer that may still be exported (#4).
     */
    requestAccumulationReset(reason: string = 'manual'): void {
        if (this.isRunning() || this.isPaused()) {
            this.resetAccumulation(reason);
        } else {
            this.accumulationDirty = true;
        }
    }

    private consumeDirtyReset(): void {
        if (this.accumulationDirty) {
            this.resetAccumulation('deferred parameter change');
        }
    }

    // -- State Queries --

    isRunning(): boolean { return this.state === 'rendering'; }
    isPaused(): boolean { return this.state === 'paused'; }
    isAccumulating(): boolean { return this.engine.getSampleCount() > 1; }
    getMode(): RenderMode { return this.mode; }
    getState(): RenderState { return this.state; }
    getSampleCount(): number { return this.engine.getSampleCount(); }
    getElapsedTime(): number { return performance.now() - this.startTime; }

    getProductionGoal(): { targetSamples: number } | undefined {
        if (this.mode === 'production' && this.goal) {
            return { targetSamples: this.goal.targetSamples };
        }
        return undefined;
    }

    getFPS(): number {
        if (this.fpsHistory.length === 0) return 0;
        return this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
    }

    // -- Private --

    private stopInternal(emitEvents: boolean): void {
        if (this.state === 'stopped') return;

        this.state = 'stopped';

        if (this.animationId !== undefined) {
            cancelAnimationFrame(this.animationId);
            this.animationId = undefined;
        }

        if (this.productionReject) {
            this.productionReject(new RenderStoppedError());
            this.clearProductionPromise();
        }

        this.goal = null;

        if (emitEvents) {
            this.emit(AppEvents.RENDER_STOPPED);
        }
    }

    private runLoop(): void {
        const loop = () => {
            if (this.state !== 'rendering') return;

            try {
                this.engine.renderFrame();
                this.updateFPS();
                this.reportProgress();
            } catch (error) {
                this.fail(error);
                return;
            }

            if (this.mode === 'production' && this.checkGoalMet()) {
                this.complete();
                return;
            }

            this.animationId = requestAnimationFrame(loop);
        };

        this.animationId = requestAnimationFrame(loop);
    }

    /** A frame threw. Stop cleanly instead of leaving the state at 'rendering' with no loop
     *  running: settle a pending production render (its finally unlocks parameters and
     *  restores the view), and report the error so the App can show it. */
    private fail(error: unknown): void {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error('Rendering stopped: a frame threw.', err);
        this.state = 'stopped';
        this.animationId = undefined;
        if (this.productionReject) {
            this.productionReject(err);
            this.clearProductionPromise();
        }
        this.goal = null;
        this.emit(AppEvents.RENDER_ERROR, { error: err });
        this.emit(AppEvents.RENDER_STOPPED);
    }

    private updateFPS(): void {
        const now = performance.now();
        const delta = now - this.lastFrameTime;
        this.lastFrameTime = now;

        if (delta > 0) {
            this.fpsHistory.push(1000 / delta);
            if (this.fpsHistory.length > 60) this.fpsHistory.shift();
        }
    }

    private checkGoalMet(): boolean {
        if (!this.goal) return false;
        return this.engine.getSampleCount() >= this.goal.targetSamples;
    }

    private complete(): void {
        const elapsed = performance.now() - this.startTime;
        const samples = this.engine.getSampleCount();

        console.log(`Production complete: ${samples} samples in ${(elapsed / 1000).toFixed(1)}s`);

        this.state = 'complete';
        // Force a final progress tick (state='complete', 100%) while goal is still
        // set — the throttle would otherwise drop it and the production panel would
        // never rebuild into its complete/export UI (#7b).
        this.reportProgress(true);
        this.goal?.onComplete?.();

        if (this.productionResolve) {
            this.productionResolve();
            this.clearProductionPromise();
        }

        this.goal = null;
        this.emit(AppEvents.RENDER_COMPLETE, { samples, elapsedTime: elapsed });
    }

    private clearProductionPromise(): void {
        this.productionResolve = undefined;
        this.productionReject = undefined;
    }

    private reportProgress(force: boolean = false): void {
        const now = performance.now();
        if (!force && now - this.lastProgressTime < this.progressIntervalMs) return;
        this.lastProgressTime = now;

        const info = this.buildProgressInfo();
        if (this.mode === 'production' && this.goal?.onProgress) this.goal.onProgress(info);
        this.onProgress?.(info);
    }

    private buildProgressInfo(): ProgressInfo {
        const samples = this.engine.getSampleCount();
        const elapsed = performance.now() - this.startTime;

        const info: ProgressInfo = {
            mode: this.mode,
            state: this.state,
            timestamp: performance.now(),
            samples,
            elapsedTime: elapsed,
            fps: this.getFPS()
        };

        if (this.mode === 'production' && this.goal) {
            info.targetSamples = this.goal.targetSamples;
            info.percentComplete = (samples / this.goal.targetSamples) * 100;
        }

        return info;
    }

    private emit(event: string, data?: any): void {
        this.eventEmitter?.emit(event, data);
    }
}
