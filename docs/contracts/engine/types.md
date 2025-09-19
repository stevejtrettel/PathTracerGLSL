# Engine Types

## Purpose

This document defines all shared types used across Engine subsystems. These types form the contracts between subsystems and with the App layer.

## Module Types

### Module Identification

    ```typescript
interface ModuleId {
  kind: ModuleKind;
  name: string;
  version: string;
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
```

### Module Descriptor

    ```typescript
interface ModuleDescriptor {
  id: ModuleId;
  
  // Functions
  provides?: string[];                // Functions this module exports
  requires?: string[];                // Functions this module needs
  
  // GLSL source
  fragment: {
    functions: string;                // GLSL function implementations
    uniforms?: string;                // Uniform declarations
    constants?: string;               // #define statements
  };
  
  // Parameters
  parameters?: ParameterDescriptor[];
  
  // Resources
  resources?: {
    textures?: TextureResourceSpec[];
    buffers?: BufferResourceSpec[];
  };
  
  // Metadata
  metadata?: {
    author?: string;
    description?: string;
    tags?: string[];
    debug?: boolean;                  // Debug variant
    realtime?: boolean;               // Real-time variant
  };
}

interface ParameterDescriptor {
  name: string;
  type: ParameterType;
  default: any;
  
  // Validation
  min?: number;
  max?: number;
  step?: number;
  options?: any[];                    // Enum values
  
  // UI hints
  group?: string;
  label?: string;
  help?: string;
  hidden?: boolean;
}

type ParameterType = 
  | 'float' | 'vec2' | 'vec3' | 'vec4'
  | 'int' | 'ivec2' | 'ivec3' | 'ivec4'
  | 'bool' | 'color' | 'texture';
```

### Module Collection

    ```typescript
interface ModuleCollection {
  geometry: ModuleDescriptor;
  material: ModuleDescriptor;         // SINGLE material module
  scene: ModuleDescriptor;
  lights: ModuleDescriptor;
  camera: ModuleDescriptor;
  estimator: ModuleDescriptor;
  film: ModuleDescriptor;
  developer: ModuleDescriptor;
}
```

## Recipe Types

    ```typescript
interface Recipe {
  id: string;
  name: string;
  
  world: {
    geometry: ModuleReference;
    material: ModuleReference;        // SINGLE material
    scene: ModuleReference;
    lights: ModuleReference;
  };
  
  photography: {
    camera: ModuleReference;
    estimator: ModuleReference;
    film: ModuleReference;
    developer: ModuleReference;
  };
  
  parameters?: ParameterOverrides;
}

interface ModuleReference {
  kind: ModuleKind;
  name: string;
}

interface ParameterOverrides {
  [path: string]: any;                // e.g., "camera.position": [0, 5, 10]
}
```

## Compilation Types

    ```typescript
interface CompiledProgram {
  id: string;                         // Unique identifier
  program: WebGLProgram;               // GPU program
  uniformMap: UniformMap;              // Parameter mappings
  recipe: Recipe;                      // Source recipe
  modules: ModuleDescriptor[];        // Modules used
  
  metadata: {
    compiledAt: number;               // Timestamp
    vertexSource: string;             // For debugging
    fragmentSource: string;           // For debugging
    lineMap: LineMapping;             // Error mapping
    compileTime: number;              // Milliseconds
  };
}

interface LineMapping {
  lines: Array<{
    compiledLine: number;             // Line in compiled shader
    sourceLine: number;               // Line in original module
    module: string;                   // Module name
    function?: string;                // Function name if applicable
  }>;
  
  getSourceLocation(compiledLine: number): {
    module: string;
    originalLine: number;
    function?: string;
  } | null;
}

interface CompilationReport {
  recipesCompiled: number;
  totalTime: number;
  programs: Array<{
    recipe: string;
    success: boolean;
    time: number;
    error?: string;
  }>;
}
```

## Engine State Types

    ```typescript
type EngineState = 
  | { type: 'uninitialized' }
  | { type: 'ready' }
  | { type: 'compiling'; recipe: Recipe }
  | { type: 'running'; program: CompiledProgram; frame: number }
  | { type: 'error'; error: Error; recoverable: boolean };

interface EngineStateInfo {
  width: number;                      // Viewport width
  height: number;                     // Viewport height
  frameIndex: number;                 // Current frame
  sampleCount: number;                // Accumulation count
  time: number;                       // Seconds elapsed
}
```

## Parameter Types

    ```typescript
interface ParameterChanges {
  changes: Array<{
    path: string;                     // "camera.position"
    oldValue: any;
    newValue: any;
    timestamp: number;
  }>;
  
  // Metadata
  source: 'user' | 'animation' | 'reset';
  triggersReset: boolean;             // Requires accumulation clear
}
```

