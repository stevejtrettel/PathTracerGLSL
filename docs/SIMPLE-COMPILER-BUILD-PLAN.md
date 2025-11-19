# Build Plan: SimpleCompiler + FlexibleEngine

**Goal**: Validate the new Compiler-Engine architecture with a hardcoded "simple" compiler before building the real code generation system.

**Timeline**: ~12-18 hours total

---

## Phase 0: Foundation & Types (30-45 min)
**Goal**: Set up folder structure and define core TypeScript types

### Step 0.1: Create folder structure
- Create `src/compiler/` (for SimpleCompiler now, real Compiler later)
- Create `src/engine-new/` (will replace src/engine/ later)

### Step 0.2: Define core types in `src/compiler/types.ts`
- `SceneDescription` (minimal - just an id/name for now)
- `RenderStrategy` (minimal - just id: 'debug' | 'pathtracer')
- `CompiledRenderer` (shaders, pipeline, uniforms, sourceMap)
- `RenderPipeline` (framebuffers, passes, postFrame)
- `FramebufferConfig` (id, type, format)
- `RenderPass` (id, shader, inputs, output, execution)
- `ShaderProgram` (vertex, fragment)
- `SwapInstruction` (type, buffers)

**Deliverable**: Type file with all interfaces, no implementation yet

---

## Phase 1: SimpleCompiler (Hardcoded Renderers) (1-2 hours)
**Goal**: Create a compiler that outputs valid `CompiledRenderer` objects for 2 simple cases

### Step 1.1: Create `src/compiler/SimpleCompiler.ts` skeleton
- Constructor
- `compile(scene: SceneDescription, strategy: RenderStrategy): CompiledRenderer` method
- Internal method: `_generateDebugRenderer(): CompiledRenderer`
- Internal method: `_generatePathtracerRenderer(): CompiledRenderer`

### Step 1.2: Implement debug renderer generation
**What it should produce**:
- 1 shader: simple debug visualization (show UVs or normals or solid color)
- 1 framebuffer: screen
- 1 pass: draw once to screen
- No uniforms needed initially

**Strategy**: Hardcode GLSL strings - just prove the structure works

### Step 1.3: Implement pathtracer renderer generation
**What it should produce**:
- 2 shaders:
  - `pathtracer-main`: simple accumulation shader (can be very basic raymarching)
  - `pathtracer-display`: tone mapping to screen
- 3 framebuffers:
  - `accumulation` (type: double_buffer, format: rgba32f)
  - `screen` (type: screen)
- 2 passes:
  - Pass 1: pathtracer-main → accumulation_current (reads accumulation_previous)
  - Pass 2: pathtracer-display → screen (reads accumulation_current)
- postFrame: swap accumulation buffers

**Strategy**: Copy GLSL from existing test code, just reorganize into this structure

### Step 1.4: Add minimal uniform bindings
- For pathtracer: just `u_sample_count`, `u_resolution`, `u_time`
- Generate `UniformBinding[]` for parameter system hookup

**Deliverable**: SimpleCompiler that produces 2 valid CompiledRenderer objects

---

## Phase 2: FlexibleResourceManager (2-3 hours)
**Goal**: Dynamically create and manage GPU resources from `RenderPipeline` specification

### Step 2.1: Create `src/engine-new/FlexibleResourceManager.ts` skeleton
```typescript
class FlexibleResourceManager {
  private gl: WebGL2RenderingContext;
  private framebuffers: Map<string, WebGLFramebuffer | WebGLFramebuffer[]>;
  private textures: Map<string, WebGLTexture | WebGLTexture[]>;
  private activeRenderer: string | null;

  constructor(gl: WebGL2RenderingContext) {}

  loadRenderer(id: string, pipeline: RenderPipeline): void {}
  selectRenderer(id: string): void {}
  getFramebuffer(id: string): WebGLFramebuffer {}
  getTexture(id: string): WebGLTexture {}
  executeSwap(instruction: SwapInstruction): void {}
  resize(width: number, height: number): void {}
  cleanup(): void {}
}
```

