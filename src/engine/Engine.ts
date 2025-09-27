import { ModuleRegistry } from './ModuleRegistry.js';
import { ShaderCompiler } from './ShaderCompiler.js';
import { RenderExecutor } from './RenderExecutor.js';
import type { ModuleDescriptor, EngineState } from './types.js';
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

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.registry = new ModuleRegistry();
        this.compiler = new ShaderCompiler(gl);
        this.executor = new RenderExecutor(gl);
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
        this.executor.execute();
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
