# TODO - Path Tracer GLSL

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
