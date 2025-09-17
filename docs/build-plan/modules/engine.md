Here's the detailed breakdown for each file in the Engine pillar:

## engine/core/

### Engine.ts
```typescript
/**
 * @file engine/core/Engine.ts
 * Main GPU orchestrator that owns WebGL context and coordinates all rendering.
 * Compiles recipes into shader programs, manages render state, executes draw calls.
 * This is the only place that knows about WebGL - everything else goes through here.
 */

export class Engine {
  private gl: WebGL2RenderingContext;
  private state: GLState;
  private compiler: ShaderCompiler;
  private programs: ProgramCache;
  private uniforms: UniformManager;
  private textures: TextureManager;
  private framebuffers: FramebufferManager;
  private currentProgram?: CompiledProgram;
  
  constructor(canvas: HTMLCanvasElement);
  initializeShaders(recipes: Recipe[]): void;
  selectRecipe(recipe: Recipe): void;
  renderFrame(): void;
  updateUniforms(changes: UniformUpdate[]): void;
  clearFilm(): void;
  setViewport(bounds: Viewport): void;
  readPixels(bounds?: Viewport): Float32Array;
  readPixelsAsync(): Promise<Float32Array>;
  getCapabilities(): GPUCapabilities;
}

export interface UniformUpdate {
  path: string;
  value: any;
}
```

### GLState.ts
```typescript
/**
 * @file engine/core/GLState.ts
 * Tracks and manages WebGL state to minimize redundant state changes.
 * Provides efficient state diffing and batching for better performance.
 * Ensures consistent GL state across render passes.
 */

export class GLState {
  private currentState: GLStateSnapshot;
  private gl: WebGL2RenderingContext;
  
  constructor(gl: WebGL2RenderingContext);
  
  setDepthTest(enabled: boolean): void;
  setBlending(enabled: boolean, mode?: BlendMode): void;
  setCullFace(enabled: boolean, face?: GLenum): void;
  setViewport(x: number, y: number, width: number, height: number): void;
  setScissor(x: number, y: number, width: number, height: number): void;
  bindTexture(unit: number, texture: WebGLTexture): void;
  bindFramebuffer(target: GLenum, fbo: WebGLFramebuffer | null): void;
  useProgram(program: WebGLProgram): void;
  
  reset(): void;  // Reset to default GL state
  push(): void;    // Save current state
  pop(): void;     // Restore saved state
}

interface GLStateSnapshot {
  depthTest: boolean;
  blending: boolean;
  cullFace: boolean;
  viewport: [number, number, number, number];
  program: WebGLProgram | null;
}
```

### GLContext.ts
```typescript
/**
 * @file engine/core/GLContext.ts
 * WebGL2 context creation with capability detection and fallbacks.
 * Queries GPU limits and available extensions at startup.
 * Provides safe wrapper around context creation.
 */

export class GLContext {
  static create(canvas: HTMLCanvasElement, options?: WebGLContextAttributes): WebGL2RenderingContext;
  static getCapabilities(gl: WebGL2RenderingContext): GPUCapabilities;
  static checkRequiredExtensions(gl: WebGL2RenderingContext): ExtensionStatus;
}

export interface GPUCapabilities {
  maxTextureSize: number;
  maxTextureUnits: number;
  maxUniformBufferBindings: number;
  maxDrawBuffers: number;
  floatTextures: boolean;
  depthTextures: boolean;
  anisotropicFiltering: boolean;
  maxAnisotropy: number;
  vendor: string;
  renderer: string;
}

interface ExtensionStatus {
  available: string[];
  missing: string[];
}
```

