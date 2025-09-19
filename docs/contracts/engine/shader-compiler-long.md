

# Shader Compiler Contract

## Purpose

The ShaderCompiler transforms collections of modules into complete, executable GLSL programs. It uses an 8-stage pipeline architecture with eager compilation at startup.

## Core Interface

```typescript
interface ShaderCompiler {
  // Eager compilation at startup
  initialize(recipes: Recipe[]): void;
  
  // Get pre-compiled program (instant)
  getProgram(recipeName: string): CompiledProgram;
  
  // Direct compilation (used internally by initialize)
  compile(recipe: Recipe): CompiledProgram;
  
  // Debugging
  getPipeline(): CompilationPipeline;
  getSource(programId: string): string;
  getLineMapping(programId: string): LineMapping;
}
```

## Compiled Program Structure

```typescript
interface CompiledProgram {
  id: string;                          // Unique identifier
  program: WebGLProgram;                // GL program object
  uniformMap: UniformMap;               // Parameter mappings
  recipe: Recipe;                       // Source recipe
  modules: ModuleDescriptor[];         // Modules used
  metadata: {
    compiledAt: number;               // Timestamp
    vertexSource: string;             // Vertex shader
    fragmentSource: string;           // Fragment shader
    lineMap: LineMapping;             // For error reporting
    stages: string[];                 // Pipeline stages executed
  };
}

interface LineMapping {
  // Maps compiled line numbers to source locations
  lines: Array<{
    compiledLine: number;
    sourceLine: number;
    module: string;
    originalFunction?: string;
  }>;
}
```

## Eager Compilation

```typescript
class ShaderCompiler {
  private pipeline: CompilationPipeline;
  private programs = new Map<string, CompiledProgram>();
  
  constructor(private gl: WebGL2RenderingContext) {
    this.pipeline = new CompilationPipeline(gl);
  }
  
  // Compile all variants at startup
  initialize(recipes: Recipe[]): void {
    console.log(`Compiling ${recipes.length} shader variants...`);
    const startTime = performance.now();
    
    for (const recipe of recipes) {
      const key = this.getRecipeKey(recipe);
      
      try {
        const program = this.compile(recipe);
        this.programs.set(key, program);
        console.log(`✓ Compiled: ${key}`);
      } catch (error) {
        console.error(`✗ Failed to compile ${key}:`, error);
        throw error;  // Fail fast at startup
      }
    }
    
    const elapsed = performance.now() - startTime;
    console.log(`Compilation complete in ${elapsed.toFixed(2)}ms`);
  }
  
  // Get pre-compiled program (instant)
  getProgram(recipeName: string): CompiledProgram {
    const program = this.programs.get(recipeName);
    
    if (!program) {
      throw new Error(
        `Program not pre-compiled: ${recipeName}. ` +
        `Call initialize() with all recipes at startup.`
      );
    }
    
    return program;
  }
  
  private getRecipeKey(recipe: Recipe): string {
    return [
      recipe.world.geometry.name,
      recipe.world.material.name,  // Single material
      recipe.world.scene.name,
      recipe.world.lights.name,
      recipe.photography.camera.name,
      recipe.photography.estimator.name,
      recipe.photography.film.name,
      recipe.photography.developer.name
    ].join('_');
  }
}
```

## Compilation Pipeline

