// app/App.ts
import { Engine } from '../engine/Engine';
import { ParameterStore } from './ParameterStore';
import { RenderCoordinator } from './RenderCoordinator';
import { EventBus } from './EventBus';
import { SessionManager } from './SessionManager';
import { TiledRenderer } from './TiledRenderer';
import type { Recipe, ModuleDescriptor } from '../engine/types';
import type { Extension, ParameterMetadata } from './types';

/**
 * App - High-level orchestration and user interaction
 *
 * Core responsibilities:
 * - Coordinate Engine, ParameterStore, RenderCoordinator
 * - Manage recipe switching
 * - Provide extension system
 * - Handle keyboard controls and user input
 */
class App {
    // Core components (public for extensions)
    engine: Engine;
    parameterStore: ParameterStore;
    renderCoordinator: RenderCoordinator;
    sessionManager: SessionManager;
    tiledRenderer: TiledRenderer;
    bus: EventBus;

    // Extension system
    private extensions = new Map<string, Extension>();
    private services = new Map<string, any>();

    // Parameter metadata collected from modules
    private parameterMetadata = new Map<string, ParameterMetadata>();

    // Internal state
    private currentRecipeId: string | null = null;
    private isSwitchingRecipe = false;

    constructor(canvas: HTMLCanvasElement) {
        // Setup canvas
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const gl = canvas.getContext('webgl2', {
            antialias: false,
            preserveDrawingBuffer: true
        });

        if (!gl) {
            throw new Error('WebGL2 not supported');
        }

        // Create core components
        this.engine = new Engine(gl);
        this.parameterStore = new ParameterStore();
        this.bus = new EventBus();
        this.renderCoordinator = new RenderCoordinator(this.engine, this.bus);
        this.sessionManager = new SessionManager(this);
        this.tiledRenderer = new TiledRenderer(this);

        // Register services for extension discovery
        this.registerService('app', this);
        this.registerService('engine', this.engine);
        this.registerService('parameters', this.parameterStore);
        this.registerService('coordinator', this.renderCoordinator);
        this.registerService('session', this.sessionManager);
        this.registerService('tiler', this.tiledRenderer);

        // Wire parameter changes
        this.parameterStore.onChange = (changes) => {
            this.engine.updateParameters(changes);
            this.bus.emit('parameter.changed', changes);

            if (this.isSwitchingRecipe) return;

            const needsReset = changes.changes.some(
                change => this.renderCoordinator.shouldResetForParameter(change.path)
            );

            if (needsReset) {
                this.renderCoordinator.resetAccumulation('parameter_change');
            }
        };

        // Wire progress reporting
        this.renderCoordinator.onProgress = (info) => {
            this.bus.emit('render.progress', info);

            if (info.state === 'complete') {
                console.log(`Render complete: ${info.samples} samples in ${(info.elapsedTime / 1000).toFixed(1)}s`);
                this.bus.emit('render.complete', info);
            }
        };
    }

    /**
     * Initialize app with recipes and optional environment
     */
    async initialize(
        recipes: Recipe[],
        environmentHDR?: string,
        initialParameters?: Record<string, any>
    ): Promise<void> {
        if (recipes.length === 0) {
            throw new Error('At least one recipe required');
        }

        // Collect parameter metadata from all modules
        this.collectParameterMetadata(recipes);

        // Initialize engine
        this.engine.initialize(recipes);
        this.currentRecipeId = recipes[0].id;

        // Load environment if provided
        if (environmentHDR) {
            await this.engine.loadEnvironmentHDR(environmentHDR);
        }

        // Initialize parameters with defaults, then apply overrides
        this.initializeParameters(initialParameters);

        // Start rendering
        this.renderCoordinator.startInteractive();
        this.bus.emit('render.started');

        console.log('App initialized with recipes:', this.engine.getAvailableRecipes());
        console.log('Parameter metadata collected:', this.parameterMetadata.size, 'parameters');
    }

