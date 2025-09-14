/**
 * Purpose: Assemble one minimal fragment shader from module fragments with prefixing and requires/provides validation.
 * Public contract: function assemble(mods, sysUniforms) → { fragmentSource, providesSet, symbolMap }
 * Inputs: Array<{id, provides, requires, glsl, uniforms?}>, reserved engine uniforms (resolution/frame/time), World/Photography selections.
 * Outputs: Single fragment shader string; symbol table for diagnostics; error if missing providers or duplicate entrypoints.
 * Lifecycle: Called on pipeline build; run again only when module set changes.
 * Invariants: No runtime #ifdefs; deterministic module order (dependency topological + stable tiebreak); consistent prefixing g_<mod>_.
 */
