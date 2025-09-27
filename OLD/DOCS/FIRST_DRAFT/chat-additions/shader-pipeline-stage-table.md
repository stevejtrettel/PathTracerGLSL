# Shader Pipeline — Stage Table
_A precise, auditable sequence from Recipe to linked program_

This table enumerates each compiler stage, its inputs/outputs, invariants, and diagnostics. It also pins **where constant specialization and dead code elimination (DCE)** occur.

---

## Overview (sequence)

```
ResolveModules
→ ValidateContracts
→ NamespacePrefix
→ LinkStubs
→ SpecializeConstants   ← constant folding begins
→ DeadCodeElimination   ← symbol reachability after specialization
→ InlineSmall
→ EmitMain
→ ExtractUniforms
→ CompileGLSL
```

---

## Stage Details

### 1) ResolveModules
- **Input**: Recipe (module refs), ModuleRegistry
- **Output**: `ModuleSet` (fully resolved descriptors with sources + metadata)
- **Invariants**:
  - Each required kind (`Geometry, Scene, Material*, Lights, Camera, Estimator, Film, Developer`) is present.
  - Versions satisfy constraints.
- **Diagnostics**:
  - Missing module/kind → fatal
  - Ambiguous name/version → fatal
  - Version warning on soft mismatch (recoverable)

---

### 2) ValidateContracts
- **Input**: `ModuleSet`
- **Output**: `CallGraph` (provided/required symbol map by kind)
- **Invariants**:
  - Every required function is provided *somewhere* in `ModuleSet`.
  - No cycles across kinds that violate contracts.
- **Diagnostics**:
  - Missing required symbol → fatal (module, function, expected signature)
  - Conflicting symbol providers (same name) → fatal
  - Deprecation notes (recoverable)

---

### 3) NamespacePrefix
- **Input**: `ModuleSet`, `CallGraph`
- **Output**: `PrefixedSources` (functions renamed with kind prefixes, e.g., `g_*, m_*, sc_*, l_*, c_*, e_*, f_*, d_*`); `SymbolMap`
- **Invariants**:
  - No collisions after prefixing
  - `SymbolMap` records original → prefixed
- **Diagnostics**:
  - Collision after prefixing (shouldn’t happen) → fatal

---

### 4) LinkStubs
- **Input**: `PrefixedSources`, `SymbolMap`
- **Output**: `LinkedIR` (glsl text or IR with import glue, e.g., lightweight shims for optional features)
- **Invariants**:
  - Optional features wired with defaults (e.g., if `m_pdf` unused, provide no-op stub only if legal)
- **Diagnostics**:
  - Illegal missing functions (no legal stub) → fatal

---

### 5) SpecializeConstants  **← constant folding starts**
- **Input**: `LinkedIR`, `Defines` (Recipe flags, mode, analysis mode, material/estimator toggles)
- **Output**: `SpecializedIR`
- **Transform**:
  - Substitute compile-time `#define` values and `const` parameters
  - Inline constant expressions, remove `#if !FEATURE` blocks
- **Invariants**:
  - All compile-time flags come from Recipe/ProgramKey
- **Diagnostics**:
  - Conflicting defines → fatal
  - Unused define (dev builds): warn once

---

### 6) DeadCodeElimination  **← after specialization**
- **Input**: `SpecializedIR`
- **Output**: `PrunedIR`
- **Transform**:
  - Remove unreachable functions/branches via symbol reachability from the root set:
    - `main`, `c_generate_ray`, `e_estimate`, `f_accumulate`, `d_develop`, and any required leaf functions
- **Why here**: Specialization creates constants that make more code unreachable; DCE here maximizes pruning.
- **Diagnostics**:
  - Report removed symbols (dev mode); keep counts for perf regression charts

---

### 7) InlineSmall
- **Input**: `PrunedIR`
- **Output**: `InlinedIR`
- **Policy**:
  - Inline leafs below N instructions
  - Never inline across kind boundaries if it harms debugability
- **Diagnostics**:
  - Size-before/after (dev); warn if ballooning

---

### 8) EmitMain
- **Input**: `InlinedIR`, Film/Developer templates
- **Output**: `AssembledSource` (single fragment with canonical `main()`)
- **Invariants**:
  - `main()` calls are ordered: Camera → Estimator → Film → Developer
  - Mode-specific glue (interactive/progressive/production) is additive, not invasive
- **Diagnostics**:
  - Missing root calls → fatal

---

### 9) ExtractUniforms
- **Input**: `AssembledSource`
- **Output**: `UniformMapSpec` (prefixed uniform names, types), `ProgramKey`
- **Transform**:
  - Scan `u_*` names, associate to parameter paths by declared metadata
  - Compute deterministic `ProgramKey` (module ids + defines + analysis mode + dimension protocol version)
- **Diagnostics**:
  - Undeclared/anonymous uniforms → warn (dev)
  - Parameter without uniform (if required) → fatal

---

### 10) CompileGLSL
- **Input**: `AssembledSource`, `UniformMapSpec`
- **Output**: `LinkedProgram` (GL program, locations), `LineMap`, `Diagnostics`
- **Invariants**:
  - Compile/link succeeds before use
  - LineMap available for error surfacing
- **Diagnostics**:
  - GLSL errors with file/line; attach `AssembledSource` excerpt and `LineMap`
  - On failure → fatal, emit build artifact bundle

---

## Notes on Caching

- **ProgramKey** is the cache key. Any change in modules/defines invalidates cache.
- **UniformMapSpec** can be cached per ProgramKey; re-used if locations stable across driver sessions.