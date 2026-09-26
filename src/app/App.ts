// app/App.ts — Main orchestrator, facade over internal managers

import { Compiler } from '../compiler/Compiler.js';
import { compileEnvironmentBake, envTableSize, DEFAULT_ENV_TABLE_SIZE } from '../compiler/EnvironmentBake.js';
import { envVariantSuffix } from '../compiler/generate/features/environment.js';
import { resampleEquirectToOctahedral } from '../components/env/octahedral/octahedral.js';
import { ENV_EXTERN_NAMES } from '../components/env/index.js';
import { packSceneData } from './sceneData.js';
import type { PackedChannel } from '../components/data/pack.js';
import { channelExtern, NODESQ_EXTERN, type DataChannel } from '../components/data/channels.js';
import type { RenderStrategy } from '../compiler/types.js';
import { resolveMeasurement } from '../compiler/plan/measurement.js';
import { Engine } from '../engine/Engine.js';
import { RenderCoordinator, type ProgressInfo } from './RenderCoordinator.js';
import { ParameterStore } from './ParameterStore.js';
import { EventBus } from './EventBus.js';
import { RendererManager } from './RendererManager.js';
import { AppLayout, type LayoutMode, type RegionName } from './layout/index.js';
import type { ICompiler, CompiledRenderer, SceneDescription } from '../compiler/types.js';
import type { SceneDataPlan } from '../compiler/sceneData.js';
import type { AppConfig, StrategyPreset, CreateAppOptions, SessionData } from './types.js';
import { SESSION_VERSION } from './types.js';
import type { Extension } from './types.js';
import { AppEvents, shouldResetAccumulation } from './events.js';
import { saveHDRFile, savePNGFile, type RenderStamp } from './utils/file-export.js';
import { ExportError, SessionError } from '../errors/RenderErrors.js';
import { ProductionOrchestrator, type ProductionOptions } from './ProductionOrchestrator.js';
import { TiledRenderer, type TiledRenderConfig } from './TiledRenderer.js';
import { ErrorOverlay } from './ui/ErrorOverlay.js';
import { CompilationError } from '../errors/core/DiagnosticBag.js';
import { DiagnosticBag } from '../errors/core/DiagnosticBag.js';

export class App {
    private compiler: ICompiler;
    private engine: Engine;
    private coordinator: RenderCoordinator;
    private parameterStore: ParameterStore;
    private eventBus: EventBus;
    private rendererManager!: RendererManager;
    private gl: WebGL2RenderingContext;
    private extensions: Map<string, Extension> = new Map();
    private layout: AppLayout | null = null;
    private production: ProductionOrchestrator;
    private tiled: TiledRenderer;
    private errorOverlay: ErrorOverlay;
    // The parameter values the accumulated image was rendered with: taken whenever the
    // accumulation restarts. A parameter change while rendering is stopped defers the reset
    // (the finished image survives for export), so the CURRENT values can describe a
    // different image than the one on screen — export stamps use this snapshot instead.
    private imageParameters: Record<string, any> | null = null;
    // The configuration initialize() was given: what a WebGL context restore must rebuild.
    private config: AppConfig | null = null;

    constructor(canvas: HTMLCanvasElement) {
        canvas.width = canvas.clientWidth || window.innerWidth;
        canvas.height = canvas.clientHeight || window.innerHeight;

        const gl = canvas.getContext('webgl2', {
            alpha: false,
            antialias: false,
            depth: false,
            stencil: false,
            preserveDrawingBuffer: false,
            powerPreference: 'high-performance'
        });

        if (!gl) {
            throw new Error('WebGL2 not supported');
        }

        this.gl = gl;
        this.compiler = new Compiler();
        this.engine = new Engine(gl);
        this.eventBus = new EventBus();
        this.parameterStore = new ParameterStore();
        this.coordinator = new RenderCoordinator(this.engine, this.eventBus);
        this.eventBus.on(AppEvents.ACCUMULATION_RESET, () => { this.imageParameters = this.parameterStore.serialize(); });
        this.eventBus.on(AppEvents.RENDER_ERROR, (data) => this._showErrorOverlay(data.error));
        this.engine.onContextRestored = () => { void this._restoreAfterContextLoss(); };

        this.rendererManager = new RendererManager({
            compiler: this.compiler,
            engine: this.engine,
            parameterStore: this.parameterStore,
            eventBus: this.eventBus,
        });
        // Wire ParameterStore changes to engine, EventBus, and accumulation reset
        this.parameterStore.onChange = (changes) => {
            let resetReason: string | null = null;
            for (const change of changes.changes) {
                this.engine.setParameter(change.path, change.newValue);

                // Skip resends (oldValue === newValue) from renderer switch
                const isResend = change.oldValue === change.newValue;

                if (!isResend && this._triggersReset(change.path)) {
                    resetReason = `parameter: ${change.path}`;
                }

                if (!isResend) {
                    this.eventBus.emit(AppEvents.PARAMETER_CHANGED, {
                        path: change.path,
                        oldValue: change.oldValue,
                        newValue: change.newValue
                    });
                }
            }
            // E3: ONE reset per CHANGESET — a batched pose write (position+target) is one
            // user action; the old per-change request cleared accumulation once per field
            // (twice per orbit tick: buffer clears + salt bumps, doubled). The reset (or,
            // if stopped/complete, the dirty mark for the next start) still fires so a
            // camera/param change never ghosts new samples into the old image (#4).
            if (resetReason !== null) {
                this.coordinator.requestAccumulationReset(resetReason);
            }
        };

        // Wire coordinator progress to EventBus
        this.coordinator.onProgress = (info: ProgressInfo) => {
            this.eventBus.emit(AppEvents.RENDER_PROGRESS, info);
        };

        this.production = new ProductionOrchestrator(
            this, this.coordinator, this.parameterStore
        );
        this.tiled = new TiledRenderer(this, this.production, this.eventBus);

        this.errorOverlay = new ErrorOverlay(document.body);

        console.log('App created');
    }

