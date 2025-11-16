# App Pillar: Design Evolution

This document explains how the implementation differs from the original design docs and why those changes were made.

---

## Summary

The implementation is **simpler and cleaner** than the original design. We dropped over-engineering that wasn't needed for research use while keeping everything essential. The core principles remain intact:

- ✅ Clean separation of concerns
- ✅ Parameter management with locking
- ✅ Flexible render modes
- ✅ Complete reproducibility
- ✅ Extension system for growth

---

## Major Simplifications

### 1. No Parameter Metadata System

**Original Design**:
```typescript
interface ParameterMetadata {
    type: 'float' | 'vec3' | 'int' | 'bool';
    default: any;
    min?: number;
    max?: number;
    triggersReset?: boolean;  // Hint for coordinator
}

store.registerMetadata('camera.fov', {
    type: 'float',
    min: 10,
    max: 170,
    default: 60,
    triggersReset: true
});
```

**Implementation**:
```typescript
// Just store values - no metadata
store.set('camera.fov', 60);
```

**Why**:
- Research code doesn't need type validation
- Engine validates what it needs (shader compilation fails clearly)
- Min/max clamping not helpful (prefer errors over silent fixes)
- Reset decision based on parameter name prefix, not metadata
- Simpler is better for code you want to forget about

**Impact**: None. Everything works without metadata.

---

### 2. No ChangeSource Tracking

**Original Design**:
```typescript
type ChangeSource = 
    | 'user'          // UI interaction
    | 'animation'     // Animation system
    | 'extension'     // Extension change
    | 'session'       // Session restore
    | 'recipe'        // Recipe defaults
    | 'experiment';   // Parameter sweep

store.set('camera.position', [0, 5, 10], 'animation');

// Coordinator makes smart decisions based on source
if (source === 'session') {
    // Don't reset on session load
} else if (source === 'animation') {
    // Maybe don't reset every frame?
}
```

**Implementation**:
```typescript
// No source tracking
store.set('camera.position', [0, 5, 10]);

// Reset decision based on parameter name only
if (path.startsWith('camera.')) {
    reset();
}
```

**Why**:
- Parameter locking during production handles the main use case
- Recipe switching uses `resendAll()` which sends oldValue === newValue
- Session restore temporarily disables onChange
- Source tracking added complexity without clear benefit
- Reset prefix system is simple and works

**Impact**: None. Production mode locks, sessions restore cleanly.

---

### 3. Two Render Modes Instead of Three

**Original Design**:
```typescript
type RenderMode = 
    | 'interactive'   // Real-time preview, no accumulation
    | 'progressive'   // Continuous accumulation
    | 'production';   // Goal-driven, locked

coordinator.setMode('progressive');
```

**Implementation**:
```typescript
type RenderMode = 
    | 'interactive'   // Unlocked, flexible
    | 'production';   // Goal-driven, locked

coordinator.startInteractive();
coordinator.startProduction(goal);
```

**Why**:
- "Progressive" and "production" are the same thing
- Real distinction is locked vs unlocked, not accumulation
- Engine controls accumulation (sampleCount > 1 means accumulating)
- Simpler API: start method implies mode
- Two states easier to reason about than three

**Impact**: None. Production mode is progressive by nature.

---

### 4. Built-in Keyboard Controls

**Original Design**:
```typescript
// All controls via extensions
app.use(new KeyboardShortcuts());
app.use(new KeyboardCamera());
```

**Implementation**:
```typescript
// Recipe switching, render control built-in
app.setupKeyboardControls();

// Camera as extension
app.use(new KeyboardControls());
```

**Why**:
- Core controls (Space, Esc, R, P, J, O, T) are always useful
- Recipe switching belongs in App, not extension
- Camera controls still extensions (swap between keyboard/orbit/touch)
- Reasonable defaults for research use

**Impact**: Less to install, works immediately.

---

### 5. Simpler Recipe Initialization

**Original Design**:
```typescript
interface RecipeBundle {
    recipes: Record<string, Recipe>;
    defaultRecipe: string;
}

const config = {
    canvas,
    recipes: {
        recipes: { 'pathtracer': recipe1, 'debug': recipe2 },
        defaultRecipe: 'pathtracer'
    }
};

const app = new ResearchApp(canvas, config);
app.initialize();
```

**Implementation**:
```typescript
const app = new App(canvas);
await app.initialize([recipe1, recipe2], 'env.hdr');
```

**Why**:
- Simpler API for common case (list of recipes)
- First recipe is default
- Environment HDR at initialization, not separate call
- Less structure for research use

**Impact**: Easier to use, still flexible.

---

## Minor Simplifications

### 6. No `quickStart()` Method

**Original Design**:
```typescript
app.quickStart('pathtracer');
// Switches recipe, starts progressive rendering
```

**Implementation**:
```typescript
// Just use the components directly
await app.initialize([recipes]);
app.renderInteractive();
```

**Why**:
- Two lines is already quick
- Explicit is better than magic
- Initialize doesn't assume you want to start rendering

**Impact**: None, just call what you need.

---

### 7. Unified Progress Reporting

**Original Design**:
```typescript
interface ProgressInfo {
    mode: RenderMode;
    samples: number;
    fps?: number;          // Interactive only
    targetSamples?: number; // Production only
    percentComplete?: number; // Production only
}
```

**Implementation**:
```typescript
interface ProgressInfo {
    mode: RenderMode;
    state: RenderState;  // 'rendering' | 'paused' | 'complete'
    timestamp: number;
    samples: number;
    elapsedTime: number;
    // Production-only (undefined for interactive)
    targetSamples?: number;
    percentComplete?: number;
}
```

