// compiler/generate/features/types.ts
//
// FeatureContribution — the unit each feature planner returns (contracts §2.10).
// A feature owns everything it contributes to the shader in one place: its code
// (fixed .glsl snippets AND generated-per-scene blocks), its #defines, its
// uniforms, its parameter metadata, and any external textures. The Generator
// concatenates all contributions into the single flat CompiledRenderer.

import type { ShaderBlock } from '../ShaderIR.js';
import type { PlannedUniform } from '../../plan/types.js';
import type { ParameterMetadata } from '../../../engine/types.js';

/** An external texture a feature's shader needs (e.g. an environment map). */
export interface PlannedTexture {
    /** Sampler uniform name, e.g. 'u_envMap'. */
    name: string;
    /** Resource reference, e.g. 'extern:env_map' (resolved by the engine registry). */
    source: string;
}

export interface FeatureContribution {
    /** Shader code — fixed snippets and/or generated-per-scene blocks. */
    blocks: ShaderBlock[];
    /** #define NAME value. */
    defines: Record<string, string>;
    /** Feature-declared uniforms (+ their parameter paths / defaults). */
    uniforms: PlannedUniform[];
    /** UI/behavior metadata for parameter-driven uniforms, keyed by param path. */
    parameters: Record<string, ParameterMetadata>;
    /** External textures (unused until the environment feature lands). */
    textures: PlannedTexture[];
}

/** An empty contribution — convenient base for features that only add some fields. */
export function emptyContribution(): FeatureContribution {
    return { blocks: [], defines: {}, uniforms: [], parameters: {}, textures: [] };
}
