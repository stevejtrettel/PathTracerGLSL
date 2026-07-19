// app/App.ts — Main orchestrator, facade over internal managers

import { Compiler } from '../compiler/Compiler.js';
import { compileEnvironmentBake, envTableSize, DEFAULT_ENV_TABLE_SIZE } from '../compiler/EnvironmentBake.js';
import { envVariantSuffix } from '../compiler/generate/features/environment.js';
import { resampleEquirectToOctahedral } from '../components/env/octahedral/octahedral.js';
import type { RenderStrategy } from '../compiler/types.js';
import { Engine } from '../engine/Engine.js';
import { RenderCoordinator, type ProgressInfo } from './RenderCoordinator.js';
import { ParameterStore } from './ParameterStore.js';
import { EventBus } from './EventBus.js';
import { RendererManager } from './RendererManager.js';
import { AppLayout, type LayoutMode, type RegionName } from './layout/index.js';
import type { ICompiler, CompiledRenderer, SceneDescription } from '../compiler/types.js';
import type { AppConfig, StrategyPreset, CreateAppOptions, SessionData } from './types.js';
import { SESSION_VERSION } from './types.js';
import type { Extension } from './types.js';
import { AppEvents, shouldResetAccumulation } from './events.js';
import { saveHDRFile, savePNGFile, type RenderStamp } from './utils/file-export.js';
import { ExportError, SessionError } from '../errors/RenderErrors.js';
import { ProductionOrchestrator, type ProductionOptions } from './ProductionOrchestrator.js';
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
    private errorOverlay: ErrorOverlay;

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

        this.rendererManager = new RendererManager({
            compiler: this.compiler,
            engine: this.engine,
            parameterStore: this.parameterStore,
            eventBus: this.eventBus,
        });
        // Wire ParameterStore changes to engine, EventBus, and accumulation reset
        this.parameterStore.onChange = (changes) => {
            for (const change of changes.changes) {
                this.engine.setParameter(change.path, change.newValue);

                // Skip resends (oldValue === newValue) from renderer switch
                const isResend = change.oldValue === change.newValue;

                // Reset (or, if stopped/complete, mark dirty for the next start) so a
                // camera/param change never ghosts new samples into the old image (#4).
                if (!isResend && this._triggersReset(change.path)) {
                    this.coordinator.requestAccumulationReset(`parameter: ${change.path}`);
                }

                if (!isResend) {
                    this.eventBus.emit(AppEvents.PARAMETER_CHANGED, {
                        path: change.path,
                        oldValue: change.oldValue,
                        newValue: change.newValue
                    });
                }
            }
        };

        // Wire coordinator progress to EventBus
        this.coordinator.onProgress = (info: ProgressInfo) => {
            this.eventBus.emit(AppEvents.RENDER_PROGRESS, info);
        };

        this.production = new ProductionOrchestrator(
            this, this.coordinator, this.parameterStore
        );

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

        try {
            await this.rendererManager.initialize(config);
        } catch (error: any) {
            this._showErrorOverlay(error);
            throw error;
        }

        // Scene-driven environment load (env-as-light T2): an `image` environment's textures
        // must be in the extern registry BEFORE the first frame — the executor hard-errors on
        // a missing extern (never a silent unit-0 sample), so initialize awaits the load.
        const sceneEnv = config.scene?.environment;
        const hdrPath = config.environmentHDR ?? (sceneEnv?.type === 'image' ? sceneEnv.url : undefined);
        if (hdrPath) {
            try {
                // The loader registers env_map + the DEFAULT tables (equirect, uncompensated).
                const env = await this.engine.loadEnvironmentHDR(hdrPath);
                this.parameterStore.batch({ 'env.size': [env.width, env.height], 'env.totalWeight': env.totalWeight });

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
                        this.parameterStore.set('env.sizeOct', [octaN, octaN]);
                    }
                    this.engine.registerEnvironmentTable(rgb, w, h, {
                        names: { map: 'env_map', cond: `env_cdf_cond${suffix}`, marg: `env_cdf_marg${suffix}` },
                        chart, compensation,
                    });
                }
            } catch (error) {
                console.error(`Failed to load HDR environment: ${hdrPath}`, error);
                throw error;
            }
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
                        names: { map: 'env_map', cond: `env_cdf_cond${suffix}`, marg: `env_cdf_marg${suffix}` },
                        chart: v.chart, compensation: v.compensation,
                    });
                    console.log(`Baked procedural environment [${v.chart}${v.compensation ? '+comp' : ''}]: ${w}×${h}, totalWeight ${totalWeight.toFixed(3)}`);
                }
                this.parameterStore.set(chart === 'octahedral' ? 'env.sizeOct' : 'env.size', [w, h]);
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
     * Recompile the scene and hot-swap the renderers (compiler dev loop).
     *
     * On compile/shader failure, the ErrorOverlay is shown and the error is
     * rethrown. See {@link RendererManager.recompile} for the recovery semantics.
     *
     * @param scene - Optional replacement scene; defaults to the current scene.
     */
    recompile(scene?: SceneDescription): void {
        try {
            this.rendererManager.recompile(scene);
        } catch (error: any) {
            this._showErrorOverlay(error);
            throw error;
        }
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

    async loadEnvironmentHDR(path: string): Promise<void> {
        await this.engine.loadEnvironmentHDR(path);
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

    // -- Rendering: Utilities --

    renderFrame(): void { this.engine.renderFrame(); }
    clearAccumulation(): void { this.coordinator.resetAccumulation('manual'); }
    getSampleCount(): number { return this.coordinator.getSampleCount(); }
    getElapsedTime(): number { return this.coordinator.getElapsedTime(); }
    getFPS(): number { return this.coordinator.getFPS(); }
    getRenderMode(): 'interactive' | 'production' { return this.coordinator.getMode(); }
    getRenderState(): 'rendering' | 'paused' | 'complete' | 'stopped' { return this.coordinator.getState(); }

    // Cycle through display modes for AOV renderers
    cycleDisplayMode(): void {
        const modeParams = ['debug.displayMode', 'renderer.displayMode'];
        const renderer = this.engine.getActiveRenderer();

        for (const param of modeParams) {
            const metadata = renderer?.parameters?.[param];
            if (metadata) {
                const current = this.getParameter(param) ?? metadata.default ?? 0;
                const max = metadata.range?.[1] ?? 2;
                const next = ((current as number) + 1) % (max + 1);
                this.setParameter(param, next);
                const modeName = metadata.options?.[next] ?? `Mode ${next}`;
                console.log(`Display mode: ${modeName} (${next})`);
                return;
            }
        }
        console.log('No display mode parameter found for current renderer');
    }

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
                this.parameterStore.restore(session.parameters);
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

    exportPNG(filename?: string): void {
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
            savePNGFile(pixels, width, height, name, this.buildRenderStamp());
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

    exportAOV(aovName: string, filename?: string): void {
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
            const name = filename || this._generateExportFilename(aovName, 'hdr');

            if (pixels instanceof Float32Array) {
                saveHDRFile(pixels, width, height, name, this.buildRenderStamp());
                console.log(`Exported AOV (HDR): ${name}`);
            } else {
                const pngName = filename || this._generateExportFilename(aovName, 'png');
                savePNGFile(pixels, width, height, pngName, this.buildRenderStamp());
                console.log(`Exported AOV (PNG): ${pngName}`);
            }
        } catch (error) {
            if (error instanceof ExportError) throw error;
            throw new ExportError(`Failed to export AOV '${aovName}'`, { aovName, error });
        }
    }

    exportAllAOVs(): void {
        const exports = this.getAvailableExports();
        const aovs = exports.filter(e => e !== 'hdr' && e !== 'ldr');

        if (aovs.length === 0) {
            throw new ExportError('No AOVs available for export', {
                availableExports: exports
            });
        }

        console.log(`Exporting ${aovs.length} AOVs...`);
        const errors: Array<{ aov: string; error: any }> = [];

        for (const aov of aovs) {
            try {
                this.exportAOV(aov);
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

    /** The reproducibility stamp embedded in every export (and readable by tooling). */
    buildRenderStamp(): RenderStamp {
        const [width, height] = this.getCanvasSize();
        return {
            scene: this.rendererManager.getScene()?.id ?? 'unknown',
            strategy: this.rendererManager.getActiveStrategy(),
            parameters: this.parameterStore.serialize(),
            spp: this.coordinator.getSampleCount(),
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
