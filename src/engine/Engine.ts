// engine/Engine.ts

import { ResourceManager } from './ResourceManager.js';
import { RenderExecutor } from './RenderExecutor.js';
import { ParameterManager } from './ParameterManager.js';
import { GPUProfiler } from './GPUProfiler.js';
import { TextureRegistry } from './TextureRegistry.js';
import { TextureFactory } from './utils/TextureFactory.js';
import { HDRLoader } from './loaders/hdr-loader.js';
import { buildEnvironmentSampler } from './loaders/build-environment-sampler.js';
import {
    validateHDRResponse,
    validateHDRBuffer,
    validateHDRData,
    validateTextureCreation,
    validateCompiledRenderer,
    ConsoleReporter
} from '../errors/index.js';
import type { CompiledRenderer } from '../compiler/types.js';
import type { ParameterChanges } from '../app/types.js';
import type { UniformBinding } from './types.js';

/**
 * Engine state
 */
type EngineState = 'ready' | 'running' | 'error';

/**
 * Engine uniforms (provided by Engine, not user parameters)
 */
interface EngineUniforms {
    resolution: [number, number];
    imageSize: [number, number];
    frameIndex: number;
    time: number;
    sampleCount: number;
    pixelOffset: [number, number];
}

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

    // Engine uniform locations (cached per shader per renderer)
    // Structure: rendererId → shaderId → uniformName → location
    private uniformLocations = new Map<string, Map<string, Map<string, WebGLUniformLocation>>>();

    // Custom parameter storage (for renderer-specific parameters like displayMode)
    private customParameters = new Map<string, any>();

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.resourceManager = new ResourceManager(gl);
        this.renderExecutor = new RenderExecutor(gl, this.resourceManager);
        this.parameterManager = new ParameterManager(gl);
        this.textureRegistry = new TextureRegistry(gl, 1);  // Reserve unit 0 for accumulator
        this.startTime = performance.now();

        // Initialize GPU profiler
        this.profiler = new GPUProfiler(gl);
        this.renderExecutor.setProfiler(this.profiler);

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

        // Cache uniform locations for all shaders
        this._cacheRendererUniformLocations(id, renderer);

        // Initialize parameter system
        // TODO: Need to get active program for parameter manager
        // For now, we'll defer parameter initialization until selectRenderer

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

        // Initialize parameter manager with first shader's program
        // TODO: This is a simplification - need to handle multiple programs
        const firstShaderId = renderer.pipeline.passes[0]?.shader;
        if (firstShaderId) {
            const program = this.renderExecutor.getProgram(firstShaderId);
            if (program) {
                // Initialize with uniform bindings from renderer
                this._initializeParameterManager(program, renderer.uniforms);
            }
        }

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

        // Get canvas dimensions
        const width = this.gl.canvas.width;
        const height = this.gl.canvas.height;

        // Use imageSize for tiled rendering, otherwise use framebuffer size
        const imgSize: [number, number] = this.imageSize[0] > 0
            ? this.imageSize
            : [width, height];

        // Engine uniforms to set
        const engineUniforms: EngineUniforms = {
            resolution: [width, height],
            imageSize: imgSize,
            frameIndex: sampleCount,
            time: this._time,
            sampleCount: sampleCount,
            pixelOffset: this.pixelOffset
        };

        // Set engine uniforms for all shaders in pipeline
        this._setEngineUniforms(this.activeRendererId, renderer, engineUniforms);

        // Set custom uniforms from UniformBinding
        this._setCustomUniforms(this.activeRendererId, renderer, engineUniforms);

        // Execute pipeline
        this.renderExecutor.executePipeline(renderer.pipeline);

        // Increment sample count
        this.sampleCounts.set(this.activeRendererId, sampleCount + 1);
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

    /**
     * Update shader uniforms from parameter changes
     */
    updateParameters(changes: ParameterChanges): void {
        if (this.state === 'running') {
            this.parameterManager.updateUniforms(changes);
        }
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
        console.log(`Loading HDR environment: ${path}`);

        // Fetch
        const res = await fetch(path);

        // Validate response
        const responseResult = validateHDRResponse(res, path);
        if (responseResult.hasErrors()) {
            console.error(new ConsoleReporter().formatBag(responseResult));
            throw new Error(`Failed to load HDR from '${path}'. See console for details.`);
        }

        // Get buffer
        const buffer = await res.arrayBuffer();

        // Validate buffer
        const bufferResult = validateHDRBuffer(buffer, path);
        if (bufferResult.hasErrors()) {
            console.error(new ConsoleReporter().formatBag(bufferResult));
            throw new Error(`Invalid HDR file '${path}'. See console for details.`);
        }
        // Show warnings if any
        if (bufferResult.hasWarnings()) {
            console.warn(new ConsoleReporter().formatBag(bufferResult));
        }

        // Parse
        let hdr;
        try {
            hdr = HDRLoader.parse(buffer);
        } catch (error: any) {
            console.error(`\n❌ HDR parsing failed:\n`);
            console.error(`  • ${error.message || String(error)}`);
            throw new Error(`Failed to parse HDR file '${path}'. File may be corrupted.`);
        }

        const { width, height, data } = hdr;

        // Validate parsed data
        const dataResult = validateHDRData(width, height, data.length, path);
        if (dataResult.hasErrors()) {
            console.error(new ConsoleReporter().formatBag(dataResult));
            throw new Error(`Invalid HDR data in '${path}'. See console for details.`);
        }
        // Show data warnings if any
        if (dataResult.hasWarnings()) {
            console.warn(new ConsoleReporter().formatBag(dataResult));
        }

        // Create texture
        const tf = new TextureFactory(this.gl);
        const envTex = tf.createRGB32F(data, width, height);

        // Validate texture creation
        const textureResult = validateTextureCreation(envTex, width, height, this.gl);
        if (textureResult.hasErrors()) {
            console.error(new ConsoleReporter().formatBag(textureResult));
            throw new Error(`Failed to create texture for '${path}'. See console for details.`);
        }

        this.textureRegistry.register('env_map', envTex);

        // Build CDF textures for importance sampling
        const built = buildEnvironmentSampler(
            this.gl,
            this.textureRegistry,
            data,
            width,
            height,
            { map: 'env_map', cond: 'env_cdf_cond', marg: 'env_cdf_marg' }
        );

        // Bind to all renderer programs
        for (const [_rendererId, renderer] of this.renderers.entries()) {
            this._bindEnvironmentTexturesToRenderer(renderer, width, height, built.totalWeight);
        }

        console.log(`✅ HDR loaded: ${width}×${height} (CDFs built), bound to ${this.renderers.size} renderer(s)`);
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
        this.renderers.clear();
        this.sampleCounts.clear();
        this.uniformLocations.clear();
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
     * Cache uniform locations for all shaders in a renderer
     */
    private _cacheRendererUniformLocations(rendererId: string, renderer: CompiledRenderer): void {
        const rendererLocations = new Map<string, Map<string, WebGLUniformLocation>>();

        // Track which custom uniforms are found in at least one shader
        const uniformFoundInShader = new Set<string>();

        for (const [shaderId, _shaderProgram] of renderer.shaders) {
            const program = this.renderExecutor.getProgram(shaderId);
            if (!program) continue;

            const shaderLocations = new Map<string, WebGLUniformLocation>();

            // Cache locations for engine uniforms
            const engineUniformNames = [
                'u_resolution',
                'u_imageSize',
                'u_frameIndex',
                'u_time',
                'u_sampleCount',
                'u_pixelOffset'
            ];

            for (const uniformName of engineUniformNames) {
                const location = this.gl.getUniformLocation(program, uniformName);
                if (location) {
                    shaderLocations.set(uniformName, location);
                }
            }

            // Cache locations for custom uniforms from UniformBinding
            for (const binding of renderer.uniforms) {
                const location = this.gl.getUniformLocation(program, binding.uniform);
                if (location) {
                    shaderLocations.set(binding.uniform, location);
                    uniformFoundInShader.add(binding.uniform);
                }
            }

            rendererLocations.set(shaderId, shaderLocations);
        }

        // Only warn about uniforms not found in ANY shader
        for (const binding of renderer.uniforms) {
            if (!uniformFoundInShader.has(binding.uniform)) {
                console.warn(`Uniform '${binding.uniform}' not found in any shader (may be optimized out or misspelled)`);
            }
        }

        this.uniformLocations.set(rendererId, rendererLocations);
    }

    /**
     * Set engine uniforms for all shaders in active renderer
     */
    private _setEngineUniforms(
        rendererId: string,
        renderer: CompiledRenderer,
        uniforms: EngineUniforms
    ): void {
        const rendererLocations = this.uniformLocations.get(rendererId);
        if (!rendererLocations) return;

        // Set uniforms for each shader used in the pipeline
        for (const pass of renderer.pipeline.passes) {
            const program = this.renderExecutor.getProgram(pass.shader);
            if (!program) continue;

            const locations = rendererLocations.get(pass.shader);
            if (!locations) continue;

            // Use program
            this.gl.useProgram(program);

            // Set each uniform (using camelCase: u_variableName convention)
            const loc_resolution = locations.get('u_resolution');
            if (loc_resolution) {
                this.gl.uniform2f(loc_resolution, uniforms.resolution[0], uniforms.resolution[1]);
            }

            const loc_imageSize = locations.get('u_imageSize');
            if (loc_imageSize) {
                this.gl.uniform2f(loc_imageSize, uniforms.imageSize[0], uniforms.imageSize[1]);
            }

            const loc_frameIndex = locations.get('u_frameIndex');
            if (loc_frameIndex) {
                this.gl.uniform1i(loc_frameIndex, uniforms.frameIndex);
            }

            const loc_time = locations.get('u_time');
            if (loc_time) {
                this.gl.uniform1f(loc_time, uniforms.time);
            }

            const loc_sampleCount = locations.get('u_sampleCount');
            if (loc_sampleCount) {
                this.gl.uniform1i(loc_sampleCount, uniforms.sampleCount);
            }

            const loc_pixelOffset = locations.get('u_pixelOffset');
            if (loc_pixelOffset) {
                this.gl.uniform2f(loc_pixelOffset, uniforms.pixelOffset[0], uniforms.pixelOffset[1]);
            }
        }
    }

    /**
     * Set custom uniforms from UniformBinding for all shaders in active renderer
     */
    private _setCustomUniforms(
        rendererId: string,
        renderer: CompiledRenderer,
        engineUniforms: EngineUniforms
    ): void {
        const rendererLocations = this.uniformLocations.get(rendererId);
        if (!rendererLocations) return;

        // Build parameter map (engine + custom)
        const parameters: Record<string, any> = {
            'engine.resolution': engineUniforms.resolution,
            'engine.imageSize': engineUniforms.imageSize,
            'engine.frameIndex': engineUniforms.frameIndex,
            'engine.time': engineUniforms.time,
            'engine.sampleCount': engineUniforms.sampleCount,
            'engine.pixelOffset': engineUniforms.pixelOffset
        };

        // Add custom parameters
        for (const [name, value] of this.customParameters) {
            parameters[name] = value;
        }

        // Set uniforms for each shader used in the pipeline
        for (const pass of renderer.pipeline.passes) {
            const program = this.renderExecutor.getProgram(pass.shader);
            if (!program) continue;

            const locations = rendererLocations.get(pass.shader);
            if (!locations) continue;

            // Use program
            this.gl.useProgram(program);

            // Process each uniform binding
            for (const binding of renderer.uniforms) {
                const location = locations.get(binding.uniform);
                if (!location) continue;

                // Collect parameter values needed for this binding
                const paramValues: Record<string, any> = {};
                for (const paramPath of binding.parameters) {
                    paramValues[paramPath] = parameters[paramPath];
                }

                // Compute uniform value
                const value = binding.compute(paramValues);

                // Set uniform based on type
                this._setUniformValue(location, value, binding.type);
            }
        }
    }

    /**
     * Set a uniform value based on type
     */
    private _setUniformValue(location: WebGLUniformLocation, value: any, type: string): void {
        const gl = this.gl;

        switch (type) {
            case 'int':
                gl.uniform1i(location, value);
                break;
            case 'float':
                gl.uniform1f(location, value);
                break;
            case 'vec2':
                gl.uniform2f(location, value[0], value[1]);
                break;
            case 'vec3':
                gl.uniform3f(location, value[0], value[1], value[2]);
                break;
            case 'vec4':
                gl.uniform4f(location, value[0], value[1], value[2], value[3]);
                break;
            case 'mat3':
                gl.uniformMatrix3fv(location, false, value);
                break;
            case 'mat4':
                gl.uniformMatrix4fv(location, false, value);
                break;
            default:
                console.warn(`Unknown uniform type: ${type}`);
        }
    }

    /**
     * Initialize parameter manager with uniform bindings
     */
    private _initializeParameterManager(program: WebGLProgram, uniforms: UniformBinding[]): void {
        // Create fake modules array for parameter manager
        // TODO: Update ParameterManager to accept UniformBinding[] directly
        const fakeModules = [{
            id: { kind: 'test' as const, name: 'compiled', version: '1.0.0' },
            fragment: { functions: '' },
            uniformBindings: uniforms
        }];

        this.parameterManager.initialize(program, fakeModules);
    }

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

// ============ DEFERRED FEATURES (TODOs) ============
//
// 1. READ OPERATIONS (readRadiance, readRGB)
//    - Need to decide which framebuffer to read from
//    - Add methods to read HDR (rgba32f) and LDR (rgba8) data
//    - Important for production rendering and export
//
// 2. HDR ENVIRONMENT LOADING
//    - TextureRegistry for global textures
//    - HDR parsing and CDF building for importance sampling
//    - Binding environment textures to shaders
//    - May belong in separate TextureManager or content loading system
//
// 3. VALIDATION
//    - Implement full validateCompiledRenderer()
//    - Implement full validatePipeline()
//    - Check shader/framebuffer/texture ID consistency
//
// 4. CLEAR ACCUMULATION BUFFERS
//    - Add ResourceManager.clearBuffer(rendererId, bufferId)
//    - Call from clearAccumulation() to actually clear GPU buffers
//
