
## Core Engine Types

### Engine State

```typescript
type EngineState = 
  | { type: "uninitialized" }
  | { type: "ready" }
  | { type: "running"; program: CompiledProgram; frame: number; recipeId: string }
  | { type: "error"; error: Error; recoverable: boolean };

interface EngineStateInfo {
  width: number;                      // Viewport width
  height: number;                     // Viewport height
  frameIndex: number;                 // Current frame number
  sampleCount: number;                // Accumulation sample count
  time: number;                       // Seconds since start
}
```

### Recipe and Module References

```typescript
interface Recipe {
  id: string;                         // Unique recipe identifier (cache key)
  name: string;                       // Human-readable name
  
  world: {
    geometry: ModuleReference;       // Mathematical space (euclidean, hyperbolic, etc.)
    scene: ModuleReference;           // Objects, materials, intersection (compiled)
    lighting: ModuleReference;        // Light sources and sampling (compiled)
  };
  
  photography: {
    camera: ModuleReference;          // Ray generation
    transport: ModuleReference;       // Integration algorithms
    interaction: ModuleReference;     // Light-matter physics
    film: ModuleReference;            // Accumulation
    developer: ModuleReference;       // Tone mapping
  };
  
  parameters?: ParameterOverrides;   // Initial parameter values
}

interface ModuleReference {
  kind: ModuleKind;
  name: string;                       // Specific implementation (e.g., "disney", "pathtracer")
}

type ModuleKind = 
  | 'geometry'      // World: mathematical structure
  | 'scene'         // World: objects and materials (compiled)
  | 'lighting'      // World: light sources (compiled)
  | 'camera'        // Photography: ray generation
  | 'transport'     // Photography: integration algorithms  
  | 'interaction'   // Photography: light-matter physics
  | 'film'          // Photography: accumulation
  | 'developer';    // Photography: tone mapping

interface ParameterOverrides {
  [path: string]: any;               // e.g., "camera.position": [0, 5, 10]
}
```

## Module Types

### Module Descriptor

```typescript
interface ModuleDescriptor {
  id: {
    kind: ModuleKind;
    name: string;                    // Specific implementation name
    version: string;
  };
  
  fragment: {
    functions: string;               // GLSL with KIND-prefixed functions
    uniforms?: string;              // Uniform declarations  
    constants?: string;             // #define statements
  };
  
  parameters?: ParameterDescriptor[];
  
  resources?: {
    textures?: TextureResourceSpec[];
  };
  
  metadata?: {
    author?: string;
    description?: string;
    tags?: string[];
  };
}

interface ParameterDescriptor {
  name: string;
  type: GLSLType;
  default: any;
  min?: number;
  max?: number;
  step?: number;
}

type GLSLType = 
  | 'float' | 'vec2' | 'vec3' | 'vec4'
  | 'int' | 'ivec2' | 'ivec3' | 'ivec4'
  | 'bool' | 'mat3' | 'mat4'
  | 'sampler2D' | 'samplerCube';
```

### Module Collection

```typescript
interface ModuleCollection {
  geometry: ModuleDescriptor;        // Mathematical foundation
  scene: ModuleDescriptor;           // Objects and material properties
  lighting: ModuleDescriptor;        // Light sampling strategies
  camera: ModuleDescriptor;          // Ray generation
  transport: ModuleDescriptor;       // Integration algorithms
  interaction: ModuleDescriptor;     // BRDFs and phase functions
  film: ModuleDescriptor;            // Accumulation
  developer: ModuleDescriptor;       // Tone mapping
}

interface ModuleQuery {
  kind?: ModuleKind;
  name?: string;                    // Partial match
  tags?: string[];
}
```

## Compilation Types (Simplified)

### Compiled Program

