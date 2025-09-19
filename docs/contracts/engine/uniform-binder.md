
# Uniform Binder Contract

## Purpose

The UniformBinder maps parameter paths from the ParameterStore to GPU uniform locations. It builds an explicit UniformMap for debugging visibility, batches uniform updates for efficiency, and tracks uniform usage statistics.

## Required Interface

```typescript
interface UniformBinder {
  // Binding management
  buildBindings(program: CompiledProgram, modules: ModuleDescriptor[]): void;
  clearBindings(): void;
  hasBindings(): boolean;
  
  // Uniform mapping
  getUniformMap(): UniformMap;
  hasBinding(paramPath: string): boolean;
  getBinding(paramPath: string): UniformMapping | undefined;
  getAllBindings(): UniformMapping[];
  
  // Parameter updates (batched)
  queueUpdate(paramPath: string, value: any): void;
  queueUpdates(changes: ParameterChanges): void;
  clearQueue(): void;
  getQueueSize(): number;
  
  // Frame execution (flushes queue)
  frameUpdate(engineState: EngineState): void;
  forceFlush(): void;
  
  // Texture binding
  bindTexture(samplerPath: string, textureUnit: number): void;
  unbindTexture(samplerPath: string): void;
  getTextureBindings(): Map<string, number>;
  
  // Performance monitoring
  getUpdateStats(): UpdateStats;
  resetStats(): void;
  getLastUpdateTime(): number;
  
  // Debugging
  debugPrint(): void;
  getMissingBindings(): string[];
  getSuggestedBindings(paramPath: string): string[];
}
```

## The UniformMap

### Structure

```typescript
interface UniformMap {
  // Core operations
  addMapping(mapping: UniformMapping): void;
  getMapping(paramPath: string): UniformMapping | undefined;
  hasMapping(paramPath: string): boolean;
  getAllMappings(): UniformMapping[];
  
  // Debugging
  getProgramId(): string;
  getMappingCount(): number;
  getUnusedMappings(): UniformMapping[];
  debugPrint(): void;
}

interface UniformMapping {
  paramPath: string;              // "camera.position"
  glslName: string;               // "u_camera_pinhole_position"
  location: WebGLUniformLocation | null;
  type: UniformType;
  arrayLength?: number;           // For array uniforms
  
  // Metadata
  moduleSource: string;           // Which module defined this
  used: boolean;                  // Has been set at least once
  lastValue?: any;                // For change detection
  updateCount: number;            // Times updated
}

type UniformType = 
  | 'float' | 'vec2' | 'vec3' | 'vec4'
  | 'int' | 'ivec2' | 'ivec3' | 'ivec4'
  | 'bool' | 'bvec2' | 'bvec3' | 'bvec4'
  | 'mat2' | 'mat3' | 'mat4'
  | 'sampler2D' | 'samplerCube' | 'sampler3D';
```

### Mapping Construction

The UniformMap MUST be built from:
1. Module parameters → uniforms
2. Engine uniforms → fixed mappings
3. Film textures → sampler uniforms

## Parameter Path Mapping

### Module Parameter Mapping

Parameters map to uniforms with this pattern:

```
Parameter Path: [kind].[parameter_name]
GLSL Uniform:   u_[prefix][module_name]_[parameter_name]
```

Examples:
- `camera.position` → `u_camera_pinhole_position`
- `material.roughness` → `u_material_disney_roughness`
- `developer.exposure` → `u_developer_aces_exposure`

### Prefix Resolution

| Module Kind | Prefix |
|------------|--------|
| geometry | `g_` |
| material | `m_` |
| scene | `sc_` |
| lights | `l_` |
| camera | `camera_` |
| estimator | `estimator_` |
| film | `film_` |
| developer | `developer_` |

### Engine Uniforms

These uniforms MUST always be available:

| Parameter Path | GLSL Name | Type | Purpose |
|---------------|-----------|------|---------|
| `engine.resolution` | `u_resolution` | vec2 | Viewport size |
| `engine.frame_index` | `u_frame_index` | int | Frame number |
| `engine.sample_count` | `u_sample_count` | int | Accumulation count |
| `engine.film_reset` | `u_film_reset` | bool | Clear flag |
| `engine.time` | `u_time` | float | Seconds elapsed |

### Film Texture Uniforms

Film textures map to samplers:

| Texture Name | GLSL Name | Type |
|-------------|-----------|------|
| radiance | `u_film_radiance` | sampler2D |
| variance | `u_film_variance` | sampler2D |
| auxiliary | `u_film_auxiliary` | sampler2D |

## Update Batching

### Queue Management

The UniformBinder MUST:
1. Queue parameter updates during frame (not apply immediately)
2. Detect redundant updates (same value)
3. Coalesce multiple updates to same parameter
4. Track queue size for monitoring

### Frame Update Process

`frameUpdate(engineState)` MUST execute in this order:

1. **Update engine uniforms** (always)
    - Resolution, frame index, sample count, time

2. **Update camera matrices** (if changed)
    - View matrix, projection matrix, derived values

3. **Flush parameter queue** (batched)
    - Apply all queued parameter changes
    - Skip if location is null (uniform optimized out)
    - Track statistics

