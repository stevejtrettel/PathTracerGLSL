
# Compilation Pipeline Contract

## Purpose

The CompilationPipeline transforms a Recipe and its associated modules through 8 sequential stages to produce a complete, executable WebGL program. Each stage validates its output before passing to the next, making errors precise and actionable.

## Required Interface

```typescript
interface CompilationPipeline {
  // Pipeline execution
  execute(context: PipelineContext, modules: ModuleCollection): PipelineResult;
  
  // Stage management
  getStages(): CompilationStage[];
  getStage(name: string): CompilationStage | null;
  validateStages(): ValidationResult;
  
  // Configuration
  setStageEnabled(stageName: string, enabled: boolean): void;
  isStageEnabled(stageName: string): boolean;
  
  // Debugging
  getLastExecutionLog(): StageExecutionLog[];
  getStageOutput(stageName: string): any;
  
  // Customization
  insertStageAfter(afterStage: string, stage: CompilationStage): void;
  replaceStage(stageName: string, stage: CompilationStage): void;
}
```

## Stage Interface

```typescript
interface CompilationStage<TInput = any, TOutput = any> {
  // Identity
  name: string;
  description: string;
  required: boolean;                    // Can this stage be skipped?
  
  // Execution
  execute(input: TInput, context: PipelineContext): TOutput;
  validate(output: TOutput): ValidationResult;
  
  // Error recovery
  canRecover(error: Error): boolean;
  recover(input: TInput, error: Error): TOutput | null;
}

interface StageExecutionLog {
  stage: string;
  startTime: number;
  endTime: number;
  success: boolean;
  errors?: string[];
  warnings?: string[];
  outputSize?: number;                  // Bytes or line count
}
```

## Pipeline Architecture

```typescript
class StandardCompilationPipeline implements CompilationPipeline {
  private stages: CompilationStage[] = [
    new CollectModulesStage(),          // Stage 1
    new ValidateDependenciesStage(),    // Stage 2
    new SortModulesStage(),              // Stage 3
    new ApplyPrefixesStage(),            // Stage 4
    new ResolveCallsStage(),             // Stage 5
    new GenerateMainStage(),             // Stage 6
    new ExtractUniformsStage(),          // Stage 7
    new CompileGLSLStage(this.gl)        // Stage 8
  ];
  
  private stageOutputs: Map<string, any>;
  private executionLog: StageExecutionLog[];
  private enabledStages: Set<string>;
  
  constructor(private gl: WebGL2RenderingContext) {
    this.validatePipeline();
  }
  
  private validatePipeline(): void {
    // Ensure required stages present
    const requiredStages = [
      'CollectModules',
      'ValidateDependencies', 
      'SortModules',
      'ApplyPrefixes',
      'CompileGLSL'
    ];
    
    const stageNames = this.stages.map(s => s.name);
    for (const required of requiredStages) {
      if (!stageNames.includes(required)) {
        throw new Error(`Required stage missing: ${required}`);
      }
    }
  }
}
```

## Pipeline Execution Contract

```typescript
execute(context: PipelineContext, modules: ModuleCollection): PipelineResult {
  this.stageOutputs = new Map();
  this.executionLog = [];
  
  let data: any = modules;
  const startTime = performance.now();
  
  for (const stage of this.stages) {
    // Skip disabled stages (if not required)
    if (!this.enabledStages.has(stage.name) && !stage.required) {
      console.log(`Skipping stage: ${stage.name}`);
      continue;
    }
    
    const stageStart = performance.now();
    const log: StageExecutionLog = {
      stage: stage.name,
      startTime: stageStart,
      endTime: 0,
      success: false
    };
    
    try {
      // Execute stage
      const output = stage.execute(data, context);
      
      // Validate output
      const validation = stage.validate(output);
      if (!validation.valid) {
        throw new CompilationError(
          stage.name,
          validation,
          context.recipe.id
        );
      }
      
      // Store output for debugging
      this.stageOutputs.set(stage.name, output);
      
      // Pass to next stage
      data = output;
      
      // Log success
      log.success = true;
      log.endTime = performance.now();
      log.warnings = validation.warnings;
      
    } catch (error) {
      log.errors = [error.message];
      log.endTime = performance.now();
      
      // Try recovery if possible
      if (stage.canRecover(error)) {
        console.warn(`Stage ${stage.name} failed, attempting recovery`);
        const recovered = stage.recover(data, error);
        
        if (recovered) {
          data = recovered;
          log.success = true;
          log.warnings = ['Recovered from error'];
        } else {
          this.executionLog.push(log);
          throw error;
        }
      } else {
        this.executionLog.push(log);
        throw error;
      }
    }
    
    this.executionLog.push(log);
  }
  
  // Build result
  const compileTime = performance.now() - startTime;
  const finalOutput = data as CompiledOutput;
  
  return {
    glProgram: finalOutput.program,
    uniformMap: finalOutput.uniformMap,
    vertexSource: finalOutput.vertexSource,
    fragmentSource: finalOutput.fragmentSource,
    lineMap: finalOutput.lineMap,
    compileTime,
    stagesExecuted: this.executionLog.map(l => l.stage)
  };
}
```

