// engine/Engine.ts
import { ModuleRegistry } from './ModuleRegistry.js';
import { ShaderCompiler } from './ShaderCompiler.js';
import { ParameterManager } from './ParameterManager.js';
import { RenderExecutor } from './RenderExecutor.js';
import { TextureRegistry } from './TextureRegistry.js';
import { HDRLoader } from './loaders/hdr-loader.js';
import type { ModuleDescriptor, EngineState, Recipe } from './types.js';
import type { ParameterChanges } from '../app/types.js';
import { ResourceManager } from './ResourceManager.js';
import { TextureFactory } from "./utils/TextureFactory.js";
import { buildEnvironmentSampler } from "./loaders/build-environment-sampler.js";

/**
 * Engine orchestrates subsystems for modular rendering with recipe-based configuration
 */
class Engine {
    private gl: WebGL2RenderingContext;
    private registry: ModuleRegistry;
    private compiler: ShaderCompiler;
    private parameters: ParameterManager;
    private executor: RenderExecutor;
    private resources: ResourceManager;
    private textureRegistry: TextureRegistry;
    private state: EngineState = 'ready';

    // Recipe management
    private programs = new Map<string, {
        main: WebGLProgram;
        display: WebGLProgram;
    }>();
    private recipes = new Map<string, Recipe>();
    private activeRecipeId: string | null = null;

    // Engine state tracking
    private _time: number = 0;
    private frameCount: number = 0;
    private startTime: number;

    get time(): number {
        return this._time;
    }