### DrawCall.ts
```typescript
/**
 * @file engine/core/DrawCall.ts
 * Encapsulates a single draw operation with all required state.
 * Batches uniform updates and minimizes GL calls per draw.
 * Used for both fullscreen quads and future mesh rendering.
 */

export class DrawCall {
  private program: WebGLProgram;
  private uniforms: Map<string, UniformValue>;
  private textures: Map<number, WebGLTexture>;
  private vertexArray?: WebGLVertexArrayObject;
  
  constructor(program: WebGLProgram);
  
  setUniform(name: string, value: UniformValue): void;
  setTexture(unit: number, texture: WebGLTexture): void;
  setVertexArray(vao: WebGLVertexArrayObject): void;
  
  execute(gl: WebGL2RenderingContext, state: GLState): void;
}

type UniformValue = number | number[] | Float32Array;
```

## engine/compilation/

### ShaderCompiler.ts
```typescript
/**
 * @file engine/compilation/ShaderCompiler.ts
 * Main compilation pipeline that transforms recipes into GPU programs.
 * Orchestrates the compilation stages from module collection to linking.
 * Produces compiled programs ready for execution.
 */

export class ShaderCompiler {
  private stages: CompilationStage[];
  private preprocessor: GLSLPreprocessor;
  private gl: WebGL2RenderingContext;
  
  constructor(gl: WebGL2RenderingContext);
  
  compile(recipe: Recipe, modules: ModuleRegistry): CompiledProgram;
  compileAll(recipes: Recipe[], modules: ModuleRegistry): Map<string, CompiledProgram>;
  
  private runPipeline(recipe: Recipe): CompilationResult;
}

export interface CompiledProgram {
  program: WebGLProgram;
  uniformLocations: Map<string, WebGLUniformLocation>;
  metadata: ProgramMetadata;
}

interface CompilationResult {
  success: boolean;
  program?: CompiledProgram;
  errors?: CompilationError[];
}
```

### ProgramCache.ts
```typescript
/**
 * @file engine/compilation/ProgramCache.ts
 * Stores compiled shader programs keyed by recipe ID.
 * Prevents recompilation of identical shaders.
 * Manages program lifecycle and cleanup.
 */

export class ProgramCache {
  private programs: Map<string, CompiledProgram>;
  private gl: WebGL2RenderingContext;
  
  constructor(gl: WebGL2RenderingContext);
  
  has(recipeId: string): boolean;
  get(recipeId: string): CompiledProgram | undefined;
  set(recipeId: string, program: CompiledProgram): void;
  delete(recipeId: string): void;
  clear(): void;  // Delete all programs
  
  private getCacheKey(recipe: Recipe): string;
}
```

### ModuleLinker.ts
```typescript
/**
 * @file engine/compilation/ModuleLinker.ts
 * Resolves dependencies between GLSL modules and orders them correctly.
 * Ensures required functions are available before use.
 * Detects circular dependencies and missing modules.
 */

export class ModuleLinker {
  resolve(modules: ModuleDescriptor[]): LinkedModules;
  checkDependencies(modules: ModuleDescriptor[]): DependencyStatus;
  
  private topologicalSort(modules: ModuleDescriptor[]): ModuleDescriptor[];
  private detectCycles(modules: ModuleDescriptor[]): string[][];
}

interface LinkedModules {
  ordered: ModuleDescriptor[];
  dependencyGraph: Map<string, Set<string>>;
}

interface DependencyStatus {
  valid: boolean;
  missing?: string[];
  circular?: string[][];
}
```

### GLSLPreprocessor.ts
```typescript
/**
 * @file engine/compilation/GLSLPreprocessor.ts
 * Processes GLSL source for includes, macros, and conditional compilation.
 * Handles #include directives for module composition.
 * Manages #define constants based on configuration.
 */

export class GLSLPreprocessor {
  private includeCache: Map<string, string>;
  private defines: Map<string, string>;
  
  process(source: string, context: PreprocessContext): string;
  setDefine(name: string, value: string): void;
  removeDefine(name: string): void;
  registerInclude(name: string, source: string): void;
  
  private resolveIncludes(source: string): string;
  private applyDefines(source: string): string;
}

interface PreprocessContext {
  recipeName: string;
  moduleType: string;
  defines?: Record<string, string>;
}
```

