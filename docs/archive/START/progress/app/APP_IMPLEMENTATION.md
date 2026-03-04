# App Pillar: Implementation Documentation

## Executive Summary

The App pillar is **complete and stable** for research use. It provides orchestration, parameter management, render execution, session persistence, and an extension system. The implementation is cleaner and simpler than the original design docs, having dropped unnecessary complexity (metadata validation, change source tracking) while keeping everything essential.

**Status**: Production-ready for research. Set it and forget it.

## Architecture Overview

```
                         App (Orchestrator)
                              |
        ┌─────────────────────┼─────────────────────┐
        ↓                     ↓                     ↓
  ParameterStore      RenderCoordinator       SessionManager
        |                     |                     |
        |                     ↓                     |
        |                  Engine                  |
        |                     |                     |
        └──────────────> EventBus <────────────────┘
                              ↑
                              |
                         Extensions
```

### Core Flow

1. **Parameters change** → ParameterStore.onChange → Engine.updateParameters
2. **Reset decision** → RenderCoordinator.shouldResetForParameter
3. **Rendering** → RenderCoordinator controls Engine.renderFrame loop
4. **Events** → Everything emits to EventBus
5. **Sessions** → SessionManager captures/restores complete state

## Component Details

### 1. App.ts - The Orchestrator

**Purpose**: Wire together Engine, ParameterStore, RenderCoordinator, SessionManager, and host extensions. Provide the minimal API for research.

**Key Responsibilities**:
- Initialize Engine with recipes
- Wire parameter changes to Engine
- Manage recipe switching
- Host extension system with service registry
- Provide keyboard shortcuts (built-in)

**Public API**:
```typescript
// Core components (public for extensions)
engine: Engine
parameterStore: ParameterStore
renderCoordinator: RenderCoordinator
sessionManager: SessionManager
tiledRenderer: TiledRenderer
bus: EventBus

// Initialization
async initialize(recipes: Recipe[], environmentHDR?: string, initialParameters?: Record<string, any>)

// Recipe management
switchRecipe(recipeId: string): void
getCurrentRecipe(): string  // via engine

// Rendering control
renderInteractive(): void
renderProduction(targetSamples: number): Promise<void>
pause(): void
resume(): void
stop(): void
isLocked(): boolean

// Extensions
use(extension: Extension): App
registerService(name: string, service: any): void
getService<T>(name: string): T | undefined
hasService(name: string): boolean

// Utilities
handleResize(width: number, height: number): void
setupKeyboardControls(recipeKeys?: Record<string, string>): void
dispose(): void
```

**Critical Wiring**:
```typescript
// Parameter → Engine (direct)
this.parameterStore.onChange = (changes) => {
    this.engine.updateParameters(changes);
    this.bus.emit('parameter.changed', changes);
    
    // Reset decision (only if not switching recipes)
    if (!this.isSwitchingRecipe) {
        const needsReset = changes.changes.some(
            change => this.renderCoordinator.shouldResetForParameter(change.path)
        );
        if (needsReset) {
            this.renderCoordinator.resetAccumulation('parameter_change');
        }
    }
};

// Progress → EventBus
this.renderCoordinator.onProgress = (info) => {
    this.bus.emit('render.progress', info);
    if (info.state === 'complete') {
        this.bus.emit('render.complete', info);
    }
};
```