```typescript
interface CompilationStage<TIn, TOut> {
  name: string;
  transform(input: TIn): TOut;
  validate(output: TOut): ValidationResult;
}

class CompilationPipeline {
  private stages: CompilationStage<any, any>[] = [
    new CollectModulesStage(),         // Recipe → ModuleCollection
    new ValidateDependenciesStage(),   // Check requires/provides
    new SortModulesStage(),            // Topological sort, Geometry first
    new ApplyPrefixesStage(),          // Add prefixes to functions
    new ResolveCallsStage(),           // Map cross-module calls
    new GenerateMainStage(),           // Create orchestration
    new ExtractUniformsStage(),        // Build uniform mappings
    new CompileGLSLStage(this.gl)      // WebGL compilation
  ];
  
  compile(recipe: Recipe): CompiledProgram {
    let data: any = recipe;
    const executedStages: string[] = [];
    
    for (const stage of this.stages) {
      try {
        // Transform
        const output = stage.transform(data);
        
        // Validate
        const validation = stage.validate(output);
        if (!validation.isValid) {
          throw new CompilationError(stage.name, validation);
        }
        
        data = output;
        executedStages.push(stage.name);
      } catch (error) {
        if (error instanceof CompilationError) {
          throw error;
        }
        throw new CompilationError(stage.name, {
          isValid: false,
          errors: [error.message]
        });
      }
    }
    
    // Add metadata
    data.metadata.stages = executedStages;
    return data as CompiledProgram;
  }
}
```

## Pipeline Stages

### Stage 1: Collect Modules

```typescript
class CollectModulesStage implements CompilationStage<Recipe, ModuleCollection> {
  transform(recipe: Recipe): ModuleCollection {
    return {
      geometry: recipe.world.geometry,
      material: recipe.world.material,    // SINGLE material
      scene: recipe.world.scene,
      lights: recipe.world.lights,
      camera: recipe.photography.camera,
      estimator: recipe.photography.estimator,
      film: recipe.photography.film,
      developer: recipe.photography.developer
    };
  }
  
  validate(modules: ModuleCollection): ValidationResult {
    const errors: string[] = [];
    
    // Check all required modules present
    const required = [
      'geometry', 'material', 'scene', 'lights',
      'camera', 'estimator', 'film', 'developer'
    ];
    
    for (const key of required) {
      if (!modules[key]) {
        errors.push(`Missing required module: ${key}`);
      }
    }
    
    return { isValid: errors.length === 0, errors };
  }
}
```

### Stage 2: Validate Dependencies

```typescript
class ValidateDependenciesStage implements CompilationStage<ModuleCollection, ModuleCollection> {
  transform(modules: ModuleCollection): ModuleCollection {
    return modules;  // Pass through, validation only
  }
  
  validate(modules: ModuleCollection): ValidationResult {
    const errors: string[] = [];
    const allModules = Object.values(modules);
    
    // Build provides map
    const provides = new Map<string, ModuleDescriptor>();
    for (const module of allModules) {
      for (const fn of module.provides || []) {
        if (provides.has(fn)) {
          errors.push(
            `Duplicate function '${fn}' provided by ` +
            `${provides.get(fn)!.id.name} and ${module.id.name}`
          );
        }
        provides.set(fn, module);
      }
    }
    
    // Check all requires satisfied
    for (const module of allModules) {
      for (const fn of module.requires || []) {
        if (!provides.has(fn)) {
          errors.push(
            `Module ${module.id.name} requires '${fn}' ` +
            `but no module provides it`
          );
        }
      }
    }
    
    return { isValid: errors.length === 0, errors };
  }
}
```

### Stage 3: Sort Modules