    // -- Factory --

    // Create App with integrated layout (recommended entry point)
    static create(
        container: HTMLElement = document.body,
        options: CreateAppOptions = {}
    ): App {
        const layoutMode = options.layout ?? 'fullscreen';
        const layout = new AppLayout(container, {
            mode: layoutMode,
            variables: options.layoutVariables
        });

        const canvas = document.createElement('canvas');
        layout.getCanvasContainer().appendChild(canvas);

        const app = new App(canvas);
        app.setLayout(layout);
        return app;
    }

    // -- Initialization --

    // Compile all strategies and optionally load environment HDR
    async initialize(config: AppConfig): Promise<void> {
        // T4: a procedural environment bakes its table(s) BEFORE the main renderers exist —
        // no selection state to restore, and the CDF externs are registered before any
        // pass could bind them. Run-once semantics live HERE; the engine just renders.
        // T5: one table per (chart, compensation) VARIANT the strategies use — keys 1-9
        // switch strategies live, so all variants must coexist in the registry.
        if (config.scene?.environment?.type === 'procedural') {
            try {
                this._bakeProceduralEnvironment(config.scene, envVariants(config.strategies));
            } catch (error: any) {
                this._showErrorOverlay(error);
                throw error;
            }
        }

        // Compile (and validate) first: it is fast, and it decides which scene-data structures
        // the renderers read. Only then build and upload that data — the expensive step — so
        // a bad scene fails in milliseconds with its diagnostics, before any packing. The data
        // textures must be registered before the first FRAME (the executor binds externs per
        // pass and hard-errors on a missing one); loading renderers does not bind them.
        try {
            await this.rendererManager.initialize(config);
        } catch (error: any) {
            this._showErrorOverlay(error);
            throw error;
        }

        if (config.scene !== undefined) {
            try {
                await this._uploadSceneGeometry(this.rendererManager.getSceneData()!);
            } catch (error: any) {
                this._showErrorOverlay(error);
                throw error;
            }
        }

        // Scene-driven environment load (env-as-light T2): an `image` environment's textures
        // must be in the extern registry BEFORE the first frame — the executor hard-errors on
        // a missing extern (never a silent unit-0 sample), so initialize awaits the load.
        this.config = config;
        await this._loadImageEnvironment(config);
        // The first image is rendered with the values as initialized.
        this.imageParameters = this.parameterStore.serialize();
    }

