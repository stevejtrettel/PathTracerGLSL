                                                               # Shader Compiler Contract

## Purpose

The ShaderCompiler transforms collections of modules into complete, executable GLSL programs. It implements eager compilation at startup, manages the 8-stage compilation pipeline, and maintains a cache of pre-compiled programs for instant recipe switching.

## Required Interface

```typescript
interface ShaderCompiler {
  // Initialization
  constructor(gl: WebGL2RenderingContext, registry: ModuleRegistry);
  
  // Eager compilation
  initialize(recipes: Recipe[]): void;
  compileAll(recipes: Recipe[]): CompilationReport;
  
  // Program retrieval (pre-compiled)
  getProgram(recipeName: string): CompiledProgram;
  hasProgram(recipeName: string): boolean;
  getProgramCount(): number;
  getAllProgramNames(): string[];
  
  // Direct compilation (used internally)
  compile(recipe: Recipe): CompiledProgram;
  
  // Pipeline access
  getPipeline(): CompilationPipeline;
  setPipeline(pipeline: CompilationPipeline): void;
  
  // Source inspection
  getSource(programId: string): { vertex: string; fragment: string };
  getLineMapping(programId: string): LineMapping;
  
  // Performance
  getCompilationReport(): CompilationReport;
  getAverageCompileTime(): number;
  
  // Cleanup
  deleteProgram(recipeName: string): void;
  dispose(): void;
}
```

## Storage Architecture

```typescript
class ShaderCompiler {
  private gl: WebGL2RenderingContext;
  private registry: ModuleRegistry;
  private pipeline: CompilationPipeline;
  
  // Pre-compiled program cache
  private programs: Map<string, CompiledProgram>;
  private compilationReport: CompilationReport;
  
  // Source tracking for debugging
  private sources: Map<string, { vertex: string; fragment: string }>;
  private lineMappings: Map<string, LineMapping>;
  
  // Statistics
  private totalCompileTime: number = 0;
  private programsCompiled: number = 0;
}
```

## Eager Compilation Contract

The compiler MUST compile all recipes at initialization:

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
  this.lineMappings = new Map();
  
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
    const key = this.getRecipeKey(recipe);
    
    try {
      const program = this.compile(recipe);
      this.programs.set(key, program);
      
      // Store debugging info
      this.sources.set(program.id, {
        vertex: program.metadata.vertexSource,
        fragment: program.metadata.fragmentSource
      });
      this.lineMappings.set(program.id, program.metadata.lineMap);
      
      const recipeTime = performance.now() - recipeStart;
      report.programs.push({
        recipeId: key,
        success: true,
        time: recipeTime
      });
      report.recipesSucceeded++;
      
      console.log(`  ✓ ${key} (${recipeTime.toFixed(1)}ms)`);
      
    } catch (error) {
      const recipeTime = performance.now() - recipeStart;
      report.programs.push({
        recipeId: key,
        success: false,
        time: recipeTime,
        error: error.message
      });
      report.recipesFailed++;
      
      console.error(`  ✗ ${key}: ${error.message}`);
      
      // Fail fast - all recipes must compile
      throw new CompilationError(
        'initialization',
        { valid: false, errors: [error.message] }
      );
    }
  }
  
  report.totalTime = performance.now() - startTime;
  report.averageTime = report.totalTime / recipes.length;
  this.compilationReport = report;
  
  console.log(`Compilation complete: ${report.totalTime.toFixed(1)}ms total`);
}

private getRecipeKey(recipe: Recipe): string {
  // Deterministic key from module names
  return [
    recipe.world.geometry.name,
    recipe.world.material.name,
    recipe.world.scene.name,
    recipe.world.lights.name,
    recipe.photography.camera.name,
    recipe.photography.estimator.name,
    recipe.photography.film.name,
    recipe.photography.developer.name
  ].join('_');
}
```

## Program Retrieval Contract

```typescript
getProgram(recipeName: string): CompiledProgram {
  const program = this.programs.get(recipeName);
  
  if (!program) {
    // List available programs to help debugging
    const available = Array.from(this.programs.keys());
    throw new Error(
      `Program not found: ${recipeName}\n` +
      `Available programs: ${available.join(', ')}\n` +
      `Did you forget to include this recipe in initialize()?`
    );
  }
  
  return program;
}

hasProgram(recipeName: string): boolean {
  return this.programs.has(recipeName);
}

