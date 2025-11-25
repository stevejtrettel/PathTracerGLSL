// app-new/FlexibleApp.ts
// Main orchestrator for the new architecture

import { SimpleCompiler } from '../compiler/SimpleCompiler.js';
import { FlexibleEngine } from '../engine-new/FlexibleEngine.js';
import type { ICompiler, CompiledRenderer, SceneDescription, RenderStrategy } from '../compiler/types.js';
import type { FlexibleAppConfig, RenderProgress, StrategyPreset } from './types.js';

/**
 * FlexibleApp - High-level orchestration for the new architecture
 *
 * Key responsibilities:
 * - Own Compiler and Engine
 * - Compile scene with multiple strategies at initialization
 * - Manage renderer switching
 * - Handle resize
 * - Provide clean API for rendering and export
 *
 * Design decisions:
 * - App owns compiler (Option A from design doc)
 * - One scene, multiple strategies
 * - Camera as parameters (no recompilation for camera changes)
 * - Parameter persistence across renderer switches
 */
export class FlexibleApp {
    // Core components
    private compiler: ICompiler;
    private engine: FlexibleEngine;
    private gl: WebGL2RenderingContext;

    // State
    private scene: SceneDescription | null = null;
    private strategies: Map<string, RenderStrategy> = new Map();
    private renderers: Map<string, CompiledRenderer> = new Map();
    private activeRendererId: string | null = null;

    // Animation
    private animationId: number | null = null;
    private isRunning = false;

    // Progress tracking
    private lastFrameTime = 0;
    private frameCount = 0;
    private fpsHistory: number[] = [];

    // Callbacks
    public onProgress?: (progress: RenderProgress) => void;
    public onRendererChanged?: (rendererId: string) => void;

    constructor(canvas: HTMLCanvasElement) {
        // Setup canvas
        canvas.width = canvas.clientWidth || window.innerWidth;
        canvas.height = canvas.clientHeight || window.innerHeight;

        // Get WebGL2 context
        const gl = canvas.getContext('webgl2', {
            alpha: false,
            antialias: false,
            depth: false,
            stencil: false,
            preserveDrawingBuffer: false,
            powerPreference: 'high-performance'
        });

        if (!gl) {
            throw new Error('WebGL2 not supported');
        }

        this.gl = gl;

        // Create core components
        this.compiler = new SimpleCompiler();
        this.engine = new FlexibleEngine(gl);

        console.log('FlexibleApp created');
    }

    // ============================================================================
    // Initialization
    // ============================================================================

    /**
     * Initialize app with scene and strategies
     *
     * Compiles all strategy combinations upfront for fast switching.
     */
    async initialize(config: FlexibleAppConfig): Promise<void> {
        const { scene, strategies, initialParameters } = config;

        if (strategies.length === 0) {
            throw new Error('At least one strategy required');
        }

        this.scene = scene;
        console.log(`Initializing FlexibleApp with scene: ${scene.id}`);

        // Compile all strategies
        const compiledRenderers: CompiledRenderer[] = [];

        for (const strategy of strategies) {
            console.log(`  Compiling strategy: ${strategy.id}`);
            const renderer = this.compiler.compile(scene, strategy);
            compiledRenderers.push(renderer);
            this.strategies.set(strategy.id, strategy);
            this.renderers.set(renderer.id, renderer);
        }

        // Load all renderers into engine
        this.engine.loadRenderers(compiledRenderers);

        // Select first renderer
        const firstRenderer = compiledRenderers[0];
        this.engine.selectRenderer(firstRenderer.id);
        this.activeRendererId = firstRenderer.id;

        // Apply initial parameters if provided
        if (initialParameters) {
            for (const [key, value] of Object.entries(initialParameters)) {
                this.engine.setParameter(key, value);
            }
        }

        // TODO: Load environment HDR if provided
        // if (config.environmentHDR) {
        //     await this.engine.loadEnvironmentHDR(config.environmentHDR);
        // }

        console.log(`FlexibleApp initialized with ${compiledRenderers.length} renderers`);
        console.log(`  Available renderers: ${this.getAvailableRendererIds().join(', ')}`);
    }

    /**
     * Initialize with strategy presets (convenience method)
     */
    async initializeWithPresets(
        scene: SceneDescription,
        presetIds: string[],
        presets: Record<string, StrategyPreset> = {} // Caller must pass STRATEGY_PRESETS
    ): Promise<void> {
        const strategies = presetIds.map(id => {
            const preset = presets[id];
            if (!preset) {
                throw new Error(`Unknown strategy preset: ${id}`);
            }
            return preset.strategy;
        });

        await this.initialize({ scene, strategies });
    }

    // ============================================================================
    // Renderer Management
    // ============================================================================

    /**
     * Get available renderer IDs
     */
    getAvailableRendererIds(): string[] {
        return this.engine.getAvailableRendererIds();
    }

    /**
     * Get active renderer ID
     */
    getActiveRendererId(): string | null {
        return this.activeRendererId;
    }

    /**
     * Get active renderer
     */
    getActiveRenderer(): CompiledRenderer | null {
        if (!this.activeRendererId) return null;
        return this.renderers.get(this.activeRendererId) || null;
    }

