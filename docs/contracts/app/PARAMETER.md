# Parameter Store Contract

The ParameterStore is the central state management system, tracking all renderer parameters and notifying observers of changes.

## Core Interface

```typescript
interface ParameterStore {
  // Single value operations
  set(path: string, value: any): void;
  get(path: string): any;
  
  // Batch operations
  batch(updates: Record<string, any>): void;
  getAll(): Record<string, any>;
  
  // Metadata
  registerParameter(path: string, metadata: ParameterMetadata): void;
  getMetadata(path: string): ParameterMetadata;
  
  // Change notification
  onChange: (changes: ParameterChanges) => void;
  
  // Serialization
  serialize(): string;
  restore(data: Record<string, any>): void;
}
```

## Parameter Paths

Parameters use dot-notation paths that match module structure:

```typescript
"camera.position"           // vec3 camera position
"camera.fov"               // float field of view
"material.glass.ior"       // float index of refraction
"material.marble.albedo"   // vec3 color
"estimator.max_bounces"    // int path length
"film.alpha"              // float blend factor
"developer.exposure"       // float brightness
```

## Parameter Metadata

Each parameter can have associated metadata:

```typescript
interface ParameterMetadata {
  type: 'float' | 'int' | 'vec2' | 'vec3' | 'vec4' | 'bool' | 'enum';
  min?: number | number[];      // Minimum value(s)
  max?: number | number[];      // Maximum value(s)
  default: any;                  // Default value
  uiHint?: UIHint;              // How to display in UI
  description?: string;          // Human-readable description
}

type UIHint = 
  | 'slider'        // Continuous value
  | 'color'         // Color picker
  | 'dropdown'      // Enumeration
  | 'hidden';       // Not shown in UI
```

## Change Notification

When parameters change, observers are notified:

```typescript
interface ParameterChanges {
  changes: Array<{
    path: string;
    oldValue: any;
    newValue: any;
    metadata?: ParameterMetadata;  // Optional, may be undefined
  }>;
}
```

## Usage Examples

### Basic Usage
```typescript
const store = new ParameterStore();

// Register parameter with metadata
store.registerParameter('camera.fov', {
  type: 'float',
  min: 10,
  max: 170,
  default: 60,
  uiHint: 'slider',
  description: 'Camera field of view in degrees'
});

// Set value
store.set('camera.fov', 45);

// Get value
const fov = store.get('camera.fov');  // 45
```

### Batch Updates
```typescript
// Update multiple parameters at once
store.batch({
  'camera.position': [0, 5, 10],
  'camera.target': [0, 0, 0],
  'material.sphere.albedo': [0.8, 0.2, 0.2]
});
// Triggers ONE onChange event with all changes
```

### Change Handling
```typescript
store.onChange = (changes: ParameterChanges) => {
  // Update uniforms
  for (const change of changes.changes) {
    engine.setUniform(change.path, change.newValue);
  }
  
  // RenderCoordinator decides if reset needed
  // (ParameterStore doesn't know about accumulation)
  for (const change of changes.changes) {
    renderCoordinator.handleParameterChange(
      change.path, 
      change.oldValue,
      change.newValue
    );
  }
};
```

## Auto-Registration

Modules can declare their parameters, which are auto-registered:

```typescript
// From module descriptor
{
  parameters: [
    {
      name: "roughness",  // Becomes "material.pbr.roughness"
      type: "float",
      min: 0,
      max: 1,
      default: 0.5,
      uiHint: "slider",
      description: "Surface roughness"
    }
  ]
}
```

## Hierarchical Organization

Parameters form a tree structure:

```
camera/
  ├── position: vec3
  ├── target: vec3
  ├── fov: float
  └── aperture: float

material/
  ├── glass/
  │   ├── ior: float
  │   └── absorption: vec3
  └── marble/
      ├── albedo: vec3
      ├── roughness: float
      └── scale: float

estimator/
  ├── max_bounces: int
  └── rr_threshold: float
```

## Serialization

Save/restore complete parameter state:

```typescript
// Save to JSON
const json = store.serialize();
fs.writeFileSync('params.json', json);

// Restore from JSON
const data = JSON.parse(fs.readFileSync('params.json'));
store.restore(data);

// Note: restore() does not trigger onChange
// Call it before starting rendering
```

## Validation

The store validates values against metadata:

```typescript
store.set('camera.fov', 200);  // Throws: exceeds max
store.set('camera.fov', 'abc'); // Throws: type mismatch
store.set('unknown.param', 5);  // Warning: unregistered parameter
```

## Performance Considerations

- Batch updates when possible to reduce onChange calls
- Use shallow equality for change detection
- Cache frequently accessed values
- Debounce rapid changes (e.g., during slider drag)

## Integration Pattern

The ParameterStore doesn't directly update GPU uniforms or manage accumulation. Instead:

1. **Store** tracks parameter values and metadata
2. **Store** notifies observers of changes via onChange
3. **Engine** maps parameters to uniforms and updates GPU
4. **RenderCoordinator** decides when to reset accumulation

This separation allows:
- Testing without GPU
- Multiple observers (UI, Engine, Logger)
- Undo/redo functionality
- Parameter animation
- Clean separation of concerns

## Example: Complete Integration

```typescript
// Setup
const store = new ParameterStore();
const engine = new Engine(canvas);
const coordinator = new RenderCoordinator(engine);

// Wire up the flow
store.onChange = (changes) => {
  // Engine updates uniforms
  for (const change of changes.changes) {
    engine.setUniform(change.path, change.newValue);
  }
  
  // Coordinator checks for reset
  for (const change of changes.changes) {
    coordinator.handleParameterChange(
      change.path,
      change.oldValue, 
      change.newValue
    );
  }
};

// Usage
store.set('camera.position', [1, 2, 3]);  // Updates GPU, may reset
store.set('developer.exposure', 0.5);     // Updates GPU, no reset
```

## Best Practices

1. **Register all parameters** with metadata for validation
2. **Use batch updates** for related changes to reduce events
3. **Keep the store simple** - it only manages state, not rendering logic
4. **Use hierarchical paths** for clear organization
5. **Document parameter ranges** in metadata for UI generation
6. **Validate early** to catch errors before GPU updates
7. **Let RenderCoordinator decide** about accumulation resets
