import { ModuleRegistry } from './ModuleRegistry.js';
import { ShaderCompiler } from './ShaderCompiler.js';
import { RenderExecutor } from './RenderExecutor.js';
import type { ModuleDescriptor, EngineState, EngineUniforms } from './types.js';
import type { ParameterChanges } from '../app/types.js';
import { ResourceManager } from './ResourceManager.js';

/**
 * Engine orchestrates subsystems for modular rendering
 */
class Engine {
    private gl: WebGL2RenderingContext;
    private registry: ModuleRegistry;
    private compiler: ShaderCompiler;
    private executor: RenderExecutor;
    private resources: ResourceManager;
    private state: EngineState = 'ready';

    // Engine state tracking
    private time: number = 0;
    private frameCount: number = 0;
    private sampleCount: number = 0;
    private startTime: number;

    getTime(): number {
        return this.time;
    }

    getSampleCount(): number {
        return this.sampleCount;
    }

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.registry = new ModuleRegistry();
        this.compiler = new ShaderCompiler(gl);
        this.executor = new RenderExecutor(gl);
        this.resources = new ResourceManager(gl);
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

        // Compile BOTH shaders
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

        // Log debug info if available
        const debugInfo = this.compiler.getDebugInfo();
        if (debugInfo) {
            console.log('=== GENERATED FRAGMENT SHADER ===');
            console.log(debugInfo.numberedSource);
            console.log('=== END SHADER ===');
        }

        // Pass BOTH programs to RenderExecutor
        this.executor.setPrograms(mainProgram, displayProgram);

        // Set up uniform management for main program
        this.compiler.setActiveProgram(mainProgram);

        // Bind texture uniform for accumulator
        this.gl.useProgram(mainProgram);
        const textureLoc = this.gl.getUniformLocation(mainProgram, 'u_accumulator_radiance_previous');
        if (textureLoc) {
            this.gl.uniform1i(textureLoc, 0);
            console.log('Bound accumulator texture to unit 0');
        }

        this.state = 'running';
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
        this.state = 'ready';
    }

    clearUniformCache(): void {
        this.compiler.clearCache();
    }
}

export { Engine };
