# Engine Types

## Purpose

This document defines all shared types used across Engine subsystems. These types form the contracts between subsystems and provide the vocabulary for Engine operations.

## Core Engine Types

### Engine State

```typescript
type EngineState = 
  | { type: "uninitialized" }
  | { type: "ready" }
  | { type: "running"; program: CompiledProgram; frame: number }
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
  id: string;                         // Unique recipe identifier
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
  name: string;
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
    name: string;
    version: string;
  };
  
  fragment: {
    functions: string;               // GLSL function implementations
    uniforms?: string;              // Uniform declarations
    constants?: string;             // #define statements
    provides?: string[];            // Functions this module exports
    requires?: string[];            // Functions this module needs
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
  provides?: string[];              // Must provide all
  requires?: string[];              // Must require all
  tags?: string[];
}
```

## Compilation Types

### Compiled Program

```typescript
interface CompiledProgram {
  id: string;                        // Unique program identifier
  program: WebGLProgram;             // GPU program object
  uniformMap: UniformMap;            // Parameter â†' uniform mappings
  recipe: Recipe;                    // Source recipe
  modules: ModuleDescriptor[];      // Modules used
  
  metadata: {
    compiledAt: number;             // Timestamp
    compileTime: number;            // Milliseconds to compile
    vertexSource: string;           // For debugging
    fragmentSource: string;         // For debugging
    lineMap: LineMapping;           // Error line mapping
    pipelineStages: string[];       // Stages executed
  };
}

interface LineMapping {
  getSourceLocation(compiledLine: number): {
    module: string;
    originalLine: number;
    function?: string;
  } | null;
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

### Pipeline Types

```typescript
interface ProcessedModule {
  descriptor: ModuleDescriptor;
  originalSource: string;
  prefixedSource: string;
  functionMap: Map<string, string>;  // original â†' prefixed
  prefix: string;                    // Module's prefix (g_, m_, etc.)
}

interface PipelineContext {
  recipe: Recipe;
  modules: ProcessedModule[];
  errors: string[];
  warnings: string[];
  metadata: Record<string, any>;
}
```

## Uniform Types

### Uniform Mapping

```typescript
interface UniformMap {
  programId: string;
  mappings: Map<string, UniformMapping>;
  
  getMapping(paramPath: string): UniformMapping | undefined;
  getAllMappings(): UniformMapping[];
  getUnusedMappings(): UniformMapping[];
  getMissingParameters(): string[];
  debugPrint(): void;
}

interface UniformMapping {
  paramPath: string;                 // "camera.position"
  glslName: string;                  // "u_camera_pinhole_position"
  location: WebGLUniformLocation | null;
  type: GLSLType;
  
  // Metadata
  moduleSource: string;              // Which module defined this
  used: boolean;                     // Ever set during rendering
  lastValue?: any;                   // For change detection
  updateCount: number;               // Times updated
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

interface UniformUpdateQueue {
  pending: Map<string, any>;         // Queued updates
  processed: number;                 // Updates processed this frame
  skipped: number;                   // Updates skipped (no location)
  missing: number;                   // Updates with no mapping
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
  drawBuffers: boolean;
  textureFloat: boolean;
  colorBufferFloat: boolean;
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
```

### Film Resource Types

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
  textures: Map<string, Texture>;
  framebuffers: {
    current: WebGLFramebuffer;       // Being written to
    previous: WebGLFramebuffer;      // Being read from
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
  clearDepth?: number;
  clearStencil?: number;
  
  // Viewport
  viewport?: Viewport;
  scissorTest?: boolean;
  scissorRect?: Rectangle;
  
  // Target
  target?: RenderTarget;
  
  // Buffer management
  swapBuffers?: boolean;              // Swap film buffers after
  preserveDrawingBuffer?: boolean;    // Keep for readback
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
  frameTime: number;                  // Last frame milliseconds
  averageFrameTime: number;           // Moving average
  minFrameTime: number;
  maxFrameTime: number;
  
  // Counts
  frameNumber: number;
  drawCalls: number;                  // Always 1 for us
  triangles: number;                  // Always 1 for us
  
  // Performance
  fps: number;
  averageFps: number;
  
  // Timestamps
  lastFrameTimestamp: number;
  startTimestamp: number;
}

interface MemoryStats {
  textureMemory: number;              // Bytes
  framebufferMemory: number;          // Bytes
  totalMemory: number;                // Total GPU memory
  textureCount: number;
  framebufferCount: number;
  largestTexture: string;             // ID of largest
  lastCleanup: number;                // Timestamp
}

interface UpdateStats {
  totalUpdates: number;               // Lifetime uniform updates
  frameUpdates: number;               // Updates this frame
  uniqueUniforms: number;             // Distinct uniforms updated
  skippedUpdates: number;             // No location (optimized out)
  redundantUpdates: number;           // Same value
  missingBindings: number;            // No mapping found
  
  lastUpdateTime: number;             // Milliseconds
  averageUpdateTime: number;          // Running average
  maxQueueSize: number;               // Largest queue seen
}

interface PerformanceReport {
  frame: FrameStats;
  memory: MemoryStats;
  uniforms: UpdateStats;
  compilation: CompilationReport;
}
```

## Validation Types

```typescript
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
  suggestions?: string[];
  context?: string;                   // Additional debug info
}

interface DependencyValidation {
  satisfied: boolean;
  missing: Array<{
    module: string;
    requires: string;
    reason: string;
  }>;
  duplicates: Array<{
    function: string;
    providers: string[];
  }>;
  cycles: Array<{
    path: string[];
  }>;
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
    public stage: string,
    public validation: ValidationResult,
    public module?: string,
    public line?: number
  ) {
    super(
      `Compilation failed at stage: ${stage}`,
      'ShaderCompiler',
      false
    );
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
      true
    );
  }
}
```

## Constants

```typescript
// Module prefixes
const MODULE_PREFIX_MAP: Record<ModuleKind, string> = {
  'geometry': 'g_',
  'material': 'm_',
  'scene': 'sc_',
  'lights': 'l_',
  'camera': 'c_',
  'estimator': 'e_',
  'film': 'f_',
  'developer': 'd_',
};

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
  MAX_RECIPES: 10,                    // Reasonable limit for eager compilation
  COMPILE_TIMEOUT: 5000,              // ms
  MAX_UNIFORM_UPDATES_PER_FRAME: 1000,
  MAX_TEXTURE_SIZE_DEFAULT: 4096,
};

// Default values
const DEFAULTS = {
  VIEWPORT: { x: 0, y: 0, width: 1920, height: 1080 },
  CLEAR_COLOR: [0, 0, 0, 0] as [number, number, number, number],
  CLEAR_DEPTH: 1.0,
  CLEAR_STENCIL: 0,
};
```