    get sampleCount(): number {
        return this.resources.getSampleCount();
    }

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.registry = new ModuleRegistry();
        this.compiler = new ShaderCompiler(gl);
        this.parameters = new ParameterManager(gl);
        this.resources = new ResourceManager(gl);
        this.textureRegistry = new TextureRegistry(gl, 1); // Reserve unit 0 for accumulator
        this.executor = new RenderExecutor(gl);
        this.startTime = performance.now();
    }

    /**
     * Register a single module for later use in recipes
     */
    registerModule(module: ModuleDescriptor): void {
        this.registry.register(module);
    }

    /**
     * Register multiple modules for later use in recipes
     */
    registerModules(modules: ModuleDescriptor[]): void {
        for (const module of modules) {
            this.registry.register(module);
        }
    }

    /**
     * Initialize engine with recipes (new primary initialization path)
     */
    initialize(recipes: Recipe[]): void {
        if (this.state !== 'ready') {
            throw new Error(`Cannot initialize in state: ${this.state}`);
        }

        if (recipes.length === 0) {
            throw new Error('At least one recipe required');
        }

        console.log(`Initializing ${recipes.length} recipes...`);

        // Compile all recipes eagerly
        for (const recipe of recipes) {
            // Store recipe for later access
            this.recipes.set(recipe.id, recipe);

            const modules = this.resolveModules(recipe);

            // Compile both shaders
            const { mainProgram, displayProgram } = this.compiler.compile(modules);

            if (!mainProgram) {
                throw new Error(`Failed to compile main program for recipe: ${recipe.id}`);
            }
            if (!displayProgram) {
                throw new Error(`Failed to compile display program for recipe: ${recipe.id}`);
            }

            // Store programs
            this.programs.set(recipe.id, { main: mainProgram, display: displayProgram });

            // Setup film buffers for this recipe
            this.resources.setupFilmBuffers(recipe.id);

            // Bind accumulator texture to unit 0
            this.gl.useProgram(mainProgram);
            const textureLoc = this.gl.getUniformLocation(mainProgram, 'u_accumulator_radiance_previous');
            if (textureLoc) {
                this.gl.uniform1i(textureLoc, 0);
            }
        }

        // Select first recipe automatically (this will initialize parameters)
        this.selectRecipe(recipes[0].id);

        this.state = 'running';
        console.log(`Initialized with recipe: ${recipes[0].id}`);
    }

    /**
     * Switch to a different recipe instantly (accumulation preserved per recipe)
     */
    selectRecipe(recipeId: string): void {
        const programs = this.programs.get(recipeId);
        if (!programs) {
            throw new Error(`Recipe not found: ${recipeId}`);
        }

        const recipe = this.recipes.get(recipeId);
        if (!recipe) {
            throw new Error(`Recipe metadata not found: ${recipeId}`);
        }

        // Resolve modules for this recipe
        const modules = this.resolveModules(recipe);

        // Set active programs
        this.compiler.setActiveProgram(programs.main);
        this.executor.setPrograms(programs.main, programs.display);

        // Re-initialize ParameterManager with this recipe's program
        // This ensures uniform bindings are correct for this recipe
        this.parameters.initialize(programs.main, modules);

        // Set active recipe in resources (switches film buffers)
        this.resources.setActiveRecipe(recipeId);

        // Update state
        this.activeRecipeId = recipeId;

        console.log(`Switched to recipe '${recipeId}'`);
    }

    /**
     * Get list of available recipe IDs
     */
    getAvailableRecipes(): string[] {
        return Array.from(this.programs.keys());
    }

    /**
     * Get currently active recipe ID
     */
    getActiveRecipeId(): string | null {
        return this.activeRecipeId;
    }

    /**
     * Load and bind an HDR environment map + build CDFs for importance sampling
     * Environment is global (shared by all recipes)
     */
    async loadEnvironmentHDR(path: string): Promise<void> {
        console.log(`Loading HDR environment: ${path}`);

        // 1) Fetch + parse HDR
        const res = await fetch(path);
        if (!res.ok) throw new Error(`Failed to load HDR: ${res.status} ${res.statusText}`);
        const buffer = await res.arrayBuffer();
        const hdr = HDRLoader.parse(buffer);
        const W = hdr.width, H = hdr.height;

        // 2) Create RGB32F texture
        const tf = new TextureFactory(this.gl);
        const envTex = tf.createRGB32F(hdr.data, W, H);

        // 3) Register in TextureRegistry
        this.textureRegistry.register('env_map', envTex);

        // 4) Build + register CDF textures for importance sampling
        const built = buildEnvironmentSampler(
            this.gl,
            this.textureRegistry,
            hdr.data,
            W,
            H,
            { map: 'env_map', cond: 'env_cdf_cond', marg: 'env_cdf_marg' }
        );

        // 5) Bind environment uniforms to ALL recipe programs
        for (const [recipeId, programs] of this.programs.entries()) {
            this.bindEnvironmentTexturesToProgram(programs.main, W, H, built.totalWeight);
        }

        console.log(`HDR loaded: ${W}×${H} (CDFs built), bound to ${this.programs.size} recipe(s)`);
    }

    /**
     * Update uniforms from parameter changes
     */
    updateParameters(changes: ParameterChanges): void {
        if (this.state === 'running') {
            this.parameters.updateUniforms(changes);
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

        // 2. Update engine uniforms (time, resolution, etc.)
        this._time = (performance.now() - this.startTime) / 1000;
        const sampleCount = this.resources.getSampleCount();
        this.compiler.updateEngineUniforms({
            resolution: [this.gl.canvas.width, this.gl.canvas.height],
            frameIndex: this.frameCount,
            time: this._time,
            sampleCount: sampleCount
        });

        // 3. Execute main pass (accumulate radiance)
        this.executor.executeMainPass();

        // 4. Execute display pass (tone map to screen)
        const radianceTexture = this.resources.getCurrentTexture();
        this.executor.executeDisplayPass(radianceTexture);

        // 5. Swap buffers for next frame
        this.resources.finalizeFrame();

        this.frameCount++;
        this.resources.incrementSampleCount();
    }

    /**
     * Reset accumulation buffers for active recipe
     */
    clearAccumulation(): void {
        this.resources.clearFilmBuffers();
        this.resources.resetSampleCount();
        this.frameCount = 0;
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
        this.programs.clear();
        this.recipes.clear();
        this.activeRecipeId = null;
        this.state = 'ready';
    }

    /**
     * Clear uniform cache
     */
    clearUniformCache(): void {
        this.parameters.clearUniformCache();
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { total: number; skipped: number; skipRate: number } {
        return this.parameters.getCacheStats();
    }

    // ============================================================================
    // Private Helpers
    // ============================================================================

    /**
     * Bind environment textures and uniforms to a specific program
     */
    private bindEnvironmentTexturesToProgram(
        program: WebGLProgram,
        width: number,
        height: number,
        totalWeight: number
    ): void {
        this.gl.useProgram(program);

        // Bind environment map texture
        const locEnv = this.gl.getUniformLocation(program, 'u_env_map');
        if (locEnv) this.textureRegistry.bind('env_map', locEnv);

        // Bind CDF textures
        const locCond = this.gl.getUniformLocation(program, 'u_env_cdf_conditional');
        if (locCond) this.textureRegistry.bind('env_cdf_cond', locCond);

        const locMarg = this.gl.getUniformLocation(program, 'u_env_cdf_marginal');
        if (locMarg) this.textureRegistry.bind('env_cdf_marg', locMarg);

        // Bind size uniform
        const locSize = this.gl.getUniformLocation(program, 'u_env_size');
        if (locSize) this.gl.uniform2f(locSize, width, height);

        // Bind total weight uniform
        const locTot = this.gl.getUniformLocation(program, 'u_env_totalWeight');
        if (locTot) this.gl.uniform1f(locTot, totalWeight);
    }

    /**
     * Resolve Recipe's ModuleReferences to actual ModuleDescriptors
     */
    private resolveModules(recipe: Recipe): ModuleDescriptor[] {
        const modules: ModuleDescriptor[] = [];

        // Resolve in MODULE_ORDER
        const refs = [
            recipe.world.ambient,
            recipe.world.environment,
            recipe.world.scene,
            recipe.world.lighting,
            recipe.optics.camera,
            recipe.optics.interaction,
            recipe.optics.transport,
            recipe.optics.accumulator,
            recipe.optics.developer
        ];

        for (const ref of refs) {
            const module = this.registry.get(ref.kind, ref.name);
            if (!module) {
                throw new Error(`Module not found: ${ref.kind}/${ref.name}`);
            }
            modules.push(module);
        }

        return modules;
    }
}

export { Engine };
