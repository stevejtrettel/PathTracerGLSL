# Uniform Binder Contract

## Purpose

The UniformBinder creates and manages the explicit mapping between ParameterStore paths and GPU uniform locations. It builds UniformMaps from compiled programs, batches parameter updates for efficiency, and provides complete visibility into parameter-to-uniform bindings for debugging.

## Required Interface

```typescript
interface UniformBinder {
  // Binding creation
  buildBindings(program: CompiledProgram): void;
  clearBindings(): void;
  hasBindings(): boolean;
  
  // Uniform map access
  getUniformMap(): UniformMap | null;
  getMapping(paramPath: string): UniformMapping | undefined;
  hasMapping(paramPath: string): boolean;
  getAllMappings(): UniformMapping[];
  
  // Parameter updates
  queueUpdate(paramPath: string, value: any): void;
  queueUpdates(changes: ParameterChanges): void;
  getPendingCount(): number;
  clearPendingUpdates(): void;
  
  // Frame execution
  frameUpdate(engineState: EngineStateInfo): void;
  forceUpdate(paramPath: string, value: any): void;
  
  // Texture binding
  bindTextureUniform(uniformName: string, unit: number): void;
  getTextureBindings(): Map<string, number>;
  
  // Performance monitoring
  getUpdateStats(): UpdateStats;
  resetStats(): void;
  getLastUpdateTime(): number;
  
  // Debugging
  debugPrint(): void;
  getMissingParameters(): string[];
  getUnusedUniforms(): string[];
  
  // Cleanup
  dispose(): void;
}
```

## Architecture

```typescript
class UniformBinder {
  private gl: WebGL2RenderingContext;
  private uniformMap: UniformMap | null = null;
  private activeProgram: WebGLProgram | null = null;
  
  // Update batching
  private pendingUpdates: Map<string, any>;
  private frameUpdateRequired: boolean = false;
  
  // Texture unit tracking
  private textureBindings: Map<string, number>;
  
  // Performance tracking
  private stats: UpdateStats;
  private updateHistory: number[] = [];
  
  // Debugging
  private unusedUniforms: Set<string>;
  private missingParameters: Set<string>;
}
```

## UniformMap Building Contract

```typescript
buildBindings(program: CompiledProgram): void {
  // Clear previous bindings
  this.clearBindings();
  
  // Store active program
  this.activeProgram = program.program;
  
  // Build the uniform map
  this.uniformMap = this.createUniformMap(program);
  
  // Log mapping summary
  const mappingCount = this.uniformMap.getAllMappings().length;
  const activeCount = this.uniformMap.getAllMappings()
    .filter(m => m.location !== null).length;
  
  console.log(
    `Built ${mappingCount} uniform mappings ` +
    `(${activeCount} active in shader)`
  );
  
  // Reset tracking
  this.unusedUniforms = new Set(
    this.uniformMap.getAllMappings()
      .filter(m => m.location !== null)
      .map(m => m.paramPath)
  );
  this.missingParameters.clear();
  
  // Initialize engine uniforms
  this.initializeEngineUniforms();
}

private createUniformMap(program: CompiledProgram): UniformMap {
  const mappings = new Map<string, UniformMapping>();
  
  // Process each module's parameters
  for (const module of program.modules) {
    const prefix = MODULE_PREFIX_MAP[module.id.kind];
    const moduleName = module.id.name.toLowerCase();
    
    for (const param of module.parameters || []) {
      // Build parameter path: kind.paramName
      const paramPath = `${module.id.kind}.${param.name}`;
      
      // Build GLSL uniform name with prefix
      const glslName = `u_${prefix}${moduleName}_${param.name}`;
      
      // Get location from compiled program
      const location = this.gl.getUniformLocation(program.program, glslName);
      
      // Create mapping
      const mapping: UniformMapping = {
        paramPath,
        glslName,
        location,
        type: param.type as GLSLType,
        moduleSource: module.id.name,
        used: false,
        updateCount: 0
      };
      
      mappings.set(paramPath, mapping);
      
      // Log if uniform was optimized out
      if (!location) {
        console.debug(`Uniform optimized out: ${glslName} (${paramPath})`);
      }
    }
  }
  
  // Add engine uniforms
  this.addEngineUniformMappings(mappings, program.program);
  
  // Create UniformMap implementation
  return {
    programId: program.id,
    mappings,
    
    getMapping: (path: string) => mappings.get(path),
    getAllMappings: () => Array.from(mappings.values()),
    getUnusedMappings: () => Array.from(mappings.values()).filter(m => !m.used),
    getMissingParameters: () => Array.from(this.missingParameters),
    
    debugPrint: () => {
      console.table(
        Array.from(mappings.values()).map(m => ({
          param: m.paramPath,
          glsl: m.glslName,
          type: m.type,
          hasLocation: m.location !== null,
          used: m.used,
          updates: m.updateCount
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
      moduleSource: 'Engine',
      used: true,  // Engine uniforms always marked as used
      updateCount: 0
    });
  }
}
```

