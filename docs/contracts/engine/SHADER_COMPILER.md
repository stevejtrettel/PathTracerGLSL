# Shader Compiler Contract

The ShaderCompiler transforms collections of modules into complete, executable GLSL programs.

## Core Interface

```typescript
interface ShaderCompiler {
  // Main compilation
  compile(recipe: Recipe, variant?: string): CompiledProgram;
  
  // Batch compilation for variants
  compileAll(recipes: Recipe[]): Map<string, CompiledProgram>;
  
  // Source access for debugging
  getSource(programId: string): CompilationResult;
  
  // Error mapping
  mapError(error: string, programId: string): CompilationError;
}
```

## Compiled Program Structure

```typescript
interface CompiledProgram {
  id: string;                          // Unique identifier
  program: WebGLProgram;                // GL program object
  uniforms: Map<string, UniformInfo>;  // All uniforms with locations
  attributes: Map<string, number>;     // Attribute locations
  recipe: Recipe;                       // Source recipe
  metadata: {
    compiledAt: number;               // Timestamp
    modules: string[];                // Module IDs used
    mainTemplate: string;             // Which main() was used
    lineMap: LineMapping;             // Error line mapping
  };
}

interface UniformInfo {
  location: WebGLUniformLocation;
  type: "float" | "vec2" | "vec3" | "vec4" | "mat3" | "mat4" | "int" | "sampler2D";
  originalName: string;              // Pre-prefix name
  prefixedName: string;             // Post-prefix name
  module: string;                   // Which module declared it
}
```

## Compilation Phases

### Phase 1: Module Collection
```typescript
interface ModuleCollection {
  geometry: ProcessedModule;
  materials: ProcessedModule[];      // Multiple materials
  scene: ProcessedModule;
  lights: ProcessedModule;
  camera: ProcessedModule;
  estimator: ProcessedModule;
  film: ProcessedModule;
  developer: ProcessedModule;
}

interface ProcessedModule {
  descriptor: ModuleDescriptor;
  prefixedSource: string;
  originalSource: string;
  functionMap: Map<string, string>;  // original → prefixed
}
```

### Phase 2: Dependency Resolution
```typescript
interface DependencyResolver {
  sort(modules: ModuleDescriptor[]): ModuleDescriptor[];
  validate(modules: ModuleDescriptor[]): ValidationResult;
  findCycles(modules: ModuleDescriptor[]): string[][];
}

// Rules:
// 1. Geometry ALWAYS first (defines Point/Direction)
// 2. Scene before Estimator (provides intersect)
// 3. Materials before Estimator (provides eval/sample)
// 4. No circular dependencies
```

### Phase 3: Prefix Application
```typescript
interface PrefixRules {
  // Standard prefixes
  Geometry: "g_";
  Scene: "sc_";
  Lights: "l_";
  Camera: "c_";
  Estimator: "e_";
  Film: "f_";
  Developer: "d_";
  
  // Special: Materials include name
  Material: (name: string) => `m_${name.toLowerCase()}_`;
}

// Examples:
// "Material:Glass" + "eval" → "m_glass_eval"
// "Camera:Pinhole" + "generate_ray" → "c_generate_ray"
// "Geometry:Hyperbolic" + "geodesic" → "g_geodesic"
```

### Phase 4: Material Dispatcher
```typescript
interface MaterialDispatcher {
  generateDispatcher(materials: ProcessedModule[]): string;
}

// Generated code:
const MATERIAL_DISPATCHER = `
// Material dispatcher functions
vec3 dispatch_material_eval(int id, Direction wi, Direction wo, Hit hit) {
  switch(id) {
    case 0: return m_glass_eval(wi, wo, hit);
    case 1: return m_lambert_eval(wi, wo, hit);
    case 2: return m_disney_eval(wi, wo, hit);
    default: return vec3(0);
  }
}

vec3 dispatch_material_sample(int id, Direction wi, Hit hit, vec2 xi, out Direction wo, out float pdf) {
  switch(id) {
    case 0: return m_glass_sample(wi, hit, xi, wo, pdf);
    case 1: return m_lambert_sample(wi, hit, xi, wo, pdf);
    case 2: return m_disney_sample(wi, hit, xi, wo, pdf);
    default: wo = wi; pdf = 0.0; return vec3(0);
  }
}

float dispatch_material_pdf(int id, Direction wi, Direction wo, Hit hit) {
  switch(id) {
    case 0: return m_glass_pdf(wi, wo, hit);
    case 1: return m_lambert_pdf(wi, wo, hit);
    case 2: return m_disney_pdf(wi, wo, hit);
    default: return 0.0;
  }
}
`;
```

### Phase 5: Cross-Module Resolution
```typescript
interface FunctionResolver {
  resolve(call: string, context: ProcessedModule): string;
}

// Resolution rules:
// 1. Check context.requires for function name
// 2. Find module that provides it
// 3. Apply that module's prefix
// 4. Return prefixed name

// Example:
// Estimator calls "intersect"
// 1. Estimator.requires = ["intersect"]
// 2. Scene.provides = ["intersect"]
// 3. Scene prefix = "sc_"
// 4. Return "sc_intersect"
```

