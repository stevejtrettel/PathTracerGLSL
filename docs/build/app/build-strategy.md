# App Build Plan

## Purpose

A step-by-step guide to implementing the App pillar, showing build order, minimal implementations, integration points, and common pitfalls.

## Build Order

Build the App pillar in this sequence to minimize circular dependencies:

1. **ParameterStore** - Pure state management, no dependencies
2. **RenderCoordinator** - Depends on Engine interface only
3. **SessionManager** - Depends on app structure but loosely
4. **ResearchApp** - Wires everything together
5. **Extension System** - Adds features to working core

## Phase 1: ParameterStore

Start with the simplest component - pure state management:

```typescript
// Minimal implementation
class ParameterStore {
  private parameters = new Map<string, any>();
  private metadata = new Map<string, ParameterMetadata>();
  
  onChange: ((changes: ParameterChanges) => void) | null = null;
  
  set(path: string, value: any): void {
    const oldValue = this.parameters.get(path);
    if (this.shallowEqual(oldValue, value)) return;
    
    this.parameters.set(path, value);
    
    this.onChange?.({
      changes: [{ path, oldValue, newValue: value }],
      triggersReset: path.startsWith('camera.') || path.startsWith('material.')
    });
  }
  
  get(path: string): any {
    return this.parameters.get(path);
  }
  
  private shallowEqual(a: any, b: any): boolean {
    return JSON.stringify(a) === JSON.stringify(b);  // Simple for now
  }
}

// Test it
const store = new ParameterStore();
store.onChange = (changes) => console.log('Changed:', changes);
store.set('camera.fov', 60);
store.set('camera.fov', 60);  // Should not trigger
store.set('camera.fov', 45);  // Should trigger
```

## Phase 2: RenderCoordinator

Build execution control with a mock Engine:

```typescript
// Mock engine for testing
class MockEngine {
  renderFrame(): void { console.log('Render frame'); }
  clearFilm(): void { console.log('Clear film'); }
}

// Minimal coordinator
class RenderCoordinator {
  private engine: any;  // Will be Engine type
  private mode: RenderMode = 'progressive';
  private running = false;
  private accumulator = { count: 0 };
  
  constructor(engine: any) {
    this.engine = engine;
  }
  
  start(): void {
    if (this.running) return;
    this.running = true;
    this.runLoop();
  }
  
  stop(): void {
    this.running = false;
  }
  
  private runLoop(): void {
    if (!this.running) return;
    
    this.engine.renderFrame();
    this.accumulator.count++;
    
    if (this.mode === 'progressive') {
      requestAnimationFrame(() => this.runLoop());
    }
  }
  
  resetAccumulation(): void {
    this.accumulator.count = 0;
    this.engine.clearFilm();
  }
  
  shouldResetForParameter(path: string): boolean {
    return !path.startsWith('developer.');
  }
}

// Test it
const engine = new MockEngine();
const coordinator = new RenderCoordinator(engine);
coordinator.start();
setTimeout(() => coordinator.stop(), 100);
```

## Phase 3: Wire Store to Coordinator

Connect parameter changes to render resets:

```typescript
// Wire them together
const store = new ParameterStore();
const coordinator = new RenderCoordinator(engine);

store.onChange = (changes) => {
  // Check if reset needed
  const needsReset = changes.changes.some(
    c => coordinator.shouldResetForParameter(c.path)
  );
  
  if (needsReset) {
    coordinator.resetAccumulation();
  }
};

// Test the flow
store.set('camera.position', [0, 0, 5]);  // Should reset
store.set('developer.exposure', 1.0);     // Should not reset
```

## Phase 4: Basic ResearchApp

Create minimal app with recipes:

```typescript
class ResearchApp {
  engine: any;  // Will be Engine type
  parameterStore: ParameterStore;
  renderCoordinator: RenderCoordinator;
  sessionManager: any;  // Will implement later
  
  private extensions = new Map<string, Extension>();
  private services = new Map<string, any>();
  private bus = new SimpleEventBus();
  
  private recipes: RecipeBundle;
  private activeRecipeName: string;
  
  constructor(canvas: HTMLCanvasElement, config: AppConfig) {
    this.recipes = config.recipes;
    
    // Create mock engine for now
    this.engine = new MockEngine();
    
    // Create real components
    this.parameterStore = new ParameterStore();
    this.renderCoordinator = new RenderCoordinator(this.engine);
    
    // Wire core flow
    this.parameterStore.onChange = (changes) => {
      // In real version: this.engine.updateUniforms(changes);
      console.log('Would update uniforms:', changes);
      
      const needsReset = changes.changes.some(
        c => this.renderCoordinator.shouldResetForParameter(c.path)
      );
      
      if (needsReset) {
        this.renderCoordinator.resetAccumulation();
      }
    };
    
    this.activeRecipeName = config.recipes.defaultRecipe;
  }
  
  switchRecipe(name: string): void {
    if (!this.recipes.recipes[name]) {
      throw new Error(`Unknown recipe: ${name}`);
    }
    this.activeRecipeName = name;
    // In real version: this.engine.selectRecipe(this.recipes.recipes[name]);
    this.renderCoordinator.resetAccumulation();
  }
  
  use(extension: Extension): ResearchApp {
    extension.install(this, this.bus);
    this.extensions.set(extension.name, extension);
    return this;
  }
  
  registerService(name: string, service: any): void {
    this.services.set(name, service);
  }
  
  getService(name: string): any {
    return this.services.get(name);
  }
}

// Test it
const config: AppConfig = {
  canvas: document.getElementById('canvas') as HTMLCanvasElement,
  recipes: {
    recipes: {
      'pathtracer': { /* recipe */ },
      'debug': { /* recipe */ }
    },
    defaultRecipe: 'pathtracer'
  }
};

const app = new ResearchApp(canvas, config);
app.parameterStore.set('camera.fov', 60);
app.switchRecipe('debug');
```

