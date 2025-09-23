# Simple Compiler Contract

## Purpose

The SimpleCompiler transforms collections of modules into complete, executable GLSL programs through direct concatenation. Modules provide manually prefixed functions that are used as-written. It handles eager compilation at startup, uniform mapping, and provides instant recipe switching through pre-compiled program caching.

## Required Interface

```typescript
interface SimpleCompiler {
  // Initialization
  constructor(gl: WebGL2RenderingContext, registry: ModuleRegistry);
  
  // Eager compilation
  initialize(recipes: Recipe[]): void;
  compileAll(recipes: Recipe[]): CompilationReport;
  
  // Program retrieval (pre-compiled)
  getProgram(recipeId: string): CompiledProgram;
  hasProgram(recipeId: string): boolean;
  getProgramCount(): number;
  getAllProgramIds(): string[];
  
  // Direct compilation (used internally)
  compile(recipe: Recipe): CompiledProgram;
  
  // Uniform management (integrated from old UniformBinder)
  updateUniforms(program: CompiledProgram, changes: ParameterChanges): void;
  updateEngineUniforms(program: CompiledProgram, state: EngineStateInfo): void;
  
  // Source inspection
  getSource(programId: string): { vertex: string; fragment: string } | null;
  
  // Performance
  getCompilationReport(): CompilationReport;
  getAverageCompileTime(): number;
  
  // Cleanup
  deleteProgram(recipeId: string): void;
  dispose(): void;
}
```

## Storage Architecture

```typescript
class SimpleCompiler {
  private gl: WebGL2RenderingContext;
  private registry: ModuleRegistry;
  
  // Pre-compiled program cache (key = recipe.id)
  private programs: Map<string, CompiledProgram>;
  private compilationReport: CompilationReport;
  
  // Source tracking for debugging
  private sources: Map<string, { vertex: string; fragment: string }>;
  
  // Statistics
  private totalCompileTime: number = 0;
  private programsCompiled: number = 0;
  
  // Constants (embedded here instead of separate file)
  private readonly VERTEX_SHADER = `
#version 300 es
precision highp float;

in vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

  private readonly MODULE_ORDER: ModuleKind[] = [
    'geometry',
    'material', 
    'lights',
    'scene',
    'camera',
    'estimator',
    'film',
    'developer'
  ];
}
```

## Eager Compilation Contract

```typescript
initialize(recipes: Recipe[]): void {
  if (recipes.length === 0) {
    console.warn('No recipes to compile');
    return;
  }
  
  if (recipes.length > LIMITS.MAX_RECIPES) {
    throw new Error(
      `Too many recipes: ${recipes.length} (max: ${LIMITS.MAX_RECIPES})`
    );
  }
  
  console.log(`Compiling ${recipes.length} shader programs...`);
  const startTime = performance.now();
  
  this.programs = new Map();
  this.sources = new Map();
  
  const report: CompilationReport = {
    recipesCompiled: recipes.length,
    recipesSucceeded: 0,
    recipesFailed: 0,
    totalTime: 0,
    averageTime: 0,
    programs: []
  };
  
  for (const recipe of recipes) {
    const recipeStart = performance.now();
    
    try {
      const program = this.compile(recipe);
      this.programs.set(recipe.id, program);
      
      // Store debugging info
      this.sources.set(program.id, {
        vertex: this.VERTEX_SHADER,
        fragment: program.metadata.fragmentSource
      });
      
      const recipeTime = performance.now() - recipeStart;
      report.programs.push({
        recipeId: recipe.id,
        success: true,
        time: recipeTime
      });
      report.recipesSucceeded++;
      
      console.log(`  ✓ ${recipe.id} (${recipeTime.toFixed(1)}ms)`);
      
    } catch (error) {
      const recipeTime = performance.now() - recipeStart;
      report.programs.push({
        recipeId: recipe.id,
        success: false,
        time: recipeTime,
        error: error.message
      });
      report.recipesFailed++;
      
      console.error(`  ✗ ${recipe.id}: ${error.message}`);
      
      // Fail fast - all recipes must compile
      throw new CompilationError(
        `Failed to compile ${recipe.id}`,
        { valid: false, errors: [error.message] }
      );
    }
  }
  
  report.totalTime = performance.now() - startTime;
  report.averageTime = report.totalTime / recipes.length;
  this.compilationReport = report;
  
  console.log(`Compilation complete: ${report.totalTime.toFixed(1)}ms total`);
  console.log(`All modules use manual prefixing (moduleName_functionName)`);
}
```

## Compilation Process Contract

```typescript
compile(recipe: Recipe): CompiledProgram {
  // 1. Validate recipe with registry
  const compatibility = this.registry.checkCompatibility(recipe);
  if (!compatibility.compatible) {
    throw new CompilationError(
      'Recipe validation failed',
      {
        valid: false,
        errors: compatibility.issues,
        suggestions: compatibility.suggestions?.map(s => s.reason)
      }
    );
  }
  
  // 2. Collect modules
  const modules = this.collectModules(recipe);
  
  // 3. Assemble shader source (direct concatenation, no transformation)
  const fragmentSource = this.assembleFragmentShader(modules);
  const vertexSource = this.VERTEX_SHADER;
  
  // 4. Compile GLSL
  const glProgram = this.compileGLSL(vertexSource, fragmentSource);
  
  // 5. Build uniform mappings
  const uniformMap = this.buildUniformMap(glProgram, modules);
  
  // 6. Create program ID
  const programId = `prog_${recipe.id}`;
  
  // Build compiled program
  const program: CompiledProgram = {
    id: programId,
    recipeId: recipe.id,
    program: glProgram,
    uniformMap,
    recipe,
    modules: Object.values(modules),
    metadata: {
      compiledAt: Date.now(),
      compileTime: performance.now(),
      vertexSource,
      fragmentSource
    }
  };
  
  this.totalCompileTime += program.metadata.compileTime;
  this.programsCompiled++;
  
  return program;
}

