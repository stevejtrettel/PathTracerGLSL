// compiler/types.ts

import type { UniformBinding, ParameterMetadata } from '../engine/types.js';

// ============================================================================
// Utility types
// ============================================================================

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

// ============================================================================
// Scene Description
// ============================================================================

export interface SceneDescription {
    id: string;
    name?: string;
    ambientSpace: AmbientSpaceDescription;
    objects: ObjectDescription[];
    materials: Record<string, MaterialDescription>;
    lights: LightDescription[];
    /** What a ray sees when it hits nothing. Defaults to `none` (black). */
    environment?: EnvironmentDescription;
}

export interface AmbientSpaceDescription {
    type: 'euclidean' | 'hyperbolic' | 'spherical';
    parameters?: { curvature?: number };
}

// --- Environment (what a missed ray sees) ---
//
// Two families (see docs): ANALYTIC (`none`, `constant`) — closed-form radiance,
// no texture/CDF; and TABULATED (`procedural`, `image`) — radiance from an equirect
// table + a CDF built from it for importance sampling. A procedural sky is a recipe
// for a table (evaluate the formula, uniforms optionally live); for a fixed render it
// freezes into an image. Only the analytic pair is implemented so far.

export type EnvironmentDescription =
    | { type: 'none' }
    | { type: 'constant'; color: Vec3; intensity?: number }
    | { type: 'procedural'; glsl: GlslExpression }   // tabulated — not yet implemented
    | { type: 'image'; url: string };                // tabulated — not yet implemented

// --- Objects ---

export type ObjectDescription = SDFObject | AnalyticObject | MeshObject;

export interface SDFObject {
    kind: 'sdf';
    sdf: StandardSDF | CustomSDF;
    material: string;
    transform?: Transform;
}

export interface AnalyticObject {
    kind: 'analytic';
    shape: StandardAnalytic;
    material: string;
    transform?: Transform;
}

export interface MeshObject {
    kind: 'mesh';
    data: Float32Array;
    material: string;
    transform?: Transform;
}

export interface StandardSDF {
    type: 'sphere' | 'plane' | 'box' | 'torus' | 'capsule';
    parameters: Record<string, number | number[]>;
}

export interface CustomSDF {
    type: 'custom';
    glsl: string;
    imports?: string[];
}

export interface StandardAnalytic {
    type: 'sphere' | 'plane';
    parameters: Record<string, number | number[]>;
}

export interface Transform {
    position?: Vec3;
    rotation?: Vec3;
    scale?: number | Vec3;
}

// --- Value<T>: constant or uniform-driven parameter (contracts §2.8) ---

/**
 * A property that is either a constant `T` (baked into the shader) or a reference
 * to a live parameter (`{ param }`) that the compiler turns into a uniform +
 * ParameterMetadata. Any numeric property may be a `Value<T>`.
 */
export type Value<T> = T | ValueParam<T>;

export interface ValueParam<T> {
    /** Parameter path, e.g. 'camera.fov'. The uniform is named from this. */
    param: string;
    default?: T;
    min?: number;
    max?: number;
}

export function isValueParam<T>(v: Value<T>): v is ValueParam<T> {
    return typeof v === 'object' && v !== null && !Array.isArray(v) && 'param' in v;
}

// --- Materials ---

export interface GlslExpression {
    kind: 'glsl';
    source: string;
}

export type MaterialProperty = number | Vec3 | GlslExpression | ValueParam<number | Vec3>;

export function isGlslExpression(v: unknown): v is GlslExpression {
    return v != null && typeof v === 'object' && (v as GlslExpression).kind === 'glsl';
}

export type MaterialModel = 'lambert' | 'disney' | 'dielectric' | 'emissive';

export interface MaterialDescription {
    model: MaterialModel;
    albedo?: MaterialProperty;
    roughness?: MaterialProperty;
    metallic?: MaterialProperty;
    ior?: MaterialProperty;          // dielectric: region's interior IOR (→ generated ior_of table)
    transmittance?: MaterialProperty; // dielectric: interface tint; interior absorption is the medium's job (§4.4)
    emission?: MaterialProperty;
}

// --- Lights ---

export type LightDescription = PointLight | DirectionalLight;

export interface PointLight {
    kind: 'point';
    position: Vec3;
    intensity: number;
    color?: Vec3;
}

