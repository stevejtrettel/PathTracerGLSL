// app/App.ts
import { Engine } from '../engine/Engine';
import { ParameterStore } from './ParameterStore';
import { FrameStats } from './FrameStats';
import { RenderCoordinator } from './RenderCoordinator';
import type { Recipe } from '../engine/types';

/**
 * App manages orchestration and user interactions
 * RenderCoordinator handles execution
 */
class App {
    engine: Engine;
    parameterStore: ParameterStore;
    renderCoordinator: RenderCoordinator;
    private frameStats: FrameStats;
    private currentRecipeId: string | null = null;
    private isSwitchingRecipe = false;  // Flag to prevent reset during recipe switch

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
        this.renderCoordinator = new RenderCoordinator(this.engine);
        this.frameStats = new FrameStats();

        // Set initial resolution
        this.frameStats.setResolution(canvas.width, canvas.height);

        // Wire parameter store to engine AND coordinator
        this.parameterStore.onChange = (changes) => {
            // Update uniforms
            this.engine.updateParameters(changes);

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
            // Update frame stats based on mode
            if (info.mode === 'progressive' || info.mode === 'production') {
                this.frameStats.update(info.samples || 0);
            }

            // Could add more sophisticated reporting here
            if (info.state === 'complete') {
                console.log(`Render complete: ${info.samples} samples in ${(info.elapsedTime! / 1000).toFixed(1)}s`);
            }
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

        // 4. Start rendering (via coordinator)
        this.renderCoordinator.start();

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
    }

    /**
     * Toggle rendering (pause/resume)
     */
    toggleRendering(): void {
        if (this.renderCoordinator.isRunning()) {
            this.renderCoordinator.stop();
        } else {
            this.renderCoordinator.start();
        }
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
     * Clean up resources
     */
    dispose(): void {
        this.renderCoordinator.stop();
        this.frameStats.dispose();
        this.engine.dispose();
    }
}

export { App };
