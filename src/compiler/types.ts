// compiler/types.ts

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
          /** Sky radiance — a SCENE_VALUE (Model B): a constant bakes inline, a `{param}` becomes
           *  a live path-named uniform. (`intensity`/`rotation` are always-live controls.) */
          color: SpectrumValue;
          intensity?: number;
          /** T3 opt-in (default FALSE — preserves pre-T3 witnesses): uniform-sphere NEE. */
          sampleAsLight?: boolean;
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
      };

// --- Objects ---
// SHAPE, NOT BACKEND (B1, owner-decided Jul 17 2026): an object describes geometry;
// the COMPILER picks the engine — analytic if the primitive provides it, sdf
// otherwise. Backend choice is computation (both engines converge to the same image
// — the cross-backend twins verify it), so it left the measurement description; the
// optional `backend` pin remains as per-object research/coverage annotation
// (computation metadata riding in the scene like `name` does).

export type ObjectDescription = PrimitiveObject | MeshObject;

export interface PrimitiveObject {
    /** Primitive type — registry-validated (unknown types get a diagnostic listing
     *  the available set; adding a primitive touches NO type union). */
    type: string;
    parameters: Record<string, number | number[]>;
    material: string;
    transform?: Transform;
    /** Provenance only (never identity): diagnostics label + emitted symbol names;
     *  `flattenGroups` stamps the authoring-tree node path here (fable-transforms §3). */
    name?: string;
    /** RESEARCH PIN: force an engine (Validator-rejected if the primitive does not
     *  provide it). Absent = auto — analytic if provided, else sdf. Used by the
     *  cross-backend coverage twins (minimal, submerged) to keep the marcher
     *  exercised on primitives that would otherwise resolve analytic. */
    backend?: 'sdf' | 'analytic';
}

export interface MeshObject {
    kind: 'mesh';
    data: Float32Array;
    material: string;
    transform?: Transform;
    /** Provenance only (never identity) — see PrimitiveObject.name. */
    name?: string;
}

/** RESERVED (future custom-geometry door): a user-authored per-object body filling
 *  the same compiled surface (sdf_object_i / analytic arm). Not in ObjectDescription
 *  yet — the target doc's §1.3 sketches the contract it must declare. */
export interface CustomSDF {
    type: 'custom';
    glsl: string;
    imports?: string[];
}

/** Axis-angle rotation (radians). The axis need not be unit; zero axis is rejected.
 *  The angle may be `{param}`-driven (stage 4) — the slider-friendly driven rotation. */
export interface AxisAngle {
    axis: Vec3;
    angle: Value<number>;
}

/** Unit quaternion [x, y, z, w] (normalized by the compiler within tolerance). */
export type Quaternion = [number, number, number, number];

/**
 * Object placement (docs/fable-transforms.md §2): a Euclidean similarity, authored as
 * TRS with local→parent = T·R·S (scale, then rotate, then translate). PINNED (§1):
 * `scale` is a strictly positive scalar — reflections are rejected and nonuniform scale
 * is unrepresentable (an ellipsoid is a primitive, not a transform).
 *
 * Stage 4 (§6): every field is a `Value<>` — a constant bakes/folds away; any `{param}`
 * makes the leaf's placement LIVE (per-object uniforms, recomputed on parameter change).
 * `Value<Quaternion>` on rotation is the graph runtime's port (decomposed similarities
 * arrive as quat params). Transforms NEVER accept GlslExpression (§6.1 pin 4): a
 * spatially-varying transform is deformation — a different feature with different math.
 */