## engine/compilation/stages/

### CollectStage.ts
```typescript
/**
 * @file engine/compilation/stages/CollectStage.ts
 * First compilation stage - gathers all required modules from recipe.
 * Maps recipe module names to actual module implementations.
 * Validates that all required modules are present.
 */

export class CollectStage implements CompilationStage<Recipe, ModuleCollection> {
  constructor(private registry: ModuleRegistry);
  
  transform(input: Recipe): ModuleCollection;
  validate(output: ModuleCollection): ValidationResult;
}

interface ModuleCollection {
  geometry: ModuleDescriptor;
  material: ModuleDescriptor;
  scene: ModuleDescriptor;
  lights: ModuleDescriptor;
  camera: ModuleDescriptor;
  estimator: ModuleDescriptor;
  film: ModuleDescriptor;
  developer: ModuleDescriptor;
}
```

### ValidateStage.ts
```typescript
/**
 * @file engine/compilation/stages/ValidateStage.ts
 * Validates module dependencies and interfaces.
 * Ensures all required functions are provided by modules.
 * Checks for interface compatibility between modules.
 */

export class ValidateStage implements CompilationStage<ModuleCollection, ModuleCollection> {
  transform(input: ModuleCollection): ModuleCollection;
  validate(output: ModuleCollection): ValidationResult;
  
  private checkInterface(module: ModuleDescriptor, required: string[]): string[];
  private checkDependencies(modules: ModuleCollection): string[];
}
```

### AssembleStage.ts
```typescript
/**
 * @file engine/compilation/stages/AssembleStage.ts
 * Assembles final GLSL source from modules and templates.
 * Orders modules correctly based on dependencies.
 * Injects modules into appropriate main() template.
 */

export class AssembleStage implements CompilationStage<ModuleCollection, ShaderSource> {
  constructor(private templates: TemplateRegistry);
  
  transform(input: ModuleCollection): ShaderSource;
  validate(output: ShaderSource): ValidationResult;
  
  private selectTemplate(modules: ModuleCollection): string;
  private injectModules(template: string, modules: ModuleCollection): string;
}

interface ShaderSource {
  vertex: string;
  fragment: string;
  uniforms: UniformDeclaration[];
}
```

### CompileStage.ts
```typescript
/**
 * @file engine/compilation/stages/CompileStage.ts
 * Compiles GLSL source into WebGL shader objects.
 * Handles compilation errors with helpful diagnostics.
 * Maps error line numbers back to original modules.
 */

export class CompileStage implements CompilationStage<ShaderSource, CompiledShaders> {
  constructor(private gl: WebGL2RenderingContext);
  
  transform(input: ShaderSource): CompiledShaders;
  validate(output: CompiledShaders): ValidationResult;
  
  private compileShader(source: string, type: GLenum): WebGLShader;
  private parseErrors(log: string, lineMap: LineMapping): ShaderError[];
}

interface CompiledShaders {
  vertex: WebGLShader;
  fragment: WebGLShader;
  uniforms: UniformDeclaration[];
}
```

### LinkStage.ts
```typescript
/**
 * @file engine/compilation/stages/LinkStage.ts
 * Links vertex and fragment shaders into final program.
 * Extracts uniform locations for efficient updates.
 * Final stage that produces executable GPU program.
 */

export class LinkStage implements CompilationStage<CompiledShaders, CompiledProgram> {
  constructor(private gl: WebGL2RenderingContext);
  
  transform(input: CompiledShaders): CompiledProgram;
  validate(output: CompiledProgram): ValidationResult;
  
  private extractUniforms(program: WebGLProgram): Map<string, WebGLUniformLocation>;
  private extractAttributes(program: WebGLProgram): Map<string, number>;
}
```

## engine/resources/

