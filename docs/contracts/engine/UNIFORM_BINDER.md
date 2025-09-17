# Uniform Binder Contract

The UniformBinder efficiently maps ParameterStore paths to GPU uniform locations and manages updates.

## Core Interface

```typescript
interface UniformBinder {
  // Build mappings for a program
  buildBindings(program: CompiledProgram): UniformBindings;
  
  // Update uniforms from parameter changes
  updateUniforms(changes: ParameterChanges): void;
  
  // Batch update all uniforms
  updateAll(parameters: Map<string, any>): void;
  
  // Query bindings
  hasBinding(paramPath: string): boolean;
  getBinding(paramPath: string): UniformBinding | null;
  
  // Performance monitoring
  getUpdateStats(): UpdateStats;
}
```

## Binding Structure

```typescript
interface UniformBindings {
  programId: string;
  bindings: Map<string, UniformBinding>;
  metadata: {
    totalUniforms: number;
    boundUniforms: number;           // Successfully mapped
    unboundUniforms: number;          // No parameter for this uniform
    textureBindings: Map<string, number>;  // Texture uniforms → units
  };
}

interface UniformBinding {
  paramPath: string;                 // "camera.position"
  uniformName: string;               // "u_camera_pinhole_position"
  location: WebGLUniformLocation;
  type: UniformType;
  module: string;                    // Which module declared it
  setter: UniformSetter;             // Function to set value
}

type UniformType = 
  | "float" | "vec2" | "vec3" | "vec4" 
  | "int" | "ivec2" | "ivec3" | "ivec4"
  | "mat2" | "mat3" | "mat4" 
  | "sampler2D" | "samplerCube" | "isampler2D";

type UniformSetter = (gl: WebGL2RenderingContext, 
                     location: WebGLUniformLocation, 
                     value: any) => void;
```

## Path Mapping Rules

```typescript
interface PathMapper {
  // Convert parameter path to uniform name
  pathToUniform(path: string, recipe: Recipe): string;
}

// Mapping patterns (generic paths for persistence):
// "camera.position"       → "u_camera_[active]_position"
// "camera.fov"           → "u_camera_[active]_fov"
// "material.albedo"      → "u_material_albedo"  (single material)
// "material.0.albedo"    → "u_material_0_albedo" (per-object)
// "estimator.max_bounces"→ "u_estimator_[active]_max_bounces"
// "film.alpha"          → "u_film_[active]_alpha"
// "developer.exposure"   → "u_developer_[active]_exposure"

class PathMapper {
  constructor(private activeModules: ModuleCollection) {}
  
  pathToUniform(path: string): string {
    const parts = path.split('.');
    const category = parts[0];
    
    switch (category) {
      case 'camera':
        // Generic path maps to active camera's uniform
        const cameraName = this.activeModules.camera.name.toLowerCase();
        return `u_camera_${cameraName}_${parts.slice(1).join('_')}`;
        
      case 'material':
        // Single material model - simpler mapping
        const param = parts[1];
        if (isNumber(param)) {
          // Per-object: "material.0.albedo"
          return `u_material_${param}_${parts.slice(2).join('_')}`;
        } else {
          // Global material param: "material.roughness"
          return `u_material_${parts.slice(1).join('_')}`;
        }
        
      case 'estimator':
        const estimatorName = this.activeModules.estimator.name.toLowerCase();
        return `u_estimator_${estimatorName}_${parts.slice(1).join('_')}`;
        
      case 'film':
        const filmName = this.activeModules.film.name.toLowerCase();
        return `u_film_${filmName}_${parts.slice(1).join('_')}`;
        
      case 'developer':
        const developerName = this.activeModules.developer.name.toLowerCase();
        return `u_developer_${developerName}_${parts.slice(1).join('_')}`;
        
      default:
        // Direct mapping for engine uniforms
        return `u_${parts.join('_')}`;
    }
  }
  
  // Check if parameter is valid for current modules
  isValidForActiveModules(path: string): boolean {
    const uniform = this.pathToUniform(path);
    return this.activeModules.hasUniform(uniform);
  }
}
```

## Uniform Setters

