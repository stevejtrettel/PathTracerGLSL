// app/App.ts — Main orchestrator, facade over internal managers

import { SimpleCompiler } from '../compiler/SimpleCompiler.js';
import { Engine } from '../engine/Engine.js';
import { RenderCoordinator, type ProgressInfo } from './RenderCoordinator.js';
import { ParameterStore } from './ParameterStore.js';
import { EventBus } from './EventBus.js';
import { ExportManager } from './ExportManager.js';
import { SessionManager, type SessionData } from './SessionManager.js';
import { ProductionRenderManager } from './ProductionRenderManager.js';
import { RendererManager } from './RendererManager.js';
import { AppLayout, type LayoutMode, type RegionName } from './layout/index.js';
import type { ICompiler, CompiledRenderer, SceneDescription } from '../compiler/types.js';
import type { AppConfig, StrategyPreset, CreateAppOptions } from './types.js';
import type { Extension } from './types.js';
import { AppEvents } from './events.js';

export class App {
    private compiler: ICompiler;
    private engine: Engine;
    private coordinator: RenderCoordinator;
    private parameterStore: ParameterStore;
    private eventBus: EventBus;
    private exportManager: ExportManager;
    private sessionManager: SessionManager;
    private productionManager!: ProductionRenderManager;
    private rendererManager!: RendererManager;
    private gl: WebGL2RenderingContext;
    private extensions: Map<string, Extension> = new Map();
    private layout: AppLayout | null = null;

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
        this.compiler = new SimpleCompiler();
        this.engine = new Engine(gl);
        this.eventBus = new EventBus();
        this.parameterStore = new ParameterStore();
        this.coordinator = new RenderCoordinator(this.engine, this.eventBus);

        this.exportManager = new ExportManager(this.engine, this.coordinator);
        this.rendererManager = new RendererManager({
            compiler: this.compiler,
            engine: this.engine,
            parameterStore: this.parameterStore,
            eventBus: this.eventBus,
        });
        this.sessionManager = new SessionManager(
            this.parameterStore,
            this.eventBus,
            this.extensions,
            () => this.rendererManager.getActiveRendererId(),
            (id: string) => this.rendererManager.selectRenderer(id),
            () => this.coordinator.getProductionGoal(),
            undefined  // TileJob getter — set externally via setTileJobGetter()
        );

        // Wire ParameterStore changes to engine, EventBus, and accumulation reset
        this.parameterStore.onChange = (changes) => {
            for (const change of changes.changes) {
                this.engine.setParameter(change.path, change.newValue);

                // Skip resends (oldValue === newValue) from renderer switch
                const isResend = change.oldValue === change.newValue;
                const isRendering = this.coordinator.isRunning() || this.coordinator.isPaused();

                if (!isResend && isRendering) {
                    if (this.coordinator.shouldResetForParameter(change.path)) {
                        this.coordinator.resetAccumulation(`parameter: ${change.path}`);
                    }
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

        this.productionManager = new ProductionRenderManager({
            coordinator: this.coordinator,
            parameterStore: this.parameterStore,
            eventBus: this.eventBus,
            gl: this.gl,
            getLayout: () => this.layout,
            setLayoutMode: (mode) => this.setLayoutMode(mode),
            resize: (w, h) => this.resize(w, h),
            exportPNG: (f) => this.exportPNG(f),
            exportHDR: (f) => this.exportHDR(f),
            exportAllAOVs: () => this.exportAllAOVs(),
            quickSave: () => this.quickSave(),
        });

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
        await this.rendererManager.initialize(config);

        if (config.environmentHDR) {
            try {
                await this.engine.loadEnvironmentHDR(config.environmentHDR);
            } catch (error) {
                console.error(`Failed to load HDR environment: ${config.environmentHDR}`, error);
                throw error;
            }
        }
    }

    async initializeWithPresets(
        scene: SceneDescription,
        presetIds: string[],
        presets: Record<string, StrategyPreset> = {}
    ): Promise<void> {
        await this.rendererManager.initializeWithPresets(scene, presetIds, presets);
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

    start(): void { this.coordinator.startInteractive(); }
    stop(): void { this.coordinator.stop(); }
    pause(): void { this.coordinator.pause(); }
    resume(): void { this.coordinator.resume(); }
    isActive(): boolean { return this.coordinator.isRunning(); }
    isPaused(): boolean { return this.coordinator.isPaused(); }
    isLocked(): boolean { return this.coordinator.isLocked(); }

    // -- Rendering: Production --

    async renderProduction(targetSamples: number, options?: {
        width?: number;
        height?: number;
        autoSave?: boolean;
        autoExportPNG?: boolean;
        autoExportHDR?: boolean;
        autoExportAllAOVs?: boolean;
    }): Promise<void> {
        return this.productionManager.renderProduction(targetSamples, options);
    }

    async extendProduction(additionalSamples: number): Promise<void> {
        return this.productionManager.extendProduction(additionalSamples);
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
        const gpuTimingsMap = this.engine.isProfilingEnabled()
            ? this.engine.getAllPassTimings()
            : null;

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
            profilingEnabled: this.engine.isProfilingEnabled(),
            gpuTimings
        };
    }

    enableProfiling(): boolean { return this.engine.enableProfiling(); }
    disableProfiling(): void { this.engine.disableProfiling(); }
    isProfilingEnabled(): boolean { return this.engine.isProfilingEnabled(); }

    // -- Parameters --

    setParameter(path: string, value: any): void { this.parameterStore.set(path, value); }
    setParameters(params: Record<string, any>): void { this.parameterStore.batch(params); }
    getParameter(path: string): any { return this.parameterStore.get(path); }
    getAllParameters(): Record<string, any> { return this.parameterStore.serialize(); }
    getParameterMetadata(): Map<string, import('../app/types.js').ParameterMetadata> { return this.rendererManager.getParameterMetadata(); }
    areParametersLocked(): boolean { return this.parameterStore.isLocked(); }

    // -- Session Management --

    saveSession(): SessionData { return this.sessionManager.saveSession(); }
    restoreSession(session: SessionData): SessionData { return this.sessionManager.restoreSession(session); }
    quickSave(): void { this.sessionManager.quickSave(); }
    loadSessionFromFile(): void { this.sessionManager.loadSessionFromFile(); }

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

    getAvailableExports(): string[] { return this.exportManager.getAvailableExports(); }
    readExport(name: string): Float32Array | Uint8Array { return this.exportManager.readExport(name); }
    getCanvasSize(): [number, number] { return this.exportManager.getCanvasSize(); }
    getCanvas(): HTMLCanvasElement { return this.gl.canvas as HTMLCanvasElement; }
    exportPNG(filename?: string): void { this.exportManager.exportPNG(filename); }
    exportHDR(filename?: string): void { this.exportManager.exportHDR(filename); }
    exportAOV(aovName: string, filename?: string): void { this.exportManager.exportAOV(aovName, filename); }
    exportAllAOVs(): void { this.exportManager.exportAllAOVs(); }

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
        this.layout?.dispose();
        this.layout = null;
        this.engine.dispose();
        this.rendererManager.dispose();
    }
}