private collectModules(recipe: Recipe): ModuleCollection {
  // Simple collection from registry - modules already have prefixed functions
  return this.registry.resolveModules(recipe);
}
```

## Shader Assembly Contract

```typescript
private assembleFragmentShader(modules: ModuleCollection): string {
  const parts: string[] = [];
  
  // GLSL version and precision
  parts.push('#version 300 es');
  parts.push('precision highp float;');
  parts.push('precision highp int;');
  parts.push('');
  
  // Common type definitions (from geometry module typically)
  parts.push('// ============ Common Types ============');
  parts.push(this.getCommonTypes());
  parts.push('');
  
  // Cross-module calling documentation
  parts.push('// ============ Manual Prefixing Convention ============');
  parts.push('// All public functions are manually prefixed with module name:');
  parts.push(`// Camera (${modules.camera.id.name}): ${modules.camera.id.name}_generateRay`);
  parts.push(`// Material (${modules.material.id.name}): ${modules.material.id.name}_evaluate, ${modules.material.id.name}_sample, ${modules.material.id.name}_pdf`);
  parts.push(`// Scene (${modules.scene.id.name}): ${modules.scene.id.name}_intersect`);
  parts.push(`// Estimator (${modules.estimator.id.name}): ${modules.estimator.id.name}_estimate`);
  parts.push(`// Film (${modules.film.id.name}): ${modules.film.id.name}_accumulate`);
  parts.push(`// Developer (${modules.developer.id.name}): ${modules.developer.id.name}_develop`);
  parts.push('');
  
  // Concatenate modules in fixed order - NO TRANSFORMATION
  for (const kind of this.MODULE_ORDER) {
    const module = modules[kind];
    if (!module) {
      throw new Error(`Missing module for kind: ${kind}`);
    }
    
    parts.push(`// ============ ${module.id.name} (${kind}) ============`);
    
    // Add module uniforms if specified separately
    if (module.fragment.uniforms) {
      parts.push(module.fragment.uniforms);
    }
    
    // Add module constants if any
    if (module.fragment.constants) {
      parts.push(module.fragment.constants);
    }
    
    // Add module functions AS-IS (already prefixed)
    parts.push(module.fragment.functions);
    parts.push('');
  }
  
  // Engine uniforms
  parts.push('// ============ Engine Uniforms ============');
  parts.push(this.getEngineUniforms());
  parts.push('');
  
  // Main function - uses actual module names for prefixes
  parts.push('// ============ Main Orchestration ============');
  parts.push(this.generateMainFunction(modules));
  
  return parts.join('\n');
}