```typescript
// Type-specific setter functions
const UNIFORM_SETTERS: Record<UniformType, UniformSetter> = {
  'float': (gl, loc, val) => gl.uniform1f(loc, val),
  'vec2': (gl, loc, val) => gl.uniform2fv(loc, val),
  'vec3': (gl, loc, val) => gl.uniform3fv(loc, val),
  'vec4': (gl, loc, val) => gl.uniform4fv(loc, val),
  'int': (gl, loc, val) => gl.uniform1i(loc, val),
  'ivec2': (gl, loc, val) => gl.uniform2iv(loc, val),
  'ivec3': (gl, loc, val) => gl.uniform3iv(loc, val),
  'ivec4': (gl, loc, val) => gl.uniform4iv(loc, val),
  'mat2': (gl, loc, val) => gl.uniformMatrix2fv(loc, false, val),
  'mat3': (gl, loc, val) => gl.uniformMatrix3fv(loc, false, val),
  'mat4': (gl, loc, val) => gl.uniformMatrix4fv(loc, false, val),
  'sampler2D': (gl, loc, val) => gl.uniform1i(loc, val),
  'samplerCube': (gl, loc, val) => gl.uniform1i(loc, val),
  'isampler2D': (gl, loc, val) => gl.uniform1i(loc, val),
};
```

## Engine Uniforms

Standard uniforms provided by the engine:

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
  'u_film_auxiliary': number;          // Texture unit
}

class UniformBinder {
  bindEngineUniforms() {
    // These are always bound regardless of parameters
    this.gl.uniform2fv(
      this.locations.get('u_resolution'),
      [this.resolution.width, this.resolution.height]
    );
    
    this.gl.uniform1i(
      this.locations.get('u_frame_index'),
      this.frameIndex
    );
    
    // Film textures
    this.gl.uniform1i(
      this.locations.get('u_film_radiance'),
      ReservedUnits.FILM_RADIANCE
    );
    
    // ... etc
  }
}
```

## Batch Updates

```typescript
interface BatchUpdate {
  // Collect all parameter changes
  changes: Array<{
    path: string;
    value: any;
    resetPolicy: ResetPolicy;
  }>;
  
  // Apply all at once
  apply(): void;
}

class UniformBinder {
  private pendingUpdates: Map<string, any> = new Map();
  private updateScheduled = false;
  
  // Queue update for batching
  queueUpdate(path: string, value: any) {
    this.pendingUpdates.set(path, value);
    
    if (!this.updateScheduled) {
      this.updateScheduled = true;
      requestAnimationFrame(() => this.flushUpdates());
    }
  }
  
  // Apply all pending updates
  private flushUpdates() {
    for (const [path, value] of this.pendingUpdates) {
      const binding = this.bindings.get(path);
      if (binding) {
        binding.setter(this.gl, binding.location, value);
      }
    }
    
    this.pendingUpdates.clear();
    this.updateScheduled = false;
  }
}
```

## Missing Uniform Handling

```typescript
interface MissingUniformStrategy {
  onMissingParameter(uniformName: string): void;
  onMissingUniform(paramPath: string): void;
}

class UniformBinder {
  handleMissingBinding(paramPath: string) {
    // Some shader variants might not use all parameters
    if (this.isOptionalParameter(paramPath)) {
      // Silently skip - variant doesn't need it
      return;
    }
    
    // Log warning for debugging
    console.warn(`No uniform binding for parameter: ${paramPath}`);
    
    // Check if it's a typo
    const suggestion = this.findSimilarBinding(paramPath);
    if (suggestion) {
      console.warn(`Did you mean: ${suggestion}?`);
    }
  }
  
  isOptionalParameter(path: string): boolean {
    // Some parameters are variant-specific
    const optional = [
      'film.variance_threshold',     // Only variance-tracking films
      'developer.zebra_low',         // Only debug developers
      'material.*.emission'          // Only emissive materials
    ];
    
    return optional.some(pattern => 
      this.matchesPattern(path, pattern)
    );
  }
}
```

## Performance Tracking

```typescript
interface UpdateStats {
  totalUpdates: number;               // Total uniform updates
  uniqueUniforms: number;             // Unique uniforms updated
  batchedUpdates: number;             // Updates that were batched
  skippedUpdates: number;             // No-op updates (same value)
  averageUpdateTime: number;          // Milliseconds
  uniformsPerFrame: number;           // Average uniforms/frame
}

class UniformBinder {
  private stats: UpdateStats = {
    totalUpdates: 0,
    uniqueUniforms: 0,
    batchedUpdates: 0,
    skippedUpdates: 0,
    averageUpdateTime: 0,
    uniformsPerFrame: 0
  };
  
