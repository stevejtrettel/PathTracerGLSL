// engine/Engine.ts — Manages GPU resources and rendering with flexible pipelines

import { ResourceManager } from './ResourceManager.js';
import { RenderExecutor } from './RenderExecutor.js';
import { ParameterManager } from './ParameterManager.js';
import { GPUProfiler } from './GPUProfiler.js';
import { TextureRegistry } from './TextureRegistry.js';
import { TextureFactory } from './utils/TextureFactory.js';
import { HDREnvironmentLoader } from './HDREnvironmentLoader.js';
import { buildEnvironmentSampler } from './loaders/build-environment-sampler.js';
import { registerBlueNoise } from './loaders/blueNoise.js';
import {
    validateCompiledRenderer,
    ConsoleReporter
} from '../errors/index.js';
import type { CompiledRenderer } from '../compiler/types.js';
import type { EngineState } from './types.js';


interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
}

export class Engine {
    private gl: WebGL2RenderingContext;
    private resourceManager: ResourceManager;
    private renderExecutor: RenderExecutor;
    private parameterManager: ParameterManager;
    private profiler: GPUProfiler;
    private textureRegistry: TextureRegistry;
    private hdrLoader: HDREnvironmentLoader;

    private renderers = new Map<string, CompiledRenderer>();
    private activeRendererId: string | null = null;
    private sampleCounts = new Map<string, number>();
    private state: EngineState = 'ready';
    private startTime: number;
    private _time: number = 0;
    private pixelOffset: [number, number] = [0, 0];
    private imageSize: [number, number] = [0, 0];
    private customParameters = new Map<string, any>();
    private lostActiveRendererId: string | null = null;

    /** Called after the engine has rebuilt itself following a WebGL context restore. The
     *  engine rebuilds what it owns (programs, framebuffers, its global textures); the caller
     *  must re-supply its external textures and re-send parameter values. */
    onContextRestored?: () => void;
    // Monotonic RNG salt, bumped on every accumulation reset so the seed doesn't
    // replay after a reset (kills frozen-motion noise + reset-replay). See §2.11.
    private resetSalt = 0;
    // Reproducible mode (§2.11 deferred fixed-seed): while non-null, resets restore
    // this value instead of bumping, so identical action sequences replay identically.
    private pinnedResetSalt: number | null = null;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.resourceManager = new ResourceManager(gl);
        this.textureRegistry = new TextureRegistry(gl);   // dumb store; executor owns units (§2.10)
        registerBlueNoise(gl, this.textureRegistry);       // global blue-noise tile (dither + sampler)
        this.renderExecutor = new RenderExecutor(gl, this.resourceManager, this.textureRegistry);
        this.parameterManager = new ParameterManager(gl);
        this.hdrLoader = new HDREnvironmentLoader(gl, this.textureRegistry);
        this.startTime = performance.now();

        this.profiler = new GPUProfiler(gl);
        this.renderExecutor.setProfiler(this.profiler);
        this.renderExecutor.setParameterManager(this.parameterManager);

