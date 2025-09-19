
# Core Principles Contract

This document defines the **fundamental architectural principles** that govern the path tracer system.
These principles are **global invariants**: they apply across all pillars (World, Photography, Engine, App) and should not be redefined elsewhere.

---

## 1. Separation of Concerns

* **World**: Defines *what exists*.

    * Geometry, objects, materials, lights, scenes.
    * Contains *no knowledge* of how rays are traced or accumulated.

* **Photography**: Defines *how we measure*.

    * Cameras, estimators, film, developer.
    * Implements transport algorithms, but *never defines scene content*.

* **Engine**: Provides *deterministic infrastructure*.

    * Compilation, resource management, draw calls.
    * Purely mechanical; contains *no research logic*.

* **App**: Orchestrates *experiments and workflows*.

    * Recipes, parameter store, render coordination, extensions.
    * Provides user-facing controls, but *never alters core contracts*.

**Invariant:** No pillar crosses into another’s domain. Cross-pillar interaction happens only through the contracts defined in each module.

---

## 2. Determinism and Reproducibility

* All components must be deterministic given:

    * A fixed recipe,
    * A fixed random seed,
    * A fixed execution environment.

* Random sampling is explicitly seeded and dimensioned.

    * Camera consumes early dimensions (antialias, DOF).
    * Estimator consumes transport/sample dimensions.
    * Film/Developer consume none.

* Parameter changes reset accumulation unless explicitly exempt (see RenderCoordinator rules).

**Invariant:** Same inputs → same image, bit-for-bit.

---

## 3. Ownership Rules

* **Estimator owns transport**

    * Only the estimator decides how paths are traced, terminated, or weighted.
    * Materials provide scattering laws, but do not dictate how they are used.

* **Objects own placement, not properties**

    * Objects store geometry + material IDs.
    * They never store or query material properties.

* **Materials own appearance, not sampling strategy**

    * Materials define BRDFs/phase functions and absorption laws.
    * They provide evaluation, sampling, and PDF interfaces, but *never control the loop*.

* **Engine owns GPU state**

    * All binding, compilation, uniform management, and draw calls belong to the Engine.
    * App and modules *never call WebGL directly*.

* **App owns orchestration**

    * Recipes, parameter changes, render modes, extension hooks.
    * App never bypasses Engine contracts.

---

## 4. Contract Discipline

* Every module must provide:

    * **Descriptor**: name, kind, version, parameters, metadata.
    * **Contract functions**: the GLSL/JS functions required by its pillar.
    * **Validation**: checked by ModuleRegistry at registration.

* Contracts are **minimal**: only what is required to participate in rendering.

* Extensions can add optional features but must never weaken or redefine contracts.

**Invariant:** If a module compiles and registers successfully, it can always be used in a recipe.

---

## 5. Debug and Analysis Separation

* Debug outputs (normals, material IDs, false color, zebras) are **analysis modes**, not core film or estimator behavior.
* They are triggered by App/Developer flags, but implemented consistently across Photography.
* Debug never changes world or transport semantics — only what is written to film.

---

## 6. Error and Fallback Policy

* **Fatal errors**: shader compilation failures, invalid contracts, out-of-memory → stop rendering.
* **Recoverable errors**: missing parameters, unknown paths → log warning, fall back to default.
* **Research errors**: invalid sample (NaN, INF) → flush to black, increment error counter, continue.

All errors propagate upward: Engine → Coordinator → App → Extensions/UI.

---

## 7. Performance Principles

* **Dead code elimination** and **constant specialization** at shader compile-time.

* **No runtime branching** across materials, estimators, or geometry strategies — always compile-time choice.

* **Acceleration**:

    * Small scenes: unrolled.
    * Medium scenes: loops.
    * Large scenes: acceleration structures.

* **Accumulation** always uses numerically stable incremental formulas.

* **GPU residency** is preferred; CPU readback is for export/debug only.

---

## 8. Lifecycle Flow

Every render follows the same high-level flow:

1. **Recipe** chosen by App.
2. **ModuleRegistry** resolves all references.
3. **Engine** compiles GLSL program and allocates resources.
4. **ParameterStore** seeds initial values.
5. **RenderCoordinator** runs chosen mode (interactive, progressive, production).
6. **Engine.RenderExecutor** draws full-screen triangle.
7. **Camera → Estimator → World → Materials/Lights/Geometry** simulate transport.
8. **Film** accumulates samples.
9. **Developer** maps HDR to display.
10. **App/Extensions** handle output, logging, workflows.

---

## 9. Extension Discipline

* Extensions register as **services**, never modify App core directly.
* They may read/write parameters, observe events, and add UI.
* They may not bypass contracts or replace Engine.
* All communication with core goes through event bus or services.

---

## 10. Best Practices

1. Always validate recipes before execution.
2. Batch parameter updates to reduce resets.
3. Use compile-time flags for experiments, not runtime branches.
4. Isolate debug modes under a shared analysis system.
5. Save recipes with metadata (including rendered results) for reproducibility.
6. Document module parameters with metadata for UI and validation.

---

### Summary

This document serves as the **single source of truth** for design principles.
Other pillar docs (World, Photography, Engine, App) must **reference these principles** instead of duplicating them.
If a new feature challenges these invariants, this document should be updated first.

---

Would you like me to now follow up with the **System Flow Overview doc** — end-to-end pixel trace walkthrough — using these principles as reference points?
