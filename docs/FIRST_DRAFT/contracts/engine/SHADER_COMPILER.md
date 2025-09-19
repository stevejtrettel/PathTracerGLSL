# Shader Compiler Contract

The ShaderCompiler transforms collections of modules into complete, executable GLSL programs using a pipeline architecture with lazy compilation.

## Core Interface

```typescript
interface ShaderCompiler {
    // Compile known recipes at startup
    initialize(recipes: Recipe[]): void;

    // Get pre-compiled program
    getProgram(recipe: Recipe): CompiledProgram;

    // Direct compilation (if needed)
    compile(recipe: Recipe): CompiledProgram;

    // Get compilation pipeline for testing/debugging
    getPipeline(): CompilationPipeline;

    // Source access for debugging
    getSource(programId: string): CompilationResult;
}
````

## Eager Compilation Implementation

```typescript 
class ShaderCompiler {
  private pipeline: CompilationPipeline;
  private programs = new Map<string, CompiledProgram>();
  
  constructor(private gl: WebGL2RenderingContext) {
    this.pipeline = new CompilationPipeline();
  }
  
  // Compile all known variants at startup
  initialize(recipes: Recipe[]): void {
    console.log(`Compiling ${recipes.length} shader variants...`);
    
    for (const recipe of recipes) {
      const key = this.getRecipeKey(recipe);
      try {
        const program = this.compile(recipe);
        this.programs.set(key, program);
        console.log(`✓ Compiled: ${key}`);
      } catch (error) {
        console.error(`✗ Failed to compile ${key}:`, error);
        throw error;
      }
    }
  }
  
  // Get pre-compiled program (instant)
  getProgram(recipe: Recipe): CompiledProgram {
    const key = this.getRecipeKey(recipe);
    const program = this.programs.get(key);
    
    if (!program) {
      throw new Error(`Program not pre-compiled: ${key}. Call initialize() with all recipes at startup.`);
    }
    
    return program;
  }
  
  // Direct compilation (used by initialize)
  compile(recipe: Recipe): CompiledProgram {
    return this.pipeline.compile(recipe);
  }
  
  private getRecipeKey(recipe: Recipe): string {
    // Simple key based on module names
    return [
      recipe.world.geometry.name,
      recipe.world.material.name,
      recipe.photography.camera.name,
      recipe.photography.estimator.name
    ].join('_');
  }
}
```

## Compiled Program Structure

```typescript
interface CompiledProgram {
  id: string;                          // Unique identifier
  program: WebGLProgram;                // GL program object
  uniformMap: UniformMap;               // Explicit parameter mappings
  recipe: Recipe;                       // Source recipe
  metadata: {
    compiledAt: number;               // Timestamp
    modules: string[];                // Module IDs used
    mainTemplate: string;             // Which main() was used
    lineMap: LineMapping;             // Error line mapping
    pipeline: string[];               // Stages executed
  };
}
```

## Pipeline Stage Implementations

### Stage 1: Module Collection
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
    
    if (!modules.geometry) errors.push("Missing Geometry module");
    if (!modules.material) errors.push("Missing Material module");
    if (!modules.scene) errors.push("Missing Scene module");
    if (!modules.lights) errors.push("Missing Lights module");
    if (!modules.camera) errors.push("Missing Camera module");
    if (!modules.estimator) errors.push("Missing Estimator module");
    if (!modules.film) errors.push("Missing Film module");
    if (!modules.developer) errors.push("Missing Developer module");
    
    return { isValid: errors.length === 0, errors };
  }
}

interface ModuleCollection {
  geometry: ModuleDescriptor;
  material: ModuleDescriptor;       // SINGLE, not array
  scene: ModuleDescriptor;
  lights: ModuleDescriptor;
  camera: ModuleDescriptor;
  estimator: ModuleDescriptor;
  film: ModuleDescriptor;
  developer: ModuleDescriptor;
}
```

### Stage 2: Dependency Validation
```typescript
class ValidateDependenciesStage implements CompilationStage<ModuleCollection, ModuleCollection> {
  transform(modules: ModuleCollection): ModuleCollection {
    return modules; // Pass through, validation only
  }
  
  validate(modules: ModuleCollection): ValidationResult {
    const errors: string[] = [];
    const allModules = Object.values(modules);
    
    // Build provides map
    const provides = new Map<string, ModuleDescriptor>();
    for (const module of allModules) {
      for (const fn of module.fragment.provides || []) {
        if (provides.has(fn)) {
          errors.push(`Duplicate function '${fn}' provided by ${provides.get(fn)!.id.name} and ${module.id.name}`);
        }
        provides.set(fn, module);
      }
    }
    
    // Check all requires are satisfied
    for (const module of allModules) {
      for (const fn of module.fragment.requires || []) {
        if (!provides.has(fn)) {
          errors.push(`Module ${module.id.name} requires '${fn}' but no module provides it`);
        }
      }
    }
    
    // Check for cycles
    const cycles = this.findCycles(allModules);
    for (const cycle of cycles) {
      errors.push(`Circular dependency: ${cycle.join(' → ')}`);
    }
    
    return { isValid: errors.length === 0, errors };
  }
  
  private findCycles(modules: ModuleDescriptor[]): string[][] {
    // Implement cycle detection (Tarjan's algorithm)
    // Returns array of cycles found
    return [];
  }
}
```