    /** Load an `image` environment (or an explicit config.environmentHDR): the radiance map,
     *  the default sampling tables, and the (chart, compensation) variants the strategies use.
     *  The table sizes and total weight measured here (`env.size`, `env.sizeOct`,
     *  `env.totalWeight`) go to the engine directly, not through the ParameterStore: the store
     *  holds what the user chose, which a session restores, and these describe the loaded
     *  map, so a restore must neither remove nor overwrite them. Every caller resets
     *  accumulation after loading (or loads before the first frame). */
    private async _loadImageEnvironment(config: AppConfig): Promise<void> {
        const sceneEnv = config.scene?.environment;
        const hdrPath = config.environmentHDR ?? (sceneEnv?.type === 'image' ? sceneEnv.url : undefined);
        if (!hdrPath) return;
        try {
            // The loader registers env_map + the DEFAULT tables (equirect, uncompensated).
            const env = await this.engine.loadEnvironmentHDR(hdrPath, ENV_EXTERN_NAMES);
            this.engine.setParameter('env.size', [env.width, env.height]);
            this.engine.setParameter('env.totalWeight', env.totalWeight);

            // T5: build the non-default (chart, compensation) variants the strategies use.
            let octaRgb: Float32Array | null = null;
            const octaN = DEFAULT_ENV_TABLE_SIZE[1];
            for (const { chart, compensation } of envVariants(config.strategies)) {
                const suffix = envVariantSuffix(chart, compensation);
                if (suffix === '') continue;   // default already built by the loader
                let rgb = env.data, w = env.width, h = env.height;
                if (chart === 'octahedral') {
                    octaRgb ??= resampleEquirectToOctahedral(env.data, env.width, env.height, octaN);
                    rgb = octaRgb; w = octaN; h = octaN;
                    this.engine.setParameter('env.sizeOct', [octaN, octaN]);
                }
                this.engine.registerEnvironmentTable(rgb, w, h, {
                    names: { map: ENV_EXTERN_NAMES.map, cond: `${ENV_EXTERN_NAMES.cond}${suffix}`, marg: `${ENV_EXTERN_NAMES.marg}${suffix}` },
                    chart, compensation,
                });
            }
        } catch (error) {
            console.error(`Failed to load HDR environment: ${hdrPath}`, error);
            throw error;
        }
    }

    /**
     * Rebuild everything the GPU lost with the WebGL context. The engine has already rebuilt
     * the renderers' programs and framebuffers (from the compiled renderers it keeps) and its
     * own global textures; what it cannot rebuild are the textures the App supplies — the
     * scene data and the environment — and the parameter values, which live in the
     * ParameterStore. Rendering is paused until everything is back.
     */
    private async _restoreAfterContextLoss(): Promise<void> {
        const config = this.config;
        if (config === null) return;
        const wasRendering = this.coordinator.isRunning();
        if (wasRendering) this.coordinator.pause();
        try {
            const active = this.engine.getActiveRendererId();
            if (config.scene?.environment?.type === 'procedural') {
                // The bake loads, renders and unloads its own tiny renderer, which moves the
                // engine's selection — re-select the active renderer afterwards.
                this._bakeProceduralEnvironment(config.scene, envVariants(config.strategies));
                if (active !== null) this.engine.selectRenderer(active);
            }
            const sceneData = this.rendererManager.getSceneData();
            if (sceneData !== null) await this._uploadSceneGeometry(sceneData);
            await this._loadImageEnvironment(config);
            this.parameterStore.resendAll();
            this.coordinator.resetAccumulation('WebGL context restored');
            console.log('Scene data, environment and parameters restored after WebGL context loss');
        } catch (error: any) {
            this._showErrorOverlay(error);
            return;   // stay paused: the GPU state is incomplete
        }
        if (wasRendering) this.coordinator.resume();
    }

    /**
     * Build and register the shared scene-data textures the loaded renderers were compiled
     * against, by executing the compiler's scene-data plan. Must run before the first frame.
     */
    private async _uploadSceneGeometry(plan: SceneDataPlan): Promise<void> {
        const packed = await packSceneData(plan);
        if (packed === null) return;
        for (const [c, channel] of Object.entries(packed.channels) as Array<[DataChannel, PackedChannel]>) {
            this.engine.registerDataTexture(channelExtern(c), channel.data, channel.width, channel.height);
        }
        if (packed.nodesq !== null) {
            this.engine.registerDataTextureU32(NODESQ_EXTERN, packed.nodesq.data, packed.nodesq.width, packed.nodesq.height);
        }
    }

    /**
     * T4/T5 bake: for each CHART the strategies use, compile the tiny bake renderer, render
     * ONE frame, read the table back, and build every (chart, compensation) variant's CDFs
     * from it. The engine executes perfectly ordinary pipelines; run-once semantics and
     * variant knowledge belong to the app.
     */
    private _bakeProceduralEnvironment(scene: SceneDescription, variants: Array<{ chart: string; compensation: boolean }>): void {
        const env = scene.environment as Extract<SceneDescription['environment'], { type: 'procedural' }>;
        const charts = [...new Set(variants.map((v) => v.chart))];

        for (const chart of charts) {
            const bake = compileEnvironmentBake(scene, chart);
            if (!bake) return;
            const [w, h] = envTableSize(env, chart);

            // loadRenderers (bulk) rather than loadRenderer: it selects and moves the engine
            // to 'running', which renderFrame's state guard requires. Main renderers re-run it.
            this.engine.loadRenderers([bake]);
            try {
                this.engine.renderFrame();
                const rgba = this.engine.readExport('table') as Float32Array;
                // RGBA readback → tightly-packed RGB for the CDF builder
                const rgb = new Float32Array(w * h * 3);
                for (let i = 0; i < w * h; i++) {
                    rgb[3 * i] = rgba[4 * i];
                    rgb[3 * i + 1] = rgba[4 * i + 1];
                    rgb[3 * i + 2] = rgba[4 * i + 2];
                }
                for (const v of variants.filter((v) => v.chart === chart)) {
                    const suffix = envVariantSuffix(v.chart, v.compensation);
                    const { totalWeight } = this.engine.registerEnvironmentTable(rgb, w, h, {
                        names: { map: ENV_EXTERN_NAMES.map, cond: `${ENV_EXTERN_NAMES.cond}${suffix}`, marg: `${ENV_EXTERN_NAMES.marg}${suffix}` },
                        chart: v.chart, compensation: v.compensation,
                    });
                    console.log(`Baked procedural environment [${v.chart}${v.compensation ? '+comp' : ''}]: ${w}×${h}, totalWeight ${totalWeight.toFixed(3)}`);
                }
                this.engine.setParameter(chart === 'octahedral' ? 'env.sizeOct' : 'env.size', [w, h]);   // measured, like _loadImageEnvironment's
            } finally {
                this.engine.unloadRenderer(bake.id);
            }
        }
    }

