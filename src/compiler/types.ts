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
    /**
     * Material name of the AMBIENT medium (§2.4) — what region −1 is filled with; absent =
     * vacuum. A foggy world is just `ambientMedium: 'fog'`. material_of(-1) resolves to it.
     */
    ambientMedium?: string;
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
    | {
          type: 'constant';
          color: Vec3;
          intensity?: number;
          /** T3 opt-in (default FALSE — preserves pre-T3 witnesses): uniform-sphere NEE. */
          sampleAsLight?: boolean;
          /** P(select env) in NEE when finite samplable lights coexist. Default 0.5 (plan O1). */
          selectWeight?: number;
      }
    | {
          type: 'procedural';
          /**
           * GLSL expression in `dir` (unit vec3, world-space) → vec3 radiance. V1 pin: a
           * PURE function of dir — no live {param} uniforms (a live uniform desyncs the
           * direct-eval'd radiance from the frozen CDF; rebake-on-change is deferred).
           */
          glsl: GlslExpression;
          intensity?: number;
          /** Rotation about +Y in radians (live; applied in direction space, table unrotated). */
          rotation?: number;
          /** Importance-table resolution for the bake (plan O3). Default [512, 256]. */
          tableSize?: [number, number];
          /** T4: joins NEE/MIS via the baked CDF. Default TRUE for tabulated envs. */
          sampleAsLight?: boolean;
          /** P(select env) in NEE when finite samplable lights coexist. Default 0.5 (plan O1). */
          selectWeight?: number;
      }
    | {
          type: 'image';
          /** Radiance .hdr file (equirect). Loaded by the app into the extern registry. */
          url: string;
          intensity?: number;
          /** Rotation about +Y in radians (live uniform; the chart applies it). */
          rotation?: number;
          /** T3: joins NEE/MIS via the CDF machinery. Default TRUE for tabulated envs. */
          sampleAsLight?: boolean;
          /** P(select env) in NEE when finite samplable lights coexist. Default 0.5 (plan O1). */
          selectWeight?: number;
      };

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
    type: 'sphere' | 'plane' | 'quad';
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

// 'none' = no optical surface (§3.6): the region's boundary is a null interface — requires a
// medium block (an invisible object with no medium is an authoring error, Validator-enforced).
// 'emissive' is rejected by the Validator (review C4) — use emission on a surface model instead.
export type MaterialModel = 'lambert' | 'disney' | 'dielectric' | 'ggx' | 'emissive' | 'none';

/**
 * Medium of the region's INTERIOR (§3.5) — "materials of the interior". Homogeneous (V1-C1):
 * constants or {param} only; GLSL expressions are rejected until majorant declaration exists.
 * Segment behavior behind the volumetric-component seams (fable-volumetric-component.md).
 */
export interface MediumDescription {
    /** Absorption coefficient σ_a (per unit arc length). */
    sigma_a: MaterialProperty;
    /** Scattering coefficient σ_s. Default 0 (absorbing-only, e.g. tinted glass interior). */
    sigma_s?: MaterialProperty;
    /** Henyey–Greenstein anisotropy g ∈ (−1, 1). Default 0 (isotropic). */
    phase_g?: MaterialProperty;
}

export interface MaterialDescription {
    model: MaterialModel;
    albedo?: MaterialProperty;
    roughness?: MaterialProperty;    // ggx: alpha = roughness², clamped ≥ 1e-3 (mirrors are a delta model)
    f0?: MaterialProperty;           // ggx: normal-incidence reflectance — the conductor's color
    ior?: MaterialProperty;          // dielectric: region's interior IOR (→ generated ior_of table)
    transmittance?: MaterialProperty; // dielectric: interface tint; interior absorption is the medium's job (§4.4)
    emission?: MaterialProperty;
    /** Interior medium (§3.5/§4.4). Composes with any surface model; required for model 'none'. */
    medium?: MediumDescription;
    /**
     * §6.2 registry opt-in: an emissive material on an ANALYTIC quad/sphere object becomes a
     * samplable light (default true for those shapes; constant emission only in v1). On SDF
     * shapes `true` is a Validator error (V1-C2) — emissive SDFs stay path-only and still glow.
     */
    sampleAsLight?: boolean;
}

