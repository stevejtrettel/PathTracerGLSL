// engine/Engine.ts
import { ModuleRegistry } from './ModuleRegistry.js';
import { ShaderCompiler } from './ShaderCompiler.js';
import { RenderExecutor } from './RenderExecutor.js';
import { TextureRegistry } from './TextureRegistry.js';
import { HDRLoader } from './loaders/hdr-loader.js';
import type { ModuleDescriptor, EngineState, EngineUniforms } from './types.js';
import type { ParameterChanges } from '../app/types.js';
import { ResourceManager } from './ResourceManager.js';
import { TextureFactory } from "./utils/TextureFactory";

/**
 * Engine orchestrates subsystems for modular rendering
 */
class Engine {
    private gl: WebGL2RenderingContext;
    private registry: ModuleRegistry;
    private compiler: ShaderCompiler;
    private executor: RenderExecutor;
    private resources: ResourceManager;
    private textureRegistry: TextureRegistry;
    private state: EngineState = 'ready';

    // Engine state tracking
    private time: number = 0;
    private frameCount: number = 0;
    private sampleCount: number = 0;
    private startTime: number;

    get time(): number {
        return this.time;
    }

    get sampleCount(): number {
        return this.sampleCount;
    }

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.registry = new ModuleRegistry();
        this.compiler = new ShaderCompiler(gl);
        this.resources = new ResourceManager(gl);
        this.textureRegistry = new TextureRegistry(gl, 1); // Reserve unit 0 for accumulator
        this.executor = new RenderExecutor(gl);
        this.startTime = performance.now();
    }

    /**
     * Load and compile modules
     */
    loadModules(modules: ModuleDescriptor[]): void {
        if (this.state !== 'ready') {
            throw new Error(`Cannot load modules in state: ${this.state}`);
        }

        // Register modules for validation
        for (const module of modules) {
            this.registry.register(module);
        }

        // Compile both shaders
        this.compiler.compile(modules);

        // Get the main program for accumulation
        const mainProgram = this.compiler.getMainProgram();
        if (!mainProgram) {
            throw new Error('Failed to compile main program');
        }

        // Get the display program for tone mapping
        const displayProgram = this.compiler.getDisplayProgram();
        if (!displayProgram) {
            throw new Error('Failed to compile display program');
        }

        // Pass both programs to RenderExecutor
        this.executor.setPrograms(mainProgram, displayProgram);

        // Set up uniform management for main program
        this.compiler.setActiveProgram(mainProgram);

        // Bind accumulator texture to unit 0
        this.gl.useProgram(mainProgram);
        const textureLoc = this.gl.getUniformLocation(mainProgram, 'u_accumulator_radiance_previous');
        if (textureLoc) {
            this.gl.uniform1i(textureLoc, 0);
        }

        this.state = 'running';
    }

    /**
     * Load and bind an HDR environment map
     */
    async loadEnvironmentHDR(path: string): Promise<void> {
        console.log(`Loading HDR environment: ${path}`);

        // 1) Fetch + parse HDR
        const res = await fetch(path);
        if (!res.ok) throw new Error(`Failed to load HDR: ${res.status} ${res.statusText}`);
        const buffer = await res.arrayBuffer();
        const hdr = HDRLoader.parse(buffer); // { data: Float32Array, width, height }

        // 2) Create a single RGB32F texture via TextureFactory
        const tf = new TextureFactory(this.gl);
        const envTex = tf.createRGB32F(hdr.data, hdr.width, hdr.height);

        // 3) Register in the TextureRegistry under a stable name
        this.textureRegistry.register('env_map', envTex);

        // 4) Bind to u_env_map on the main program (if already linked)
        const program = this.compiler.getMainProgram();
        if (program) {
            this.gl.useProgram(program);
            const loc = this.gl.getUniformLocation(program, 'u_env_map');
            if (loc) this.textureRegistry.bind('env_map', loc);
        }

        console.log(`HDR loaded: ${hdr.width}×${hdr.height}`);
    }

    /**
     * Update uniforms from parameter changes
     */
    updateParameters(changes: ParameterChanges): void {
        if (this.state === 'running') {
            this.compiler.updateUniforms(changes);
        }
    }

    /**
     * Render one frame
     */
    renderFrame(): void {
        if (this.state !== 'running') {
            throw new Error(`Cannot render in state: ${this.state}`);
        }

        // 1. Prepare (bind previous texture, set render target)
        this.resources.prepareFrame();

        // 2. Update uniforms
        this.time = (performance.now() - this.startTime) / 1000;
        this.compiler.updateEngineUniforms({
            resolution: [this.gl.canvas.width, this.gl.canvas.height],
            frameIndex: this.frameCount,
            time: this.time,
            sampleCount: this.sampleCount
        });

        // 3. Execute main pass (accumulate radiance)
        this.executor.executeMainPass();

        // 4. Execute display pass (tone map to screen)
        const radianceTexture = this.resources.getCurrentTexture();
        this.executor.executeDisplayPass(radianceTexture);

        // 5. Swap buffers for next frame
        this.resources.finalizeFrame();

        this.frameCount++;
        this.sampleCount++;
    }

    /**
     * Reset accumulation buffers
     */
    clearAccumulation(): void {
        this.resources.clearFilmBuffers();
        this.frameCount = 0;
        this.sampleCount = 0;
    }

    /**
     * Get current state
     */
    getState(): EngineState {
        return this.state;
    }

    /**
     * State checks
     */
    isReady(): boolean {
        return this.state === 'ready';
    }

    isRunning(): boolean {
        return this.state === 'running';
    }

    /**
     * Clean up resources
     */
    dispose(): void {
        this.executor.dispose();
        this.resources.dispose();
        this.textureRegistry.dispose();
        this.state = 'ready';
    }

    /**
     * Clear uniform cache
     */
    clearUniformCache(): void {
        this.compiler.clearCache();
    }
}

export { Engine };
