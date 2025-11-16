# App Layer

The **App Layer** manages application state, user interactions, and extensions. It sits between user-facing features and the rendering engine.

## Overview

The app layer provides:
- Centralized parameter state (`ParameterStore`)
- Event-driven communication (`EventBus`)
- Application lifecycle management (`App`)
- Extension system for modular features
- Multi-recipe session management

**Key Principle**: The app layer knows nothing about WebGL or GPU details. It only manages state and coordinates between components.

---

## Core Components

### App (`App.ts`)

The main application orchestrator.

**Responsibilities**:
- Initialize engine with recipes
- Manage parameter store
- Coordinate extensions
- Handle render loop
- Load resources (HDR environments)
- Recipe switching

**Lifecycle**:
```typescript
const app = new App(canvas);

// 1. Initialize
await app.initialize(recipes);

// 2. Add extensions
app.addExtension(new OrbitControls(canvas));
app.addExtension(new ParameterPanelExtension());

// 3. Start rendering
app.start();

// 4. (Later) Clean up
app.dispose();
```

### ParameterStore (`ParameterStore.ts`)

Centralized state management for all parameters.

**Responsibilities**:
- Store parameter values
- Track parameter changes
- Validate parameter types
- Emit change events

**Usage**:
```typescript
// Set parameter
app.setParameter('camera.fov', 60);

// Get parameter
const fov = app.getParameter('camera.fov');

// Set multiple parameters
app.setParameters({
    'camera.position': [1, 2, 5],
    'light.intensity': 30
});

// Get all parameters
const allParams = app.getParameters();
```

### EventBus (`EventBus.ts`)

Event-driven communication between components.

**Responsibilities**:
- Register event listeners
- Emit events
- Unsubscribe listeners

**Events**:
- `parameters:changed` - Parameters updated
- `recipe:changed` - Active recipe switched
- `render:frame` - Frame rendered
- `accumulation:reset` - Accumulation cleared

**Usage**:
```typescript
// Subscribe
const unsubscribe = app.on('parameters:changed', (changes) => {
    console.log('Parameters changed:', changes);
});

// Unsubscribe
unsubscribe();

// Emit (extensions use this)
app.emit('custom:event', data);
```

### SessionManager (`SessionManager.ts`)

Manages multi-recipe sessions.

**Responsibilities**:
- Track available recipes
- Manage active recipe
- Coordinate recipe switching

**Usage**:
```typescript
// Get available recipes
const recipes = app.getAvailableRecipes();
// ['pathtracer', 'albedo', 'normals']

// Switch recipe
app.selectRecipe('albedo');

// Get active recipe
const active = app.getActiveRecipe();
```

---

## Extension System

Extensions add modular functionality without modifying core code.

### Extension Interface

```typescript
interface Extension {
    name: string;
    initialize?(context: ExtensionContext): void;
    update?(delta: number): void;
    dispose?(): void;
}

interface ExtensionContext {
    app: App;
    canvas: HTMLCanvasElement;
    engine: Engine;
    bus: EventBus;
}
```

### Available Extensions

**Controls**:
- `OrbitControls` - Mouse orbit camera
- `TouchOrbitControls` - Touch orbit camera
- `KeyboardControls` - Keyboard navigation

**UI**:
- `ParameterPanelExtension` - UI controls for parameters
- `StatsPanelExtension` - FPS/performance stats

**Export**:
- `ScreenshotExtension` - PNG/JPEG screenshots
- `HDRExportExtension` - EXR export (float)
- `ProductionRenderExtension` - High-quality offline rendering

### Creating Extensions

See [Extensions Guide](extensions.md) for detailed documentation.

**Basic example**:
```typescript
class MyExtension implements Extension {
    name = 'my-extension';

    initialize(context: ExtensionContext) {
        // Setup
        context.bus.on('parameters:changed', this.onParamsChanged);
    }

    update(delta: number) {
        // Called each frame
    }

    dispose() {
        // Cleanup
    }

    private onParamsChanged(changes: ParameterChanges) {
        // Handle parameter changes
    }
}

app.addExtension(new MyExtension());
```

---

## Parameter System

### Parameter Paths

Parameters use dot-notation paths:

```
<group>.<property>
```

Examples:
- `camera.position` → `[1, 2, 5]`
- `camera.fov` → `60`
- `light.intensity` → `30.0`
- `developer.exposureEV` → `0`

### Parameter Flow

```
User Input (Extension)
  ↓
ParameterStore.set(path, value)
  ↓
Validate type
  ↓
Compute changes (prev vs next)
  ↓
EventBus.emit('parameters:changed', changes)
  ↓
App receives event
  ↓
Engine.updateParameters(changes)
  ↓
ParameterManager computes uniforms
  ↓
WebGL uniform updates
```

### Parameter Changes

```typescript
type ParameterChanges = Record<string, {
    prev: any;
    next: any;
}>;

// Example
{
    'camera.fov': { prev: 60, next: 45 },
    'light.intensity': { prev: 10, next: 15 }
}
```

