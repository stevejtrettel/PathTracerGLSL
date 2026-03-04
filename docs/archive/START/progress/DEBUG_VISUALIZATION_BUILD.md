# Debug Visualization System - Build Document

## Overview

**Goal**: Add visual debugging for normals, depth, albedo, and light hits without impacting production render performance.

**Approach**: Separate debug recipe with simple transport module that outputs debug visualizations instead of path-traced radiance.

**Benefits**:
- Zero performance cost (debug code not in production recipes)
- Research modules stay clean (no debug pollution)
- Per-recipe accumulation preserved (switch back to pathtracer, keep samples)
- One debug module handles all visualization modes

---

## Architecture

### Current System
```
Recipe "pathtracer"
├─ world: scene, lighting, etc.
├─ optics.camera: pinhole
├─ optics.transport: pathtracer (full ray tracing)
├─ optics.accumulator: temporal
└─ optics.developer: reinhard

Recipe switches preserve accumulation per-recipe
```

### Adding Debug Recipe
```
Recipe "debug"
├─ world: SAME modules as pathtracer
├─ optics.camera: SAME as pathtracer
├─ optics.transport: debug-visualizer (NEW - simple output)
├─ optics.accumulator: SAME as pathtracer
└─ optics.developer: SAME as pathtracer

Parameter: 'debug.mode' controls which visualization
Extension: Keyboard shortcuts for quick switching
```

---

## Implementation Plan

### Part 1: Debug Transport Module (Core)

**File**: `modules/transport/debug-visualizer.ts`

```typescript
import { ModuleDescriptor } from '../../types';

export const debugVisualizerModule: ModuleDescriptor = {
  id: {
    kind: 'transport',
    name: 'debug-visualizer',
    version: '1.0.0'
  },
  
  fragment: {
    constants: `
      // Debug modes
      #define DEBUG_NORMALS 0
      #define DEBUG_DEPTH 1
      #define DEBUG_ALBEDO 2
      #define DEBUG_HIT_LIGHT 3
    `,
    
    uniforms: `
      uniform int u_debug_mode;
      uniform float u_debug_depthScale;  // For scaling depth visualization
    `,
    
    functions: `
      // Required export for transport modules
      vec3 transport_integrate(Ray ray, inout uint rngState) {
        // Intersect scene
        Hit hit = scene_intersect(ray);
        
        if (!hit.didHit) {
          // Miss - show environment or black
          if (u_debug_mode == DEBUG_NORMALS) return vec3(0.5); // Gray for miss
          if (u_debug_mode == DEBUG_DEPTH) return vec3(0.0);   // Black for infinite depth
          return vec3(0.0);
        }
        
        // Hit something - visualize based on mode
        if (u_debug_mode == DEBUG_NORMALS) {
          // Map [-1,1] to [0,1] for visualization
          return hit.normal * 0.5 + 0.5;
        }
        
        if (u_debug_mode == DEBUG_DEPTH) {
          // Visualize depth (scaled)
          float depth = hit.t / u_debug_depthScale;
          return vec3(depth);
        }
        
        if (u_debug_mode == DEBUG_ALBEDO) {
          // Get material albedo at hit point
          MaterialProperties props = scene_material_properties(hit);
          return props.albedo;
        }
        
        if (u_debug_mode == DEBUG_HIT_LIGHT) {
          // Shoot shadow ray to light
          // Green if we hit light, red if blocked
          vec3 lightPos = lighting_sample_position(rngState); // Assumes single light for now
          vec3 toLight = lightPos - hit.p;
          float lightDist = length(toLight);
          Ray shadowRay = Ray(hit.p + hit.normal * 0.001, normalize(toLight), 0.001, lightDist - 0.001);
          
          Hit shadowHit = scene_intersect(shadowRay);
          if (!shadowHit.didHit) {
            return vec3(0.0, 1.0, 0.0); // Green - can see light
          } else {
            return vec3(1.0, 0.0, 0.0); // Red - occluded
          }
        }
        
        // Default: magenta error color
        return vec3(1.0, 0.0, 1.0);
      }
    `
  },
  
  uniformBindings: [
    {
      uniform: 'u_debug_mode',
      parameters: ['debug.mode'],
      type: 'int',
      compute: (params) => params['debug.mode'] ?? 0
    },
    {
      uniform: 'u_debug_depthScale',
      parameters: ['debug.depthScale'],
      type: 'float',
      compute: (params) => params['debug.depthScale'] ?? 100.0
    }
  ],
  
  exports: ['transport_integrate']
};
```