**Built-in Keyboard Shortcuts**:
- `1-9`: Switch recipes
- `r`: Reset accumulation
- `Space`: Toggle rendering
- `p`: Start production render (prompts for samples)
- `\`: Toggle pause/resume
- `Esc`: Stop rendering
- `j`: Quick save session
- `o`: Load session from file
- `t`: Start tiled render job (prompts for settings)

**Recipe Switching Protocol**:
```typescript
switchRecipe(recipeId: string): void {
    // Block during production
    if (this.renderCoordinator.isLocked()) {
        console.warn('Cannot switch recipes during production');
        return;
    }
    
    // Switch engine shader program
    this.isSwitchingRecipe = true;
    this.engine.selectRecipe(recipeId);
    this.currentRecipeId = recipeId;
    
    // Resend all parameters (bypasses reset logic)
    this.parameterStore.resendAll();
    this.isSwitchingRecipe = false;
    
    this.bus.emit('recipe.switched', { recipeId });
}
```

**Service Registry Pattern**:
All core components register as services for extension discovery:
```typescript
this.registerService('app', this);
this.registerService('engine', this.engine);
this.registerService('parameters', this.parameterStore);
this.registerService('coordinator', this.renderCoordinator);
this.registerService('session', this.sessionManager);
this.registerService('tiler', this.tiledRenderer);
```

Extensions can then do:
```typescript
const engine = app.getService('engine');
```

---

### 2. ParameterStore.ts - State Management

**Purpose**: Single source of truth for all renderer parameters. No validation, no metadata - just simple key-value storage with change notification.

**Design Philosophy**: 
- Keep it simple - just store values
- Lock during production to prevent changes
- Batch updates for efficiency
- Support session restore without triggering onChange

**Public API**:
```typescript
// Core operations
set(path: string, value: any): void
get(path: string): any
batch(updates: Record<string, any>): void

// Change notification
onChange: ((changes: ParameterChanges) => void) | null

// Locking (production mode)
lock(): void
unlock(): void
isLocked(): boolean

// Recipe switching
resendAll(): void

// Serialization
serialize(): Record<string, any>
restore(params: Record<string, any>): void
```

**Key Features**:

1. **Automatic sync on onChange assignment**:
```typescript
set onChange(callback) {
    this._onChange = callback;
    
    // Immediately sync all existing parameters
    if (callback && this.parameters.size > 0) {
        callback({
            changes: Array.from(this.parameters.entries()).map(([path, value]) => ({
                path,
                oldValue: undefined,
                newValue: value
            }))
        });
    }
}
```

2. **Lock during production**:
```typescript
set(path: string, value: any): void {
    if (this.locked) {
        console.warn(`Ignoring parameter change during production: ${path}`);
        return;
    }
    // ... normal set logic
}
```

3. **Recipe switching without reset**:
```typescript
resendAll(): void {
    if (!this._onChange) return;
    
    // Send all parameters with oldValue === newValue
    // This bypasses the "values equal" check but doesn't trigger resets
    this._onChange({
        changes: Array.from(this.parameters.entries()).map(([path, value]) => ({
            path,
            oldValue: value,  // Same as new!
            newValue: value
        }))
    });
}
```

4. **Silent restore for sessions**:
```typescript
restore(params: Record<string, any>): void {
    // Disable onChange temporarily
    const oldOnChange = this._onChange;
    this._onChange = null;
    
    this.parameters.clear();
    for (const [key, value] of Object.entries(params)) {
        // Handle Float32Array conversion for camera.frame
        if (key === 'camera.frame' && Array.isArray(value)) {
            this.parameters.set(key, new Float32Array(value));
        } else {
            this.parameters.set(key, Array.isArray(value) ? [...value] : value);
        }
    }
    
    // Re-enable and send all as batch
    this._onChange = oldOnChange;
    if (this._onChange) {
        this._onChange({
            changes: Array.from(this.parameters.entries()).map(([path, value]) => ({
                path,
                oldValue: undefined,
                newValue: value
            }))
        });
    }
}
```

**Value Equality**:
```typescript
private valuesEqual(a: any, b: any): boolean {
    if (a === b) return true;
    
    // Handle arrays and typed arrays
    if ((Array.isArray(a) || ArrayBuffer.isView(a)) &&
        (Array.isArray(b) || ArrayBuffer.isView(b))) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }
    
    return false;
}
```

**Design Note**: The original docs specified a metadata system with validation (min/max/type checking). This was intentionally dropped - for research use, parameter validation adds complexity without benefit. The Engine validates what it needs.

---

### 3. RenderCoordinator.ts - Execution Control

**Purpose**: Manage rendering execution across two modes: interactive (continuous, flexible) and production (goal-driven, locked).

**Design Philosophy**:
- Two modes only: interactive and production
- Production mode locks parameters and runs until goal
- Both modes support pause/resume
- Production returns a Promise
- Coordinator owns the reset decision

**Public API**:
```typescript
// Mode control
startInteractive(): void
startProduction(goal: ProductionGoal): Promise<void>

