# Phase 2.4: Parameter Store and Render Coordinator - Detailed Plan

## Purpose & Scope

Phase 2.4 adds state management and accumulation control to our path tracer. The ParameterStore becomes the single source of truth for all renderer settings, while the RenderCoordinator decides when parameter changes require resetting accumulation. This transforms our static renderer into an interactive tool.

**Core Goal**: Implement parameter management that tracks changes and intelligently resets accumulation only when necessary, maintaining convergence for non-disruptive changes.

## File Structure & Responsibilities

### `src/app/ParameterStore.ts` - Centralized State Management

**Purpose**: Store all renderer parameters, validate changes, and notify observers when values update.

## ParameterStore Implementation

### Core Structure

```typescript
class ParameterStore {
  private parameters: Map<string, any>
  private metadata: Map<string, ParameterMetadata>
  private listeners: Set<ParameterListener>
  private batchMode: boolean = false
  private pendingChanges: ParameterChange[] = []
  
  // Core operations
  set(path: string, value: any): void
  get(path: string): any
  batch(callback: () => void): void
  
  // Metadata registration
  registerMetadata(path: string, metadata: ParameterMetadata): void
  getMetadata(path: string): ParameterMetadata | undefined
  
  // Change notification
  subscribe(listener: ParameterListener): void
  unsubscribe(listener: ParameterListener): void
  
  // Serialization
  serialize(): Record<string, any>
  deserialize(data: Record<string, any>): void
}

interface ParameterMetadata {
  type: 'float' | 'int' | 'vec2' | 'vec3' | 'bool'
  min?: number | number[]
  max?: number | number[]
  default: any
  step?: number
  
  // Render impact
  triggersReset?: boolean  // Does changing this reset accumulation?
  affectsGeometry?: boolean  // Does this change ray intersections?
  
  // UI hints
  displayName?: string
  group?: string
  hidden?: boolean
}

interface ParameterChange {
  path: string
  oldValue: any
  newValue: any
  metadata?: ParameterMetadata
  timestamp: number
}

type ParameterListener = (changes: ParameterChange[]) => void
```

### Parameter Registration

```typescript
private initializeParameters(): void {
  // Camera parameters
  this.registerMetadata('camera.position', {
    type: 'vec3',
    default: [0, 0, 5],
    triggersReset: true,
    affectsGeometry: true,
    displayName: 'Camera Position',
    group: 'Camera'
  })
  
  this.registerMetadata('camera.target', {
    type: 'vec3',
    default: [0, 0, 0],
    triggersReset: true,
    affectsGeometry: true,
    displayName: 'Look At',
    group: 'Camera'
  })
  
  this.registerMetadata('camera.fov', {
    type: 'float',
    min: 10,
    max: 120,
    default: 60,
    step: 1,
    triggersReset: true,
    affectsGeometry: true,
    displayName: 'Field of View',
    group: 'Camera'
  })
  
  // Material parameters
  this.registerMetadata('material.albedo', {
    type: 'vec3',
    min: [0, 0, 0],
    max: [1, 1, 1],
    default: [0.8, 0.8, 0.8],
    triggersReset: true,
    affectsGeometry: false,
    displayName: 'Albedo',
    group: 'Material'
  })
  
  this.registerMetadata('material.roughness', {
    type: 'float',
    min: 0,
    max: 1,
    default: 1.0,
    step: 0.01,
    triggersReset: true,
    affectsGeometry: false,
    displayName: 'Roughness',
    group: 'Material'
  })
  
  // Render settings
  this.registerMetadata('render.maxBounces', {
    type: 'int',
    min: 1,
    max: 32,
    default: 8,
    triggersReset: true,
    affectsGeometry: false,
    displayName: 'Max Bounces',
    group: 'Render'
  })
  
  this.registerMetadata('render.rrProbability', {
    type: 'float',
    min: 0,
    max: 1,
    default: 0.9,
    step: 0.05,
    triggersReset: true,
    affectsGeometry: false,
    displayName: 'RR Probability',
    group: 'Render'
  })
  
  // Developer parameters (don't reset)
  this.registerMetadata('developer.exposure', {
    type: 'float',
    min: -5,
    max: 5,
    default: 0,
    step: 0.1,
    triggersReset: false,  // Can adjust without reset!
    affectsGeometry: false,
    displayName: 'Exposure',
    group: 'Post Process'
  })
  
  this.registerMetadata('developer.gamma', {
    type: 'float',
    min: 1,
    max: 3,
    default: 2.2,
    step: 0.1,
    triggersReset: false,  // Can adjust without reset!
    affectsGeometry: false,
    displayName: 'Gamma',
    group: 'Post Process'
  })
}
```