### UniformManager.ts
```typescript
/**
 * @file engine/resources/UniformManager.ts
 * Maps parameter paths to GPU uniform locations and updates them efficiently.
 * Batches uniform updates to minimize GL calls.
 * Handles type conversion from JavaScript to GLSL types.
 */

export class UniformManager {
  private uniforms: Map<string, UniformBinding>;
  private dirty: Set<string>;
  private gl: WebGL2RenderingContext;
  
  registerProgram(program: CompiledProgram): void;
  setUniform(path: string, value: any): void;
  setBatch(updates: UniformUpdate[]): void;
  flush(program: WebGLProgram): void;  // Apply pending updates
  
  private convertValue(value: any, type: UniformType): Float32Array | Int32Array;
}

interface UniformBinding {
  location: WebGLUniformLocation;
  type: UniformType;
  value: any;
}
```

### UniformBuffer.ts
```typescript
/**
 * @file engine/resources/UniformBuffer.ts
 * Optional UBO management for efficient uniform updates.
 * Groups related uniforms into buffer objects.
 * More efficient than individual uniform calls for large uniform sets.
 */

export class UniformBuffer {
  private buffer: WebGLBuffer;
  private size: number;
  private layout: UBOLayout;
  private gl: WebGL2RenderingContext;
  
  constructor(gl: WebGL2RenderingContext, layout: UBOLayout);
  
  update(data: ArrayBuffer, offset?: number): void;
  bind(bindingPoint: number): void;
  
  static createLayout(uniforms: UniformDeclaration[]): UBOLayout;
}

interface UBOLayout {
  size: number;
  offsets: Map<string, number>;
  types: Map<string, UniformType>;
}
```

### TextureManager.ts
```typescript
/**
 * @file engine/resources/TextureManager.ts
 * Manages texture allocation, updates, and binding.
 * Handles different texture formats and render targets.
 * Provides texture pooling for temporary buffers.
 */

export class TextureManager {
  private textures: Map<string, ManagedTexture>;
  private texturePool: TexturePool;
  private gl: WebGL2RenderingContext;
  
  create(name: string, options: TextureOptions): WebGLTexture;
  update(name: string, data: TexImageSource): void;
  bind(name: string, unit: number): void;
  delete(name: string): void;
  
  acquire(width: number, height: number, format: GLenum): WebGLTexture;
  release(texture: WebGLTexture): void;
}

interface ManagedTexture {
  texture: WebGLTexture;
  width: number;
  height: number;
  format: GLenum;
  lastUsed: number;
}
```

### FramebufferManager.ts
```typescript
/**
 * @file engine/resources/FramebufferManager.ts
 * Manages render targets for multi-pass rendering and accumulation.
 * Creates and configures framebuffers with appropriate attachments.
 * Handles buffer swapping for ping-pong rendering.
 */

export class FramebufferManager {
  private framebuffers: Map<string, ManagedFramebuffer>;
  private gl: WebGL2RenderingContext;
  
  create(name: string, config: FramebufferConfig): WebGLFramebuffer;
  bind(name: string): void;
  unbind(): void;
  swap(name1: string, name2: string): void;  // For ping-pong
  resize(name: string, width: number, height: number): void;
  
  readPixels(name: string, x: number, y: number, width: number, height: number): Float32Array;
}

interface ManagedFramebuffer {
  fbo: WebGLFramebuffer;
  colorAttachments: WebGLTexture[];
  depthAttachment?: WebGLTexture;
  width: number;
  height: number;
}
```