    // (see envVariants at module scope below the class)

    async initializeWithPresets(
        scene: SceneDescription,
        presetIds: string[],
        presets: Record<string, StrategyPreset> = {}
    ): Promise<void> {
        await this.rendererManager.initializeWithPresets(scene, presetIds, presets);
    }

    /**
     * Recompile the scene, hot-swap the renderers (compiler dev loop), and rebuild the scene
     * data for the new layout — a new scene, or a new data layout, means new bytes at new
     * offsets. Rendering is paused across the swap so no frame runs the new programs against
     * the old data.
     *
     * On compile/shader failure the ErrorOverlay is shown and the error is rethrown; the old
     * renderers and data are untouched, so rendering resumes. If rebuilding the data fails,
     * rendering stays paused (programs and data would disagree). See
     * {@link RendererManager.recompile} for the swap's atomicity.
     *
     * @param scene - Optional replacement scene; defaults to the current scene.
     */
    async recompile(scene?: SceneDescription): Promise<void> {
        const wasRendering = this.coordinator.isRunning();
        if (wasRendering) this.coordinator.pause();
        try {
            this.rendererManager.recompile(scene);
        } catch (error: any) {
            this._showErrorOverlay(error);
            if (wasRendering) this.coordinator.resume();
            throw error;
        }
        try {
            await this._uploadSceneGeometry(this.rendererManager.getSceneData()!);
        } catch (error: any) {
            this._showErrorOverlay(error);
            throw error;
        }
        this.imageParameters = this.parameterStore.serialize();   // the accumulation restarted
        if (wasRendering) this.coordinator.resume();
    }

    /**
     * Whether a parameter change should reset accumulation. Prefers the compiler's
     * per-parameter `triggersReset` metadata (authoritative for parameters the
     * active renderer emits); falls back to the path-prefix heuristic only for
     * parameters without metadata (engine builtins, display/debug toggles).
     */
    private _triggersReset(path: string): boolean {
        const meta = this.rendererManager.getParameterMetadata().get(path);
        if (meta?.triggersReset !== undefined) {
            return meta.triggersReset;
        }
        return shouldResetAccumulation(path);
    }

    /**
     * Extract a DiagnosticBag from a compilation or mapped shader error and show
     * it in the full-screen overlay. No-op if the error carries no diagnostics.
     */
    private _showErrorOverlay(error: any): void {
        let bag: DiagnosticBag | undefined;
        if (error instanceof CompilationError) {
            bag = error.diagnostics;
        } else if (error?.__diagnostics) {
            bag = error.__diagnostics;
        }
        if (bag) {
            this.errorOverlay.show(bag);
        }
    }

    // -- Content Loading --

    /** Replace the image environment. Goes through the same loader as initialize(), so the
     *  size/weight parameters the samplers read and the strategies' table variants are rebuilt
     *  for the new map (swapping only the texture left them describing the old one — biased
     *  env NEE for a map of another resolution), and a context restore reloads THIS map. */
    async loadEnvironmentHDR(path: string): Promise<void> {
        if (this.config === null) throw new Error('loadEnvironmentHDR: call initialize() first');
        this.config = { ...this.config, environmentHDR: path };
        await this._loadImageEnvironment(this.config);
        this.clearAccumulation();
    }

    // -- Renderer Management --

    getAvailableRendererIds(): string[] { return this.rendererManager.getAvailableRendererIds(); }
    getActiveRendererId(): string | null { return this.rendererManager.getActiveRendererId(); }
    getActiveRenderer(): CompiledRenderer | null { return this.rendererManager.getActiveRenderer(); }
    selectRenderer(rendererId: string): void { this.rendererManager.selectRenderer(rendererId); }
    selectRendererByStrategy(strategyId: string): void { this.rendererManager.selectRendererByStrategy(strategyId); }

