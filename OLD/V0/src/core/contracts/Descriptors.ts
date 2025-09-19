/**
 * Research Path Tracer — Core Contracts (v1)
 *
 * Purpose:
 *   Define the minimal, stable ABIs that all shader-providing modules (camera, tracer, world,
 *   film, developer) must conform to. This file is the “hinge” of the architecture:
 *   - No WebGL calls, no engine coupling.
 *   - Pure TypeScript types that describe module metadata + GLSL snippets.
 *   - Keeps public surface deliberately small so we can reason about versioning and tests.
 *
 * Versioning rules:
 *   - v1 adds symbols; never renames/removes without bumping MAJOR in `version`.
 *   - Each module declares the symbols it provides and the symbols it requires.
 *   - The assembler validates (provided ⊇ required) and the engine does not guess.
 *
 * Safety invariants (v1):
 *   - No preprocessor feature toggles in GLSL (#ifdef); one assembled shader per run mode.
 *   - Uniform names are module-local; the engine/assembler prefixes them by module id.
 *   - Semantic channels (e.g., 'radiance' to developer) are named explicitly in descriptors,
 *     never inferred by texture unit numbers.
 *
 * Testing guidance:
 *   - Unit test pure assembly logic against these types.
 *   - Do not unit test WebGL here; integration tests live in examples/ or e2e harness.
 */

/* -------------------------------------------------------------------------- */
/* Shared enums & literals                                                    */
/* -------------------------------------------------------------------------- */

export type ShaderStage = 'fragment'; // v1: only fragment. v2 may add 'compute' or 'vertex'.

/**
 * ABI symbol provided by a module at a given stage.
 * Examples:
 *   - Camera:   { name: 'generateRay', stage: 'fragment' }
 *   - Tracer:   { name: 'tracePixel',   stage: 'fragment' }
 *   - World:    { name: 'intersectScene', stage: 'fragment' }
 */
export interface ProvidedSymbol {
    readonly name: string;
    readonly stage: ShaderStage;
}

/* -------------------------------------------------------------------------- */
/* Uniform declaration                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Uniform declaration tells the engine two things:
 *   1) the GLSL type so it can type-check bindings, and
 *   2) the update cadence to enable future binders (per-frame vs. static).
 *
 * v1 types are the common scalar/vector/matrix set. Extend carefully in v2.
 */
export type GLSLType =
    | 'float' | 'int' | 'uint' | 'bool'
    | 'vec2' | 'vec3' | 'vec4'
    | 'ivec2' | 'ivec3' | 'ivec4'
    | 'uvec2' | 'uvec3' | 'uvec4'
    | 'mat3' | 'mat4'
    | 'sampler2D' | 'isampler2D' | 'usampler2D';

/** Cadence hints how often values change (optimization; no behavior tied in v1). */
export type Cadence = 'static' | 'per_frame' | 'per_view' | 'per_scene';

export interface UniformDecl {
    /** Unprefixed name as it appears inside the module’s GLSL declaration. */
    readonly name: string;
    /** GLSL type (see GLSLType literal union). */
    readonly type: GLSLType;
    /** Update cadence hint for future binders. */
    readonly cadence: Cadence;
}

/* -------------------------------------------------------------------------- */
/* Module descriptor (base)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The minimal descriptor for any shader-contributing module.
 * Every module must:
 *   - have a stable id and semver,
 *   - declare what it provides (symbols),
 *   - list what it requires (by name),
 *   - declare any uniforms it defines in its GLSL,
 *   - include its GLSL source snippet (no #version / no main()).
 */
export interface ModuleDescriptorBase {
    /** Globally unique, stable id. Use dotted namespaces, e.g., "camera.pinhole". */
    readonly id: string;
    /** Semver string. Changes in ABI must bump MAJOR. */
    readonly version: string;

    /** List of ABI symbols this module defines (e.g., 'generateRay', 'tracePixel'). */
    readonly provides: ReadonlyArray<ProvidedSymbol>;

    /** List of symbol names this module expects the assembly to provide. */
    readonly requires?: ReadonlyArray<string>;

    /**
     * Uniforms declared in this module’s GLSL (unprefixed).
     * The assembler will rewrite declarations and identifier uses to a prefixed form:
     *   original: "uniform float exposureEV;"
     *   rewritten: "uniform float g_tracer_flat_color_exposureEV;"
     */
    readonly uniforms?: ReadonlyArray<UniformDecl>;

    /**
     * GLSL snippet contributed by this module (ES 3.00 compatible).
     * Constraints (v1):
     *   - No `#version` lines.
     *   - No `main()` definition.
     *   - No `#ifdef` feature switches (assemble one concrete variant).
     *   - May contain helper functions and struct definitions local to this module.
     */
    readonly glsl: string;
}

/* -------------------------------------------------------------------------- */
/* Specializations (semantic descriptors)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Developer consumes semantic channels (e.g., 'radiance') by name.
 * The engine binds developer uniforms named `g_dev_<channel>`.
 * v1 keeps this as a ModuleDescriptorBase with an extra field to declare channels.
 */
export interface DeveloperDescriptor extends ModuleDescriptorBase {
    /** Semantic input channels required by this developer (e.g., ['radiance']). */
    readonly requiresChannels: ReadonlyArray<string>;
}

/**
 * Film declares which semantic channels it outputs.
 * The engine allocates/render-targets accordingly and routes by channel name.
 */
export interface FilmOutput {
    /** Semantic channel name (e.g., 'radiance'). */
    readonly name: string;
    /** Storage format hint (engine chooses closest supported). */
    readonly format: 'rgba8' | 'rgba16f' | 'r11f_g11f_b10f'; // extend in v2 if needed
}

export interface FilmDescriptor extends ModuleDescriptorBase {
    /** Declared outputs, used for allocation/routing by name. */
    readonly outputs: ReadonlyArray<FilmOutput>;
}

/* -------------------------------------------------------------------------- */
/* System uniforms (reserved)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Names reserved for the engine’s system prelude. Modules may *read* these but must not declare them.
 * The assembler injects declarations; the engine binds their values each frame.
 *
 *  - g_sys_resolution : vec2 (pixel size of the current render target)
 *  - g_sys_frame      : int  (monotonic frame counter)
 *  - g_sys_time       : float(seconds since engine init)
 */
export const SYSTEM_UNIFORMS = {
    resolution: 'g_sys_resolution',
    frame: 'g_sys_frame',
    time: 'g_sys_time',
} as const;

/* -------------------------------------------------------------------------- */
/* Validation helpers (pure; testable)                                        */
/* -------------------------------------------------------------------------- */

/**
 * Validate that all required symbol names are present in the provided set.
 * Pure function used by assemblers; unit test this function directly.
 */
export function validateRequirements(
    moduleId: string,
    requires: ReadonlyArray<string> | undefined,
    providedNames: ReadonlySet<string>
): void {
    if (!requires || requires.length === 0) return;
    for (const name of requires) {
        if (!providedNames.has(name)) {
            throw new Error(
                `[Contracts] Module '${moduleId}' requires '${name}' which is not provided in this assembly.`
            );
        }
    }
}