### Phase 6: Main Generation
```typescript
interface MainGenerator {
  selectTemplate(modules: ModuleCollection): string;
  generateMain(template: string, modules: ModuleCollection): string;
}

// Template selection:
enum MainTemplate {
  STANDARD,     // Full pipeline: Camera → Estimator → Film → Developer
  REALTIME,     // No accumulation: Camera → Estimator → Developer
  DEBUG,        // Debug output: Camera → Estimator → Output
  COMPUTE       // Future: Compute shader variant
}

// Standard template:
const STANDARD_MAIN = `
void main() {
  vec2 pixel = gl_FragCoord.xy;
  ivec2 pixel_id = ivec2(pixel);
  
  // Sample for antialiasing
  vec2 xi = sample_2d(pixel_id, u_frame_index, 0);
  
  // Generate ray
  Ray ray = c_generate_ray(pixel, xi);
  
  // Estimate radiance
  vec3 radiance = e_estimate(ray);
  
  // Accumulate
  vec3 accumulated = f_accumulate(radiance, pixel);
  
  // Develop
  vec3 color = d_develop(accumulated);
  
  gl_FragColor = vec4(color, 1.0);
}
`;
```

### Phase 7: WebGL Compilation
```typescript
interface GLCompiler {
  compileShader(source: string, type: GLenum): WebGLShader;
  linkProgram(vertex: WebGLShader, fragment: WebGLShader): WebGLProgram;
  extractLocations(program: WebGLProgram): LocationMap;
}

// Vertex shader is always the same:
const VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;
```

## Error Handling

```typescript
interface CompilationError {
  phase: CompilationPhase;
  module?: string;           // Which module caused error
  line?: number;             // Line in original source
  column?: number;
  message: string;
  originalSource?: string;   // Snippet of problematic code
  prefixedSource?: string;   // What was sent to GL
  glError?: string;          // Raw GL error message
}

enum CompilationPhase {
  MODULE_COLLECTION = "Module Collection",
  DEPENDENCY_RESOLUTION = "Dependency Resolution",
  PREFIX_APPLICATION = "Prefix Application",
  DISPATCHER_GENERATION = "Material Dispatcher",
  CROSS_MODULE_RESOLUTION = "Cross-Module Resolution",
  MAIN_GENERATION = "Main Generation",
  GL_COMPILATION = "WebGL Compilation",
  LINKING = "Program Linking"
}

// Line mapping for errors:
interface LineMapping {
  prefixedToOriginal: Map<number, SourceLocation>;
}

interface SourceLocation {
  module: string;
  originalLine: number;
  originalSource: string;
}
```

## Source Management

```typescript
interface CompilationResult {
  programId: string;
  prefixedSource: string;      // Full GLSL sent to GPU
  modulesSources: Map<string, string>;  // Original modules
  dispatcher: string;           // Generated dispatcher
  main: string;                // Generated main
  uniformMappings: Map<string, string>;  // param path → uniform name
  
  // For debugging
  getLineMapping(glLine: number): SourceLocation;
  getPrefixMapping(name: string): string;
}
```

## Caching

```typescript
interface CompilerCache {
  has(recipe: Recipe): boolean;
  get(recipe: Recipe): CompiledProgram;
  set(recipe: Recipe, program: CompiledProgram): void;
  clear(): void;
}

// Cache key generation:
function getCacheKey(recipe: Recipe): string {
  // Hash based on module IDs and versions
  return hash({
    geometry: recipe.world.geometry.id,
    materials: recipe.world.materials.map(m => m.id),
    scene: recipe.world.scene.id,
    // ... etc
  });
}
```

## Integration Example

```typescript
class ShaderCompiler {
  compile(recipe: Recipe): CompiledProgram {
    // Check cache
    if (this.cache.has(recipe)) {
      return this.cache.get(recipe);
    }
    
    try {
      // Phase 1: Collect modules
      const modules = this.collectModules(recipe);
      
      // Phase 2: Sort by dependencies
      const sorted = this.resolver.sort(modules);
      
      // Phase 3: Apply prefixes
      const prefixed = this.applyPrefixes(sorted);
      
      // Phase 4: Generate dispatcher
      const dispatcher = this.generateDispatcher(prefixed.materials);
      
      // Phase 5: Resolve cross-module calls
      const resolved = this.resolveCalls(prefixed);
      
      // Phase 6: Generate main
      const main = this.generateMain(prefixed);
      
      // Phase 7: Compile with WebGL
      const source = this.assembleSource(resolved, dispatcher, main);
      const program = this.compileGL(source);
      
      // Extract uniform locations
      const uniforms = this.extractUniforms(program);
      
      // Build result
      const compiled: CompiledProgram = {
        id: generateId(),
        program,
        uniforms,
        recipe,
        metadata: {
          compiledAt: Date.now(),
          modules: modules.map(m => m.id),
          mainTemplate: this.selectedTemplate,
          lineMap: this.lineMapper.build()
        }
      };
      
      this.cache.set(recipe, compiled);
      return compiled;
      
    } catch (error) {
      throw this.enhanceError(error, recipe);
    }
  }
}
```

## Validation Rules

The compiler validates:
1. All `requires` are satisfied by some module's `provides`
2. No duplicate function names after prefixing
3. Geometry module defines Point and Direction types
4. Materials provide either `shade` or `interact` interface
5. No circular dependencies
6. All uniforms have valid types
7. Main template matches module capabilities

## Performance Considerations

- Compile all variants at startup (no runtime compilation)
- Cache compiled programs by recipe hash
- Keep source mappings for debugging
- Pre-build material dispatchers
- Minimize string operations during compilation