### Metadata

Modules define parameter metadata:

```typescript
parameters: {
    'camera.fov': {
        type: 'float',
        default: 60,
        range: [10, 120],
        step: 1,
        name: 'Field of View',
        unit: '°',
        group: 'Camera',
        triggersReset: true
    }
}
```

The app layer uses this to:
- Initialize default values
- Validate input ranges
- Generate UI controls
- Determine if accumulation should reset

---

## Application Lifecycle

### Initialization

```typescript
async initialize(recipes: Recipe[]): Promise<void> {
    // 1. Create engine
    this.engine = new Engine(this.gl);

    // 2. Initialize parameter store
    this.parameters = new ParameterStore();
    this.extractParametersFromRecipes(recipes);

    // 3. Initialize engine
    this.engine.initialize(recipes);

    // 4. Setup event listeners
    this.bus.on('parameters:changed', this.onParametersChanged);

    // 5. Initialize extensions
    for (const ext of this.extensions) {
        ext.initialize?.({
            app: this,
            canvas: this.canvas,
            engine: this.engine,
            bus: this.bus
        });
    }
}
```

### Render Loop

```typescript
start(): void {
    this.running = true;
    this.lastTime = performance.now();

    const loop = (time: number) => {
        if (!this.running) return;

        const delta = (time - this.lastTime) / 1000;
        this.lastTime = time;

        // Update extensions
        for (const ext of this.extensions) {
            ext.update?.(delta);
        }

        // Render frame
        this.engine.renderFrame();

        // Emit event
        this.bus.emit('render:frame', { time, delta });

        requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
}
```

### Cleanup

```typescript
dispose(): void {
    this.running = false;

    // Dispose extensions
    for (const ext of this.extensions) {
        ext.dispose?.();
    }

    // Dispose engine
    this.engine.dispose();

    // Clear event listeners
    this.bus.clear();
}
```

---

## Event System

### Built-in Events

**`parameters:changed`**
```typescript
app.on('parameters:changed', (changes: ParameterChanges) => {
    // Handle parameter updates
});
```

**`recipe:changed`**
```typescript
app.on('recipe:changed', (recipeId: string) => {
    // Handle recipe switch
});
```

**`render:frame`**
```typescript
app.on('render:frame', ({ time, delta }) => {
    // Called every frame
});
```

**`accumulation:reset`**
```typescript
app.on('accumulation:reset', () => {
    // Accumulation was cleared
});
```

### Custom Events

Extensions can define custom events:

```typescript
// Extension emits
context.bus.emit('screenshot:captured', { data, width, height });

// Other code subscribes
app.on('screenshot:captured', ({ data, width, height }) => {
    saveImage(data, width, height);
});
```

---

## Multi-Recipe Support

### Recipe Management

```typescript
// Initialize with multiple recipes
await app.initialize([
    pathTracerRecipe,
    albedoRecipe,
    normalsRecipe
]);

// List available recipes
const recipes = app.getAvailableRecipes();

// Switch recipe
app.selectRecipe('albedo');

// Get current recipe
const active = app.getActiveRecipe();
```

### Recipe-Specific State

Each recipe maintains:
- Its own shader programs
- Its own accumulation buffers
- Its own sample count

When switching recipes:
- Sample count preserved per recipe
- Instant switching (no recompilation)
- Parameters update if needed

---

## Resource Loading

### HDR Environment Maps

```typescript
await app.loadEnvironmentHDR('/hdri/studio.hdr');
// - Validates file
// - Creates textures
// - Builds importance sampling CDFs
// - Binds to all recipes
```

### Error Handling

```typescript
try {
    await app.loadEnvironmentHDR('/missing.hdr');
} catch (error) {
    console.error('Failed to load HDR:', error.message);
    // Detailed errors logged to console
}
```

---

## API Quick Reference

### App

```typescript
initialize(recipes: Recipe[]): Promise<void>
start(): void
stop(): void
dispose(): void

setParameter(path: string, value: any): void
getParameter(path: string): any
setParameters(params: Record<string, any>): void
getParameters(): Record<string, any>

selectRecipe(id: string): void
getAvailableRecipes(): string[]
getActiveRecipe(): string | null

loadEnvironmentHDR(path: string): Promise<void>

addExtension(extension: Extension): void
on(event: string, callback: Function): () => void
emit(event: string, data?: any): void
```

### ParameterStore

```typescript
set(path: string, value: any): void
get(path: string): any
getAll(): Record<string, any>
has(path: string): boolean
delete(path: string): void
```

### EventBus

```typescript
on(event: string, callback: Function): () => void
once(event: string, callback: Function): () => void
off(event: string, callback?: Function): void
emit(event: string, data?: any): void
clear(): void
```

---

## Further Reading

- [Parameter System](parameter-system.md) - Detailed parameter documentation
- [Extensions](extensions.md) - Creating and using extensions
- [Event Bus](event-bus.md) - Event system details
- [Architecture](../architecture.md) - System overview
