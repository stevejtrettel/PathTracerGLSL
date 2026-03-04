// app/RendererManager.ts
// Manages compiled renderers: compilation, switching, and metadata

import type { ICompiler, CompiledRenderer, SceneDescription, RenderStrategy } from '../compiler/types.js';
import type { Engine } from '../engine/Engine.js';
import type { ParameterStore } from './ParameterStore.js';
import type { EventBus } from './EventBus.js';
import type { AppConfig, StrategyPreset } from './types.js';
import type { ParameterMetadata } from './types.js';
import { AppEvents } from './events.js';

export interface RendererManagerDeps {
    compiler: ICompiler;
    engine: Engine;
    parameterStore: ParameterStore;
    eventBus: EventBus;
}

/**
 * RendererManager - Manages compiled renderer lifecycle
 *
 * Handles:
 * - Compiling scenes with multiple strategies
 * - Loading renderers into the engine
 * - Switching between renderers with parameter persistence
 * - Providing renderer metadata for UI generation
 */
export class RendererManager {
    private compiler: ICompiler;
    private engine: Engine;
    private parameterStore: ParameterStore;
    private eventBus: EventBus;

    // State
    private scene: SceneDescription | null = null;
    private strategies: Map<string, RenderStrategy> = new Map();
    private renderers: Map<string, CompiledRenderer> = new Map();
    private activeRendererId: string | null = null;

    constructor(deps: RendererManagerDeps) {
        this.compiler = deps.compiler;
        this.engine = deps.engine;
        this.parameterStore = deps.parameterStore;
        this.eventBus = deps.eventBus;
    }

    /**
     * Compile and load all strategy combinations
     *
     * Returns after compilation and engine loading. Does NOT handle
     * environment HDR loading (that stays in App).
     */
    async initialize(config: AppConfig): Promise<void> {
        const { scene, strategies, initialParameters } = config;

        if (strategies.length === 0) {
            throw new Error('At least one strategy required');
        }

        this.scene = scene;
        console.log(`Initializing renderers for scene: ${scene.id}`);

        // Compile all strategies
        const compiledRenderers: CompiledRenderer[] = [];

        for (const strategy of strategies) {
            console.log(`  Compiling strategy: ${strategy.id}`);
            const renderer = this.compiler.compile(scene, strategy);
            compiledRenderers.push(renderer);
            this.strategies.set(strategy.id, strategy);
            this.renderers.set(renderer.id, renderer);
        }

        // Load all renderers into engine
        this.engine.loadRenderers(compiledRenderers);

        // Select first renderer
        const firstRenderer = compiledRenderers[0];
        this.engine.selectRenderer(firstRenderer.id);
        this.activeRendererId = firstRenderer.id;

        // Apply initial parameters if provided (via store for change notification)
        if (initialParameters) {
            this.parameterStore.batch(initialParameters);
        }

        console.log(`Initialized ${compiledRenderers.length} renderers`);
        console.log(`  Available: ${this.getAvailableRendererIds().join(', ')}`);
    }

    /**
     * Initialize with strategy presets (convenience method)
     */
    async initializeWithPresets(
        scene: SceneDescription,
        presetIds: string[],
        presets: Record<string, StrategyPreset> = {}
    ): Promise<void> {
        const strategies = presetIds.map(id => {
            const preset = presets[id];
            if (!preset) {
                throw new Error(`Unknown strategy preset: ${id}`);
            }
            return preset.strategy;
        });

        await this.initialize({ scene, strategies });
    }

    /**
     * Switch to a different renderer
     *
     * Preserves parameter values across the switch using ParameterStore.
     */
    selectRenderer(rendererId: string): void {
        if (rendererId === this.activeRendererId) {
            return;
        }

        if (!this.renderers.has(rendererId)) {
            console.warn(`Unknown renderer: ${rendererId}`);
            return;
        }

        // Switch renderer in engine
        this.engine.selectRenderer(rendererId);
        this.activeRendererId = rendererId;

        // Re-send all parameters to the new renderer (parameter persistence)
        // This bypasses accumulation reset since it's a renderer switch
        this.parameterStore.resendAll();

        // Reset accumulation for new renderer
        this.engine.clearAccumulation();

        console.log(`Switched to renderer: ${rendererId}`);

        // Emit event
        this.eventBus.emit(AppEvents.RENDERER_SWITCHED, { rendererId });
    }

    /**
     * Select renderer by strategy ID (convenience)
     */
    selectRendererByStrategy(strategyId: string): void {
        if (!this.scene) {
            console.warn('Renderers not initialized');
            return;
        }

        // Renderer ID format: {strategy}-{scene}
        const rendererId = `${strategyId}-${this.scene.id}`;
        this.selectRenderer(rendererId);
    }

    // ============================================================================
    // Queries
    // ============================================================================

    getAvailableRendererIds(): string[] {
        return this.engine.getAvailableRendererIds();
    }

    getActiveRendererId(): string | null {
        return this.activeRendererId;
    }

    getActiveRenderer(): CompiledRenderer | null {
        if (!this.activeRendererId) return null;
        return this.renderers.get(this.activeRendererId) || null;
    }

    getScene(): SceneDescription | null {
        return this.scene;
    }

    /**
     * Get parameter metadata for active renderer
     *
     * Returns metadata from the CompiledRenderer's parameters field.
     * Useful for auto-generating UI controls.
     */
    getParameterMetadata(): Map<string, ParameterMetadata> {
        const result = new Map<string, ParameterMetadata>();

        if (!this.activeRendererId) return result;

        const renderer = this.renderers.get(this.activeRendererId);
        if (!renderer?.parameters) return result;

        for (const [path, meta] of Object.entries(renderer.parameters)) {
            result.set(path, meta);
        }

        return result;
    }

    /**
     * Clean up state
     */
    dispose(): void {
        this.renderers.clear();
        this.strategies.clear();
        this.activeRendererId = null;
        this.scene = null;
    }
}