**Notes**:
- Uses existing scene intersection (same geometry as pathtracer)
- Uses existing material properties (same materials as pathtracer)
- Shadow ray test assumes you have `lighting_sample_position()` - adjust if needed
- Depth scale parameter lets you tune visualization range

---

### Part 2: Debug Recipe

**File**: `recipes/debug-recipe.ts`

```typescript
import { Recipe } from '../types';
import { debugVisualizerModule } from '../modules/transport/debug-visualizer';

// Import your existing modules
import { euclideanModule } from '../modules/ambient/euclidean';
import { yourSceneModule } from '../modules/scene/your-scene';
import { yourLightingModule } from '../modules/lighting/your-lighting';
import { pinholeModule } from '../modules/camera/pinhole';
import { lambertModule } from '../modules/interaction/lambert'; // Won't be used, but required
import { simpleAccumulatorModule } from '../modules/accumulator/simple';
import { reinhardModule } from '../modules/developer/reinhard';

export const debugRecipe: Recipe = {
  id: 'debug',
  name: 'Debug Visualizer',
  description: 'Visual debugging: normals, depth, albedo, light visibility',
  
  world: {
    ambient: euclideanModule,        // Same geometry as pathtracer
    scene: yourSceneModule,           // Same scene as pathtracer
    lighting: yourLightingModule      // Same lights as pathtracer
  },
  
  optics: {
    camera: pinholeModule,            // Same camera as pathtracer
    interaction: lambertModule,       // Required but not used
    transport: debugVisualizerModule, // NEW - debug output
    accumulator: simpleAccumulatorModule,
    developer: reinhardModule         // Or passthrough
  }
};
```

**Key**: Use the SAME world modules as your main pathtracer recipe. This ensures you're debugging the actual geometry/scene you're rendering.

---

### Part 3: Debug Extension (Optional but Recommended)

**File**: `app/extensions/DebugVisualization.ts`

```typescript
import { Extension, App, EventBus } from '../types';

export class DebugVisualizationExtension implements Extension {
  name = 'debug-viz';
  version = '1.0.0';
  description = 'Keyboard shortcuts for debug visualizations';
  
  private app: App;
  private previousRecipeId: string | null = null;
  private inDebugMode: boolean = false;
  
  install(app: App, bus: EventBus): void {
    this.app = app;
    
    // Register service
    app.registerService('debug-viz', this);
    
    // Set default debug parameters
    app.parameterStore.batch({
      'debug.mode': 0,           // Normals by default
      'debug.depthScale': 100.0  // Depth visualization scale
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', this.handleKeydown);
    
    console.log('Debug visualization: N=normals, D=depth, A=albedo, L=light hits, F=final render');
  }
  
  uninstall(): void {
    document.removeEventListener('keydown', this.handleKeydown);
  }
  
  private handleKeydown = (e: KeyboardEvent): void => {
    // Don't interfere with text inputs
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }
    
    switch(e.key.toLowerCase()) {
      case 'n':
        this.showDebug(0, 'Normals');
        break;
      case 'd':
        this.showDebug(1, 'Depth');
        break;
      case 'a':
        this.showDebug(2, 'Albedo');
        break;
      case 'l':
        this.showDebug(3, 'Light Visibility');
        break;
      case 'f':
        this.showFinal();
        break;
    }
  };
  
  private showDebug(mode: number, name: string): void {
    if (!this.inDebugMode) {
      // Entering debug mode - remember current recipe
      this.previousRecipeId = this.app.engine.getActiveRecipeId();
    }
    
    // Set debug mode parameter
    this.app.parameterStore.set('debug.mode', mode);
    
    // Switch to debug recipe
    this.app.switchRecipe('debug');
    
    this.inDebugMode = true;
    console.log(`Debug mode: ${name}`);
  }
  
  private showFinal(): void {
    if (!this.inDebugMode) return;
    
    // Return to previous recipe
    if (this.previousRecipeId) {
      this.app.switchRecipe(this.previousRecipeId);
      console.log(`Returned to: ${this.previousRecipeId}`);
    }
    
    this.inDebugMode = false;
    this.previousRecipeId = null;
  }
  
  saveState(): any {
    return {
      inDebugMode: this.inDebugMode,
      previousRecipeId: this.previousRecipeId
    };
  }
  
  restoreState(state: any): void {
    this.inDebugMode = state.inDebugMode ?? false;
    this.previousRecipeId = state.previousRecipeId ?? null;
  }
}
```