## Stage 1: Module Collection

```typescript
class CollectModulesStage implements CompilationStage<ModuleCollection, ProcessedModule[]> {
  name = 'CollectModules';
  description = 'Collect and prepare modules from recipe';
  required = true;
  
  execute(modules: ModuleCollection, context: PipelineContext): ProcessedModule[] {
    const processed: ProcessedModule[] = [];
    
    // Process in fixed order
    const moduleOrder: (keyof ModuleCollection)[] = [
      'geometry',    // Must be first
      'material',
      'scene',
      'lights',
      'camera',
      'estimator',
      'film',
      'developer'
    ];
    
    for (const key of moduleOrder) {
      const module = modules[key];
      if (!module) {
        throw new Error(`Missing required module: ${key}`);
      }
      
      processed.push({
        descriptor: module,
        originalSource: module.fragment.functions,
        prefixedSource: '',  // Will be filled by ApplyPrefixes
        functionMap: new Map(),
        prefix: MODULE_PREFIX_MAP[module.id.kind]
      });
    }
    
    return processed;
  }
  
  validate(output: ProcessedModule[]): ValidationResult {
    const errors: string[] = [];
    
    if (output.length !== 8) {
      errors.push(`Expected 8 modules, got ${output.length}`);
    }
    
    // Geometry must be first
    if (output[0]?.descriptor.id.kind !== 'geometry') {
      errors.push('Geometry module must be first');
    }
    
    return { valid: errors.length === 0, errors };
  }
  
  canRecover(error: Error): boolean {
    return false;  // Cannot recover from missing modules
  }
  
  recover(input: ModuleCollection, error: Error): ProcessedModule[] | null {
    return null;
  }
}
```

## Stage 2: Dependency Validation

```typescript
class ValidateDependenciesStage implements CompilationStage<ProcessedModule[], ProcessedModule[]> {
  name = 'ValidateDependencies';
  description = 'Validate all requires have provides';
  required = true;
  
  execute(modules: ProcessedModule[], context: PipelineContext): ProcessedModule[] {
    // Pass through - validation happens in validate()
    return modules;
  }
  
  validate(modules: ProcessedModule[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Build provides map
    const provides = new Map<string, string>();  // function -> module
    for (const module of modules) {
      for (const fn of module.descriptor.fragment.provides || []) {
        if (provides.has(fn)) {
          warnings.push(
            `Function '${fn}' provided by both ${provides.get(fn)} and ${module.descriptor.id.name}`
          );
        }
        provides.set(fn, module.descriptor.id.name);
      }
    }
    
    // Check all requires
    for (const module of modules) {
      for (const fn of module.descriptor.fragment.requires || []) {
        if (!provides.has(fn)) {
          errors.push(
            `${module.descriptor.id.name} requires '${fn}' but no module provides it`
          );
        }
      }
    }
    
    // Check for cycles
    const cycles = this.detectCycles(modules);
    for (const cycle of cycles) {
      errors.push(`Dependency cycle: ${cycle.join(' -> ')}`);
    }
    
    return { valid: errors.length === 0, errors, warnings };
  }
  
  private detectCycles(modules: ProcessedModule[]): string[][] {
    // Simplified cycle detection
    // Full implementation would use Tarjan's algorithm
    return [];
  }
  
  canRecover(error: Error): boolean {
    return false;  // Cannot fix missing dependencies
  }
  
  recover(input: ProcessedModule[], error: Error): ProcessedModule[] | null {
    return null;
  }
}
```

## Stage 3: Module Sorting