export interface DirectionalLight {
    kind: 'directional';
    direction: Vec3;
    intensity: number;
    color?: Vec3;
}

// ============================================================================
// Render Strategy
// ============================================================================

export interface RenderStrategy {
    id: string;
    transport: TransportDescription;
    camera: CameraDescription;
    accumulation: AccumulationDescription;
    display: DisplayDescription;
}

export interface TransportDescription {
    maxBounces: number;
    directLighting: 'none' | 'nee' | 'mis';
    /** Light-selection metric for NEE (compile-time). 'power' importance-samples brighter
     *  lights (spectrum_average(color·intensity)); 'uniform' is the naive baseline. Default 'power'. */
    lightSelection?: 'uniform' | 'power';
    russianRoulette: { enabled: boolean; startDepth: number };
    samplesPerFrame: number;
}

export type CameraDescription =
    | { type: 'pinhole'; fov: Value<number> }
    | { type: 'thinlens'; fov: Value<number>; aperture: number; focusDistance: number }
    | { type: 'orthographic'; scale: number };

export type AccumulationDescription =
    | { type: 'average' }
    | { type: 'exponential'; alpha: number }
    | { type: 'variance' };

export type DisplayDescription =
    | { type: 'reinhard'; exposure?: number }
    | { type: 'aces'; exposure?: number }
    | { type: 'filmic'; exposure?: number }
    | { type: 'none' };

/**
 * GLSL shader program (vertex + fragment)
 */
export interface ShaderProgram {
    vertex: string;
    fragment: string;
}

/**
 * Texture format for framebuffer attachments
 */
export type FramebufferFormat = 'rgba32f' | 'rgba16f' | 'rgba8' | 'r32f';

/**
 * Framebuffer configuration
 *
 * Defines a GPU framebuffer and its associated texture(s)
 */
export interface FramebufferConfig {
    /** Unique identifier for this framebuffer */
    id: string;

    /**
     * Framebuffer type:
     * - 'screen': default framebuffer (canvas)
     * - 'texture': single framebuffer with one texture
     * - 'double_buffer': ping-pong pair for accumulation
     */
    type: 'screen' | 'texture' | 'double_buffer';

    /**
     * Texture format(s)
     *
     * Single attachment:
     * - format: 'rgba32f' → single texture at COLOR_ATTACHMENT0
     *
     * Multiple Render Targets (MRT):
     * - format: ['rgba32f', 'rgba8', 'rgba16f'] → attachments at locations 0, 1, 2
     *
     * Array index corresponds to attachment location (COLOR_ATTACHMENT0 + index)
     *
     * Supported formats:
     * - rgba32f: 32-bit float RGBA (HDR accumulation)
     * - rgba16f: 16-bit float RGBA (HDR intermediate)
     * - rgba8: 8-bit RGBA (LDR display)
     * - r32f: 32-bit float single channel
     */
    format?: FramebufferFormat | FramebufferFormat[];
}

/**
 * Buffer swap instruction
 *
 * Describes how to swap framebuffers after rendering
 */
export interface SwapInstruction {
    /**
     * Swap type:
     * - 'swap': flip current/previous for double_buffer (ping-pong)
     * - 'rotate': rotate through queue (for temporal history)
     */
    type: 'swap' | 'rotate';

    /** Buffer IDs to swap/rotate */
    buffers: string[];
}

/**
 * Render pass execution specification
 */
export interface RenderPass {
    /** Unique identifier for this pass */
    id: string;

    /** Which shader to execute */
    shader: string;

    /**
     * Input resources (textures, etc.)
     *
     * For MRT framebuffers, use ':N' syntax to specify attachment:
     * - 'u_previous': 'accumulation_previous' → reads attachment 0
     * - 'u_albedo': 'accumulation_previous:1' → reads attachment 1
     * - 'u_normal': 'accumulation_previous:2' → reads attachment 2
     */
    inputs?: {
        textures?: Record<string, string>;  // uniform name → texture id (with optional :N)
    };

    /**
     * Output framebuffer id(s)
     *
     * Single output:
     * - output: 'accumulation_current' → writes to attachment 0
     *
     * Multiple Render Targets (MRT) - use array with ':N' syntax:
     * - output: ['accumulation_current:0', 'accumulation_current:1', 'accumulation_current:2']
     *
     * For MRT, fragment shader must declare multiple outputs:
     * layout(location = 0) out vec4 o_radiance;
     * layout(location = 1) out vec4 o_albedo;
     *
     * Note: All MRT outputs must reference the same base framebuffer
     */
    output: string | string[];

