// app/App.ts
import { Engine } from '../engine/Engine';
import { ParameterStore } from './ParameterStore';
import { RenderCoordinator } from './RenderCoordinator';
import { EventBus } from './EventBus';
import {SessionManager} from "./SessionManager";
import { TiledRenderer } from './TiledRenderer.js';

import type { Recipe } from '../engine/types';
import type { Extension } from './types';


/**
 * App manages orchestration and user interactions
 * RenderCoordinator handles execution
 * Extensions add features
 */
class App {
    // Core components (public for extensions)
    engine: Engine;
    parameterStore: ParameterStore;
    renderCoordinator: RenderCoordinator;
    sessionManager: SessionManager;
    tiledRenderer: TiledRenderer;

    // Extension system
    private bus: EventBus;
    private extensions = new Map<string, Extension>();
    private services = new Map<string, any>();

    // Internal components
    private currentRecipeId: string | null = null;
    private isSwitchingRecipe = false;

    constructor(canvas: HTMLCanvasElement) {
        // Set up canvas size
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const gl = canvas.getContext('webgl2', {
            antialias: false,
            preserveDrawingBuffer: true
        });

        if (!gl) {
            throw new Error('WebGL2 not supported');
        }

        // Create architecture components
        this.engine = new Engine(gl);
        this.parameterStore = new ParameterStore();


        this.bus = new EventBus();        // Create extension system


        this.sessionManager = new SessionManager(this);
        this.registerService('session', this.sessionManager);

        //coordinate rendering
        this.renderCoordinator = new RenderCoordinator(this.engine, this.bus);

        this.tiledRenderer = new TiledRenderer(this);




        // Register core services
        this.registerService('app', this);
        this.registerService('engine', this.engine);
        this.registerService('parameters', this.parameterStore);
        this.registerService('coordinator', this.renderCoordinator);
        this.registerService('tiler', this.tiledRenderer);


        // Wire parameter store to engine AND coordinator
        this.parameterStore.onChange = (changes) => {
            // Update uniforms
            this.engine.updateParameters(changes);

            // Emit parameter change event
            this.bus.emit('parameter.changed', changes);

            // Skip reset check if we're switching recipes
            if (this.isSwitchingRecipe) return;

            // Check if reset needed
            const needsReset = changes.changes.some(
                change => this.renderCoordinator.shouldResetForParameter(change.path)
            );

            if (needsReset) {
                this.renderCoordinator.resetAccumulation('parameter_change');
            }
        };

        // Wire progress reporting
        this.renderCoordinator.onProgress = (info) => {

            // Emit progress event for extensions
            this.bus.emit('render.progress', info);

            // Could add more sophisticated reporting here
            if (info.state === 'complete') {
                console.log(`Render complete: ${info.samples} samples in ${(info.elapsedTime! / 1000).toFixed(1)}s`);
                this.bus.emit('render.complete', info);
            }
        };
    }

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

        // Check for name collision
        if (this.extensions.has(extension.name)) {
            throw new Error(`Extension '${extension.name}' is already installed`);
        }

        // Install extension
        console.log(`Installing extension: ${extension.name}`);

        try {
            extension.install(this, this.bus);
            this.extensions.set(extension.name, extension);

            // Emit installation event
            this.bus.emit('extension.installed', {
                name: extension.name,
                version: extension.version
            });

        } catch (error) {
            console.error(`Failed to install extension '${extension.name}':`, error);
            throw error;
        }

        return this; // For chaining
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
     * Initialize app with recipes
     */
    async initialize(
        recipes: Recipe[],
        environmentHDR?: string,
        initialParameters?: Record<string, any>
    ): Promise<void> {
        if (recipes.length === 0) {
            throw new Error('At least one recipe required');
        }

        // 1. Initialize engine with recipes
        this.engine.initialize(recipes);
        this.currentRecipeId = recipes[0].id;

        // 2. Load HDR environment if provided (global, shared by all recipes)
        if (environmentHDR) {
            await this.engine.loadEnvironmentHDR(environmentHDR);
        }

        // 3. Setup parameters if provided
        if (initialParameters) {
            this.parameterStore.batch(initialParameters);
        }

        // 4. Start rendering (via coordinator)
        this.renderCoordinator.start();
        this.bus.emit('render.started');

        console.log('App initialized with recipes:', this.engine.getAvailableRecipes());
    }

