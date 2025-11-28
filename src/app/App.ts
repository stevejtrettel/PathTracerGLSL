// app/App.ts
// Main orchestrator for the new architecture

import { SimpleCompiler } from '../compiler/SimpleCompiler.js';
import { Engine } from '../engine/Engine.js';
import { RenderCoordinator, type ProgressInfo } from './RenderCoordinator.js';
import { ParameterStore } from './ParameterStore.js';
import { EventBus } from './EventBus.js';
import { ExportManager } from './ExportManager.js';
import { SessionManager } from './SessionManager.js';
import { AppLayout, type LayoutMode, type RegionName } from './layout/index.js';
import type { ICompiler, CompiledRenderer, SceneDescription, RenderStrategy } from '../compiler/types.js';
import type { AppConfig, StrategyPreset, CreateAppOptions } from './types.js';
import type { Extension } from './types.js';

/**
 * App - High-level orchestration for the new architecture
 *
 * Key responsibilities:
 * - Own Compiler, Engine, and RenderCoordinator
 * - Compile scene with multiple strategies at initialization
 * - Manage renderer switching
 * - Provide interactive and production render modes
 * - Handle resize
 * - Provide clean API for rendering and export
 *
 * Design decisions:
 * - App owns compiler (Option A from design doc)
 * - One scene, multiple strategies
 * - Camera as parameters (no recompilation for camera changes)
 * - Parameter persistence across renderer switches
 */
export class App {
    // Core components
    private compiler: ICompiler;
    private engine: Engine;
    private coordinator: RenderCoordinator;
    private parameterStore: ParameterStore;
    private eventBus: EventBus;
    private exportManager: ExportManager;
    private sessionManager: SessionManager;
    private gl: WebGL2RenderingContext;

    // State
    private scene: SceneDescription | null = null;
    private strategies: Map<string, RenderStrategy> = new Map();
    private renderers: Map<string, CompiledRenderer> = new Map();
    private activeRendererId: string | null = null;

    // Extensions
    private extensions: Map<string, Extension> = new Map();

    // Layout (optional - can be set after construction)
    private layout: AppLayout | null = null;
    private previousLayoutMode: LayoutMode | null = null;
    private productionLayoutMode: LayoutMode = 'centered';

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
        this.engine = new Engine(gl);
        this.eventBus = new EventBus();
        this.parameterStore = new ParameterStore();

        // Create coordinator with EventBus for render events
        this.coordinator = new RenderCoordinator(this.engine, this.eventBus);

        // Create managers
        this.exportManager = new ExportManager(this.engine, this.coordinator);
        this.sessionManager = new SessionManager(
            this.parameterStore,
            this.eventBus,
            this.extensions,
            () => this.activeRendererId,
            (id: string) => this.selectRenderer(id)
        );

        // Wire ParameterStore changes to engine, EventBus, and accumulation reset
        this.parameterStore.onChange = (changes) => {
            for (const change of changes.changes) {
                // Forward to engine
                this.engine.setParameter(change.path, change.newValue);

                // Check if should reset accumulation
                // Skip if this is a "resend" (oldValue === newValue) from renderer switch
                const isResend = change.oldValue === change.newValue;
                const isRendering = this.coordinator.isRunning() || this.coordinator.isPaused();

                if (!isResend && isRendering) {
                    if (this.coordinator.shouldResetForParameter(change.path)) {
                        this.coordinator.resetAccumulation(`parameter: ${change.path}`);
                    }
                }

                // Emit parameter change event (skip resends)
                if (!isResend) {
                    this.eventBus.emit('parameter.changed', {
                        path: change.path,
                        oldValue: change.oldValue,
                        newValue: change.newValue
                    });
                }
            }
        };

        // Wire coordinator progress to EventBus
        this.coordinator.onProgress = (info: ProgressInfo) => {
            // Emit progress event
            this.eventBus.emit('render.progress', info);
        };