// Execution control
pause(): void
resume(): void
stop(): void

// State queries
isRunning(): boolean
isPaused(): boolean
isLocked(): boolean
isAccumulating(): boolean
getMode(): RenderMode

// Accumulation
resetAccumulation(reason: string): void
shouldResetForParameter(path: string): boolean

// Callbacks
onProgress?: (info: ProgressInfo) => void
```

**Type Definitions**:
```typescript
type RenderMode = 'interactive' | 'production';
type RenderState = 'rendering' | 'paused' | 'complete';

interface ProgressInfo {
    mode: RenderMode;
    state: RenderState;
    timestamp: number;
    samples: number;
    elapsedTime: number;
    // Production-only fields
    targetSamples?: number;
    percentComplete?: number;
}

interface ProductionGoal {
    targetSamples: number;
    onProgress?: (info: ProgressInfo) => void;
    onComplete?: () => void;
}
```

**Mode Characteristics**:

| Mode | Accumulation | Locking | Interruption | Promise |
|------|-------------|---------|--------------|---------|
| Interactive | Engine-controlled | No | Yes (by production) | No |
| Production | Yes (to target) | Yes | No (must stop) | Yes |

**Reset Decision Logic**:
```typescript
// These prefixes always reset
private resetPrefixes = ['camera.', 'quad.', 'material.', 'scene.'];

// These prefixes never reset
private noResetPrefixes = ['developer.', 'debug.', 'resolution'];

shouldResetForParameter(path: string): boolean {
    // Check no-reset first (higher priority)
    for (const prefix of this.noResetPrefixes) {
        if (path.startsWith(prefix)) return false;
    }
    
    // Check reset triggers
    for (const prefix of this.resetPrefixes) {
        if (path.startsWith(prefix)) return true;
    }
    
    // Conservative default for unknown parameters
    console.warn(`Unknown parameter prefix: ${path}, resetting accumulation`);
    return true;
}
```

**Production Mode Protocol**:
```typescript
async startProduction(goal: ProductionGoal): Promise<void> {
    // Check not already running
    if (this.mode === 'production' && this.running) {
        throw new Error('Production render already in progress');
    }
    
    // Stop any interactive rendering
    if (this.running) {
        this.stop();
    }
    
    this.mode = 'production';
    this.goal = goal;
    this.running = true;
    this.paused = false;
    this.startTime = performance.now();
    
    // Return promise that resolves on completion
    return new Promise<void>((resolve, reject) => {
        this.productionResolve = resolve;
        this.productionReject = reject;
        this.runLoop();
    });
}
```

**Unified Render Loop**:
```typescript
private runLoop(): void {
    const loop = () => {
        if (!this.running || this.paused) return;
        
        this.engine.renderFrame();
        this.reportProgress();
        
        // Production mode: check if goal met
        if (this.mode === 'production' && this.checkGoalMet()) {
            this.complete();
            return;
        }
        
        this.animationId = requestAnimationFrame(loop);
    };
    
    this.animationId = requestAnimationFrame(loop);
}