### BufferManager.ts
```typescript
/**
 * @file engine/resources/BufferManager.ts
 * Manages vertex and index buffers for geometry rendering.
 * Currently just handles fullscreen quad, will expand for meshes.
 * Provides VAO management for efficient geometry binding.
 */

export class BufferManager {
  private buffers: Map<string, WebGLBuffer>;
  private vaos: Map<string, WebGLVertexArrayObject>;
  private gl: WebGL2RenderingContext;
  
  createVertexBuffer(name: string, data: Float32Array, usage?: GLenum): WebGLBuffer;
  createIndexBuffer(name: string, data: Uint16Array, usage?: GLenum): WebGLBuffer;
  createVAO(name: string, attributes: AttributeLayout[]): WebGLVertexArrayObject;
  
  bind(name: string): void;
  update(name: string, data: ArrayBuffer, offset?: number): void;
  
  static createFullscreenQuad(gl: WebGL2RenderingContext): WebGLVertexArrayObject;
}

interface AttributeLayout {
  buffer: string;
  location: number;
  size: number;
  type: GLenum;
  stride: number;
  offset: number;
}
```

## engine/execution/

### RenderPass.ts
```typescript
/**
 * @file engine/execution/RenderPass.ts
 * Encapsulates a single render pass execution.
 * Manages state setup, uniform binding, and draw call.
 * Base unit of rendering that pipelines compose.
 */

export class RenderPass {
  private program: CompiledProgram;
  private target?: WebGLFramebuffer;
  private viewport?: Viewport;
  
  constructor(program: CompiledProgram);
  
  setTarget(fbo: WebGLFramebuffer | null): void;
  setViewport(viewport: Viewport): void;
  
  execute(gl: WebGL2RenderingContext, state: GLState, uniforms: UniformManager): void;
}

interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

### RenderPipeline.ts
```typescript
/**
 * @file engine/execution/RenderPipeline.ts
 * Orchestrates multi-pass rendering for accumulation and post-processing.
 * Manages pass dependencies and resource allocation between passes.
 * Future: Will handle denoising, bloom, etc.
 */

export class RenderPipeline {
  private passes: RenderPass[];
  private resources: Map<string, WebGLTexture>;
  
  addPass(pass: RenderPass): void;
  removePass(pass: RenderPass): void;
  
  execute(gl: WebGL2RenderingContext, state: GLState): void;
  
  private allocateResources(): void;
  private connectPasses(): void;
}
```

### ViewportManager.ts
```typescript
/**
 * @file engine/execution/ViewportManager.ts
 * Manages viewport and scissor regions for tiled rendering.
 * Calculates tile positions for production rendering.
 * Handles tile overlap for filtering continuity.
 */

export class ViewportManager {
  private fullViewport: Viewport;
  private tileSize: number;
  
  constructor(width: number, height: number);
  
  setFullViewport(viewport: Viewport): void;
  generateTiles(tileSize: number, overlap?: number): Tile[];
  setTileViewport(tile: Tile, gl: WebGL2RenderingContext): void;
}

interface Tile {
  index: number;
  viewport: Viewport;
  scissor: Viewport;
}
```

### TimingQuery.ts
```typescript
/**
 * @file engine/execution/TimingQuery.ts
 * GPU timing queries for performance profiling.
 * Measures actual GPU execution time of render passes.
 * Non-blocking async queries to avoid stalling pipeline.
 */

export class TimingQuery {
  private queries: Map<string, WebGLQuery>;
  private pendingResults: Map<string, Promise<number>>;
  private gl: WebGL2RenderingContext;
  private ext: any;  // EXT_disjoint_timer_query_webgl2
  
  constructor(gl: WebGL2RenderingContext);
  
  begin(label: string): void;
  end(label: string): void;
  
  async getResult(label: string): Promise<number>;  // Returns milliseconds
  getAllResults(): Promise<Map<string, number>>;
}
```

## engine/templates/

### vertex/fullscreen.glsl
```glsl
/**
 * @file engine/templates/vertex/fullscreen.glsl
 * Vertex shader for fullscreen quad rendering.
 * Generates positions and UVs without vertex buffer.
 */

#version 300 es
out vec2 vUv;

