// app/utils/AnimationLoop.ts

/**
 * AnimationLoop - Manages requestAnimationFrame loop with delta time
 *
 * Handles the boilerplate of RAF loops with automatic delta time calculation.
 * Properly tracks time and provides clean start/stop interface.
 */
export class AnimationLoop {
    private animationId?: number;
    private lastTime = 0;
    private isRunning = false;

    /**
     * Start the animation loop
     *
     * @param callback - Called each frame with delta time in seconds
     */
    start(callback: (dt: number) => void): void {
        if (this.isRunning) {
            console.warn('AnimationLoop: Already running');
            return;
        }

        this.isRunning = true;
        this.lastTime = performance.now();

        const loop = (time: number) => {
            if (!this.isRunning) return;

            const dt = (time - this.lastTime) / 1000;
            this.lastTime = time;

            callback(dt);

            this.animationId = requestAnimationFrame(loop);
        };

        this.animationId = requestAnimationFrame(loop);
    }

    /**
     * Stop the animation loop
     */
    stop(): void {
        if (!this.isRunning) return;

        this.isRunning = false;

        if (this.animationId !== undefined) {
            cancelAnimationFrame(this.animationId);
            this.animationId = undefined;
        }
    }

    /**
     * Check if loop is running
     */
    running(): boolean {
        return this.isRunning;
    }
}
