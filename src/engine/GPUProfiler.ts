// engine/GPUProfiler.ts

/**
 * GPUProfiler - Measures GPU execution time for render passes
 *
 * Uses readPixels to force GPU completion after each pass, then
 * measures wall-clock time. This is necessary on macOS where
 * EXT_disjoint_timer_query_webgl2 returns identical values for all passes.
 *
 * Usage:
 *   const profiler = new GPUProfiler(gl);
 *   profiler.enable();
 *
 *   // Each frame:
 *   profiler.update();           // No-op (API compat)
 *   profiler.beginPass('main');
 *   // ... render ...
 *   profiler.endPass('main');
 *
 *   const timing = profiler.getPassTiming('main');  // in milliseconds
 */
export class GPUProfiler {
    private gl: WebGL2RenderingContext;
    private enabled: boolean = false;

    // Per-pass start timestamps
    private passStartTime = new Map<string, number>();

    // Latest timing results (ms)
    private timings = new Map<string, number>();

    // Smoothed timings for display stability
    private smoothedTimings = new Map<string, number>();
    private smoothingFactor = 0.3;

    // Reusable pixel buffers for readPixels sync
    private floatBuffer = new Float32Array(4);
    private byteBuffer = new Uint8Array(4);

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
    }

    enable(): boolean {
        this.enabled = true;
        console.log('GPU profiling enabled');
        return true;
    }

    disable(): void {
        this.enabled = false;
    }

    beginPass(passId: string): void {
        if (!this.enabled) return;
        this.passStartTime.set(passId, performance.now());
    }

    endPass(passId: string): void {
        if (!this.enabled) return;

        // Force GPU to finish rendering to the currently-bound FBO
        const gl = this.gl;
        const format = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT);
        const type = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE);
        gl.readPixels(0, 0, 1, 1, format, type,
            type === gl.FLOAT ? this.floatBuffer : this.byteBuffer);

        const startTime = this.passStartTime.get(passId);
        if (startTime === undefined) return;

        const timeMs = performance.now() - startTime;
        this.passStartTime.delete(passId);

        this.timings.set(passId, timeMs);

        const prev = this.smoothedTimings.get(passId) ?? timeMs;
        this.smoothedTimings.set(passId, prev + (timeMs - prev) * this.smoothingFactor);
    }

    update(): void {}

    getPassTiming(passId: string): number | null {
        return this.smoothedTimings.get(passId) ?? null;
    }

    getRawPassTiming(passId: string): number | null {
        return this.timings.get(passId) ?? null;
    }

    getAllTimings(): Map<string, number> {
        return new Map(this.smoothedTimings);
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    reset(): void {
        this.timings.clear();
        this.smoothedTimings.clear();
        this.passStartTime.clear();
    }
}