    /**
     * Setup keyboard controls
     */
    setupKeyboardControls(recipeKeys?: Record<string, string>): void {
        window.addEventListener('keydown', (e) => {
            // Recipe switching (1-9 keys or custom mapping)
            if (recipeKeys && recipeKeys[e.key]) {
                this.switchRecipe(recipeKeys[e.key]);
            } else if (e.key >= '1' && e.key <= '9') {
                const recipes = this.engine.getAvailableRecipes();
                const index = parseInt(e.key) - 1;
                if (index < recipes.length) {
                    this.switchRecipe(recipes[index]);
                }
            }

            // Rendering controls
            else if (e.key === 'r' || e.key === 'R') {
                this.resetAccumulation();
            }
            else if (e.key === ' ') {
                this.toggleRendering();
            }
            else if (e.key === 'p' || e.key === 'P') {
                e.preventDefault();
                this.startProductionRender();
            }
            else if (e.key === '\\') {
                // Toggle pause/resume
                if (this.renderCoordinator.isPaused()) {
                    this.resume();
                } else {
                    this.pause();
                }
            }
            else if (e.key === 'Escape') {
                this.stop();
            }

            // Session management
            else if (e.key === 'j' || e.key === 'J') {
                e.preventDefault();
                this.sessionManager.quickSave();
            }
            else if (e.key === 'o' || e.key === 'O') {
                e.preventDefault();
                this.loadSessionFromFile();
            }

            // Tiled rendering
            else if (e.key === 't' || e.key === 'T') {
                e.preventDefault();
                this.startTileJob();
            }
        });
    }

    /**
     * Switch to a different recipe
     */
    switchRecipe(recipeId: string): void {
        if (recipeId === this.currentRecipeId) return;

        console.log(`Switching to recipe: ${recipeId}`);

        //Block during production
        if (this.renderCoordinator.isLocked()) {
            console.warn('⚠️ Cannot switch recipes during production render');
            return;
        }

        this.isSwitchingRecipe = true;
        this.engine.selectRecipe(recipeId);
        this.currentRecipeId = recipeId;
        this.parameterStore.resendAll();
        this.isSwitchingRecipe = false;

        this.bus.emit('recipe.switched', { recipeId });
    }

    /**
     * Reset accumulation
     */
    resetAccumulation(): void {
        this.renderCoordinator.resetAccumulation('manual');
    }

    /**
     * Toggle rendering on/off
     */
    toggleRendering(): void {
        if (this.renderCoordinator.isRunning()) {
            this.renderCoordinator.stop();
            // this.bus.emit('render.stopped');
        } else {
            this.renderCoordinator.startInteractive();
            // this.bus.emit('render.started');
        }
    }

    /**
     * Handle canvas resize
     */
    handleResize(width: number, height: number): void {
        if (this.renderCoordinator.isLocked()) {
            console.warn('⚠️ Ignoring resize during production render');
            return;
        }

        const canvas = this.engine['gl'].canvas as HTMLCanvasElement;
        canvas.width = width;
        canvas.height = height;

        this.engine.resize(width, height);
        this.parameterStore.set('resolution', [width, height]);
        this.renderCoordinator.resetAccumulation('resize');
    }

    // ============================================================================
    // Rendering API
    // ============================================================================

    /**
     * Start interactive rendering (continuous, unlocked)
     */
    renderInteractive(): void {
        this.renderCoordinator.startInteractive();
    }

