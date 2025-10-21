// engine/Engine.ts
import { ShaderCompiler } from './ShaderCompiler';
import { ParameterManager } from './ParameterManager';
import { RenderExecutor } from './RenderExecutor';
import { TextureRegistry } from './TextureRegistry';
import { HDRLoader } from './loaders/hdr-loader';
import { ResourceManager } from './ResourceManager';
import { TextureFactory } from './utils/TextureFactory';
import { buildEnvironmentSampler } from './loaders/build-environment-sampler';
import type { ModuleDescriptor, EngineState, Recipe } from './types';
import type { ParameterChanges } from '../app/types';

/**
 * Engine - Manages all GPU resources and rendering
 *
 * Responsibilities:
 * - Shader compilation and program management
 * - Per-recipe accumulator buffers
 * - Global texture registry (environment maps, etc.)
 * - Render execution
 * - Tiled rendering support (pixel offset, image size)
 *
 * Environment maps are global - loaded once, shared by all recipes.
 */
class Engine {
    private gl: WebGL2RenderingContext;
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

    // Composite program (shared across all recipes)
    private compositeProgram: WebGLProgram | null = null;

    // Time tracking
    private _time: number = 0;
    private startTime: number;

    // Tiled rendering state
    private pixelOffset: [number, number] = [0, 0];
    private imageSize: [number, number] = [0, 0];

    get time(): number {
        return this._time;
    }

    get sampleCount(): number {
        return this.resources.getSampleCount();
    }

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.compiler = new ShaderCompiler(gl);
        this.parameters = new ParameterManager(gl);
        this.resources = new ResourceManager(gl);
        this.textureRegistry = new TextureRegistry(gl, 1);
        this.executor = new RenderExecutor(gl, this.resources);
        this.startTime = performance.now();

