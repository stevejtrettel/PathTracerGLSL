import { ModuleRegistry } from './ModuleRegistry.js';
import { ShaderCompiler } from './ShaderCompiler.js';
import { RenderExecutor } from './RenderExecutor.js';
import type { ModuleDescriptor, EngineState } from './types.js';
import type { ParameterChanges } from '../app/types.js';

/**
 * Minimal Engine for Phase 2
 * Orchestrates subsystems and provides the real parameter interface
 * Architecturally correct but minimal implementation
 */
class Engine {
    private gl: WebGL2RenderingContext;
    private registry: ModuleRegistry;
    private compiler: ShaderCompiler;
    private executor: RenderExecutor;

    private state: EngineState = 'ready';

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;

        // Initialize subsystems in dependency order
        this.registry = new ModuleRegistry();
        this.compiler = new ShaderCompiler(gl);  // Pass gl context
        this.executor = new RenderExecutor(gl);

        console.log('Engine: Subsystems initialized');
    }

    /**
     * Load modules and compile them (Phase 2: simple version of recipe system)
     */
    loadModules(modules: ModuleDescriptor[]): void {
        if (this.state !== 'ready') {
            throw new Error(`Cannot load modules in state: ${this.state}`);
        }

        // Register modules
        for (const module of modules) {
            this.registry.register(module);
        }

        // Compile to GLSL
        const fragmentSource = this.compiler.compile(modules);

        // Load into executor and get program reference
        this.executor.loadShader(fragmentSource);

        // Give compiler access to the program for uniform management
        const program = this.getCompiledProgram();
        this.compiler.setActiveProgram(program);

        // Transition to running state
        this.state = 'running';

        console.log(`Engine: ${modules.length} modules loaded and compiled`);
    }

    /**
     * Update parameters from ParameterStore
     * This is the key interface that establishes the real architecture
     */
    updateParameters(changes: ParameterChanges): void {
        if (this.state !== 'running') {
            console.warn('Engine: Cannot update parameters - not running');
            return;
        }

        // Delegate uniform management to compiler (correct architecture)
        this.compiler.updateUniforms(changes);
    }

    /**
     * Get compiled program from executor
     * Phase 2: Simple access, will be cleaner in full system
     */
    private getCompiledProgram(): WebGLProgram {
        // Access executor's program for uniform management
        const program = (this.executor as any).program;
        if (!program) {
            throw new Error('No compiled program available');
        }
        return program;
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
     * Get current engine state
     */
    getState(): EngineState {
        return this.state;
    }

    /**
     * Check if ready to load modules
     */
    isReady(): boolean {
        return this.state === 'ready';
    }

    /**
     * Check if running and can render
     */
    isRunning(): boolean {
        return this.state === 'running';
    }

    /**
     * Convert parameter path to uniform name
     * Phase 2: Simple mapping, will become sophisticated later
     */
    private pathToUniform(path: string): string {
        // Simple conversion: camera.position → u_camera_position
        return 'u_' + path.replace('.', '_');
    }
}

export { Engine };