    /**
     * Setup keyboard controls for recipe switching
     */
    setupKeyboardControls(recipeKeys?: Record<string, string>): void {
        window.addEventListener('keydown', (e) => {
            // Default: 1, 2, 3... for recipes
            if (recipeKeys && recipeKeys[e.key]) {
                this.switchRecipe(recipeKeys[e.key]);
            } else if (e.key >= '1' && e.key <= '9') {
                const recipes = this.engine.getAvailableRecipes();
                const index = parseInt(e.key) - 1;
                if (index < recipes.length) {
                    this.switchRecipe(recipes[index]);
                }
            } else if (e.key === 'r' || e.key === 'R') {
                this.resetAccumulation();
            } else if (e.key === ' ') {
                // Spacebar to pause/resume
                this.toggleRendering();
            }
            else if (e.key === 'p' || e.key === 'P') {
                this.testPixelReadback();
            }

            //J = save session
            else if (e.key === 'j' || e.key === 'J') {
                e.preventDefault();
                this.sessionManager.quickSave();
            }

            // O - Load session
            else if (e.key === 'o' || e.key === 'O') {
                e.preventDefault();
                this.loadSessionFromFile();
            }

        });
    }

    /**
     * Switch to a different recipe
     */
    switchRecipe(recipeId: string): void {
        if (recipeId === this.currentRecipeId) return;

        console.log(`Switching to recipe: ${recipeId}`);

        // Set flag to prevent reset during parameter resend
        this.isSwitchingRecipe = true;

        this.engine.selectRecipe(recipeId);
        this.currentRecipeId = recipeId;

        // Re-send all parameters to the new recipe's program
        this.parameterStore.resendAll();

        // Clear flag
        this.isSwitchingRecipe = false;

        // Emit recipe switch event
        this.bus.emit('recipe.switched', { recipeId });
    }

    /**
     * Reset accumulation for active recipe
     */
    resetAccumulation(): void {
        this.renderCoordinator.resetAccumulation('manual');
        this.parameterStore.set('accumulator.reset', true);

        // Turn off reset flag after a moment
        setTimeout(() => {
            this.parameterStore.set('accumulator.reset', false);
        }, 100);

        // Emit reset event
        this.bus.emit('accumulation.reset');
    }

    /**
     * Toggle rendering (pause/resume)
     */
    toggleRendering(): void {
        if (this.renderCoordinator.isRunning()) {
            this.renderCoordinator.stop();
            this.bus.emit('render.stopped');
        } else {
            this.renderCoordinator.start();
            this.bus.emit('render.started');
        }
    }

    /**
     * Handle window/canvas resize
     */
    handleResize(width: number, height: number): void {
        const canvas = this.engine['gl'].canvas as HTMLCanvasElement;
        canvas.width = width;
        canvas.height = height;

        this.engine.resize(width, height);  // Cleaner!
        this.parameterStore.set('resolution', [width, height]);
        this.renderCoordinator.resetAccumulation('resize');
    }

    /**
     * Clean up resources
     */
    dispose(): void {
        // Uninstall extensions in reverse order
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

    private testPixelReadback(): void {
        console.log('=== Testing Pixel Readback ===');

        const executor = this.engine['executor'];
        const gl = this.engine['gl'];
        const width = gl.canvas.width;
        const height = gl.canvas.height;

        // Test 1: Read HDR radiance
        console.log('\n1. Reading HDR radiance from accumulator...');
        const radiance = executor.readRadiance();
        const radiancePixelCount = radiance.length / 4;
        console.log(`✓ Read ${radiancePixelCount} pixels (${width}×${height})`);
        console.log('  First pixel RGBA:', radiance.slice(0, 4));

        // Find max without spread operator
        let maxRadiance = 0;
        for (let i = 0; i < radiance.length; i++) {
            if (radiance[i] > maxRadiance) maxRadiance = radiance[i];
        }
        console.log('  Max value:', maxRadiance);
        console.log('  Data size:', (radiance.length * 4 / 1024 / 1024).toFixed(2), 'MB');

        // Test 2: Read LDR display
        console.log('\n2. Reading LDR display from screen...');
        const display = executor.readDisplay();
        const displayPixelCount = display.length / 4;
        console.log(`✓ Read ${displayPixelCount} pixels (${width}×${height})`);
        console.log('  First pixel RGBA:', display.slice(0, 4));

        // Find max without spread operator
        let maxDisplay = 0;
        for (let i = 0; i < display.length; i++) {
            if (display[i] > maxDisplay) maxDisplay = display[i];
        }
        console.log('  Max value:', maxDisplay, '(should be ≤255)');
        console.log('  Data size:', (display.length / 1024 / 1024).toFixed(2), 'MB');

        console.log('\n=== Readback Test Complete ===');
    }

    // ADD: File picker for loading
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
