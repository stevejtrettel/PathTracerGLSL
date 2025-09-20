# App Design Decisions

## Why ParameterStore Doesn't Know About Rendering

**Decision**: The ParameterStore is a pure state container with no knowledge of rendering concepts like accumulation, uniforms, or frame resets.

**Rationale**:
- Single responsibility - it manages state, period
- Testable without GPU or rendering context
- Reusable for non-rendering parameter systems
- Clear separation between state and behavior

**Trade-off**:
The store can't make intelligent decisions about reset triggers. It has to use crude prefix matching or rely on metadata flags. But this keeps it simple and pure.

**Alternative Rejected**:
Having the store directly trigger resets. This would couple state management to rendering logic, making both harder to test and reason about.

## Why RenderCoordinator Owns Reset Logic

**Decision**: The RenderCoordinator, not the ParameterStore or Engine, decides when to reset accumulation.

**Rationale**:
- It's the component that understands accumulation as a concept
- Different render modes have different reset needs
- Interactive mode doesn't accumulate, so reset is meaningless
- Production mode resets per tile, not globally

**The Logic**:
The coordinator is the only component that knows both:
1. What parameter changed (from the store)
2. What the current render mode is (its own state)

This combination determines reset need.

**Alternative Rejected**:
Putting reset logic in the Engine. The Engine shouldn't make high-level decisions about rendering strategy - it just executes frames.

## Why Extensions Use the Service Pattern

**Decision**: Extensions register themselves as services rather than adding methods to the app.

**Rationale**:
```typescript
// This keeps app interface minimal
app.use(new ScreenshotExtension());
const screenshot = app.getService('screenshot');

// Rather than polluting the app
app.takeScreenshot();  // Where did this come from?
```

**Benefits**:
- App interface stays constant regardless of extensions
- Dependencies are explicit (you see the getService call)
- Services can be mocked for testing
- Extensions can be analyzed without running them

**Trade-off**:
Extra verbosity. You have to get the service before using it. But this explicitness is actually helpful for understanding code.

## Why Recipes Are Defined Upfront and Compiled Eagerly

**Decision**: Define 2-3 recipes at startup and compile all of them immediately.

**Rationale**:
- Research typically uses just a few configurations
- 2-3 recipes compile in ~2 seconds total
- Switching becomes instant (no stutter during research)
- Errors found immediately, not during critical work
- Simpler code - no async recipe management

**Real-World Usage**:
In practice, researchers use:
1. A main pathtracer recipe
2. A debug visualization recipe
3. Maybe a production quality variant

That's it. Dynamic recipe creation is over-engineering.

**Alternative Rejected**:
Lazy compilation on demand. This would save 2 seconds at startup but cause multi-second freezes during research. Bad trade-off.

## Why Direct References for Core Flow

**Decision**: The core rendering path uses direct references, not events.

```typescript
parameterStore.onChange = (changes) => {
  engine.updateUniforms(changes);  // Direct call
}
```

**Rationale**:
- Synchronous and predictable
- Full stack traces when debugging
- No event queue overhead
- Can't accidentally break by removing listener
- Makes the critical path obvious in code

**When Events ARE Used**:
For optional, one-to-many relationships:
- Progress updates (multiple UI elements might listen)
- Camera moves (multiple systems might care)
- Screenshots (logging, UI feedback)

**The Rule**:
If the connection is mandatory for rendering, use direct reference. If it's optional or has multiple listeners, use events.

## Why Parameter Restore is Silent

**Decision**: When loading a session, parameters are restored without triggering onChange callbacks.

**Rationale**:
You're establishing initial state, not making changes. Triggering onChange would:
- Cause N uniform updates for N parameters (wasteful)
- Trigger accumulation reset (wrong - nothing to reset yet)
- Fire events to extensions (they're not ready)

**Implementation**:
Save onChange, set to null, restore all parameters, restore onChange. Simple and correct.

## Why the Three-Mode Render System

**Decision**: Three distinct modes (interactive, progressive, production) rather than a unified configurable system.

**Rationale**:
Each mode has fundamentally different goals:
- **Interactive**: Maintain FPS, no accumulation
- **Progressive**: Accumulate until stopped/converged
- **Production**: Tile-based, checkpoint-capable

Trying to unify these leads to complex configuration and branching logic.

**Trade-off**:
Some code duplication between modes. But each mode is simple and optimized for its purpose.

## Why SessionManager Exists as Separate Component

**Decision**: Session management is a core component, not an extension.

**Rationale**:
- Reproducibility is fundamental to research
- Need access to all core components
- Must be available even with zero extensions
- Session format needs to be stable across versions

**Alternative Rejected**:
Making it an extension. This would make it optional, but reproducibility shouldn't be optional in a research tool.

## Why Extensions Can't Modify Core Pipeline

**Decision**: Extensions can't replace core components or modify the rendering pipeline.

**Rationale**:
- Prevents one extension from breaking others
- Core behavior stays predictable
- Easier to debug - core flow never changes
- Extensions can be added/removed safely

**What Extensions CAN Do**:
Access all core components, just not replace them. They work within the system, not against it.

## Why Service Discovery is Graceful

**Decision**: Missing services are handled gracefully, not as errors.

```typescript
const ui = app.getService('ui');
if (ui) {
  ui.addPanel(...);
}
// Continue working without UI
```

**Rationale**:
- Extensions should degrade gracefully
- Allow minimal configurations
- Easier testing (don't need all services)
- Prevents cascading failures

**The Philosophy**:
It's better to have reduced functionality than to crash.

## Why Accumulation Count Lives in Coordinator

**Decision**: The RenderCoordinator tracks accumulation count, not the Engine or Film module.

**Rationale**:
- It's a high-level concept about render progress
- Different modes count differently (per-frame vs per-tile)
- Engine just executes frames, doesn't understand progress
- Film module is in the shader, can't maintain CPU-side state

## Why Events Use Strings, Not Symbols or Enums

**Decision**: Events are identified by strings like 'render.progress'.

**Rationale**:
- Simple and readable
- No import needed to emit/listen
- Extensions can define custom events
- Follows Node.js EventEmitter pattern

**Trade-off**:
No type safety. Typos become runtime errors. But TypeScript const enums don't work well across module boundaries anyway.

## The "Boring Core" Philosophy

**Decision**: Keep the core minimal and stable. All features are extensions.

**Rationale**:
- Core can be fully tested and trusted
- Features can evolve independently
- Users only load what they need
- Easier to understand - core is small

**What Goes in Core**:
Only what's absolutely required for rendering:
- Parameter state
- Render execution
- Recipe management
- Session persistence

**What Becomes Extensions**:
Everything else:
- UI
- Input handling
- Export formats
- Experiments
- Statistics

This philosophy keeps the core "boring" - it does the minimum needed, reliably and predictably.