### Stage 3: Module Sorting
```typescript
class SortModulesStage implements CompilationStage<ModuleCollection, ProcessedModule[]> {
  transform(modules: ModuleCollection): ProcessedModule[] {
    const allModules = Object.values(modules);
    
    // Geometry MUST be first
    const geometry = modules.geometry;
    const others = allModules.filter(m => m.id.kind !== 'Geometry');
    
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
    if (modules[0].descriptor.id.kind !== 'Geometry') {
      return { 
        isValid: false, 
        errors: ['Geometry must be first module'] 
      };
    }
    return { isValid: true };
  }
  
  private topologicalSort(modules: ModuleDescriptor[]): ModuleDescriptor[] {
    // Kahn's algorithm implementation
    return modules; // Simplified
  }
}

interface ProcessedModule {
  descriptor: ModuleDescriptor;
  prefixedSource: string;
  originalSource: string;
  functionMap: Map<string, string>;  // original → prefixed
}
```

### Stage 4: Prefix Application
```typescript
class ApplyPrefixesStage implements CompilationStage<ProcessedModule[], ProcessedModule[]> {
  private prefixMap = {
    "Geometry": "g_",
    "Material": "m_",
    "Scene": "sc_",
    "Lights": "l_",
    "Camera": "c_",
    "Estimator": "e_",
    "Film": "f_",
    "Developer": "d_"
  };
  
  transform(modules: ProcessedModule[]): ProcessedModule[] {
    for (const module of modules) {
      const prefix = this.prefixMap[module.descriptor.id.kind];
      
      // Apply prefix to functions
      let source = module.originalSource;
      for (const fn of module.descriptor.fragment.provides || []) {
        const prefixed = prefix + fn;
        source = source.replace(
          new RegExp(`\\b${fn}\\b`, 'g'),
          prefixed
        );
        module.functionMap.set(fn, prefixed);
      }
      
      // Apply prefix to uniforms
      for (const param of module.descriptor.parameters || []) {
        const original = `uniform \\w+ ${param.name}`;
        const prefixed = `uniform ${param.type} u_${prefix}${module.descriptor.id.name.toLowerCase()}_${param.name}`;
        source = source.replace(new RegExp(original), prefixed);
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

### Stage 5: Cross-Module Call Resolution
```typescript
class ResolveCallsStage implements CompilationStage<ProcessedModule[], ProcessedModule[]> {
  transform(modules: ProcessedModule[]): ProcessedModule[] {
    // Build provides map
    const provides = new Map<string, ProcessedModule>();
    for (const module of modules) {
      for (const fn of module.descriptor.fragment.provides || []) {
        provides.set(fn, module);
      }
    }
    
    // Resolve calls in each module
    for (const module of modules) {
      let source = module.prefixedSource;
      
      for (const required of module.descriptor.fragment.requires || []) {
        const provider = provides.get(required);
        if (provider) {
          const prefixedName = provider.functionMap.get(required);
          // Replace calls to required function with prefixed version
          source = source.replace(
            new RegExp(`\\b${required}\\(`, 'g'),
            `${prefixedName}(`
          );
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

### Stage 6: Main Generation
```typescript
class GenerateMainStage implements CompilationStage<ProcessedModule[], CompiledSource> {
  transform(modules: ProcessedModule[]): CompiledSource {
    const film = modules.find(m => m.descriptor.id.kind === 'Film');
    const template = this.selectTemplate(film);
    const main = this.generateMain(template, modules);
    
    return {
      modules,
      main,
      vertexShader: VERTEX_SHADER
    };
  }
  
  validate(output: CompiledSource): ValidationResult {
    if (!output.main) {
      return { isValid: false, errors: ['Failed to generate main()'] };
    }
    return { isValid: true };
  }
  
  private selectTemplate(film?: ProcessedModule): string {
    if (film?.descriptor.metadata?.debug) {
      return DEBUG_MAIN_TEMPLATE;
    }
    if (film?.descriptor.metadata?.realtime) {
      return REALTIME_MAIN_TEMPLATE;
    }
    return STANDARD_MAIN_TEMPLATE;
  }
  
  private generateMain(template: string, modules: ProcessedModule[]): string {
    // Template uses prefixed function names
    return template;
  }
}

const STANDARD_MAIN_TEMPLATE = `
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

interface CompiledSource {
  modules: ProcessedModule[];
  main: string;
  vertexShader: string;
}
```

### Stage 7: Uniform Extraction
```typescript
class ExtractUniformsStage implements CompilationStage<CompiledSource, CompiledWithUniforms> {
  transform(input: CompiledSource): CompiledWithUniforms {
    const uniforms: UniformInfo[] = [];
    
    for (const module of input.modules) {
      for (const param of module.descriptor.parameters || []) {
        const prefix = this.getPrefix(module.descriptor.id.kind);
        const glslName = `u_${prefix}${module.descriptor.id.name.toLowerCase()}_${param.name}`;
        const paramPath = `${module.descriptor.id.kind.toLowerCase()}.${param.name}`;
        
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
      { paramPath: 'resolution', glslName: 'u_resolution', type: 'vec2', module: 'Engine' },
      { paramPath: 'frame_index', glslName: 'u_frame_index', type: 'int', module: 'Engine' },
      { paramPath: 'sample_count', glslName: 'u_sample_count', type: 'int', module: 'Engine' }
    );
    
    return {
      ...input,
      uniforms
    };
  }
  
  validate(output: CompiledWithUniforms): ValidationResult {
    return { isValid: true };
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

### Stage 8: WebGL Compilation
```typescript
class CompileGLSLStage implements CompilationStage<CompiledWithUniforms, CompiledProgram> {
  constructor(private gl: WebGL2RenderingContext) {}
  
  transform(input: CompiledWithUniforms): CompiledProgram {
    // Assemble final source
    const fragmentSource = this.assembleSource(input);
    
    // Compile shaders
    const vertexShader = this.compileShader(input.vertexShader, this.gl.VERTEX_SHADER);
    const fragmentShader = this.compileShader(fragmentSource, this.gl.FRAGMENT_SHADER);
    
    // Link program
    const program = this.linkProgram(vertexShader, fragmentShader);
    
    // Build UniformMap
    const uniformMap = UniformMap.build(input.uniforms, program, this.gl);
    
    return {
      id: generateId(),
      program,
      uniformMap,
      recipe: null, // Would be passed through pipeline
      metadata: {
        compiledAt: Date.now(),
        modules: input.modules.map(m => m.descriptor.id.name),
        mainTemplate: 'standard',
        lineMap: this.buildLineMap(input),
        pipeline: ['collect', 'validate', 'sort', 'prefix', 'resolve', 'main', 'uniforms', 'compile']
      }
    };
  }
  
  validate(output: CompiledProgram): ValidationResult {
    const status = this.gl.getProgramParameter(output.program, this.gl.LINK_STATUS);
    if (!status) {
      const error = this.gl.getProgramInfoLog(output.program);
      return { isValid: false, errors: [error || 'Link failed'] };
    }
    return { isValid: true };
  }
  
  private assembleSource(input: CompiledWithUniforms): string {
    const parts: string[] = [];
    
    // Math utilities (always available)
    parts.push('// Math utilities');
    parts.push(MATH_UTILITIES);
    
    // Module sources in order
    for (const module of input.modules) {
      parts.push(`// Module: ${module.descriptor.id.name}`);
      parts.push(module.prefixedSource);
    }
    
    // Main function
    parts.push('// Main orchestration');
    parts.push(input.main);
    
    return parts.join('\n\n');
  }
  
  private compileShader(source: string, type: number): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) throw new Error('Failed to create shader');
    
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const error = this.gl.getShaderInfoLog(shader);
      throw new CompilationError('Shader compilation', { isValid: false, errors: [error || 'Compile failed'] });
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
}
```

## Error Handling

```typescript
class CompilationError extends Error {
  constructor(
    public stage: string,
    public validation: ValidationResult,
    public sourceContext?: string
  ) {
    super(`Compilation failed at stage: ${stage}\n${validation.errors?.join('\n')}`);
  }
}
```

## Integration with Engine

```typescript
class ShaderCompiler {
  private pipeline: CompilationPipeline;
  private cache: Map<string, CompiledProgram> = new Map();
  
  constructor(private gl: WebGL2RenderingContext) {
    this.pipeline = new CompilationPipeline();
  }
  
  compile(recipe: Recipe): CompiledProgram {
    // Check cache
    const key = this.getCacheKey(recipe);
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }
    
    // Run pipeline
    const program = this.pipeline.compile(recipe);
    
    // Cache result
    this.cache.set(key, program);
    
    return program;
  }
  
  private getCacheKey(recipe: Recipe): string {
    // Hash based on module IDs
    return JSON.stringify({
      geometry: recipe.world.geometry.id,
      material: recipe.world.material.id,  // Single material
      scene: recipe.world.scene.id,
      // ... etc
    });
  }
}
```

## Validation Rules

The compiler validates at each stage:
1. All required modules present
2. All `requires` satisfied by `provides`
3. No circular dependencies
4. Geometry is first (defines types)
5. No naming conflicts after prefixing
6. Valid GLSL syntax
7. Successful WebGL compilation and linking

## Performance Considerations

- Compile all programs at startup
- Cache by recipe hash
- Keep source mappings for debugging
- Minimize string operations
- Use pipeline for clear error reporting
