# TODO - Path Tracer GLSL

## Low Priority

### Layout-Aware Extension Base Class

**Location:** `src/app/extensions/`

**Problem:**
Extensions that need to use the layout system (ParameterPanelExtension, ProductionPanelExtension, StatsPanel) all have the same pattern:
```typescript
private useLayout = false;
private region: HTMLElement | null = null;

install(app: App, bus: EventBus): void {
    this.useLayout = app.hasLayout();
    if (this.useLayout) {
        this.region = app.getRegion('region-right');
        // mount to region
    } else {
        // standalone fallback
    }
}
```

**Solution:**
Consider creating a base class or mixin for layout-aware extensions:
```typescript
abstract class LayoutAwareExtension implements Extension {
    protected useLayout = false;
    protected mountTarget: HTMLElement | null = null;

    abstract get preferredRegion(): RegionName;

    install(app: App, bus: EventBus): void {
        this.useLayout = app.hasLayout();
        this.mountTarget = this.useLayout
            ? app.getRegion(this.preferredRegion)
            : this.createStandaloneWrapper();
        this.onInstall(app, bus);
    }

    protected abstract onInstall(app: App, bus: EventBus): void;
    protected abstract createStandaloneWrapper(): HTMLElement;
}
```

**When to implement:** When adding more layout-aware extensions. Currently only 3 extensions use this pattern, so abstraction may be premature.

---

### WidgetFactory Type Expansion

**Location:** `src/app/ui/WidgetFactory.ts`

**Current supported types:** `float`, `int`, `bool`, `color`, `vec2`, `vec3`, `vec4`

**Future types to consider:**
- `string` → `TextInput` (already exists in UI components)
- `file` → File picker for HDR loading
- `enum` → Explicit enum type (vs `int` with `values`)

**When to implement:** When parameter metadata requires these types.

---

### CSS Variable Documentation

**Naming conventions used:**
- `--layout-*` - Layout dimensions (canvas width, sidebar width, etc.)
- `--ui-*` - UI component styling (colors, spacing, typography, etc.)

See `src/app/ui/styles/theme.css` for all UI variables and `src/app/layout/layouts.css` for layout variables.

---

## High Priority

### ParameterManager Cleanup

**Location:** `src/engine/ParameterManager.ts`, `src/engine/Engine.ts`

**Problem:**
ParameterManager was designed for the old `ModuleDescriptor[]` architecture, but Engine now uses `CompiledRenderer` with `UniformBinding[]` directly.

Current workaround in `Engine._initializeParameterManager()` (lines ~980):
```typescript
// TODO: Update ParameterManager to accept UniformBinding[] directly
const fakeModules = [{
    id: { kind: 'test' as const, name: 'compiled', version: '1.0.0' },
    fragment: { functions: '' },
    uniformBindings: uniforms
}];
this.parameterManager.initialize(program, fakeModules);
```

**Solution Options:**

1. **Option A: Refactor ParameterManager to accept UniformBinding[] directly**
   - Change `initialize(program, modules: ModuleDescriptor[])` to `initialize(program, uniforms: UniformBinding[])`
   - Remove the module-to-binding flattening logic
   - Simplest, but breaks old architecture if still in use

2. **Option B: Add overloaded initialize method**
   - Keep existing `initialize(program, modules)` for backwards compatibility
   - Add `initializeFromBindings(program, uniforms: UniformBinding[])`
   - More code, but non-breaking

3. **Option C: Remove ParameterManager from Engine entirely**
   - Engine already handles uniform setting in `_setCustomUniforms()`
   - ParameterManager's main value is caching (skip redundant GPU calls)
   - Could inline caching logic directly in Engine
   - Most radical, but simplest architecture

**Recommendation:** Option A or C. The old module-based architecture is being replaced by the compiler, so backwards compatibility may not matter.

**Files involved:**
- `src/engine/ParameterManager.ts` - Main file to refactor
- `src/engine/Engine.ts:~980` - Remove fake module workaround
- `src/engine/types.ts` - `ModuleDescriptor` may become obsolete

---

## Completed

- [x] Move keyboard controls from App to AppShortcutsExtension
- [x] Add 'error' state to Engine
- [x] Cache draw buffer setup in RenderExecutor
- [x] Rename Flexible* files (FlexibleApp → App, etc.)
- [x] Design and implement DiagnosticBag error system
- [x] Migrate HDR validation to use DiagnosticBag
- [x] Remove legacy error files (~1700 lines deleted)
- [x] Rename formatters/ to reporters/
- [x] Fix all 29 TypeScript errors
- [x] Add GLSL module type declarations (src/glsl.d.ts)
- [x] Add uniform location warnings (with TODO to use DiagnosticBag later)
- [x] CompiledRenderer validation (structure, references, duplicates)
- [x] ResourceManager format normalization (store once, use everywhere)
