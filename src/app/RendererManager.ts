// app/RendererManager.ts
// Manages compiled renderers: compilation, switching, and metadata

import type { ICompiler, CompiledRenderer, SceneDescription, RenderStrategy, SourceMap } from '../compiler/types.js';
import type { Engine } from '../engine/Engine.js';
import type { ParameterStore } from './ParameterStore.js';
import type { EventBus } from './EventBus.js';
import type { AppConfig, StrategyPreset } from './types.js';
import type { ParameterMetadata } from './types.js';
import { AppEvents } from './events.js';
import { CompilationError } from '../errors/core/DiagnosticBag.js';
import { ConsoleReporter } from '../errors/reporters/index.js';
import { mapEngineShaderError } from '../compiler/generate/ShaderErrorMapper.js';

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
    // strategyId → rendererId, taken from the compiled renderer's own id so the
    // `${strategyId}-${sceneId}` convention lives only in the compiler.
    private strategyToRenderer: Map<string, string> = new Map();
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
        const reporter = new ConsoleReporter();
        const compiledRenderers: CompiledRenderer[] = [];

        for (const strategy of strategies) {
            console.log(`  Compiling strategy: ${strategy.id}`);
            try {
                const renderer = this.compiler.compile(scene, strategy);
                compiledRenderers.push(renderer);
                this.strategies.set(strategy.id, strategy);
                this.renderers.set(renderer.id, renderer);
                this.strategyToRenderer.set(strategy.id, renderer.id);
            } catch (error) {
                if (error instanceof CompilationError) {
                    console.error(reporter.formatBag(error.diagnostics));
                }
                throw error;
            }
        }

        // Load all renderers into engine
        try {
            this.engine.loadRenderers(compiledRenderers);
        } catch (error: any) {
            this.attachShaderDiagnostics(error, compiledRenderers, reporter);
            throw error;
        }

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
     * Recompile the scene and hot-swap every strategy's renderer in place.
     *
     * This is the compiler dev-loop entry point: after changing the scene (or a
     * property that is baked at compile time), call this to regenerate shaders
     * without a page reload. The engine replaces each renderer's programs and GPU
     * resources; the previously-active renderer is re-selected, parameters are
     * re-sent, and accumulation is reset.
     *
     * The swap is atomic: nothing existing is destroyed until every new renderer
     * has been fully compiled and GPU-validated, so a failure at any point leaves
     * the currently-loaded renderers untouched and still rendering. Errors
     * propagate to the caller (App routes them to the ErrorOverlay):
     * - A `CompilationError` (bad scene/strategy) is thrown during compilation.
     * - A shader-compile error (only possible when `scene` introduces new GLSL)
     *   is thrown during validation, with a mapped `DiagnosticBag` on
     *   `__diagnostics`. Validation builds throwaway programs only — no new
     *   framebuffers — so peak GPU memory stays at 1×.
     *
     * @param scene - Optional replacement scene; defaults to the current scene.
     */
    recompile(scene?: SceneDescription): void {
        const target = scene ?? this.scene;
        if (!target) {
            throw new Error('Cannot recompile before initialize()');
        }

        const reporter = new ConsoleReporter();
        const previouslyActive = this.activeRendererId;

        // Phase 1 — compile every strategy (TS → shader source + pipeline spec).
        // No GPU state is touched, so a CompilationError here leaves the loaded
        // renderers intact.
        const compiled: Array<{ strategyId: string; renderer: CompiledRenderer }> = [];
        for (const [strategyId, strategy] of this.strategies) {
            try {
                compiled.push({ strategyId, renderer: this.compiler.compile(target, strategy) });
            } catch (error) {
                if (error instanceof CompilationError) {
                    console.error(reporter.formatBag(error.diagnostics));
                }
                throw error;
            }
        }

        // Phase 2 — validate all new shaders compile on the GPU while the current
        // renderers are still loaded. This is the atomic-commit boundary: if any
        // shader is bad we throw here, before a single destructive change, so the
        // previously-working renderers keep rendering. Uses throwaway programs, so
        // no framebuffers are allocated and peak memory stays at 1×.
        const newRenderers = compiled.map(c => c.renderer);
        try {
            this.engine.validateRenderers(newRenderers);
        } catch (error: any) {
            this.attachShaderDiagnostics(error, newRenderers, reporter);
            throw error;
        }

        // Phase 3 — commit: replace programs/resources in the engine. Every new
        // shader is known to compile, so this no longer fails partway.
        this.scene = target;
        // E9: renderer ids embed the scene id — a recompile with a DIFFERENT scene mints
        // all-new ids, and the old renderers (programs + GPU framebuffers) used to leak,
        // staying selectable and shifting the 1-9 keys. Diff-and-unload the stale ids.
        const newIds = new Set(compiled.map((c) => c.renderer.id));
        for (const staleId of [...this.renderers.keys()]) {
            if (!newIds.has(staleId)) {
                this.engine.unloadRenderer(staleId);
                this.renderers.delete(staleId);
            }
        }
        for (const [strategyId, rid] of [...this.strategyToRenderer]) {
            if (!newIds.has(rid)) this.strategyToRenderer.delete(strategyId);
        }
        for (const { strategyId, renderer } of compiled) {
            this.engine.loadRenderer(renderer.id, renderer);
            this.renderers.set(renderer.id, renderer);
            this.strategyToRenderer.set(strategyId, renderer.id);
        }

        // Re-select the previously-active renderer (loadRenderer clears the active
        // pointer when it replaces the active one).
        const toSelect = previouslyActive && this.renderers.has(previouslyActive)
            ? previouslyActive
            : compiled[0].renderer.id;
        this.engine.selectRenderer(toSelect);
        this.activeRendererId = toSelect;
        this.parameterStore.resendAll();
        this.engine.clearAccumulation();

        console.log(`Recompiled ${compiled.length} renderer(s)`);
        this.eventBus.emit(AppEvents.RENDERER_SWITCHED, { rendererId: toSelect });
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
        const rendererId = this.strategyToRenderer.get(strategyId);
        if (!rendererId) {
            console.warn(`No renderer for strategy: ${strategyId}`);
            return;
        }
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

    /** The RenderStrategy behind the active renderer (for export stamps / tooling). */
    getActiveStrategy(): RenderStrategy | null {
        if (!this.activeRendererId) return null;
        for (const [strategyId, rendererId] of this.strategyToRenderer) {
            if (rendererId === this.activeRendererId) {
                return this.strategies.get(strategyId) ?? null;
            }
        }
        return null;
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
     * Map an engine shader-compile error back through the renderers' source maps
     * and attach the resulting DiagnosticBag to the error as `__diagnostics`
     * (which App reads to show the ErrorOverlay). No-op if the error can't be mapped.
     */
    private attachShaderDiagnostics(
        error: any,
        renderers: CompiledRenderer[],
        reporter: ConsoleReporter
    ): void {
        const allSourceMaps = this.collectSourceMaps(renderers);
        const mapped = mapEngineShaderError(error?.message ?? '', allSourceMaps);
        if (mapped) {
            console.error(reporter.formatBag(mapped));
            error.__diagnostics = mapped;
        }
    }

    /**
     * Collect all source maps from compiled renderers into a single map
     */
    private collectSourceMaps(renderers: CompiledRenderer[]): Map<string, SourceMap> {
        const all = new Map<string, SourceMap>();
        for (const renderer of renderers) {
            if (renderer.sourceMaps) {
                for (const [id, sm] of renderer.sourceMaps) {
                    all.set(id, sm);
                }
            }
        }
        return all;
    }

    /**
     * Clean up state
     */
    dispose(): void {
        this.renderers.clear();
        this.strategies.clear();
        this.strategyToRenderer.clear();
        this.activeRendererId = null;
        this.scene = null;
    }
}