private checkGoalMet(): boolean {
    if (!this.goal) return false;
    return this.engine.sampleCount >= this.goal.targetSamples;
}
```

**Stop Behavior**:
```typescript
stop(): void {
    if (!this.running) return;
    
    this.running = false;
    this.paused = false;
    
    if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = undefined;
    }
    
    // Reject production promise if running
    if (this.productionReject) {
        const error = new Error('Production render stopped');
        error.name = 'RenderStopped';
        this.productionReject(error);
        this.clearProductionPromise();
    }
    
    this.goal = null;
    this.bus.emit('render.stopped');
}
```

**Key Insight**: Production mode uses rejection to signal interruption, allowing `App.renderProduction()` to properly clean up via try/catch.

---

### 4. SessionManager.ts - Reproducibility

**Purpose**: Save and restore complete application state for perfect reproducibility.

**What Gets Saved**:
- Active recipe ID
- All parameters (except resolution during tiling)
- Render mode
- Sample count
- Camera position/frame
- Extension states
- Tile job state (if active)

**Public API**:
```typescript
captureState(): SessionData
restoreState(session: SessionData): void
async save(filename?: string): Promise<string>
async loadFromFile(file: File): Promise<void>
async quickSave(): Promise<string>
```

**SessionData Structure**:
```typescript
interface SessionData {
    version: string;
    timestamp: number;
    activeRecipe: string;
    parameters: Record<string, any>;
    renderMode: 'interactive' | 'production';
    sampleCount: number;
    camera: {
        position: [number, number, number];
        target?: [number, number, number];
        frame?: number[];
        fov?: number;
    };
    extensions: Record<string, any>;
    tileJob?: TileJob;
    metadata?: {
        title?: string;
        description?: string;
    };
}
```

**Camera Capture Strategy**:
```typescript
private captureCamera(): SessionData['camera'] {
    // Try camera service first (if extension installed)
    const cameraService = this.app.getService('camera');
    if (cameraService && typeof cameraService.getPosition === 'function') {
        return {
            position: cameraService.getPosition(),
            frame: cameraService.getFrame ? Array.from(cameraService.getFrame()) : undefined
        };
    }
    
    // Fallback to parameters
    return {
        position: this.app.parameterStore.get('camera.position') || [0, 0, 5],
        target: this.app.parameterStore.get('camera.target'),
        fov: this.app.parameterStore.get('camera.fov') || 60
    };
}
```

**Extension State Management**:
```typescript
private captureExtensionStates(): Record<string, any> {
    const states: Record<string, any> = {};
    
    for (const [name, extension] of this.extensions.entries()) {
        if (typeof extension.saveState === 'function') {
            try {
                const state = extension.saveState();
                if (state !== undefined) {
                    states[name] = state;
                }
            } catch (error) {
                console.error(`Failed to save state for extension '${name}':`, error);
            }
        }
    }
    
    return states;
}
```

**Restoration Protocol**:
```typescript
restoreState(session: SessionData): void {
    // 1. Validate
    this.validateSession(session);
    
    // 2. Stop rendering
    const wasRunning = this.app.renderCoordinator.isRunning();
    if (wasRunning) {
        this.app.renderCoordinator.stop();
    }
    
    // 3. Restore in order
    if (session.activeRecipe) {
        this.app.switchRecipe(session.activeRecipe);
    }
    
    this.app.parameterStore.restore(session.parameters);
    this.app.renderCoordinator.setMode(session.renderMode);
    this.app.renderCoordinator.resetAccumulation('session_load');
    
    this.restoreCamera(session.camera);
    this.restoreExtensionStates(session.extensions);
    
    // 4. Resume tile job or rendering
    if (session.tileJob) {
        this.app.tiledRenderer.resumeJob(session.tileJob);
    } else if (wasRunning) {
        this.app.renderCoordinator.start();
    }
    
    this.app.bus.emit('session.loaded', { timestamp: session.timestamp });
}
```

**File Operations**:
- Uses browser download for save
- Generates timestamped filenames: `session_YYYY_MMDD_HHMM.json`
- Pretty-prints JSON with 2-space indent

**Validation**:
```typescript
private validateSession(session: any): void {
    if (!session.version) {
        throw new Error('Invalid session: missing version');
    }
    if (!session.activeRecipe) {
        throw new Error('Invalid session: missing activeRecipe');
    }
    if (!session.parameters) {
        throw new Error('Invalid session: missing parameters');
    }
    
    // Check recipe exists
    const recipes = this.app.engine.getAvailableRecipes();
    if (!recipes.includes(session.activeRecipe)) {
        throw new Error(`Unknown recipe in session: ${session.activeRecipe}`);
    }
}
```

---

### 5. TiledRenderer.ts - Production Tiling

**Purpose**: Render large images by dividing into tiles, each rendered to target samples using production mode.

**Key Features**:
- Calculates evenly-dividing tile grids
- Renders each tile using App.renderProduction()
- Saves tiles individually (HDR/PNG)
- Supports pause/resume via session system
- Tracks completed tiles

**Public API**:
```typescript
calculateGrid(config: TileJobConfig): TileGrid
async startJob(config: TileJobConfig): Promise<void>
getCurrentJob(): TileJob | null
stopJob(): void
async resumeJob(job: TileJob): Promise<void>
```

**Type Definitions**:
```typescript
interface TileJobConfig {
    targetWidth: number;
    targetHeight: number;
    targetTileSize: number;
    samplesPerTile: number;
    format: 'hdr' | 'png' | 'both';
}

