# App Layer Integration Discussion

This document discusses how the existing `App` class should integrate with the new `FlexibleEngine` and what design questions need to be resolved.

## Current State

### Existing App Architecture
The old `App` class (`src/app/App.ts`) currently:
- Creates and owns the old `Engine` instance
- Manages scene loading/switching
- Handles parameter UI generation
- Provides file export (HDR, PNG screenshots)
- Manages camera controls
- Integrates extensions (HDR export, screenshots, etc.)
- Is already **async** (loads scenes, textures)

### New FlexibleEngine
The new architecture requires:
- `Compiler` generates `CompiledRenderer` from scene + strategy
- `FlexibleEngine` loads and executes renderers
- Export via `engine.readExport('hdr')` instead of direct buffer access

## Key Design Questions

### 1. Where Does Compilation Happen?

**Options:**

#### Option A: App Owns Compiler
```typescript
class App {
    private compiler: ICompiler;
    private engine: FlexibleEngine;

    async loadScene(sceneId: string) {
        const scene = await this.loadSceneDescription(sceneId);
        const strategy = this.currentStrategy;
        const renderer = this.compiler.compile(scene, strategy);
        this.engine.loadRenderer(renderer);
    }
}
```

**Pros:**
- App controls compilation timing
- Easy to switch strategies (recompile with new strategy)
- Can cache compiled renderers

**Cons:**
- App needs to know about Compiler
- More complex App logic

#### Option B: Engine Owns Compiler
```typescript
class FlexibleEngine {
    private compiler: ICompiler;

    async loadScene(scene: SceneDescription, strategy: RenderStrategy) {
        const renderer = this.compiler.compile(scene, strategy);
        this.loadRenderer(renderer);
    }
}
```

**Pros:**
- Simpler App interface
- Engine hides compilation details