## Update Batching Contract

```typescript
queueUpdate(paramPath: string, value: any): void {
  // Queue for batch update
  this.pendingUpdates.set(paramPath, value);
  this.frameUpdateRequired = true;
}

queueUpdates(changes: ParameterChanges): void {
  for (const change of changes.changes) {
    this.queueUpdate(change.path, change.newValue);
  }
  
  // Check if film reset needed
  if (changes.triggersReset) {
    this.queueUpdate('engine.film_reset', true);
  }
}

getPendingCount(): number {
  return this.pendingUpdates.size;
}

clearPendingUpdates(): void {
  this.pendingUpdates.clear();
  this.frameUpdateRequired = false;
}
```

## Frame Update Contract

```typescript
frameUpdate(engineState: EngineStateInfo): void {
  if (!this.uniformMap || !this.activeProgram) {
    throw new Error('No uniform bindings - call buildBindings() first');
  }
  
  const startTime = performance.now();
  let updatedCount = 0;
  let skippedCount = 0;
  let missingCount = 0;
  
  // 1. Always update engine uniforms
  this.updateEngineUniforms(engineState);
  
  // 2. Process pending parameter updates
  for (const [path, value] of this.pendingUpdates) {
    const mapping = this.uniformMap.getMapping(path);
    
    if (!mapping) {
      // Track missing parameter
      this.missingParameters.add(path);
      missingCount++;
      
      // Only warn once per parameter
      if (!this.stats.missingBindings) {
        console.warn(`No uniform mapping for parameter: ${path}`);
      }
      continue;
    }
    
    if (!mapping.location) {
      // Uniform was optimized out
      skippedCount++;
      continue;
    }
    
    // Apply the uniform update
    this.applyUniform(mapping, value);
    
    // Update tracking
    mapping.used = true;
    mapping.lastValue = value;
    mapping.updateCount++;
    this.unusedUniforms.delete(path);
    updatedCount++;
  }
  
  // 3. Clear pending updates
  this.pendingUpdates.clear();
  this.frameUpdateRequired = false;
  
  // 4. Update statistics
  const elapsed = performance.now() - startTime;
  this.updateStats(elapsed, updatedCount, skippedCount, missingCount);
}

private updateEngineUniforms(state: EngineStateInfo): void {
  // Resolution
  const resolutionMapping = this.uniformMap!.getMapping('engine.resolution');
  if (resolutionMapping?.location) {
    this.gl.uniform2f(resolutionMapping.location, state.width, state.height);
  }
  
  // Frame index
  const frameMapping = this.uniformMap!.getMapping('engine.frame_index');
  if (frameMapping?.location) {
    this.gl.uniform1i(frameMapping.location, state.frameIndex);
  }
  
  // Sample count
  const sampleMapping = this.uniformMap!.getMapping('engine.sample_count');
  if (sampleMapping?.location) {
    this.gl.uniform1i(sampleMapping.location, state.sampleCount);
  }
  
  // Time
  const timeMapping = this.uniformMap!.getMapping('engine.time');
  if (timeMapping?.location) {
    this.gl.uniform1f(timeMapping.location, state.time);
  }
  
  // Film reset flag (cleared each frame)
  const resetMapping = this.uniformMap!.getMapping('engine.film_reset');
  if (resetMapping?.location) {
    this.gl.uniform1i(resetMapping.location, 0);
  }
}

private applyUniform(mapping: UniformMapping, value: any): void {
  const location = mapping.location!;
  
  switch (mapping.type) {
    case 'float':
      this.gl.uniform1f(location, value);
      break;
      
    case 'vec2':
      if (Array.isArray(value) && value.length === 2) {
        this.gl.uniform2f(location, value[0], value[1]);
      } else {
        this.gl.uniform2fv(location, value);
      }
      break;
      
    case 'vec3':
      if (Array.isArray(value) && value.length === 3) {
        this.gl.uniform3f(location, value[0], value[1], value[2]);
      } else {
        this.gl.uniform3fv(location, value);
      }
      break;
      
    case 'vec4':
      if (Array.isArray(value) && value.length === 4) {
        this.gl.uniform4f(location, value[0], value[1], value[2], value[3]);
      } else {
        this.gl.uniform4fv(location, value);
      }
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
      // Texture uniforms just need the texture unit number
      this.gl.uniform1i(location, value);
      break;
      
    default:
      console.warn(`Unknown uniform type: ${mapping.type} for ${mapping.paramPath}`);
  }
}
```