    // -- Rendering: Interactive --

    start(): void {
        // Leaving any production session (no-op if idle) restores layout/resolution
        // first, so the interactive loop runs at the restored size.
        this.production.exitProduction();
        this.coordinator.startInteractive();
    }
    stop(): void {
        this.coordinator.stop();
        this.production.exitProduction();
    }
    pause(): void { this.coordinator.pause(); }
    resume(): void { this.coordinator.resume(); }
    isActive(): boolean { return this.coordinator.isRunning(); }
    isPaused(): boolean { return this.coordinator.isPaused(); }
    isLocked(): boolean { return this.parameterStore.isLocked(); }

    // -- Rendering: Production --

    async renderProduction(targetSamples: number, options?: ProductionOptions): Promise<void> {
        return this.production.renderProduction(targetSamples, options);
    }

    async extendProduction(additionalSamples: number): Promise<void> {
        return this.production.extendProduction(additionalSamples);
    }

    /** Render an image of any size in tiles and save it as one stamped HDR and/or PNG (see
     *  TiledRenderer). Rejects with RenderStoppedError if stopped (nothing is saved), like
     *  renderProduction. Afterwards interactive rendering resumes, unless something else
     *  started meanwhile: after the last tile the files are still being written while the
     *  session is already idle, and a production started then must not be torn down. */
    async renderTiled(config: TiledRenderConfig): Promise<void> {
        if (this.tiled.isActive()) throw new Error('A tiled render is already running');
        this.stop();
        try {
            await this.tiled.render(config);
        } finally {
            if (this.production.isIdle()) this.start();
        }
    }

    isTiledRenderActive(): boolean { return this.tiled.isActive(); }

    // -- Rendering: Utilities --

    renderFrame(): void { this.engine.renderFrame(); }
    clearAccumulation(): void { this.coordinator.resetAccumulation('manual'); }
    getSampleCount(): number { return this.coordinator.getSampleCount(); }
    getElapsedTime(): number { return this.coordinator.getElapsedTime(); }
    getFPS(): number { return this.coordinator.getFPS(); }
    getRenderMode(): 'interactive' | 'production' { return this.coordinator.getMode(); }
    getRenderState(): 'rendering' | 'paused' | 'complete' | 'stopped' { return this.coordinator.getState(); }

    // -- Stats & Profiling --

    getStats(): {
        samples: number;
        fps: number;
        elapsedMs: number;
        resolution: [number, number];
        mode: 'interactive' | 'production';
        state: 'rendering' | 'paused' | 'complete' | 'stopped';
        rendererId: string | null;
        profilingEnabled: boolean;
        gpuTimings: Record<string, number> | null;
    } {
        const profiling = this.engine.isProfilingEnabled();
        const gpuTimingsMap = profiling ? this.engine.getAllPassTimings() : null;

        let gpuTimings: Record<string, number> | null = null;
        if (gpuTimingsMap) {
            gpuTimings = {};
            for (const [key, value] of gpuTimingsMap) {
                gpuTimings[key] = value;
            }
        }

        return {
            samples: this.getSampleCount(),
            fps: this.getFPS(),
            elapsedMs: this.getElapsedTime(),
            resolution: this.getCanvasSize(),
            mode: this.getRenderMode(),
            state: this.getRenderState(),
            rendererId: this.rendererManager.getActiveRendererId(),
            profilingEnabled: profiling,
            gpuTimings
        };
    }

    enableProfiling(): boolean { return this.engine.enableProfiling(); }
    disableProfiling(): void { this.engine.disableProfiling(); }
    isProfilingEnabled(): boolean { return this.engine.isProfilingEnabled(); }

    // -- Parameters --

    setParameter(path: string, value: any): void { this.parameterStore.set(path, value); }
    setParameters(params: Record<string, any>): void { this.parameterStore.batch(params); }
    /** Effective value: store (anything ever set) else the compiled metadata default —
     *  authored defaults (e.g. a strategy's camera pose) are real values even before
     *  any extension or slider touches the parameter. */
    getParameter(path: string): any {
        const stored = this.parameterStore.get(path);
        if (stored !== undefined) return stored;
        return this.rendererManager.getParameterMetadata().get(path)?.default;
    }
    getAllParameters(): Record<string, any> { return this.parameterStore.serialize(); }
    getParameterMetadata(): Map<string, import('../app/types.js').ParameterMetadata> { return this.rendererManager.getParameterMetadata(); }


    // -- Session --

    saveSession(): SessionData {
        try {
            const session = this._buildSessionState();
            this.eventBus.emit(AppEvents.SESSION_SAVED, session);
            return session;
        } catch (error) {
            throw new SessionError('Failed to save session', { error });
        }
    }

