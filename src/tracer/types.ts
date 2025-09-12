// src/tracer/types.ts
import type { Plugin, Role } from "../core/types";
import type ShaderProgram from "../rendering/ShaderProgram";
import type UniformManager from "../systems/UniformManager";

export type NsToUniforms = Map<string, UniformManager>;

/** Compiled GPU artifact + uniform views for a specific plugin set */
export interface CompiledPipeline {
    plugins: Plugin[];       // resolved plugin set used to build this program (excludes controls)
    program: ShaderProgram;
    nsViews: NsToUniforms;   // per-namespace uniform views based on the assembler's prefixes
    key: string;             // cache key (for diagnostics)
    hash: string;            // fragment hash (for diagnostics)
}

/** Variant definition = named role overrides + its compiled pipeline */
export interface VariantRecord {
    name: string;
    overrides: Map<Role, Plugin>;  // roles to replace compared to base
    compiled?: CompiledPipeline;   // filled by buildAll()
    controls?: Plugin;             // optional controls override
}
