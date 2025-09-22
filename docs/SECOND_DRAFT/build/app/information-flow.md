# App State Flows

## Parameter Change Flow

The complete journey of a parameter change from user input to GPU:

```
User Input (slider, keyboard, etc.)
    ↓
ParameterStore.set(path, value)
    ↓
Validation & Clamping
    ↓
Store Value
    ↓
Create ParameterChange object
    ↓
onChange callback fires
    ├─→ Engine.updateUniform(path, value)
    │       ↓
    │   GPU uniform updated
    │
    └─→ RenderCoordinator.shouldResetForParameter(path)
            ↓ (if true)
        resetAccumulation()
            ↓
        Engine.clearFilm()
```

### Batch Parameter Flow

```
batch({ multiple: values })
    ↓
Set flag: batching = true
    ↓
Loop: set() each parameter
    (accumulates changes, no onChange yet)
    ↓
Set flag: batching = false
    ↓
Single onChange(all changes)
    ↓
(continues as above)
```

## Recipe Switching Sequence

```
app.switchRecipe(name)
    ↓
Validate recipe exists
    ↓
Stop rendering if active
    ↓
Engine.selectRecipe(recipe)  [instant - pre-compiled]
    ↓
RenderCoordinator.resetAccumulation()
    ├─→ accumulator.count = 0
    └─→ Engine.clearFilm()
    ↓
Emit 'recipe.switched' event
    ↓
Extensions react (update UI, etc.)
```

## Render State Machine

### State Transitions

```
          stop()
    ┌─────────────────┐
    ↓                 │
[Idle] ──start()──→ [Running] ──complete()──→ [Complete]
    ↑                 │                           │
    └─────────────────┴───────────────────────────┘
              reset()
```

### Progressive Mode Flow

```
start()
    ↓
accumulator.reset()
    ↓
┌─→ Loop (requestAnimationFrame)
│       ↓
│   Engine.renderFrame()
│       ↓
│   accumulator.count++
│       ↓
│   Every N frames: emit 'render.progress'
│       ↓
│   Check convergence
│       ├─→ No: continue loop ──┘
│       └─→ Yes: stop()
```

### Interactive Mode Flow

```
start()
    ↓
Loop (requestAnimationFrame)
    ↓
Check time since last frame
    ├─→ < target frame time: skip
    └─→ ≥ target frame time:
            ↓
        Engine.renderFrame()
            ↓
        Calculate FPS
            ↓
        Emit progress (occasionally)
```

## Extension Installation Flow

```
app.use(extension)
    ↓
Check dependencies
    ├─→ Missing: throw error
    └─→ Present: continue
            ↓
        extension.install(app, bus)
            ↓
        Extension setup:
            ├─→ Register as service
            ├─→ Set up event listeners
            ├─→ Create UI elements
            └─→ Store references
            ↓
        Add to extensions map
            ↓
        Emit 'extension.installed'
```

## Session Save Flow

```
sessionManager.save(path)
    ↓
captureState()
    ├─→ Get recipe name
    ├─→ Serialize parameters
    ├─→ Get render mode & count
    ├─→ Get camera (from input service or params)
    └─→ Get extension states
            ↓
        For each extension with saveState():
            extension.saveState()
    ↓
Create SessionData object
    ↓
JSON.stringify()
    ↓
Write file (browser download or Node fs)
    ↓
Emit 'session.saved'
```

## Session Restore Flow

```
sessionManager.load(path)
    ↓
Read file
    ↓
JSON.parse()
    ↓
Validate session
    ├─→ Invalid: throw error
    └─→ Valid: continue
            ↓
        Stop rendering
            ↓
        restoreState()
            ├─→ Switch recipe
            ├─→ Restore params (silent - no onChange)
            ├─→ Set render mode
            ├─→ Restore camera
            └─→ Restore extension states
            ↓
        Resume rendering (if was running)
            ↓
        Emit 'session.restored'
```

## App Initialization Flow

```
new ResearchApp(canvas, config)
    ↓
Create WebGL2 context
    ↓
Create core components:
    ├─→ Engine(gl)
    ├─→ ParameterStore()
    ├─→ RenderCoordinator(engine)
    ├─→ SessionManager(this)
    └─→ EventBus()
    ↓
Wire core flow:
    ├─→ parameterStore.onChange = ...
    └─→ renderCoordinator.onProgress = ...
    ↓
Initialize:
    ├─→ Engine.initialize(all recipes) [compile shaders]
    ├─→ Register default parameters
    └─→ Select default recipe
    ↓
State = 'ready'
```

## Event Flow Patterns

### One-to-Many Pattern
```
RenderCoordinator
    ↓
emit('render.progress')
    ↓
EventBus distributes
    ├─→ UI updates progress bar
    ├─→ Stats calculates rate
    ├─→ Logger records milestone
    └─→ Experiment tracks convergence
```

### Service Communication Pattern
```
InputExtension
    ↓
app.getService('ui')
    ├─→ Found: ui.addPanel(...)
    └─→ Not found: work without UI
```

## Reset Decision Flow

```
Parameter changes
    ↓
For each change:
    ↓
shouldResetForParameter(path)
    ↓
Check metadata.triggersReset
    ├─→ Defined: use that value
    └─→ Undefined: check prefixes
            ↓
        Check no-reset prefixes first
            ├─→ Match: return false
            └─→ No match: check reset prefixes
                    ├─→ Match: return true
                    └─→ No match: return true (safe default)
    ↓
Any parameter needs reset?
    ├─→ Yes: resetAccumulation()
    └─→ No: continue rendering
```

## Error Propagation

```
Extension error:
    Try/catch in extension.install()
        ↓
    Log warning
        ↓
    Continue (degraded functionality)

Core error:
    Throw immediately
        ↓
    Stop rendering
        ↓
    Set state = 'error'
        ↓
    App unusable

Parameter error:
    Validation fails
        ↓
    Clamp or use default
        ↓
    Warn in console
        ↓
    Continue with valid value
```

These flows show the critical paths through the system. Notice how the core rendering flow (parameters → engine → GPU) is direct and synchronous, while extension communication uses events for flexibility.