        gl.canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();  // required for 'webglcontextrestored' to fire
            this._handleContextLoss();
        });
        gl.canvas.addEventListener('webglcontextrestored', () => {
            this._handleContextRestored();
        });
    }

    // -- Loading --

    loadRenderer(id: string, renderer: CompiledRenderer): void {
        console.log(`Loading renderer '${id}'...`);

        // Validate structure BEFORE any destructive state change, so a replace
        // that fails validation leaves the existing renderer intact.
        const validation = validateCompiledRenderer(renderer);
        if (validation.hasErrors()) {
            console.error(new ConsoleReporter().formatBag(validation));
            throw new Error(`Renderer validation failed for '${id}'. See console for details.`);
        }
        if (validation.hasWarnings()) {
            console.warn(new ConsoleReporter().formatBag(validation));
        }

        if (this.renderers.has(id)) {
            // Replace: a recompile of the same id must take effect, not be skipped.
            // (Leaves activeRendererId null if we're replacing the active renderer —
            // the caller re-selects.)
            console.log(`Renderer '${id}' already loaded — replacing`);
            this.unloadRenderer(id);
        }

        try {
            this.renderExecutor.loadShaders(renderer.shaders);
        } catch (error: any) {
            this.state = 'error';
            throw new Error(`Failed to compile shaders for '${id}': ${error.message}`);
        }

        this.resourceManager.loadRenderer(id, renderer.pipeline);
        this.renderers.set(id, renderer);
        this.sampleCounts.set(id, 0);

        console.log(`Renderer '${id}' loaded successfully`);
    }

    /**
     * Unload a renderer, freeing its shaders and GPU resources.
     *
     * No-op if not loaded. If the unloaded renderer was active, clears the
     * active pointer — the caller must select another renderer before rendering.
     */
    unloadRenderer(id: string): void {
        const renderer = this.renderers.get(id);
        if (!renderer) return;

        this.renderExecutor.unloadShaders(renderer.shaders.keys());
        this.resourceManager.unloadRenderer(id);
        this.renderers.delete(id);
        this.sampleCounts.delete(id);

        if (this.activeRendererId === id) {
            this.activeRendererId = null;
        }

        console.log(`Renderer '${id}' unloaded`);
    }

    /**
     * Check that every renderer's shaders compile on the GPU, without loading
     * them. Throws on the first failure (message maps through source maps). No
     * GPU resources are allocated or freed and no existing renderer is touched —
     * safe to call before a destructive recompile/swap to keep peak memory at 1×.
     */
    validateRenderers(renderers: CompiledRenderer[]): void {
        for (const renderer of renderers) {
            this.renderExecutor.validateShaders(renderer.shaders);
        }
    }

    loadRenderers(renderers: CompiledRenderer[]): void {
        if (renderers.length === 0) {
            throw new Error('At least one renderer required');
        }

        for (const renderer of renderers) {
            this.loadRenderer(renderer.id, renderer);
        }

        this.selectRenderer(renderers[0].id);
        this.state = 'running';
    }

    selectRenderer(id: string): void {
        if (!this.renderers.has(id)) {
            throw new Error(`Renderer not loaded: ${id}`);
        }

        const renderer = this.renderers.get(id)!;
        this.resourceManager.selectRenderer(id);
        this.renderExecutor.setActivePipeline(renderer.pipeline);

        // Build programs map and initialize parameter bindings
        const programs = new Map<string, WebGLProgram>();
        for (const [shaderId] of renderer.shaders) {
            const program = this.renderExecutor.getProgram(shaderId);
            if (program) programs.set(shaderId, program);
        }
        this.parameterManager.initialize(programs, renderer.uniforms);

        this.activeRendererId = id;
        this.profiler.reset();
        console.log(`Switched to renderer '${id}'`);
    }

    // -- Rendering --

    renderFrame(): void {
        // No-op while the GPU context is lost so a running render loop survives to
        // resume after restore, instead of throwing and tearing the loop down.
        if (this.state === 'context-lost') return;
        if (this.state !== 'running') throw new Error(`Cannot render in state: ${this.state}`);
        if (!this.activeRendererId) throw new Error('No active renderer');

        const renderer = this.renderers.get(this.activeRendererId)!;
        const sampleCount = this.sampleCounts.get(this.activeRendererId)!;

        this._time = (performance.now() - this.startTime) / 1000;
        const parameters = this._buildParameters(sampleCount);
        this.renderExecutor.executePipeline(renderer.pipeline, parameters);
        this.sampleCounts.set(this.activeRendererId, sampleCount + 1);
    }

    /**
     * Render the display pass on demand into the 'ldr' scratch buffer, reading
     * `accumulation_previous` (post-swap — the same frame HDR export reads), so
     * `readExport('ldr')` returns the tonemapped + dithered LDR bytes. This is the ONLY
     * cost of PNG export (impl-plan-display Stage 4 / Option B) — the normal render loop
     * is untouched (display still → screen). Call immediately before readExport('ldr').
     */
    renderLdr(): void {
        if (this.state !== 'running') throw new Error(`Cannot render LDR in state: ${this.state}`);
        if (!this.activeRendererId) throw new Error('No active renderer');
        const renderer = this.renderers.get(this.activeRendererId)!;
        // E5: the recipe is DATA the compiler shipped — this engine knows no pass,
        // buffer, or uniform names (the four memorized names were a silent-runtime-
        // breakage class on any compiler rename).
        const recipe = renderer.ldrRecipe;
        if (!recipe) throw new Error('renderLdr: renderer ships no ldrRecipe (no display pass)');
        const displayPass = renderer.pipeline.passes.find(p => p.id === recipe.passId);
        if (!displayPass) throw new Error(`renderLdr: recipe pass '${recipe.passId}' not in pipeline`);

        const sampleCount = this.sampleCounts.get(this.activeRendererId)!;
        const parameters = this._buildParameters(sampleCount);
        this.renderExecutor.executePass({
            ...displayPass,
            output: recipe.output,
            inputs: { textures: { ...(displayPass.inputs?.textures ?? {}), ...recipe.inputs } },
        }, parameters);
    }

    private _buildParameters(sampleCount: number): Record<string, any> {
        const width = this.gl.canvas.width;
        const height = this.gl.canvas.height;
        const imgSize: [number, number] = this.imageSize[0] > 0
            ? this.imageSize
            : [width, height];

        const parameters: Record<string, any> = {
            'engine.resolution': [width, height],
            'engine.imageSize': imgSize,
            // RESERVED: engine.time has zero shader consumers today (u_time left the
            // program in exact-linkage); kept for the deferred motion-blur seed field
            // (impl-plan-cameras Category B).
            'engine.time': this._time,
            'engine.sampleCount': sampleCount,
            'engine.resetSalt': this.resetSalt,
            'engine.pixelOffset': this.pixelOffset
        };

        for (const [name, value] of this.customParameters) {
            parameters[name] = value;
        }
        return parameters;
    }

    // -- Parameters --

    // Set a custom parameter by dotted path (e.g. 'camera.fov', 'lamp.emission')
    setParameter(name: string, value: any): void { this.customParameters.set(name, value); }
    getParameter(name: string): any { return this.customParameters.get(name); }

    getAllParameters(): Record<string, any> {
        const result: Record<string, any> = {};
        for (const [key, value] of this.customParameters) {
            result[key] = value;
        }
        return result;
    }

    // -- Profiling --

    enableProfiling(): boolean { return this.profiler.enable(); }
    disableProfiling(): void { this.profiler.disable(); }
    isProfilingEnabled(): boolean { return this.profiler.isEnabled(); }
    getPassTiming(passId: string): number | null { return this.profiler.getPassTiming(passId); }
    getAllPassTimings(): Map<string, number> { return this.profiler.getAllTimings(); }

    // -- State Queries --

    getState(): EngineState { return this.state; }
    isReady(): boolean { return this.state === 'ready'; }
    isRunning(): boolean { return this.state === 'running'; }
    isError(): boolean { return this.state === 'error'; }
    getActiveRendererId(): string | null { return this.activeRendererId; }
    getAvailableRendererIds(): string[] { return Array.from(this.renderers.keys()); }
    get time(): number { return this._time; }
    getTextureRegistry(): TextureRegistry { return this.textureRegistry; }

    getActiveRenderer(): CompiledRenderer | null {
        if (!this.activeRendererId) return null;
        return this.renderers.get(this.activeRendererId) || null;
    }

    getSampleCount(): number {
        if (!this.activeRendererId) return 0;
        return this.sampleCounts.get(this.activeRendererId) || 0;
    }

    // -- Utilities --

    clearAccumulation(): void {
        if (!this.activeRendererId) return;
        this.sampleCounts.set(this.activeRendererId, 0);
        // New RNG salt so the reset render doesn't replay the identical stream (§2.11) —
        // unless pinned, in which case replaying identically is the point.
        this.resetSalt = this.pinnedResetSalt ?? this.resetSalt + 1;
        this.resourceManager.clearAllBuffers();
        this.parameterManager.clearCache();
    }

    getResetSalt(): number {
        return this.resetSalt;
    }

    /** Pin the RNG salt for reproducible renders; null unpins (resets bump again). */
    pinResetSalt(salt: number | null): void {
        this.pinnedResetSalt = salt;
        if (salt !== null) this.resetSalt = salt;
    }

    resize(width: number, height: number): void {
        this.resourceManager.resize(width, height);
        // ResourceManager.resize() reallocates (invalidates) every renderer's
        // accumulation textures, not just the active one. Reset all sample counts
        // to match — otherwise switching to a non-active renderer later blends fresh
        // samples into a stale/zeroed buffer at high N and darkens. (fable-review Engine #4)
        for (const id of this.sampleCounts.keys()) {
            this.sampleCounts.set(id, 0);
        }
    }

    getCanvasSize(): [number, number] {
        return [this.gl.canvas.width, this.gl.canvas.height];
    }

    // -- Tiled Rendering --

    setPixelOffset(x: number, y: number): void { this.pixelOffset = [x, y]; }
    clearPixelOffset(): void { this.pixelOffset = [0, 0]; }
    setImageSize(width: number, height: number): void { this.imageSize = [width, height]; }
    clearImageSize(): void { this.imageSize = [0, 0]; }

    // -- Export / Read Operations --

    // Read a named export (e.g. 'hdr', 'ldr', 'albedo', 'normal')
    readExport(name: string, rect?: Rectangle): Float32Array | Uint8Array {
        if (!this.activeRendererId) throw new Error('No active renderer');

        const renderer = this.renderers.get(this.activeRendererId)!;
        const target = renderer.exportTargets?.[name];

        if (!target) {
            const available = this.getExportNames();
            throw new Error(
                `Export target '${name}' not defined in renderer '${this.activeRendererId}'. ` +
                `Available: ${available.length > 0 ? available.join(', ') : 'none'}`
            );
        }

        return this.readBuffer(target.bufferId, target.format, target.attachment || 0, rect);
    }

    // Read framebuffer data directly (low-level)
    readBuffer(
        bufferId: string,
        format: 'float' | 'byte',
        attachment: number = 0,
        rect?: Rectangle
    ): Float32Array | Uint8Array {
        const gl = this.gl;

        // Default rect = the buffer's own dimensions (fixed-size buffers read their full
        // extent, not the canvas's — T4 contract extension).
        const [bw, bh] = this.resourceManager.getBufferSize(bufferId);
        const r = rect || { x: 0, y: 0, width: bw, height: bh };
        if (r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0) {
            throw new Error(`Invalid rectangle: ${JSON.stringify(r)}`);
        }

        const framebuffer = this.resourceManager.getFramebuffer(bufferId);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachment);

        if (format === 'float') {
            const pixels = new Float32Array(r.width * r.height * 4);
            gl.readPixels(r.x, r.y, r.width, r.height, gl.RGBA, gl.FLOAT, pixels);
            return pixels;
        } else {
            const pixels = new Uint8Array(r.width * r.height * 4);
            gl.readPixels(r.x, r.y, r.width, r.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            return pixels;
        }
    }

    getExportNames(): string[] {
        if (!this.activeRendererId) return [];
        const renderer = this.renderers.get(this.activeRendererId)!;
        return Object.keys(renderer.exportTargets || {});
    }

    getAvailableBuffers(): string[] {
        if (!this.activeRendererId) return [];
        const renderer = this.renderers.get(this.activeRendererId)!;
        return renderer.pipeline.framebuffers.map(fb => fb.id);
    }

    // -- Environment Loading --

    /**
     * Load a Radiance .hdr file into the texture registry under the CALLER-provided
     * extern names (E6: the compiler/app own naming; the engine registers blindly). No binding happens here: the executor
     * binds `extern:` pass inputs to units per pass (§2.10 — the old per-program
     * bind-at-load path was the blind-executor violation; deleted in env-as-light T1).
     * Returns the env metadata so the app can set the `env.*` parameters.
     */
    async loadEnvironmentHDR(path: string, names: { map: string; cond: string; marg: string }): Promise<{ width: number; height: number; totalWeight: number; data: Float32Array }> {
        const envData = await this.hdrLoader.loadEnvironmentHDR(path, names);
        return { width: envData.width, height: envData.height, totalWeight: envData.totalWeight, data: envData.data };
    }

    /**
     * Register a tabulated environment from raw RGB data (T4: the app's bake readback) —
     * builds the CDF textures into the extern registry exactly like the HDR-load path.
     * The radiance table itself is NOT registered: a procedural env direct-evals its
     * formula; the table exists only as CDF food.
     */
    /**
     * Register a generic RGBA32F data texture under `name`, bindable via `extern:<name>`
     * (impl-plan-meshes). NEAREST/CLAMP, texelFetch-ready. The engine stays scene-agnostic —
     * the app computes the payload (e.g. packed mesh geometry) and owns the extern name;
     * the registry replaces (and disposes) any prior texture of the same name.
     */
    registerDataTexture(name: string, data: Float32Array, width: number, height: number): void {
        const factory = new TextureFactory(this.gl);
        this.textureRegistry.register(name, factory.createRGBA32F(data, width, height));
    }

    /** Integer sibling of registerDataTexture (RGBA32UI / usampler2D) — bit-packed
     *  payloads never ride float textures (fable-accel-cwbvh §6). */
    registerDataTextureU32(name: string, data: Uint32Array, width: number, height: number): void {
        const factory = new TextureFactory(this.gl);
        this.textureRegistry.register(name, factory.createRGBA32UI(data, width, height));
    }

    registerEnvironmentTable(
        rgb: Float32Array,
        width: number,
        height: number,
        opts: { names: { map: string; cond: string; marg: string }; chart?: string; compensation?: boolean },
    ): { totalWeight: number } {
        const result = buildEnvironmentSampler(
            this.gl, this.textureRegistry, rgb, width, height,
            opts.names, { chart: opts.chart, compensation: opts.compensation });
        return { totalWeight: result.totalWeight };
    }

    // -- Cleanup --

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

    private _handleContextLoss(): void {
        console.warn('WebGL context lost — GPU resources invalidated; will rebuild on restore');

        // Remember what was active so we can re-select after the rebuild.
        this.lostActiveRendererId = this.activeRendererId;
        this.state = 'context-lost';

        // Every GPU handle (programs, framebuffers, textures, uniform locations) is
        // now dead. Drop them all. The CompiledRenderer data in `this.renderers` is
        // pure data and survives — it's what we rebuild from on restore.
        this.renderExecutor.invalidate();
        this.resourceManager.handleContextLoss();
        this.textureRegistry.handleContextLoss();
        this.parameterManager.reset();
        this.activeRendererId = null;
    }

    private _handleContextRestored(): void {
        console.log('WebGL context restored — rebuilding GPU resources');

        // Rebuild every renderer from its retained CompiledRenderer. loadRenderer
        // recompiles shaders and recreates framebuffers/textures; clear the data
        // map first so it re-populates cleanly (fresh, zeroed accumulation).
        const renderers = Array.from(this.renderers.values());
        this.renderers.clear();
        this.sampleCounts.clear();

        try {
            // Extension state resets on context loss — re-enable before rebuilding
            // float framebuffers, or they come back INCOMPLETE_ATTACHMENT.
            this.resourceManager.enableRequiredExtensions();
            // The engine's own global texture (the display pass binds it every frame).
            registerBlueNoise(this.gl, this.textureRegistry);

            for (const renderer of renderers) {
                this.loadRenderer(renderer.id, renderer);
            }

            const toSelect = this.lostActiveRendererId && this.renderers.has(this.lostActiveRendererId)
                ? this.lostActiveRendererId
                : renderers[0]?.id;

            if (toSelect) {
                this.selectRenderer(toSelect);
                this.state = 'running';
            } else {
                this.state = 'ready';
            }
        } catch (error) {
            console.error('Failed to rebuild after context restore:', error);
            this.state = 'error';
        }

        this.lostActiveRendererId = null;

        // External textures (scene data, environment) and parameter values are the caller's:
        // the engine never kept their sources.
        if (this.state !== 'error') this.onContextRestored?.();
    }
}