// --- Lights ---

export type LightDescription = PointLight | DirectionalLight | QuadLight | SphereLight;

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

/**
 * Rectangular area light (§6.2): DESUGARS to a synthesized emissive quad region — hittable,
 * visible in reflections, samplable via the registry. ONE-SIDED: emits from the
 * `cross(edge1, edge2)` side (impl-plan-area-lights pinned deviation). Emitted radiance
 * Le = color·intensity (no falloff — the falloff IS the solid-angle measure, §6.1).
 */
export interface QuadLight {
    kind: 'quad';
    corner: Vec3;
    edge1: Vec3;
    edge2: Vec3;
    intensity: number;
    color?: Vec3;
}

/** Spherical area light (§6.2): desugars like the quad; sampled via the visible cone. */
export interface SphereLight {
    kind: 'sphere';
    position: Vec3;
    radius: number;
    intensity: number;
    color?: Vec3;
}

// ============================================================================
// Render Strategy
// ============================================================================

/**
 * The strategy's three sections (fable-strategy-taxonomy.md — PINNED, July 2026):
 * scene + measurement define the integral; estimator defines the computation (bias-free
 * by contract — changing an estimator field must not change the converged image); view
 * defines the presentation (applied to the converged linear HDR quantity only).
 * Every new field declares its section; the section is its test contract (taxonomy §6.4).
 */
export interface RenderStrategy {
    id: string;
    measurement: MeasurementDescription;
    estimator: EstimatorDescription;
    view: ViewDescription;
}

/**
 * Defines the integral (with the scene): camera = the measurement functional W_j; the
 * remaining fields are TRUNCATIONS — measurement fields carrying a declared exact limit
 * (taxonomy §4, the bias ledger). Changing any field here changes what the render
 * converges TO; accumulation reset is mandatory on change (taxonomy §6.2).
 */
export interface MeasurementDescription {
    camera: CameraDescription;
    /** Which functional each pixel reports. 'radiance' is the sole occupant; debug
     *  measurements (§11.3 pdf-histogram, §11.4 repair counter, AO) arrive as new values. */
    response?: 'radiance';
    /** Truncation — limit: ∞ (Neumann partial sum; §7.2 counts surface + medium events). */
    maxBounces: number;
    /** Truncation — limit: 'full'. 'ignored' renders scattering media absorbing-only
     *  (the research A/B formerly expressed as volumeIntegrator 'none' on a scattering scene). */
    scattering?: 'full' | 'ignored';
    /** Truncation — limit: transparent-shadow refinement (contracts §10.2). The §6.3 v1
     *  policy (shadow rays treat dielectric interfaces as opaque), now a DECLARED bias. */
    shadows?: 'opaque-dielectrics';
    /** Truncation — limit: 'spectral' (contracts §8). RGB transport is a biased surrogate
     *  of spectral transport (projection does not commute with multiplication).
     *  'spectral' is reserved: Validator-rejected until §8 lands. */
    color?: 'rgb' | 'spectral';
}

/**
 * Defines the computation: an unbiased sampling scheme for the measurement. No field here
 * may change the converged image — cross-strategy convergence (§11.2) is the enforcement.
 * Estimator fields are provably safe as live uniforms (taxonomy §6.3).
 */
