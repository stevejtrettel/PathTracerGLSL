# Uniform Binder Contract

The UniformBinder efficiently maps ParameterStore paths to GPU uniform locations using an explicit UniformMap.

## Core Interface

```typescript
interface UniformBinder {
  // Build mappings for a program
  buildBindings(program: CompiledProgram, modules: ModuleDescriptor[]): void;
  
  // Get the uniform map for debugging
  getUniformMap(): UniformMap;
  
  // Update uniforms from parameter changes
  updateUniforms(changes: ParameterChanges): void;
  
  // Batch update all uniforms
  updateAll(parameters: Map<string, any>): void;
  
  // Query bindings
  hasBinding(paramPath: string): boolean;
  getBinding(paramPath: string): UniformMapping | undefined;
  
  // Performance monitoring
  getUpdateStats(): UpdateStats;
}
```

## The UniformMap - Explicit Parameter Mapping

```typescript
interface UniformMapping {
  paramPath: string;              // "camera.position"
  glslName: string;               // "u_camera_pinhole_position"
  location: WebGLUniformLocation | null;
  type: "float" | "vec2" | "vec3" | "vec4" | "int" | "mat4";
  moduleSource: ModuleDescriptor;
}

class UniformMap {
  private mappings = new Map<string, UniformMapping>();
  
  static build(modules: ModuleDescriptor[], program: WebGLProgram, gl: WebGL2RenderingContext): UniformMap {
    const map = new UniformMap();
    
    for (const module of modules) {
      const prefix = getModulePrefix(module);
      
      for (const param of module.parameters || []) {
        // Build parameter path
        const paramPath = `${module.id.kind.toLowerCase()}.${param.name}`;
        
        // Build GLSL uniform name  
        const glslName = `u_${prefix}${module.id.name.toLowerCase()}_${param.name}`;
        
        // Get location from compiled program
        const location = gl.getUniformLocation(program, glslName);
        
        map.mappings.set(paramPath, {
          paramPath,
          glslName,
          location,
          type: param.type,
          moduleSource: module
        });
      }
    }
    
    // Add engine uniforms
    map.addEngineUniforms(program, gl);
    
    return map;
  }
  
  private addEngineUniforms(program: WebGLProgram, gl: WebGL2RenderingContext): void {
    const engineUniforms = [
      { path: 'resolution', glsl: 'u_resolution', type: 'vec2' },
      { path: 'frame_index', glsl: 'u_frame_index', type: 'int' },
      { path: 'sample_count', glsl: 'u_sample_count', type: 'int' },
      { path: 'time', glsl: 'u_time', type: 'float' }
    ];
    
    for (const uniform of engineUniforms) {
      this.mappings.set(uniform.path, {
        paramPath: uniform.path,
        glslName: uniform.glsl,
        location: gl.getUniformLocation(program, uniform.glsl),
        type: uniform.type as any,
        moduleSource: null as any // Engine uniform
      });
    }
  }
  
  // Get uniform location for parameter update
  getBinding(paramPath: string): UniformMapping | undefined {
    return this.mappings.get(paramPath);
  }
  
  // Get all mappings (for debugging)
  getAllMappings(): UniformMapping[] {
    return Array.from(this.mappings.values());
  }
  
  // Debug helper - shows all mappings
  debugPrint(): void {
    console.table(Array.from(this.mappings.values()).map(m => ({
      param: m.paramPath,
      glsl: m.glslName,
      type: m.type,
      hasLocation: m.location !== null
    })));
  }
}
```

## Module Prefix Resolution

```typescript
function getModulePrefix(module: ModuleDescriptor): string {
  const prefixMap: Record<string, string> = {
    "Geometry": "g_",
    "Material": "m_",  // Single material now
    "Scene": "sc_",
    "Lights": "l_",
    "Camera": "c_",
    "Estimator": "e_",
    "Film": "f_",
    "Developer": "d_"
  };
  
  return prefixMap[module.id.kind] || "";
}
```

## Uniform Updates with Batching