  updateUniforms(changes: ParameterChanges) {
    const start = performance.now();
    
    for (const change of changes.changes) {
      const binding = this.bindings.get(change.path);
      
      if (!binding) {
        this.handleMissingBinding(change.path);
        continue;
      }
      
      // Skip if value unchanged
      if (this.valuesEqual(binding.lastValue, change.newValue)) {
        this.stats.skippedUpdates++;
        continue;
      }
      
      // Apply update
      binding.setter(this.gl, binding.location, change.newValue);
      binding.lastValue = change.newValue;
      this.stats.totalUpdates++;
    }
    
    const elapsed = performance.now() - start;
    this.updateStats(elapsed);
  }
}
```

## Parameter Persistence During Shader Swaps

When switching between shader variants (e.g., different cameras), common parameters persist:

```typescript
interface ParameterPersistence {
  // Track parameters across swaps
  preserveCommonParameters(
    oldProgram: CompiledProgram,
    newProgram: CompiledProgram,
    store: ParameterStore
  ): void;
}

class UniformBinder {
  // Called when switching programs
  handleProgramSwap(oldProgram: CompiledProgram, newProgram: CompiledProgram) {
    // Build new bindings
    this.buildBindings(newProgram);
    
    // Restore common parameters
    const allParams = this.parameterStore.getAll();
    
    for (const [path, value] of allParams) {
      // Try to bind with new program's module names
      const newUniform = this.pathToUniform(path);
      
      if (this.bindings.has(path)) {
        // This parameter exists in new program
        const binding = this.bindings.get(path);
        binding.setter(this.gl, binding.location, value);
      }
      // Parameters that don't exist in new program are silently skipped
    }
  }
}

// Example: Switching cameras preserves position/fov
// User sets: parameterStore.set("camera.position", [0, 5, 10])
// 
// With Pinhole camera: maps to u_camera_pinhole_position
// Switch to ThinLens: maps to u_camera_thinlens_position
// The value [0, 5, 10] is preserved!
```
```

## Integration Example

```typescript
class UniformBinder {
  constructor(
    private gl: WebGL2RenderingContext,
    private program: CompiledProgram
  ) {
    this.buildBindings(program);
  }
  
  buildBindings(program: CompiledProgram) {
    this.bindings = new Map();
    
    // Get all active uniforms from GL
    const numUniforms = this.gl.getProgramParameter(
      program.program,
      GL.ACTIVE_UNIFORMS
    );
    
    for (let i = 0; i < numUniforms; i++) {
      const info = this.gl.getActiveUniform(program.program, i);
      const location = this.gl.getUniformLocation(
        program.program,
        info.name
      );
      
      // Map to parameter path
      const paramPath = this.uniformToPath(info.name, program.recipe);
      
      if (paramPath) {
        this.bindings.set(paramPath, {
          paramPath,
          uniformName: info.name,
          location,
          type: this.mapGLType(info.type),
          module: this.findModule(info.name, program),
          setter: UNIFORM_SETTERS[this.mapGLType(info.type)]
        });
      }
    }
  }
  
  // Called each frame by RenderExecutor
  frameUpdate(params: ParameterStore) {
    // Update engine uniforms
    this.bindEngineUniforms();
    
    // Update changed parameters
    const changes = params.getChangedSinceLastFrame();
    if (changes.length > 0) {
      this.updateUniforms(changes);
    }
  }
}
```

## Validation

The UniformBinder validates:
1. All required uniforms have parameter bindings
2. Parameter types match uniform types
3. Texture uniforms bind to valid units
4. No duplicate bindings
5. Array uniforms don't exceed limits

## Error Recovery

```typescript
class UniformBindingError extends Error {
  constructor(
    public uniformName: string,
    public expectedType: UniformType,
    public actualType?: string,
    public suggestion?: string
  ) {
    super(`Failed to bind uniform ${uniformName}`);
  }
}

// Graceful handling:
try {
  binder.updateUniforms(changes);
} catch (e) {
  if (e instanceof UniformBindingError) {
    // Log but continue - don't crash the renderer
    console.error(`Uniform binding error: ${e.message}`);
    
    // Use default value
    const defaultValue = getDefaultForType(e.expectedType);
    binder.forceUpdate(e.uniformName, defaultValue);
  }
}
```