```typescript
interface ProcessedModule {
  descriptor: ModuleDescriptor;
  prefixedSource: string;
  originalSource: string;
  functionMap: Map<string, string>;  // original → prefixed
}

class SortModulesStage implements CompilationStage<ModuleCollection, ProcessedModule[]> {
  transform(modules: ModuleCollection): ProcessedModule[] {
    const allModules = Object.values(modules);
    
    // Geometry MUST be first (defines types)
    const geometry = modules.geometry;
    const others = allModules.filter(m => m.id.kind !== 'geometry');
    
    // Topological sort the rest
    const sorted = this.topologicalSort(others);
    
    // Convert to ProcessedModule
    return [geometry, ...sorted].map(m => ({
      descriptor: m,
      prefixedSource: '',  // Will be filled by next stage
      originalSource: m.fragment.functions,
      functionMap: new Map()
    }));
  }
  
  validate(modules: ProcessedModule[]): ValidationResult {
    if (modules[0].descriptor.id.kind !== 'geometry') {
      return { 
        isValid: false, 
        errors: ['Geometry must be first module (defines types)'] 
      };
    }
    return { isValid: true };
  }
  
  private topologicalSort(modules: ModuleDescriptor[]): ModuleDescriptor[] {
    const sorted: ModuleDescriptor[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    
    const visit = (module: ModuleDescriptor) => {
      const key = `${module.id.kind}:${module.id.name}`;
      
      if (visiting.has(key)) {
        throw new Error(`Circular dependency detected at ${key}`);
      }
      if (visited.has(key)) return;
      
      visiting.add(key);
      
      // Visit dependencies first
      for (const required of module.requires || []) {
        const provider = modules.find(m => 
          m.provides?.includes(required)
        );
        if (provider) {
          visit(provider);
        }
      }
      
      visiting.delete(key);
      visited.add(key);
      sorted.push(module);
    };
    
    for (const module of modules) {
      visit(module);
    }
    
    return sorted;
  }
}
```

### Stage 4: Apply Prefixes

