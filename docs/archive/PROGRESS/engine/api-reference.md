# Engine API Reference

Complete API documentation for the Engine class and related components.

## Engine Class

### Constructor

```typescript
constructor(gl: WebGL2RenderingContext)
```

Creates a new engine instance.

**Parameters**:
- `gl` - WebGL2 rendering context

**Throws**:
- `Error` if required WebGL extensions are missing

**Example**:
```typescript
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2');
const engine = new Engine(gl);
```

---

### initialize

```typescript
initialize(recipes: Recipe[]): void
```

Initialize the engine with one or more recipes.

**Parameters**:
- `recipes` - Array of recipe descriptors

**Throws**:
- `Error` if already initialized
- `Error` if no recipes provided
- `Error` if recipe validation fails
- `Error` if uniform validation fails
- `Error` if shader compilation fails

**Side effects**:
- Validates all recipes
- Compiles shaders for all recipes
- Creates accumulation buffers per recipe
- Sets first recipe as active
- Changes state to 'running'

**Example**:
```typescript
engine.initialize([pathTracerRecipe, albedoRecipe]);
```

---

### selectRecipe

```typescript
selectRecipe(recipeId: string): void
```

Switch to a different recipe.

**Parameters**:
- `recipeId` - ID of recipe to activate

**Throws**:
- `Error` if recipe not found

**Side effects**:
- Switches shader programs
- Switches accumulation buffers
- Rebinds parameters
- Preserves sample count for recipe

**Example**:
```typescript
engine.selectRecipe('albedo');
```

---

### loadEnvironmentHDR

```typescript
async loadEnvironmentHDR(path: string): Promise<void>
```

Load HDR environment map and build importance sampling CDFs.

**Parameters**:
- `path` - URL to HDR file (.hdr format)

**Throws**:
- `Error` if fetch fails (404, network error, etc.)
- `Error` if file is invalid or corrupted
- `Error` if dimensions exceed GPU limits
- `Error` if texture creation fails

**Side effects**:
- Fetches and parses HDR file
- Creates RGB32F texture
- Builds CDF textures for importance sampling
- Binds textures to all recipe programs

**Example**:
```typescript
await engine.loadEnvironmentHDR('/hdri/studio.hdr');
```

---

### updateParameters

```typescript
updateParameters(changes: ParameterChanges): void
```

Update shader uniforms from parameter changes.

**Parameters**:
- `changes` - Object mapping parameter paths to changes

**Type**:
```typescript
type ParameterChanges = Record<string, {
    prev: any;
    next: any;
}>;
```

**Side effects**:
- Computes new uniform values
- Updates changed uniforms only
- May clear accumulation (if `triggersReset`)

**Example**:
```typescript
engine.updateParameters({
    'camera.fov': { prev: 60, next: 45 },
    'light.intensity': { prev: 10, next: 15 }
});
```

---

### renderFrame

```typescript
renderFrame(): void
```

Render one frame (accumulation + display + composite).

**Throws**:
- `Error` if not in 'running' state

**Side effects**:
- Swaps accumulation buffers
- Updates engine uniforms
- Executes main pass (accumulation)
- Executes display pass (tone mapping)
- Executes composite pass (screen output)
- Increments sample count

**Example**:
```typescript
function loop() {
    engine.renderFrame();
    requestAnimationFrame(loop);
}
loop();
```

---

### resize

```typescript
resize(width: number, height: number): void
```

Resize framebuffers to new dimensions.

**Parameters**:
- `width` - New width in pixels
- `height` - New height in pixels

**Side effects**:
- Resizes accumulation buffers (all recipes)
- Resizes RGB framebuffer
- Resets sample counts (clears accumulation)

**Example**:
```typescript
window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    engine.resize(canvas.width, canvas.height);
});
```

---

### clearAccumulation

```typescript
clearAccumulation(): void
```

Clear accumulation buffers and reset sample count.

**Side effects**:
- Clears ping and pong buffers to black
- Resets sample count to 0

**Example**:
```typescript
// User manually resets accumulation
engine.clearAccumulation();
```

