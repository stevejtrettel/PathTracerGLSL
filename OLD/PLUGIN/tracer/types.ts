// src/tracer/types.md
import type { Plugin } from "../core/types";
import type ShaderProgram from "../rendering/ShaderProgram";
import type UniformManager from "../systems/UniformManager";

export type NsToUniforms = Map<string, UniformManager>;

/** Compiled GPU artifact + uniform views for a specific plugin set (shader participants only) */
export interface CompiledPipeline {
    plugins: Plugin[];       // shader-participating plugins used to build this program
    program: ShaderProgram;
    nsViews: NsToUniforms;   // per-namespace uniform views based on the assembler's prefixes
    key: string;             // cache key (for diagnostics)
    hash: string;            // fragment hash (for diagnostics)
}

/** Variant definition = named overrides + its compiled pipeline.
 *  Note: variants here only affect the shader-participating set.
 */
export interface VariantRecord {
    name: string;
    // We keep this as a Role→Plugin map for now, since your Engine is role-based.
    overrides: Map<string, Plugin>;
    compiled?: CompiledPipeline;   // filled by buildAll()
}
