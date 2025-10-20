// app/RenderCoordinator.ts
import type { Engine } from '../engine/Engine';
import type { EventBus } from './EventBus';

type RenderMode = 'interactive' | 'progressive' | 'production';

type RenderState = 'idle' | 'rendering' | 'paused' | 'complete' | 'reset';

interface ProgressInfo {
    mode: RenderMode;
    state: RenderState;
    timestamp: number;

    // Progressive & Production
    samples?: number;
    elapsedTime?: number;

    // Interactive
    fps?: number;
    frameTime?: number;

    // Production
    percentComplete?: number;
    targetSamples?: number;

    // Reset
    reason?: string;
}

/**
 * RenderCoordinator manages rendering execution across three modes:
 * - Interactive: Real-time preview, reports FPS
 * - Progressive: Continuous accumulation, reports samples
 * - Production: Accumulate to target, reports progress
 */
class RenderCoordinator {
    private engine: Engine;
    private bus: EventBus;
    private mode: RenderMode = 'progressive';
    private running = false;
    private animationId?: number;
    private startTime = 0;

    // Reset rules (moved from App)
    private resetPrefixes = ['camera.', 'quad.', 'material.', 'scene.'];
    private noResetPrefixes = ['developer.', 'debug.', 'resolution'];

    // Production mode target (hardcoded for now)
    private readonly PRODUCTION_TARGET_SAMPLES = 1000;

    // Progress reporting callback
    public onProgress?: (info: ProgressInfo) => void;

    constructor(engine: Engine, bus: EventBus) {
        this.engine = engine;
        this.bus = bus;
    }

    /**
     * Get current render mode
     */
    getMode(): RenderMode {
        return this.mode;
    }

    /**
     * Set render mode (stops current rendering if active)
     */
    setMode(mode: RenderMode): void {
        if (this.running) {
            this.stop();
        }
        this.mode = mode;
        console.log(`Render mode set to: ${mode}`);
    }

    /**
     * Start rendering in current mode
     */
    start(): void {
        if (this.running) {
            console.warn('Already rendering');
            return;
        }

        this.running = true;
        this.startTime = performance.now();

        console.log(`Starting ${this.mode} mode`);

        // Dispatch to mode-specific implementation
        switch (this.mode) {
            case 'interactive':
                this.runInteractive();
                break;
            case 'progressive':
                this.runProgressive();
                break;
            case 'production':
                this.runProduction();
                break;
        }
    }

    /**
     * Stop rendering
     */
    stop(): void {
        if (!this.running) return;

        this.running = false;

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = undefined;
        }

        this.reportProgress({
            state: 'paused',
            samples: this.engine.sampleCount
        });

        console.log(`Stopped rendering at ${this.engine.sampleCount} samples`);
    }

    /**
     * Check if currently rendering
     */
    isRunning(): boolean {
        return this.running;
    }

    /**
     * Determine if a parameter change requires accumulation reset
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
     * Reset accumulation (clears buffers and sample count)
     */
    resetAccumulation(reason: string = 'manual'): void {
        this.engine.clearAccumulation();

        // Reset the timer!
        this.startTime = performance.now();

        this.reportProgress({
            state: 'reset',
            samples: 0,
            reason
        });

        // Emit reset event for extensions
        this.bus.emit('accumulation.reset', { reason });

        console.log(`Accumulation reset: ${reason}`);
    }

    // ============================================================================
    // Private: Mode Implementations
    // ============================================================================

    /**
     * Interactive mode: Real-time preview, reports FPS
     * Continuously renders, prioritizes responsiveness
     */
    private runInteractive(): void {
        const loop = () => {
            if (!this.running || this.mode !== 'interactive') return;

            const frameStart = performance.now();

            // Render one frame
            this.engine.renderFrame();

            const frameTime = performance.now() - frameStart;

            // Report FPS
            this.reportProgress({
                state: 'rendering',
                fps: 1000 / frameTime,
                frameTime,
                elapsedTime: performance.now() - this.startTime
            });

            this.animationId = requestAnimationFrame(loop);
        };

        this.animationId = requestAnimationFrame(loop);
    }

    /**
     * Progressive mode: Continuous accumulation, reports samples
     * Renders forever until manually stopped
     */
    private runProgressive(): void {
        const loop = () => {
            if (!this.running || this.mode !== 'progressive') return;

            // Render one frame (adds one sample)
            this.engine.renderFrame();

            const samples = this.engine.sampleCount;

            // Report progress every frame
            this.reportProgress({
                state: 'rendering',
                samples,
                elapsedTime: performance.now() - this.startTime
            });

            this.animationId = requestAnimationFrame(loop);
        };

        this.animationId = requestAnimationFrame(loop);
    }

    /**
     * Production mode: Accumulate to target, reports progress
     * Stops automatically when target samples reached
     */
    private runProduction(): void {
        const loop = () => {
            if (!this.running || this.mode !== 'production') return;

            const samples = this.engine.sampleCount;

            // Check if target reached
            if (samples >= this.PRODUCTION_TARGET_SAMPLES) {
                this.running = false;

                this.reportProgress({
                    state: 'complete',
                    samples,
                    targetSamples: this.PRODUCTION_TARGET_SAMPLES,
                    percentComplete: 100,
                    elapsedTime: performance.now() - this.startTime
                });

                console.log(`Production render complete: ${samples} samples`);
                return;
            }

            // Render one frame
            this.engine.renderFrame();

            // Report progress every 10 samples
            if (samples % 10 === 0) {
                const percent = (samples / this.PRODUCTION_TARGET_SAMPLES) * 100;

                this.reportProgress({
                    state: 'rendering',
                    samples,
                    targetSamples: this.PRODUCTION_TARGET_SAMPLES,
                    percentComplete: percent,
                    elapsedTime: performance.now() - this.startTime
                });
            }

            this.animationId = requestAnimationFrame(loop);
        };

        this.animationId = requestAnimationFrame(loop);
    }

    /**
     * Report progress via callback
     */
    private reportProgress(info: Partial<ProgressInfo>): void {
        if (!this.onProgress) return;

        const fullInfo: ProgressInfo = {
            mode: this.mode,
            state: 'rendering',
            timestamp: performance.now(),
            ...info
        };

        this.onProgress(fullInfo);
    }
}

export { RenderCoordinator };
export type { RenderMode, RenderState, ProgressInfo };