### Step 2.2: Implement framebuffer creation
- Parse `FramebufferConfig[]` from pipeline
- For type='screen': return null (means default framebuffer)
- For type='texture': create single framebuffer + texture
- For type='double_buffer': create 2 framebuffers + 2 textures (ping-pong)
- Store with naming convention:
  - texture: `textureId`
  - double_buffer: `textureId_current`, `textureId_previous`

### Step 2.3: Implement texture getters
- `getTexture(id)`: resolve based on current/previous state
- `getFramebuffer(id)`: resolve based on current/previous state
- Handle both simple names ('accumulation') and qualified names ('accumulation_current')

### Step 2.4: Implement swap logic
- `type='swap'`: for double_buffer, flip current↔previous pointers
- `type='rotate'`: for queues (not needed initially, can stub)

### Step 2.5: Implement resize
- For each texture, regenerate at new size
- Reattach to framebuffers

**Deliverable**: ResourceManager that creates GPU resources from pipeline spec

---

## Phase 3: FlexibleRenderExecutor (2-3 hours)
**Goal**: Generic pass execution engine that reads `RenderPipeline` and executes it

### Step 3.1: Create `src/engine-new/FlexibleRenderExecutor.ts` skeleton
```typescript
class FlexibleRenderExecutor {
  private gl: WebGL2RenderingContext;
  private programs: Map<string, WebGLProgram>;
  private resourceManager: FlexibleResourceManager;
  private quadVAO: WebGLVertexArrayObject;

  constructor(gl: WebGL2RenderingContext, resourceManager: FlexibleResourceManager) {}

  loadShaders(shaders: Map<string, ShaderProgram>): void {}
  executePass(pass: RenderPass): void {}
  executePipeline(pipeline: RenderPipeline): void {}
}
```

### Step 3.2: Implement shader compilation
- `loadShaders()`: compile vertex + fragment for each shader
- Store compiled `WebGLProgram` in map by shader id
- Add error handling (use existing shader error system if possible)

### Step 3.3: Implement pass execution
- `executePass()`:
  1. Bind output framebuffer (from resourceManager)
  2. Use shader program
  3. Bind input textures to texture units
  4. Set standard uniforms (u_resolution, etc.)
  5. Draw fullscreen quad
  6. Clear if needed

### Step 3.4: Implement pipeline execution
- `executePipeline()`:
  1. Iterate through passes in order
  2. Execute each pass
  3. After all passes, execute postFrame swaps (if any)

### Step 3.5: Create fullscreen quad VAO
- Setup in constructor
- Simple quad with positions + UVs

**Deliverable**: RenderExecutor that can execute arbitrary pipelines

---

## Phase 4: FlexibleEngine Integration (1-2 hours)
**Goal**: Wire together Compiler → Engine flow with multi-renderer support

### Step 4.1: Create `src/engine-new/FlexibleEngine.ts`
```typescript
class FlexibleEngine {
  private gl: WebGL2RenderingContext;
  private resourceManager: FlexibleResourceManager;
  private renderExecutor: FlexibleRenderExecutor;
  private parameterManager: ParameterManager; // reuse existing!

  private renderers: Map<string, CompiledRenderer>;
  private activeRenderer: string | null;

  constructor(canvas: HTMLCanvasElement) {}

  loadRenderer(id: string, renderer: CompiledRenderer): void {}
  loadRenderers(renderers: CompiledRenderer[]): void {}
  selectRenderer(id: string): void {}
  renderFrame(): void {}
  updateParameter(name: string, value: any): void {}
}
```

### Step 4.2: Implement renderer loading
- `loadRenderer()`:
  1. Store renderer in map
  2. Load shaders into executor
  3. Load pipeline into resourceManager
  4. Register uniforms with parameterManager

### Step 4.3: Implement rendering
- `renderFrame()`:
  1. Get active renderer's pipeline
  2. Execute pipeline
  3. That's it! (All logic is in executor now)

### Step 4.4: Implement parameter updates
- `updateParameter()`: delegate to parameterManager
- ParameterManager updates uniforms for all programs