### Value Management

```typescript
set(path: string, value: any): void {
  const metadata = this.metadata.get(path)
  const oldValue = this.parameters.get(path)
  
  // Skip if unchanged
  if (this.isEqual(oldValue, value)) return
  
  // Validate and clamp
  if (metadata) {
    value = this.validateValue(value, metadata)
  }
  
  // Store value
  this.parameters.set(path, value)
  
  // Create change record
  const change: ParameterChange = {
    path,
    oldValue,
    newValue: value,
    metadata,
    timestamp: performance.now()
  }
  
  // Handle batching
  if (this.batchMode) {
    this.pendingChanges.push(change)
  } else {
    this.notifyListeners([change])
  }
}

private validateValue(value: any, metadata: ParameterMetadata): any {
  switch (metadata.type) {
    case 'float':
      value = Number(value)
      if (metadata.min !== undefined) value = Math.max(value, metadata.min as number)
      if (metadata.max !== undefined) value = Math.min(value, metadata.max as number)
      return value
      
    case 'int':
      value = Math.round(Number(value))
      if (metadata.min !== undefined) value = Math.max(value, metadata.min as number)
      if (metadata.max !== undefined) value = Math.min(value, metadata.max as number)
      return value
      
    case 'vec3':
      if (!Array.isArray(value) || value.length !== 3) {
        throw new Error(`Expected vec3, got ${value}`)
      }
      if (metadata.min) {
        const min = metadata.min as number[]
        value = value.map((v: number, i: number) => Math.max(v, min[i]))
      }
      if (metadata.max) {
        const max = metadata.max as number[]
        value = value.map((v: number, i: number) => Math.min(v, max[i]))
      }
      return value
      
    default:
      return value
  }
}

batch(callback: () => void): void {
  this.batchMode = true
  this.pendingChanges = []
  
  try {
    callback()
  } finally {
    this.batchMode = false
    if (this.pendingChanges.length > 0) {
      this.notifyListeners(this.pendingChanges)
      this.pendingChanges = []
    }
  }
}
```

## RenderCoordinator Implementation

### `src/app/RenderCoordinator.ts` - Accumulation Control

**Purpose**: Manage when to reset accumulation based on parameter changes, track sample count, and coordinate render updates.

### Core Structure

```typescript
class RenderCoordinator {
  private engine: Engine
  private parameterStore: ParameterStore
  private sampleCount: number = 0
  private needsReset: boolean = false
  private lastResetTime: number = 0
  private isRendering: boolean = false
  
  constructor(engine: Engine, parameterStore: ParameterStore)
  
  // Accumulation control
  resetAccumulation(): void
  checkNeedsReset(changes: ParameterChange[]): boolean
  getSampleCount(): number
  
  // Render control
  startRendering(): void
  stopRendering(): void
  renderFrame(): void
  
  // Statistics
  getConvergenceEstimate(): number
  getAverageFrameTime(): number
}
```

### Reset Decision Logic