## Uniform Types

    ```typescript
interface UniformMap {
  programId: string;
  mappings: Map<string, UniformMapping>;
  
  // Operations
  getMapping(paramPath: string): UniformMapping | undefined;
  getAllMappings(): UniformMapping[];
  getUnusedMappings(): UniformMapping[];
}

interface UniformMapping {
  paramPath: string;                  // "camera.position"
  glslName: string;                   // "u_camera_pinhole_position"
  location: WebGLUniformLocation | null;
  type: UniformType;
  arrayLength?: number;               // For arrays
  
  // Metadata
  moduleSource: string;               // Which module
  used: boolean;                      // Ever set
  lastValue?: any;                    // For change detection
  updateCount: number;                // Times updated
}

type UniformType = 
  | 'float' | 'vec2' | 'vec3' | 'vec4'
  | 'int' | 'ivec2' | 'ivec3' | 'ivec4'
  | 'bool' | 'bvec2' | 'bvec3' | 'bvec4'
  | 'mat2' | 'mat3' | 'mat4'
  | 'sampler2D' | 'samplerCube' | 'sampler3D'
  | 'isampler2D' | 'usampler2D';

interface UpdateStats {
  totalUpdates: number;
  frameUpdates: number;
  uniqueUniforms: number;
  skippedUpdates: number;
  redundantUpdates: number;
  missingBindings: number;
  lastUpdateTime: number;
  averageUpdateTime: number;
  maxQueueSize: number;
}
```

## Resource Types

### Texture Types

    ```typescript
interface TextureSpec {
  id: string;
  width: number;
  height: number;
  format: TextureFormat;
  type: DataType;
  
  // Optional
  data?: ArrayBufferView | null;
  filter?: FilterMode;
  wrap?: WrapMode;
  generateMipmap?: boolean;
  flipY?: boolean;
  premultiplyAlpha?: boolean;
  
  // Usage
  usage: 'film' | 'asset' | 'temporary';
  persistent?: boolean;
}

interface Texture {
  id: string;
  glTexture: WebGLTexture;
  spec: TextureSpec;
  boundUnit?: number;
  memoryBytes: number;
  lastUsedFrame?: number;
}

enum TextureFormat {
  // 8-bit formats
  RGB = 0x1907,
  RGBA = 0x1908,
  LUMINANCE = 0x1909,
  
  // 16-bit float formats
  RGB16F = 0x881B,
  RGBA16F = 0x881A,
  R16F = 0x822D,
  RG16F = 0x822F,
  
  // 32-bit float formats
  RGB32F = 0x8815,
  RGBA32F = 0x8814,
  R32F = 0x822E,
  RG32F = 0x8230,
  
  // Integer formats
  R32I = 0x8235,
  R32UI = 0x8236,
}

enum DataType {
  UNSIGNED_BYTE = 0x1401,
  UNSIGNED_SHORT = 0x1403,
  UNSIGNED_INT = 0x1405,
  FLOAT = 0x1406,
  HALF_FLOAT = 0x140B,
  BYTE = 0x1400,
  SHORT = 0x1402,
  INT = 0x1404,
}

enum FilterMode {
  NEAREST = 0x2600,
  LINEAR = 0x2601,
  NEAREST_MIPMAP_NEAREST = 0x2700,
  LINEAR_MIPMAP_NEAREST = 0x2701,
  NEAREST_MIPMAP_LINEAR = 0x2702,
  LINEAR_MIPMAP_LINEAR = 0x2703,
}

enum WrapMode {
  REPEAT = 0x2901,
  CLAMP_TO_EDGE = 0x812F,
  MIRRORED_REPEAT = 0x8370,
}
```

### Framebuffer Types

    ```typescript
interface FramebufferSpec {
  id: string;
  attachments: FramebufferAttachment[];
  width: number;
  height: number;
}

interface FramebufferAttachment {
  type: AttachmentType;
  attachment: number;                 // Color attachment index
  texture?: Texture;
  renderbuffer?: WebGLRenderbuffer;
}

type AttachmentType = 
  | 'color' 
  | 'depth' 
  | 'stencil' 
  | 'depth_stencil';

interface Framebuffer {
  id: string;
  glFramebuffer: WebGLFramebuffer;
  spec: FramebufferSpec;
  complete: boolean;
}
```

