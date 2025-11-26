// app/FlexibleRenderCoordinator.ts
// Manages rendering execution for FlexibleEngine

import type { FlexibleEngine } from '../engine/FlexibleEngine.js';

/**
 * Render mode
 */
export type RenderMode = 'interactive' | 'production';

/**
 * Render state
 */
export type RenderState = 'rendering' | 'paused' | 'complete' | 'stopped';

/**
 * Progress information reported during rendering
 */
export interface ProgressInfo {
    mode: RenderMode;
    state: RenderState;
    timestamp: number;
    samples: number;
    elapsedTime: number;
    fps: number;

    // Production-only fields
    targetSamples?: number;
    percentComplete?: number;
}

/**
 * Production render goal specification
 */
export interface ProductionGoal {
    targetSamples: number;
    onProgress?: (info: ProgressInfo) => void;
    onComplete?: () => void;
}

/**
 * Event emitter interface (optional dependency)
 *
 * If provided, coordinator will emit events for render state changes.
 */
export interface EventEmitter {
    emit(event: string, data?: any): void;
}

/**
 * FlexibleRenderCoordinator - Manages rendering execution
 *
 * Two modes:
 * - Interactive: Continuous rendering, unlocked, can be interrupted
 * - Production: Goal-driven rendering, locked, returns Promise
 *
 * Both modes support pause/resume.
 * Production mode returns a Promise that resolves on completion.
 */
export class FlexibleRenderCoordinator {
    private engine: FlexibleEngine;
    private eventEmitter?: EventEmitter;

    // State
    private mode: RenderMode = 'interactive';
    private state: RenderState = 'stopped';
    private animationId?: number;
    private startTime = 0;

    // Production
    private goal: ProductionGoal | null = null;
    private productionResolve?: () => void;
    private productionReject?: (reason: Error) => void;

    // FPS tracking
    private lastFrameTime = 0;
    private fpsHistory: number[] = [];

    // Reset rules (which parameters trigger accumulation reset)
    private resetPrefixes = ['camera.', 'scene.', 'material.', 'light.'];
    private noResetPrefixes = ['developer.', 'debug.', 'renderer.displayMode'];

    // Progress callback
    public onProgress?: (info: ProgressInfo) => void;

    constructor(engine: FlexibleEngine, eventEmitter?: EventEmitter) {
        this.engine = engine;
        this.eventEmitter = eventEmitter;
    }

    // ============================================================================
    // Public API
    // ============================================================================

    /**
     * Start interactive rendering (continuous, unlocked)
     */
    startInteractive(): void {
        // Production cannot be interrupted
        if (this.mode === 'production' && this.isRunning()) {
            throw new Error(
                'Cannot start interactive mode during production render. ' +
                'Stop the production render first with stop().'
            );
        }

        // Stop any existing rendering
        if (this.isRunning()) {
            this.stopInternal(false);
        }

        this.mode = 'interactive';
        this.state = 'rendering';
        this.goal = null;
        this.startTime = performance.now();
        this.lastFrameTime = this.startTime;
        this.fpsHistory = [];

        console.log('Started interactive rendering');
        this.emit('render.started', { mode: 'interactive' });
        this.runLoop();
    }

    /**
     * Start production rendering (goal-driven, locked)
     *
     * Returns a Promise that resolves when target samples reached,
     * or rejects if stopped early.
     */
    startProduction(goal: ProductionGoal): Promise<void> {
        // Production cannot interrupt itself
        if (this.mode === 'production' && this.isRunning()) {
            throw new Error(
                'Production render already in progress. ' +
                'Stop it first with stop() to start a new one.'
            );
        }

        // Stop any interactive rendering
        if (this.isRunning()) {
            this.stopInternal(false);
        }

        this.mode = 'production';
        this.state = 'rendering';
        this.goal = goal;
        this.startTime = performance.now();
        this.lastFrameTime = this.startTime;
        this.fpsHistory = [];

        console.log(`Started production render: ${goal.targetSamples} samples`);
        this.emit('render.started', { mode: 'production', targetSamples: goal.targetSamples });
        this.emit('render.locked');

        return new Promise<void>((resolve, reject) => {
            this.productionResolve = resolve;
            this.productionReject = reject;
            this.runLoop();
        });
    }

    /**
     * Pause rendering (works for both modes)
     */
    pause(): void {
        if (this.state !== 'rendering') return;

        this.state = 'paused';

        if (this.animationId !== undefined) {
            cancelAnimationFrame(this.animationId);
            this.animationId = undefined;
        }

        this.emit('render.paused');
        console.log('Rendering paused');
    }

    /**
     * Resume paused rendering
     */
    resume(): void {
        if (this.state !== 'paused') return;

        this.state = 'rendering';
        this.lastFrameTime = performance.now();

        this.emit('render.resumed');
        console.log('Rendering resumed');
        this.runLoop();
    }

    /**
     * Stop rendering completely (universal kill switch)
     */
    stop(): void {
        this.stopInternal(true);
    }