```typescript
interface CompiledProgram {
  id: string;                        // Unique program identifier
  recipeId: string;                  // Recipe.id for easy lookup
  program: WebGLProgram;             // GPU program object
  uniformMap: UniformMap;            // Parameter → uniform mappings
  recipe: Recipe;                    // Source recipe
  modules: ModuleDescriptor[];      // Modules used
  
  metadata: {
    compiledAt: number;             // Timestamp
    compileTime: number;            // Milliseconds to compile
    vertexSource: string;           // For debugging
    fragmentSource: string;         // For debugging
  };
}

interface CompilationReport {
  recipesCompiled: number;
  recipesSucceeded: number;
  recipesFailed: number;
  totalTime: number;
  averageTime: number;
  programs: Array<{
    recipeId: string;
    success: boolean;
    time: number;
    error?: string;
  }>;
}
```

## Uniform Types (Simplified)

### Uniform Mapping

```typescript
interface UniformMap {
  recipeId: string;                  // Which recipe this is for
  mappings: Map<string, UniformMapping>;
  
  getMapping(paramPath: string): UniformMapping | undefined;
  getAllMappings(): UniformMapping[];
  debugPrint(): void;
}

interface UniformMapping {
  paramPath: string;                 // "camera.position"  
  glslName: string;                  // "u_camera_position"
  location: WebGLUniformLocation | null;
  type: GLSLType;
  
  // Simplified metadata
  moduleSource: string;              // Which module defined this
}
```

### Parameter Changes

```typescript
interface ParameterChanges {
  changes: Array<{
    path: string;                    // "camera.position"
    oldValue: any;
    newValue: any;
    timestamp: number;
  }>;
  
  source: 'user' | 'animation' | 'reset' | 'initialization';
  triggersReset: boolean;            // Requires film buffer clear
}
```

## Resource Types

### Capability Types

```typescript
interface CapabilityReport {
  // Critical capabilities
  webgl2: boolean;
  floatRenderTargets: boolean;
  floatLinearFiltering: boolean;
  
  // Limits
  maxTextureSize: number;
  maxTextureUnits: number;
  maxColorAttachments: number;
  maxViewportDims: [number, number];
  maxRenderBufferSize: number;
  maxVertexAttributes: number;
  maxFragmentUniforms: number;
  
  // Optional features
  depthTexture: boolean;
  anisotropicFiltering: boolean;
  maxAnisotropy: number;
  
  // Platform info
  vendor: string;
  renderer: string;
  glVersion: string;
  shadingLanguageVersion: string;
}

interface FallbackSuggestion {
  capability: string;
  issue: string;
  suggestion: string;
  alternativeModule?: ModuleReference;
  reducedFeatures?: string[];
}
```

### Texture and Framebuffer Types

```typescript
interface TextureSpec {
  id: string;
  width: number;
  height: number;
  format: TextureFormat;
  type: DataType;
  
  filter?: FilterMode;
  wrap?: WrapMode;
  data?: ArrayBufferView | null;
  
  usage: 'film' | 'asset' | 'temporary';
  persistent?: boolean;              // Needs double-buffering
}

enum TextureFormat {
  RGB = 0x1907,
  RGBA = 0x1908,
  RGB32F = 0x8815,
  RGBA32F = 0x8814,
  RGB16F = 0x881B,
  RGBA16F = 0x881A,
  R32F = 0x822E,
  RG32F = 0x8230,
  R32I = 0x8235,
}

enum DataType {
  UNSIGNED_BYTE = 0x1401,
  FLOAT = 0x1406,
  HALF_FLOAT = 0x140B,
  INT = 0x1404,
}

enum FilterMode {
  NEAREST = 0x2600,
  LINEAR = 0x2601,
}

enum WrapMode {
  REPEAT = 0x2901,
  CLAMP_TO_EDGE = 0x812F,
  MIRRORED_REPEAT = 0x8370,
}

interface Texture {
  id: string;
  glTexture: WebGLTexture;
  spec: TextureSpec;
  boundUnit?: number;
  memoryBytes: number;
  lastUsedFrame?: number;
}

interface FramebufferSpec {
  id: string;
  attachments: Array<{
    type: 'color' | 'depth' | 'stencil';
    index?: number;
    texture?: Texture;
    format?: TextureFormat;
  }>;
  width: number;
  height: number;
}

interface Framebuffer {
  id: string;
  glFramebuffer: WebGLFramebuffer;
  spec: FramebufferSpec;
  complete: boolean;
  attachedTextures: string[];
}
```