```typescript
class ApplyPrefixesStage implements CompilationStage<ProcessedModule[], ProcessedModule[]> {
  private prefixMap = {
    "geometry": "g_",
    "material": "m_",
    "scene": "sc_",
    "lights": "l_",
    "camera": "c_",
    "estimator": "e_",
    "film": "f_",
    "developer": "d_"
  };
  
  transform(modules: ProcessedModule[]): ProcessedModule[] {
    for (const module of modules) {
      const prefix = this.prefixMap[module.descriptor.id.kind];
      let source = module.originalSource;
      
      // Apply prefix to function definitions
      for (const fn of module.descriptor.provides || []) {
        const prefixed = prefix + fn;
        
        // Match function definition
        const pattern = new RegExp(
          `(\\w+\\s+)${fn}(\\s*\\()`,
          'g'
        );
        source = source.replace(pattern, `$1${prefixed}$2`);
        
        module.functionMap.set(fn, prefixed);
      }
      
      // Apply prefix to uniforms
      for (const param of module.descriptor.parameters || []) {
        const original = `uniform\\s+(\\w+)\\s+${param.name}`;
        const prefixed = `uniform $1 u_${prefix}${module.descriptor.id.name.toLowerCase()}_${param.name}`;
        source = source.replace(new RegExp(original, 'g'), prefixed);
      }
      
      module.prefixedSource = source;
    }
    
    return modules;
  }
  
  validate(modules: ProcessedModule[]): ValidationResult {
    // Check no naming conflicts after prefixing
    const allNames = new Set<string>();
    const errors: string[] = [];
    
    for (const module of modules) {
      for (const prefixed of module.functionMap.values()) {
        if (allNames.has(prefixed)) {
          errors.push(`Naming conflict: ${prefixed} appears multiple times`);
        }
        allNames.add(prefixed);
      }
    }
    
    return { isValid: errors.length === 0, errors };
  }
}
```

### Stage 5: Resolve Cross-Module Calls

```typescript
class ResolveCallsStage implements CompilationStage<ProcessedModule[], ProcessedModule[]> {
  transform(modules: ProcessedModule[]): ProcessedModule[] {
    // Build provides map
    const provides = new Map<string, ProcessedModule>();
    for (const module of modules) {
      for (const fn of module.descriptor.provides || []) {
        provides.set(fn, module);
      }
    }
    
    // Resolve calls in each module
    for (const module of modules) {
      let source = module.prefixedSource;
      
      for (const required of module.descriptor.requires || []) {
        const provider = provides.get(required);
        if (provider) {
          const prefixedName = provider.functionMap.get(required);
          if (prefixedName) {
            // Replace calls to required function
            const pattern = new RegExp(`\\b${required}\\(`, 'g');
            source = source.replace(pattern, `${prefixedName}(`);
          }
        }
      }
      
      module.prefixedSource = source;
    }
    
    return modules;
  }
  
  validate(modules: ProcessedModule[]): ValidationResult {
    // All requires should now be resolved
    return { isValid: true };
  }
}
```

### Stage 6: Generate Main

```typescript
class GenerateMainStage implements CompilationStage<ProcessedModule[], CompiledSource> {
  transform(modules: ProcessedModule[]): CompiledSource {
    const main = this.generateMain();
    const vertexShader = this.getVertexShader();
    
    return {
      modules,
      main,
      vertexShader
    };
  }
  
  validate(output: CompiledSource): ValidationResult {
    if (!output.main) {
      return { isValid: false, errors: ['Failed to generate main()'] };
    }
    return { isValid: true };
  }
  
  private generateMain(): string {
    return `
void main() {
  vec2 pixel = gl_FragCoord.xy;
  ivec2 pixel_id = ivec2(pixel);
  
  // Initialize random dimension counter
  g_dimension_counter = 0;
  
  // Sample for antialiasing
  vec2 xi = next_2d();
  
  // Generate ray
  Ray ray = c_generate_ray(pixel, xi);
  
  // Estimate radiance
  Spectrum radiance = e_estimate(ray);
  
  // Accumulate
  Radiance accumulated = f_accumulate(radiance, pixel);
  
  // Develop
  RGB color = d_develop(accumulated);
  
  gl_FragColor = vec4(color, 1.0);
}`;
  }
  
  private getVertexShader(): string {
    return `
#version 300 es
precision highp float;

in vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;
  }
}

interface CompiledSource {
  modules: ProcessedModule[];
  main: string;
  vertexShader: string;
}
```

### Stage 7: Extract Uniforms

```typescript
class ExtractUniformsStage implements CompilationStage<CompiledSource, CompiledWithUniforms> {
  transform(input: CompiledSource): CompiledWithUniforms {
    const uniforms: UniformInfo[] = [];
    
    // Extract module uniforms
    for (const module of input.modules) {
      const prefix = this.getPrefix(module.descriptor.id.kind);
      
      for (const param of module.descriptor.parameters || []) {
        const glslName = `u_${prefix}${module.descriptor.id.name.toLowerCase()}_${param.name}`;
        const paramPath = `${module.descriptor.id.kind}.${param.name}`;
        
        uniforms.push({
          paramPath,
          glslName,
          type: param.type,
          module: module.descriptor.id.name
        });
      }
    }
    
    // Add engine uniforms
    uniforms.push(
      { paramPath: 'resolution', glslName: 'u_resolution', type: 'vec2', module: 'engine' },
      { paramPath: 'frame_index', glslName: 'u_frame_index', type: 'int', module: 'engine' },
      { paramPath: 'sample_count', glslName: 'u_sample_count', type: 'int', module: 'engine' },
      { paramPath: 'film_reset', glslName: 'u_film_reset', type: 'bool', module: 'engine' }
    );
    
    return {
      ...input,
      uniforms
    };
  }
  
  validate(output: CompiledWithUniforms): ValidationResult {
    return { isValid: true };
  }
  
  private getPrefix(kind: string): string {
    const prefixMap = {
      "geometry": "g_",
      "material": "m_",
      "scene": "sc_",
      "lights": "l_",
      "camera": "c_",
      "estimator": "e_",
      "film": "f_",
      "developer": "d_"
    };
    return prefixMap[kind] || "";
  }
}

interface CompiledWithUniforms extends CompiledSource {
  uniforms: UniformInfo[];
}

interface UniformInfo {
  paramPath: string;
  glslName: string;
  type: string;
  module: string;
}
```

### Stage 8: Compile GLSL

```typescript
class CompileGLSLStage implements CompilationStage<CompiledWithUniforms, CompiledProgram> {
  constructor(private gl: WebGL2RenderingContext) {}
  
  transform(input: CompiledWithUniforms): CompiledProgram {
    // Assemble final fragment shader
    const fragmentSource = this.assembleFragmentShader(input);
    
    // Build line mapping for debugging
    const lineMap = this.buildLineMapping(input);
    
    // Compile shaders
    const vertexShader = this.compileShader(
      input.vertexShader,
      this.gl.VERTEX_SHADER
    );
    
    const fragmentShader = this.compileShader(
      fragmentSource,
      this.gl.FRAGMENT_SHADER
    );
    
    // Link program
    const program = this.linkProgram(vertexShader, fragmentShader);
    
    // Build UniformMap
    const uniformMap = UniformMap.build(input.uniforms, program, this.gl);
    
    // Clean up shaders
    this.gl.deleteShader(vertexShader);
    this.gl.deleteShader(fragmentShader);
    
    return {
      id: this.generateId(),
      program,
      uniformMap,
      recipe: null,  // Would be passed through pipeline
      modules: input.modules.map(m => m.descriptor),
      metadata: {
        compiledAt: Date.now(),
        vertexSource: input.vertexShader,
        fragmentSource,
        lineMap,
        stages: []  // Will be filled by pipeline
      }
    };
  }
  
  validate(output: CompiledProgram): ValidationResult {
    const status = this.gl.getProgramParameter(
      output.program,
      this.gl.LINK_STATUS
    );
    
    if (!status) {
      const error = this.gl.getProgramInfoLog(output.program);
      return { isValid: false, errors: [error || 'Link failed'] };
    }
    
    return { isValid: true };
  }
  
  private assembleFragmentShader(input: CompiledWithUniforms): string {
    const parts: string[] = [];
    
    // GLSL version and precision
    parts.push('#version 300 es');
    parts.push('precision highp float;');
    parts.push('');
    
    // Math utilities (always available)
    parts.push('// Math utilities');
    parts.push(MATH_UTILITIES);
    parts.push('');
    
    // Type definitions from geometry
    const geometry = input.modules.find(m => 
      m.descriptor.id.kind === 'geometry'
    );
    if (geometry) {
      parts.push('// Type definitions from geometry');
      parts.push(geometry.prefixedSource);
      parts.push('');
    }
    
    // Other modules in order
    for (const module of input.modules) {
      if (module.descriptor.id.kind !== 'geometry') {
        parts.push(`// Module: ${module.descriptor.id.name}`);
        parts.push(module.prefixedSource);
        parts.push('');
      }
    }
    
    // Engine uniforms
    parts.push('// Engine uniforms');
    parts.push('uniform vec2 u_resolution;');
    parts.push('uniform int u_frame_index;');
    parts.push('uniform int u_sample_count;');
    parts.push('uniform bool u_film_reset;');
    parts.push('');
    
    // Main function
    parts.push('// Main orchestration');
    parts.push(input.main);
    
    return parts.join('\n');
  }
  
  private compileShader(source: string, type: number): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) throw new Error('Failed to create shader');
    
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const error = this.gl.getShaderInfoLog(shader);
      const lines = source.split('\n');
      
      // Parse error for line number
      const match = error?.match(/ERROR: \d+:(\d+):/);
      if (match) {
        const lineNum = parseInt(match[1], 10);
        const context = this.getErrorContext(lines, lineNum);
        throw new CompilationError('GLSL compilation', {
          isValid: false,
          errors: [error],
          context
        });
      }
      
      throw new CompilationError('GLSL compilation', {
        isValid: false,
        errors: [error || 'Compile failed']
      });
    }
    
    return shader;
  }
  
  private linkProgram(vertex: WebGLShader, fragment: WebGLShader): WebGLProgram {
    const program = this.gl.createProgram();
    if (!program) throw new Error('Failed to create program');
    
    this.gl.attachShader(program, vertex);
    this.gl.attachShader(program, fragment);
    this.gl.linkProgram(program);
    
    return program;
  }
  
  private getErrorContext(lines: string[], lineNum: number): string {
    const start = Math.max(0, lineNum - 3);
    const end = Math.min(lines.length, lineNum + 3);
    
    const context = [];
    for (let i = start; i < end; i++) {
      const marker = i === lineNum - 1 ? '>>> ' : '    ';
      context.push(`${i + 1}: ${marker}${lines[i]}`);
    }
    
    return context.join('\n');
  }
  
  private buildLineMapping(input: CompiledWithUniforms): LineMapping {
    const lines: LineMapping['lines'] = [];
    let currentLine = 1;
    
    for (const module of input.modules) {
      const moduleLines = module.prefixedSource.split('\n');
      
      for (let i = 0; i < moduleLines.length; i++) {
        lines.push({
          compiledLine: currentLine++,
          sourceLine: i + 1,
          module: module.descriptor.id.name
        });
      }
    }
    
    return { lines };
  }
  
  private generateId(): string {
    return `program_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
```

## Math Utilities

```typescript
const MATH_UTILITIES = `
// Always available math utilities
const float PI = 3.14159265359;
const float EPSILON = 0.0001;
const float MAX_DIST = 1e10;

// Random sampling with automatic dimension tracking
int g_dimension_counter;

float next_1d() {
  return sample_1d(pixel_id, u_frame_index, g_dimension_counter++);
}

vec2 next_2d() {
  vec2 result = sample_2d(pixel_id, u_frame_index, g_dimension_counter);
  g_dimension_counter += 2;
  return result;
}

// Sampling helpers
vec2 sample_unit_disk(vec2 xi) {
  float theta = 2.0 * PI * xi.x;
  float r = sqrt(xi.y);
  return vec2(r * cos(theta), r * sin(theta));
}

// Type conversions
typedef vec3 Spectrum;
typedef vec3 Radiance;
typedef vec3 RGB;
`;
```

## Error Handling

```typescript
class CompilationError extends Error {
  constructor(
    public stage: string,
    public validation: ValidationResult,
    public context?: string
  ) {
    super(
      `Compilation failed at stage: ${stage}\n` +
      validation.errors.join('\n') +
      (context ? `\n\nContext:\n${context}` : '')
    );
  }
}
```

## Usage Example

```typescript
const gl = canvas.getContext('webgl2');
const compiler = new ShaderCompiler(gl);

// Define recipes
const recipes = [
  {
    world: {
      geometry: euclideanModule,
      material: disneyModule,  // Single material
      scene: sdfModule,
      lights: hdriModule
    },
    photography: {
      camera: pinholeModule,
      estimator: pathTracerModule,
      film: varianceModule,
      developer: acesModule
    }
  },
  // ... more recipes
];

// Eager compilation at startup
compiler.initialize(recipes);

// Later: instant access
const program = compiler.getProgram('euclidean_disney_sdf_hdri_pinhole_pathtracer_variance_aces');
gl.useProgram(program.program);

// Debug: get source for inspection
const source = compiler.getSource(program.id);
console.log(source);
```

## Performance Considerations

- **Eager compilation**: All variants compiled at startup (~1 second total)
- **No runtime compilation**: Zero shader compilation during interaction
- **Cached programs**: Instant switching between pre-compiled variants
- **String operations minimized**: Regex patterns pre-compiled where possible
- **Line mappings cached**: For quick error reporting

## Validation Requirements

1. **All modules present** before compilation starts
2. **Dependencies satisfied** - all requires have provides
3. **No circular dependencies** - topological sort succeeds
4. **Geometry first** - defines base types
5. **No naming conflicts** after prefixing
6. **Valid GLSL** - compiles without errors
7. **Successful linking** - vertex and fragment shaders compatible