getAllProgramNames(): string[] {
  return Array.from(this.programs.keys());
}
```

## Compilation Process Contract

```typescript
compile(recipe: Recipe): CompiledProgram {
  // Validate recipe with registry
  const compatibility = this.registry.checkCompatibility(recipe);
  if (!compatibility.compatible) {
    throw new CompilationError(
      'validation',
      {
        valid: false,
        errors: compatibility.issues,
        suggestions: compatibility.suggestions.map(s => s.reason)
      }
    );
  }
  
  // Resolve modules
  const modules = this.registry.resolveModules(recipe);
  
  // Run through pipeline
  const context: PipelineContext = {
    recipe,
    modules: [],
    errors: [],
    warnings: [],
    metadata: {}
  };
  
  const result = this.pipeline.execute(context, modules);
  
  // Create program ID
  const programId = `prog_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Build compiled program
  const program: CompiledProgram = {
    id: programId,
    program: result.glProgram,
    uniformMap: result.uniformMap,
    recipe,
    modules: Object.values(modules),
    metadata: {
      compiledAt: Date.now(),
      compileTime: result.compileTime,
      vertexSource: result.vertexSource,
      fragmentSource: result.fragmentSource,
      lineMap: result.lineMap,
      pipelineStages: result.stagesExecuted
    }
  };
  
  this.totalCompileTime += result.compileTime;
  this.programsCompiled++;
  
  return program;
}
```

## Pipeline Management Contract

```typescript
interface CompilationPipeline {
  execute(context: PipelineContext, modules: ModuleCollection): PipelineResult;
  getStages(): CompilationStage[];
  validateStages(): ValidationResult;
}

interface PipelineResult {
  glProgram: WebGLProgram;
  uniformMap: UniformMap;
  vertexSource: string;
  fragmentSource: string;
  lineMap: LineMapping;
  compileTime: number;
  stagesExecuted: string[];
}

class ShaderCompiler {
  constructor(gl: WebGL2RenderingContext, registry: ModuleRegistry) {
    this.gl = gl;
    this.registry = registry;
    
    // Create default pipeline
    this.pipeline = new StandardCompilationPipeline(gl);
    
    // Validate pipeline has required stages
    const validation = this.pipeline.validateStages();
    if (!validation.valid) {
      throw new Error(
        `Invalid compilation pipeline: ${validation.errors.join(', ')}`
      );
    }
  }
  
  getPipeline(): CompilationPipeline {
    return this.pipeline;
  }
  
  setPipeline(pipeline: CompilationPipeline): void {
    // Validate new pipeline
    const validation = pipeline.validateStages();
    if (!validation.valid) {
      throw new Error(`Invalid pipeline: ${validation.errors.join(', ')}`);
    }
    
    // Clear compiled programs when changing pipeline
    if (this.programs.size > 0) {
      console.warn('Changing pipeline will invalidate compiled programs');
      this.clearPrograms();
    }
    
    this.pipeline = pipeline;
  }
}
```

## WebGL Compilation Contract

```typescript
private compileShader(source: string, type: number): WebGLShader {
  const shader = this.gl.createShader(type);
  if (!shader) {
    throw new Error('Failed to create shader');
  }
  
  this.gl.shaderSource(shader, source);
  this.gl.compileShader(shader);
  
  if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
    const error = this.gl.getShaderInfoLog(shader);
    this.gl.deleteShader(shader);
    
    // Parse error for line number
    const match = error?.match(/ERROR: \d+:(\d+): (.+)/);
    if (match) {
      const line = parseInt(match[1], 10);
      const message = match[2];
      
      throw new CompilationError(
        'GLSL compilation',
        { 
          valid: false, 
          errors: [message],
          context: this.getErrorContext(source, line)
        },
        undefined,
        line
      );
    }
    
    throw new Error(`Shader compilation failed: ${error}`);
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
    const error = this.gl.getProgramInfoLog(program);
    this.gl.deleteProgram(program);
    
    throw new Error(`Program linking failed: ${error}`);
  }
  
  // Clean up shaders (no longer needed after linking)
  this.gl.deleteShader(vertex);
  this.gl.deleteShader(fragment);
  
  return program;
}

private getErrorContext(source: string, errorLine: number): string {
  const lines = source.split('\n');
  const start = Math.max(0, errorLine - 3);
  const end = Math.min(lines.length, errorLine + 2);
  
  const context: string[] = [];
  for (let i = start; i < end; i++) {
    const marker = i === errorLine - 1 ? '>>> ' : '    ';
    context.push(`${i + 1}: ${marker}${lines[i]}`);
  }
  
  return context.join('\n');
}
```

## Source Inspection Contract

```typescript
getSource(programId: string): { vertex: string; fragment: string } {
  const source = this.sources.get(programId);
  if (!source) {
    throw new Error(`No source found for program: ${programId}`);
  }
  return source;
}

getLineMapping(programId: string): LineMapping {
  const mapping = this.lineMappings.get(programId);
  if (!mapping) {
    throw new Error(`No line mapping found for program: ${programId}`);
  }
  return mapping;
}
```

## Performance Monitoring Contract

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
deleteProgram(recipeName: string): void {
  const program = this.programs.get(recipeName);
  if (!program) return;
  
  this.gl.deleteProgram(program.program);
  this.programs.delete(recipeName);
  this.sources.delete(program.id);
  this.lineMappings.delete(program.id);
}

dispose(): void {
  // Delete all GPU programs
  for (const program of this.programs.values()) {
    this.gl.deleteProgram(program.program);
  }
  
  // Clear all storage
  this.programs.clear();
  this.sources.clear();
  this.lineMappings.clear();
  
  // Reset statistics
  this.totalCompileTime = 0;
  this.programsCompiled = 0;
  this.compilationReport = {
    recipesCompiled: 0,
    recipesSucceeded: 0,
    recipesFailed: 0,
    totalTime: 0,
    averageTime: 0,
    programs: []
  };
}

private clearPrograms(): void {
  for (const program of this.programs.values()) {
    this.gl.deleteProgram(program.program);
  }
  this.programs.clear();
  this.sources.clear();
  this.lineMappings.clear();
}
```

## Minimal Working Example

```typescript
// Create compiler
const gl = canvas.getContext('webgl2')!;
const registry = new ModuleRegistry();
registry.registerDefaults();

const compiler = new ShaderCompiler(gl, registry);

// Define recipes
const recipes: Recipe[] = [
  {
    id: 'pathtracer',
    name: 'Path Tracer',
    world: {
      geometry: { kind: 'geometry', name: 'euclidean' },
      material: { kind: 'material', name: 'disney' },
      scene: { kind: 'scene', name: 'sdf' },
      lights: { kind: 'lights', name: 'hdri' }
    },
    photography: {
      camera: { kind: 'camera', name: 'pinhole' },
      estimator: { kind: 'estimator', name: 'pathtracer' },
      film: { kind: 'film', name: 'variance' },
      developer: { kind: 'developer', name: 'aces' }
    }
  },
  {
    id: 'debug',
    name: 'Debug',
    world: {
      geometry: { kind: 'geometry', name: 'euclidean' },
      material: { kind: 'material', name: 'lambert' },
      scene: { kind: 'scene', name: 'sdf' },
      lights: { kind: 'lights', name: 'point' }
    },
    photography: {
      camera: { kind: 'camera', name: 'pinhole' },
      estimator: { kind: 'estimator', name: 'debug' },
      film: { kind: 'film', name: 'simple' },
      developer: { kind: 'developer', name: 'reinhard' }
    }
  }
];

// Compile all at startup
compiler.initialize(recipes);

// Get compilation report
const report = compiler.getCompilationReport();
console.log(`Compiled ${report.recipesSucceeded}/${report.recipesCompiled} recipes`);
console.log(`Average time: ${report.averageTime.toFixed(1)}ms`);

// Retrieve pre-compiled program (instant)
const program = compiler.getProgram('euclidean_disney_sdf_hdri_pinhole_pathtracer_variance_aces');
gl.useProgram(program.program);

// Access uniform map for parameter binding
const uniformMap = program.uniformMap;
uniformMap.debugPrint();

// Debug: inspect source
const sources = compiler.getSource(program.id);
console.log('Fragment shader:', sources.fragment);

// Debug: map error line to module
const lineMap = compiler.getLineMapping(program.id);
const sourceLocation = lineMap.getSourceLocation(142);
if (sourceLocation) {
  console.log(`Line 142 is from module ${sourceLocation.module}, line ${sourceLocation.originalLine}`);
}

// Switch to different recipe (instant - pre-compiled)
const debugProgram = compiler.getProgram('euclidean_lambert_sdf_point_pinhole_debug_simple_reinhard');
gl.useProgram(debugProgram.program);

// Cleanup
compiler.dispose();
```

## Vertex Shader Contract

All programs MUST use this standard vertex shader:

```glsl
#version 300 es
precision highp float;

in vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
```

## Fragment Shader Assembly Contract

Fragment shaders MUST be assembled in this order:

```glsl
#version 300 es
precision highp float;

// 1. Math utilities (always available)
${MATH_UTILITIES}

// 2. Geometry module (first - defines types)
${GEOMETRY_MODULE}

// 3. Other modules (dependency order)
${OTHER_MODULES}

// 4. Engine uniforms
uniform vec2 u_resolution;
uniform int u_frame_index;
uniform int u_sample_count;
uniform bool u_film_reset;
uniform float u_time;

// 5. Main orchestration function
${MAIN_FUNCTION}
```

## Invariants

1. **All recipes compiled** before any can be retrieved
2. **Recipe keys deterministic** from module names
3. **Programs cached** by recipe key
4. **Source tracking** maintained for debugging
5. **Line mappings** accurate to original modules
6. **Shaders deleted** after linking
7. **GPU resources cleaned** on dispose

## Error Handling

The ShaderCompiler MUST handle these error conditions:

| Error | Response |
|-------|----------|
| Recipe incompatible | Throw with missing modules |
| Module not found | Throw ModuleNotFoundError |
| GLSL syntax error | Throw with line context |
| Shader compilation failure | Throw with GL error info |
| Link failure | Throw with program info |
| Program not found | Throw with available programs |
| Too many recipes | Throw if > MAX_RECIPES |

## Performance Requirements

- Recipe compilation: < 500ms typical
- Total initialization: < 2000ms for 3 recipes
- Program retrieval: O(1) from cache
- Source retrieval: O(1) from storage
- Shader compilation: WebGL dependent (~50-200ms)
