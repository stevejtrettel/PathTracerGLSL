// engine/Engine.ts

import { ResourceManager } from './ResourceManager.js';
import { RenderExecutor } from './RenderExecutor.js';
import { ParameterManager } from './ParameterManager.js';
import { GPUProfiler } from './GPUProfiler.js';
import { TextureRegistry } from './TextureRegistry.js';
import { HDREnvironmentLoader } from './HDREnvironmentLoader.js';
import {
    validateCompiledRenderer,
    ConsoleReporter,
    DiagnosticBag
} from '../errors/index.js';
import type { CompiledRenderer } from '../compiler/types.js';

/**
 * Engine state
 */
type EngineState = 'ready' | 'running' | 'error';

/**
 * Rectangle region for reading pixel data
 */
interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Engine - Manages GPU resources and rendering with flexible pipelines
 *
 * Responsibilities:
 * - Load CompiledRenderers from Compiler
 * - Manage GPU resources (via ResourceManager)
 * - Execute render pipelines (via RenderExecutor)
 * - Track rendering state (sample counts, time, etc.)
 * - Handle parameter updates (via ParameterManager)
 * - Support tiled rendering (pixel offset, image size)
 *
 * Key differences from old Engine:
 * - Takes pre-compiled renderers (no shader compilation)
 * - Executes arbitrary pipelines (no fixed 3-pass structure)
 * - Data-driven GPU resource management
 */
export class Engine {
    private gl: WebGL2RenderingContext;
    private resourceManager: ResourceManager;
    private renderExecutor: RenderExecutor;
    private parameterManager: ParameterManager;
    private profiler: GPUProfiler;
    private textureRegistry: TextureRegistry;
    private hdrLoader: HDREnvironmentLoader;

    // Renderer storage
    private renderers = new Map<string, CompiledRenderer>();
    private activeRendererId: string | null = null;

    // Per-renderer state
    private sampleCounts = new Map<string, number>();

    // Engine state
    private state: EngineState = 'ready';

    // Time tracking
    private startTime: number;
    private _time: number = 0;

    // Tiled rendering state
    private pixelOffset: [number, number] = [0, 0];
    private imageSize: [number, number] = [0, 0];

    // Custom parameter storage (for renderer-specific parameters like displayMode)
    private customParameters = new Map<string, any>();

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.resourceManager = new ResourceManager(gl);
        this.renderExecutor = new RenderExecutor(gl, this.resourceManager);
        this.parameterManager = new ParameterManager(gl);
        this.textureRegistry = new TextureRegistry(gl, 1);  // Reserve unit 0 for accumulator
        this.hdrLoader = new HDREnvironmentLoader(gl, this.textureRegistry);
        this.startTime = performance.now();

        // Initialize GPU profiler
        this.profiler = new GPUProfiler(gl);
        this.renderExecutor.setProfiler(this.profiler);

        // Wire up ParameterManager to RenderExecutor
        this.renderExecutor.setParameterManager(this.parameterManager);