export interface EstimatorDescription {
    directLighting: 'none' | 'nee' | 'mis';
    /** Light-selection metric for NEE (compile-time). 'power' importance-samples brighter
     *  lights (spectrum_average(color·intensity)); 'uniform' is the naive baseline. Default 'power'. */
    lightSelection?: 'uniform' | 'power';
    /** null = off. Unbiased by construction (random termination WITH compensation) — the
     *  taxonomy's canonical estimator-side termination, vs maxBounces' measurement-side one. */
    russianRoulette: { startDepth: number } | null;
    /**
     * Volume distance-sampling method (§7.3 as amended by fable-volumetric-component.md §5),
     * consulted only when scattering is live (measurement.scattering 'full' + scattering
     * media present). 'analytic' = the v1 closed-form homogeneous body (V1-C1); 'raymarch'
     * is reserved for honest biased marching; the null-collision pair needs majorants —
     * all three rejected-not-removed. Default 'analytic'.
     * (The old volumeIntegrator 'none' override moved to measurement.scattering: 'ignored' —
     * it changes the integral, not the sampling; taxonomy §8.)
     */
    volumeSampling?: 'analytic' | 'raymarch' | 'delta-tracking' | 'ratio-tracking';
    /**
     * WHERE the medium direct-lighting estimate places its vertex (impl-plan-equiangular):
     * 'vertex' (default) scores NEE at the transmittance-sampled scatter vertex;
     * 'equiangular' scores once per segment at a vertex drawn ∝ 1/d²-to-light
     * (Kulla–Fajardo) — the variance win for small lights in fog. Estimator section:
     * variance only, same converged image (§11.2). V1: delta lights only and nee only
     * (Validator-enforced; area-light arms + placement-MIS are the deferred exits).
     */
    mediumLightSampling?: 'vertex' | 'equiangular';
    /**
     * Environment-sampler chart (T5, plan D11 — a swappable strategy axis): 'equirect' is
     * pbrt-v3's sinθ-weighted CDF (default); 'octahedral' is pbrt-v4's equal-area mapping
     * (constant Jacobian, no pole waste). The radiance integrand is IDENTICAL under both —
     * cross-chart convergence is a controlled experiment (the X-CHART witness).
     */
    envSampler?: 'equirect' | 'octahedral';
    /**
     * MIS compensation for the env importance table (pbrt-v4 / Karlík et al. 2019): build
     * the CDF from max(L − L̄, 0). Requires directLighting 'mis' (Validator-enforced) —
     * the deliberate pdf-0 regions are only unbiased when BSDF sampling covers them.
     */
    envCompensation?: boolean;
    accumulation: AccumulationDescription;
}

/** Defines the presentation — applied to the converged linear HDR quantity only
 *  (taxonomy §10: HDR export reads pre-tonemap accumulation, which IS this line). */
export interface ViewDescription {
    tonemap: DisplayDescription;
}

export type FisheyeProjection = 'equidistant' | 'equisolid' | 'stereographic' | 'orthographic';

export type CameraDescription =
    | { type: 'pinhole'; fov: Value<number> }
    | { type: 'thinlens'; fov: Value<number>; aperture: number; focusDistance: number }
    | { type: 'equirect' }
    | { type: 'orthographic'; scale: number }
    | { type: 'fisheye'; projection: FisheyeProjection; fov: number }   // fov = full angular field (radians)
    | { type: 'cylindrical'; hfov: number };                            // panorama: horizontal sweep (DEGREES); vertical follows the window (square pixels)

export type CameraType = CameraDescription['type'];

export type AccumulationDescription =
    | { type: 'average' }
    | { type: 'oneshot' }   // no accumulation — each frame shows the current sample (live preview / single-frame)
    | { type: 'exponential'; alpha: number }
    | { type: 'variance' };

export type DisplayDescription =
    | { type: 'reinhard'; exposure?: number }
    | { type: 'aces'; exposure?: number }
    | { type: 'agx'; exposure?: number }
    | { type: 'khronos'; exposure?: number }
    | { type: 'hable'; exposure?: number }
    | { type: 'gt'; exposure?: number }
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
     * Fixed pixel size (owner-approved contract EXTENSION, env-as-light T4): a framebuffer
     * with `size` allocates at exactly [width, height] and is EXEMPT from canvas resize.
     * Absent = canvas-sized (all pre-T4 behavior unchanged). Use case: bake targets whose
     * dimensions are data (an equirect table), not display geometry.
     */
    size?: [number, number];

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
    /** Origin label: 'glsl/core/structs.glsl' or 'generated:sdf-dispatch' */
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