**Cons:**
- Less flexible (can't pre-compile)
- Harder to support multiple compilers

#### Option C: Separate Compilation Service
```typescript
class CompilerService {
    async compileScene(sceneId: string, strategyId: string): Promise<CompiledRenderer> {
        const scene = await loadScene(sceneId);
        const strategy = await loadStrategy(strategyId);
        return compiler.compile(scene, strategy);
    }
}

class App {
    private compilerService: CompilerService;
    private engine: FlexibleEngine;

    async loadScene(sceneId: string) {
        const renderer = await this.compilerService.compileScene(sceneId, this.strategyId);
        this.engine.loadRenderer(renderer);
    }
}
```

**Pros:**
- Separation of concerns
- Could support remote compilation (web workers, server)
- Easy to add caching layer

**Cons:**
- More abstraction layers
- Overkill for simple use cases?

**Question:** Which approach fits our use case best?

---

### 2. Scene Description Loading

**Current:** App loads scenes as JSON/code (old format)

**New:** Compiler needs `SceneDescription` objects

**Options:**

#### Option A: Convert Old → New
```typescript
async loadScene(sceneId: string) {
    const oldScene = await loadOldSceneFormat(sceneId);
    const newScene = convertToSceneDescription(oldScene);
    // ... compile and load
}
```

**Pros:**
- Backward compatible
- Gradual migration

**Cons:**
- Conversion overhead
- Two scene formats to maintain

#### Option B: New Format Only
```typescript
async loadScene(sceneId: string) {
    const scene: SceneDescription = await loadSceneDescription(sceneId);
    // ... compile and load
}
```

**Pros:**
- Clean break
- Single source of truth

**Cons:**
- Must rewrite all scenes
- Breaking change

**Question:** Do we need backward compatibility? How many existing scenes are there?

---

### 3. Strategy Selection

**Current:** Strategies might be hardcoded or implicit

**New:** `RenderStrategy` objects define algorithms

**Interface:**

```typescript
interface RenderStrategy {
    id: string;
    algorithms?: {
        transport?: string;      // 'unidirectional', 'bidirectional', 'photon_map'
        sampling?: string;       // 'bsdf', 'light', 'mis'
        accumulation?: string;   // 'progressive', 'adaptive'
    };
    settings?: {
        maxBounces?: number;
        samplesPerFrame?: number;
        debugOutput?: 'albedo' | 'normal' | 'depth' | 'uv';
    };
}
```

**Questions:**
- How does user select strategy? (UI dropdown? Config file?)
- Can user modify strategy settings at runtime?
- Should App provide preset strategies?

**Example Presets:**
```typescript
const STRATEGIES = {
    debug: { id: 'debug', settings: { debugOutput: 'uv' } },
    preview: { id: 'pathtracer', settings: { maxBounces: 3 } },
    production: { id: 'pathtracer', settings: { maxBounces: 8 } },
    mis: { id: 'pathtracer', algorithms: { sampling: 'mis' } }
};
```

---

### 4. Parameter UI Generation

**Current:** App generates UI from parameter metadata

**New:** `CompiledRenderer.parameters` provides metadata

**Questions:**
- Does parameter UI regenerate when renderer switches?
- How to handle renderer-specific parameters?
- Should we preserve parameter values when switching renderers?

**Example Flow:**
```typescript
engine.selectRenderer('pathtracer-scene1');
const params = engine.getParameters();  // From active renderer
ui.generateParameterControls(params);   // Rebuild UI
```

**Consideration:** If two renderers have the same parameter (e.g., `maxBounces`), preserve the value when switching?

---

### 5. File Export Integration

**Old API:**
```typescript
app.exportHDR();      // Reads internal buffer, exports EXR
app.exportPNG();      // Reads internal buffer, exports PNG
```

**New API:**
```typescript
const hdrData = engine.readExport('hdr');    // Float32Array
const ldrData = engine.readExport('ldr');    // Uint8Array

exportToEXR(hdrData, width, height);         // Utility function
exportToPNG(ldrData, width, height);         // Utility function
```

**Questions:**
- Should export utilities live in App? Separate module?
- Do we preserve old `app.exportHDR()` as convenience wrappers?
- How to handle multi-export renderers (HDR + albedo + normal)?

**Possible App API:**
```typescript
class App {
    exportHDR(filename?: string) {
        const data = this.engine.readExport('hdr');
        const [width, height] = this.engine.getCanvasSize();
        return exportToEXR(data, width, height, filename);
    }

    exportAOV(aovName: string, filename?: string) {
        const data = this.engine.readExport(aovName);
        const [width, height] = this.engine.getCanvasSize();
        // Export based on format...
    }

    getAvailableExports(): string[] {
        return this.engine.getExportNames();
    }
}
```

---

### 6. Extension System

**Current:** Extensions hook into App/Engine

**New:** Extensions should work with FlexibleEngine

**Examples:**
- `HDRExportExtension` - Add HDR export button
- `ScreenshotExtension` - Add screenshot button
- Custom AOV viewers?

**Questions:**
- Do extensions register with App or Engine?
- How do extensions discover available exports?
- Should extensions be renderer-aware?

---

### 7. Camera Controls

**Current:** App handles camera controls, updates parameters

**New:** Camera is part of `SceneDescription`

**Questions:**
- Does camera state live in scene or separately?
- How to handle interactive camera (orbit, pan)?
- Should camera changes trigger recompilation?

**Options:**

#### Option A: Camera in Scene (Static)
- Scene has fixed camera
- No runtime camera controls
- Simple but limiting

#### Option B: Camera as Parameter
- Camera exposed via parameter system
- UI can modify camera parameters
- No recompilation needed

#### Option C: Camera State Separate
```typescript
class App {
    private cameraState: CameraState;

    updateCamera() {
        // Update camera state from mouse/keyboard
        // Push to parameter system
        parameterManager.set('camera.position', this.cameraState.position);
        parameterManager.set('camera.target', this.cameraState.target);
        // ...
    }
}
```

---

### 8. Multiple Renderers

**Question:** Should App support loading multiple renderers simultaneously?

**Use Cases:**
- Compare different strategies side-by-side
- A/B testing
- Debug view + production view

**Implications:**
- More complex UI (which renderer is active?)
- More memory usage
- Renderer switching must be efficient

**Possible App API:**
```typescript
class App {
    async loadRenderers(configs: RendererConfig[]) {
        const renderers = await Promise.all(
            configs.map(c => this.compile(c.scene, c.strategy))
        );
        this.engine.loadRenderers(renderers);
    }

    selectRenderer(id: string) {
        this.engine.selectRenderer(id);
        this.updateUI();  // Update parameter UI for new renderer
    }
}
```

---

### 9. Error Handling

**Questions:**
- How should App handle compilation errors?
- How should App handle shader compilation errors?
- Should App provide error UI?

**Example:**
```typescript
async loadScene(sceneId: string) {
    try {
        const renderer = await this.compile(sceneId);
        this.engine.loadRenderer(renderer);
    } catch (error) {
        if (error instanceof CompilationError) {
            this.showCompilationError(error);
        } else if (error instanceof ShaderError) {
            this.showShaderError(error);
        } else {
            this.showGenericError(error);
        }
    }
}
```

---

### 10. Async Considerations

**Current:** App is already async

**Questions:**
- Should compilation be async (even if not needed now)?
- How to show loading state during compilation?
- Should we support progressive loading (compile passes incrementally)?

**Future Considerations:**
- Web Workers for compilation
- Server-side compilation
- Streaming compilation results

---

## Proposed Minimal App Integration

Based on the above questions, here's a minimal viable integration:

```typescript
class App {
    private compiler: SimpleCompiler;  // Will become real Compiler
    private engine: FlexibleEngine;
    private parameterUI: ParameterUI;

    constructor(canvas: HTMLCanvasElement) {
        const gl = canvas.getContext('webgl2')!;
        this.compiler = new SimpleCompiler();
        this.engine = new FlexibleEngine(gl);
        this.parameterUI = new ParameterUI(/* ... */);
    }

    /**
     * Load and render a scene with a strategy
     */
    async loadScene(sceneId: string, strategyId: string = 'pathtracer') {
        // 1. Load scene description
        const scene = await this.loadSceneDescription(sceneId);

        // 2. Get strategy
        const strategy = this.getStrategy(strategyId);

        // 3. Compile
        const renderer = this.compiler.compile(scene, strategy);

        // 4. Load into engine
        this.engine.loadRenderer(renderer);
        this.engine.selectRenderer(renderer.id);

        // 5. Update parameter UI
        this.updateParameterUI();

        // 6. Start rendering
        this.startRenderLoop();
    }

    /**
     * Switch strategy (recompile current scene)
     */
    async switchStrategy(strategyId: string) {
        const scene = this.currentScene;
        const strategy = this.getStrategy(strategyId);
        const renderer = this.compiler.compile(scene, strategy);

        this.engine.loadRenderer(renderer);
        this.engine.selectRenderer(renderer.id);
        this.updateParameterUI();
    }

    /**
     * Export HDR
     */
    async exportHDR(filename?: string) {
        const data = this.engine.readExport('hdr');
        const [width, height] = this.engine.getCanvasSize();
        return exportToEXR(data, width, height, filename);
    }

    /**
     * Export screenshot
     */
    async exportScreenshot(filename?: string) {
        const data = this.engine.readExport('ldr');
        const [width, height] = this.engine.getCanvasSize();
        return exportToPNG(data, width, height, filename);
    }

    /**
     * Render loop
     */
    private startRenderLoop() {
        const loop = () => {
            this.engine.renderFrame();
            this.updateStats();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    private updateParameterUI() {
        const params = this.engine.getActiveRenderer()?.parameters || {};
        this.parameterUI.rebuild(params);
    }

    private updateStats() {
        this.statsUI.update({
            samples: this.engine.getSampleCount(),
            fps: this.fpsTracker.getFPS()
        });
    }
}
```

---

## Open Questions Summary

1. **Where does compilation happen?** (App, Engine, or Service?)
2. **Scene format:** Backward compatible or new format only?
3. **Strategy selection:** UI? Presets? Runtime modification?
4. **Parameter persistence:** Preserve values when switching renderers?
5. **Export integration:** Convenience wrappers or direct API?
6. **Extension system:** How to adapt to new architecture?
7. **Camera controls:** Static, parameter-based, or separate state?
8. **Multiple renderers:** Support simultaneous loading?
9. **Error handling:** How to surface compilation/shader errors?
10. **Async loading:** Progressive compilation? Loading states?

---

## Next Steps

Before implementing App integration:

1. **Answer design questions** (above)
2. **Define scene description format** (if not using old format)
3. **Define strategy presets** (debug, preview, production, etc.)
4. **Plan parameter UI update strategy**
5. **Design export API** (wrappers vs direct access)
6. **Consider extension system migration**

Once design is settled:
- Prototype minimal App integration
- Test with existing scenes (or converted scenes)
- Verify parameter UI works correctly
- Test export functionality
- Add error handling
- Update documentation
