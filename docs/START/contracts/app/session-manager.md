# Session Manager Contract

## Purpose

The SessionManager enables reproducible research by saving and restoring complete system state. Every parameter, camera position, and render setting can be captured in a session file, allowing perfect recreation of any research result.

## Required Interface

```typescript
interface SessionManager {
  // Save/Load
  save(filepath: string): Promise<void>;
  load(filepath: string): Promise<void>;
  
  // State capture
  captureState(): SessionData;
  restoreState(data: SessionData): void;
  
  // Quick operations
  quickSave(): Promise<string>;
  getRecentSessions(): SessionMetadata[];
  
  // Validation
  validateSession(data: any): ValidationResult;
}
```

## Core Architecture

```typescript
class SessionManager {
  private app: ResearchApp;
  private lastSavePath?: string;
  private sessionHistory: SessionMetadata[] = [];
  
  constructor(app: ResearchApp) {
    this.app = app;
  }
}
```

## State Capture

```typescript
captureState(): SessionData {
  const state: SessionData = {
    version: SESSION_VERSION,
    timestamp: Date.now(),
    
    // Core state
    recipeName: this.app.getCurrentRecipe(),
    parameters: this.app.parameterStore.serialize(),
    
    // Render state
    renderMode: this.app.renderCoordinator.getMode(),
    accumulationCount: this.app.renderCoordinator.getAccumulationCount(),
    
    // Camera (from input extension if present)
    camera: this.captureCamera(),
    
    // Extension states
    extensions: this.captureExtensions(),
    
    // Metadata
    metadata: {
      engineVersion: ENGINE_VERSION,
      appVersion: APP_VERSION,
      rngSeed: this.app.parameterStore.get('math.seed') || Math.random()
    }
  };
  
  return state;
}

private captureCamera(): any {
  const input = this.app.getService('input');
  if (input && typeof input.getCamera === 'function') {
    return input.getCamera();
  }
  
  // Fallback to parameters
  return {
    position: this.app.parameterStore.get('camera.position'),
    fov: this.app.parameterStore.get('camera.fov')
  };
}

private captureExtensions(): Record<string, any> {
  const states: Record<string, any> = {};
  
  for (const [name, extension] of this.app.extensions) {
    if (typeof extension.saveState === 'function') {
      try {
        states[name] = extension.saveState();
      } catch (error) {
        console.warn(`Failed to save state for extension '${name}':`, error);
      }
    }
  }
  
  return states;
}
```

## State Restoration

```typescript
restoreState(data: SessionData): void {
  // Validate version compatibility
  if (!this.isCompatibleVersion(data.version)) {
    throw new Error(`Incompatible session version: ${data.version}`);
  }
  
  // Switch to saved recipe
  this.app.switchRecipe(data.recipeName);
  
  // Restore parameters (silent to avoid triggering onChange)
  const params = typeof data.parameters === 'string' 
    ? JSON.parse(data.parameters) 
    : data.parameters;
  this.app.parameterStore.restore(params);
  
  // Restore render mode
  if (data.renderMode) {
    this.app.renderCoordinator.setMode(data.renderMode);
  }
  
  // Restore camera
  if (data.camera) {
    const input = this.app.getService('input');
    if (input && typeof input.setCamera === 'function') {
      input.setCamera(data.camera);
    } else {
      // Fallback to parameters
      this.app.parameterStore.batch({
        'camera.position': data.camera.position,
        'camera.fov': data.camera.fov
      });
    }
  }

    // Restore RNG seed if present
    if (data.metadata?.rngSeed !== undefined) {
        this.app.parameterStore.set('math.seed', data.metadata.rngSeed, 'session');
    }
  
  // Restore extension states
  if (data.extensions) {
    for (const [name, state] of Object.entries(data.extensions)) {
      const extension = this.app.extensions.get(name);
      if (extension && typeof extension.restoreState === 'function') {
        try {
          extension.restoreState(state);
        } catch (error) {
          console.warn(`Failed to restore state for extension '${name}':`, error);
        }
      }
    }
  }
  
  // Emit event
  this.app.bus.emit('session.loaded', { 
    path: data.metadata?.filename,
    timestamp: data.timestamp 
  });
}
```

## File Operations

