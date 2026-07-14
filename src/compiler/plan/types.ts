// compiler/plan/types.ts

import type { MaterialModel, Vec3, GlslExpression, FramebufferFormat, Value, ValueParam, EnvironmentDescription } from '../types.js';

// ============================================================================
// Program Description — what the generated program does
// ============================================================================

/**
 * The complete description of the generated program — the compiler's "link map"
 * (impl-plan-decision-hoist T2). The Planner builds it from scene features + strategy;
 * it is the ONLY decision record the Generator may read (plus the RenderPlan data
 * tables). Feature generators never read analyzer facts or re-derive decisions —
 * every "does this program contain X" question is answered here, once.
 *
 * Sections mirror the strategy taxonomy (fable-strategy-taxonomy.md): measurement
 * (with the scene, defines the integral), estimator (the computation — bias-free by
 * contract), view (presentation). All fields are RESOLVED: defaults applied, no
 * optionals — a ProgramDescription is a closed, serializable artifact (it has its own
 * structural snapshot test).
 */
export interface ProgramDescription {
    /** Defines the integral (taxonomy §2): camera = W_j; the rest are truncations
     *  (the bias ledger, each with a declared exact limit — taxonomy §4). */
    measurement: {
        camera: CameraDesc;
        response: 'radiance';
        maxBounces: number;
        scattering: 'full' | 'ignored';
        shadows: 'opaque-dielectrics';
        color: 'rgb';
    };
    /** Defines the computation (taxonomy §3): no field here may change the converged
     *  image — §11.2 cross-strategy convergence is the enforcement. */
    estimator: {
        /** null = BSDF-only transport (no NEE machinery in the program at all). */
        lighting: LightingDesc | null;
        russianRoulette: { startDepth: number } | null;
        /** 'analytic' iff scattering arms are live (media.scatteringArms); 'none'
         *  otherwise. Future null-collision methods are new values here. */
        volumeSampling: 'none' | 'analytic';
        /** Medium NEE vertex placement (impl-plan-equiangular): 'vertex' = at the
         *  transmittance-sampled scatter vertex (event site); 'equiangular' = per
         *  segment, drawn ∝ 1/d²-to-light. Meaningful only when lighting ≠ null and
         *  scattering arms are live; 'vertex' otherwise. */
        mediumLightSampling: 'vertex' | 'equiangular';
        /** T5 strategy axis (plan D11): which chart the env sampler's CDF table lives
         *  in, and whether the table is MIS-compensated. Radiance is chart-independent. */
        envSampler: { chart: 'equirect' | 'octahedral'; compensation: boolean };
        accumulation: AccumulationDesc;
    };
    /** Presentation — applied to the converged linear HDR quantity only (taxonomy §10). */
    view: {
        tonemap: TonemapDesc;
    };

    // ——— Link tables: what THIS program contains. Decisions, not analyzer facts —
    // the Planner derives them once; features only read.
    intersection: IntersectionDesc;
    materials: MaterialsDesc;
    media: MediaDesc;
    emitters: EmittersDesc;
    environment: EnvironmentDescription;
    /** The env participates in NEE/MIS as a light (env-as-light T3/D6) — drives the
     *  selection codegen, the miss-branch w-bookkeeping, and env sampler emission. */
    environmentSamplable: boolean;
}

/** What media machinery this program contains (volumetric-component seams). */
export interface MediaDesc {
    /** Any medium block or ambientMedium: media tables + medium_sample seam exist. */
    present: boolean;
    /** Scattering media present AND the measurement computes them (scattering 'full'):
     *  phase functions + the channel-MIS scattering arms exist. Equivalent to
     *  estimator.volumeSampling !== 'none' — kept explicit for readers. */
    scatteringArms: boolean;
    /** Some material is model 'none' (§3.6): the null-crossing branch exists. */
    nullInterfaces: boolean;
    /** Media AND NEE: the spectral segment walker (shadow_media) replaces the boolean
     *  fast path (shadow_opaque) behind the §6.3 contract. */
    shadowWalker: boolean;
}

/** What samplable-emitter machinery this program contains (§6.2). */
export interface EmittersDesc {
    /** Some light has a region: light_of table + §6.2 emission w-bookkeeping exist. */
    samplable: boolean;
    /** samplable AND mis: the generated lighting_pdf MIS query is emitted. */
    lightingPdf: boolean;
}

export type IntersectionDesc =
    | { method: 'raymarch' };

export interface MaterialsDesc {
    models: MaterialModel[];
}

export type LightingDesc =
    | { method: 'nee' | 'mis'; selection: 'uniform' | 'power' };

// Mirrors CameraDescription (compiler/types.ts) — the ProgramDescription is the complete
// link map, so every strategy-side camera variant must exist here for Generate to read.
// Registered occupants (camera/index.ts) are pinhole + thinlens; orthographic is
// type-declared but unregistered → Validator-rejected (reserved-not-removed).
export type CameraDesc =
    | { type: 'pinhole'; fov: Value<number> }
    | { type: 'thinlens'; fov: Value<number>; aperture: number; focusDistance: number }
    | { type: 'equirect' }
    | { type: 'orthographic'; scale: number }
    | { type: 'fisheye'; projection: 'equidistant' | 'equisolid' | 'stereographic' | 'orthographic'; fov: number }
    | { type: 'cylindrical'; hfov: number };