4. **Clear queue** for next frame

### Type-Specific Updates

The binder MUST correctly handle each uniform type:

| Type | WebGL Call | Value Format |
|------|------------|--------------|
| float | `uniform1f` | number |
| vec2 | `uniform2fv` | [x, y] |
| vec3 | `uniform3fv` | [x, y, z] |
| vec4 | `uniform4fv` | [x, y, z, w] |
| int | `uniform1i` | number |
| bool | `uniform1i` | 0 or 1 |
| mat3 | `uniformMatrix3fv` | 9 elements |
| mat4 | `uniformMatrix4fv` | 16 elements |
| sampler2D | `uniform1i` | texture unit |

## Performance Tracking

### Update Statistics

```typescript
interface UpdateStats {
  // Counts
  totalUpdates: number;               // Lifetime updates
  frameUpdates: number;               // Updates this frame
  uniqueUniforms: number;             // Distinct uniforms updated
  skippedUpdates: number;             // No location (optimized out)
  redundantUpdates: number;           // Same value
  missingBindings: number;            // No mapping found
  
  // Timing
  lastUpdateTime: number;             // Milliseconds for last flush
  averageUpdateTime: number;          // Running average
  maxUpdateTime: number;              // Worst case
  
  // Queue
  maxQueueSize: number;               // Largest queue seen
  averageQueueSize: number;           // Typical queue size
}
```

### Performance Requirements

- Queue operation: O(1) insertion
- Flush operation: O(n) where n = queue size
- Typical frame: < 1ms for 50 uniform updates
- Redundancy detection: O(1) with last value cache

## Error Handling

### Missing Bindings

When a parameter has no uniform binding:

1. **Check if optional** - Some parameters only apply to certain variants
2. **Increment counter** - Track missing binding statistics
3. **Log warning** (development) or skip silently (production)
4. **Provide suggestions** - Find similar parameter names

### Optional Parameters

These parameters MAY not have bindings:

- Material emission (only emissive materials)
- Film variance threshold (only variance films)
- Developer debug settings (only debug developer)
- Estimator volume settings (only volumetric estimator)

### Suggestions System

For missing bindings, suggest alternatives:
1. Find parameters with similar names (edit distance)
2. List all parameters in same category
3. Check for common typos

## Texture Binding

### Sampler Management

The UniformBinder MUST:
- Track which texture unit each sampler uses
- Bind texture samplers to correct units
- Reserve units 0-7 for film textures
- Reserve units 8-15 for material textures
- Update sampler uniforms with unit numbers

### Texture Unit Allocation

| Units | Reserved For |
|-------|-------------|
| 0-3 | Film textures (radiance, variance, etc.) |
| 4-7 | Additional film buffers |
| 8-11 | Material textures (albedo, normal, etc.) |
| 12-15 | Environment/light textures |
| 16-31 | General purpose (if available) |

## Integration Requirements

### With ShaderCompiler

The binder MUST:
- Build UniformMap from CompiledProgram
- Extract uniform locations from WebGLProgram
- Map parameter paths using module metadata

### With ResourceManager

The binder MUST:
- Get texture unit assignments for film textures
- Bind samplers to correct texture units
- Respect texture unit reservations

### With Engine

The binder MUST:
- Accept parameter updates from ParameterStore
- Flush all updates once per frame
- Provide statistics for monitoring
- Clear bindings when switching programs

## Debugging Features

### Debug Output

`debugPrint()` MUST show:
- Total mappings
- Mappings with/without locations
- Update statistics
- Queue size
- Missing bindings

Example output:
```
=== Uniform Bindings ===
Total mappings: 47
With location: 32
Without location: 15 (optimized out)
Updates this frame: 12
Queue size: 3
Missing bindings: 1 (camera.aperature)
```

### Missing Binding Helpers

```typescript
getMissingBindings(): string[]
// Returns all parameters that were set but had no binding

getSuggestedBindings(paramPath: string): string[]
// Returns similar parameter names that DO have bindings
```

## Usage Example

```typescript
const binder = new UniformBinder(gl);

// Build mappings for a program
binder.buildBindings(compiledProgram, modules);

// Queue parameter updates
binder.queueUpdate('camera.position', [0, 5, 10]);
binder.queueUpdate('material.roughness', 0.5);

// Once per frame
const engineState = {
  width: 1920,
  height: 1080,
  frameIndex: 42,
  sampleCount: 100,
  time: 1.234
};
binder.frameUpdate(engineState);  // Flushes all updates

// Debug missing binding
if (!binder.hasBinding('camera.aperature')) {
  const suggestions = binder.getSuggestedBindings('camera.aperature');
  console.log('Did you mean:', suggestions);  // ['camera.aperture']
}

// Check performance
const stats = binder.getUpdateStats();
console.log(`Uniform updates: ${stats.frameUpdates} in ${stats.lastUpdateTime}ms`);
```

## Invariants

1. UniformMap is immutable after `buildBindings()`
2. Queue is always empty after `frameUpdate()`
3. Engine uniforms are updated every frame
4. Texture units 0-7 are reserved for film
5. Statistics accurately reflect update counts
6. Missing bindings are tracked but don't cause errors
7. Redundant updates (same value) are skipped
