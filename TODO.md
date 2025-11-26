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

### ResourceManager Format Normalization

**Location:** `src/engine/ResourceManager.ts`

**Problem:**
Format array normalization happens in multiple places:
```typescript
const formats = Array.isArray(config.format)
    ? config.format
    : [config.format || 'rgba8'];
```

**Solution:**
Store normalized format array in `FramebufferResource` at creation time:
```typescript
interface FramebufferResource {
    config: FramebufferConfig;
    formats: string[];  // Always normalized array
    // ...
}
```

**Priority:** Low - works fine, just minor code quality improvement.

---

## Medium Priority

### CompiledRenderer Validation

**Status:** Ready to implement using DiagnosticBag

The `CompiledRenderer` objects from `SimpleCompiler` are already well-formed. Validation would check:

1. All shader IDs in passes exist in `shaders` Map
2. All framebuffer IDs in passes exist in pipeline.framebuffers
3. All texture bindings reference valid buffers
4. Export targets reference valid buffers and attachments
5. Uniform bindings have valid types

**Location:** Create `src/errors/compiler/validation.ts`

**Implement when:** Before building real compiler, to catch mistakes early.

---

## Low Priority

### Uniform Location Warning

**Location:** `src/engine/Engine.ts:~790`

**Idea:** Add warning when a UniformBinding references a uniform that doesn't exist in the shader. Currently fails silently (location is null, uniform is skipped).

```typescript
if (!location) {
    console.warn(`Uniform '${binding.uniform}' not found in shader '${shaderId}'`);
}
```

**Priority:** Low - helpful for debugging but not critical.

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