### Film Resource Types (Per-Recipe)

```typescript
interface FilmManifest {
  textures: Array<{
    name: string;                    // 'radiance', 'variance'
    format: TextureFormat;
    persistent: boolean;             // Needs ping-pong
  }>;
  clearColor: [number, number, number, number];
}

interface FilmResources {
  recipeId: string;                  // Which recipe owns these
  textures: Map<string, Texture>;
  framebuffers: {
    current: Framebuffer;            // Being written to
    previous: Framebuffer;           // Being read from
  };
  manifest: FilmManifest;
  needsSwap: boolean;
}

interface TextureResourceSpec {
  name: string;
  type: 'texture2D' | 'textureCube';
  format: string;                    // 'rgba32f', 'rgba16f', etc.
  persistent?: boolean;
}
```

## Rendering Types

### Frame Configuration

```typescript
interface FrameConfig {
  // Clear options
  clear?: boolean;
  clearColor?: [number, number, number, number];
  
  // Viewport
  viewport?: Viewport;
  
  // Target
  target?: RenderTarget;
  
  // Buffer management
  swapBuffers?: boolean;              // Swap film buffers after
}

interface ClearConfig {
  color?: [number, number, number, number];
  depth?: number;
  stencil?: number;
  buffers?: {
    color?: boolean;
    depth?: boolean;
    stencil?: boolean;
  };
}

type RenderTarget = 
  | { type: "screen" }
  | { type: "framebuffer"; id: string }
  | { type: "framebuffer"; buffer: WebGLFramebuffer };

interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

### Render State

```typescript
interface RenderState {
  // Bindings
  viewport: Viewport;
  framebuffer: WebGLFramebuffer | null;
  program: WebGLProgram | null;
  vao: WebGLVertexArrayObject | null;
  
  // Clear values
  clearColor: [number, number, number, number];
  clearDepth: number;
  clearStencil: number;
  
  // Features
  features: {
    blend: boolean;
    cullFace: boolean;
    depthTest: boolean;
    scissorTest: boolean;
    stencilTest: boolean;
  };
}
```

## Performance Types

```typescript
interface FrameStats {
  // Timing
  frameTime: number;
  averageFrameTime: number;
  minFrameTime: number;
  maxFrameTime: number;
  
  // Counts
  frameNumber: number;
  drawCalls: number;
  triangles: number;
  
  // Performance
  fps: number;
  averageFps: number;
  
  // Timestamps
  timestamp: number;
  startTimestamp: number;
}

interface MemoryStats {
  textureMemory: number;              // Bytes
  framebufferMemory: number;
  totalMemory: number;
  textureCount: number;
  framebufferCount: number;
  largestTexture: string;
  lastCleanup: number;
}

interface PerformanceReport {
  frame: FrameStats;
  memory: MemoryStats;
  compilation: CompilationReport;
  
  overall: {
    state: string;
    framesRendered: number;
    programsCompiled: number;
    currentRecipeId?: string;
    uptime: number;
  };
}
```

## Validation Types

```typescript
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
  suggestions?: string[];
  context?: string;                  // Line context for errors
}

interface CompatibilityResult {
  compatible: boolean;
  missing: Array<{ kind: ModuleKind; name: string }>;
  issues: string[];
  suggestions?: ModuleSuggestion[];
}

