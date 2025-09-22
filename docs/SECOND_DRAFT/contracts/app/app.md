# Research App Contract

## Purpose

ResearchApp is the main orchestrator that wires together Engine, ParameterStore, RenderCoordinator, and SessionManager into a working research tool. It defines 2-3 recipes upfront, manages extensions through a service registry, and provides the minimal API needed for path tracing research.

## Required Interface

```typescript
interface ResearchApp {
  // Core components (public for extension access)
  engine: Engine;
  parameterStore: ParameterStore;
  renderCoordinator: RenderCoordinator;
  sessionManager: SessionManager;
  
  // Extension system
  use(extension: Extension): ResearchApp;
  registerService(name: string, service: any): void;
  getService(name: string): any;
  
  // Recipe management
  switchRecipe(name: string): void;
  getCurrentRecipe(): string;
  
  // Lifecycle
  initialize(): void;
  quickStart(recipeName?: string): void;
  dispose(): void;
}
```

## Core Architecture

```typescript
class ResearchApp {
  // Core components
  engine: Engine;
  parameterStore: ParameterStore;
  renderCoordinator: RenderCoordinator;
  sessionManager: SessionManager;
  
  // Extension system
  private extensions = new Map<string, Extension>();
  private services = new Map<string, any>();
  private bus: EventBus;
  
  // Configuration
  private recipes: RecipeBundle;
  private activeRecipeName: string;
  
  constructor(canvas: HTMLCanvasElement, config: AppConfig) {
    this.recipes = config.recipes;
    
    // Create core components
    this.engine = new Engine(canvas.getContext('webgl2')!);
    this.parameterStore = new ParameterStore();
    this.renderCoordinator = new RenderCoordinator(this.engine);
    this.sessionManager = new SessionManager(this);
    this.bus = new SimpleEventBus();
    
    // Wire core flow
    this.setupCoreFlow();
    
    // Initialize with recipes
    this.initialize();
  }
}
```

## Initialization

The app compiles all recipes eagerly at startup:

```typescript
initialize(): void {
  // Extract all recipes for compilation
  const recipeList = Object.values(this.recipes.recipes);
  
  // Compile all shaders upfront (takes ~1-2 seconds)
  this.engine.initialize(recipeList);
  
  // Register parameter metadata from first recipe
  this.registerRecipeParameters(this.recipes.defaultRecipe);
  
  // Set default recipe
  this.activeRecipeName = this.recipes.defaultRecipe;
  this.engine.selectRecipe(this.recipes.recipes[this.activeRecipeName]);
}

private registerRecipeParameters(recipeName: string): void {
  const recipe = this.recipes.recipes[recipeName];
  
  // Register common parameters
  this.parameterStore.registerMetadata('camera.position', {
    type: 'vec3',
    default: [0, 0, 5],
    triggersReset: true
  });
  
  this.parameterStore.registerMetadata('camera.fov', {
    type: 'float',
    min: 10,
    max: 170,
    default: 60,
    triggersReset: true
  });
  
  // Recipe-specific parameters would be registered here
  // based on the modules in the recipe
}
```

## Core Flow Wiring

The critical rendering path uses direct references:

```typescript
private setupCoreFlow(): void {
  // Direct parameter -> engine flow
  this.parameterStore.onChange = (changes) => {
    // Update uniforms
    for (const change of changes.changes) {
      this.engine.updateUniform(change.path, change.newValue);
    }
    
    // Check reset need
    const needsReset = changes.changes.some(
      c => this.renderCoordinator.shouldResetForParameter(c.path)
    );
    
    if (needsReset) {
      this.renderCoordinator.resetAccumulation();
    }
  };
  
  // Progress reporting
  this.renderCoordinator.onProgress = (info) => {
    this.bus.emit('render.progress', info);
  };
}
```

## Recipe Management

```typescript
switchRecipe(name: string): void {
  if (!this.recipes.recipes[name]) {
    throw new Error(`Unknown recipe: ${name}`);
  }
  
  // Switch is instant (pre-compiled)
  this.activeRecipeName = name;
  this.engine.selectRecipe(this.recipes.recipes[name]);
  
  // Always reset when switching recipes
  this.renderCoordinator.resetAccumulation();
  
  // Notify extensions
  this.bus.emit('recipe.switched', { name, recipe: this.recipes.recipes[name] });
}

getCurrentRecipe(): string {
  return this.activeRecipeName;
}
```