```typescript
class SortModulesStage implements CompilationStage<ProcessedModule[], ProcessedModule[]> {
  name = 'SortModules';
  description = 'Sort modules by dependency order (Geometry first)';
  required = true;
  
  execute(modules: ProcessedModule[], context: PipelineContext): ProcessedModule[] {
    // Extract geometry (must be first)
    const geometry = modules.find(m => m.descriptor.id.kind === 'geometry');
    if (!geometry) {
      throw new Error('No Geometry module found');
    }
    
    // Get others
    const others = modules.filter(m => m !== geometry);
    
    // Topological sort based on dependencies
    const sorted = this.topologicalSort(others);
    
    // Geometry first, then sorted others
    return [geometry, ...sorted];
  }
  
  validate(output: ProcessedModule[]): ValidationResult {
    const errors: string[] = [];
    
    // Verify Geometry is first
    if (output[0]?.descriptor.id.kind !== 'geometry') {
      errors.push('Geometry must be first after sorting');
    }
    
    // Verify dependencies are satisfied in order
    const available = new Set<string>();
    
    for (const module of output) {
      // Add this module's provides
      for (const fn of module.descriptor.fragment.provides || []) {
        available.add(fn);
      }
      
      // Check requires come before
      for (const fn of module.descriptor.fragment.requires || []) {
        if (!available.has(fn)) {
          errors.push(
            `${module.descriptor.id.name} requires '${fn}' which comes later in order`
          );
        }
      }
    }
    
    return { valid: errors.length === 0, errors };
  }
  
  private topologicalSort(modules: ProcessedModule[]): ProcessedModule[] {
    // Kahn's algorithm
    const sorted: ProcessedModule[] = [];
    const remaining = [...modules];
    const satisfied = new Set<string>();
    
    // Add built-in functions as satisfied
    satisfied.add('sample_hemisphere');
    satisfied.add('sample_2d');
    // ... other built-ins
    
    while (remaining.length > 0) {
      // Find module with all requirements satisfied
      const index = remaining.findIndex(m => {
        const requires = m.descriptor.fragment.requires || [];
        return requires.every(fn => satisfied.has(fn));
      });
      
      if (index === -1) {
        // Circular dependency or missing requirement
        throw new Error('Cannot sort modules - circular or missing dependency');
      }
      
      // Move to sorted
      const [module] = remaining.splice(index, 1);
      sorted.push(module);
      
      // Mark provides as satisfied
      for (const fn of module.descriptor.fragment.provides || []) {
        satisfied.add(fn);
      }
    }
    
    return sorted;
  }
  
  canRecover(error: Error): boolean {
    return false;
  }
  
  recover(input: ProcessedModule[], error: Error): ProcessedModule[] | null {
    return null;
  }
}
```

## Stage 4: Apply Prefixes

