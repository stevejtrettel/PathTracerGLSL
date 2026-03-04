// app/RenderCoordinator.ts — Manages render loop execution, pause/resume, FPS tracking

import { RenderStoppedError } from '../errors/RenderErrors.js';
import type { Engine } from '../engine/Engine.js';
import { AppEvents, ParamPrefix } from './events.js';

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

    private lastFrameTime = 0;
    private fpsHistory: number[] = [];

    // Which parameter prefixes trigger accumulation reset
    private resetPrefixes: string[] = [ParamPrefix.CAMERA, ParamPrefix.SCENE, ParamPrefix.MATERIAL, ParamPrefix.LIGHT];
    private noResetPrefixes: string[] = [ParamPrefix.DEVELOPER, ParamPrefix.DEBUG, ParamPrefix.RENDERER_DISPLAY_MODE];

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

        if (this.isRunning()) this.stopInternal(false);

        this.mode = 'interactive';
        this.state = 'rendering';
        this.goal = null;
        this.startTime = performance.now();
        this.lastFrameTime = this.startTime;
        this.fpsHistory = [];

        this.emit(AppEvents.RENDER_STARTED, { mode: 'interactive' });
        this.runLoop();
    }

    // Returns Promise that resolves when target samples reached, or rejects if stopped
    startProduction(goal: ProductionGoal): Promise<void> {
        if (this.mode === 'production' && this.isRunning()) {
            throw new Error('Production render already in progress. Stop first with stop().');
        }

        if (this.isRunning()) this.stopInternal(false);

        this.mode = 'production';
        this.state = 'rendering';
        this.goal = goal;
        this.startTime = performance.now();
        this.lastFrameTime = this.startTime;
        this.fpsHistory = [];

        console.log(`Started production render: ${goal.targetSamples} samples`);
        this.emit(AppEvents.RENDER_STARTED, { mode: 'production', targetSamples: goal.targetSamples });
        this.emit(AppEvents.RENDER_LOCKED);

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
        this.emit(AppEvents.RENDER_RESUMED);
        this.runLoop();
    }

    stop(): void { this.stopInternal(true); }

    resetAccumulation(reason: string = 'manual'): void {
        this.engine.clearAccumulation();
        this.startTime = performance.now();
        this.emit(AppEvents.ACCUMULATION_RESET, { reason });
    }

    // -- State Queries --

    isRunning(): boolean { return this.state === 'rendering'; }
    isPaused(): boolean { return this.state === 'paused'; }
    isLocked(): boolean { return this.mode === 'production' && (this.state === 'rendering' || this.state === 'paused'); }
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

    // -- Parameter Reset Logic --

    shouldResetForParameter(path: string): boolean {
        for (const prefix of this.noResetPrefixes) {
            if (path.startsWith(prefix)) return false;
        }
        for (const prefix of this.resetPrefixes) {
            if (path.startsWith(prefix)) return true;
        }
        console.warn(`Unknown parameter prefix: ${path}, resetting accumulation`);
        return true;
    }

    addResetPrefix(prefix: string): void {
        if (!this.resetPrefixes.includes(prefix)) this.resetPrefixes.push(prefix);
    }

    addNoResetPrefix(prefix: string): void {
        if (!this.noResetPrefixes.includes(prefix)) this.noResetPrefixes.push(prefix);
    }

    // -- Private --

    private stopInternal(emitEvents: boolean): void {
        if (this.state === 'stopped') return;

        const wasProduction = this.mode === 'production';
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
            if (wasProduction) this.emit(AppEvents.RENDER_UNLOCKED);
        }
    }

    private runLoop(): void {
        const loop = () => {
            if (this.state !== 'rendering') return;

            this.engine.renderFrame();
            this.updateFPS();
            this.reportProgress();

            if (this.mode === 'production' && this.checkGoalMet()) {
                this.complete();
                return;
            }

            this.animationId = requestAnimationFrame(loop);
        };

        this.animationId = requestAnimationFrame(loop);
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
        this.goal?.onComplete?.();

        if (this.productionResolve) {
            this.productionResolve();
            this.clearProductionPromise();
        }

        this.goal = null;
        this.emit(AppEvents.RENDER_COMPLETE, { samples, elapsedTime: elapsed });
        this.emit(AppEvents.RENDER_UNLOCKED);
    }

    private clearProductionPromise(): void {
        this.productionResolve = undefined;
        this.productionReject = undefined;
    }

    private reportProgress(): void {
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