## Phase 5: Simple Event Bus

Implement minimal event system:

```typescript
class SimpleEventBus {
  private listeners = new Map<string, Set<Function>>();
  
  on(event: string, handler: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }
  
  off(event: string, handler: Function): void {
    this.listeners.get(event)?.delete(handler);
  }
  
  emit(event: string, data?: any): void {
    this.listeners.get(event)?.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in event handler for ${event}:`, error);
      }
    });
  }
}
```

## Phase 6: Test Extension

Create a simple extension to verify the system:

```typescript
class TestExtension implements Extension {
  name = 'test';
  
  install(app: ResearchApp, bus: EventBus): void {
    console.log('Test extension installed');
    
    // Register as service
    app.registerService('test', this);
    
    // Listen to events
    bus.on('render.progress', (info) => {
      console.log('Progress:', info);
    });
    
    // Modify parameters
    app.parameterStore.set('test.value', 42);
  }
  
  doSomething(): void {
    console.log('Test service method called');
  }
}

// Use it
app.use(new TestExtension());
const test = app.getService('test');
test?.doSomething();
```

## Phase 7: Engine Integration

Replace MockEngine with real Engine:

```typescript
class ResearchApp {
  constructor(canvas: HTMLCanvasElement, config: AppConfig) {
    // Get real WebGL context
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not supported');
    
    // Create real engine
    this.engine = new Engine(gl);
    
    // Initialize with recipes (eager compilation)
    const recipeList = Object.values(config.recipes.recipes);
    this.engine.initialize(recipeList);
    
    // Rest of initialization...
  }
}
```

## Phase 8: SessionManager

Add save/load capability:

```typescript
class SessionManager {
  constructor(private app: ResearchApp) {}
  
  captureState(): SessionData {
    return {
      version: '1.0.0',
      timestamp: Date.now(),
      recipeName: this.app.activeRecipeName,
      parameters: Object.fromEntries(this.app.parameterStore.parameters)
    };
  }
  
  restoreState(data: SessionData): void {
    this.app.switchRecipe(data.recipeName);
    this.app.parameterStore.restore(data.parameters);
  }
}
```

## Testing Strategy

Test each component in isolation before integration:

```typescript
// 1. Test ParameterStore alone
function testParameterStore() {
  const store = new ParameterStore();
  assert(store.get('test') === undefined);
  store.set('test', 42);
  assert(store.get('test') === 42);
}

// 2. Test RenderCoordinator with mock
function testRenderCoordinator() {
  const mockEngine = { 
    renderFrame: jest.fn(), 
    clearFilm: jest.fn() 
  };
  const coordinator = new RenderCoordinator(mockEngine);
  coordinator.start();
  // Check mockEngine.renderFrame was called
}

// 3. Test integration
function testIntegration() {
  const app = new ResearchApp(canvas, config);
  const callCount = trackEngineCalls(app.engine);
  app.parameterStore.set('camera.fov', 45);
  assert(callCount.clearFilm === 1);
}
```

## Common Pitfalls

1. **Circular dependencies** - Build in order to avoid
2. **Missing null checks** - Services might not exist
3. **Event handler leaks** - Always remove listeners in uninstall
4. **Synchronous restore** - Don't trigger onChange during restore
5. **Recipe validation** - Check recipe exists before switching

## Minimal Working App

Complete minimal implementation (~200 lines):

```typescript
// Complete minimal app
const app = new ResearchApp(canvas, {
  recipes: {
    recipes: {
      'pathtracer': { /* minimal recipe */ }
    },
    defaultRecipe: 'pathtracer'
  }
});

// Start rendering
app.renderCoordinator.start();

// Change a parameter
app.parameterStore.set('camera.fov', 45);

// That's it! Everything else is extensions
```

## Next Steps

After core is working:
1. Add InputExtension for camera control
2. Add UIExtension for parameter editing
3. Add ExportExtension for saving images
4. Build experiment tools as needed

Remember: The core stays minimal. Everything else is an extension.
