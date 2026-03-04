// engine/Engine.ts — Manages GPU resources and rendering with flexible pipelines

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

type EngineState = 'ready' | 'running' | 'error';

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

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.resourceManager = new ResourceManager(gl);
        this.renderExecutor = new RenderExecutor(gl, this.resourceManager);
        this.parameterManager = new ParameterManager(gl);
        this.textureRegistry = new TextureRegistry(gl, 1);  // Reserve unit 0 for accumulator
        this.hdrLoader = new HDREnvironmentLoader(gl, this.textureRegistry);
        this.startTime = performance.now();

        this.profiler = new GPUProfiler(gl);
        this.renderExecutor.setProfiler(this.profiler);
        this.renderExecutor.setParameterManager(this.parameterManager);

        gl.canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            this._handleContextLoss();
        });
    }

    // -- Loading --

    loadRenderer(id: string, renderer: CompiledRenderer): void {
        if (this.renderers.has(id)) {
            console.log(`Renderer '${id}' already loaded, skipping`);
            return;
        }

        console.log(`Loading renderer '${id}'...`);

        const validation = validateCompiledRenderer(renderer);
        if (validation.hasErrors()) {
            console.error(new ConsoleReporter().formatBag(validation));
            throw new Error(`Renderer validation failed for '${id}'. See console for details.`);
        }
        if (validation.hasWarnings()) {
            console.warn(new ConsoleReporter().formatBag(validation));
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
        if (this.state !== 'running') throw new Error(`Cannot render in state: ${this.state}`);
        if (!this.activeRendererId) throw new Error('No active renderer');

        const renderer = this.renderers.get(this.activeRendererId)!;
        const sampleCount = this.sampleCounts.get(this.activeRendererId)!;

        this._time = (performance.now() - this.startTime) / 1000;
        const parameters = this._buildParameters(sampleCount);
        this.renderExecutor.executePipeline(renderer.pipeline, parameters);
        this.sampleCounts.set(this.activeRendererId, sampleCount + 1);
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
            'engine.frameIndex': sampleCount,
            'engine.time': this._time,
            'engine.sampleCount': sampleCount,
            'engine.pixelOffset': this.pixelOffset
        };

        for (const [name, value] of this.customParameters) {
            parameters[name] = value;
        }
        return parameters;
    }

    // -- Parameters --

    // Set a custom parameter (e.g. 'renderer.displayMode', 'scene.metallic')
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
        this.resourceManager.clearAllBuffers();
        this.parameterManager.clearCache();
    }

    resize(width: number, height: number): void {
        this.resourceManager.resize(width, height);
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
        const canvas = gl.canvas as HTMLCanvasElement;

        const r = rect || { x: 0, y: 0, width: canvas.width, height: canvas.height };
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

    async loadEnvironmentHDR(path: string): Promise<void> {
        const envData = await this.hdrLoader.loadEnvironmentHDR(path);

        for (const [, renderer] of this.renderers.entries()) {
            this._bindEnvironmentTexturesToRenderer(renderer, envData.width, envData.height, envData.totalWeight);
        }
    }

    private _bindEnvironmentTexturesToRenderer(
        renderer: CompiledRenderer,
        envWidth: number,
        envHeight: number,
        totalWeight: number
    ): void {
        const gl = this.gl;

        for (const [shaderId] of renderer.shaders) {
            const program = this.renderExecutor.getProgram(shaderId);
            if (!program) continue;

            gl.useProgram(program);

            const envMapLoc = gl.getUniformLocation(program, 'u_envMap');
            const envCdfCondLoc = gl.getUniformLocation(program, 'u_envCDFCond');
            const envCdfMargLoc = gl.getUniformLocation(program, 'u_envCDFMarg');

            if (envMapLoc) this.textureRegistry.bind('env_map', envMapLoc);
            if (envCdfCondLoc) this.textureRegistry.bind('env_cdf_cond', envCdfCondLoc);
            if (envCdfMargLoc) this.textureRegistry.bind('env_cdf_marg', envCdfMargLoc);

            const envSizeLoc = gl.getUniformLocation(program, 'u_envSize');
            const envWeightLoc = gl.getUniformLocation(program, 'u_envTotalWeight');

            if (envSizeLoc) gl.uniform2f(envSizeLoc, envWidth, envHeight);
            if (envWeightLoc) gl.uniform1f(envWeightLoc, totalWeight);
        }
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
        console.error('WebGL context lost - rendering stopped');
        this.state = 'ready';
        this.resourceManager.handleContextLoss();
    }
}