```typescript
class UniformBinder {
  private uniformMap: UniformMap;
  private gl: WebGL2RenderingContext;
  private pendingChanges = new Map<string, any>();  // Batch updates
  private stats: UpdateStats;
  
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.stats = {
      totalUpdates: 0,
      uniqueUniforms: 0,
      skippedUpdates: 0,
      missingBindings: 0,
      averageUpdateTime: 0
    };
  }
  
  buildBindings(program: CompiledProgram, modules: ModuleDescriptor[]): void {
    this.uniformMap = UniformMap.build(modules, program.program, this.gl);
    console.log(`Built ${this.uniformMap.getAllMappings().length} uniform bindings`);
  }
  
  // Queue changes for batching (called throughout frame)
  updateUniforms(changes: ParameterChanges): void {
    for (const change of changes.changes) {
      // Just queue the change - don't apply yet
      this.pendingChanges.set(change.path, change.value);
    }
  }
  
  // Flush all pending updates at once (called once per frame)
  frameUpdate(engineState: EngineState): void {
    const startTime = performance.now();
    
    // Update engine uniforms first
    this.updateEngineUniforms(engineState);
    
    // Then flush all pending parameter changes
    for (const [path, value] of this.pendingChanges) {
      const binding = this.uniformMap.getBinding(path);
      
      if (!binding) {
        console.warn(`No uniform binding for parameter: ${path}`);
        this.stats.missingBindings++;
        continue;
      }
      
      if (!binding.location) {
        // Uniform not used in this shader variant
        this.stats.skippedUpdates++;
        continue;
      }
      
      // Apply update based on type
      this.applyUniform(binding, value);
      this.stats.totalUpdates++;
    }
    
    // Clear pending changes for next frame
    this.pendingChanges.clear();
    
    const elapsed = performance.now() - startTime;
    this.updateStats(elapsed);
  }
  
  private applyUniform(binding: UniformMapping, value: any): void {
    switch (binding.type) {
      case 'float':
        this.gl.uniform1f(binding.location!, value);
        break;
      case 'vec2':
        this.gl.uniform2fv(binding.location!, value);
        break;
      case 'vec3':
        this.gl.uniform3fv(binding.location!, value);
        break;
      case 'vec4':
        this.gl.uniform4fv(binding.location!, value);
        break;
      case 'int':
        this.gl.uniform1i(binding.location!, value);
        break;
      case 'mat4':
        this.gl.uniformMatrix4fv(binding.location!, false, value);
        break;
      default:
        console.warn(`Unknown uniform type: ${binding.type}`);
    }
  }
}
  
  // Get the uniform map for debugging
  getUniformMap(): UniformMap {
    return this.uniformMap;
  }
  
  // Check if parameter has binding
  hasBinding(paramPath: string): boolean {
    return this.uniformMap.getBinding(paramPath) !== undefined;
  }
  
  // Get specific binding
  getBinding(paramPath: string): UniformMapping | undefined {
    return this.uniformMap.getBinding(paramPath);
  }
}
```

## Engine Uniforms

```typescript
interface EngineUniforms {
  // Always available
  'u_resolution': [number, number];     // Viewport size
  'u_frame_index': number;              // Current frame number
  'u_sample_count': number;             // Accumulation count
  'u_time': number;                     // Seconds since start
  
  // Film textures (automatic)
  'u_film_radiance': number;           // Texture unit
  'u_film_variance': number;           // Texture unit
  'u_film_samples': number;            // Texture unit
}

class UniformBinder {
  updateEngineUniforms(engineState: EngineState): void {
    // These are always updated regardless of parameter changes
    const resolution = this.uniformMap.getBinding('resolution');
    if (resolution?.location) {
      this.gl.uniform2fv(resolution.location, [engineState.width, engineState.height]);
    }
    
    const frameIndex = this.uniformMap.getBinding('frame_index');
    if (frameIndex?.location) {
      this.gl.uniform1i(frameIndex.location, engineState.frameIndex);
    }
    
    const sampleCount = this.uniformMap.getBinding('sample_count');
    if (sampleCount?.location) {
      this.gl.uniform1i(sampleCount.location, engineState.sampleCount);
    }
    
    const time = this.uniformMap.getBinding('time');
    if (time?.location) {
      this.gl.uniform1f(time.location, engineState.time);
    }
  }
}
```

## Missing Uniform Handling