```typescript
async save(filepath: string): Promise<void> {
  const state = this.captureState();
  
  // Add filepath to metadata
  state.metadata = {
    ...state.metadata,
    filename: filepath
  };
  
  const json = JSON.stringify(state, null, 2);
  
  // Save based on environment
  if (typeof window !== 'undefined') {
    // Browser: trigger download
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filepath;
    a.click();
    URL.revokeObjectURL(url);
  } else {
    // Node.js environment
    const fs = await import('fs/promises');
    await fs.writeFile(filepath, json, 'utf8');
  }
  
  this.lastSavePath = filepath;
  this.addToHistory(filepath, state);
  
  this.app.bus.emit('session.saved', { path: filepath });
}

async load(filepath: string): Promise<void> {
  let json: string;
  
  // Load based on environment
  if (typeof window !== 'undefined') {
    // Browser: use file input or fetch
    const response = await fetch(filepath);
    json = await response.text();
  } else {
    // Node.js
    const fs = await import('fs/promises');
    json = await fs.readFile(filepath, 'utf8');
  }
  
  const data = JSON.parse(json);
  
  // Validate before restoring
  const validation = this.validateSession(data);
  if (!validation.valid) {
    throw new Error(`Invalid session: ${validation.errors?.join(', ')}`);
  }
  
  this.restoreState(data);
}
```

## Quick Save

```typescript
quickSave(): Promise<string> {
  // Generate timestamp-based filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `session-${timestamp}.json`;
  
  return this.save(filename).then(() => filename);
}
```

## Validation

```typescript
validateSession(data: any): ValidationResult {
  const errors: string[] = [];
  
  if (!data.version) {
    errors.push('Missing version');
  }
  
  if (!data.recipeName) {
    errors.push('Missing recipe name');
  }
  
  if (!data.parameters) {
    errors.push('Missing parameters');
  }
  
  if (!this.app.recipes.recipes[data.recipeName]) {
    errors.push(`Unknown recipe: ${data.recipeName}`);
  }
  
  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined
  };
}

private isCompatibleVersion(version: string): boolean {
  // Simple major version check
  const [major] = version.split('.');
  const [currentMajor] = SESSION_VERSION.split('.');
  return major === currentMajor;
}
```

## Usage Example

```typescript
const app = new ResearchApp(canvas, config);
const session = app.sessionManager;

// Save current state
await session.save('glass-caustics-study.json');

// Quick save with auto-generated name
const filename = await session.quickSave();
console.log(`Saved as ${filename}`);

// Load previous session
await session.load('yesterday-final.json');

// Manual state capture/restore
const state = session.captureState();
// ... do experiments ...
session.restoreState(state);  // Return to saved state

// Get recent sessions
const recent = session.getRecentSessions();
console.log('Recent sessions:', recent.map(s => s.filename));
```

## Key Responsibilities

1. **Capture complete state** - All parameters, settings, camera, extensions
2. **Restore perfectly** - Exact recreation of saved state
3. **Handle versions** - Check compatibility, migrate if needed
4. **Support extensions** - Save/restore extension-specific state
5. **Abstract file I/O** - Work in browser and Node.js

## What SessionManager Does NOT Do

- Render pixels
- Manage parameters directly
- Control rendering execution
- Create UI for file selection
- Auto-save (extension could add this)

## Session Data Structure

```typescript
interface SessionData {
  version: string;                  // Format version
  timestamp: number;                // When saved
  
  // Core state
  recipeName: string;               // Active recipe
  parameters: string | Record<string, any>;  // All parameters
  
  // Render state  
  renderMode?: RenderMode;          // Current mode
  accumulationCount?: number;       // Samples so far
  
  // Camera
  camera?: {
    position?: vec3;
    rotation?: vec3;
    fov?: number;
  };
  
  // Extensions
  extensions?: Record<string, any>; // Extension states
  
  // Metadata
  metadata?: {
    filename?: string;
    notes?: string;
    thumbnail?: string;            // Base64 preview
    engineVersion?: string;
    appVersion?: string;
  };
}
```

## Invariants

1. Session version checked before restore
2. Recipe must exist before switching
3. Parameters restored silently (no onChange)
4. Extension states optional (graceful failure)
5. Camera restoration falls back to parameters
6. File I/O abstracted for environment

## Integration

```
SessionManager.save()
    ↓
captureState()
    ├→ app.getCurrentRecipe()
    ├→ parameterStore.serialize()
    ├→ renderCoordinator.getAccumulationCount()
    ├→ inputExtension.getCamera()
    └→ extensions[].saveState()
    
SessionManager.load()
    ↓
restoreState()
    ├→ app.switchRecipe()
    ├→ parameterStore.restore()
    ├→ renderCoordinator.setMode()
    ├→ inputExtension.setCamera()
    └→ extensions[].restoreState()
```

The SessionManager provides reproducibility - any research result can be perfectly recreated from a session file.