    /** Execution control */
    execution: {
        /**
         * Execution type:
         * - 'once': execute once per frame
         * - 'loop': execute multiple times (iterations specified)
         */
        type: 'once' | 'loop';

        /** Number of iterations (for 'loop' type) */
        iterations?: number;

        /**
         * Clear framebuffer before rendering
         * For MRT, clears all attachments
         */
        clearBeforeRender?: boolean;
    };
}

/**
 * Render pipeline specification
 *
 * Complete description of GPU work to execute.
 * Engine executes this blindly without knowing about scene/strategy.
 */
export interface RenderPipeline {
    /** Framebuffer definitions */
    framebuffers: FramebufferConfig[];

    /** Render passes in execution order */
    passes: RenderPass[];

    /** Post-frame operations (buffer swaps, etc.) */
    postFrame?: {
        swaps?: SwapInstruction[];
    };
}

/**
 * Block-level source map for error reporting.
 * Maps line ranges in assembled GLSL back to source blocks.
 */
export interface SourceMap {
    /** Which shader this source map is for */
    shaderId: string;

    /** Ordered block mappings covering all lines */
    blocks: SourceBlockMapping[];

    /** Full assembled GLSL source for error context display */
    assembledSource?: string;
}

/**
 * A line range in assembled GLSL mapped to its source block.
 */
export interface SourceBlockMapping {
    /** Origin label: 'glsl/structs.glsl' or 'generated:sdf-dispatch' */
    origin: string;

    /** First line in assembled output (1-based) */
    startLine: number;

    /** Last line in assembled output (1-based, inclusive) */
    endLine: number;
}

/**
 * Export target specification
 *
 * Defines how to export a specific output (HDR, LDR, AOVs, etc.)
 * from a rendered frame.
 */
export interface ExportTarget {
    /** Which framebuffer to read from */
    bufferId: string;

    /** Data format to read */
    format: 'float' | 'byte';

    /** Optional: number of channels (1=depth, 3=RGB, 4=RGBA). Default: 4 */
    channels?: 1 | 3 | 4;

    /**
     * Which color attachment to read (for MRT framebuffers)
     * Defaults to 0 if not specified
     *
     * Example:
     * - attachment: 0 → reads from COLOR_ATTACHMENT0 (radiance)
     * - attachment: 1 → reads from COLOR_ATTACHMENT1 (albedo)
     * - attachment: 2 → reads from COLOR_ATTACHMENT2 (normal)
     */
    attachment?: number;
}

/**
 * Compiled renderer output
 *
 * Complete output from Compiler, input to Engine.
 * Contains everything Engine needs to execute rendering.
 */
export interface CompiledRenderer {
    /** Unique identifier for this renderer */
    id: string;

    /** Compiled GLSL shaders (shader id → program) */
    shaders: Map<string, ShaderProgram>;

    /** Execution pipeline specification */
    pipeline: RenderPipeline;

    /** Parameter → uniform bindings for parameter system */
    uniforms: UniformBinding[];

    /** Source maps for error reporting (shader id → source map) */
    sourceMaps?: Map<string, SourceMap>;

    /** Optional: parameter metadata for UI */
    parameters?: Record<string, ParameterMetadata>;

    /**
     * Optional: export targets for reading rendered outputs
     *
     * Standard exports:
     * - 'hdr': HDR radiance (float, RGBA)
     * - 'ldr': LDR display (byte, RGBA)
     *
     * Custom exports (AOVs):
     * - 'albedo', 'normal', 'depth', etc.
     */
    exportTargets?: Record<string, ExportTarget>;
}

/**
 * Compiler interface
 *
 * Compiles scene description + render strategy into executable renderer
 */
export interface ICompiler {
    /**
     * Compile a scene + strategy into a renderer
     *
     * @param scene - Scene description (geometry, materials, lights)
     * @param strategy - Rendering strategy (algorithms, settings)
     * @returns Compiled renderer ready for Engine execution
     */
    compile(scene: SceneDescription, strategy: RenderStrategy): CompiledRenderer;
}