export type AccumulationDesc =
    | { type: 'average' }
    | { type: 'exponential'; alpha: number }
    | { type: 'variance' };

export type TonemapDesc =
    | { type: 'reinhard'; exposure?: number }
    | { type: 'aces'; exposure?: number }
    | { type: 'filmic'; exposure?: number }
    | { type: 'none' };

// ============================================================================
// Planned Pipeline — how the GPU program executes
// ============================================================================

export interface PlannedPipeline {
    // format array = MRT (one attachment per entry); output array = the MRT pass's
    // draw buffers (`id:N` refs). Mirrors the engine-facing FramebufferConfig/RenderPass.
    framebuffers: Array<{ id: string; type: 'screen' | 'double_buffer' | 'texture'; format?: FramebufferFormat | FramebufferFormat[] }>;
    passes: Array<{ role: string; inputs: Record<string, string>; output: string | string[] }>;
    swaps: Array<{ buffers: string[] }>;
}

/**
 * Resolved SDF object for code generation.
 * All parameters are concrete numbers ready to bake into GLSL.
 */
export interface PlannedSDFObject {
    index: number;
    materialId: number;
    sdfType: 'sphere' | 'plane' | 'box' | 'torus' | 'capsule';
    parameters: Record<string, number | number[]>;
    translation?: Vec3;
}

/**
 * Resolved analytic object for code generation — intersected in closed form (a second
 * geometry backend behind scene_intersect). `index` shares the region-id space with SDF
 * objects (regions are globally unique — §2.3), so material_of() spans both.
 */
export interface PlannedAnalyticObject {
    index: number;
    materialId: number;
    shapeType: 'sphere' | 'plane' | 'quad';
    parameters: Record<string, number | number[]>;
}

/**
 * Resolved interior medium (§3.5) — constants/params only (V1-C1; the Validator rejects GLSL
 * expressions, the generator backstop-throws like ior).
 */
export interface PlannedMedium {
    sigma_a: Vec3 | GlslExpression | ValueParam<Vec3>;
    sigma_s: Vec3 | GlslExpression | ValueParam<Vec3>;
    phase_g: number | GlslExpression | ValueParam<number>;
}

/**
 * Resolved material for code generation.
 * Each property is either a constant value or a GLSL expression string.
 */
export interface PlannedMaterial {
    id: number;
    name: string;
    model: MaterialModel;
    albedo: Vec3 | GlslExpression | ValueParam<Vec3>;
    emission: Vec3 | GlslExpression | ValueParam<Vec3>;
    roughness: number | GlslExpression | ValueParam<number>;
    f0: Vec3 | GlslExpression | ValueParam<Vec3>;               // ggx normal-incidence reflectance
    transmittance: Vec3 | GlslExpression | ValueParam<Vec3>;    // dielectric interface tint
    ior: number | GlslExpression | ValueParam<number>;          // → generated ior_of table (expressions rejected)
    medium: PlannedMedium | null;                               // interior medium (§3.5); null = no medium block
}

/**
 * Resolved samplable-light registry entry (§6.2). Explicit area lights DESUGAR into a
 * synthesized emissive region + one of these; sampleAsLight emitters contribute one per
 * region (two objects sharing an emissive material = two lights). Registry order = light id
 * = CDF order. Delta kinds carry no region.
 */
export interface PlannedLight {
    id: number;
    kind: 'point' | 'directional' | 'quad' | 'sphere';
    position?: Vec3;      // point; sphere center
    direction?: Vec3;     // directional (rejected in v1)
    corner?: Vec3;        // quad
    edge1?: Vec3;
    edge2?: Vec3;
    radius?: number;      // sphere
    /** The emitter's region id (quad/sphere) — feeds the generated light_of table. */
    regionId?: number;
    intensity: number;
    color: Vec3;
}

/**
 * Uniform required by the generated shader.
 */
export interface PlannedUniform {
    name: string;
    type: 'float' | 'int' | 'vec2' | 'vec3' | 'vec4' | 'mat4' | 'sampler2D';
    parameterPath: string;
    default?: number | number[];
    /**
     * Optional transform from parameter values to the uniform value — used when the
     * uniform is a *function* of a parameter, e.g. u_tanFov = tan(camera.fov / 2).
     * When absent, the uniform value is `params[parameterPath] ?? default`.
     */
    compute?: (params: Record<string, unknown>) => number | number[];
}

/**
 * Complete render plan — everything the Generator needs to emit code.
 *
 * T2 rule (impl-plan-decision-hoist): the Generator reads `program` (decisions) and the
 * resolved data tables below — analyzer facts (`SceneFeatures`) are Planner-internal and
 * deliberately NOT carried here, so a feature generator CANNOT re-derive a decision.
 */
export interface RenderPlan {
    /** Resolved scene data for code generators */
    objects: PlannedSDFObject[];
    analyticObjects: PlannedAnalyticObject[];
    materials: PlannedMaterial[];
    lights: PlannedLight[];

    /** Material id the ambient region (−1) resolves to via material_of(-1), or −1 = vacuum (§2.4). */
    ambientMedium: number;

    /** What the generated program does */
    program: ProgramDescription;

    /** How the GPU program executes */
    pipeline: PlannedPipeline;
}
