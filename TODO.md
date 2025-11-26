# TODO - Path Tracer GLSL

## High Priority

### ParameterManager Cleanup

**Location:** `src/engine/ParameterManager.ts`, `src/engine/FlexibleEngine.ts`

**Problem:**
ParameterManager was designed for the old `ModuleDescriptor[]` architecture, but FlexibleEngine now uses `CompiledRenderer` with `UniformBinding[]` directly.

Current workaround in `FlexibleEngine._initializeParameterManager()` (lines 977-987):
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

3. **Option C: Remove ParameterManager from FlexibleEngine entirely**
   - FlexibleEngine already handles uniform setting in `_setCustomUniforms()`
   - ParameterManager's main value is caching (skip redundant GPU calls)
   - Could inline caching logic directly in FlexibleEngine
   - Most radical, but simplest architecture

**Recommendation:** Option A or C. The old module-based architecture is being replaced by the compiler, so backwards compatibility may not matter.

**Files involved:**
- `src/engine/ParameterManager.ts` - Main file to refactor
- `src/engine/FlexibleEngine.ts:977-987` - Remove fake module workaround
- `src/engine/types.ts` - `ModuleDescriptor` may become obsolete

---

### ResourceManager Format Normalization

**Location:** `src/engine/FlexibleResourceManager.ts`

**Problem:**
Format array normalization happens in multiple places (lines 309-313, 529-531):
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

### Error System Framework

**Design chosen:** DiagnosticBag pattern (compiler-style)

**Minimal implementation needed:**
```typescript
// src/errors/Diagnostic.ts
interface Diagnostic {
    severity: 'error' | 'warning' | 'info' | 'hint';
    code: string;
    message: string;
    source?: string;
    location?: SourceLocation;
    suggestions?: Suggestion[];
}

// src/errors/DiagnosticBag.ts
class DiagnosticBag {
    add(diagnostic: Diagnostic): void;
    error(code: string, message: string, source?: string): void;
    warning(code: string, message: string, source?: string): void;
    hasErrors(): boolean;
    getAll(): Diagnostic[];
}
```

**Benefits:**
- Accumulates multiple errors (doesn't stop at first)
- Warnings don't block compilation
- Source location tracking for beautiful error messages
- Pluggable renderers (console, HTML overlay, VS Code)

**Implement when:** Building the real compiler.

---

### CompiledRenderer Validation

**Status:** Ready to implement

The `CompiledRenderer` objects from `SimpleCompiler` are already well-formed. Validation would check:

1. All shader IDs in passes exist in `shaders` Map
2. All framebuffer IDs in passes exist in pipeline.framebuffers
3. All texture bindings reference valid buffers
4. Export targets reference valid buffers and attachments
5. Uniform bindings have valid types

**Location:** `src/errors/compiler/validation.ts` (skeleton exists)

**Implement when:** Before building real compiler, to catch mistakes early.

---

## Low Priority

### Uniform Location Warning

**Location:** `src/engine/FlexibleEngine.ts:788-827`

**Idea:** Add warning when a UniformBinding references a uniform that doesn't exist in the shader. Currently fails silently (location is null, uniform is skipped).

```typescript
if (!location) {
    console.warn(`Uniform '${binding.uniform}' not found in shader '${shaderId}'`);
}
```

**Priority:** Low - helpful for debugging but not critical.

---

## Completed

- [x] Move keyboard controls from FlexibleApp to AppShortcutsExtension
- [x] Add 'error' state to FlexibleEngine
- [x] Cache draw buffer setup in FlexibleRenderExecutor