**Features**:
- N/D/A/L keys switch to debug visualizations
- F key returns to previous recipe
- Remembers which recipe you were in
- Works with session save/restore

---

### Part 4: Integration

**File**: Your main application setup

```typescript
import { App } from './app/App';
import { pathtracerRecipe } from './recipes/pathtracer-recipe';
import { debugRecipe } from './recipes/debug-recipe';
import { DebugVisualizationExtension } from './app/extensions/DebugVisualization';

// ... other imports

async function main() {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const app = new App(canvas);
  
  // Initialize with both recipes
  await app.initialize(
    [
      pathtracerRecipe,
      debugRecipe,        // Add debug recipe
      // ... other recipes
    ],
    'environment.hdr'
  );
  
  // Install debug extension
  app.use(new DebugVisualizationExtension());
  
  // ... install other extensions
  
  // Start rendering
  app.renderInteractive();
}
```

---

## Usage

### Basic Workflow

1. **Start rendering normally**
   ```
   app.renderInteractive();
   // Pathtracer accumulates samples
   ```

2. **Check normals** (verify geometry)
   ```
   Press 'N'
   // Instantly see surface normals
   // Pathtracer accumulation preserved
   ```

3. **Check depth** (verify intersections)
   ```
   Press 'D'
   // See depth buffer
   // Adjust depthScale if needed:
   app.parameterStore.set('debug.depthScale', 50.0);
   ```

4. **Check albedo** (verify materials)
   ```
   Press 'A'
   // See material colors
   ```

5. **Check light visibility** (verify shadow rays)
   ```
   Press 'L'
   // Green = can see light
   // Red = occluded
   ```

6. **Return to rendering**
   ```
   Press 'F'
   // Back to pathtracer
   // Continues accumulating from where it left off!
   ```

### Debug Parameters

Adjust visualization via parameters:
```typescript
// Tune depth visualization range
app.parameterStore.set('debug.depthScale', 200.0); // Larger = darker nearby objects

// Switch modes programmatically
app.parameterStore.set('debug.mode', 2); // 0=normals, 1=depth, 2=albedo, 3=light
```

---

## Extensions & Customization

### Add More Debug Modes

Edit `debug-visualizer.ts`:
```glsl
#define DEBUG_YOUR_MODE 4

// In transport_integrate():
if (u_debug_mode == DEBUG_YOUR_MODE) {
  // Your custom visualization
  return someDebugValue;
}
```

Add keyboard shortcut in extension:
```typescript
case 'y':
  this.showDebug(4, 'Your Mode');
  break;
```

### Debug Curved Space Geometry

For your Thurston geometry work, add:
```glsl
#define DEBUG_GEOMETRY_TYPE 5

if (u_debug_mode == DEBUG_GEOMETRY_TYPE) {
  // Color-code which geometry we're in
  if (currentGeometry == EUCLIDEAN) return vec3(1.0, 0.0, 0.0); // Red
  if (currentGeometry == SPHERICAL) return vec3(0.0, 1.0, 0.0); // Green
  if (currentGeometry == HYPERBOLIC) return vec3(0.0, 0.0, 1.0); // Blue
}
```

### Multi-Light Debugging

For scenes with multiple lights:
```glsl
#define DEBUG_LIGHT_0 10
#define DEBUG_LIGHT_1 11
// etc.

if (u_debug_mode >= DEBUG_LIGHT_0) {
  int lightIndex = u_debug_mode - DEBUG_LIGHT_0;
  // Test visibility to specific light
}
```