**Why**:
- Added state field for pause/complete distinction
- Added timestamp for rate calculations
- Added elapsedTime for time tracking
- FPS calculated by listeners if needed (StatsPanelExtension does this)
- Unified structure simpler than mode-specific fields

**Impact**: Better progress reporting with pause support.

---

### 8. Production as Promise

**Original Design**:
```typescript
coordinator.startProduction({ targetSamples: 1000 });
coordinator.onComplete = () => {
    console.log('Done');
};
```

**Implementation**:
```typescript
await coordinator.startProduction({ targetSamples: 1000 });
console.log('Done');

// Or with error handling
try {
    await coordinator.startProduction({ targetSamples: 1000 });
} catch (error) {
    if (error.name === 'RenderStopped') {
        console.log('User stopped');
    }
}
```

**Why**:
- Promises are standard for async operations
- Natural error handling via try/catch
- Clearer intent (await means "wait for completion")
- Goal object can still have onProgress callback

**Impact**: Better async/await patterns, clearer code.

---

## Additions Not in Design Docs

### 9. TiledRenderer

**Not in original docs**, but essential for research:

```typescript
class TiledRenderer {
    async startJob(config: TileJobConfig): Promise<void>
    stopJob(): void
    resumeJob(job: TileJob): Promise<void>
}
```

**Why**:
- Need to render large images (8K+)
- Can't allocate huge buffers
- Tile-by-tile with resume support
- Uses production mode internally (clean abstraction)

**Impact**: Can render any resolution.

---

### 10. Utility Classes

**Not in original docs**, but very helpful:

```typescript
class AnimationLoop {
    start(callback: (dt: number) => void): void
    stop(): void
}

class EventManager {
    add(target: EventTarget, event: string, handler: Function): void
    onBus(bus: EventBus, event: string, handler: Function): void
    removeAll(): void
}
```

**Why**:
- AnimationLoop: Reduces boilerplate for RAF loops
- EventManager: Prevents listener leaks
- Common patterns extracted

**Impact**: Extensions easier to write correctly.

---

### 11. Pause/Resume

**Original docs mentioned it**, but implementation is more complete:

```typescript
coordinator.pause();   // Works for both modes
coordinator.resume();  // Continues from where left off
coordinator.isPaused(); // Check state
```

**Why**:
- User might want to pause long renders
- Look at GPU stats, check output
- Resume without losing progress

**Impact**: Better user experience for long renders.

---

## What Stayed the Same

These design principles were kept intact:

### 1. Clear Separation of Concerns
```
App           → Orchestration only
ParameterStore → State management only
RenderCoordinator → Execution control only
SessionManager → Persistence only
Engine        → Rendering only
```

### 2. Service Registry Pattern
```typescript
app.registerService('myext', this);
const service = app.getService('myext');
```

### 3. EventBus for Loose Coupling
```typescript
bus.emit('render.progress', info);
bus.on('render.progress', handler);
```

### 4. Extension System
```typescript
interface Extension {
    install(app: App, bus: EventBus): void
    uninstall?(): void
    saveState?(): any
    restoreState?(state: any): void
}
```

### 5. Complete Session Persistence
```typescript
{
    version, timestamp,
    activeRecipe, parameters,
    renderMode, sampleCount,
    camera, extensions, tileJob
}
```

### 6. Parameter Lock During Production
```typescript
if (locked) {
    console.warn('Ignoring change during production');
    return;
}
```

---

## Lessons Learned

### Over-Engineering Indicators

The original design had complexity that wasn't needed:

1. **Metadata system** - Type validation adds overhead without benefit
2. **ChangeSource tracking** - Lock/unlock is simpler and sufficient
3. **Three render modes** - Two modes is clearer
4. **Complex initialization** - Simple array is better

### Good Complexity

Some complexity was essential:

1. **Extension system** - Enables growth without core changes
2. **Session persistence** - Research needs reproducibility
3. **Production locking** - Prevents corruption during long renders
4. **Tiled rendering** - Can't do research without large outputs

### The Right Balance

The implementation found the sweet spot:
- Simple enough to understand quickly
- Complete enough for real research
- Stable enough to forget about
- Flexible enough to extend

---

## Migration Guide

If you have code written against the design docs:

### Remove Metadata Calls
```typescript
// Before
store.registerMetadata('camera.fov', { type: 'float', min: 10, max: 170 });

// After
// Just remove it - not needed
```

### Remove ChangeSource
```typescript
// Before
store.set('camera.position', [0, 5, 10], 'animation');

// After
store.set('camera.position', [0, 5, 10]);
```

### Update Render Modes
```typescript
// Before
coordinator.setMode('progressive');
coordinator.start();

// After
coordinator.startInteractive();
// or
await coordinator.startProduction({ targetSamples: 1000 });
```

### Update Initialization
```typescript
// Before
const app = new ResearchApp(canvas, {
    recipes: { recipes: {...}, defaultRecipe: '...' }
});
app.initialize();

// After
const app = new App(canvas);
await app.initialize([recipe1, recipe2]);
```

---

## Future Proof

The current design is stable because:

1. **Extension system** - New features don't touch core
2. **Simple core** - Less code means less bugs
3. **Clear contracts** - Components have well-defined interfaces
4. **No premature optimization** - Complexity added only when needed

---

## Conclusion

The implementation is **better** than the design docs because:

- ✅ Simpler (less code, less concepts)
- ✅ Clearer (two modes vs three, promises vs callbacks)
- ✅ More practical (tiling, pause/resume)
- ✅ Still flexible (extension system unchanged)
- ✅ Still complete (all features work)

The original design was a good starting point, but implementation revealed what was actually needed. The result is a system that's:

- Easy to understand
- Easy to use
- Easy to extend
- Easy to forget about

**Perfect for research.**