```typescript
private setupParameterListener(): void {
  this.parameterStore.subscribe((changes: ParameterChange[]) => {
    // Check if any change requires reset
    const needsReset = this.checkNeedsReset(changes)
    
    if (needsReset) {
      this.resetAccumulation()
    } else {
      // Update uniforms without reset
      this.updateUniforms(changes)
    }
  })
}

checkNeedsReset(changes: ParameterChange[]): boolean {
  for (const change of changes) {
    // Check metadata first
    if (change.metadata?.triggersReset) {
      console.log(`Parameter ${change.path} triggers reset`)
      return true
    }
    
    // Check path patterns (fallback for unregistered parameters)
    const resetPatterns = [
      /^camera\./,     // Any camera change
      /^material\./,   // Any material change
      /^scene\./,      // Scene modifications
      /^render\./      // Render settings
    ]
    
    const noResetPatterns = [
      /^developer\./,  // Post-processing
      /^debug\./,      // Debug visualization
      /^ui\./          // UI state
    ]
    
    // Check no-reset patterns first (higher priority)
    if (noResetPatterns.some(pattern => pattern.test(change.path))) {
      continue
    }
    
    // Check reset patterns
    if (resetPatterns.some(pattern => pattern.test(change.path))) {
      console.log(`Parameter ${change.path} matches reset pattern`)
      return true
    }
  }
  
  return false
}

resetAccumulation(): void {
  console.log('Resetting accumulation')
  
  // Reset sample count
  this.sampleCount = 0
  this.lastResetTime = performance.now()
  
  // Set reset flag for next frame
  this.needsReset = true
  
  // Clear film buffers
  this.engine.clearFilmBuffers()
}
```

### Render Loop Integration

```typescript
renderFrame(): void {
  if (!this.isRendering) return
  
  // Update uniforms for film
  this.engine.setUniform('u_film_sample_count', this.sampleCount)
  this.engine.setUniform('u_film_reset', this.needsReset)
  
  // Update camera uniforms from parameters
  this.updateCameraUniforms()
  
  // Update material uniforms
  this.updateMaterialUniforms()
  
  // Render the frame
  this.engine.renderFrame()
  
  // Update state
  this.sampleCount++
  this.needsReset = false
  
  // Schedule next frame
  requestAnimationFrame(() => this.renderFrame())
}

private updateCameraUniforms(): void {
  const position = this.parameterStore.get('camera.position')
  const target = this.parameterStore.get('camera.target')
  const fov = this.parameterStore.get('camera.fov')
  
  this.engine.setUniform('u_camera_position', position)
  this.engine.setUniform('u_camera_target', target)
  this.engine.setUniform('u_camera_fov', fov)
}

private updateMaterialUniforms(): void {
  const albedo = this.parameterStore.get('material.albedo')
  const roughness = this.parameterStore.get('material.roughness')
  
  this.engine.setUniform('u_material_albedo', albedo)
  this.engine.setUniform('u_material_roughness', roughness)
}
```

### Convergence Tracking

```typescript
getConvergenceEstimate(): number {
  // Simple estimate based on sample count
  // More sophisticated would use variance
  
  if (this.sampleCount === 0) return 0
  
  // Asymptotic convergence model
  const targetSamples = 1000  // "Converged" at 1000 samples
  const convergence = Math.min(1, this.sampleCount / targetSamples)
  
  // Apply curve for perceptual convergence
  return Math.pow(convergence, 0.5)
}

getTimeSinceReset(): number {
  return (performance.now() - this.lastResetTime) / 1000
}

getRenderedSampleRate(): number {
  if (this.sampleCount === 0) return 0
  const elapsed = this.getTimeSinceReset()
  return this.sampleCount / elapsed
}
```

## Integration with Main App

### Modified App Structure

```typescript
class PathTracerApp {
  private engine: Engine
  private parameterStore: ParameterStore
  private renderCoordinator: RenderCoordinator
  
  async initialize(): Promise<void> {
    // Create core components
    this.engine = new Engine(this.canvas)
    this.parameterStore = new ParameterStore()
    this.renderCoordinator = new RenderCoordinator(this.engine, this.parameterStore)
    
    // Initialize parameters with defaults
    this.parameterStore.initializeParameters()
    
    // Load and compile shaders
    this.loadModules()
    this.compileShaders()
    
    // Start rendering
    this.renderCoordinator.startRendering()
  }
}
```