    /**
     * Switch to a different renderer
     *
     * Preserves common parameter values across the switch.
     */
    selectRenderer(rendererId: string): void {
        if (rendererId === this.activeRendererId) {
            return;
        }

        if (!this.renderers.has(rendererId)) {
            console.warn(`Unknown renderer: ${rendererId}`);
            return;
        }

        // Get current parameter values to preserve
        const currentParams = this.engine.getAllParameters();

        // Switch renderer
        this.engine.selectRenderer(rendererId);
        this.activeRendererId = rendererId;

        // Re-apply common parameters (parameter persistence)
        for (const [key, value] of Object.entries(currentParams)) {
            // Skip engine-internal parameters
            if (key.startsWith('engine.')) continue;
            this.engine.setParameter(key, value);
        }

        // Reset accumulation for new renderer
        this.engine.clearAccumulation();

        console.log(`Switched to renderer: ${rendererId}`);
        this.onRendererChanged?.(rendererId);
    }

    /**
     * Select renderer by strategy ID (convenience)
     */
    selectRendererByStrategy(strategyId: string): void {
        if (!this.scene) {
            console.warn('App not initialized');
            return;
        }

        // Renderer ID format: {strategy}-{scene}
        const rendererId = `${strategyId}-${this.scene.id}`;
        this.selectRenderer(rendererId);
    }

    // ============================================================================
    // Rendering
    // ============================================================================

    /**
     * Start the render loop
     */
    start(): void {
        if (this.isRunning) return;

        this.isRunning = true;
        this.lastFrameTime = performance.now();
        this.frameCount = 0;

        console.log('Render loop started');
        this.renderLoop();
    }

    /**
     * Stop the render loop
     */
    stop(): void {
        if (!this.isRunning) return;

        this.isRunning = false;

        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        console.log('Render loop stopped');
    }

    /**
     * Check if render loop is running
     */
    isActive(): boolean {
        return this.isRunning;
    }

    /**
     * Render a single frame (manual control)
     */
    renderFrame(): void {
        this.engine.renderFrame();
    }

    /**
     * Reset accumulation (clear samples)
     */
    clearAccumulation(): void {
        this.engine.clearAccumulation();
    }

    /**
     * Get current sample count
     */
    getSampleCount(): number {
        return this.engine.getSampleCount();
    }

    // ============================================================================
    // Parameters
    // ============================================================================

    /**
     * Set a parameter value
     */
    setParameter(path: string, value: any): void {
        this.engine.setParameter(path, value);
    }

    /**
     * Get a parameter value
     */
    getParameter(path: string): any {
        return this.engine.getParameter(path);
    }

    /**
     * Get all parameter values
     */
    getAllParameters(): Record<string, any> {
        return this.engine.getAllParameters();
    }

    // ============================================================================
    // Resize
    // ============================================================================

    /**
     * Handle canvas resize
     */
    resize(width: number, height: number): void {
        const canvas = this.gl.canvas as HTMLCanvasElement;
        canvas.width = width;
        canvas.height = height;

        this.engine.resize(width, height);
        this.engine.clearAccumulation();

        console.log(`Resized to ${width}×${height}`);
    }

    /**
     * Resize to window dimensions
     */
    resizeToWindow(): void {
        this.resize(window.innerWidth, window.innerHeight);
    }

    // ============================================================================
    // Export
    // ============================================================================

    /**
     * Get available export names for current renderer
     */
    getAvailableExports(): string[] {
        return this.engine.getExportNames();
    }

    /**
     * Read export data
     */
    readExport(name: string): Float32Array | Uint8Array {
        return this.engine.readExport(name);
    }

    /**
     * Get canvas dimensions
     */
    getCanvasSize(): [number, number] {
        const canvas = this.gl.canvas as HTMLCanvasElement;
        return [canvas.width, canvas.height];
    }

    // ============================================================================
    // Keyboard Controls (Basic)
    // ============================================================================

    /**
     * Setup basic keyboard controls
     *
     * - 1-9: Switch renderers
     * - r/R: Reset accumulation
     * - Space: Toggle rendering
     */
    setupKeyboardControls(): void {
        window.addEventListener('keydown', (e) => {
            const rendererIds = this.getAvailableRendererIds();

            // 1-9: Switch renderers
            if (e.key >= '1' && e.key <= '9') {
                const index = parseInt(e.key) - 1;
                if (index < rendererIds.length) {
                    this.selectRenderer(rendererIds[index]);
                }
            }

            // r/R: Reset accumulation
            else if (e.key === 'r' || e.key === 'R') {
                this.clearAccumulation();
            }

            // Space: Toggle rendering
            else if (e.key === ' ') {
                if (this.isRunning) {
                    this.stop();
                } else {
                    this.start();
                }
            }
        });

        console.log('Keyboard controls enabled (1-9: renderers, r: reset, space: toggle)');
    }

    // ============================================================================
    // Cleanup
    // ============================================================================

    /**
     * Dispose of all resources
     */
    dispose(): void {
        this.stop();
        this.engine.dispose();
        this.renderers.clear();
        this.strategies.clear();
        console.log('FlexibleApp disposed');
    }

    // ============================================================================
    // Private: Render Loop
    // ============================================================================

    private renderLoop(): void {
        if (!this.isRunning) return;

        // Render frame
        this.engine.renderFrame();
        this.frameCount++;

        // Calculate FPS
        const now = performance.now();
        const delta = now - this.lastFrameTime;
        this.lastFrameTime = now;

        const fps = 1000 / delta;
        this.fpsHistory.push(fps);
        if (this.fpsHistory.length > 60) {
            this.fpsHistory.shift();
        }

        // Report progress
        if (this.onProgress) {
            const avgFps = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
            this.onProgress({
                samples: this.engine.getSampleCount(),
                fps: avgFps,
                elapsedTime: now,
                mode: 'interactive',
                state: 'rendering'
            });
        }

        // Schedule next frame
        this.animationId = requestAnimationFrame(() => this.renderLoop());
    }
}