## Forced Update Contract

```typescript
forceUpdate(paramPath: string, value: any): void {
  if (!this.uniformMap) {
    throw new Error('No uniform bindings');
  }
  
  const mapping = this.uniformMap.getMapping(paramPath);
  if (!mapping) {
    throw new Error(`No mapping for parameter: ${paramPath}`);
  }
  
  if (!mapping.location) {
    // Silently skip if optimized out
    return;
  }
  
  // Apply immediately
  this.applyUniform(mapping, value);
  
  // Update tracking
  mapping.used = true;
  mapping.lastValue = value;
  mapping.updateCount++;
  this.unusedUniforms.delete(paramPath);
  this.stats.totalUpdates++;
}
```

## Texture Binding Contract

```typescript
bindTextureUniform(uniformName: string, unit: number): void {
  if (!this.activeProgram) {
    throw new Error('No active program');
  }
  
  const location = this.gl.getUniformLocation(this.activeProgram, uniformName);
  if (!location) {
    // Texture uniform optimized out
    return;
  }
  
  this.gl.uniform1i(location, unit);
  this.textureBindings.set(uniformName, unit);
}

getTextureBindings(): Map<string, number> {
  return new Map(this.textureBindings);
}
```

## Performance Tracking Contract

```typescript
private updateStats(elapsed: number, updated: number, skipped: number, missing: number): void {
  // Update counts
  this.stats.frameUpdates = updated;
  this.stats.totalUpdates += updated;
  this.stats.skippedUpdates += skipped;
  this.stats.missingBindings += missing;
  
  // Track unique uniforms
  this.stats.uniqueUniforms = this.uniformMap!.getAllMappings()
    .filter(m => m.used).length;
  
  // Update timing
  this.stats.lastUpdateTime = elapsed;
  
  // Moving average (exponential)
  const alpha = 0.1;
  this.stats.averageUpdateTime = 
    this.stats.averageUpdateTime * (1 - alpha) + elapsed * alpha;
  
  // Track max queue size
  const queueSize = this.pendingUpdates.size;
  if (queueSize > this.stats.maxQueueSize) {
    this.stats.maxQueueSize = queueSize;
  }
  
  // Keep history for debugging
  this.updateHistory.push(elapsed);
  if (this.updateHistory.length > 60) {
    this.updateHistory.shift();
  }
}

getUpdateStats(): UpdateStats {
  // Check for redundant updates
  let redundantCount = 0;
  if (this.uniformMap) {
    for (const mapping of this.uniformMap.getAllMappings()) {
      if (mapping.updateCount > this.stats.frameUpdates * 2) {
        redundantCount++;
      }
    }
  }
  
  return {
    ...this.stats,
    redundantUpdates: redundantCount
  };
}

resetStats(): void {
  this.stats = {
    totalUpdates: 0,
    frameUpdates: 0,
    uniqueUniforms: 0,
    skippedUpdates: 0,
    redundantUpdates: 0,
    missingBindings: 0,
    lastUpdateTime: 0,
    averageUpdateTime: 0,
    maxQueueSize: 0
  };
  this.updateHistory = [];
}
```