private getCommonTypes(): string {
  // Basic types that all modules need
  return `
// Spectrum types for future spectral rendering
typedef vec3 Spectrum;
typedef vec3 Radiance;
typedef vec3 RGB;

// Geometric types (may be overridden by geometry module)
typedef vec3 Point;
typedef vec3 Direction;

// Core structures
struct Ray {
  Point origin;
  Direction direction;
  float tmin, tmax;
};

struct Hit {
  Point p;
  Direction n;
  Direction incident;
  float t;
  vec2 uv;
  
  int material_from;
  int material_to;
  float ior_ratio;
  
  int object_id;
  int part_id;
};

struct Frame {
  Point base;
  Direction t, b, n;
};`;
}

private getEngineUniforms(): string {
  return `
uniform vec2 u_resolution;
uniform int u_frame_index;
uniform int u_sample_count;
uniform float u_time;
uniform bool u_film_reset;

// Film textures
uniform sampler2D u_film_radiance_previous;
uniform sampler2D u_film_variance_previous;
uniform sampler2D u_film_samples_previous;

// Output
out vec4 fragColor;`;
}

private generateMainFunction(modules: ModuleCollection): string {
  // Generate main using ACTUAL module names for prefixes
  const camera = modules.camera.id.name;
  const estimator = modules.estimator.id.name;
  const film = modules.film.id.name;
  const developer = modules.developer.id.name;
  
  return `
void main() {
  vec2 pixel = gl_FragCoord.xy;
  ivec2 pixel_id = ivec2(pixel);
  
  // Random dimension tracking would be initialized here
  // (provided by math pillar, not engine)
  
  // Generate camera ray - using module's actual prefix
  Ray ray = ${camera}_generateRay(pixel);
  
  // Estimate radiance - using module's actual prefix
  Spectrum radiance = ${estimator}_estimate(ray);
  
  // Accumulate in film - using module's actual prefix
  Radiance accumulated = ${film}_accumulate(radiance, pixel);
  
  // Develop to display color - using module's actual prefix
  RGB color = ${developer}_develop(accumulated);
  
  fragColor = vec4(color, 1.0);
}`;
}
```

## GLSL Compilation Contract

```typescript
private compileGLSL(vertexSource: string, fragmentSource: string): WebGLProgram {
  // Compile vertex shader
  const vertexShader = this.compileShader(vertexSource, this.gl.VERTEX_SHADER, 'vertex');
  
  // Compile fragment shader  
  const fragmentShader = this.compileShader(fragmentSource, this.gl.FRAGMENT_SHADER, 'fragment');
  
  // Link program
  const program = this.linkProgram(vertexShader, fragmentShader);
  
  // Clean up shaders (no longer needed after linking)
  this.gl.deleteShader(vertexShader);
  this.gl.deleteShader(fragmentShader);
  
  return program;
}

private compileShader(source: string, type: number, name: string): WebGLShader {
  const shader = this.gl.createShader(type);
  if (!shader) {
    throw new Error(`Failed to create ${name} shader`);
  }
  
  this.gl.shaderSource(shader, source);
  this.gl.compileShader(shader);
  
  if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
    const log = this.gl.getShaderInfoLog(shader);
    this.gl.deleteShader(shader);
    
    // Parse error for line number and get context
    const match = log?.match(/ERROR: \d+:(\d+): (.+)/);
    if (match) {
      const line = parseInt(match[1], 10);
      const message = match[2];
      const context = this.getErrorContext(source, line);
      
      throw new CompilationError(
        `${name} shader compilation failed`,
        { 
          valid: false, 
          errors: [message],
          context
        },
        undefined,
        line
      );
    }
    
    throw new Error(`${name} shader compilation failed: ${log}`);
  }
  
  return shader;
}