export interface Transform {
    position?: Value<Vec3>;
    /** Axis-angle (radians, angle may be driven) or a quaternion (constant or driven). */
    rotation?: AxisAngle | Value<Quaternion>;
    scale?: Value<number>;
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

/** A parameter declared BY a GLSL expression (heterogeneous-media D4; general to any
 * expression property). Each becomes a live float uniform + slider through the same
 * machinery as ValueParam — the expression source references the derived uniform name
 * (`fog.gain` → `u_fog_gain`). v1: float params only. */
export interface GlslExpressionParam {
    /** Parameter path, e.g. 'fog.gain'. Reserved-prefix + collision rules apply. */
    param: string;
    default: number;
    min?: number;
    max?: number;
}

export interface GlslExpression {
    kind: 'glsl';
    source: string;
    /** Live parameters this expression reads (as `u_<derived>` in `source`). */
    params?: GlslExpressionParam[];
}

/** Scalar-valued authored property. Kept distinct from spectra so TypeScript catches a
 * vector roughness/IOR before the runtime Validator has to report serialized JS input. */
export type ScalarProperty = Value<number> | GlslExpression;

/** Spectrum-valued authored property. A scalar is an intentional achromatic broadcast,
 * including a scalar ValueParam default; the Planner resolves it to a vec3 uniform default. */
export type SpectrumProperty = number | Vec3 | GlslExpression | ValueParam<number> | ValueParam<Vec3>;

/** A Spectrum VALUE — constant or `{param}`-driven, NO spatial expression (SpectrumProperty
 * minus GlslExpression). The Model B split surface for radiometric values that are read at a
 * point but never vary spatially: light emission and the constant-env color. */
export type SpectrumValue = number | Vec3 | ValueParam<number> | ValueParam<Vec3>;

/** Union used by generic planner helpers. Public fields use the narrower aliases above. */
export type MaterialProperty = ScalarProperty | SpectrumProperty;

export function isGlslExpression(v: unknown): v is GlslExpression {
    return v != null && typeof v === 'object' && (v as GlslExpression).kind === 'glsl';
}

/** Heterogeneous-medium predicate (fable-heterogeneous-media.md; extended by
 * impl-plan-medium-emission P5): any expression coefficient — σ_a, σ_s, OR ε.
 * Classification is by AUTHORED TYPE — an expression that happens to evaluate to a
 * constant still routes to the null-collision arms (that is F-HET-CONST's whole
 * point). Shaped to accept authored MediumDescription and PlannedMedium alike. */
export function isHeterogeneousMedium(med: { sigma_a: unknown; sigma_s?: unknown; emission?: unknown }): boolean {
    return isGlslExpression(med.sigma_a) || isGlslExpression(med.sigma_s) || isGlslExpression(med.emission);
}

/** A medium property that may be nonzero at runtime: nonzero constant, {param}
 * (live — can become nonzero), or expression. Authored and planned shapes alike. */
function mediumPropertyMayBeNonzero(v: unknown): boolean {
    if (v === undefined) return false;
    if (typeof v === 'number') return v !== 0;
    if (Array.isArray(v)) return v.some((c) => c !== 0);
    return true;
}

/** The medium emits (impl-plan-medium-emission): ε may be nonzero. */
export function isEmissiveMedium(med: { emission?: unknown }): boolean {
    return mediumPropertyMayBeNonzero(med.emission);
}

/** The medium may scatter: σ_s may be nonzero (the Analyzer's census rule). */
export function mediumMayScatter(med: { sigma_s?: unknown }): boolean {
    return mediumPropertyMayBeNonzero(med.sigma_s);
}

/** CONSTANT nonzero emission — the v1 samplable-emitter leg (compiler-pass C3: ONE body
 *  for the Analyzer census, the Validator's sampleAsLight/phantom/driven-transform rules,
 *  and the Planner's registry route — these jointly guard pt ≡ pt-nee, so agreeing by
 *  convention was the audit's M6). Absent, `{param}`-driven, and expression emissions are
 *  all FALSE: a v1 samplable emitter's power must bake into the compile-time CDF.
 *  (Deliberately `!== 0`, matching the registry route; materials.ts's emission GATE uses
 *  `> 0` — a documented, separate fact.) */
export function hasConstantNonzeroEmission(emission: unknown): boolean {
    if (typeof emission === 'number') return emission !== 0;
    if (Array.isArray(emission)) return emission.some((c) => typeof c === 'number' && c !== 0);
    return false;
}

/** The medium routes to the null-collision arms (heterogeneous 2×2, extended by
 * emission P5): any expression coefficient, or an emissive medium that SCATTERS under
 * the current measurement (the analytic channel-MIS arm has no source term; its σ̄ is
 * auto-derived for constants). `scatters` = σ_s may be nonzero AND scattering is
 * computed — the caller resolves the measurement side. */
export function mediumRoutesToTracking(
    med: { sigma_a: unknown; sigma_s?: unknown; emission?: unknown },
    scatters: boolean,
): boolean {
    return isHeterogeneousMedium(med) || (isEmissiveMedium(med) && scatters);
}

/**
 * Surface material model — REGISTRY-VALIDATED, like primitive/phase/light-kind ids
 * (the B1 treatment: adding a model touches no type union; unknown models get a
 * Validator diagnostic listing the registered set). Two non-registry words carry
 * structural meaning: 'none' = no optical surface (§3.6, null interface — requires a
 * medium block, Validator-enforced) and 'emissive' is rejected with a migration
 * message (review C4) — use emission on a surface model instead.
 */
export type MaterialModel = string;

/**
 * Medium of the region's INTERIOR (§3.5) — "materials of the interior". Coefficients are
 * constants, {param}, or — with a declared `majorant` — GLSL expressions of position `p`
 * (heterogeneous media, fable-heterogeneous-media.md). Segment behavior behind the
 * volumetric-component seams (fable-volumetric-component.md).
 */
export interface MediumDescription {
    /** Absorption coefficient σ_a (per unit arc length). */
    sigma_a: SpectrumProperty;
    /** Scattering coefficient σ_s. Default 0 (absorbing-only, e.g. tinted glass interior). */
    sigma_s?: SpectrumProperty;
    /** Density ceiling σ̄ (heterogeneous D1): the rendered medium IS the proportionally
     *  clamped field min-scaled so max-channel σ_t ≤ σ̄. REQUIRED with expression
     *  coefficients (finite, > 0); inert (warned) on all-constant media. Also paces
     *  emission sampling in the tracking arms (impl-plan-medium-emission). */
    majorant?: number;
    /** Volume emission coefficient ε (impl-plan-medium-emission P1 — B2's dimensional
     *  ladder): radiance added per unit path length, W·sr⁻¹·m⁻³; dL/ds = ε(x). Deep
     *  uniform glow saturates to ε/σ_t (the source function). Decoupled from σ_a —
     *  glow needs no absorption (Kirchhoff coupling is authoring sugar: ε = σ_a·Le).
     *  The D1 scale applies to ε too (P2: clamped regions preserve ε/σ_t). */
    emission?: SpectrumProperty;
    /** Henyey–Greenstein anisotropy g ∈ (−1, 1). Default 0 (isotropic). Read only by 'hg'. */
    phase_g?: ScalarProperty;
    /** The volume's scattering model (which phase function). Default 'hg'. 'rayleigh' is
     *  parameter-free (molecular/sky; its λ⁻⁴ color is σ_s). Registry: volume_scattering/. */
    /** Volume scattering model — registry-validated (A2: unknown models get a
     *  Validator diagnostic; adding a phase model touches no union). Default 'hg'. */
    model?: string;
}

export interface MaterialDescription {
    model: MaterialModel;
    albedo?: SpectrumProperty;
    roughness?: ScalarProperty;       // ggx: alpha = roughness², clamped ≥ 1e-3 (mirrors are a delta model)
    f0?: SpectrumProperty;            // ggx: normal-incidence reflectance — the conductor's color
    ior?: ScalarProperty;             // dielectric: region's interior IOR (→ generated ior_of table)
    transmittance?: SpectrumProperty; // dielectric: interface tint; interior absorption is the medium's job (§4.4)
    emission?: SpectrumProperty;
    /** Interior medium (§3.5/§4.4). Composes with any surface model; required for model 'none'. */
    medium?: MediumDescription;
    /**
     * §6.2 registry opt-in: an emissive material on an ANALYTIC quad/sphere object becomes a
     * samplable light (default true for those shapes; constant emission only in v1). On SDF
     * shapes `true` is a Validator error (V1-C2) — emissive SDFs stay path-only and still glow.
     */
    sampleAsLight?: boolean;
    /**
     * OPEN VOCABULARY (A6, materials-§7): the legal property keys are the model's
     * SCHEMA ROWS, not this interface — a new model's new property (`sheen: 0.7`)
     * is authored directly; the Validator warns on keys no present model declares.
     * The named fields above are the current models' properties, kept for
     * autocomplete/docs. Meta-keys (model/medium/sampleAsLight) are reserved
     * (registry-test-enforced against row-source collisions).
     */
    [key: string]: MaterialProperty | MaterialModel | MediumDescription | boolean | undefined;
}

// --- Lights ---
// ONE radiometric authoring word (B2, owner-decided Jul 17 2026): `emission`, the
// same word materials use — a Spectrum (scalar broadcasts). Area emitters author
// emitted RADIANCE Le (shared EXACTLY with the desugared region's material emission
// — the pt ≡ pt-nee invariant is now visibly one field); delta lights author
// RADIANT INTENSITY I (W/sr; a delta has no radiance — standard convention).
// Human conveniences (power in watts, color temperature) belong to the AUTHORING
// layer, which knows the object: power is per-OBJECT (Φ/(π·A) needs an area), so it
// can never be a material/IR quantity. The intensity×color factoring died here.
// (The ENVIRONMENT's `intensity` is different — a LIVE runtime multiplier slider,
// not authored factoring — and deliberately survives.)

/** An authored light — the OPEN door (D2, the B1 treatment; materials' precedent).
 *  `kind` is a LIGHT_KINDS registry key; the legal fields beyond `kind`/`emission` are
 *  exactly the kind descriptor's `authoredParams` rows (Validator-enforced: unknown-key /
 *  required / shape / constraint, with row defaults framework-applied). The per-kind
 *  field documentation lives ON the descriptors, next to the math that reads it.
 *  ('directional' remains reserved vocabulary — rejected with its own message.) */
export interface LightDescription {
    kind: string;
    /** ONE radiometric word (B2): Le for area kinds, radiant intensity (W/sr) for delta
     *  kinds; scalar broadcasts. Constant Spectrum or (driven-lights Stage A) a `{param}`
     *  slider — for hittable kinds the SAME uniform the desugared region's material
     *  emission reads. Geometry rows stay constant in v1. */
    emission: LightEmission;
    [key: string]: unknown;
}

/** Authored light radiance/intensity — the Model B split surface for a radiometric
 *  value read at a point. */
export type LightEmission = SpectrumValue;

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
    /** OVERRIDE of the env-vs-finite selection probability P(sample env) in two-stage NEE.
     *  ESTIMATOR section, variance-only by construction (selection pdfs match on every
     *  side — sampler, lighting_pdf, miss-MIS weight — so it can never move the converged
     *  image; it trades noise between the env and finite-light techniques). Absent = the
     *  derived power partition Φ_env/(Φ_env + ΣΦ_light), live via a compute closure
     *  (impl-plan-env-power-selection: the env joins selection like any other light).
     *  Must be strictly inside (0, 1); Validator-enforced. */
    envSelectWeight?: number;
    /** null = off. Unbiased by construction (random termination WITH compensation) — the
     *  taxonomy's canonical estimator-side termination, vs maxBounces' measurement-side one. */
    russianRoulette: { startDepth: number } | null;
    /**
     * Volume distance-sampling method (§7.3 as amended by fable-volumetric-component.md §5),
     * consulted only when scattering is live (measurement.scattering 'full' + scattering
     * media present). 'analytic' = the closed-form homogeneous bodies (exact; constant/{param}
     * media only). 'delta-tracking' = the null-collision arms for heterogeneous media
     * (fable-heterogeneous-media.md; constant media in the same scene STAY analytic — the
     * per-medium 2×2 dispatch). v1: pt/pt-nee only — 'delta-tracking' × directLighting 'mis'
     * is rejected until the tally batch. 'raymarch' is reserved for honest biased marching;
     * 'ratio-tracking' names a distance-sampling variant we are not building — both
     * rejected-not-removed. Default 'analytic'.
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
    envSampler?: string;   // ENV_CHARTS registry key (C6: the open door — Validator-gated)
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

/**
 * Camera pose — part of the MEASUREMENT (the camera is W_j; without the pose,
 * (scene, strategy) does not determine the converged image). Shared by every
 * camera model: all occupants are look-at maps over the same frame.
 *
 * Pose is deliberately NOT a Value<>: it is ALWAYS live, as the fixed parameters
 * `camera.position` / `camera.target` (the OrbitControls/KeyboardControls contract —
 * orbiting must never recompile). Authored values here are those parameters'
 * DEFAULTS; a `{param}` spelling would only rename paths the app layer hardcodes.
 */
export interface CameraPose {
    /** Eye point. Default [0, 0, 8]. */
    position?: Vec3;
    /** Look-at point. Default [0, 0, 0]. Must differ from position. */
    target?: Vec3;
}

/** An authored camera — the OPEN door (D2): `type` is a CAMERA_MODELS registry key; the
 *  legal model fields are the descriptor's `authoredParams` rows (Validator-enforced).
 *  Numeric fields are PLAIN numbers — every camera control is always live (the
 *  instrument principle) — EXCEPT the perspective `fov`, whose `Value<number>` spelling
 *  is load-bearing: a `{param}` fov carries the slider's path and range (scenes use it).
 *  Per-model field docs live on the descriptors. */
export type CameraDescription = CameraPose & {
    type: string;
    [key: string]: unknown;
};

/** Accumulation — OPEN (D2): `type` is an accumulator registry key ('average' /
 *  'variance' / 'oneshot'; 'exponential' reserved-rejected). */
export type AccumulationDescription = { type: string; [key: string]: unknown };

/** Tonemap — OPEN (D2): `type` is a TONEMAP_MODELS registry key; `exposure` is the
 *  shared display-glue control every curve honors. */
export type DisplayDescription = { type: string; exposure?: number; [key: string]: unknown };

/**
 * GLSL shader program (vertex + fragment)
 */
export interface ShaderProgram {
    vertex: string;
    fragment: string;
}

/**
 * Supported GLSL uniform types
 */
export type UniformType =
    | 'float'
    | 'float[]'   // GLSL `float u_x[N]`, uploaded via uniform1fv (driven-lights CDF arrays)
    | 'int'
    | 'bool'
    | 'vec2'
    | 'vec3'
    | 'vec4'
    | 'mat3'
    | 'mat4'
    | 'sampler2D'
    | 'samplerCube';

/**
 * Binding between shader uniform and application parameters.
 * Part of the compiled contract the engine executes (CompiledRenderer.uniforms);
 * defined HERE with the rest of it — engine/types.ts re-exports (import direction
 * is App → Engine → Compiler, never the reverse).
 */
export interface UniformBinding {
    uniform: string;
    parameters: string[];
    type: UniformType;
    compute: (params: Record<string, any>) => any;
}

/**
 * Parameter-namespace reservations (naming batch N2 — audit P3 made explicit).
 * The compiler never invents parameter names (fable-transforms §6), but the ENGINE
 * and APP mint these; an authored {param} colliding with them would silently fight
 * the builtin channel. The Validator rejects authored params matching either list.
 *
 * - engine.*      — per-frame engine builtins (resolution, sampleCount, resetSalt, …)
 * - env.*         — environment-feature-minted (env.selectProb, env.rotation)
 * - debug.* / renderer.* — display-mode extension channels
 * - camera.position / camera.target — OrbitControls' live channel (+ authored pose
 *   defaults); camera.frame additionally carries a HIDDEN Float32Array coercion in
 *   ParameterStore.restore. camera.fov is deliberately NOT reserved — it is the
 *   authored fixture convention.
 */
export const RESERVED_PARAM_PREFIXES = ['engine.', 'env.', 'debug.', 'renderer.'] as const;
export const RESERVED_PARAM_PATHS = ['camera.position', 'camera.target', 'camera.frame'] as const;

/**
 * Parameter metadata for UI generation and validation
 *
 * Defines how module parameters behave and how they should be displayed.
 * Travels with CompiledRenderer.parameters — same contract, same home.
 */
export interface ParameterMetadata {
    // Required
    type: 'float' | 'int' | 'bool' | 'vec2' | 'vec3' | 'vec4' | 'color';
    /** RADIOMETRIC magnitude (E2): the panel renders chroma × intensity (HdrColorInput)
     *  instead of an LDR swatch, so editing can never clamp an emission of 40 to ≤1.
     *  Plain 'color' without this flag stays a swatch (albedo/f0 — genuinely [0,1]). */
    hdr?: boolean;
    default: any;

    // For numeric types
    range?: [number, number];
    step?: number;
    values?: number[];
    options?: string[];  // Named options for discrete int values

    // UI hints
    name?: string;
    unit?: string;
    group?: string;
    help?: string;

    // Behavior
    triggersReset?: boolean;
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

    /** ON-DEMAND LDR recipe (engine-app pass E5 — a CONTRACT EXTENSION, owner-approved
     *  Jul 19 2026): everything the engine needs to run the display pass into the LDR
     *  scratch buffer for PNG export, shipped as DATA. The engine had memorized four
     *  compiler names ('display-pass', 'u_radiance', 'accumulation_previous', 'ldr') —
     *  a silent-runtime-breakage class on any compiler rename; now the compiler, which
     *  owns those names, declares them. Absent ⇒ the renderer has no display pass
     *  (bake renderers) and renderLdr errors honestly. */
    ldrRecipe?: {
        /** The pipeline pass to re-run (the display pass's id). */
        passId: string;
        /** Texture-input overrides for the re-run (display's radiance input → the
         *  post-swap accumulation buffer, so LDR matches what HDR export reads). */
        inputs: Record<string, string>;
        /** The framebuffer to render into (the byte-format LDR scratch target). */
        output: string;
    };
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
