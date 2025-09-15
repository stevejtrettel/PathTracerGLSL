/**
 * Purpose: Centralize engine-local shader type shapes used by the compile/link/assemble path.
 * Public contract: export ShaderSources (vertex/fragment source pair for program creation).
 * Inputs: Imported by ShaderProgram and AssemblerLite; never by research modules.
 * Outputs: Type-only API; no runtime side effects.
 * Lifecycle: Stable; grows only as the engine shader toolchain needs new shapes.
 * Invariants:
 *  - No WebGL calls here (types only).
 *  - Engine-specific (do not import from research modules).
 *  - Keep minimal; avoid leaking engine internals into core.
 */

/** GLSL sources for a single program. Vertex is a small template; fragment is assembled. */
export type ShaderSources = {
    vertex: string;
    fragment: string;
};