    restoreSession(session: SessionData): SessionData {
        try {
            if (!session || typeof session !== 'object') {
                throw new SessionError('Invalid session data: expected object', { session });
            }

            if (session.parameters) {
                // Measured environment values belong to the loaded map, not the session (see
                // _loadImageEnvironment); a session saved by an older build still carries them.
                const params = { ...session.parameters };
                for (const key of MEASURED_ENV_PARAMS) delete params[key];
                this.parameterStore.restore(params);
            }

            if (session.rendererId) {
                this.rendererManager.selectRenderer(session.rendererId);
            }

            if (session.extensions) {
                for (const [name, state] of Object.entries(session.extensions)) {
                    const ext = this.extensions.get(name);
                    if (ext?.restoreState) {
                        ext.restoreState(state);
                    }
                }
            }

            console.log('Session restored');
            this.eventBus.emit(AppEvents.SESSION_LOADED, session);
            return session;
        } catch (error) {
            if (error instanceof SessionError) throw error;
            throw new SessionError('Failed to restore session', { error });
        }
    }

    quickSave(): void {
        try {
            const session = this.saveSession();
            const filename = this._generateSessionFilename();

            const json = JSON.stringify(session, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);

            console.log(`Session saved: ${filename}`);
        } catch (error) {
            throw new SessionError('Failed to quick save session', { error });
        }
    }

    loadSessionFromFile(): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;

