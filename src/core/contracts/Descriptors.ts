/**
 * Purpose: Central, shared type contracts for research modules and the engine.
 * Public contract: Exported interfaces describing uniforms, entrypoints, resources,
 *                  and specialized descriptors (Film, Developer) used by the assembler/binder.
 * Inputs: Imported by engine (AssemblerLite, UniformBinder) and research modules.
 * Outputs: Type safety + a single source of truth for module shape.
 * Lifecycle: Stable; evolves only when ABI expands. Avoid churn.
 * Invariants:
 *  - No engine or WebGL imports here.
 *  - No runtime code; types and doc only.
 *  - Prefixing is an engine concern (assembler), not expressed in these types.
 */

// ------------------------------------------------------------
// Primitive building blocks: uniforms, entry points, resources
// ------------------------------------------------------------

/** Primitive uniform value types allowed in the shader ABI. */
export type UniformType =
    | 'float' | 'int' | 'bool'
    | 'vec2'  | 'vec3' | 'vec4'
    | 'mat3'  | 'mat4';

/** Cadence hints help the binder avoid redundant sets. */
export type UniformCadence = 'static' | 'on_resize' | 'per_frame';

/**
 * A single uniform declaration exposed by a module.
 * The assembler will prefix the actual GLSL uniform name using the module id.
 * The binder sets values from a ParameterStore snapshot each frame.
 */
export interface UniformDecl {
    /** Logical parameter path (e.g., "developer.exposure", "camera.fov"). */
    name: string;
    /** GLSL-compatible type. */
    type: UniformType;
    /** How often this value can change. Guides binding policy. */
    cadence: UniformCadence;
    /**
     * Optional: future “derive” support could map a high-level param to multiple uniforms
     * or transform values (e.g., degrees→radians). Keep out for now to stay minimal.
     */
}

/** Which shader stage an entrypoint belongs to. (We only use fragment today.) */
export type EntryPointStage = 'fragment' | 'vertex';

/**
 * A function the module PROVIDES to the assembled shader (e.g., "develop", "accumulate", "tracePixel").
 * The assembler validates requires/provides across modules before emitting a single program.
 */
export interface EntryPointDecl {
    name: string;       // e.g., "develop"
    stage: EntryPointStage;
}

/** GPU resource kinds we may bind. Keep this minimal for v1. */
export type ResourceKind = 'texture2D' | 'texture2DArray' | 'buffer';

/** Resource access pattern; helps the engine enforce correct binding. */
export type ResourceAccess = 'read' | 'write' | 'readwrite';

/** Allocation lifetime policy. */
export type ResourceLifetime = 'per_frame' | 'persistent';

/**
 * Minimal texture format union. Extend as you add formats.
 * Keep strings so backends can support device-specific variants cleanly.
 */
export type TextureFormat = 'rgba16f' | 'r32f' | 'rg16f' | 'rgba8';

/** Size description for textures/buffers. */
export interface ResourceSizeSpec {
    /** "resolution" ties to the active render resolution; "custom" requires explicit w/h. */
    expr: 'resolution' | 'custom';
    width?: number;
    height?: number;
    layers?: number; // for texture arrays
}

/**
 * Declarative resource spec. Modules do not create GL objects—engine allocates and binds by this spec.
 * Names are logical (semantic) and resolved by the engine at assembly/bind time.
 */
export interface ResourceDecl {
    name: string;                // logical name, e.g., "radiance", "variance", "lightTable"
    kind: ResourceKind;          // texture2D | texture2DArray | buffer
    format: TextureFormat | string;
    access: ResourceAccess;      // read | write | readwrite
    lifetime: ResourceLifetime;  // per_frame | persistent
    size: ResourceSizeSpec;      // resolution | custom
}

// ------------------------------------------------------------
// Base module descriptor shared by all module kinds
// ------------------------------------------------------------

/**
 * Every module descriptor extends this base:
 *  - id/version are used for prefixing and program feature hashing.
 *  - provides/requires let AssemblerLite validate the final graph.
 *  - uniforms/resources are optional; many modules are pure-GLSL.
 *  - glsl contains the source fragment this module contributes.
 */