    /**
     * Render to completion (goal-driven, locked)
     * Always resets accumulation before starting
     */
    async renderProduction(targetSamples: number): Promise<void> {
        // Reset via coordinator (no parameter tricks)
        this.renderCoordinator.resetAccumulation('production_start');

        // Lock controls
        this.parameterStore.lock();

        try {
            await this.renderCoordinator.startProduction({
                targetSamples,
                onProgress: (info) => {
                    if (info.samples % 100 === 0) {
                        const pct = info.percentComplete?.toFixed(1) || '0.0';
                        console.log(`Progress: ${info.samples}/${targetSamples} (${pct}%)`);
                    }
                }
            });

            console.log(`✓ Production complete: ${targetSamples} samples`);

            // Auto-save the production render before unlocking
            await this.saveProductionRender();

        } catch (error: any) {
            if (error.name === 'RenderStopped') {
                console.log('Production render was stopped');
            } else {
                console.error('Production render failed:', error);
                throw error;
            }
        } finally {
            this.parameterStore.unlock();

            // Resume interactive rendering after save completes
            console.log('Resuming interactive rendering...');
            this.renderCoordinator.startInteractive();
        }
    }

    private async saveProductionRender(): Promise<void> {
        const gl = this.engine['gl'];
        const width = gl.canvas.width;
        const height = gl.canvas.height;
        const sampleCount = this.engine.sampleCount;

        console.log(`Saving production render (${width}×${height}, ${sampleCount}spp)...`);

        // Read tone-mapped display pixels (PNG)
        const pixels = this.engine.readRGB();

        // Generate filename: production_YYYY_MMDD_HHMM_NNNNspp.png
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');

        const dateStr = `${month}${day}`;
        const timeStr = `${hours}${minutes}`;
        const filename = `production_${year}_${dateStr}_${timeStr}_${sampleCount}spp.png`;

        // Import the utility function
        const { savePNGFile } = await import('./utils/file-export.js');
        savePNGFile(pixels, width, height, filename);

        console.log(`✓ Saved ${filename}`);

        // Emit event so other extensions can react
        this.bus.emit('production.saved', { filename, width, height, sampleCount });
    }


    /**
     * Pause current rendering (any mode)
     */
    pause(): void {
        this.renderCoordinator.pause();
    }

    /**
     * Resume paused rendering
     */
    resume(): void {
        this.renderCoordinator.resume();
    }

    /**
     * Stop rendering completely
     */
    stop(): void {
        this.renderCoordinator.stop();
        this.parameterStore.unlock();  // Ensure unlocked
    }

    /**
     * Check if rendering is locked (production mode)
     */
    isLocked(): boolean {
        return this.renderCoordinator.isLocked();
    }

    // ============================================================================
    // Extension System
    // ============================================================================

    /**
     * Install an extension
     */
    use(extension: Extension): App {
        // Check dependencies
        for (const dep of extension.dependencies || []) {
            if (!this.extensions.has(dep)) {
                throw new Error(
                    `Extension '${extension.name}' requires '${dep}' to be installed first`
                );
            }
        }

        if (this.extensions.has(extension.name)) {
            throw new Error(`Extension '${extension.name}' is already installed`);
        }

        console.log(`Installing extension: ${extension.name}`);

        try {
            extension.install(this, this.bus);
            this.extensions.set(extension.name, extension);

            this.bus.emit('extension.installed', {
                name: extension.name,
                version: extension.version
            });
        } catch (error) {
            console.error(`Failed to install extension '${extension.name}':`, error);
            throw error;
        }

        return this;
    }

    /**
     * Register a service for extension discovery
     */
    registerService(name: string, service: any): void {
        if (this.services.has(name)) {
            console.warn(`Service '${name}' already registered, replacing`);
        }

        this.services.set(name, service);
        this.bus.emit('service.registered', { name });
    }

    /**
     * Get a registered service
     */
    getService<T = any>(name: string): T | undefined {
        return this.services.get(name);
    }

    /**
     * Check if a service is registered
     */
    hasService(name: string): boolean {
        return this.services.has(name);
    }

    /**
     * Get parameter metadata (for extensions)
     */
    getParameterMetadata(): Map<string, ParameterMetadata> {
        return this.parameterMetadata;
    }

    /**
     * Get metadata for a specific parameter
     */
    getParameterMeta(path: string): ParameterMetadata | undefined {
        return this.parameterMetadata.get(path);
    }