interface ModuleSuggestion {
  missing: { kind: ModuleKind; name: string };
  alternatives: ModuleDescriptor[];
  reason: string;
}
```

## Error Types

```typescript
class EngineError extends Error {
  constructor(
    message: string,
    public subsystem: string,
    public recoverable: boolean = false
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

class CompilationError extends EngineError {
  constructor(
    message: string,
    public validation: ValidationResult,
    public module?: string,
    public line?: number
  ) {
    super(message, 'SimpleCompiler', false);
  }
}

class ResourceAllocationError extends EngineError {
  constructor(
    public resourceType: string,
    public requested: number,
    public available?: number
  ) {
    super(
      `Failed to allocate ${resourceType}`,
      'ResourceManager',
      true
    );
  }
}

class ModuleNotFoundError extends EngineError {
  constructor(
    public kind: ModuleKind,
    public name: string,
    public alternatives?: string[]
  ) {
    super(
      `Module ${kind}:${name} not found`,
      'ModuleRegistry',
      false
    );
  }
}
```

## Constants

```typescript
// Fixed module concatenation order
const MODULE_ORDER: ModuleKind[] = [
  'geometry',      // Mathematical foundation
  'scene',         // Objects and material data (compiled)
  'lighting',      // Light sources (compiled)
  'camera',        // Ray generation
  'transport',     // Integration algorithms
  'interaction',   // Light-matter physics
  'film',          // Accumulation
  'developer'      // Tone mapping
];

// Texture unit reservations
const TEXTURE_UNITS = {
  FILM_START: 0,
  FILM_END: 7,
  MATERIAL_START: 8,
  MATERIAL_END: 15,
  GENERAL_START: 16,
  GENERAL_END: 31,
};

// Engine limits
const LIMITS = {
  MAX_RECIPES: 10,
  MAX_COMPILE_TIME: 2000,              // Simpler compilation is faster
  MAX_TEXTURE_SIZE_DEFAULT: 4096,
};

// Default values
const DEFAULTS = {
  VIEWPORT: { x: 0, y: 0, width: 1920, height: 1080 },
  CLEAR_COLOR: [0, 0, 0, 0] as [number, number, number, number],
};
```

## Module Writing Convention

Modules MUST use their KIND as prefix for all public functions:

```glsl
// ============ Example: Camera Module (any implementation) ============
uniform vec3 u_camera_position;
uniform vec3 u_camera_target;

// CORRECT - prefixed with module KIND
Ray camera_generateRay(vec2 pixel) {
  // Implementation
}

// WRONG - using specific module name
Ray pinhole_generateRay(vec2 pixel) {
  // This will fail validation
}

// ============ Example: Interaction Module (any implementation) ============
uniform vec3 u_material_albedo;

// CORRECT - all required functions use KIND prefix
Spectrum interaction_surface_shade(vec3 wi, vec3 wo, Hit hit) { 
  MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
  // Disney BRDF implementation
}

vec3 interaction_surface_scatter(vec3 wi, Hit hit, vec2 xi, out float pdf) { ... }
float interaction_surface_pdf(vec3 wi, vec3 wo, Hit hit) { ... }

// WRONG - using module name instead of KIND
Spectrum disney_shade(vec3 wi, vec3 wo, Hit hit) { ... }  // Incorrect!
```

## Cross-Module Calling Convention

When modules call functions from other modules, they use the target module's KIND prefix:

```glsl
// In transport module calling other modules:
Spectrum transport_trace(Ray ray) {
  Hit hit;
  
  // Call scene module (always uses scene_ prefix)
  if (!scene_intersect(ray, hit)) {
    return lighting_environment(ray.direction);
  }
  
  // Get material properties from scene
  MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
  
  // Call interaction module for physics
  vec3 wo = interaction_surface_scatter(-ray.direction, hit, next_2d(), pdf);
  Spectrum f = interaction_surface_shade(-ray.direction, wo, hit);
  
  // Call lighting module for sampling
  LightSample ls = lighting_sample(hit.p, next_2d());
  
  // Continue...
}
```

## Material Property Access

Materials are pure data within the Scene module:

```glsl
// Scene provides material properties (data only)
struct MaterialProperties {
  vec3 albedo;
  float roughness;
  float metallic;
  float ior;
  vec3 emission;
  float emission_strength;
  int light_id;        // Direct reference to light array
  int flags;
};

MaterialProperties scene_material_properties(int mat_id, Point p);

// Interaction uses properties for physics
Spectrum interaction_surface_shade(vec3 wi, vec3 wo, Hit hit) {
  MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
  // Implement Disney BRDF using properties
}
```