export interface ModuleDescriptorBase {
    /** Stable, human-readable id (e.g., "developer.linear-srgb"). */
    id: string;
    /** Semantic version. Bump when code shape/ABI changes. */
    version: string;

    /** Entry points this module implements (e.g., "develop"). */
    provides: EntryPointDecl[];

    /**
     * Symbol names this module *calls* but does not define.
     * The assembler ensures some other module provides them. (e.g., "sceneIntersect", "generateRay")
     */
    requires?: string[];

    /** Uniform parameters this module exposes to the ParameterStore. */
    uniforms?: UniformDecl[];

    /**
     * GPU resources this module expects the engine to allocate and bind.
     * Most v1 modules won’t need this. Films and advanced tracers often do.
     */
    resources?: ResourceDecl[];

    /**
     * Raw GLSL fragment(s) contributed by this module.
     * The assembler prefixes symbols and emits a single program with a thin glue main().
     */
    glsl: string;
}

// ------------------------------------------------------------
// Film & Developer specific descriptors (what you need tonight)
// ------------------------------------------------------------

/** Semantic film output channel declaration. The engine routes by name, not by hardcoded texture vars. */
export interface FilmOutputDecl {
    name: string;           // semantic channel name, e.g., "radiance", "variance", "albedo", "normal"
    format: TextureFormat | string;
}

/**
 * FilmDescriptor:
 *  - Provides an "accumulate" entrypoint.
 *  - Declares one or more semantic output channels (v1: just "radiance").
 *  - The engine manages ping-pong for any channel that persists across frames.
 */
export interface FilmDescriptor extends ModuleDescriptorBase {
    /** Must provide "accumulate" (fragment). */
    provides: [{ name: 'accumulate'; stage: 'fragment' }];

    /** Semantic outputs produced by this film. v1: [{ name: 'radiance', format: 'rgba16f' }]. */
    outputs: FilmOutputDecl[];

    // Note: inputs are implied by uniform names (engine injects sampler2D bindings),
    // e.g., u_prevRadiance, u_traceColor; keep uniform names logical and let assembler prefix them.
}

/**
 * DeveloperDescriptor:
 *  - Provides a "develop" entrypoint.
 *  - States which semantic channels it needs (e.g., "radiance").
 *  - Engine binds those channels to well-known uniforms (e.g., g_dev_radiance) when assembling.
 */
export interface DeveloperDescriptor extends ModuleDescriptorBase {
    /** Must provide "develop" (fragment). */
    provides: [{ name: 'develop'; stage: 'fragment' }];

    /** Semantic channels this developer consumes (engine binds them by name). */
    requiresChannels: string[]; // e.g., ['radiance']
}

// ------------------------------------------------------------
// (Optional) forward-looking placeholders (add when needed)
// ------------------------------------------------------------

// export interface TracerDescriptor extends ModuleDescriptorBase { /* provides: tracePixel; optional scratch resources */ }
// export interface CameraDescriptor extends ModuleDescriptorBase { /* provides: generateRay; optional cameraSample/cameraEval */ }
// export interface SamplerDescriptor extends ModuleDescriptorBase { /* provides: initStream/next1D/next2D; declares domain metadata */ }
// export interface WorldFragmentDescriptor extends ModuleDescriptorBase { /* provides: sceneIntersect, localFrame, etc. */ }

/*
 * Usage example (Developer):
 *
 * import type { DeveloperDescriptor } from '@/core/contracts/Descriptors';
 *
 * export const LinearSRGB: DeveloperDescriptor = {
 *   id: 'developer.linear-srgb',
 *   version: '1.0.0',
 *   provides: [{ name: 'develop', stage: 'fragment' }],
 *   requiresChannels: ['radiance'],
 *   uniforms: [{ name: 'exposure', type: 'float', cadence: 'per_frame' }],
 *   glsl: `...`
 * };
 *
 * The engine’s assembler:
 *  - Validates 'develop' is unique.
 *  - Injects semantic sampler uniforms for required channels (e.g., g_dev_radiance).
 *  - Prefixes module uniforms (e.g., exposure → g_developer_linear_srgb_exposure).
 *  - Emits one fragment program without #ifdefs.
 */
