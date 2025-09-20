# App Patterns

## When to Use Direct References vs Events

### Direct References (Core Flow)
Use direct references for the critical rendering path:
- ParameterStore → Engine (uniform updates)
- ParameterStore → RenderCoordinator (reset decisions)
- RenderCoordinator → Engine (frame execution)

Why: Zero overhead, synchronous, debuggable with a stack trace.

### Events (Extensions & Features)
Use events for optional features and cross-cutting concerns:
- Progress updates → UI displays
- Camera moves → Multiple listeners might care
- Screenshots taken → Logging, UI feedback

Why: Loose coupling, extensions can come and go, multiple listeners.

### The Rule
If removing the connection would break core rendering, use direct reference.
If it's a "nice to have" or "one to many" relationship, use events.

## Parameter Update Batching Pattern

### The Problem
Individual parameter changes can cause multiple resets and uniform updates:
```
set('camera.x', 1) → reset + update
set('camera.y', 2) → reset + update  
set('camera.z', 3) → reset + update
```

### The Pattern
Always batch related changes:
```
batch({
  'camera.x': 1,
  'camera.y': 2,
  'camera.z': 3
}) → single reset + update
```

### Implementation Hint
The batch operation should set a flag that prevents onChange from firing until all sets complete. Then emit once with all changes.

## Accumulation Reset Decision Pattern

### Where the Logic Lives
The RenderCoordinator owns reset decisions, not the ParameterStore.

Why: ParameterStore is pure state management. It doesn't know about rendering concepts like accumulation.

### The Decision Tree
```
1. Check explicit metadata first (triggersReset flag)
2. Check no-reset prefixes (higher priority)
3. Check reset prefixes
4. Default to reset (safe choice)
```

### Common Prefixes
Reset: `camera.`, `material.`, `scene.`, `lights.`
No reset: `developer.`, `ui.`, `debug.`, `film.`

### Edge Cases
- Recipe switch: Always reset
- Resolution change: Always reset
- Film mode change: Maybe reset (depends on mode)
- First frame: Nothing to reset

## Extension Service Discovery Pattern

### The Problem
Extensions need to find each other without hard dependencies.

### The Pattern
```
1. Register as service in install()
2. Look up services when needed
3. Handle missing services gracefully
```

### Good Pattern
```typescript
const ui = app.getService('ui');
if (ui) {
  ui.addPanel(myPanel);
} else {
  // Work without UI, maybe log to console instead
}
```

### Bad Pattern
```typescript
const ui = app.getService('ui');
ui.addPanel(myPanel);  // Crashes if no UI!
```

## Recipe Compilation Pattern

### Eager Compilation
Compile ALL recipes at startup, not on demand.

Why:
- 2-3 recipes compile in ~2 seconds total
- Switching becomes instant (no stutter)
- Errors found immediately
- Simpler code (no async recipe switching)

### Recipe Switching
1. Stop current rendering
2. Switch program (instant - pre-compiled)
3. Reset accumulation
4. Emit event for extensions
5. (Optional) Start rendering

Don't reload parameters - they persist across recipes.

## Parameter Restore Pattern

### The Silent Restore
When loading a session, restore parameters WITHOUT triggering onChange.

Why: You're setting initial state, not making changes. Triggering onChange would:
- Cause unnecessary uniform updates
- Trigger accumulation reset
- Fire events to extensions

### The Pattern
Save the onChange handler, set to null, restore, put handler back.

## Extension Installation Order

### Dependency Pattern
```
1. Check dependencies exist
2. Install extension
3. Extension registers as service
4. Other extensions can now depend on it
```

### Common Order
1. UI (many things want to add panels)
2. Input (camera controls)
3. Tools that depend on UI
4. Exporters
5. Experiments (often need everything)

## Event Naming Pattern

### Convention
`namespace.action` or `namespace.state_change`

Examples:
- `render.started` (state change)
- `render.progress` (ongoing)
- `camera.moved` (completed action)
- `parameter.changed` (completed change)

### Not
- `onRenderStart` (not JavaScript handlers)
- `RENDER_START` (not constants)
- `renderstarted` (hard to read)

## State Persistence Pattern

### What to Save
- Recipe name (but check it exists on restore)
- All parameters (as plain object)
- Render mode and config
- Extension states (if they provide)

### What NOT to Save
- Compiled shaders
- GPU resources
- Event handlers
- Service references
- Accumulation buffers

### Extension State Pattern
Extensions can optionally provide `saveState()` and `restoreState()`.
If saveState returns undefined, nothing is saved for that extension.

## Service vs Method Pattern

### Services (Good)
Extension provides service object with methods:
```
app.registerService('screenshot', this);
// Later: app.getService('screenshot').capture();
```

### Methods on App (Bad)
Extension adds methods to app:
```
app.takeScreenshot = () => {...};
// App interface gets polluted
```

Why services: Clean app interface, explicit dependencies, easier testing.

## Progress Reporting Pattern

### Frequency
Don't report every frame. Use:
- Every N frames
- Every N milliseconds
- At percentage milestones

### Information Hierarchy
Always include: mode, sample count
Progressive adds: convergence estimate
Production adds: tile progress
Interactive adds: FPS

## Error Recovery Pattern

### Core Errors (Fatal)
- WebGL context loss
- Recipe compilation failure
- Out of memory

Action: Stop everything, show error state

### Extension Errors (Recoverable)
- Extension install failure
- Service not found
- State restore failure

Action: Log warning, continue without feature

### Parameter Errors (Clamp/Warn)
- Value out of range
- Wrong type

Action: Clamp to valid range, warn in console

## The "Core Stays Boring" Pattern

When adding features, ask:
1. Can this be an extension?
2. Does core NEED to know about this?
3. What's the minimum core needs to provide?

Usually the answer is: Core provides a hook, extension does the work.

Example: Screenshots
- Core doesn't know about screenshots
- Engine provides `readPixels()`
- ScreenshotExtension handles formats, saving, UI