    /**
     * Clean up resources
     */
    dispose(): void {
        const extensions = Array.from(this.extensions.values()).reverse();
        for (const extension of extensions) {
            if (extension.uninstall) {
                try {
                    extension.uninstall();
                } catch (error) {
                    console.error(`Error uninstalling extension '${extension.name}':`, error);
                }
            }
        }

        this.renderCoordinator.stop();
        this.engine.dispose();
        this.bus.removeAllListeners();
    }

    // ============================================================================
    // Private: Parameter Metadata Collection
    // ============================================================================

    /**
     * Collect parameter metadata from all modules in all recipes
     */
    private collectParameterMetadata(recipes: Recipe[]): void {
        for (const recipe of recipes) {
            // Collect from world modules
            this.collectModuleMetadata(recipe.world.ambient);
            this.collectModuleMetadata(recipe.world.environment);
            this.collectModuleMetadata(recipe.world.scene);
            this.collectModuleMetadata(recipe.world.lighting);

            // Collect from optics modules
            this.collectModuleMetadata(recipe.optics.camera);
            this.collectModuleMetadata(recipe.optics.interaction);
            this.collectModuleMetadata(recipe.optics.transport);
            this.collectModuleMetadata(recipe.optics.accumulator);
            this.collectModuleMetadata(recipe.optics.developer);
        }
    }

    /**
     * Collect parameter metadata from a single module
     */
    private collectModuleMetadata(module: ModuleDescriptor): void {
        if (!module.parameters) return;

        for (const [path, meta] of Object.entries(module.parameters)) {
            // Enrich metadata with auto-inferred values
            const enriched: ParameterMetadata = {
                ...meta,
                name: meta.name ?? path,
                group: meta.group ?? this.inferGroup(path),
                triggersReset: meta.triggersReset ?? this.inferTriggersReset(path)
            };

            // Auto-calculate step if not provided and range exists
            if (!enriched.step && enriched.range) {
                const [min, max] = enriched.range;
                enriched.step = (max - min) / 100;
            }

            this.parameterMetadata.set(path, enriched);
        }
    }

    /**
     * Infer group from parameter path (camera.fov -> Camera)
     */
    private inferGroup(path: string): string {
        const prefix = path.split('.')[0];
        return prefix.charAt(0).toUpperCase() + prefix.slice(1);
    }

    /**
     * Infer if parameter triggers reset (developer.* doesn't reset)
     */
    private inferTriggersReset(path: string): boolean {
        return !path.startsWith('developer.') && !path.startsWith('debug.');
    }

    /**
     * Initialize parameters with defaults from metadata, then apply overrides
     */
    private initializeParameters(overrides?: Record<string, any>): void {
        const defaults: Record<string, any> = {};

        // Collect defaults from metadata
        for (const [path, meta] of this.parameterMetadata) {
            defaults[path] = meta.default;
        }

        // Apply defaults first
        this.parameterStore.batch(defaults);

        // Then apply user overrides
        if (overrides) {
            this.parameterStore.batch(overrides);
        }
    }

    // ============================================================================
    // Private: User Input Handlers
    // ============================================================================

    private startProductionRender(): void {
        const samples = parseInt(prompt('Target samples?', '1000') || '1000');
        if (samples > 0) {
            this.renderProduction(samples);
        }
    }

    private startTileJob(): void {
        const width = parseInt(prompt('Target width?', '3840') || '3840');
        const height = parseInt(prompt('Target height?', '2160') || '2160');
        const samples = parseInt(prompt('Samples per tile?', '1000') || '1000');

        this.tiledRenderer.startJob({
            targetWidth: width,
            targetHeight: height,
            targetTileSize: 512,
            samplesPerTile: samples,
            format: 'hdr'
        });
    }

    private loadSessionFromFile(): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
                try {
                    await this.sessionManager.loadFromFile(file);
                    console.log('✓ Session loaded successfully');
                } catch (error) {
                    console.error('Failed to load session:', error);
                    alert(`Failed to load session: ${error}`);
                }
            }
        };
        input.click();
    }
}

export { App };
