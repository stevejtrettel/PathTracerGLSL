
# Parameter Store Contract

## Purpose

The ParameterStore is the single source of truth for all renderer state. It stores parameter values, validates against metadata, and notifies observers of changes. The store knows nothing about rendering - it only manages state.

## Required Interface

```typescript
interface ParameterStore {
  // Core operations
  set(path: string, value: any, source?: ChangeSource): void;
  get(path: string): any;
  batch(updates: Record<string, any>, source?: ChangeSource): void;
  
  // Metadata
  registerMetadata(path: string, metadata: ParameterMetadata): void;
  getMetadata(path: string): ParameterMetadata | undefined;
  
  // Change notification
  onChange: ((changes: ParameterChanges) => void) | null;
  
  // Serialization
  serialize(): string;
  restore(data: Record<string, any>): void;
}
```

## Core Behavior

### Setting Parameters
```typescript
set(path: string, value: any, source: ChangeSource = 'user'): void {
  const oldValue = this.parameters.get(path);
  
  // Skip if unchanged
  if (shallowEqual(oldValue, value)) return;
  
  // Validate if metadata exists
  const metadata = this.metadata.get(path);
  if (metadata) {
    value = this.validateAndClamp(value, metadata);
  }
  
  // Store value
  this.parameters.set(path, value);
  
  // Notify (unless batching)
  if (!this.batching) {
    this.onChange?.({
      changes: [{ path, oldValue, newValue: value, metadata, source }]
    });
  }
}
```

### Batch Updates
```typescript
batch(updates: Record<string, any>, source: ChangeSource = 'user'): void {
  this.batching = true;
  const changes = [];
  
  for (const [path, value] of Object.entries(updates)) {
    const oldValue = this.get(path);
    this.set(path, value, source);
    if (!shallowEqual(oldValue, value)) {
      const metadata = this.getMetadata(path);
      changes.push({ path, oldValue, newValue: value, metadata, source });
    }
  }
  
  this.batching = false;
  
  // Single notification for all changes
  if (changes.length > 0) {
    this.onChange?.({ changes });
  }
}
```

### Validation
```typescript
private validateAndClamp(value: any, metadata: ParameterMetadata): any {
  switch (metadata.type) {
    case 'float':
    case 'int':
      if (metadata.min !== undefined && value < metadata.min) {
        console.warn(`Clamping ${value} to min ${metadata.min}`);
        return metadata.min;
      }
      if (metadata.max !== undefined && value > metadata.max) {
        console.warn(`Clamping ${value} to max ${metadata.max}`);
        return metadata.max;
      }
      return metadata.type === 'int' ? Math.round(value) : value;
      
    case 'vec3':
      if (!Array.isArray(value) || value.length !== 3) {
        throw new Error(`Expected vec3, got ${value}`);
      }
      return value;
      
    case 'bool':
      return Boolean(value);
      
    case 'enum':
      if (!metadata.options?.includes(value)) {
        throw new Error(`Value ${value} not in options`);
      }
      return value;
      
    default:
      return value;
  }
}
```

## Implementation Example

```typescript
class ParameterStore {
  private parameters = new Map<string, any>();
  private metadata = new Map<string, ParameterMetadata>();
  private batching = false;
  
  onChange: ((changes: ParameterChanges) => void) | null = null;
  
  set(path: string, value: any, source: ChangeSource = 'user'): void {
    // Implementation as above
  }
  
  get(path: string): any {
    return this.parameters.get(path);
  }
  
  registerMetadata(path: string, metadata: ParameterMetadata): void {
    this.metadata.set(path, metadata);
    
    // Set default value if parameter doesn't exist
    if (!this.parameters.has(path) && metadata.default !== undefined) {
      this.set(path, metadata.default, 'recipe');
    }
  }
  
  getMetadata(path: string): ParameterMetadata | undefined {
    return this.metadata.get(path);
  }
  
  serialize(): string {
    return JSON.stringify(Object.fromEntries(this.parameters));
  }
  
  restore(data: Record<string, any>): void {
    // Always use 'session' source for restoration
    this.batch(data, 'session');
  }
}
```

## Usage Example

```typescript
const store = new ParameterStore();

// Register parameters with metadata
store.registerMetadata('camera.fov', {
  type: 'float',
  min: 10,
  max: 170,
  default: 60,
  triggersReset: true  // Just metadata, not a decision
});

store.registerMetadata('developer.exposure', {
  type: 'float',
  min: -5,
  max: 5,
  default: 0,
  triggersReset: false  // Just metadata, not a decision
});

// Wire up to render coordinator
store.onChange = (changes) => {
  // Update uniforms
  for (const change of changes.changes) {
    engine.updateUniform(change.path, change.newValue);
  }
  
  // Let coordinator decide about reset
  const needsReset = changes.changes.some(
    c => renderCoordinator.shouldResetForParameter(c.path, c.source)
  );
  
  if (needsReset) {
    renderCoordinator.resetAccumulation();
  }
};

// Single update
store.set('camera.fov', 45);  // source defaults to 'user'

// Update with explicit source
store.set('camera.position', [0, 0, 5], 'animation');

// Batch update (single event)
store.batch({
  'camera.position': [0, 5, 10],
  'material.roughness': 0.5
}, 'experiment');

// Restore from session (always uses 'session' source)
store.restore(savedParameters);
```

## Key Responsibilities

1. **Store values** - Simple key-value storage with dot-notation paths
2. **Validate and clamp** - Enforce type and range constraints from metadata
3. **Batch updates** - Group changes for single notification
4. **Track source** - Include where changes came from
5. **Enable persistence** - Serialize/restore for session management

## What ParameterStore Does NOT Do

- Make rendering decisions
- Decide when to reset accumulation
- Update GPU uniforms directly
- Create UI controls
- Load textures or resources

## Types Used

```typescript
interface ParameterChanges {
  changes: ParameterChange[];
}

interface ParameterChange {
  path: string;
  oldValue: any;
  newValue: any;
  metadata?: ParameterMetadata;
  source: ChangeSource;
}

type ChangeSource = 
  | 'user'          // Direct user interaction
  | 'animation'     // Animation system
  | 'extension'     // Extension-initiated
  | 'session'       // Loading from session
  | 'recipe'        // Recipe switch or defaults
  | 'experiment'    // Experiment/sweep
  | 'api';          // External API call
```

## Invariants

1. Parameter paths use dot notation (e.g., "camera.position")
2. Values are validated against metadata if present
3. Batch operations emit single change event
4. Restore always uses source: 'session'
5. Source defaults to 'user' if not specified
6. Metadata may include `triggersReset` hint but store doesn't act on it

## Integration

```
User Input → ParameterStore → onChange → Engine (uniforms)
                                      ↘ RenderCoordinator (reset decision)
```

The store is passive - it manages state and emits events with source information. Other components decide what to do with those events.