    /**
     * Reset accumulation (clear samples, restart timing)
     */
    resetAccumulation(reason: string = 'manual'): void {
        this.engine.clearAccumulation();
        this.startTime = performance.now();

        this.emit('accumulation.reset', { reason });
        console.log(`Accumulation reset: ${reason}`);
    }

    // ============================================================================
    // State Queries
    // ============================================================================

    /**
     * Check if actively rendering (not paused, not stopped)
     */
    isRunning(): boolean {
        return this.state === 'rendering';
    }

    /**
     * Check if paused
     */
    isPaused(): boolean {
        return this.state === 'paused';
    }

    /**
     * Check if in locked production mode
     */
    isLocked(): boolean {
        return this.mode === 'production' && (this.state === 'rendering' || this.state === 'paused');
    }

    /**
     * Check if accumulating samples (more than 1 sample)
     */
    isAccumulating(): boolean {
        return this.engine.getSampleCount() > 1;
    }

    /**
     * Get current render mode
     */
    getMode(): RenderMode {
        return this.mode;
    }

    /**
     * Get current render state
     */
    getState(): RenderState {
        return this.state;
    }

    /**
     * Get current sample count
     */
    getSampleCount(): number {
        return this.engine.getSampleCount();
    }

    /**
     * Get elapsed time since render started (ms)
     */
    getElapsedTime(): number {
        return performance.now() - this.startTime;
    }

    /**
     * Get current FPS (averaged over recent frames)
     */
    getFPS(): number {
        if (this.fpsHistory.length === 0) return 0;
        return this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
    }

    // ============================================================================
    // Parameter Reset Logic
    // ============================================================================

    /**
     * Check if a parameter change should trigger accumulation reset
     */
    shouldResetForParameter(path: string): boolean {
        // Check no-reset list first (higher priority)
        for (const prefix of this.noResetPrefixes) {
            if (path.startsWith(prefix)) {
                return false;
            }
        }

        // Check reset list
        for (const prefix of this.resetPrefixes) {
            if (path.startsWith(prefix)) {
                return true;
            }
        }

        // Conservative default: reset for unknown parameters
        console.warn(`Unknown parameter prefix: ${path}, resetting accumulation`);
        return true;
    }

    /**
     * Add a prefix to the reset list
     */
    addResetPrefix(prefix: string): void {
        if (!this.resetPrefixes.includes(prefix)) {
            this.resetPrefixes.push(prefix);
        }
    }

    /**
     * Add a prefix to the no-reset list
     */
    addNoResetPrefix(prefix: string): void {
        if (!this.noResetPrefixes.includes(prefix)) {
            this.noResetPrefixes.push(prefix);
        }
    }

    // ============================================================================
    // Private Implementation
    // ============================================================================

    private stopInternal(emitEvents: boolean): void {
        if (this.state === 'stopped') return;

        const wasProduction = this.mode === 'production';

        this.state = 'stopped';

        if (this.animationId !== undefined) {
            cancelAnimationFrame(this.animationId);
            this.animationId = undefined;
        }

        // Reject production promise if running
        if (this.productionReject) {
            const error = new Error('Production render stopped');
            error.name = 'RenderStopped';
            this.productionReject(error);
            this.clearProductionPromise();
        }

        this.goal = null;

        if (emitEvents) {
            this.emit('render.stopped');
            if (wasProduction) {
                this.emit('render.unlocked');
            }
            console.log('Rendering stopped');
        }
    }

    private runLoop(): void {
        const loop = () => {
            if (this.state !== 'rendering') return;

            // Render frame
            this.engine.renderFrame();

            // Update FPS
            this.updateFPS();

            // Report progress
            this.reportProgress();

            // Production mode: check if goal met
            if (this.mode === 'production' && this.checkGoalMet()) {
                this.complete();
                return;
            }

            // Schedule next frame
            this.animationId = requestAnimationFrame(loop);
        };

        this.animationId = requestAnimationFrame(loop);
    }

    private updateFPS(): void {
        const now = performance.now();
        const delta = now - this.lastFrameTime;
        this.lastFrameTime = now;

        if (delta > 0) {
            const fps = 1000 / delta;
            this.fpsHistory.push(fps);
            if (this.fpsHistory.length > 60) {
                this.fpsHistory.shift();
            }
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

        // Call goal's onComplete callback
        this.goal?.onComplete?.();

        // Resolve production promise
        if (this.productionResolve) {
            this.productionResolve();
            this.clearProductionPromise();
        }

        this.goal = null;

        this.emit('render.complete', { samples, elapsedTime: elapsed });
        this.emit('render.unlocked');
    }

    private clearProductionPromise(): void {
        this.productionResolve = undefined;
        this.productionReject = undefined;
    }

    private reportProgress(): void {
        const info = this.buildProgressInfo();

        // Call goal's progress callback (production mode)
        if (this.mode === 'production' && this.goal?.onProgress) {
            this.goal.onProgress(info);
        }

        // Call general progress callback
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

        // Add production-specific fields
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