---

### readRadiance

```typescript
readRadiance(rect?: Rectangle): Float32Array
```

Read HDR radiance values from accumulation buffer.

**Parameters**:
- `rect` - Optional rectangle to read (defaults to full buffer)

**Returns**:
- `Float32Array` with RGBA data (unbounded float values)

**Type**:
```typescript
interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
}
```

**Example**:
```typescript
// Read full buffer
const hdr = engine.readRadiance();
exportToEXR(hdr, width, height);

// Read region
const roi = engine.readRadiance({ x: 100, y: 100, width: 200, height: 200 });
```

---

### readRGB

```typescript
readRGB(rect?: Rectangle): Uint8Array
```

Read LDR RGB values from tone-mapped buffer.

**Parameters**:
- `rect` - Optional rectangle to read (defaults to full buffer)

**Returns**:
- `Uint8Array` with RGBA data (0-255 range)

**Example**:
```typescript
// Screenshot
const rgb = engine.readRGB();
exportToPNG(rgb, width, height);
```

---

### getCanvasSize

```typescript
getCanvasSize(): [number, number]
```

Get current canvas dimensions.

**Returns**:
- `[width, height]` tuple

**Example**:
```typescript
const [width, height] = engine.getCanvasSize();
```

---

### getAvailableRecipes

```typescript
getAvailableRecipes(): string[]
```

Get IDs of all loaded recipes.

**Returns**:
- Array of recipe IDs

**Example**:
```typescript
const recipeIds = engine.getAvailableRecipes();
// ['pathtracer', 'albedo', 'normals']
```

---

### getActiveRecipeId

```typescript
getActiveRecipeId(): string | null
```

Get ID of currently active recipe.

**Returns**:
- Recipe ID or `null` if not initialized

**Example**:
```typescript
const activeId = engine.getActiveRecipeId();
```

---

### getState

```typescript
getState(): EngineState
```

Get current engine state.

**Returns**:
- `'ready'` - Not initialized
- `'running'` - Initialized and rendering

**Example**:
```typescript
if (engine.getState() === 'running') {
    engine.renderFrame();
}
```

---

### isReady / isRunning

```typescript
isReady(): boolean
isRunning(): boolean
```

Check engine state.

**Example**:
```typescript
if (engine.isReady()) {
    engine.initialize(recipes);
}
```

---

### Tiled Rendering API

#### setPixelOffset

```typescript
setPixelOffset(x: number, y: number): void
```

Set pixel offset for tiled rendering.

**Parameters**:
- `x` - Horizontal offset in pixels
- `y` - Vertical offset in pixels

#### clearPixelOffset

```typescript
clearPixelOffset(): void
```

Reset pixel offset to (0, 0).

#### setImageSize

```typescript
setImageSize(width: number, height: number): void
```

Set full image size for tiled rendering.

**Parameters**:
- `width` - Full image width
- `height` - Full image height

#### clearImageSize

```typescript
clearImageSize(): void
```

Reset image size to framebuffer dimensions.

**Example**:
```typescript
// Render 4000x4000 image in 1000x1000 tiles
engine.setImageSize(4000, 4000);

for (let ty = 0; ty < 4; ty++) {
    for (let tx = 0; tx < 4; tx++) {
        engine.setPixelOffset(tx * 1000, ty * 1000);
        engine.resize(1000, 1000);

        for (let i = 0; i < 100; i++) {
            engine.renderFrame();
        }

        saveTile(engine.readRadiance(), tx, ty);
    }
}

engine.clearPixelOffset();
engine.clearImageSize();
```

---

### Debugging API

#### clearUniformCache

```typescript
clearUniformCache(): void
```

Clear uniform value cache (forces all uniforms to update next frame).

#### getCacheStats

```typescript
getCacheStats(): {
    total: number;
    skipped: number;
    skipRate: number;
}
```

Get uniform cache statistics.

**Returns**:
- `total` - Total uniform updates
- `skipped` - Skipped (unchanged) updates
- `skipRate` - Fraction of skipped updates

