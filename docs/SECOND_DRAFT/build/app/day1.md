# Day 1 - Minimal App Build

## Goal

Get pixels on screen with the absolute minimum App orchestration. No extensions, no UI, no persistence - just the core parameter→uniform→render flow working.

## What We're Building

```
ParameterStore (holds values)
    ↓
ResearchApp (wires things)
    ↓
Engine (renders frames)
```

That's it. No RenderCoordinator, no SessionManager, no extensions.

## Prerequisites

You need minimal versions of:
- Engine that can compile one shader and render frames
- One module from each category (geometry, material, scene, lights, camera, estimator, film, developer)
- A canvas element

## Step 1: Minimal ParameterStore

Just store and notify. No validation, no metadata.

```typescript
class ParameterStore {
  private parameters = new Map<string, any>();
  onChange: ((changes: any) => void) | null = null;
  
  set(path: string, value: any): void {
    const oldValue = this.parameters.get(path);
    this.parameters.set(path, value);
    
    if (this.onChange) {
      this.onChange({
        changes: [{ path, oldValue, newValue: value }]
      });
    }
  }
  
  get(path: string): any {
    return this.parameters.get(path);
  }
}
```

## Step 2: Minimal ResearchApp

Just wiring, no extensions or fancy features.

```typescript
class ResearchApp {
  engine: any;  // Your minimal engine
  parameterStore: ParameterStore;
  
  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('Need WebGL2');
    
    // Hardcode one recipe for now
    const recipe = {
      world: {
        geometry: { kind: 'geometry', name: 'euclidean' },
        material: { kind: 'material', name: 'lambert' },
        scene: { kind: 'scene', name: 'sphere' },
        lights: { kind: 'lights', name: 'point' }
      },
      photography: {
        camera: { kind: 'camera', name: 'pinhole' },
        estimator: { kind: 'estimator', name: 'simple' },
        film: { kind: 'film', name: 'average' },
        developer: { kind: 'developer', name: 'linear' }
      }
    };
    
    this.engine = new Engine(gl);
    this.engine.initialize([recipe]);  // Just one recipe
    this.engine.selectRecipe(recipe);
    
    this.parameterStore = new ParameterStore();
    
    // Wire the critical path
    this.parameterStore.onChange = (changes) => {
      for (const change of changes.changes) {
        this.engine.updateUniform(change.path, change.newValue);
      }
    };
    
    // Set minimal parameters
    this.parameterStore.set('camera.position', [0, 0, 5]);
    this.parameterStore.set('camera.fov', 60);
  }
  
  renderFrame(): void {
    this.engine.renderFrame();
  }
}
```

## Step 3: Manual Render Loop

No RenderCoordinator yet, just prove it works:

```typescript
const app = new ResearchApp(canvas);

function animate() {
  app.renderFrame();
  requestAnimationFrame(animate);
}
animate();

// Test parameter changes
app.parameterStore.set('camera.position', [0, 0, 10]);
```

## Step 4: Add Accumulation Reset

Once basic rendering works, add reset logic:

```typescript
class ResearchApp {
  private needsReset = false;
  
  constructor(canvas: HTMLCanvasElement) {
    // ... previous code ...
    
    this.parameterStore.onChange = (changes) => {
      for (const change of changes.changes) {
        this.engine.updateUniform(change.path, change.newValue);
        
        // Super simple reset logic
        if (change.path.startsWith('camera.') || 
            change.path.startsWith('material.')) {
          this.needsReset = true;
        }
      }
    };
  }
  
  renderFrame(): void {
    if (this.needsReset) {
      this.engine.clearFilm();
      this.needsReset = false;
    }
    this.engine.renderFrame();
  }
}
```

## Step 5: Test the Flow

Create a simple test to verify everything connects:

```html
<canvas id="canvas" width="512" height="512"></canvas>
<script>
  const canvas = document.getElementById('canvas');
  const app = new ResearchApp(canvas);
  
  // Start rendering
  function animate() {
    app.renderFrame();
    requestAnimationFrame(animate);
  }
  animate();
  
  // Test parameter updates
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') {
      const pos = app.parameterStore.get('camera.position');
      pos[2] -= 0.5;
      app.parameterStore.set('camera.position', pos);
    }
  });
</script>
```

## What This Proves

1. Parameters flow to uniforms
2. Changes trigger updates
3. Engine receives correct data
4. Basic reset logic works
5. The architecture is sound

## What's Missing (Intentionally)

- RenderCoordinator (just calling renderFrame directly)
- SessionManager (no save/load)
- Extensions (no features)
- Event bus (no events)
- Validation (trust the user)
- Multiple recipes (just one)
- Render modes (always progressive)
- Error handling (let it crash)

## Next Steps (Day 2)

Once pixels are rendering:

1. Add RenderCoordinator for proper accumulation tracking
2. Add batch parameter updates
3. Add parameter validation
4. Add second recipe to test switching

## Common Day 1 Problems

**Nothing renders**: Check that uniforms names match between parameters and shaders.

**Updates don't work**: Log in onChange to verify it's being called.

**Reset always happens**: Check your prefix logic.

**WebGL errors**: The Engine isn't setting up WebGL correctly.

## The Critical Test

You know Day 1 is successful when:
1. You see an image
2. Changing a parameter updates the image
3. Camera parameters cause accumulation reset
4. Developer parameters don't cause reset

That's it. Everything else is Day 2+.
