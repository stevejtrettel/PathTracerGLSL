import { ModuleRegistry } from './ModuleRegistry.js';
import { ShaderCompiler } from './ShaderCompiler.js';
import { RenderExecutor } from './RenderExecutor.js';
import type { ModuleDescriptor, EngineState, EngineUniforms } from './types.js';
import type { ParameterChanges } from '../app/types.js';

/**
 * Engine orchestrates subsystems for modular rendering
 */
class Engine {
    private gl: WebGL2RenderingContext;
    private registry: ModuleRegistry;
    private compiler: ShaderCompiler;
    private executor: RenderExecutor;
    private state: EngineState = 'ready';

    public readonly time: number = 0;

    // Engine state tracking
    private frameCount: number = 0;
    private startTime: number;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.registry = new ModuleRegistry();
        this.compiler = new ShaderCompiler(gl);
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

        // Compile modules to GLSL
        const fragmentSource = this.compiler.compile(modules);

        // Log the generated shader for debugging
        console.log('=== GENERATED FRAGMENT SHADER ===');
        console.log(fragmentSource);
        console.log('=== END SHADER ===');

        this.executor.loadShader(fragmentSource);

        // Set up uniform management
        const program = this.executor.getProgram();
        if (!program) {
            throw new Error('Failed to compile program');
        }
        this.compiler.setActiveProgram(program);

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

        // Update time property each frame
        (this as any).time = (performance.now() - this.startTime) / 1000;

        // Use the stored time for engine uniforms
        this.compiler.updateEngineUniforms({
            resolution: [this.gl.canvas.width, this.gl.canvas.height],
            frameIndex: this.frameCount,
            time: this.time
        });

        this.executor.execute();
        this.frameCount++;
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
        this.state = 'ready';
    }


}

export { Engine };