private linkProgram(vertex: WebGLShader, fragment: WebGLShader): WebGLProgram {
  const program = this.gl.createProgram();
  if (!program) {
    throw new Error('Failed to create program');
  }
  
  this.gl.attachShader(program, vertex);
  this.gl.attachShader(program, fragment);
  
  // Bind attribute locations
  this.gl.bindAttribLocation(program, 0, 'a_position');
  
  this.gl.linkProgram(program);
  
  if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
    const log = this.gl.getProgramInfoLog(program);
    this.gl.deleteProgram(program);
    throw new Error(`Program linking failed: ${log}`);
  }
  
  return program;
}

// Helper to show context around error line
private getErrorContext(source: string, line: number): string {
  const lines = source.split('\n');
  const start = Math.max(0, line - 3);
  const end = Math.min(lines.length, line + 2);
  
  const context = lines.slice(start, end)
    .map((text, i) => {
      const lineNum = start + i + 1;
      const marker = lineNum === line ? ' >>> ' : '     ';
      return `${marker}${lineNum.toString().padStart(4, ' ')}: ${text}`;
    })
    .join('\n');
    
  return `\nContext around line ${line}:\n${context}`;
}
```

## Uniform Mapping Contract (Integrated from UniformBinder)

```typescript
private buildUniformMap(glProgram: WebGLProgram, modules: ModuleCollection): UniformMap {
  const mappings = new Map<string, UniformMapping>();
  
  // Process each module's parameters
  for (const [kind, module] of Object.entries(modules)) {
    for (const param of module.parameters || []) {
      // Simple, direct mapping
      const paramPath = `${kind}.${param.name}`;
      const glslName = `u_${kind}_${param.name}`;
      const location = this.gl.getUniformLocation(glProgram, glslName);
      
      mappings.set(paramPath, {
        paramPath,
        glslName,
        location,
        type: param.type as GLSLType,
        moduleSource: module.id.name
      });
      
      if (!location) {
        console.debug(`Uniform optimized out: ${glslName}`);
      }
    }
  }
  
  // Add engine uniforms
  this.addEngineUniformMappings(mappings, glProgram);
  
  return {
    recipeId: '', // Will be set by compile()
    mappings,
    
    getMapping: (path: string) => mappings.get(path),
    getAllMappings: () => Array.from(mappings.values()),
    
    debugPrint: () => {
      console.table(
        Array.from(mappings.values()).map(m => ({
          param: m.paramPath,
          glsl: m.glslName,
          type: m.type,
          hasLocation: m.location !== null,
          module: m.moduleSource
        }))
      );
    }
  };
}

private addEngineUniformMappings(
  mappings: Map<string, UniformMapping>,
  program: WebGLProgram
): void {
  const engineUniforms = [
    { path: 'engine.resolution', glsl: 'u_resolution', type: 'vec2' },
    { path: 'engine.frame_index', glsl: 'u_frame_index', type: 'int' },
    { path: 'engine.sample_count', glsl: 'u_sample_count', type: 'int' },
    { path: 'engine.time', glsl: 'u_time', type: 'float' },
    { path: 'engine.film_reset', glsl: 'u_film_reset', type: 'bool' }
  ];
  
  for (const uniform of engineUniforms) {
    const location = this.gl.getUniformLocation(program, uniform.glsl);
    mappings.set(uniform.path, {
      paramPath: uniform.path,
      glslName: uniform.glsl,
      location,
      type: uniform.type as GLSLType,
      moduleSource: 'Engine'
    });
  }
}
```

## Uniform Update Contract

```typescript
updateUniforms(program: CompiledProgram, changes: ParameterChanges): void {
  // Make sure this program is active
  this.gl.useProgram(program.program);
  
  for (const change of changes.changes) {
    const mapping = program.uniformMap.getMapping(change.path);
    
    if (!mapping) {
      console.warn(`No uniform mapping for parameter: ${change.path}`);
      continue;
    }
    
    if (!mapping.location) {
      // Uniform was optimized out
      continue;
    }
    
    this.setUniform(mapping.location, mapping.type, change.newValue);
  }
}