        // Wire up automatic layout switching
        // Production render events
        this.eventBus.on('render.started', (data: { mode: string }) => {
            if (data.mode === 'production' && this.layout) {
                // Only save previous layout if we're not already in production mode
                // This prevents extended renders from overwriting the original layout
                if (!this.previousLayoutMode) {
                    this.previousLayoutMode = this.layout.mode;
                    console.log(`Saved previous layout: ${this.previousLayoutMode}`);
                }
                this.setLayoutMode(this.productionLayoutMode);
                console.log(`Switched to '${this.productionLayoutMode}' layout for production`);
            }
        });

        this.eventBus.on('render.stopped', () => {
            this.restoreLayout();
            // Ensure parameters are unlocked when stopping production
            if (this.parameterStore.isLocked()) {
                this.parameterStore.unlock();
                console.log('Unlocked parameters on render stop');
            }
        });



        console.log('App created');
    }

    // ============================================================================
    // Factory Method
    // ============================================================================

    /**
     * Create an App with integrated layout (recommended)
     *
     * This is the simplest way to create an App. It:
     * 1. Creates the layout system with specified mode
     * 2. Creates a canvas in the layout's canvas container
     * 3. Creates the App with the canvas
     * 4. Connects the layout to the App
     *
     * @param container - The root element (usually document.body)
     * @param options - Layout configuration options
     * @returns A fully configured App instance
     *
     * @example
     * ```typescript
     * const app = App.create(document.body, { layout: 'fullscreen' });
     * await app.initialize({ scene, strategies });
     * app.start();
     * ```
     */
    static create(
        container: HTMLElement = document.body,
        options: CreateAppOptions = {}
    ): App {
        const layoutMode = options.layout ?? 'fullscreen';

        // Create layout
        const layout = new AppLayout(container, {
            mode: layoutMode,
            variables: options.layoutVariables
        });

        // Create canvas in layout's canvas container
        const canvas = document.createElement('canvas');
        layout.getCanvasContainer().appendChild(canvas);

        // Create app with canvas
        const app = new App(canvas);

        // Connect layout to app
        app.setLayout(layout);

        console.log(`App created with layout: ${layoutMode}`);
        return app;
    }

    // ============================================================================
    // Initialization
    // ============================================================================

    /**
     * Initialize app with scene and strategies
     *
     * Compiles all strategy combinations upfront for fast switching.
     */
    async initialize(config: AppConfig): Promise<void> {
        const { scene, strategies, initialParameters } = config;

        if (strategies.length === 0) {
            throw new Error('At least one strategy required');
        }

        this.scene = scene;
        console.log(`Initializing App with scene: ${scene.id}`);

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

        // Apply initial parameters if provided (via store for change notification)
        if (initialParameters) {
            this.parameterStore.batch(initialParameters);
        }

        // Load environment HDR if provided
        if (config.environmentHDR) {
            try {
                await this.engine.loadEnvironmentHDR(config.environmentHDR);
            } catch (error) {
                console.error(`Failed to load HDR environment: ${config.environmentHDR}`, error);
                throw error;
            }
        }

        console.log(`App initialized with ${compiledRenderers.length} renderers`);
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
    // Content Loading
    // ============================================================================

    /**
     * Load HDR environment map
     *
     * Can be called after initialization to load or change the environment map.
     * Creates textures for the environment and importance sampling CDFs.
     *
     * @param path - Path to the .hdr file
     */
    async loadEnvironmentHDR(path: string): Promise<void> {
        await this.engine.loadEnvironmentHDR(path);

        // Reset accumulation since environment changed
        this.clearAccumulation();
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
     * Preserves parameter values across the switch using ParameterStore.
     */
    selectRenderer(rendererId: string): void {
        if (rendererId === this.activeRendererId) {
            return;
        }

        if (!this.renderers.has(rendererId)) {
            console.warn(`Unknown renderer: ${rendererId}`);
            return;
        }

        // Switch renderer in engine
        this.engine.selectRenderer(rendererId);
        this.activeRendererId = rendererId;

        // Re-send all parameters to the new renderer (parameter persistence)
        // This bypasses accumulation reset since it's a renderer switch
        this.parameterStore.resendAll();

        // Reset accumulation for new renderer
        this.engine.clearAccumulation();

        console.log(`Switched to renderer: ${rendererId}`);

        // Emit event
        this.eventBus.emit('renderer.switched', { rendererId });
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
    // Rendering - Interactive Mode
    // ============================================================================

    /**
     * Start interactive rendering (continuous, unlocked)
     */
    start(): void {
        this.coordinator.startInteractive();
    }

    /**
     * Stop rendering (both interactive and production)
     */
    stop(): void {
        this.coordinator.stop();
    }

    /**
     * Pause rendering
     */
    pause(): void {
        this.coordinator.pause();
    }

    /**
     * Resume paused rendering
     */
    resume(): void {
        this.coordinator.resume();
    }

    /**
     * Check if render loop is running (not paused)
     */
    isActive(): boolean {
        return this.coordinator.isRunning();
    }

    /**
     * Check if paused
     */
    isPaused(): boolean {
        return this.coordinator.isPaused();
    }

    private previousLayoutMode: LayoutMode | null = null;
    private previousResolution: [number, number] | null = null;
    private productionLayoutMode: LayoutMode = 'centered';

    /**
     * Check if in locked production mode
     */
    isLocked(): boolean {
        return this.coordinator.isLocked();
    }

    // ============================================================================
    // Rendering - Production Mode
    // ============================================================================

    /**
     * Get an installed extension by name
     */


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
                this.resize(options.width, options.height);
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

    // ============================================================================
    // Rendering - Utilities
    // ============================================================================

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
        this.coordinator.resetAccumulation('manual');
    }

    /**
     * Cycle through display modes for AOV renderers
     * Works with debug.displayMode or renderer.displayMode parameters
     */
    cycleDisplayMode(): void {
        // Try different display mode parameter names
        const modeParams = ['debug.displayMode', 'renderer.displayMode'];
        const renderer = this.engine.getActiveRenderer();

        for (const param of modeParams) {
            // Check if this parameter exists in renderer metadata
            const metadata = renderer?.parameters?.[param];
            if (metadata) {
                // Get current value (may be undefined if never set, use default)
                const current = this.getParameter(param) ?? metadata.default ?? 0;
                const max = metadata.range?.[1] ?? 2;

                const next = ((current as number) + 1) % (max + 1);
                this.setParameter(param, next);

                // Show mode name if available
                const modeName = metadata.options?.[next] ?? `Mode ${next}`;
                console.log(`Display mode: ${modeName} (${next})`);
                return;
            }
        }

        console.log('No display mode parameter found for current renderer');
    }

    /**
     * Get current sample count
     */
    getSampleCount(): number {
        return this.coordinator.getSampleCount();
    }

    /**
     * Get elapsed render time in milliseconds
     */
    getElapsedTime(): number {
        return this.coordinator.getElapsedTime();
    }

    /**
     * Get current FPS
     */
    getFPS(): number {
        return this.coordinator.getFPS();
    }

    /**
     * Get current render mode
     */
    getRenderMode(): 'interactive' | 'production' {
        return this.coordinator.getMode();
    }

    /**
     * Get current render state
     */
    getRenderState(): 'rendering' | 'paused' | 'complete' | 'stopped' {
        return this.coordinator.getState();
    }

    // ============================================================================
    // Stats & Profiling
    // ============================================================================

    /**
     * Unified stats object combining all render statistics
     */
    getStats(): {
        samples: number;
        fps: number;
        elapsedMs: number;
        resolution: [number, number];
        mode: 'interactive' | 'production';
        state: 'rendering' | 'paused' | 'complete' | 'stopped';
        rendererId: string | null;
        profilingEnabled: boolean;
        gpuTimings: Record<string, number> | null;
    } {
        const gpuTimingsMap = this.engine.isProfilingEnabled()
            ? this.engine.getAllPassTimings()
            : null;

        // Convert Map to plain object for easier consumption
        let gpuTimings: Record<string, number> | null = null;
        if (gpuTimingsMap) {
            gpuTimings = {};
            for (const [key, value] of gpuTimingsMap) {
                gpuTimings[key] = value;
            }
        }

        return {
            samples: this.getSampleCount(),
            fps: this.getFPS(),
            elapsedMs: this.getElapsedTime(),
            resolution: this.getCanvasSize(),
            mode: this.getRenderMode(),
            state: this.getRenderState(),
            rendererId: this.activeRendererId,
            profilingEnabled: this.engine.isProfilingEnabled(),
            gpuTimings
        };
    }

    /**
     * Enable GPU profiling
     * @returns true if supported, false otherwise
     */
    enableProfiling(): boolean {
        return this.engine.enableProfiling();
    }

    /**
     * Disable GPU profiling
     */
    disableProfiling(): void {
        this.engine.disableProfiling();
    }

    /**
     * Check if GPU profiling is enabled
     */
    isProfilingEnabled(): boolean {
        return this.engine.isProfilingEnabled();
    }

    // ============================================================================
    // Parameters
    // ============================================================================

    /**
     * Set a parameter value
     *
     * Changes flow through ParameterStore:
     * 1. Store validates and persists the value
     * 2. onChange forwards to engine
     * 3. Coordinator checks if accumulation should reset
     * 4. External listeners are notified
     */
    setParameter(path: string, value: any): void {
        this.parameterStore.set(path, value);
    }

    /**
     * Set multiple parameters in a batch
     *
     * More efficient than individual setParameter calls.
     */
    setParameters(params: Record<string, any>): void {
        this.parameterStore.batch(params);
    }

    /**
     * Get a parameter value
     */
    getParameter(path: string): any {
        return this.parameterStore.get(path);
    }

    /**
     * Get all parameter values
     */
    getAllParameters(): Record<string, any> {
        return this.parameterStore.serialize();
    }

    /**
     * Get parameter metadata for active renderer
     *
     * Returns metadata from the CompiledRenderer's parameters field.
     * Useful for auto-generating UI controls.
     */
    getParameterMetadata(): Map<string, import('../app/types.js').ParameterMetadata> {
        const result = new Map<string, import('../app/types.js').ParameterMetadata>();

        if (!this.activeRendererId) return result;

        const renderer = this.renderers.get(this.activeRendererId);
        if (!renderer?.parameters) return result;

        // Convert Record to Map
        for (const [path, meta] of Object.entries(renderer.parameters)) {
            result.set(path, meta);
        }

        return result;
    }

    /**
     * Check if parameters are locked (during production render)
     */
    areParametersLocked(): boolean {
        return this.parameterStore.isLocked();
    }

    // ============================================================================
    // Session Management
    // ============================================================================

    /**
     * Save session state
     *
     * Returns a JSON-serializable object that can be stored and
     * passed to restoreSession() later.
     */
    saveSession(): {
        parameters: Record<string, any>;
        rendererId: string | null;
        extensions: Record<string, any>;
    } {
        return this.sessionManager.saveSession();
    }

    /**
     * Restore session state
     *
     * Restores parameters, renderer selection, and extension states.
     */
    restoreSession(session: {
        parameters: Record<string, any>;
        rendererId?: string | null;
        extensions?: Record<string, any>;
    }): void {
        this.sessionManager.restoreSession({
            parameters: session.parameters,
            rendererId: session.rendererId ?? null,
            extensions: session.extensions ?? {}
        });
    }

    /**
     * Quick save session to file download
     *
     * Generates a timestamped filename and triggers a download.
     */
    quickSave(): void {
        this.sessionManager.quickSave();
    }

    /**
     * Load session from file via file picker dialog
     *
     * Opens a file picker and loads the selected JSON session file.
     */
    loadSessionFromFile(): void {
        this.sessionManager.loadSessionFromFile();
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

    // ============================================================================
    // Tiled Rendering Support
    // ============================================================================

    /**
     * Set pixel offset for tiled rendering
     *
     * Used when rendering a tile that's part of a larger image.
     * The shader uses this offset to compute correct pixel positions.
     */
    setPixelOffset(x: number, y: number): void {
        this.engine.setPixelOffset(x, y);
    }

    /**
     * Clear pixel offset (return to normal rendering)
     */
    clearPixelOffset(): void {
        this.engine.clearPixelOffset();
    }

    /**
     * Set full image size for tiled rendering
     *
     * When rendering tiles, this is the total output image size
     * (not the current framebuffer size). Used for correct aspect ratio
     * and sampling patterns in progressive rendering.
     */
    setImageSize(width: number, height: number): void {
        this.engine.setImageSize(width, height);
    }

    /**
     * Clear image size (use framebuffer resolution)
     */
    clearImageSize(): void {
        this.engine.clearImageSize();
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
        return this.exportManager.getAvailableExports();
    }

    /**
     * Read export data (low-level)
     */
    readExport(name: string): Float32Array | Uint8Array {
        return this.exportManager.readExport(name);
    }

    /**
     * Get canvas dimensions
     */
    getCanvasSize(): [number, number] {
        return this.exportManager.getCanvasSize();
    }

    /**
     * Get canvas element
     */
    getCanvas(): HTMLCanvasElement {
        return this.gl.canvas as HTMLCanvasElement;
    }

    /**
     * Export PNG screenshot (LDR)
     *
     * Reads from 'ldr' export target and saves as PNG.
     * @param filename - Optional custom filename (auto-generated if not provided)
     */
    exportPNG(filename?: string): void {
        this.exportManager.exportPNG(filename);
    }

    /**
     * Export HDR file (Radiance RGBE format)
     *
     * Reads from 'hdr' export target and saves as .hdr file.
     * @param filename - Optional custom filename (auto-generated if not provided)
     */
    exportHDR(filename?: string): void {
        this.exportManager.exportHDR(filename);
    }

    /**
     * Export AOV (Arbitrary Output Variable)
     *
     * Exports a specific AOV like 'albedo', 'normal', etc.
     * @param aovName - Name of the AOV to export
     * @param filename - Optional custom filename
     */
    exportAOV(aovName: string, filename?: string): void {
        this.exportManager.exportAOV(aovName, filename);
    }

    /**
     * Export all available AOVs
     *
     * Exports all AOVs (excluding standard 'hdr' and 'ldr').
     */
    exportAllAOVs(): void {
        this.exportManager.exportAllAOVs();
    }

    // ============================================================================
    // Extensions
    // ============================================================================

    /**
     * Install an extension
     *
     * Extensions receive the app instance and EventBus for integration.
     * @param extension - Extension to install
     */
    use(extension: Extension): void {
        if (this.extensions.has(extension.name)) {
            console.warn(`Extension '${extension.name}' already installed`);
            return;
        }

        // Check dependencies
        if (extension.dependencies) {
            for (const dep of extension.dependencies) {
                if (!this.extensions.has(dep)) {
                    throw new Error(`Extension '${extension.name}' requires '${dep}'`);
                }
            }
        }

        // Install
        extension.install(this, this.eventBus);
        this.extensions.set(extension.name, extension);

        console.log(`Extension installed: ${extension.name}${extension.version ? ` v${extension.version}` : ''}`);
        this.eventBus.emit('extension.installed', {
            name: extension.name,
            version: extension.version
        });
    }

    /**
     * Uninstall an extension
     */
    unuse(extensionName: string): void {
        const extension = this.extensions.get(extensionName);
        if (!extension) {
            console.warn(`Extension '${extensionName}' not installed`);
            return;
        }

        extension.uninstall?.();
        this.extensions.delete(extensionName);

        console.log(`Extension uninstalled: ${extensionName}`);
        this.eventBus.emit('extension.uninstalled', { name: extensionName });
    }

    /**
     * Get installed extension names
     */
    getExtensionNames(): string[] {
        return Array.from(this.extensions.keys());
    }

    /**
     * Get extension by name
     */
    getExtension<T extends Extension>(name: string): T | undefined {
        return this.extensions.get(name) as T | undefined;
    }

    /**
     * Get EventBus for direct event subscriptions
     *
     * Allows external code to subscribe to app events without being an extension.
     */
    getEventBus(): EventBus {
        return this.eventBus;
    }

    // ============================================================================
    // Layout
    // ============================================================================

    /**
     * Set the layout manager
     *
     * Connects an AppLayout instance to the App for coordinated UI management.
     * Extensions can then use getLayout() to access layout regions.
     *
     * @param layout - The AppLayout instance to use
     */
    setLayout(layout: AppLayout): void {
        this.layout = layout;
        console.log(`Layout set: mode=${layout.mode}`);
    }

    /**
     * Get the layout manager
     *
     * Returns null if no layout has been set.
     */
    getLayout(): AppLayout | null {
        return this.layout;
    }

    /**
     * Check if a layout is configured
     */
    hasLayout(): boolean {
        return this.layout !== null;
    }

    /**
     * Set the layout mode
     *
     * Convenience method for switching layout modes.
     * @throws Error if no layout is configured
     */
    setLayoutMode(mode: LayoutMode): void {
        if (!this.layout) {
            throw new Error('No layout configured. Call setLayout() first.');
        }
        this.layout.setMode(mode);
        console.log(`Layout mode changed to: ${mode}`);
    }

    /**
     * Restore the layout mode and resolution that was active before production render
     */
    private restoreLayout(): void {
        // Restore layout
        if (this.previousLayoutMode && this.layout) {
            if (this.layout.mode !== this.previousLayoutMode) {
                this.setLayoutMode(this.previousLayoutMode);
                console.log(`Restored layout to '${this.previousLayoutMode}'`);
            }
            this.previousLayoutMode = null;
        }

        // Restore resolution
        if (this.previousResolution) {
            const [width, height] = this.previousResolution;
            console.log(`Restoring resolution: ${width}x${height}`);
            this.resize(width, height);
            this.previousResolution = null;
        }
    }

    /**
     * Get the current layout mode
     *
     * @returns The current mode, or null if no layout configured
     */
    getLayoutMode(): LayoutMode | null {
        return this.layout?.mode ?? null;
    }

    /**
     * Get a layout region by name
     *
     * Convenience method for accessing layout regions.
     * @throws Error if no layout is configured
     */
    getRegion(name: RegionName): HTMLElement {
        if (!this.layout) {
            throw new Error('No layout configured. Call setLayout() first.');
        }
        return this.layout.getRegion(name);
    }

    /**
     * Get the canvas container from the layout
     *
     * @throws Error if no layout is configured
     */
    getCanvasContainer(): HTMLElement {
        if (!this.layout) {
            throw new Error('No layout configured. Call setLayout() first.');
        }
        return this.layout.getCanvasContainer();
    }

    // ============================================================================
    // Cleanup
    // ============================================================================

    /**
     * Dispose of all resources
     */
    dispose(): void {
        this.stop();

        // Uninstall all extensions
        for (const [name, extension] of this.extensions) {
            extension.uninstall?.();
            console.log(`Extension uninstalled: ${name}`);
        }
        this.extensions.clear();

        // Clear event bus
        this.eventBus.removeAllListeners();

        // Dispose layout
        this.layout?.dispose();
        this.layout = null;

        // Dispose engine
        this.engine.dispose();
        this.renderers.clear();
        this.strategies.clear();

        console.log('App disposed');
    }
}