### UI Integration Example

```typescript
// Simple parameter UI
class ParameterUI {
  constructor(private parameterStore: ParameterStore) {
    this.createControls()
  }
  
  private createControls(): void {
    // Camera position
    this.createVec3Control('camera.position', (value) => {
      this.parameterStore.set('camera.position', value)
    })
    
    // Material albedo (color picker)
    this.createColorControl('material.albedo', (value) => {
      this.parameterStore.set('material.albedo', value)
    })
    
    // Exposure (doesn't reset)
    this.createSliderControl('developer.exposure', -5, 5, 0.1, (value) => {
      this.parameterStore.set('developer.exposure', value)
    })
  }
}
```

## Updated Shader Integration

### Modified Camera Module

```glsl
// Now uses uniforms instead of hardcoded values
uniform vec3 u_camera_position;
uniform vec3 u_camera_target;
uniform float u_camera_fov;

Ray camera_generateRay(vec2 pixel, vec2 resolution) {
    vec3 forward = normalize(u_camera_target - u_camera_position);
    // ... rest of implementation
}
```

### Modified Material Module

```glsl
uniform vec3 u_material_albedo;
uniform float u_material_roughness;

void scene_get_material(Hit hit, out vec3 albedo, out float roughness) {
    // Use uniform values instead of hardcoded
    albedo = u_material_albedo;
    roughness = u_material_roughness;
}
```

## Testing Strategy

### Parameter Store Tests
```typescript
test('validates values against metadata', () => {
  store.registerMetadata('test.float', { type: 'float', min: 0, max: 1 })
  store.set('test.float', 2.0)
  expect(store.get('test.float')).toBe(1.0)  // Clamped
})

test('batches changes correctly', () => {
  let changeCount = 0
  store.subscribe(() => changeCount++)
  
  store.batch(() => {
    store.set('a', 1)
    store.set('b', 2)
    store.set('c', 3)
  })
  
  expect(changeCount).toBe(1)  // Single notification
})
```

### Reset Logic Tests
```typescript
test('camera changes trigger reset', () => {
  coordinator.checkNeedsReset([
    { path: 'camera.position', oldValue: [0,0,5], newValue: [0,0,4] }
  ])
  expect(coordinator.getSampleCount()).toBe(0)
})

test('exposure changes do not reset', () => {
  const oldCount = coordinator.getSampleCount()
  coordinator.checkNeedsReset([
    { path: 'developer.exposure', oldValue: 0, newValue: 1 }
  ])
  expect(coordinator.getSampleCount()).toBe(oldCount)
})
```

## Success Criteria

Phase 2.4 is complete when:
1. Parameters stored and validated correctly
2. Changes trigger appropriate resets
3. Post-processing adjustable without reset
4. Accumulation tracks sample count
5. Uniforms update from parameters
6. Batch updates work efficiently

## What We're NOT Doing in Phase 2.4

- Complex UI components
- Presets or parameter sets
- Undo/redo functionality
- Parameter animation
- Dependency tracking between parameters
- Computed parameters
- Parameter versioning
- Cloud storage of parameters

## Connection to Phase 3

This completes our basic path tracer:
- Real transport with bounces
- Proper Lambert BRDF
- Progressive accumulation
- Parameter management
- Intelligent reset handling

Phase 3 will add:
- World compilation from scene descriptions
- Multiple materials in a scene
- Area lights and emissive materials
- Scene hierarchy and transforms

We now have a working, interactive path tracer that converges to physically correct images!

## Common Integration Issues

```typescript
// ISSUE: Circular dependency
// Solution: Use events or callbacks instead of direct references

// ISSUE: Reset thrashing (constant resets)
// Solution: Debounce parameter changes

// ISSUE: Uniforms not updating
// Solution: Ensure shader uses uniforms not constants

// ISSUE: First frame after reset is wrong
// Solution: Check u_film_reset flag in shader
```

This completes Phase 2 - we now have a real path tracer with accumulation and parameter control!