---

## Testing Plan

### Step 1: Module Compilation
```typescript
// Verify debug module compiles
const recipe = debugRecipe;
engine.initialize([recipe]);
// Should compile without errors
```

### Step 2: Basic Visualization
```typescript
// Switch to debug recipe
app.switchRecipe('debug');

// Test each mode
app.parameterStore.set('debug.mode', 0); // Normals
app.renderFrame();
// Should see colored normals

app.parameterStore.set('debug.mode', 1); // Depth
// Should see depth gradient

app.parameterStore.set('debug.mode', 2); // Albedo
// Should see material colors
```

### Step 3: Recipe Switching
```typescript
// Start with pathtracer
app.switchRecipe('pathtracer');
app.renderInteractive();
// Accumulate ~100 samples

// Switch to debug
app.switchRecipe('debug');
// Should see debug view instantly

// Switch back
app.switchRecipe('pathtracer');
// Should still be at ~100 samples, continue accumulating
```

### Step 4: Extension Shortcuts
```
Start pathtracer
Wait for 100 samples
Press 'N' → should see normals
Press 'F' → back to pathtracer at 100 samples
Press 'D' → depth view
Press 'A' → albedo view
Press 'F' → back to pathtracer, still accumulating
```

### Step 5: Session Persistence
```
Enter debug mode (press 'N')
Save session (Ctrl+S or 'J')
Reload session
Should be in debug mode showing normals
Press 'F' → should return to pathtracer
```

---

## Performance Notes

### Zero Cost for Production

When you don't include the debug recipe:
```typescript
// Production build
await app.initialize([
  pathtracerRecipe,
  bidirectionalRecipe,
  // NO debugRecipe
]);
```

Debug code literally doesn't exist:
- Not compiled into shaders ✓
- No GPU memory allocated ✓
- No overhead whatsoever ✓

### Debug Mode Performance

Debug recipe is FASTER than pathtracer:
- Only does one ray intersection (no bounces)
- No BRDF evaluation
- No light sampling complexity
- Instant feedback

Use for quick iteration while building scenes/geometry.

---

## Common Issues & Solutions

### Issue: Normals look wrong (all same color)
**Cause**: Normals not computed correctly in scene module
**Solution**: Check `scene_intersect()` fills `hit.normal` properly

### Issue: Depth is all white or all black
**Cause**: Wrong depth scale
**Solution**: Adjust `debug.depthScale` parameter
```typescript
app.parameterStore.set('debug.depthScale', 50.0); // Try different values
```

### Issue: Albedo is black
**Cause**: Material properties not set or wrong material ID
**Solution**: Check `scene_material_properties()` implementation

### Issue: Light visibility all red
**Cause**: Light position wrong or shadow ray parameters wrong
**Solution**: Check `lighting_sample_position()` returns correct position

### Issue: Can't return to previous recipe
**Cause**: Extension not tracking recipe changes properly
**Solution**: Check `previousRecipeId` is set before switching to debug

---

## Future Enhancements

### Ideas for Later

1. **Wireframe overlay**
   - Show edges/triangles over render
   - Useful for mesh debugging

2. **Ray path visualization**
   - Show actual path rays take
   - Especially useful for curved spaces

3. **Variance heatmap**
   - Show which pixels have high variance
   - Useful for adaptive sampling

4. **Performance overlay**
   - Rays per pixel
   - Bounce counts
   - Intersection tests

5. **Comparison mode**
   - Split screen: debug view vs final render
   - Slider to transition between them

These can be added as new debug modes or separate debug recipes.

---

## Summary

**What we built**:
- ✅ Clean debug visualization system
- ✅ Zero production overhead
- ✅ Preserves per-recipe accumulation
- ✅ Easy keyboard shortcuts
- ✅ Extensible (add more debug modes easily)

**Time estimate**: 2-3 hours
- 1 hour: Write debug transport module
- 30 min: Create debug recipe
- 30 min: Write extension
- 30 min: Testing and tweaking

**Result**: Essential debugging tool for curved space rendering research, with no impact on production code.

Ready to implement!