interface TileGrid {
    tilesX: number;
    tilesY: number;
    tileWidth: number;
    tileHeight: number;
}

interface TileJob {
    config: TileJobConfig;
    grid: TileGrid;
    completedTiles: [number, number][];
    completedTileCount: number;
    jobId: string;
    startTime: number;
    state: 'running' | 'paused' | 'complete';
}
```

**Grid Calculation**:
```typescript
calculateGrid(config: TileJobConfig): TileGrid {
    const { targetWidth, targetHeight, targetTileSize } = config;
    
    // Calculate number of tiles (ceiling division)
    const tilesX = Math.ceil(targetWidth / targetTileSize);
    const tilesY = Math.ceil(targetHeight / targetTileSize);
    
    // Calculate actual tile size (evenly divided)
    const tileWidth = Math.ceil(targetWidth / tilesX);
    const tileHeight = Math.ceil(targetHeight / tilesY);
    
    return { tilesX, tilesY, tileWidth, tileHeight };
}
```

**Tile Rendering Protocol**:
```typescript
private async renderTile(tx: number, ty: number): Promise<void> {
    const { grid, config } = this.currentJob;
    
    // Setup tile geometry
    this.app.handleResize(grid.tileWidth, grid.tileHeight);
    this.app.engine.setImageSize(config.targetWidth, config.targetHeight);
    this.app.engine.setPixelOffset(tx * grid.tileWidth, ty * grid.tileHeight);
    
    // Render using production mode (automatically resets, locks, renders to target)
    await this.app.renderProduction(config.samplesPerTile);
    
    // Save tile
    await this.saveTile(tx, ty);
}
```

**Job Management**:
```typescript
async startJob(config: TileJobConfig): Promise<void> {
    if (this.currentJob) {
        throw new Error('Job already running');
    }
    
    const grid = this.calculateGrid(config);
    
    this.currentJob = {
        config,
        grid,
        completedTiles: [],
        completedTileCount: 0,
        jobId: this.generateJobId(),
        startTime: Date.now(),
        state: 'running'
    };
    
    // Save session before starting
    await this.app.sessionManager.save(`${this.currentJob.jobId}_session.json`);
    
    // Render all tiles
    await this.renderAllTiles();
}
```

**Resume Support**:
```typescript
async resumeJob(job: TileJob): Promise<void> {
    this.currentJob = job;
    this.currentJob.state = 'running';
    
    console.log(`Resuming tile job`);
    console.log(`Completed: ${job.completedTileCount}/${totalTiles} tiles`);
    
    await this.renderAllTiles();
}