```typescript
class UniformBinder {
  handleMissingBinding(paramPath: string): void {
    // Check if it's expected to be missing
    if (this.isOptionalParameter(paramPath)) {
      // Silently skip - variant doesn't need it
      return;
    }
    
    // Log warning with helpful context
    console.warn(`No uniform binding for parameter: ${paramPath}`);
    
    // Try to help debug
    const suggestions = this.findSimilarBindings(paramPath);
    if (suggestions.length > 0) {
      console.warn(`Did you mean one of: ${suggestions.join(', ')}?`);
    }
    
    // Show what bindings DO exist for this category
    const category = paramPath.split('.')[0];
    const categoryBindings = this.uniformMap.getAllMappings()
      .filter(m => m.paramPath.startsWith(category))
      .map(m => m.paramPath);
    
    if (categoryBindings.length > 0) {
      console.log(`Available ${category} parameters: ${categoryBindings.join(', ')}`);
    }
  }
  
  private isOptionalParameter(path: string): boolean {
    const optional = [
      'film.variance_threshold',     // Only variance-tracking films
      'developer.debug_mode',         // Only debug developers  
      'material.emission'             // Only emissive materials
    ];
    
    return optional.some(pattern => path.includes(pattern));
  }
  
  private findSimilarBindings(paramPath: string): string[] {
    const allPaths = this.uniformMap.getAllMappings().map(m => m.paramPath);
    
    // Simple similarity: shared words
    const words = paramPath.split(/[._]/);
    return allPaths.filter(path => {
      const pathWords = path.split(/[._]/);
      return words.some(w => pathWords.includes(w));
    }).slice(0, 3);
  }
}
```

## Performance Tracking

```typescript
interface UpdateStats {
  totalUpdates: number;               // Total uniform updates
  uniqueUniforms: number;             // Unique uniforms updated
  skippedUpdates: number;             // No-op updates (not in shader)
  missingBindings: number;            // Parameters with no binding
  averageUpdateTime: number;          // Milliseconds
}

class UniformBinder {
  private updateStats(elapsed: number): void {
    // Update running average
    const alpha = 0.1; // Exponential moving average factor
    this.stats.averageUpdateTime = 
      this.stats.averageUpdateTime * (1 - alpha) + elapsed * alpha;
  }
  
  getUpdateStats(): UpdateStats {
    return { ...this.stats };
  }
  
  resetStats(): void {
    this.stats = {
      totalUpdates: 0,
      uniqueUniforms: 0,
      skippedUpdates: 0,
      missingBindings: 0,
      averageUpdateTime: 0
    };
  }
}
```

## Integration with Engine

```typescript
class UniformBinder {
  // Called each frame by RenderExecutor
  frameUpdate(engineState: EngineState, parameterChanges?: ParameterChanges): void {
    // Always update engine uniforms
    this.updateEngineUniforms(engineState);
    
    // Update changed parameters if any
    if (parameterChanges && parameterChanges.changes.length > 0) {
      this.updateUniforms(parameterChanges);
    }
  }
  
  // Called when switching programs
  onProgramSwitch(newProgram: CompiledProgram, modules: ModuleDescriptor[]): void {
    // Rebuild bindings for new program
    this.buildBindings(newProgram, modules);
    
    // Log the mapping for debugging
    console.log('New uniform mappings:');
    this.uniformMap.debugPrint();
  }
}
```

## Usage Example

```typescript
// In Engine initialization
const uniformBinder = new UniformBinder(gl);

// After compilation
uniformBinder.buildBindings(compiledProgram, modules);

// Check what got mapped
const map = uniformBinder.getUniformMap();
map.debugPrint(); // Shows all parameter -> uniform mappings

// During render
const changes = parameterStore.getChanges();
uniformBinder.updateUniforms(changes);

// Query specific binding
if (uniformBinder.hasBinding('camera.position')) {
  const binding = uniformBinder.getBinding('camera.position');
  console.log(`camera.position maps to ${binding.glslName}`);
}

// Get performance stats
const stats = uniformBinder.getUpdateStats();
console.log(`Average uniform update time: ${stats.averageUpdateTime}ms`);
```

## Validation

The UniformBinder validates:
1. All parameter paths resolve to valid uniforms
2. Parameter types match uniform types
3. No duplicate mappings
4. Texture uniforms bind to valid units
5. Required engine uniforms are present

## Benefits of Explicit UniformMap

1. **Debuggability**: Can inspect exact parameter->uniform mappings
2. **Performance**: No string manipulation during render
3. **Validation**: Know immediately if parameters don't map
4. **Flexibility**: Easy to add new mapping rules
5. **Testing**: Can unit test mapping logic separately
