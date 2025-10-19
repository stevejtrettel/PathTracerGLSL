// app/App.ts
import { Engine } from '../engine/Engine';
import { ParameterStore } from './ParameterStore';
import { FrameStats } from './FrameStats';
import type { Recipe } from '../engine/types';

/**
 * App manages the render loop and user interactions
 * Recipes are provided externally for flexibility
 */
class App {
    engine: Engine;  // Made public for main.ts access
    parameterStore: ParameterStore;  // Made public for main.ts access
    private frameStats: FrameStats;
    private renderLoopId: number | null = null;
    private currentRecipeId: string | null = null;

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
        this.frameStats = new FrameStats();

        // Set initial resolution
        this.frameStats.setResolution(canvas.width, canvas.height);

        // Wire parameter store to engine
        this.parameterStore.onChange = (changes) => {
            this.engine.updateParameters(changes);
        };
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

        // 4. Start rendering
        this.startRenderLoop();

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
            }
        });
    }

    /**
     * Switch to a different recipe
     */
    switchRecipe(recipeId: string): void {
        if (recipeId === this.currentRecipeId) return;

        console.log(`Switching to recipe: ${recipeId}`);
        this.engine.selectRecipe(recipeId);
        this.currentRecipeId = recipeId;

        // Re-send all parameters to the new recipe's program
        this.parameterStore.resendAll();
    }

    /**
     * Reset accumulation for active recipe
     */
    resetAccumulation(): void {
        console.log('Resetting accumulation');
        this.engine.clearAccumulation();
        this.parameterStore.set('accumulator.reset', true);
    }

    /**
     * Handle window/canvas resize
     */
    handleResize(width: number, height: number): void {
        this.frameStats.setResolution(width, height);
        this.parameterStore.set('resolution', [width, height]);
        // TODO: ResourceManager resize if needed
    }

    /**
     * Start render loop
     */
    private startRenderLoop(): void {
        // Initial reset
        this.resetAccumulation();

        const loop = () => {
            // Turn off reset after first frame
            if (this.engine.sampleCount === 1) {
                this.parameterStore.set('accumulator.reset', false);
            }

            this.render();

            // Update frame stats
            this.frameStats.update(this.engine.sampleCount);

            this.renderLoopId = requestAnimationFrame(loop);
        };

        loop();
    }

    /**
     * Stop render loop
     */
    stopRenderLoop(): void {
        if (this.renderLoopId) {
            cancelAnimationFrame(this.renderLoopId);
            this.renderLoopId = null;
        }
    }

    /**
     * Render one frame
     */
    private render(): void {
        this.engine.renderFrame();
    }

    /**
     * Clean up resources
     */
    dispose(): void {
        this.stopRenderLoop();
        this.frameStats.dispose();
        this.engine.dispose();
    }
}

export { App };