updateEngineUniforms(program: CompiledProgram, state: EngineStateInfo): void {
  // Make sure this program is active
  this.gl.useProgram(program.program);
  
  // Update each engine uniform
  const setUniform = (path: string, value: any) => {
    const mapping = program.uniformMap.getMapping(path);
    if (mapping?.location) {
      this.setUniform(mapping.location, mapping.type, value);
    }
  };
  
  setUniform('engine.resolution', [state.width, state.height]);
  setUniform('engine.frame_index', state.frameIndex);
  setUniform('engine.sample_count', state.sampleCount);
  setUniform('engine.time', state.time);
  setUniform('engine.film_reset', false);  // Always reset after frame
}

private setUniform(location: WebGLUniformLocation, type: GLSLType, value: any): void {
  switch (type) {
    case 'float':
      this.gl.uniform1f(location, value);
      break;
    case 'vec2':
      this.gl.uniform2fv(location, value);
      break;
    case 'vec3':
      this.gl.uniform3fv(location, value);
      break;
    case 'vec4':
      this.gl.uniform4fv(location, value);
      break;
    case 'int':
      this.gl.uniform1i(location, value);
      break;
    case 'bool':
      this.gl.uniform1i(location, value ? 1 : 0);
      break;
    case 'mat3':
      this.gl.uniformMatrix3fv(location, false, value);
      break;
    case 'mat4':
      this.gl.uniformMatrix4fv(location, false, value);
      break;
    case 'sampler2D':
    case 'samplerCube':
      this.gl.uniform1i(location, value);
      break;
    default:
      console.warn(`Unknown uniform type: ${type}`);
  }
}
```

## Program Retrieval Contract

```typescript
getProgram(recipeId: string): CompiledProgram {
  const program = this.programs.get(recipeId);
  
  if (!program) {
    const available = Array.from(this.programs.keys());
    throw new Error(
      `Program not found: ${recipeId}\n` +
      `Available programs: ${available.join(', ')}`
    );
  }
  
  return program;
}

hasProgram(recipeId: string): boolean {
  return this.programs.has(recipeId);
}

getProgramCount(): number {
  return this.programs.size;
}

getAllProgramIds(): string[] {
  return Array.from(this.programs.keys());
}

getSource(programId: string): { vertex: string; fragment: string } | null {
  return this.sources.get(programId) || null;
}
```

## Performance Tracking

```typescript
getCompilationReport(): CompilationReport {
  return this.compilationReport || {
    recipesCompiled: 0,
    recipesSucceeded: 0,
    recipesFailed: 0,
    totalTime: 0,
    averageTime: 0,
    programs: []
  };
}

getAverageCompileTime(): number {
  if (this.programsCompiled === 0) return 0;
  return this.totalCompileTime / this.programsCompiled;
}
```

## Cleanup Contract

```typescript
deleteProgram(recipeId: string): void {
  const program = this.programs.get(recipeId);
  if (!program) return;
  
  this.gl.deleteProgram(program.program);
  this.programs.delete(recipeId);
  this.sources.delete(program.id);
}

dispose(): void {
  // Delete all GPU programs
  for (const program of this.programs.values()) {
    this.gl.deleteProgram(program.program);
  }
  
  // Clear all storage
  this.programs.clear();
  this.sources.clear();
  
  // Reset statistics
  this.totalCompileTime = 0;
  this.programsCompiled = 0;
}
```

## Minimal Working Example

```typescript
// Create compiler
const gl = canvas.getContext('webgl2')!;
const registry = new ModuleRegistry();
registry.registerDefaults();

const compiler = new SimpleCompiler(gl, registry);

// Define recipes - module names determine function prefixes
const recipes: Recipe[] = [
  {
    id: 'pathtracer',
    name: 'Path Tracer',
    world: {
      geometry: { kind: 'geometry', name: 'euclidean' },     // Functions: euclidean_*
      material: { kind: 'material', name: 'disney' },        // Functions: disney_*
      scene: { kind: 'scene', name: 'sdf' },                 // Functions: sdf_*
      lights: { kind: 'lights', name: 'hdri' }               // Functions: hdri_*
    },
    photography: {
      camera: { kind: 'camera', name: 'pinhole' },           // Functions: pinhole_*
      estimator: { kind: 'estimator', name: 'pathtracer' },  // Functions: pathtracer_*
      film: { kind: 'film', name: 'variance' },              // Functions: variance_*
      developer: { kind: 'developer', name: 'aces' }         // Functions: aces_*
    }
  }
];