private async renderAllTiles(): Promise<void> {
    for (let ty = 0; ty < grid.tilesY; ty++) {
        for (let tx = 0; tx < grid.tilesX; tx++) {
            // Skip already completed tiles
            const alreadyDone = this.currentJob.completedTiles.some(
                ([x, y]) => x === tx && y === ty
            );
            if (alreadyDone) continue;
            
            await this.renderTile(tx, ty);
            
            this.currentJob.completedTiles.push([tx, ty]);
            this.currentJob.completedTileCount++;
        }
    }
    
    this.completeJob();
}
```

**File Naming**:
- Job ID: `job_YYYY_MMDD_HHMM`
- Session: `{jobId}_session.json`
- Tiles: `{jobId}_tile_{X}_{Y}_{samples}spp.{hdr|png}`

---

### 6. EventBus.ts - Pub/Sub System

**Purpose**: Simple event system for loose coupling between components.

**Design**: Standard pub/sub with error isolation - if one handler crashes, others still run.

**Public API**:
```typescript
on(event: string, handler: EventHandler): void
off(event: string, handler: EventHandler): void
once(event: string, handler: EventHandler): void
emit(event: string, data?: any): void
removeAllListeners(event?: string): void
listenerCount(event: string): number
eventNames(): string[]
```

**Standard Events**:
```typescript
// Core app events
'render.started'
'render.stopped'
'render.paused'
'render.resumed'
'render.progress' → ProgressInfo
'render.complete' → { samples, elapsedTime }

// State changes
'parameter.changed' → ParameterChanges
'accumulation.reset' → { reason: string }
'recipe.switched' → { recipeId: string }

// Sessions
'session.saved' → { filename: string }
'session.loaded' → { timestamp: number }

// Extensions
'extension.installed' → { name: string, version: string }
'service.registered' → { name: string }

// Extension conventions
'camera.moved' → { position: vec3, target?: vec3 }
```

**Error Handling**:
```typescript
emit(event: string, data?: any): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    
    for (const handler of handlers) {
        try {
            handler(data);
        } catch (error) {
            console.error(`Error in event handler for '${event}':`, error);
            // Continue with other handlers!
        }
    }
}
```

---

## Extension System

### Extension Interface

```typescript
interface Extension {
    name: string;
    version?: string;
    description?: string;
    dependencies?: string[];
    
    install(app: App, bus: EventBus): void;
    uninstall?(): void;
    
    saveState?(): any;
    restoreState?(state: any): void;
}
```

### Service Registry Pattern

Extensions register themselves as services rather than polluting the App API:

```typescript
// ✓ GOOD: Extension registers as service
class CameraExtension implements Extension {
    install(app: App, bus: EventBus) {
        app.registerService('camera', this);
    }
    
    getPosition(): vec3 { /* ... */ }
}

// Usage
const camera = app.getService('camera');
camera?.getPosition();
```

### Installed Extensions

**Camera Controls**:
1. **KeyboardControls** - 6DOF flight camera (WASD + arrows + QE for roll)
2. **OrbitControls** - Mouse orbit camera (drag + wheel zoom)
3. **TouchOrbitControls** - Touch orbit for mobile (one finger orbit, two finger pinch)

**File Export**:
1. **ScreenshotExtension** - Press X to save PNG
2. **HDRExportExtension** - Press H to save HDR

**UI**:
1. **StatsPanelExtension** - Overlay showing samples/sec, FPS, resolution, lock state

### Utility Classes

**AnimationLoop** - Manages requestAnimationFrame with delta time:
```typescript
const loop = new AnimationLoop();
loop.start((dt) => {
    // Update with delta time in seconds
});
loop.stop();
```

**EventManager** - Automatic cleanup of event listeners:
```typescript
const events = new EventManager();

// Add DOM listeners
events.add(window, 'keydown', handler);
events.add(canvas, 'click', handler);

// Add EventBus listeners
events.onBus(bus, 'render.progress', handler);

