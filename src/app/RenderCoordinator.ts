// app/RenderCoordinator.ts
import type { Engine } from '../engine/Engine';
import type { EventBus } from './EventBus';

type RenderMode = 'interactive' | 'production';
type RenderState = 'rendering' | 'paused' | 'complete';

interface ProgressInfo {
    mode: RenderMode;
    state: RenderState;
    timestamp: number;
    samples: number;
    elapsedTime: number;
    // Production-only (undefined for interactive)
    targetSamples?: number;
    percentComplete?: number;
    // Legacy fields (kept for compatibility)
    fps?: number;
    frameTime?: number;
    reason?: string;
}

interface ProductionGoal {
    targetSamples: number;
    onProgress?: (info: ProgressInfo) => void;
    onComplete?: () => void;
}

/**
 * RenderCoordinator - Manages rendering execution
 *
 * Two modes:
 * - Interactive: Continuous rendering, unlocked, flexible
 * - Production: Goal-driven rendering, locked, sacred
 *
 * Both modes support pause/resume.
 * Production mode returns a Promise that resolves on completion.
 */
class RenderCoordinator {
    private engine: Engine;
    private bus: EventBus;

    // State
    private mode: RenderMode = 'interactive';
    private running = false;
    private paused = false;
    private animationId?: number;
    private startTime = 0;

    // Production
    private goal: ProductionGoal | null = null;
    private productionResolve?: () => void;
    private productionReject?: (reason: any) => void;

    // Reset rules
    private resetPrefixes = ['camera.', 'quad.', 'material.', 'scene.'];
    private noResetPrefixes = ['developer.', 'debug.', 'resolution'];

    // Progress reporting
    public onProgress?: (info: ProgressInfo) => void;

    constructor(engine: Engine, bus: EventBus) {
        this.engine = engine;
        this.bus = bus;
    }

    /**
     * Start interactive rendering (continuous, unlocked)
     */
    startInteractive(): void {
        // Production cannot be interrupted
        if (this.mode === 'production' && this.running) {
            throw new Error(
                'Cannot start interactive mode during production render. ' +
                'Stop the production render first with stop().'
            );
        }

        // Interactive can restart itself
        if (this.running) {
            this.stop();
        }

        this.mode = 'interactive';
        this.goal = null;
        this.running = true;
        this.paused = false;
        this.startTime = performance.now();

        console.log('Started interactive rendering');
        this.bus.emit('render.started');
        this.runLoop();
    }

    /**
     * Start production rendering (goal-driven, locked)
     * Returns promise that resolves on completion or rejects if stopped
     */
    startProduction(goal: ProductionGoal): Promise<void> {
        // Production cannot interrupt itself or other production renders
        if (this.mode === 'production' && this.running) {
            throw new Error(
                'Production render already in progress. ' +
                'Stop it first with stop() to start a new one.'
            );
        }

        // Stop any interactive rendering
        if (this.running) {
            this.stop();
        }

        this.mode = 'production';
        this.goal = goal;
        this.running = true;
        this.paused = false;
        this.startTime = performance.now();

        console.log(`Started production render: ${goal.targetSamples} samples`);
        this.bus.emit('render.started');
        this.bus.emit('render.locked');  // Signal production mode started

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
        if (!this.running || this.paused) return;

        this.paused = true;

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = undefined;
        }

        this.bus.emit('render.paused');
        console.log('⏸ Rendering paused');
    }

    /**
     * Resume paused rendering
     */
    resume(): void {
        if (!this.running || !this.paused) return;

        this.paused = false;
        this.bus.emit('render.resumed');
        console.log('▶️ Rendering resumed');
        this.runLoop();
    }

    /**
     * Stop rendering completely (universal kill switch)
     */
    stop(): void {
        if (!this.running) return;

        const wasProduction = this.mode === 'production';
        this.running = false;
        this.paused = false;

        if (this.animationId) {
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
        this.bus.emit('render.stopped');
        if (wasProduction) {
            this.bus.emit('render.unlocked');  // Signal production mode ended
        }
        console.log('Rendering stopped');
    }

    /**
     * Check if actively rendering (not paused)
     */
    isRunning(): boolean {
        return this.running && !this.paused;
    }

    /**
     * Check if paused
     */
    isPaused(): boolean {
        return this.running && this.paused;
    }

    /**
     * Check if in locked production mode
     */
    isLocked(): boolean {
        return this.mode === 'production' && this.running;
    }

    /**
     * Check if accumulating samples
     */
    isAccumulating(): boolean {
        return this.engine.sampleCount > 1;
    }

    /**
     * Get current render mode
     */
    getMode(): RenderMode {
        return this.mode;
    }

    /**
     * Check if parameter change requires accumulation reset
     */
    shouldResetForParameter(path: string): boolean {
        // Check no-reset list first
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

        // Conservative default for unknown parameters
        console.warn(`Unknown parameter prefix: ${path}, resetting accumulation`);
        return true;
    }

    /**
     * Reset accumulation
     */
    resetAccumulation(reason: string = 'manual'): void {
        this.engine.clearAccumulation();
        this.startTime = performance.now();

        this.bus.emit('accumulation.reset', { reason });
        console.log(`Accumulation reset: ${reason}`);
    }

    // ============================================================================
    // Private: Unified Render Loop
    // ============================================================================

    private runLoop(): void {
        const loop = () => {
            if (!this.running || this.paused) return;

            this.engine.renderFrame();
            this.reportProgress();

            // Production mode: check if goal met
            if (this.mode === 'production' && this.checkGoalMet()) {
                this.complete();
                return;
            }

            this.animationId = requestAnimationFrame(loop);
        };

        this.animationId = requestAnimationFrame(loop);
    }

    private checkGoalMet(): boolean {
        if (!this.goal) return false;
        return this.engine.sampleCount >= this.goal.targetSamples;
    }

    private complete(): void {
        const elapsed = performance.now() - this.startTime;
        const samples = this.engine.sampleCount;

        console.log(`✓ Production complete: ${samples} samples in ${(elapsed / 1000).toFixed(1)}s`);

        this.running = false;

        // Call goal's onComplete callback
        this.goal?.onComplete?.();

        // Resolve production promise
        if (this.productionResolve) {
            this.productionResolve();
            this.clearProductionPromise();
        }

        this.goal = null;
        this.bus.emit('render.complete', {
            samples,
            elapsedTime: elapsed
        });
        this.bus.emit('render.unlocked');  // Signal production mode ended
    }

    private clearProductionPromise(): void {
        this.productionResolve = undefined;
        this.productionReject = undefined;
    }

    private reportProgress(): void {
        if (!this.onProgress) return;

        const samples = this.engine.sampleCount;
        const elapsed = performance.now() - this.startTime;

        const info: ProgressInfo = {
            mode: this.mode,
            state: this.paused ? 'paused' : 'rendering',
            timestamp: performance.now(),
            samples,
            elapsedTime: elapsed
        };

        // Add production-specific fields
        if (this.mode === 'production' && this.goal) {
            info.targetSamples = this.goal.targetSamples;
            info.percentComplete = (samples / this.goal.targetSamples) * 100;

            // Call goal's progress callback
            this.goal.onProgress?.(info);
        }

        this.onProgress(info);
    }
}

export { RenderCoordinator };
export type { RenderMode, RenderState, ProgressInfo, ProductionGoal };