        // Handle context loss
        gl.canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            this._handleContextLoss();
        });
    }

    // ============ LOADING ============

    /**
     * Load a single renderer
     */
    loadRenderer(id: string, renderer: CompiledRenderer): void {
        if (this.renderers.has(id)) {
            console.log(`Renderer '${id}' already loaded, skipping`);
            return;
        }

        console.log(`Loading renderer '${id}'...`);

        // Validate CompiledRenderer structure
        const validation = validateCompiledRenderer(renderer);
        if (validation.hasErrors()) {
            console.error(new ConsoleReporter().formatBag(validation));
            throw new Error(`Renderer validation failed for '${id}'. See console for details.`);
        }
        if (validation.hasWarnings()) {
            console.warn(new ConsoleReporter().formatBag(validation));
        }

        // Load shaders
        try {
            this.renderExecutor.loadShaders(renderer.shaders);
        } catch (error: any) {
            this.state = 'error';
            throw new Error(`Failed to compile shaders for '${id}': ${error.message}`);
        }

        // Load GPU resources
        this.resourceManager.loadRenderer(id, renderer.pipeline);

        // Store renderer
        this.renderers.set(id, renderer);
        this.sampleCounts.set(id, 0);

        console.log(`✅ Renderer '${id}' loaded successfully`);
    }

    /**
     * Load multiple renderers (convenience method)
     */
    loadRenderers(renderers: CompiledRenderer[]): void {
        if (renderers.length === 0) {
            throw new Error('At least one renderer required');
        }

        console.log(`Loading ${renderers.length} renderer(s)...`);

        for (const renderer of renderers) {
            this.loadRenderer(renderer.id, renderer);
        }

        // Select first renderer
        this.selectRenderer(renderers[0].id);
        this.state = 'running';

        console.log(`Initialized with renderer: ${renderers[0].id}`);
    }

    /**
     * Switch to a different renderer
     */
    selectRenderer(id: string): void {
        if (!this.renderers.has(id)) {
            throw new Error(`Renderer not loaded: ${id}`);
        }

        const renderer = this.renderers.get(id)!;

        // Switch resource manager
        this.resourceManager.selectRenderer(id);

        // Set active pipeline in executor
        this.renderExecutor.setActivePipeline(renderer.pipeline);

        // Build programs map from all shaders
        const programs = new Map<string, WebGLProgram>();
        for (const [shaderId] of renderer.shaders) {
            const program = this.renderExecutor.getProgram(shaderId);
            if (program) {
                programs.set(shaderId, program);
            }
        }

        // Initialize ParameterManager with all programs and bindings
        this.parameterManager.initialize(programs, renderer.uniforms);

        this.activeRendererId = id;

        // Reset profiler to clear stale timing data from previous renderer
        this.profiler.reset();

        console.log(`Switched to renderer '${id}'`);
    }

    // ============ RENDERING ============

    /**
     * Render one frame
     */
    renderFrame(): void {
        if (this.state !== 'running') {
            throw new Error(`Cannot render in state: ${this.state}`);
        }

        if (!this.activeRendererId) {
            throw new Error('No active renderer');
        }

        const renderer = this.renderers.get(this.activeRendererId)!;
        const sampleCount = this.sampleCounts.get(this.activeRendererId)!;

        // Update time
        this._time = (performance.now() - this.startTime) / 1000;

        // Build all parameters (engine + custom)
        const parameters = this._buildParameters(sampleCount);

        // Execute pipeline (RenderExecutor handles uniforms per-pass via ParameterManager)
        this.renderExecutor.executePipeline(renderer.pipeline, parameters);

        // Increment sample count
        this.sampleCounts.set(this.activeRendererId, sampleCount + 1);
    }

    /**
     * Build all parameters for uniform computation
     */
    private _buildParameters(sampleCount: number): Record<string, any> {
        const width = this.gl.canvas.width;
        const height = this.gl.canvas.height;

        // Use imageSize for tiled rendering, otherwise use framebuffer size
        const imgSize: [number, number] = this.imageSize[0] > 0
            ? this.imageSize
            : [width, height];

        // Start with engine parameters
        const parameters: Record<string, any> = {
            'engine.resolution': [width, height],
            'engine.imageSize': imgSize,
            'engine.frameIndex': sampleCount,
            'engine.time': this._time,
            'engine.sampleCount': sampleCount,
            'engine.pixelOffset': this.pixelOffset
        };

        // Add custom parameters
        for (const [name, value] of this.customParameters) {
            parameters[name] = value;
        }

        return parameters;
    }

    // ============ PARAMETERS ============

    /**
     * Set a custom parameter value
     *
     * Parameters are used to compute uniform values via UniformBinding.compute()
     * Common parameter namespaces:
     * - 'engine.*' - engine-provided (resolution, time, etc.)
     * - 'renderer.*' - renderer-specific (displayMode, etc.)
     * - 'scene.*' - scene parameters
     *
     * @param name - Parameter name (e.g., 'renderer.displayMode')
     * @param value - Parameter value (number, array, etc.)
     */
    setParameter(name: string, value: any): void {
        this.customParameters.set(name, value);
    }

    /**
     * Get a parameter value
     */
    getParameter(name: string): any {
        return this.customParameters.get(name);
    }

    /**
     * Get all custom parameter values
     *
     * Returns a snapshot of all user-set parameters (not engine internals).
     * Useful for parameter persistence when switching renderers.
     */
    getAllParameters(): Record<string, any> {
        const result: Record<string, any> = {};
        for (const [key, value] of this.customParameters) {
            result[key] = value;
        }
        return result;
    }

    // ============ PROFILING ============

    /**
     * Enable GPU profiling
     * @returns true if extension supported, false otherwise
     */
    enableProfiling(): boolean {
        return this.profiler.enable();
    }

    /**
     * Disable GPU profiling
     */
    disableProfiling(): void {
        this.profiler.disable();
    }

    /**
     * Get timing for a specific render pass
     * @param passId - Pass ID from pipeline (e.g., 'main-pass', 'display-pass')
     * @returns Timing in milliseconds, or null if not available yet
     */
    getPassTiming(passId: string): number | null {
        return this.profiler.getPassTiming(passId);
    }

    /**
     * Get all render pass timings
     * @returns Map of passId -> timing (ms)
     */
    getAllPassTimings(): Map<string, number> {
        return this.profiler.getAllTimings();
    }

    /**
     * Check if profiling is enabled
     */
    isProfilingEnabled(): boolean {
        return this.profiler.isEnabled();
    }

    // ============ STATE QUERIES ============

    /**
     * Get current state
     */
    getState(): EngineState {
        return this.state;
    }

    /**
     * Check if ready
     */
    isReady(): boolean {
        return this.state === 'ready';
    }

    /**
     * Check if running
     */
    isRunning(): boolean {
        return this.state === 'running';
    }

    /**
     * Check if in error state
     */
    isError(): boolean {
        return this.state === 'error';
    }

    /**
     * Get active renderer ID
     */
    getActiveRendererId(): string | null {
        return this.activeRendererId;
    }

    /**
     * Get the active renderer object (for accessing metadata like parameters)
     */
    getActiveRenderer(): CompiledRenderer | null {
        if (!this.activeRendererId) return null;
        return this.renderers.get(this.activeRendererId) || null;
    }

    /**
     * Get available renderer IDs
     */
    getAvailableRendererIds(): string[] {
        return Array.from(this.renderers.keys());
    }

    /**
     * Get sample count for active renderer
     */
    getSampleCount(): number {
        if (!this.activeRendererId) return 0;
        return this.sampleCounts.get(this.activeRendererId) || 0;
    }

    /**
     * Get current time (seconds since engine creation)
     */
    get time(): number {
        return this._time;
    }

    // ============ UTILITIES ============

    /**
     * Clear accumulation for active renderer
     *
     * Resets sample count and clears all GPU buffers to black.
     */
    clearAccumulation(): void {
        if (!this.activeRendererId) return;

        // Reset sample count
        this.sampleCounts.set(this.activeRendererId, 0);

        // Clear all framebuffers (accumulation, etc.)
        this.resourceManager.clearAllBuffers();

        // Clear uniform value cache so frameIndex/sampleCount uniforms update correctly
        this.parameterManager.clearCache();

        console.log(`Accumulation cleared for renderer '${this.activeRendererId}'`);
    }

    /**
     * Resize framebuffers
     */
    resize(width: number, height: number): void {
        this.resourceManager.resize(width, height);
        // Note: RenderExecutor doesn't need resize in new architecture
        // (viewport is set per-pass in executePass)
    }

    /**
     * Get canvas size
     */
    getCanvasSize(): [number, number] {
        return [this.gl.canvas.width, this.gl.canvas.height];
    }

    // ============ EXPORT / READ OPERATIONS ============

    /**
     * Read a named export from active renderer
     *
     * Common exports:
     * - 'hdr': HDR radiance (Float32Array)
     * - 'ldr': LDR display (Uint8Array)
     * - 'albedo', 'normal', 'depth': AOV passes
     *
     * @param name - Export name (must be defined in renderer.exportTargets)
     * @param rect - Optional region to read (defaults to full framebuffer)
     * @returns Pixel data as Float32Array or Uint8Array
     */
    readExport(name: string, rect?: Rectangle): Float32Array | Uint8Array {
        if (!this.activeRendererId) {
            throw new Error('No active renderer');
        }

        const renderer = this.renderers.get(this.activeRendererId)!;
        const target = renderer.exportTargets?.[name];

        if (!target) {
            const available = this.getExportNames();
            const availableStr = available.length > 0 ? available.join(', ') : 'none';
            throw new Error(
                `Export target '${name}' not defined in renderer '${this.activeRendererId}'. ` +
                `Available exports: ${availableStr}`
            );
        }

        return this.readBuffer(target.bufferId, target.format, target.attachment || 0, rect);
    }

    /**
     * Read framebuffer data directly (low-level)
     *
     * Reads any framebuffer by id, bypassing the export system.
     * Useful for debugging or advanced use cases.
     *
     * @param bufferId - Framebuffer id (e.g., 'accumulation_current', 'screen')
     * @param format - Data format ('float' for HDR, 'byte' for LDR)
     * @param attachment - Which color attachment to read (for MRT framebuffers), defaults to 0
     * @param rect - Optional region to read (defaults to full framebuffer)
     * @returns Pixel data as Float32Array or Uint8Array
     */
    readBuffer(
        bufferId: string,
        format: 'float' | 'byte',
        attachment: number = 0,
        rect?: Rectangle
    ): Float32Array | Uint8Array {
        const gl = this.gl;
        const canvas = gl.canvas as HTMLCanvasElement;

        // Get rectangle (default to full framebuffer)
        const r = rect || {
            x: 0,
            y: 0,
            width: canvas.width,
            height: canvas.height
        };

        // Validate rectangle
        if (r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0) {
            throw new Error(`Invalid rectangle: ${JSON.stringify(r)}`);
        }

        // Get framebuffer
        const framebuffer = this.resourceManager.getFramebuffer(bufferId);

        // Bind framebuffer
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

        // Set read buffer for MRT (which attachment to read from)
        if (attachment > 0) {
            gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachment);
        } else {
            // Default to COLOR_ATTACHMENT0
            gl.readBuffer(gl.COLOR_ATTACHMENT0);
        }

        // Read pixels
        if (format === 'float') {
            const pixels = new Float32Array(r.width * r.height * 4);
            gl.readPixels(
                r.x,
                r.y,
                r.width,
                r.height,
                gl.RGBA,
                gl.FLOAT,
                pixels
            );
            return pixels;
        } else {
            const pixels = new Uint8Array(r.width * r.height * 4);
            gl.readPixels(
                r.x,
                r.y,
                r.width,
                r.height,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                pixels
            );
            return pixels;
        }
    }

    /**
     * Get list of available export names for active renderer
     *
     * @returns Array of export names (e.g., ['hdr', 'ldr', 'albedo'])
     */
    getExportNames(): string[] {
        if (!this.activeRendererId) return [];

        const renderer = this.renderers.get(this.activeRendererId)!;
        return Object.keys(renderer.exportTargets || {});
    }

    /**
     * Get list of all framebuffer ids in active renderer's pipeline
     *
     * Useful for debugging - shows all buffers that can be read with readBuffer()
     *
     * @returns Array of buffer ids (e.g., ['accumulation', 'screen', 'albedo-fb'])
     */
    getAvailableBuffers(): string[] {
        if (!this.activeRendererId) return [];

        const renderer = this.renderers.get(this.activeRendererId)!;
        return renderer.pipeline.framebuffers.map(fb => fb.id);
    }

    // ============ TILED RENDERING ============

    /**
     * Set pixel offset for tiled rendering
     */
    setPixelOffset(x: number, y: number): void {
        this.pixelOffset = [x, y];
    }

    /**
     * Clear pixel offset
     */
    clearPixelOffset(): void {
        this.pixelOffset = [0, 0];
    }

    /**
     * Set full image size for tiled rendering
     */
    setImageSize(width: number, height: number): void {
        this.imageSize = [width, height];
    }

    /**
     * Clear image size (use framebuffer resolution)
     */
    clearImageSize(): void {
        this.imageSize = [0, 0];
    }

    // ============ ENVIRONMENT LOADING ============

    /**
     * Load HDR environment map and build sampling CDFs
     *
     * Loads an HDR file, creates textures for:
     * - env_map: The HDR environment image
     * - env_cdf_cond: Conditional CDF for importance sampling
     * - env_cdf_marg: Marginal CDF for importance sampling
     *
     * After loading, binds the textures to all loaded renderers.
     *
     * @param path - Path to the .hdr file
     */
    async loadEnvironmentHDR(path: string): Promise<void> {
        // Use HDREnvironmentLoader to load and create textures
        const envData = await this.hdrLoader.loadEnvironmentHDR(path);

        // Bind to all renderer programs
        for (const [_rendererId, renderer] of this.renderers.entries()) {
            this._bindEnvironmentTexturesToRenderer(
                renderer,
                envData.width,
                envData.height,
                envData.totalWeight
            );
        }

        console.log(`✅ Environment bound to ${this.renderers.size} renderer(s)`);
    }

    /**
     * Bind environment textures to a renderer's shaders
     */
    private _bindEnvironmentTexturesToRenderer(
        renderer: CompiledRenderer,
        envWidth: number,
        envHeight: number,
        totalWeight: number
    ): void {
        const gl = this.gl;

        for (const [shaderId, _shaderProgram] of renderer.shaders) {
            const program = this.renderExecutor.getProgram(shaderId);
            if (!program) continue;

            gl.useProgram(program);

            // Bind environment textures
            const envMapLoc = gl.getUniformLocation(program, 'u_envMap');
            const envCdfCondLoc = gl.getUniformLocation(program, 'u_envCDFCond');
            const envCdfMargLoc = gl.getUniformLocation(program, 'u_envCDFMarg');

            if (envMapLoc) this.textureRegistry.bind('env_map', envMapLoc);
            if (envCdfCondLoc) this.textureRegistry.bind('env_cdf_cond', envCdfCondLoc);
            if (envCdfMargLoc) this.textureRegistry.bind('env_cdf_marg', envCdfMargLoc);

            // Set environment uniform values
            const envSizeLoc = gl.getUniformLocation(program, 'u_envSize');
            const envWeightLoc = gl.getUniformLocation(program, 'u_envTotalWeight');

            if (envSizeLoc) gl.uniform2f(envSizeLoc, envWidth, envHeight);
            if (envWeightLoc) gl.uniform1f(envWeightLoc, totalWeight);
        }
    }

    // ============ CLEANUP ============

    /**
     * Dispose all resources
     */
    dispose(): void {
        this.renderExecutor.cleanup();
        this.resourceManager.cleanup();
        this.textureRegistry.dispose();
        this.parameterManager.reset();
        this.renderers.clear();
        this.sampleCounts.clear();
        this.customParameters.clear();
        this.activeRendererId = null;
        this.state = 'ready';
    }

    /**
     * Get texture registry (for environment loading, etc.)
     */
    getTextureRegistry(): TextureRegistry {
        return this.textureRegistry;
    }

    // ============ PRIVATE METHODS ============

    /**
     * Handle WebGL context loss
     */
    private _handleContextLoss(): void {
        console.error('WebGL context lost - rendering stopped');
        this.state = 'ready';
        this.resourceManager.handleContextLoss();
        // FUTURE: Implement context restoration
        // - Cache renderer compilation results
        // - Recreate all WebGL resources after context restore
        // - Resume rendering if it was in progress
    }
}
