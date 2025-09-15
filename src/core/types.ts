/**
 * core/types.ts — v1
 * ------------------------------------------------------------
 * PURPOSE
 *   Canonical contracts for all *public* components that the Engine
 *   orchestrates. These interfaces are intentionally small and stable.
 *   They encode only what the Engine must know to:
 *     - collect shader code
 *     - register parameters
 *     - assign stable identities for caching & hot-swapping
 *
 * DESIGN PRINCIPLES
 *   - Minimal surface: avoid leaking implementation details.
 *   - Boring to the Engine: the Engine doesn't care about geometry math,
 *     only that components can supply shader fragments and parameters.
 *   - Stable identities: every component carries a ComponentID formed
 *     from (type, name, version, features). This drives shader caching.
 *
 * RATIONALE
 *   A rigid contract here prevents cascading refactors across Engine,
 *   ShaderCompiler, and caches. All research complexity stays in
 *   component internals, not in these types.
 *
 * KEY CONCEPTS
 *   - ShaderProvider: "I can supply GLSL fragments."
 *   - Parameterized:  "I expose Parameters for control & animation."
 *   - Component:      "I have a stable identity (ComponentID)."
 *   - World & Photography are *containers* of Components.
 *
 * NON-GOALS (v1)
 *   - Dependency graphs between shader fragments (introduced later).
 *   - Runtime reflection beyond what's needed for the Engine.
 *   - UI contracts (purely internal to extensions).
 *
 * TESTING NOTES
 *   - Type-level: invalid assignments should fail (tsc fixtures).
 *   - Runtime: ComponentID stability & hashing tests live in core/ids.test.ts.
 *
 * EVOLUTION
 *   - v2 may add optional `getDiagnostics()` for better error reports.
 *   - v2 may split ShaderProvider into fine-grained stages (defines/uniforms/functions/mainCode accessors).
 */