## Debugging Contract

```typescript
debugPrint(): void {
  if (!this.uniformMap) {
    console.log('No uniform bindings');
    return;
  }
  
  console.log('=== Uniform Bindings ===');
  this.uniformMap.debugPrint();
  
  console.log('\n=== Texture Bindings ===');
  console.table(
    Array.from(this.textureBindings.entries()).map(([name, unit]) => ({
      uniform: name,
      unit
    }))
  );
  
  console.log('\n=== Update Statistics ===');
  console.table(this.getUpdateStats());
  
  if (this.unusedUniforms.size > 0) {
    console.log('\n=== Unused Uniforms ===');
    console.log(Array.from(this.unusedUniforms));
  }
  
  if (this.missingParameters.size > 0) {
    console.log('\n=== Missing Parameters ===');
    console.log(Array.from(this.missingParameters));
  }
}

getMissingParameters(): string[] {
  return Array.from(this.missingParameters);
}

getUnusedUniforms(): string[] {
  return Array.from(this.unusedUniforms);
}
```

## Minimal Working Example

```typescript
// Create uniform binder
const gl = canvas.getContext('webgl2')!;
const binder = new UniformBinder(gl);

// After compilation, build bindings
const compiledProgram = compiler.getProgram('pathtracer');
gl.useProgram(compiledProgram.program);
binder.buildBindings(compiledProgram);

// Inspect mappings
const map = binder.getUniformMap();
map?.debugPrint();

// Queue parameter updates
binder.queueUpdate('camera.position', [0, 5, 10]);
binder.queueUpdate('camera.fov', 60);
binder.queueUpdate('material.roughness', 0.5);
binder.queueUpdate('material.albedo', [0.8, 0.2, 0.2]);

// Or queue from ParameterChanges
const changes: ParameterChanges = {
  changes: [
    { path: 'lights.intensity', oldValue: 1, newValue: 2, timestamp: Date.now() }
  ],
  source: 'user',
  triggersReset: true
};
binder.queueUpdates(changes);

// Each frame: flush all updates at once
const engineState: EngineStateInfo = {
  width: 1920,
  height: 1080,
  frameIndex: 42,
  sampleCount: 42,
  time: performance.now() / 1000
};
binder.frameUpdate(engineState);

// Check what got updated
const stats = binder.getUpdateStats();
console.log(`Updated ${stats.frameUpdates} uniforms in ${stats.lastUpdateTime.toFixed(2)}ms`);

// Force immediate update (bypasses queue)
binder.forceUpdate('developer.exposure', 1.5);

// Bind texture uniforms
binder.bindTextureUniform('u_film_radiance_previous', 0);
binder.bindTextureUniform('u_environment_map', 8);

// Debug everything
binder.debugPrint();

// Check for issues
const missing = binder.getMissingParameters();
if (missing.length > 0) {
  console.warn('Parameters with no uniforms:', missing);
}

const unused = binder.getUnusedUniforms();
if (unused.length > 0) {
  console.log('Uniforms never set:', unused);
}

// Cleanup
binder.dispose();
```

## Invariants

1. **Bindings match program** - UniformMap always corresponds to active program
2. **Updates batched** - All queued updates flushed in single frameUpdate()
3. **Engine uniforms first** - Always updated before parameter uniforms
4. **Locations cached** - WebGLUniformLocation retrieved once at binding
5. **Missing tracked** - Parameters with no mapping recorded
6. **Usage tracked** - Know which uniforms are actually used
7. **Statistics accurate** - Performance metrics updated each frame

## Error Handling

The UniformBinder MUST handle these error conditions:

| Error | Response |
|-------|----------|
| No bindings | Throw when frameUpdate() called |
| No active program | Throw when building bindings |
| Invalid uniform type | Warn and skip update |
| Missing parameter mapping | Track and warn once |
| Optimized out uniform | Skip silently |
| Invalid value type | Warn with details |
| Texture uniform missing | Skip silently |

## Performance Requirements

- Binding creation: < 10ms for typical program
- Batch update: < 1ms for 50 uniforms
- Forced update: < 0.1ms per uniform
- Memory overhead: ~200 bytes per mapping
- Queue capacity: Unlimited (uses Map)
