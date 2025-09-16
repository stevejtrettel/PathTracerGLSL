/**
 * shader-fragment.ts — v1.1
 * ------------------------------------------------------------
 * PURPOSE
 *   Define the normalized container (ShaderFragment) for GLSL contributions
 *   emitted by any Component. The ShaderCompiler consumes an array of these
 *   fragments and statically assembles an exact-fit program (no preprocessor
 *   conditionals, no runtime feature branching).
 *
 * SCOPE
 *   - Represents *textual* GLSL contributions only.
 *   - Captures module-level dependencies via `requires`/`provides`.
 *   - Optionally designates a program entrypoint the Engine will wrap
 *     into the canonical `main()` (e.g., "shadePixel").
 *
 * INVARIANTS
 *   - No preprocessor controls: fragments MUST NOT contain `#if/#ifdef` feature
 *     switches. Variants are expressed by swapping fragments at assembly time.
 *   - Fragments are namespace-agnostic. The compiler is responsible for applying
 *     module-level namespacing to uniforms and private helpers to avoid collisions.
 *   - Concatenation order within a module is deterministic:
 *       uniforms → functions → mainCode
 *   - `requires` lists *public* symbol names this fragment expects to exist.
 *     `provides` lists *public* symbol names it defines. Both lists are for
 *     link-time resolution; private helpers should remain unlisted.
 *
 * LINKING MODEL
 *   - The compiler builds a symbol table from all `provides`. Every `requires`
 *     must resolve to exactly one provider; otherwise the compiler throws with
 *     a clear diagnostic (missing or ambiguous symbol).
 *   - Unused providers (not reachable from the selected entrypoint) are pruned.
 *
 * ENTRYPOINTS
 *   - A fragment may declare an entrypoint (e.g., { fragmentMain: "shadePixel" }).
 *     The Engine injects a canonical `main()` that forwards to that symbol.
 *   - At most one effective entrypoint per assembled program.
 *
 * CONTENT RULES
 *   - `uniforms`: declarations only; no definitions or initializers.
 *   - `functions`: helper/function definitions; MUST NOT declare `main()`.
 *   - `mainCode`: optional module-local main-body snippet meant to be included
 *                 by the compiler when the module supplies the entrypoint.
 *
 * DIAGNOSTICS & MANIFEST
 *   - The compiler emits a manifest mapping each logical uniform name to its
 *     namespaced form so the UniformManager can bind values predictably.
 *
 * NON-GOALS (v1.1)
 *   - No automatic dead-code elimination inside a fragment (beyond module-level
 *     pruning). Keep fragments small and focused.
 *   - No cross-fragment AST rewriting; this is a textual link step with strict
 *     symbol resolution and namespacing.
 *
 * TESTING GUIDANCE
 *   - A fragment set that omits a required symbol must fail with a precise error.
 *   - Two fragments providing the same public symbol must fail (ambiguity).
 *   - Assembled output must not contain `#if/#ifdef` or feature guards.
 *   - Namespacing must not alter public symbol names used for linking.
 *
 * EVOLUTION NOTES
 *   - v1.2 may add optional sectioning (e.g., `types`, `structs`) for stricter
 *     placement control, and/or a `visibility` hint for better pruning.
 *   - v2 may admit staged fragments (init/update/shade) if/when we add multipass.
 */

import type { ComponentID } from "./ids";

/** Textual contribution + module-level contract. */
export interface ShaderFragment {
    /** Declarations only (e.g., `uniform float exposure;`). */
    readonly uniforms?: string;
    /** Helper functions / structs (must NOT declare `main()`). */
    readonly functions?: string;
    /**
     * Optional body snippet used if this module supplies the entrypoint
     * (e.g., a `shadePixel` body that `main()` will forward to).
     */
    readonly mainCode?: string;

    /** Public symbols this fragment needs to exist at link time. */
    readonly requires?: readonly string[];
    /** Public symbols this fragment provides at link time. */
    readonly provides?: readonly string[];

    /** Optional named entrypoint for the final program (fragment stage). */
    readonly entrypoints?: { readonly fragmentMain?: string };
}

/** A fragment together with identity (used for namespacing & provenance). */
export interface ShaderModuleDescriptor {
    readonly id: ComponentID;
    readonly fragment: ShaderFragment;
    /**
     * Optional deterministic tie-breaker applied only when the linker
     * encounters multiple valid topological orders. Lower wins. Default 0.
     * Prefer to rely on explicit `requires`/`provides` instead.
     */
    readonly priority?: number;
}

/** Normalized (no `undefined`) view handy for compilers/tests. */
export interface NormalizedShaderFragment {
    readonly uniforms: string;
    readonly functions: string;
    readonly mainCode: string;
    readonly requires: readonly string[];
    readonly provides: readonly string[];
    readonly entrypoints?: { readonly fragmentMain?: string };
}

/** Type guard for runtime validation/diagnostics. */
export function isShaderFragment(x: unknown): x is ShaderFragment {
    if (typeof x !== "object" || x === null) return false;
    const f = x as Record<string, unknown>;
    const okStr = (v: unknown) => v === undefined || typeof v === "string";
    const okArr = (v: unknown) =>
        v === undefined ||
        (Array.isArray(v) && v.every((s) => typeof s === "string"));

    if (!okStr(f.uniforms)) return false;
    if (!okStr(f.functions)) return false;
    if (!okStr(f.mainCode)) return false;
    if (!okArr(f.requires)) return false;
    if (!okArr(f.provides)) return false;

    if (f.entrypoints !== undefined) {
        const ep = f.entrypoints as Record<string, unknown>;
        if (typeof ep !== "object" || ep === null) return false;
        if (
            ep.fragmentMain !== undefined &&
            typeof ep.fragmentMain !== "string"
        ) {
            return false;
        }
    }
    return true;
}

/** Produce a normalized view with defaults for undefined fields. */
export function normalizeShaderFragment(f: ShaderFragment): NormalizedShaderFragment {
    return {
        uniforms: f.uniforms ?? "",
        functions: f.functions ?? "",
        mainCode: f.mainCode ?? "",
        requires: (f.requires ?? []) as readonly string[],
        provides: (f.provides ?? []) as readonly string[],
        entrypoints: f.entrypoints,
    };
}


export interface ShaderFragment {
    uniforms?: string;
    functions: string;
    mainCode?: string;
    provides?: string[];
    requires?: string[];
    entrypoints?: { fragmentMain?: string };
}

/** Lightweight parameter schema carried by modules (engine will consume it). */
export type ModuleParameterKind =
    | "float" | "int" | "boolean"
    | "vec2"  | "vec3" | "vec4"
    | "mat3"  | "mat4";

export type ModuleParameterValue =
    | number
    | boolean
    | [number, number]
    | [number, number, number]
    | [number, number, number, number]
    | Float32Array
    | number[];

export type ModuleResetPolicy = "none" | "accumulation" | "program";

export interface ModuleParamSpec {
    name: string;
    kind: ModuleParameterKind;
    default: ModuleParameterValue;
    resetPolicy?: ModuleResetPolicy;
    min?: number;
    max?: number;
    step?: number;
    persistent?: boolean;
    description?: string;
    label?: string;
    category?: string;
}

export type ModuleParamSchema = ModuleParamSpec[];

/** Descriptor a module provides to the engine. */
export interface ShaderModuleDescriptor {
    id: ComponentID;            // you already have this in your file
    fragment: ShaderFragment;   // as before
    /** Optional parameter schema for auto-registration (engine consumes this). */
    parameters?: ModuleParamSchema;
}