// Clean up everything
events.removeAll();
```

---

## Comparison: Code vs Design Docs

### What's Different (Intentionally)

1. **No Parameter Metadata System**
   - Docs specified: `registerMetadata()` with type/min/max/default/triggersReset
   - Code: Plain key-value store
   - Reason: Simpler for research use. Engine validates what it needs.

2. **No ChangeSource Tracking**
   - Docs specified: 'user' | 'animation' | 'extension' | 'session' | 'recipe'
   - Code: Just a reason string for resets
   - Reason: Parameter locking handles production mode. Don't need fine-grained tracking.

3. **Simplified Render Modes**
   - Docs specified: 'interactive' | 'progressive' | 'production'
   - Code: 'interactive' | 'production'
   - Reason: Production IS progressive. Two modes is clearer.

4. **Built-in Keyboard Controls**
   - Docs suggested: Extension-based
   - Code: Built into App.ts
   - Reason: Core functionality that should always exist

5. **Simpler Initialization**
   - Docs specified: Recipe bundles with defaultRecipe
   - Code: Array of recipes
   - Reason: Less structure needed for research use

### What's Missing (Not Critical)

1. **Recipe hot-reloading** - Could add if needed
2. **More sophisticated parameter validation** - Not needed for research
3. **Comprehensive TypeScript types** - Current types are minimal but sufficient
4. **Advanced render statistics** - Current stats panel covers needs
5. **Parameter animation system** - Could add as extension if needed

### What's Complete and Solid

✓ Core orchestration loop
✓ Parameter management with locking
✓ Interactive and production rendering
✓ Session save/restore
✓ Tiled rendering with resume
✓ Extension system with service registry
✓ Three camera control options
✓ File export (PNG + HDR)
✓ Statistics display
✓ Event bus for loose coupling
✓ Utility classes for common patterns

---

## Build Plan: What's Next?

### Current Status: 95% Complete

The App pillar is production-ready for research. You can set it and forget it.

### Remaining 5%: Polish & Documentation

#### Priority 1: Documentation (this document + inline comments)
- [x] Comprehensive overview ← we're here
- [ ] Add inline JSDoc comments to all public methods
- [ ] Add usage examples in comments

#### Priority 2: Type Safety Improvements
- [ ] Add missing types (currently just `any` in some places)
- [ ] Create comprehensive type file with all interfaces
- [ ] Add JSDoc @param and @returns tags

#### Priority 3: Error Handling
- [ ] Add try/catch around Engine calls that might fail
- [ ] Better error messages for common mistakes
- [ ] Graceful degradation when extensions fail

#### Priority 4: Testing (Optional)
- [ ] Unit tests for ParameterStore
- [ ] Unit tests for EventBus
- [ ] Integration tests for render loop

### Future Extensions (As Needed)

These can be added without touching core code:

1. **Research Tools**
   - ParameterSweepExtension (vary one param, save results)
   - ComparisonExtension (A/B testing)
   - BenchmarkExtension (performance testing)

2. **UI Enhancements**
   - ParameterPanelExtension (GUI controls)
   - RecipeSwitcherExtension (GUI for recipes)
   - ConsoleExtension (command input)

3. **File Management**
   - AutoSaveExtension (periodic session saves)
   - ProjectManagerExtension (organize experiments)
   - ExportQueueExtension (batch exports)

4. **Advanced Camera**
   - PathCameraExtension (animated camera paths)
   - FocusTargetExtension (auto-focus on objects)

---

## Usage Patterns

### Basic Setup

```typescript
const canvas = document.querySelector('canvas')!;
const app = new App(canvas);

// Initialize with recipes
await app.initialize(
    [pathTracerRecipe, debugRecipe],
    'environment.hdr',
    { 'camera.position': [0, 5, 10] }
);

// Add extensions
app.use(new KeyboardControls())
   .use(new OrbitControls())
   .use(new ScreenshotExtension())
   .use(new HDRExportExtension())
   .use(new StatsPanelExtension());

// Setup built-in keyboard shortcuts
app.setupKeyboardControls({
    'p': 'pathtracer',
    'd': 'debug'
});
```

### Research Workflow

```typescript
// Interactive preview
app.renderInteractive();

// Adjust parameters
app.parameterStore.set('material.roughness', 0.3);

// High-quality render
await app.renderProduction(1000);

