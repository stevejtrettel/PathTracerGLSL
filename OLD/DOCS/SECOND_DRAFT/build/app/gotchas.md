# App Gotchas

## The Silent Parameter Restore Trap

**The Gotcha**:
You load a session and suddenly your app executes 50 uniform updates, resets accumulation 10 times, and fires events everywhere.

**What Happened**:
You called `parameterStore.batch(savedParams)` without silencing onChange.

**The Fix**:
```typescript
// WRONG
parameterStore.batch(savedParams);

// RIGHT
parameterStore.restore(savedParams);  // Silent by design
```

**Why It Matters**:
Loading a session isn't making changes - it's establishing initial state. Every onChange during restore is wasted work.

## The Circular Dependency Trap

**The Gotcha**:
```typescript
// In RenderCoordinator
constructor(app: ResearchApp) {
  this.app = app;  // App needs Coordinator, Coordinator needs App
}
```

**What Happened**:
You tried to give components references to their parent.

**The Fix**:
Only pass what's actually needed:
```typescript
constructor(engine: Engine) {
  this.engine = engine;  // Only needs engine, not whole app
}
```

**Why It Matters**:
Circular dependencies make testing impossible and initialization order fragile.

## The Extension Order Trap

**The Gotcha**:
```typescript
app.use(new ParameterPanel());  // CRASH: "UI service not found"
app.use(new UIExtension());      // Too late!
```

**What Happened**:
ParameterPanel depends on UI but you installed them backwards.

**The Fix**:
Install dependencies first:
```typescript
app.use(new UIExtension())
   .use(new ParameterPanel());  // Now UI exists
```

**Better Fix**:
Check for dependencies explicitly in your extension.

## The Missing Service Crash

**The Gotcha**:
```typescript
const ui = app.getService('ui');
ui.addPanel(...);  // CRASH if no UI
```

**What Happened**:
You assumed a service exists.

**The Fix**:
```typescript
const ui = app.getService('ui');
if (ui) {
  ui.addPanel(...);
}
```

**Why It Matters**:
Your extension should work (degraded) even without its optional dependencies.

## The Event Handler Memory Leak

**The Gotcha**:
Your app gradually slows down as you use it.

**What Happened**:
```typescript
install(app, bus) {
  bus.on('render.progress', this.handleProgress);
}
// Never removed!
```

**The Fix**:
```typescript
install(app, bus) {
  this.handleProgress = this.handleProgress.bind(this);
  bus.on('render.progress', this.handleProgress);
}

uninstall() {
  bus.off('render.progress', this.handleProgress);
}
```

**Why It Matters**:
Event handlers reference the extension, extension references the app, nothing gets garbage collected.

## The Reset During Reset

**The Gotcha**:
Infinite loop or stack overflow during parameter updates.

**What Happened**:
```typescript
parameterStore.onChange = (changes) => {
  if (needsReset) {
    coordinator.resetAccumulation();
    parameterStore.set('render.samples', 0);  // Triggers onChange again!
  }
}
```

**The Fix**:
Never modify parameters during onChange. Track state separately.

## The Async Recipe Switch Trap

**The Gotcha**:
You try to make recipe switching async "for flexibility".

**What Happened**:
Now you need loading states, error handling, cancellation, and users get random compilation stutters.

**The Truth**:
Recipe switching is instant because shaders are pre-compiled. Keep it synchronous!

## The Parameter Path Typo

**The Gotcha**:
```typescript
store.set('camera.positoin', [0, 0, 5]);  // Typo!
// Later...
store.get('camera.position');  // undefined???
```

**What Happened**:
Typo in parameter path. No error because store accepts any path.

**The Fix**:
```typescript
const PARAMS = {
  CAMERA_POSITION: 'camera.position',
  CAMERA_FOV: 'camera.fov'
} as const;

store.set(PARAMS.CAMERA_POSITION, [0, 0, 5]);
```

## The Accumulation Count Confusion

**The Gotcha**:
You check accumulation count but it's always 0 in interactive mode.

**What Happened**:
Interactive mode doesn't accumulate. Count stays 0 by design.

**The Fix**:
Check the mode first:
```typescript
if (coordinator.getMode() === 'progressive') {
  const samples = coordinator.getAccumulationCount();
}
```

## The First Frame Reset

**The Gotcha**:
You reset accumulation on the first frame when there's nothing to reset.

**What Happened**:
Your reset logic doesn't check if accumulation has started.

**The Fix**:
```typescript
if (accumulator.count > 0) {
  resetAccumulation();
}
```

## The Browser vs Node Detection

**The Gotcha**:
```typescript
if (window) {  // CRASH in Node - window is not defined
  // Browser code
}
```

**What Happened**:
Checking for window throws in Node.

**The Fix**:
```typescript
if (typeof window !== 'undefined') {
  // Browser code
}
```

## The State Machine Violation

**The Gotcha**:
You try to switch recipes while in 'error' state and nothing happens.

**What Happened**:
State transitions have rules. Can't go from 'error' to 'running'.

**The Fix**:
Check state before operations:
```typescript
if (app.state === 'error') {
  app.reset();  // Back to 'ready'
}
app.switchRecipe('pathtracer');
```

## The Extension State Serialization

**The Gotcha**:
Extension state doesn't restore properly from sessions.

**What Happened**:
```typescript
saveState() {
  return this;  // Circular references, functions, DOM nodes...
}
```

**The Fix**:
Only return plain data:
```typescript
saveState() {
  return {
    position: this.position,
    mode: this.mode
  };  // Plain objects only
}
```

## The Double Installation

**The Gotcha**:
Installing the same extension twice causes weird behavior.

**What Happened**:
Event handlers registered twice, services overwritten.

**The Fix**:
Check before installing:
```typescript
if (extensions.has(extension.name)) {
  console.warn(`Extension ${extension.name} already installed`);
  return;
}
```

## The Parameter Type Mismatch

**The Gotcha**:
```typescript
store.set('camera.fov', '60');  // String instead of number
// Later in shader...
// NaN or undefined behavior
```

**What Happened**:
JavaScript's loose typing let the wrong type through.

**The Fix**:
Validate types in ParameterStore:
```typescript
if (metadata.type === 'float' && typeof value !== 'number') {
  throw new Error(`Expected number, got ${typeof value}`);
}
```

## The "This" Binding in Events

**The Gotcha**:
```typescript
bus.on('render.progress', this.handleProgress);
// Inside handleProgress, 'this' is undefined!
```

**What Happened**:
Event handlers lose their context.

**The Fix**:
```typescript
bus.on('render.progress', this.handleProgress.bind(this));
// Or use arrow function
bus.on('render.progress', (data) => this.handleProgress(data));
```

These gotchas will save you hours of debugging. The general pattern is: assume nothing, check everything, and keep the core flow simple and synchronous.