        // Handle context loss
        gl.canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            this.handleContextLoss();
        });
    }

    /**
     * Initialize engine with recipes
     */
    initialize(recipes: Recipe[]): void {
        if (this.state !== 'ready') {
            throw new Error(`Cannot initialize in state: ${this.state}`);
        }

        if (recipes.length === 0) {
            throw new Error('At least one recipe required');
        }

        console.log(`Initializing ${recipes.length} recipes...`);

        // Compile all recipes (composite program is shared)
        for (const recipe of recipes) {
            this.recipes.set(recipe.id, recipe);

            const modules = this.extractModules(recipe);
            const { mainProgram, displayProgram, compositeProgram } = this.compiler.compile(modules);

            if (!mainProgram || !displayProgram || !compositeProgram) {
                throw new Error(`Failed to compile programs for recipe: ${recipe.id}`);
            }

            this.programs.set(recipe.id, { main: mainProgram, display: displayProgram });
            this.resources.setupAccumulationBuffers(recipe.id);

            // Store composite program (same for all recipes)
            if (!this.compositeProgram) {
                this.compositeProgram = compositeProgram;
                this.executor.setCompositeProgram(compositeProgram);
            }

            // Bind accumulator texture to unit 0
            this.gl.useProgram(mainProgram);
            const textureLoc = this.gl.getUniformLocation(mainProgram, 'u_accumulator_radiance_previous');
            if (textureLoc) {
                this.gl.uniform1i(textureLoc, 0);
            }
        }

        // Select first recipe
        this.selectRecipe(recipes[0].id);
        this.state = 'running';

        console.log(`Initialized with recipe: ${recipes[0].id}`);
    }

    /**
     * Switch to a different recipe
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

        const modules = this.extractModules(recipe);

        this.compiler.setActiveProgram(programs.main);
        this.executor.setPrograms(programs.main, programs.display);
        this.parameters.initialize(programs.main, modules);
        this.resources.setActiveRecipe(recipeId);

        this.activeRecipeId = recipeId;
        console.log(`Switched to recipe '${recipeId}'`);
    }

    /**
     * Load HDR environment map and build sampling CDFs
     */
    async loadEnvironmentHDR(path: string): Promise<void> {
        console.log(`Loading HDR environment: ${path}`);

        // Fetch and parse
        const res = await fetch(path);
        if (!res.ok) {
            throw new Error(`Failed to load HDR: ${res.status} ${res.statusText}`);
        }

        const buffer = await res.arrayBuffer();
        const hdr = HDRLoader.parse(buffer);
        const { width, height, data } = hdr;

        // Create texture
        const tf = new TextureFactory(this.gl);
        const envTex = tf.createRGB32F(data, width, height);
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

        // Bind to all recipe programs
        for (const [recipeId, programs] of this.programs.entries()) {
            this.bindEnvironmentTexturesToProgram(programs.main, width, height, built.totalWeight);
        }

        console.log(`HDR loaded: ${width}×${height} (CDFs built), bound to ${this.programs.size} recipe(s)`);
    }

    /**
     * Update shader uniforms from parameter changes
     */
    updateParameters(changes: ParameterChanges): void {
        if (this.state === 'running') {
            this.parameters.updateUniforms(changes);
        }
    }



    /**
     * Read HDR radiance output (RGBA32F)
     * Use for: EXR export, scientific analysis, compositing
     */
    readRadiance(rect?: { x: number; y: number; width: number; height: number }): Float32Array {
        return this.executor.readRadiance(rect);
    }

    /**
     * Read tone-mapped RGB output (RGBA8)
     * Use for: PNG/JPEG export, screenshots
     */
    readRGB(rect?: { x: number; y: number; width: number; height: number }): Uint8Array {
        return this.executor.readRGB(rect);
    }

    /**
     * Render one frame
     */
    renderFrame(): void {
        if (this.state !== 'running') {
            throw new Error(`Cannot render in state: ${this.state}`);
        }

        this.resources.prepareFrame();

        // Update engine uniforms
        this._time = (performance.now() - this.startTime) / 1000;
        const sampleCount = this.resources.getSampleCount();
        const width = this.gl.canvas.width;
        const height = this.gl.canvas.height;

        // Use imageSize for tiled rendering, otherwise use framebuffer size
        const imgSize: [number, number] = this.imageSize[0] > 0
            ? this.imageSize
            : [width, height];

        this.compiler.updateEngineUniforms({
            resolution: [width, height],
            imageSize: imgSize,
            frameIndex: sampleCount,
            time: this._time,
            sampleCount: sampleCount,
            pixelOffset: this.pixelOffset
        });

        // Execute rendering: Main → Display → Composite
        this.executor.executeMainPass();

        const radianceTexture = this.resources.getCurrentTexture();
        this.executor.executeDisplayPass(radianceTexture);

        this.executor.executeCompositePass();

        // Finalize
        this.resources.finalizeFrame();
        this.resources.incrementSampleCount();
    }

    /**
     * Resize framebuffers
     */
    resize(width: number, height: number): void {
        this.resources.resize(width, height);
        this.executor.resize(width, height);
    }

    /**
     * Get the canvas size
     */
    getCanvasSize(): [number, number] {
        return [this.gl.canvas.width, this.gl.canvas.height];
    }

    /**
     * Reset accumulation for active recipe
     */
    clearAccumulation(): void {
        this.resources.clearAccumulationBuffers();
        this.resources.resetSampleCount();
    }

    /**
     * Get available recipe IDs
     */
    getAvailableRecipes(): string[] {
        return Array.from(this.programs.keys());
    }

    /**
     * Get active recipe ID
     */
    getActiveRecipeId(): string | null {
        return this.activeRecipeId;
    }

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

    // ============================================================================
    // Tiled Rendering
    // ============================================================================

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

    // ============================================================================
    // Debugging
    // ============================================================================

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
    // Cleanup
    // ============================================================================

    /**
     * Dispose all resources
     */
    dispose(): void {
        this.executor.dispose();
        this.resources.dispose();
        this.textureRegistry.dispose();
        this.programs.clear();
        this.recipes.clear();
        this.activeRecipeId = null;
        this.compositeProgram = null;
        this.state = 'ready';
    }

    // ============================================================================
    // Private Helpers
    // ============================================================================

    private bindEnvironmentTexturesToProgram(
        program: WebGLProgram,
        width: number,
        height: number,
        totalWeight: number
    ): void {
        this.gl.useProgram(program);

        const locEnv = this.gl.getUniformLocation(program, 'u_env_map');
        if (locEnv) this.textureRegistry.bind('env_map', locEnv);

        const locCond = this.gl.getUniformLocation(program, 'u_env_cdf_conditional');
        if (locCond) this.textureRegistry.bind('env_cdf_cond', locCond);

        const locMarg = this.gl.getUniformLocation(program, 'u_env_cdf_marginal');
        if (locMarg) this.textureRegistry.bind('env_cdf_marg', locMarg);

        const locSize = this.gl.getUniformLocation(program, 'u_env_size');
        if (locSize) this.gl.uniform2f(locSize, width, height);

        const locTot = this.gl.getUniformLocation(program, 'u_env_totalWeight');
        if (locTot) this.gl.uniform1f(locTot, totalWeight);
    }

    private extractModules(recipe: Recipe): ModuleDescriptor[] {
        return [
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
    }

    private handleContextLoss(): void {
        console.error('WebGL context lost - rendering stopped');
        this.state = 'ready';
        this.resources.handleContextLoss();
    }
}

export { Engine };