// Compile all at startup (eager)
compiler.initialize(recipes);
// Output: 
// Compiling 1 shader programs...
//   ✓ pathtracer (142.3ms)
// Compilation complete: 142.3ms total
// All modules use manual prefixing (moduleName_functionName)

// The generated main() will call:
// - pinhole_generateRay()
// - pathtracer_estimate()
// - variance_accumulate()
// - aces_develop()

// Retrieve pre-compiled program instantly
const program = compiler.getProgram('pathtracer');
gl.useProgram(program.program);

// Update uniforms through compiler
const changes: ParameterChanges = {
  changes: [
    { path: 'camera.position', oldValue: [0,0,0], newValue: [0,5,10], timestamp: Date.now() }
  ],
  source: 'user',
  triggersReset: true
};
compiler.updateUniforms(program, changes);

// Update engine uniforms each frame
const engineState: EngineStateInfo = {
  width: 1920,
  height: 1080,
  frameIndex: 42,
  sampleCount: 42,
  time: performance.now() / 1000
};
compiler.updateEngineUniforms(program, engineState);

// Debug uniform mappings
program.uniformMap.debugPrint();
// Shows table with param paths, GLSL names, types, and source modules

// Get compilation stats
const report = compiler.getCompilationReport();
console.log(`Compiled in ${report.averageTime.toFixed(1)}ms average`);

// Get source for debugging (shows actual concatenated GLSL)
const source = compiler.getSource(program.id);
console.log('Fragment shader includes prefixed functions:');
console.log(source?.fragment.substring(0, 1000));

// Cleanup
compiler.dispose();
```

## Example: Shader Compilation Error with Context

```typescript
// If a module has a syntax error:
try {
  compiler.compile(recipeWithError);
} catch (error) {
  console.error(error);
  // Output:
  // fragment shader compilation failed
  // ERROR: 0:234: 'camera_positio' : undeclared identifier
  //
  // Context around line 234:
  //      231: uniform vec3 u_camera_position;
  //      232: 
  //      233: Ray pinhole_generateRay(vec2 pixel) {
  //  >>> 234:   return Ray(camera_positio, normalize(dir));
  //      235:   //         ^^^^^^^^^^^^^^ typo here!
  //      236: }
}
```

## Key Differences from Old System

| Aspect | Old System | Simplified System |
|--------|------------|-------------------|
| **Prefixing** | Automatic transformation | Manual by module authors |
| **Function calls** | Generated prefixes | Use actual module names |
| **Compilation** | 8-stage pipeline | Direct concatenation |
| **main() generation** | Fixed prefixes | Dynamic based on module names |
| **Module processing** | Transform code | Use as-written |
| **Error context** | Not provided | Shows surrounding lines |

## Invariants

1. **All recipes compiled at startup** - No runtime compilation
2. **Recipe IDs are cache keys** - Direct lookup, no concatenation
3. **Modules used as-written** - No code transformation, manual prefixes
4. **Fixed module order** - Same concatenation order for all recipes
5. **main() uses actual module names** - Calls pinhole_generateRay, not camera_generateRay
6. **Uniforms mapped once** - At compilation time
7. **Shaders deleted after linking** - Memory cleanup
8. **Error context provided** - Shows lines around compilation errors

## Error Handling

| Error | Response |
|-------|----------|
| Recipe incompatible | Throw with missing modules |
| Module not found | Throw ModuleNotFoundError |
| GLSL syntax error | Throw with line context |
| Shader compilation failure | Throw with GL error info and context |
| Link failure | Throw with program info |
| Program not found | Throw with available programs |
| Too many recipes | Throw if > MAX_RECIPES |
| Uniform not found | Warn and continue |

## Performance Requirements

- Recipe compilation: < 200ms typical (simpler than old system)
- Total initialization: < 1000ms for 3 recipes
- Program retrieval: O(1) from cache
- Uniform update: < 0.1ms per uniform
- Module concatenation: O(8) - fixed number of modules
- Error context generation: O(5) - shows ±2 lines