**Example**:
```typescript
const stats = engine.getCacheStats();
console.log(`Skip rate: ${(stats.skipRate * 100).toFixed(1)}%`);
```

---

### dispose

```typescript
dispose(): void
```

Dispose all GPU resources and reset engine.

**Side effects**:
- Deletes all framebuffers
- Deletes all textures
- Deletes all programs
- Clears all caches
- Resets state to 'ready'

**Example**:
```typescript
// Clean up before destroying engine
engine.dispose();
```

---

## Type Definitions

### Recipe

```typescript
interface Recipe {
    id: string;
    name: string;
    description?: string;

    world: {
        ambient: ModuleDescriptor;
        environment: ModuleDescriptor;
        scene: ModuleDescriptor;
        lighting: ModuleDescriptor;
    };

    optics: {
        camera: ModuleDescriptor;
        interaction: ModuleDescriptor;
        transport: ModuleDescriptor;
        accumulator: ModuleDescriptor;
        developer: ModuleDescriptor;
    };

    parameters?: Record<string, any>;

    config?: {
        targetSamples?: number;
        renderMode?: 'interactive' | 'progressive' | 'production';
    };
}
```

### ModuleDescriptor

```typescript
interface ModuleDescriptor {
    id: {
        kind: ModuleKind;
        name: string;
        version: string;
    };

    fragment: {
        constants?: string;
        uniforms?: string;
        functions: string;
    };

    uniformBindings?: UniformBinding[];
    parameters?: Record<string, ParameterMetadata>;
}
```

### UniformBinding

```typescript
interface UniformBinding {
    uniform: string;
    parameters: string[];
    type: UniformType;
    compute: (params: Record<string, any>) => any;
}
```

### ParameterMetadata

```typescript
interface ParameterMetadata {
    type: 'float' | 'int' | 'bool' | 'vec2' | 'vec3' | 'vec4' | 'color';
    default: any;
    range?: [number, number];
    step?: number;
    values?: number[];
    name?: string;
    unit?: string;
    group?: string;
    help?: string;
    triggersReset?: boolean;
}
```

### CompilationResult

```typescript
type CompilationResult =
    | {
        success: true;
        mainProgram: WebGLProgram;
        displayProgram: WebGLProgram;
        compositeProgram: WebGLProgram;
    }
    | {
        success: false;
        diagnostics: ShaderDiagnostics;
    };
```

### ValidationResult

```typescript
interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings?: string[];
}
```

---

## Error Codes

### Initialization Errors

- `Cannot initialize in state: running` - Already initialized
- `At least one recipe required` - Empty recipe array
- `Recipe validation failed` - Invalid recipe structure
- `Uniform validation failed` - Invalid uniform bindings
- `Failed to compile recipe` - Shader compilation failed

### Runtime Errors

- `Cannot render in state: ready` - Not initialized
- `Recipe not found: <id>` - Invalid recipe ID
- `Failed to load HDR: <reason>` - HDR loading failed

### Resource Errors

- `Float textures required but not supported` - Missing WebGL extension
- `Framebuffer incomplete` - Framebuffer creation failed
- `Failed to create texture` - Texture creation failed

---

## Event Flow

```
User Code
  └─> engine.initialize(recipes)
       ├─> Validate recipes
       ├─> Compile shaders
       ├─> Create resources
       └─> State → 'running'

  └─> Loop:
       engine.renderFrame()
         ├─> Prepare frame
         ├─> Update uniforms
         ├─> Execute passes
         └─> Finalize frame

  └─> engine.updateParameters(changes)
       └─> Update uniforms
            └─> May clear accumulation

  └─> engine.dispose()
       └─> Clean up resources
            └─> State → 'ready'
```

---

## Next Steps

- [Core Concepts](core-concepts.md) - Understanding modules and recipes
- [Rendering Pipeline](rendering-pipeline.md) - How rendering works
- [Resource Management](resource-management.md) - GPU resources
- [Guides](../guides/) - Practical tutorials
