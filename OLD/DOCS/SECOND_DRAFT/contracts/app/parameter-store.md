You're absolutely right. I got carried away with implementation details rather than focusing on the contract. The ParameterStore is actually quite simple - it's a validated key-value store with change notifications. Let me create a more concise contract:

# Parameter Store Contract

## Purpose

The ParameterStore is the single source of truth for all renderer state. It stores parameter values, validates against metadata, and notifies observers of changes. The store knows nothing about rendering - it only manages state.

## Required Interface

```typescript
interface ParameterStore {
  // Core operations
  set(path: string, value: any): void;
  get(path: string): any;
  batch(updates: Record<string, any>): void;
  
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
set(path: string, value: any): void {
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
      changes: [{ path, oldValue, newValue: value, metadata }],
      triggersReset: this.shouldTriggerReset(path, metadata)
    });
  }
}
```

### Batch Updates
```typescript
batch(updates: Record<string, any>): void {
  this.batching = true;
  const changes = [];
  
  for (const [path, value] of Object.entries(updates)) {
    const oldValue = this.get(path);
    this.set(path, value);
    if (!shallowEqual(oldValue, value)) {
      changes.push({ path, oldValue, newValue: value });
    }
  }
  
  this.batching = false;
  
  // Single notification for all changes
  if (changes.length > 0) {
    this.onChange?.({
      changes,
      triggersReset: changes.some(c => this.shouldTriggerReset(c.path))
    });
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

### Reset Triggers
```typescript
private shouldTriggerReset(path: string, metadata?: ParameterMetadata): boolean {
  // Explicit metadata flag takes precedence
  if (metadata?.triggersReset !== undefined) {
    return metadata.triggersReset;
  }
  
  // Default prefixes that trigger reset
  const resetPrefixes = ['camera.', 'material.', 'scene.', 'lights.'];
  const noResetPrefixes = ['developer.', 'ui.', 'debug.'];
  
  // Check no-reset first (higher priority)
  if (noResetPrefixes.some(p => path.startsWith(p))) return false;
  if (resetPrefixes.some(p => path.startsWith(p))) return true;
  
  // Default to reset for safety
  return true;
}
```

## Implementation Example

```typescript
class ParameterStore {
  private parameters = new Map<string, any>();
  private metadata = new Map<string, ParameterMetadata>();
  private batching = false;
  
  onChange: ((changes: ParameterChanges) => void) | null = null;
  
  set(path: string, value: any): void {
    // Implementation as above
  }
  
  get(path: string): any {
    return this.parameters.get(path);
  }
  
  registerMetadata(path: string, metadata: ParameterMetadata): void {
    this.metadata.set(path, metadata);
    
    // Set default value if parameter doesn't exist
    if (!this.parameters.has(path) && metadata.default !== undefined) {
      this.set(path, metadata.default);
    }
  }
  
  serialize(): string {
    return JSON.stringify(Object.fromEntries(this.parameters));
  }
  
  restore(data: Record<string, any>): void {
    // Silent batch update
    const oldOnChange = this.onChange;
    this.onChange = null;
    this.batch(data);
    this.onChange = oldOnChange;
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
  triggersReset: true
});

store.registerMetadata('developer.exposure', {
  type: 'float',
  min: -5,
  max: 5,
  default: 0,
  triggersReset: false  // Doesn't reset accumulation
});

// Wire up to render coordinator
store.onChange = (changes) => {
  // Update uniforms
  for (const change of changes.changes) {
    engine.updateUniform(change.path, change.newValue);
  }
  
  // Reset accumulation if needed
  if (changes.triggersReset) {
    renderCoordinator.resetAccumulation();
  }
};

// Single update
store.set('camera.fov', 45);

// Batch update (single event)
store.batch({
  'camera.position': [0, 5, 10],
  'material.roughness': 0.5
});
```

## Key Responsibilities

1. **Store values** - Simple key-value storage with dot-notation paths
2. **Validate and clamp** - Enforce type and range constraints from metadata
3. **Batch updates** - Group changes for single notification
4. **Determine reset need** - Flag if changes require accumulation reset
5. **Enable persistence** - Serialize/restore for session management

## What ParameterStore Does NOT Do

- Make rendering decisions
- Update GPU uniforms directly
- Reset accumulation itself
- Create UI controls
- Load textures or resources

## Invariants

1. Parameter paths use dot notation (e.g., "camera.position")
2. Values are validated against metadata if present
3. Batch operations emit single change event
4. Silent restore doesn't trigger onChange
5. Reset determination based on path prefixes unless metadata specifies

## Integration

```
User Input → ParameterStore → onChange → Engine (uniforms)
                                      ↘ RenderCoordinator (reset)
```

The store is passive - it manages state and emits events. Other components decide what to do with those events.