```typescript
class ApplyPrefixesStage implements CompilationStage<ProcessedModule[], ProcessedModule[]> {
  name = 'ApplyPrefixes';
  description = 'Add module prefixes to functions and uniforms';
  required = true;
  
  execute(modules: ProcessedModule[], context: PipelineContext): ProcessedModule[] {
    for (const module of modules) {
      const prefix = module.prefix;
      let source = module.originalSource;
      
      // Prefix provided functions
      for (const fn of module.descriptor.fragment.provides || []) {
        const prefixed = prefix + fn;
        
        // Replace function definition
        const fnRegex = new RegExp(`\\b(\\w+\\s+)${fn}\\s*\\(`, 'g');
        source = source.replace(fnRegex, `$1${prefixed}(`);
        
        // Map for later stages
        module.functionMap.set(fn, prefixed);
      }
      
      // Prefix uniforms
      for (const param of module.descriptor.parameters || []) {
        const uniformName = `u_${prefix}${module.descriptor.id.name.toLowerCase()}_${param.name}`;
        
        // Replace uniform declaration
        const uniformRegex = new RegExp(
          `uniform\\s+(\\w+)\\s+${param.name}\\b`,
          'g'
        );
        source = source.replace(uniformRegex, `uniform $1 ${uniformName}`);
        
        // Replace references in code
        const refRegex = new RegExp(`\\b${param.name}\\b`, 'g');
        source = source.replace(refRegex, uniformName);
      }
      
      module.prefixedSource = source;
    }
    
    return modules;
  }
  
  validate(output: ProcessedModule[]): ValidationResult {
    const errors: string[] = [];
    const allPrefixed = new Set<string>();
    
    for (const module of output) {
      // Check prefixing happened
      if (!module.prefixedSource) {
        errors.push(`Module ${module.descriptor.id.name} has no prefixed source`);
      }
      
      // Check for conflicts
      for (const prefixed of module.functionMap.values()) {
        if (allPrefixed.has(prefixed)) {
          errors.push(`Duplicate prefixed function: ${prefixed}`);
        }
        allPrefixed.add(prefixed);
      }
    }
    
    return { valid: errors.length === 0, errors };
  }
  
  canRecover(error: Error): boolean {
    return false;
  }
  
  recover(input: ProcessedModule[], error: Error): ProcessedModule[] | null {
    return null;
  }
}
```



## Stage 5: Resolve Cross-Module Calls (continued)

```typescript
class ResolveCallsStage implements CompilationStage<ProcessedModule[], ProcessedModule[]> {
  name = 'ResolveCalls';
  description = 'Map cross-module function calls to prefixed names';
  required = true;
  
  execute(modules: ProcessedModule[], context: PipelineContext): ProcessedModule[] {
    // Build global function map: unprefixed -> prefixed
    const globalFunctionMap = new Map<string, string>();
    
    for (const module of modules) {
      for (const [original, prefixed] of module.functionMap) {
        globalFunctionMap.set(original, prefixed);
      }
    }
    
    // Resolve calls in each module
    for (const module of modules) {
      let source = module.prefixedSource;
      
      // Replace calls to required functions
      for (const required of module.descriptor.fragment.requires || []) {
        const prefixedName = globalFunctionMap.get(required);
        
        if (!prefixedName) {
          throw new Error(
            `Cannot resolve function '${required}' required by ${module.descriptor.id.name}`
          );
        }
        
        // Replace function calls (but not definitions)
        // Look for: functionName( but not return_type functionName(
        const callRegex = new RegExp(
          `(?<!\\w+\\s+)\\b${required}\\s*\\(`,
          'g'
        );
        source = source.replace(callRegex, `${prefixedName}(`);
      }
      
      module.prefixedSource = source;
    }
    
    return modules;
  }
  
  validate(output: ProcessedModule[]): ValidationResult {
    const errors: string[] = [];
    
    // Check all requires are resolved
    for (const module of output) {
      for (const required of module.descriptor.fragment.requires || []) {
        // Simple check: the required function shouldn't appear unprefixed
        const unprefixedRegex = new RegExp(`\\b${required}\\s*\\(`, 'g');
        if (unprefixedRegex.test(module.prefixedSource)) {
          errors.push(
            `Unresolved call to '${required}' in ${module.descriptor.id.name}`
          );
        }
      }
    }
    
    return { valid: errors.length === 0, errors };
  }
  
  canRecover(error: Error): boolean {
    return false;  // Cannot fix missing function mappings
  }
  
  recover(input: ProcessedModule[], error: Error): ProcessedModule[] | null {
    return null;
  }
}
```

## Stage 6: Generate Main Function

```typescript
class GenerateMainStage implements CompilationStage<ProcessedModule[], ShaderSources> {
  name = 'GenerateMain';
  description = 'Generate main() orchestration function';
  required = true;
  
  private templates = {
    standard: STANDARD_MAIN_TEMPLATE,
    debug: DEBUG_MAIN_TEMPLATE,
    realtime: REALTIME_MAIN_TEMPLATE
  };
  
  execute(modules: ProcessedModule[], context: PipelineContext): ShaderSources {
    // Select template based on film metadata
    const film = modules.find(m => m.descriptor.id.kind === 'film');
    const template = this.selectTemplate(film, context);
    
    // Generate main function with prefixed calls
    const main = this.expandTemplate(template, modules);
    
    // Assemble fragment shader source
    const fragmentSource = this.assembleFragmentShader(modules, main);
    
    // Vertex shader is always the same
    const vertexSource = STANDARD_VERTEX_SHADER;
    
    return {
      modules,
      vertexSource,
      fragmentSource,
      main
    };
  }
  
  validate(output: ShaderSources): ValidationResult {
    const errors: string[] = [];
    
    if (!output.vertexSource) {
      errors.push('Missing vertex shader');
    }
    
    if (!output.fragmentSource) {
      errors.push('Missing fragment shader');
    }
    
    if (!output.main) {
      errors.push('Missing main function');
    }
    
    // Check main() exists in fragment source
    if (!output.fragmentSource.includes('void main()')) {
      errors.push('Fragment shader missing main() function');
    }
    
    return { valid: errors.length === 0, errors };
  }
  
  private selectTemplate(film?: ProcessedModule, context?: PipelineContext): string {
    // Check for template hint in context
    if (context?.metadata?.mainTemplate) {
      return this.templates[context.metadata.mainTemplate] || this.templates.standard;
    }
    
    // Check film metadata
    if (film?.descriptor.metadata?.template) {
      return this.templates[film.descriptor.metadata.template] || this.templates.standard;
    }
    
    return this.templates.standard;
  }
  
  private expandTemplate(template: string, modules: ProcessedModule[]): string {
    let expanded = template;
    
    // Replace template variables with prefixed function names
    const replacements = {
      '{{GENERATE_RAY}}': this.getPrefixedFunction(modules, 'generate_ray'),
      '{{ESTIMATE}}': this.getPrefixedFunction(modules, 'estimate'),
      '{{ACCUMULATE}}': this.getPrefixedFunction(modules, 'accumulate'),
      '{{DEVELOP}}': this.getPrefixedFunction(modules, 'develop'),
      '{{SAMPLE_2D}}': 'sample_2d',  // Built-in
    };
    
    for (const [placeholder, replacement] of Object.entries(replacements)) {
      expanded = expanded.replace(new RegExp(placeholder, 'g'), replacement);
    }
    
    return expanded;
  }
  
  private getPrefixedFunction(modules: ProcessedModule[], original: string): string {
    for (const module of modules) {
      const prefixed = module.functionMap.get(original);
      if (prefixed) return prefixed;
    }
    throw new Error(`Cannot find prefixed name for '${original}'`);
  }
  
  private assembleFragmentShader(modules: ProcessedModule[], main: string): string {
    const parts: string[] = [];
    
    // GLSL version and precision
    parts.push('#version 300 es');
    parts.push('precision highp float;');
    parts.push('precision highp int;');
    parts.push('');
    
    // Math utilities (always available)
    parts.push('// ============ Math Utilities ============');
    parts.push(MATH_UTILITIES);
    parts.push('');
    
    // Module sources in dependency order
    for (const module of modules) {
      parts.push(`// ============ ${module.descriptor.id.name} Module ============`);
      parts.push(module.prefixedSource);
      parts.push('');
    }
    
    // Engine uniforms
    parts.push('// ============ Engine Uniforms ============');
    parts.push('uniform vec2 u_resolution;');
    parts.push('uniform int u_frame_index;');
    parts.push('uniform int u_sample_count;');
    parts.push('uniform float u_time;');
    parts.push('uniform bool u_film_reset;');
    parts.push('');
    
    // Film texture uniforms
    parts.push('// ============ Film Textures ============');
    parts.push('uniform sampler2D u_film_radiance_previous;');
    parts.push('uniform sampler2D u_film_variance_previous;');
    parts.push('uniform sampler2D u_film_samples_previous;');
    parts.push('');
    
    // Output
    parts.push('// ============ Output ============');
    parts.push('out vec4 fragColor;');
    parts.push('');
    
    // Main function
    parts.push('// ============ Main Orchestration ============');
    parts.push(main);
    
    return parts.join('\n');
  }
  
  canRecover(error: Error): boolean {
    // Could potentially fall back to simpler template
    return error.message.includes('template');
  }
  
  recover(input: ProcessedModule[], error: Error): ShaderSources | null {
    // Try with standard template as fallback
    console.warn('Falling back to standard main template');
    return this.execute(input, { 
      recipe: null as any,
      modules: [],
      errors: [],
      warnings: [],
      metadata: { mainTemplate: 'standard' }
    });
  }
}

interface ShaderSources {
  modules: ProcessedModule[];
  vertexSource: string;
  fragmentSource: string;
  main: string;
}

const STANDARD_MAIN_TEMPLATE = `
void main() {
  vec2 pixel = gl_FragCoord.xy;
  ivec2 pixel_id = ivec2(pixel);
  
  // Random offset for antialiasing
  vec2 xi = {{SAMPLE_2D}}(pixel_id, u_frame_index, 0);
  
  // Generate camera ray
  Ray ray = {{GENERATE_RAY}}(pixel, xi);
  
  // Estimate radiance
  vec3 radiance = {{ESTIMATE}}(ray);
  
  // Accumulate in film
  vec3 accumulated = {{ACCUMULATE}}(radiance, pixel);
  
  // Tonemap
  vec3 color = {{DEVELOP}}(accumulated);
  
  fragColor = vec4(color, 1.0);
}`;

const STANDARD_VERTEX_SHADER = `
#version 300 es
precision highp float;

in vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;
```

## Stage 7: Extract Uniforms

```typescript
class ExtractUniformsStage implements CompilationStage<ShaderSources, UniformData> {
  name = 'ExtractUniforms';
  description = 'Extract uniform mappings for parameter binding';
  required = true;
  
  execute(input: ShaderSources, context: PipelineContext): UniformData {
    const uniforms: UniformInfo[] = [];
    const textureUniforms: TextureUniformInfo[] = [];
    
    // Extract parameter uniforms from each module
    for (const module of input.modules) {
      const prefix = module.prefix;
      const moduleName = module.descriptor.id.name.toLowerCase();
      
      for (const param of module.descriptor.parameters || []) {
        // Build mapping
        const glslName = `u_${prefix}${moduleName}_${param.name}`;
        const paramPath = `${module.descriptor.id.kind}.${param.name}`;
        
        uniforms.push({
          paramPath,
          glslName,
          type: param.type as GLSLType,
          module: module.descriptor.id.name,
          default: param.default,
          min: param.min,
          max: param.max
        });
      }
      
      // Extract texture uniforms
      for (const resource of module.descriptor.resources?.textures || []) {
        const textureName = `u_${prefix}${moduleName}_${resource.name}`;
        
        textureUniforms.push({
          name: textureName,
          type: resource.type as 'texture2D' | 'textureCube',
          unit: -1,  // Will be assigned later
          persistent: resource.persistent || false
        });
      }
    }
    
    // Add engine uniforms
    this.addEngineUniforms(uniforms);
    
    // Add film texture uniforms
    this.addFilmTextureUniforms(textureUniforms);
    
    // Build line mapping for error reporting
    const lineMap = this.buildLineMapping(input);
    
    return {
      ...input,
      uniforms,
      textureUniforms,
      lineMap
    };
  }
  
  validate(output: UniformData): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Check for duplicate uniform names
    const seen = new Set<string>();
    for (const uniform of output.uniforms) {
      if (seen.has(uniform.glslName)) {
        errors.push(`Duplicate uniform: ${uniform.glslName}`);
      }
      seen.add(uniform.glslName);
    }
    
    // Warn about unused parameters
    const fragmentSource = output.fragmentSource;
    for (const uniform of output.uniforms) {
      if (!fragmentSource.includes(uniform.glslName)) {
        warnings.push(`Uniform may be unused: ${uniform.glslName}`);
      }
    }
    
    return { valid: errors.length === 0, errors, warnings };
  }
  
  private addEngineUniforms(uniforms: UniformInfo[]): void {
    const engineUniforms: UniformInfo[] = [
      {
        paramPath: 'engine.resolution',
        glslName: 'u_resolution',
        type: 'vec2',
        module: 'Engine'
      },
      {
        paramPath: 'engine.frame_index',
        glslName: 'u_frame_index',
        type: 'int',
        module: 'Engine'
      },
      {
        paramPath: 'engine.sample_count',
        glslName: 'u_sample_count',
        type: 'int',
        module: 'Engine'
      },
      {
        paramPath: 'engine.time',
        glslName: 'u_time',
        type: 'float',
        module: 'Engine'
      },
      {
        paramPath: 'engine.film_reset',
        glslName: 'u_film_reset',
        type: 'bool',
        module: 'Engine'
      }
    ];
    
    uniforms.push(...engineUniforms);
  }
  
  private addFilmTextureUniforms(textureUniforms: TextureUniformInfo[]): void {
    // Standard film textures
    textureUniforms.push(
      {
        name: 'u_film_radiance_previous',
        type: 'texture2D',
        unit: 0,
        persistent: true
      },
      {
        name: 'u_film_variance_previous',
        type: 'texture2D',
        unit: 1,
        persistent: true
      },
      {
        name: 'u_film_samples_previous',
        type: 'texture2D',
        unit: 2,
        persistent: true
      }
    );
  }
  
  private buildLineMapping(input: ShaderSources): LineMapping {
    const lines = input.fragmentSource.split('\n');
    const mapping = new Map<number, SourceLocation>();
    
    let currentModule: string | null = null;
    let moduleStartLine = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Track module boundaries
      if (line.includes('============') && line.includes('Module')) {
        const match = line.match(/============ (\w+) Module/);
        if (match) {
          currentModule = match[1];
          moduleStartLine = i;
        }
      }
      
      // Map line to module
      if (currentModule) {
        mapping.set(i + 1, {  // Line numbers are 1-based
          module: currentModule,
          originalLine: i - moduleStartLine,
          function: this.findContainingFunction(lines, i)
        });
      }
    }
    
    return {
      getSourceLocation: (line: number) => mapping.get(line) || null
    };
  }
  
  private findContainingFunction(lines: string[], lineIndex: number): string | undefined {
    // Search backwards for function definition
    for (let i = lineIndex; i >= 0; i--) {
      const match = lines[i].match(/^\s*\w+\s+(\w+)\s*\(/);
      if (match) {
        return match[1];
      }
    }
    return undefined;
  }
  
  canRecover(error: Error): boolean {
    return false;
  }
  
  recover(input: ShaderSources, error: Error): UniformData | null {
    return null;
  }
}

interface UniformData extends ShaderSources {
  uniforms: UniformInfo[];
  textureUniforms: TextureUniformInfo[];
  lineMap: LineMapping;
}

interface TextureUniformInfo {
  name: string;
  type: 'texture2D' | 'textureCube';
  unit: number;
  persistent: boolean;
}
```

## Stage 8: Compile GLSL

```typescript
class CompileGLSLStage implements CompilationStage<UniformData, CompiledOutput> {
  name = 'CompileGLSL';
  description = 'Compile and link WebGL program';
  required = true;
  
  constructor(private gl: WebGL2RenderingContext) {}
  
  execute(input: UniformData, context: PipelineContext): CompiledOutput {
    const startTime = performance.now();
    
    // Compile vertex shader
    const vertexShader = this.compileShader(
      input.vertexSource,
      this.gl.VERTEX_SHADER,
      'vertex'
    );
    
    // Compile fragment shader
    const fragmentShader = this.compileShader(
      input.fragmentSource,
      this.gl.FRAGMENT_SHADER,
      'fragment'
    );
    
    // Link program
    const program = this.linkProgram(vertexShader, fragmentShader);
    
    // Build UniformMap
    const uniformMap = this.buildUniformMap(program, input.uniforms);
    
    // Clean up shaders (no longer needed after linking)
    this.gl.deleteShader(vertexShader);
    this.gl.deleteShader(fragmentShader);
    
    const compileTime = performance.now() - startTime;
    
    return {
      ...input,
      program,
      uniformMap,
      compileTime
    };
  }
  
  validate(output: CompiledOutput): ValidationResult {
    const errors: string[] = [];
    
    // Check program is valid
    if (!this.gl.isProgram(output.program)) {
      errors.push('Invalid WebGL program');
    }
    
    // Check link status
    const linkStatus = this.gl.getProgramParameter(
      output.program,
      this.gl.LINK_STATUS
    );
    if (!linkStatus) {
      const log = this.gl.getProgramInfoLog(output.program);
      errors.push(`Link failed: ${log}`);
    }
    
    // Validate program
    this.gl.validateProgram(output.program);
    const valid = this.gl.getProgramParameter(
      output.program,
      this.gl.VALIDATE_STATUS
    );
    if (!valid) {
      const log = this.gl.getProgramInfoLog(output.program);
      errors.push(`Validation failed: ${log}`);
    }
    
    return { valid: errors.length === 0, errors };
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
      
      // Parse error for line information
      const lineMatch = log?.match(/ERROR: \d+:(\d+): (.+)/);
      if (lineMatch) {
        const line = parseInt(lineMatch[1], 10);
        const message = lineMatch[2];
        
        // Get source context
        const context = this.getSourceContext(source, line);
        
        throw new CompilationError(
          'GLSL compilation',
          {
            valid: false,
            errors: [`${name} shader: ${message}`],
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
    
    // Bind attribute locations before linking
    this.gl.bindAttribLocation(program, 0, 'a_position');
    
    this.gl.linkProgram(program);
    
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      const log = this.gl.getProgramInfoLog(program);
      this.gl.deleteProgram(program);
      throw new Error(`Program linking failed: ${log}`);
    }
    
    return program;
  }
  
  private buildUniformMap(program: WebGLProgram, uniforms: UniformInfo[]): UniformMap {
    const mappings = new Map<string, UniformMapping>();
    
    for (const uniform of uniforms) {
      const location = this.gl.getUniformLocation(program, uniform.glslName);
      
      mappings.set(uniform.paramPath, {
        paramPath: uniform.paramPath,
        glslName: uniform.glslName,
        location,
        type: uniform.type,
        moduleSource: uniform.module,
        used: false,
        updateCount: 0
      });
    }
    
    // Create UniformMap implementation
    return {
      programId: `prog_${Date.now()}`,
      mappings,
      
      getMapping: (path: string) => mappings.get(path),
      getAllMappings: () => Array.from(mappings.values()),
      getUnusedMappings: () => [],
      getMissingParameters: () => [],
      
      debugPrint: () => {
        console.table(
          Array.from(mappings.values()).map(m => ({
            param: m.paramPath,
            glsl: m.glslName,
            hasLocation: m.location !== null
          }))
        );
      }
    };
  }
  
  private getSourceContext(source: string, errorLine: number): string {
    const lines = source.split('\n');
    const start = Math.max(0, errorLine - 3);
    const end = Math.min(lines.length, errorLine + 2);
    
    const context: string[] = [];
    for (let i = start; i < end; i++) {
      const marker = i === errorLine - 1 ? '>>> ' : '    ';
      const lineNum = String(i + 1).padStart(4, ' ');
      context.push(`${lineNum}: ${marker}${lines[i]}`);
    }
    
    return context.join('\n');
  }
  
  canRecover(error: Error): boolean {
    // Cannot recover from compilation errors
    return false;
  }
  
  recover(input: UniformData, error: Error): CompiledOutput | null {
    return null;
  }
}

interface CompiledOutput extends UniformData {
  program: WebGLProgram;
  uniformMap: UniformMap;
  compileTime: number;
}
```

## Pipeline Constants

```typescript
const MATH_UTILITIES = `
// ============ Math Constants ============
#define PI 3.14159265359
#define TWO_PI 6.28318530718
#define INV_PI 0.31830988618
#define INV_TWO_PI 0.15915494309
#define EPSILON 0.0001

// ============ Random Number Generation ============
uint hash(uint x) {
  x ^= x >> 16;
  x *= 0x7feb352dU;
  x ^= x >> 15;
  x *= 0x846ca68bU;
  x ^= x >> 16;
  return x;
}

vec2 sample_2d(ivec2 pixel, int index, int dimension) {
  uint h = hash(uint(pixel.x) ^ hash(uint(pixel.y)) ^ hash(uint(index)) ^ hash(uint(dimension)));
  uint h2 = hash(h);
  return vec2(float(h) / 4294967296.0, float(h2) / 4294967296.0);
}

// ============ Sampling Functions ============
vec3 sample_hemisphere(vec2 xi, vec3 n) {
  float theta = acos(1.0 - xi.x);
  float phi = TWO_PI * xi.y;
  
  vec3 dir = vec3(
    sin(theta) * cos(phi),
    sin(theta) * sin(phi),
    cos(theta)
  );
  
  // Transform to world space
  vec3 up = abs(n.y) < 0.999 ? vec3(0, 1, 0) : vec3(1, 0, 0);
  vec3 tangent = normalize(cross(up, n));
  vec3 bitangent = cross(n, tangent);
  
  return tangent * dir.x + bitangent * dir.y + n * dir.z;
}`;
```

## Invariants

1. **Stages execute in order** - Each stage depends on previous
2. **Geometry always first** - Types must be defined before use
3. **Validation after each stage** - Errors caught immediately
4. **Prefixes applied consistently** - All functions and uniforms
5. **Dependencies resolved** - No unresolved function calls
6. **Line mappings accurate** - Error reporting traces to source
7. **Shaders deleted after linking** - Memory cleaned up
8. **All stages logged** - Complete execution trace available

## Error Handling

The pipeline MUST handle these error conditions:

| Error | Stage | Response |
|-------|-------|----------|
| Missing module | CollectModules | Throw with module name |
| Unsatisfied dependency | ValidateDependencies | Throw with details |
| Circular dependency | ValidateDependencies | Throw with cycle |
| Sort failure | SortModules | Throw with dependency issue |
| Prefix conflict | ApplyPrefixes | Throw with conflicting names |
| Unresolved call | ResolveCalls | Throw with function name |
| Template missing | GenerateMain | Fall back to standard |
| GLSL syntax error | CompileGLSL | Throw with line context |
| Link failure | CompileGLSL | Throw with program log |

## Performance Requirements

- Total pipeline: < 500ms typical
- Module processing: < 10ms per module
- Prefixing: < 5ms per module
- GLSL compilation: WebGL dependent (~100-300ms)
- Uniform extraction: < 5ms
- Line mapping: O(n) where n = source lines