### Film Types

    ```typescript
interface FilmManifest {
  textures: Array<{
    name: string;                     // 'radiance', 'variance'
    format: TextureFormat;
    persistent: boolean;              // Needs ping-pong
  }>;
  resolution: Resolution;
  clearColor: [number, number, number, number];
}

interface FilmResources {
  textures: Map<string, Texture>;
  framebuffers: {
    current: Framebuffer;
    previous: Framebuffer;
  };
  manifest: FilmManifest;
  needsSwap: boolean;
}

interface TextureResourceSpec {
  name: string;
  type: 'texture2D' | 'textureCube' | 'texture3D';
  format: string;                     // 'rgba32f', 'rgba16f', etc.
  persistent?: boolean;
}

interface BufferResourceSpec {
  name: string;
  size: number;
  usage: 'static' | 'dynamic' | 'stream';
}
```

### Capability Types

    ```typescript
interface CapabilityReport {
  // Critical
  floatRenderTargets: boolean;
  floatLinearFiltering: boolean;
  
  // Limits
  maxTextureSize: number;
  maxTextureUnits: number;
  maxColorAttachments: number;
  maxViewportDims: [number, number];
  maxRenderBufferSize: number;
  maxVertexAttributes: number;
  maxUniformVectors: number;
  maxFragmentUniformVectors: number;
  
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

interface FallbackOption {
  capability: string;
  issue: string;
  suggestion: string;
  alternativeModule?: ModuleDescriptor;
  reducedFeatures?: string[];
}
```

## Rendering Types

### Viewport and Geometry

    ```typescript
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

interface Resolution {
  width: number;
  height: number;
}
```

### Render Configuration

    ```typescript
type RenderTarget = 
  | { type: 'screen' }
  | { type: 'framebuffer'; id: string }
  | { type: 'mrt'; framebufferId: string; attachments: number[] };

interface FrameConfig {
  // Clearing
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
  drawBuffers?: number[];
  
  // Buffer management
  swapBuffers?: boolean;
  preserveDrawingBuffer?: boolean;
}

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

### Performance Types

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
  lastFrameTimestamp: number;
  startTimestamp: number;
}

interface MemoryStats {
  textureMemory: number;
  framebufferMemory: number;
  totalMemory: number;
  textureCount: number;
  framebufferCount: number;
  largestTexture: string;
  lastCleanup: number;
}
```

## Validation Types

    ```typescript
interface ValidationResult {
  valid: boolean;
  isValid?: boolean;                  // Alias for compatibility
  errors: string[];
  warnings?: string[];
  suggestions?: string[];
  context?: string;                    // Additional context
  fallbackSuggestion?: string;        // Suggested fallback
}

interface CompatibilityResult {
  compatible: boolean;
  missing: Array<{
    kind: string;
    name: string;
  }>;
  issues: string[];
  suggestions: ModuleSuggestion[];
}

interface ModuleSuggestion {
  missing: { kind: string; name: string };
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

class CompilationError extends Error {
  constructor(
    public stage: string,
    public validation: ValidationResult,
    public module?: ModuleDescriptor,
    public sourceContext?: string
  ) {
    super(`Compilation failed at stage: ${stage}`);
    this.name = 'CompilationError';
  }
}

class RegistrationError extends Error {
  constructor(
    public module: ModuleDescriptor,
    public validationErrors: string[]
  ) {
    super(`Failed to register module ${module.id.name}`);
    this.name = 'RegistrationError';
  }
}

class ModuleNotFoundError extends Error {
  constructor(
    public kind: string,
    public name: string
  ) {
    super(`Module ${kind}:${name} not found`);
    this.name = 'ModuleNotFoundError';
  }
}

class ResourceAllocationError extends Error {
  constructor(
    public resourceType: string,
    public requested: number,
    public available?: number
  ) {
    super(`Failed to allocate ${resourceType}`);
    this.name = 'ResourceAllocationError';
  }
}

class ContextLostError extends Error {
  constructor() {
    super('WebGL context lost');
    this.name = 'ContextLostError';
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
const TEXTURE_UNIT_ALLOCATION = {
  FILM_START: 0,
  FILM_END: 7,
  MATERIAL_START: 8,
  MATERIAL_END: 15,
  GENERAL_START: 16,
  GENERAL_END: 31,
};

// Default values
const DEFAULTS = {
  VIEWPORT: { x: 0, y: 0, width: 1920, height: 1080 },
  CLEAR_COLOR: [0, 0, 0, 0] as [number, number, number, number],
  CLEAR_DEPTH: 1.0,
  CLEAR_STENCIL: 0,
};

// Performance thresholds
const PERFORMANCE = {
  TARGET_FPS: 60,
  MAX_FRAME_TIME: 16.67,              // ms for 60 FPS
  FRAME_HISTORY_SIZE: 60,             // Moving average window
  COMPILE_TIME_WARNING: 1000,         // ms
};
```