**Deliverable**: Working FlexibleEngine that can load and switch between renderers

---

## Phase 5: App Hookup & First Render (1-2 hours)
**Goal**: Get something visible on screen using new architecture

### Step 5.1: Create test file `examples/test-simple-compiler.ts`
```typescript
import { SimpleCompiler } from '../src/compiler/SimpleCompiler';
import { FlexibleEngine } from '../src/engine-new/FlexibleEngine';

// Create scene and strategy
const scene = { id: 'test-scene' };
const debugStrategy = { id: 'debug' };
const pathtracerStrategy = { id: 'pathtracer' };

// Compile renderers
const compiler = new SimpleCompiler();
const debugRenderer = compiler.compile(scene, debugStrategy);
const pathtracerRenderer = compiler.compile(scene, pathtracerStrategy);

// Create engine and load
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const engine = new FlexibleEngine(canvas);
engine.loadRenderers([debugRenderer, pathtracerRenderer]);

// Start with debug
engine.selectRenderer('debug');
engine.renderFrame();

// Animation loop
function animate() {
  engine.renderFrame();
  requestAnimationFrame(animate);
}
animate();
```

### Step 5.2: Create minimal HTML test page
- `examples/test-simple-compiler.html`
- Just canvas + script tag
- Keep it simple for testing

### Step 5.3: First visual test
- Run test page
- Should see debug renderer output
- Switch to pathtracer (manually in code)
- Should see accumulation working

**Deliverable**: Working end-to-end demo with visible output

---

## Phase 6: Validation & Polish (1-2 hours)
**Goal**: Verify correctness, add debugging, clean up

### Step 6.1: Add renderer switching UI
- Simple buttons to switch between debug/pathtracer
- Verify switching works smoothly
- Verify resources clean up correctly

### Step 6.2: Add parameter controls
- Test that parameter updates work
- Add simple UI for parameters (can reuse existing parameter panel)

### Step 6.3: Performance check
- Verify no obvious performance regressions
- Check for resource leaks (textures, framebuffers)
- Verify resize works correctly

### Step 6.4: Documentation
- Add comments to key methods
- Document the flow: Compiler → CompiledRenderer → Engine
- Note any limitations of SimpleCompiler

**Deliverable**: Polished, validated SimpleCompiler + FlexibleEngine system

---

## Phase 7: Integration with App Layer (Optional - 2-3 hours)
**Goal**: Hook up to existing App infrastructure if desired

### Step 7.1: Update App.ts to use FlexibleEngine
- Replace Engine with FlexibleEngine
- Keep everything else the same
- App shouldn't need major changes

### Step 7.2: Test with existing extensions
- Screenshot extension
- Parameter panel
- Orbit controls
- Production render

**Deliverable**: Full app working with new engine architecture

---

## Summary Timeline

| Phase | Time Estimate | Key Deliverable |
|-------|---------------|-----------------|
| 0: Foundation | 30-45 min | Type definitions |
| 1: SimpleCompiler | 1-2 hours | 2 working renderer specs |
| 2: ResourceManager | 2-3 hours | Dynamic GPU resources |
| 3: RenderExecutor | 2-3 hours | Generic pass execution |
| 4: Engine Integration | 1-2 hours | Working FlexibleEngine |
| 5: First Render | 1-2 hours | Visible output! |
| 6: Validation | 1-2 hours | Polished system |
| 7: App Integration | 2-3 hours | Full app working |
| **Total** | **~12-18 hours** | **Validated architecture** |

---

## Key Decisions

1. **Phase 1**: Start with minimal shaders (solid colors, UVs), upgrade to real raymarching if needed
2. **Phase 3**: Implement only `execution.type: 'once'` initially, stub 'loop' for later
3. **Phase 5**: Build standalone test first, App integration second

---

## Notes

- SimpleCompiler is temporary - will be replaced with real Compiler later
- Focus is on validating the architecture, not performance
- Keep existing Engine/App working during development
- This validates the RenderPipeline contract before building real code generation