void main() {
  // Generate fullscreen triangle
  vec2 pos = vec2((gl_VertexID & 1) * 2, (gl_VertexID >> 1) * 2);
  vUv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
```

### fragment/main_progressive.glsl
```glsl
/**
 * @file engine/templates/fragment/main_progressive.glsl
 * Main entry point for progressive accumulation rendering.
 * Includes all modules and orchestrates the render pipeline.
 * Accumulates samples over time.
 */

#version 300 es
precision highp float;

// Module includes will be injected here
// GEOMETRY_MODULE
// MATERIAL_MODULE
// SCENE_MODULE
// LIGHTS_MODULE
// CAMERA_MODULE
// ESTIMATOR_MODULE
// FILM_MODULE
// DEVELOPER_MODULE

uniform float u_time;
uniform int u_frame;
in vec2 vUv;
out vec4 fragColor;

void main() {
  // Generate ray
  Ray ray = camera_generate(vUv);
  
  // Estimate radiance
  vec3 L = estimator_sample(ray);
  
  // Accumulate in film
  vec3 accumulated = film_accumulate(L, vUv);
  
  // Develop final color
  fragColor = vec4(developer_process(accumulated), 1.0);
}
```

## engine/utils/

### GLEnums.ts
```typescript
/**
 * @file engine/utils/GLEnums.ts
 * Type-safe WebGL constant mappings.
 * Provides readable names for GL constants.
 * Includes helper functions for enum conversions.
 */

export const GLEnums = {
  TEXTURE_2D: 0x0DE1,
  TEXTURE_CUBE_MAP: 0x8513,
  RGBA32F: 0x8814,
  // ... etc
} as const;

export function uniformTypeToGL(type: UniformType): GLenum;
export function glTypeSize(type: GLenum): number;
```

### ShaderError.ts
```typescript
/**
 * @file engine/utils/ShaderError.ts
 * Parses and formats GLSL compilation errors.
 * Maps error line numbers back to source modules.
 * Provides helpful error messages with context.
 */

export class ShaderError {
  constructor(
    public message: string,
    public line: number,
    public column?: number,
    public module?: string
  );
  
  static parse(log: string, lineMap: LineMapping): ShaderError[];
  
  format(source?: string): string;  // Pretty-print with context
}

interface LineMapping {
  getModule(line: number): string;
  getModuleLine(line: number): number;
}
```

### Diagnostics.ts
```typescript
/**
 * @file engine/utils/Diagnostics.ts
 * Debug utilities for GPU state inspection.
 * Checks for GL errors, validates framebuffers, etc.
 * Only enabled in development mode for performance.
 */

export class Diagnostics {
  static checkGLError(gl: WebGL2RenderingContext, label?: string): void;
  static validateFramebuffer(gl: WebGL2RenderingContext): boolean;
  static logProgramInfo(program: WebGLProgram, gl: WebGL2RenderingContext): void;
  static captureGLState(gl: WebGL2RenderingContext): any;
}
```

### PixelReader.ts
```typescript
/**
 * @file engine/utils/PixelReader.ts
 * Utilities for reading pixels from GPU for screenshots and analysis.
 * Handles format conversion and async readback.
 * Provides both sync and async pixel reading.
 */

export class PixelReader {
  static readPixels(
    gl: WebGL2RenderingContext,
    x: number, y: number,
    width: number, height: number
  ): Float32Array;
  
  static async readPixelsAsync(
    gl: WebGL2RenderingContext,
    x: number, y: number,
    width: number, height: number
  ): Promise<Float32Array>;
  
  static convertToRGBA8(pixels: Float32Array): Uint8ClampedArray;
  static createImageData(pixels: Float32Array, width: number, height: number): ImageData;
}
```

## engine/index.ts
```typescript
/**
 * @file engine/index.ts
 * Public API exports for the Engine pillar.
 * Only exposes Engine class - everything else is internal.
 */

export { Engine } from './core/Engine';
export type { UniformUpdate, GPUCapabilities } from './core/Engine';
export type { Recipe } from './types/Recipe';
```

This gives you a complete blueprint for the Engine pillar with clear separation between compilation, resource management, and execution!