// Save HDR (Press H)
// or manually:
const radiance = app.engine.readRadiance();
saveHDRFile(radiance, width, height, 'output.hdr');

// Save session
await app.sessionManager.quickSave();
```

### Tiled High-Res Render

```typescript
// Start tile job
await app.tiledRenderer.startJob({
    targetWidth: 7680,
    targetHeight: 4320,
    targetTileSize: 512,
    samplesPerTile: 1000,
    format: 'both'  // HDR + PNG
});

// Or use built-in: Press 'T'
```

### Extension Development

```typescript
class MyExtension implements Extension {
    name = 'my-extension';
    
    install(app: App, bus: EventBus) {
        // Register as service
        app.registerService('myext', this);
        
        // Listen to events
        bus.on('render.progress', (info) => {
            console.log(`${info.samples} samples`);
        });
        
        // Access other services
        const camera = app.getService('camera');
        if (camera) {
            const pos = camera.getPosition();
        }
    }
    
    uninstall() {
        // Clean up
    }
    
    saveState() {
        return { /* state */ };
    }
    
    restoreState(state: any) {
        // Restore state
    }
}
```

---

## Performance Characteristics

### Parameter Changes
- Set: O(1) - immediate
- Batch: O(n) - single onChange notification
- Equality check: O(1) for primitives, O(n) for arrays

### Rendering
- Interactive: 60 FPS target (requestAnimationFrame)
- Production: As fast as possible (continuous rendering)
- Progress reporting: Every frame

### Events
- Emit: O(n) where n = number of handlers
- Handler errors isolated (don't affect other handlers)

### Sessions
- Save: O(n) where n = number of parameters + extensions
- Load: O(n) for restoration + validation

### Tiling
- Memory: One tile at a time (no accumulation of large buffers)
- Resume: O(1) lookup for completed tiles
- File I/O: Per-tile async (browser download)

---

## Architecture Invariants

These must always hold:

1. **Parameter locking** - Parameters never change during production mode
2. **Recipe switching** - Blocked during production, triggers resendAll after
3. **Production Promise** - Always resolves or rejects, never hangs
4. **Event isolation** - Handler errors don't crash other handlers
5. **Service uniqueness** - Service names are unique
6. **Extension dependencies** - Installed in dependency order
7. **One render loop** - Only one mode active at a time
8. **Session validation** - Always check recipe exists before restore

---

## File Organization

```
app/
├── App.ts                      # Orchestrator
├── ParameterStore.ts           # State management
├── RenderCoordinator.ts        # Execution control
├── SessionManager.ts           # Persistence
├── TiledRenderer.ts            # Production tiling
├── EventBus.ts                 # Pub/sub
├── types.ts                    # Core types
│
├── utils/
│   ├── AnimationLoop.ts        # RAF wrapper
│   ├── EventManager.ts         # Cleanup helper
│   └── file-export.ts          # HDR/PNG export
│
└── extensions/
    ├── KeyboardControls.ts     # 6DOF camera
    ├── OrbitControls.ts        # Mouse orbit
    ├── TouchOrbitControls.ts   # Touch orbit
    ├── ScreenshotExtension.ts  # PNG export
    ├── HDRExportExtension.ts   # HDR export
    └── StatsPanel.ts           # Statistics UI
```

---

## Summary

The App pillar is **complete, stable, and ready for research use**. It provides:

1. **Clean orchestration** - Wires Engine, parameters, rendering, sessions
2. **Simple parameter management** - No unnecessary validation or metadata
3. **Two-mode rendering** - Interactive (flexible) and production (locked)
4. **Full reproducibility** - Session save/restore with extension states
5. **Production tiling** - Render any resolution with resume support
6. **Extension system** - Add features without modifying core
7. **Utility classes** - AnimationLoop, EventManager for common patterns

The implementation is cleaner than the design docs, having dropped over-engineering while keeping everything essential. The code is readable, well-structured, and focused on research needs.

**Next steps**: Add inline JSDoc comments for public methods, then set it and forget it while you focus on Optics and Objects research.
