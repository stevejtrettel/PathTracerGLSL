# Engine Types (Simplified)

## Purpose

This document defines all shared types used across the simplified Engine subsystems. These types form the contracts between subsystems and provide the vocabulary for Engine operations.

## Manual Prefixing Convention

**CRITICAL**: All modules MUST manually prefix their public functions with their module name followed by underscore. This is NOT automatic - module authors are responsible for proper namespacing.

```glsl
// Example: In a camera module named "pinhole"
Ray pinhole_generateRay(vec2 pixel) { ... }  // CORRECT
Ray generateRay(vec2 pixel) { ... }          // WRONG - missing prefix

// Example: In an estimator module named "pathtracer"  
Spectrum pathtracer_estimate(Ray ray) { ... }  // CORRECT
Spectrum estimate(Ray ray) { ... }             // WRONG - missing prefix
```

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
    geometry: ModuleReference;
    material: ModuleReference;        // SINGLE material module
    scene: ModuleReference;
    lights: ModuleReference;
  };
  
  photography: {
    camera: ModuleReference;
    estimator: ModuleReference;
    film: ModuleReference;
    developer: ModuleReference;
  };
  
  parameters?: ParameterOverrides;   // Initial parameter values
}

interface ModuleReference {
  kind: ModuleKind;
  name: string;                       // MUST match prefix used in functions
}

type ModuleKind = 
  | 'geometry'
  | 'material' 
  | 'scene'
  | 'lights'
  | 'camera'
  | 'estimator'
  | 'film'
  | 'developer';

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
    name: string;                    // MUST match function prefixes
    version: string;
  };
  
  fragment: {
    functions: string;               // GLSL with manually prefixed functions
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
  geometry: ModuleDescriptor;
  material: ModuleDescriptor;        // SINGLE material
  scene: ModuleDescriptor;
  lights: ModuleDescriptor;
  camera: ModuleDescriptor;
  estimator: ModuleDescriptor;
  film: ModuleDescriptor;
  developer: ModuleDescriptor;
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
// Required function prefixes - modules MUST manually prefix their functions
const REQUIRED_PREFIXES: Record<ModuleKind, string> = {
  'geometry': 'geometry_',
  'material': 'material_',
  'scene': 'scene_',
  'lights': 'lights_',
  'camera': 'camera_',
  'estimator': 'estimator_',
  'film': 'film_',
  'developer': 'developer_'
};

// Note: The actual prefix is the module NAME, not the kind
// Example: A camera module named "pinhole" uses "pinhole_" prefix
// Example: A material module named "disney" uses "disney_" prefix

// Fixed module concatenation order
const MODULE_ORDER: ModuleKind[] = [
  'geometry',    // Defines types
  'material',    // Material functions
  'lights',      // Light functions
  'scene',       // Uses above three
  'camera',      // Ray generation
  'estimator',   // Orchestrates everything
  'film',        // Accumulation
  'developer'    // Tone mapping
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

Modules MUST follow this pattern for their public functions:

```glsl
// ============ Example: Camera Module Named "pinhole" ============
uniform vec3 u_camera_position;
uniform vec3 u_camera_target;

// CORRECT - prefixed with module name
Ray pinhole_generateRay(vec2 pixel) {
  // Implementation
}

// WRONG - missing prefix
Ray generateRay(vec2 pixel) {
  // This will fail validation
}

// ============ Example: Material Module Named "disney" ============
uniform vec3 u_material_albedo;

// CORRECT - all required functions prefixed
vec3 disney_evaluate(vec3 wi, vec3 wo, Hit hit) { ... }
vec3 disney_sample(vec3 wi, Hit hit, vec2 xi, out float pdf) { ... }
float disney_pdf(vec3 wi, vec3 wo, Hit hit) { ... }

// WRONG - inconsistent prefixing
vec3 evaluate(vec3 wi, vec3 wo, Hit hit) { ... }  // Missing prefix!
```

## Cross-Module Calling Convention

When modules call functions from other modules, they use the target module's prefix:

```glsl
// In estimator module calling other modules:
Spectrum pathtracer_estimate(Ray ray) {
  Hit hit;
  
  // Call scene module (assumed to be named "sdf")
  if (!sdf_intersect(ray, hit)) {
    return sky_color(ray.direction);
  }
  
  // Call material module (assumed to be named "disney")
  vec3 wo = disney_sample(ray.direction, hit, xi, pdf);
  vec3 brdf = disney_evaluate(ray.direction, wo, hit);
  
  // Continue...
}
```

Note: The main() function orchestrator must know the actual module names to call the correct prefixed functions.