## Extension System

```typescript
use(extension: Extension): ResearchApp {
  // Check dependencies
  for (const dep of extension.dependencies || []) {
    if (!this.extensions.has(dep)) {
      throw new Error(`Extension '${extension.name}' requires '${dep}'`);
    }
  }
  
  // Install extension
  try {
    extension.install(this, this.bus);
    this.extensions.set(extension.name, extension);
    this.bus.emit('extension.installed', { name: extension.name });
  } catch (error) {
    console.error(`Failed to install extension '${extension.name}':`, error);
    throw error;
  }
  
  return this; // For chaining
}

registerService(name: string, service: any): void {
  if (this.services.has(name)) {
    console.warn(`Service '${name}' already registered, replacing`);
  }
  this.services.set(name, service);
  this.bus.emit('service.registered', { name });
}

getService(name: string): any {
  return this.services.get(name);
}
```

## Quick Start

```typescript
quickStart(recipeName?: string): void {
  // Use specified recipe or default
  const recipe = recipeName || this.recipes.defaultRecipe;
  this.switchRecipe(recipe);
  
  // Start progressive rendering
  this.renderCoordinator.setMode('progressive');
  this.renderCoordinator.start();
}
```

## Usage Example

```typescript
// Define recipes upfront
const config: AppConfig = {
  canvas,
  recipes: {
    recipes: {
      'pathtracer': {
        id: 'pathtracer',
        name: 'Path Tracer',
        world: {
          geometry: { kind: 'geometry', name: 'euclidean' },
          material: { kind: 'material', name: 'disney' },
          scene: { kind: 'scene', name: 'sdf' },
          lights: { kind: 'lights', name: 'hdri' }
        },
        photography: {
          camera: { kind: 'camera', name: 'pinhole' },
          estimator: { kind: 'estimator', name: 'pathtracer' },
          film: { kind: 'film', name: 'variance' },
          developer: { kind: 'developer', name: 'aces' }
        }
      },
      'debug': {
        // Debug recipe configuration
      }
    },
    defaultRecipe: 'pathtracer'
  }
};

// Create app
const app = new ResearchApp(canvas, config);

// Minimal start
app.quickStart();

// Add extensions as needed
app.use(new InputExtension())
   .use(new UIExtension())
   .use(new ExperimentExtension());

// Access services
const input = app.getService('input');
input?.setMode('orbit');

// Change parameters
app.parameterStore.set('material.roughness', 0.3);

// Switch recipes (instant)
app.switchRecipe('debug');

// Access core components directly when needed
app.renderCoordinator.setMode('production');
app.sessionManager.save('experiment.json');
```

## Key Responsibilities

1. **Initialize system** - Create core components, compile recipes
2. **Wire core flow** - Connect parameters → engine → coordinator
3. **Manage recipes** - Switch between pre-compiled configurations
4. **Host extensions** - Install, track, provide service registry
5. **Provide access** - Expose core components for extensions

## What ResearchApp Does NOT Do

- Render frames (Engine does)
- Manage parameters (ParameterStore does)
- Control execution (RenderCoordinator does)
- Create UI (Extensions do)
- Handle input (Extensions do)

## Extension Installation Protocol

```typescript
// Extension installation steps:
1. Check dependencies exist
2. Call extension.install(app, bus)
3. Extension registers itself as service: app.registerService('name', this)
4. Extension sets up listeners: bus.on('event', handler)
5. Extension adds UI/input handlers as needed
6. Store extension reference
7. Emit 'extension.installed' event
```

## Invariants

1. All recipes compiled at initialization
2. Recipe switching is synchronous (pre-compiled)
3. Extensions installed in dependency order
4. Service names are unique
5. Core components always accessible
6. Parameter changes flow through store
7. Only one recipe active at a time

## Integration

```
                    ResearchApp
                         |
        ┌────────────────┼────────────────┐
        ↓                ↓                ↓
   ParameterStore  RenderCoordinator   Engine
        |                |                |
        └────onChange────┴────→ updateUniforms
                         |
                         └────→ resetAccumulation

Extensions ←→ EventBus ←→ Other Extensions
     ↓
  Services Registry
```

The app orchestrates but doesn't implement - it wires components together and hosts extensions.
