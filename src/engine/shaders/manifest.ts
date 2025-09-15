// src/engine/shaders/manifest.ts
/**
 * manifest.ts — v1
 * ------------------------------------------------------------
 * PURPOSE
 *   Define the manifest the ShaderCompiler returns so the runtime binding layer
 *   (UniformManager) can set values reliably after namespacing and pruning.
 *
 * CONTENTS
 *   - UniformManifest:
 *       • entries: Array<{
 *            logicalName: string;     // as declared by the component
 *            namespacedName: string;  // after compiler prefixing
 *            type: "float" | "int" | "vec2" | "vec3" | "vec4" |
 *                  "mat3" | "mat4" | "sampler2D" | "samplerCube" | "uint" | ...
 *            owner: ComponentID;      // provenance for diagnostics
 *         }>
 *       • byLogical: Map<string, string>    // quick lookup (logical → namespaced)
 *       • byNamespaced: Map<string, string> // reverse lookup
 *
 *   - Attribute/Varying sections may be added later if we expose them to the API.
 *
 * INVARIANTS
 *   - Manifest only includes uniforms that survived pruning.
 *   - Each logical uniform name appears at most once per program.
 *   - Types are canonicalized to a small union understood by UniformManager.
 *
 * RUNTIME USAGE
 *   - ParameterManager sets values by logical names; UniformManager translates
 *     via `byLogical` to the GL location of `namespacedName`.
 *   - Provenance (`owner`) powers helpful warnings when a parameter targets a
 *     uniform that no longer exists due to pruning.
 *
 * ERROR HANDLING
 *   - If two modules declare the same logical uniform and both are reachable,
 *     the compiler must have namespaced them; however, the manifest should still
 *     surface a conflict warning unless they’re explicitly intended to be the
 *     same binding (future: “shared” flag).
 *
 * TESTING GUIDANCE
 *   - After pruning, unrelated module uniforms are absent from the manifest.
 *   - Logical → namespaced mapping is stable across runs for identical recipes.
 *   - Types in the manifest match what UniformManager expects to set.
 *
 * EVOLUTION NOTES
 *   - v1.1 may add layout hints (e.g., UBO blocks) and texture unit suggestions.
 *   - v2 may generalize to buffer/SSBO bindings for WebGPU.
 */