            try {
                const text = await file.text();
                const session = JSON.parse(text);
                this.restoreSession(session);
                console.log(`Session loaded from: ${file.name}`);
            } catch (error) {
                if (error instanceof SessionError) throw error;
                throw new SessionError('Failed to load session from file', {
                    filename: file.name,
                    error
                });
            }
        };

        input.click();
    }

    private _buildSessionState(): SessionData {
        const extensionStates: Record<string, any> = {};
        for (const [name, ext] of this.extensions) {
            if (ext.saveState) {
                extensionStates[name] = ext.saveState();
            }
        }

        const session: SessionData = {
            version: SESSION_VERSION,
            timestamp: Date.now(),
            parameters: this.parameterStore.serialize(),
            rendererId: this.rendererManager.getActiveRendererId(),
            extensions: extensionStates
        };

        const productionGoal = this.coordinator.getProductionGoal();
        if (productionGoal) {
            session.productionGoal = productionGoal;
        }

        return session;
    }

    private _generateSessionFilename(): string {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        return `session_${year}${month}${day}_${hours}${minutes}${seconds}.json`;
    }

    // -- Resize --

    resize(width: number, height: number): void {
        const canvas = this.gl.canvas as HTMLCanvasElement;
        canvas.width = width;
        canvas.height = height;
        this.engine.resize(width, height);
        this.engine.clearAccumulation();
        console.log(`Resized to ${width}×${height}`);
    }

    resizeToWindow(): void { this.resize(window.innerWidth, window.innerHeight); }

    // -- Tiled Rendering --

    setPixelOffset(x: number, y: number): void { this.engine.setPixelOffset(x, y); }
    clearPixelOffset(): void { this.engine.clearPixelOffset(); }
    setImageSize(width: number, height: number): void { this.engine.setImageSize(width, height); }
    clearImageSize(): void { this.engine.clearImageSize(); }

    // -- Export --

    getAvailableExports(): string[] { return this.engine.getExportNames(); }
    readExport(name: string): Float32Array | Uint8Array { return this.engine.readExport(name); }
    /** Render the display on demand into the 'ldr' buffer; call before readExport('ldr'). */
    renderLdr(): void { this.engine.renderLdr(); }
    getCanvasSize(): [number, number] { return this.engine.getCanvasSize(); }
    getCanvas(): HTMLCanvasElement { return this.gl.canvas as HTMLCanvasElement; }

    /** Resolves once the file is handed to the browser. The pixels are read synchronously
     *  (before the first await), so a render continuing afterwards cannot change them. */
    async exportPNG(filename?: string): Promise<void> {
        const exports = this.getAvailableExports();
        if (!exports.includes('ldr')) {
            throw new ExportError('LDR export not available for current renderer', {
                availableExports: exports
            });
        }

        try {
            const [width, height] = this.getCanvasSize();
            this.renderLdr();   // on-demand: tonemap + dither → 'ldr' buffer (impl-plan-display B)
            const pixels = this.readExport('ldr') as Uint8Array;
            const name = filename || this._generateExportFilename('screenshot', 'png');
            await savePNGFile(pixels, width, height, name, this.buildRenderStamp());
            console.log(`Exported PNG: ${name}`);
        } catch (error) {
            if (error instanceof ExportError) throw error;
            throw new ExportError('Failed to export PNG', { error });
        }
    }

    exportHDR(filename?: string): void {
        const exports = this.getAvailableExports();
        if (!exports.includes('hdr')) {
            throw new ExportError('HDR export not available for current renderer', {
                availableExports: exports
            });
        }

        try {
            const [width, height] = this.getCanvasSize();
            const pixels = this.readExport('hdr') as Float32Array;
            const name = filename || this._generateExportFilename('radiance', 'hdr');
            saveHDRFile(pixels, width, height, name, this.buildRenderStamp());
            console.log(`Exported HDR: ${name}`);
        } catch (error) {
            if (error instanceof ExportError) throw error;
            throw new ExportError('Failed to export HDR', { error });
        }
    }

    async exportAOV(aovName: string, filename?: string): Promise<void> {
        await this.captureAOV(aovName, filename)();
    }

    /** Read one AOV buffer (and build its stamp) NOW, synchronously; the returned function
     *  encodes and saves what was read. Separating the two lets exportAllAOVs read every AOV
     *  before encoding any. */
    private captureAOV(aovName: string, filename?: string): () => Promise<void> {
        const exports = this.getAvailableExports();
        if (!exports.includes(aovName)) {
            throw new ExportError(`AOV '${aovName}' not available`, {
                requestedAOV: aovName,
                availableExports: exports
            });
        }

        try {
            const [width, height] = this.getCanvasSize();
            const pixels = this.readExport(aovName);
            const stamp = this.buildRenderStamp();
            return async () => {
                try {
                    if (pixels instanceof Float32Array) {
                        const name = filename || this._generateExportFilename(aovName, 'hdr');
                        saveHDRFile(pixels, width, height, name, stamp);
                        console.log(`Exported AOV (HDR): ${name}`);
                    } else {
                        const name = filename || this._generateExportFilename(aovName, 'png');
                        await savePNGFile(pixels, width, height, name, stamp);
                        console.log(`Exported AOV (PNG): ${name}`);
                    }
                } catch (error) {
                    throw new ExportError(`Failed to export AOV '${aovName}'`, { aovName, error });
                }
            };
        } catch (error) {
            if (error instanceof ExportError) throw error;
            throw new ExportError(`Failed to export AOV '${aovName}'`, { aovName, error });
        }
    }

    async exportAllAOVs(): Promise<void> {
        const exports = this.getAvailableExports();
        const aovs = exports.filter(e => e !== 'hdr' && e !== 'ldr');

        // E1: an empty AOV set is the NORMAL case for standard renderers (only
        // hdr/ldr/±variance targets exist) — a no-op, never a throw: the old
        // ExportError fired mid-production-flow and skipped autoSave, reporting a
        // successful render as "Production render failed".
        if (aovs.length === 0) {
            console.log('No AOVs to export (standard renderer: hdr/ldr only)');
            return;
        }

        console.log(`Exporting ${aovs.length} AOVs...`);
        const errors: Array<{ aov: string; error: any }> = [];

        // Read every AOV before encoding any: encoding is async, and a render continuing (or a
        // stop clearing the buffer) between two reads would otherwise mix frames in one export.
        const saves: Array<{ aov: string; save: () => Promise<void> }> = [];
        for (const aov of aovs) {
            try {
                saves.push({ aov, save: this.captureAOV(aov) });
            } catch (error) {
                errors.push({ aov, error });
                console.error(`Failed to export AOV '${aov}':`, error);
            }
        }
        for (const { aov, save } of saves) {
            try {
                await save();
            } catch (error) {
                errors.push({ aov, error });
                console.error(`Failed to export AOV '${aov}':`, error);
            }
        }

        if (errors.length > 0) {
            throw new ExportError(`Failed to export ${errors.length} of ${aovs.length} AOVs`, {
                errors,
                totalAOVs: aovs.length,
                failedAOVs: errors.length
            });
        }

        console.log('AOV export complete');
    }

    /** The reproducibility stamp embedded in every export (and readable by tooling).
     *  A tiled render supplies the full image's resolution and spp: the canvas and the
     *  sample count describe only the last tile. */
    buildRenderStamp(image?: { resolution: [number, number]; spp: number }): RenderStamp {
        const [width, height] = image?.resolution ?? this.getCanvasSize();
        const scene = this.rendererManager.getScene();
        const strategy = this.rendererManager.getActiveStrategy();
        return {
            // Data scenes append the .inst provenance — the scene id alone does not
            // determine a data-built image (fable-instance-clouds §7).
            scene: scene == null ? 'unknown' : scene.provenance !== undefined ? `${scene.id} [${scene.provenance}]` : scene.id,
            strategy,
            measurement: scene != null && strategy != null ? resolveMeasurement(scene, strategy) : null,
            // The values THIS image was rendered with (see imageParameters).
            parameters: this.imageParameters ?? this.parameterStore.serialize(),
            spp: image?.spp ?? this.coordinator.getSampleCount(),
            resolution: [width, height],
            resetSalt: this.engine.getResetSalt(),
            git: typeof __GIT_HASH__ !== 'undefined' ? __GIT_HASH__ : 'unknown',
            date: new Date().toISOString(),
        };
    }

    /** Pin the RNG salt for reproducible renders; null unpins. See Engine.pinResetSalt. */
    pinResetSalt(salt: number | null): void {
        this.engine.pinResetSalt(salt);
    }
    getPinnedResetSalt(): number | null { return this.engine.getPinnedResetSalt(); }
    getResetSalt(): number { return this.engine.getResetSalt(); }

    getActiveStrategy(): RenderStrategy | null {
        return this.rendererManager.getActiveStrategy();
    }

    private _generateExportFilename(prefix: string, extension: string): string {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const spp = this.coordinator.getSampleCount();
        return `${prefix}_${year}${month}${day}_${hours}${minutes}_${spp}spp.${extension}`;
    }

    // -- Extensions --

    use(extension: Extension): void {
        if (this.extensions.has(extension.name)) {
            console.warn(`Extension '${extension.name}' already installed`);
            return;
        }

        if (extension.dependencies) {
            for (const dep of extension.dependencies) {
                if (!this.extensions.has(dep)) {
                    throw new Error(`Extension '${extension.name}' requires '${dep}'`);
                }
            }
        }

        extension.install(this, this.eventBus);
        this.extensions.set(extension.name, extension);

        console.log(`Extension installed: ${extension.name}${extension.version ? ` v${extension.version}` : ''}`);
        this.eventBus.emit(AppEvents.EXTENSION_INSTALLED, {
            name: extension.name,
            version: extension.version
        });
    }

    unuse(extensionName: string): void {
        const extension = this.extensions.get(extensionName);
        if (!extension) {
            console.warn(`Extension '${extensionName}' not installed`);
            return;
        }

        extension.uninstall?.();
        this.extensions.delete(extensionName);
        this.eventBus.emit(AppEvents.EXTENSION_UNINSTALLED, { name: extensionName });
    }

    getExtensionNames(): string[] { return Array.from(this.extensions.keys()); }
    getExtension<T extends Extension>(name: string): T | undefined { return this.extensions.get(name) as T | undefined; }
    getEventBus(): EventBus { return this.eventBus; }

    // -- Layout --

    setLayout(layout: AppLayout): void { this.layout = layout; }
    getLayout(): AppLayout | null { return this.layout; }
    hasLayout(): boolean { return this.layout !== null; }
    getLayoutMode(): LayoutMode | null { return this.layout?.mode ?? null; }

    setLayoutMode(mode: LayoutMode): void {
        if (!this.layout) throw new Error('No layout configured. Call setLayout() first.');
        this.layout.setMode(mode);
    }

    getRegion(name: RegionName): HTMLElement {
        if (!this.layout) throw new Error('No layout configured. Call setLayout() first.');
        return this.layout.getRegion(name);
    }

    getCanvasContainer(): HTMLElement {
        if (!this.layout) throw new Error('No layout configured. Call setLayout() first.');
        return this.layout.getCanvasContainer();
    }

    // -- Cleanup --

    dispose(): void {
        this.stop();

        for (const [, extension] of this.extensions) {
            extension.uninstall?.();
        }
        this.extensions.clear();
        this.eventBus.removeAllListeners();
        this.errorOverlay.dispose();
        this.layout?.dispose();
        this.layout = null;
        this.engine.dispose();
        this.rendererManager.dispose();
    }
}


/**
 * The distinct (chart, compensation) env-table variants a strategy set needs (T5).
 * Live strategy switching (keys 1-9) means every variant's tables must be registered
 * up front; missing-extern binds are hard errors by design.
 */
function envVariants(strategies: RenderStrategy[] | undefined): Array<{ chart: string; compensation: boolean }> {
    const seen = new Map<string, { chart: string; compensation: boolean }>();
    for (const st of strategies ?? []) {
        const chart = st.estimator.envSampler ?? 'equirect';
        const compensation = st.estimator.envCompensation ?? false;
        seen.set(`${chart}|${compensation}`, { chart, compensation });
    }
    if (seen.size === 0) seen.set('equirect|false', { chart: 'equirect', compensation: false });
    return [...seen.values()];
}

/** Parameters the App measures from the loaded environment and gives to the engine directly
 *  (_loadImageEnvironment, _bakeProceduralEnvironment). Never session state. */
const MEASURED_ENV_PARAMS = ['env.size', 'env.sizeOct', 'env.totalWeight'] as const;
