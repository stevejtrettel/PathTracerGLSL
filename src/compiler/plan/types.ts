// compiler/plan/types.ts

import type { MaterialModel, Vec3, GlslExpression, FramebufferFormat, ValueParam, SpectrumValue, BlackbodyValue, ParameterMetadata, CameraDescription, AccumulationDescription, DisplayDescription } from '../types.js';

/** The RESOLVED environment (compiler-pass C2): defaults applied at plan time, so the
 *  record's own pin — "all fields RESOLVED, no optionals" — now holds for the env too
 *  (Generate's scattered `?? defaults` are dead; the raw authored record was where the
 *  dropped-selectWeight bug hid). Carries exactly GENERATE'S surface: the samplable
 *  DECISION is `environmentSamplable` below, and `tableSize` is bake-orchestration data
 *  (compileEnvironmentBake reads the scene). The kind set is STRUCTURAL — four codegen
 *  shapes, not a registry family — so a closed union is honest here. */
export type ResolvedEnvironment =
    | { type: 'none' }
    | { type: 'constant'; color: SpectrumValue; intensity: number }
    | { type: 'image'; url: string; intensity: number; rotation: number }
    | { type: 'procedural'; glsl: GlslExpression; intensity: number; rotation: number };
import type { Similarity } from '../../components/geometry/similarity.js';
import type { MeshSlot, BatchSlot, SceneTableSlot } from '../../components/data/ledger.js';

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
        /** The ambient space's registry key (D3 — the non-Euclidean seam's decision:
         *  which AMBIENT_SPACES occupant provides the ambient_* contract surface). */
        ambient: string;
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
        /** How live scattering samples distances: 'analytic' (closed-form homogeneous)
         *  or 'delta-tracking' (heterogeneous null-collision; per-medium 2×2 routing —
         *  constant media stay analytic). 'none' when no scattering arms exist. */
        volumeSampling: 'none' | 'analytic' | 'delta-tracking';
        /** Medium NEE vertex placement (impl-plan-equiangular): 'vertex' = at the
         *  transmittance-sampled scatter vertex (event site); 'equiangular' = per
         *  segment, drawn ∝ 1/d²-to-light. Meaningful only when lighting ≠ null and
         *  scattering arms are live; 'vertex' otherwise. */
        mediumLightSampling: 'vertex' | 'equiangular';
        /** T5 strategy axis (plan D11): which chart the env sampler's CDF table lives
         *  in, and whether the table is MIS-compensated. Radiance is chart-independent. */
        envSampler: { chart: string; compensation: boolean };   // chart = ENV_CHARTS key (C6)
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
    environment: ResolvedEnvironment;
    /** The env participates in NEE/MIS as a light (env-as-light T3/D6) — drives the
     *  selection codegen, the miss-branch w-bookkeeping, and env sampler emission.
     *  A DECISION, not the analyzer's kind-fact (impl-plan-exact-linkage): under
     *  directLighting 'none' there is no NEE machinery, so the env is not a light —
     *  no sampler, no CDF machinery, however samplable its kind. */
    environmentSamplable: boolean;
    /** The MIS env-pdf query exists (samplable ∧ mis) — its only readers are the miss
     *  weight and lighting_pdf's env branch. The environmentSamplable twin of
     *  emitters.lightingPdf. */
    environmentPdf: boolean;
    /** The env-vs-finite selection draw is LIVE (u_envSelectProb exists): samplable env
     *  AND finite lights to split mass with. Env-only programs fold selection to the
     *  constant 1 — sampler and pdf sides fold together (structural symmetry, §6.1). */
    environmentSelectionLive: boolean;
}

/** What media machinery this program contains (volumetric-component seams). */
export interface MediaDesc {
    /** Any medium block or ambientMedium: media tables + medium_sample seam exist. */
    present: boolean;
    /** Scattering media present AND the measurement computes them (scattering 'full'):
     *  phase functions + the channel-MIS scattering arms exist. Equivalent to
     *  estimator.volumeSampling !== 'none' — kept explicit for readers. */
    scatteringArms: boolean;
    /** Some medium routes to a null-collision arm (fable-heterogeneous-media.md;
     *  emission P5 extends the routing): the delta/ratio-tracking occupant +
     *  MAX_NULL_COLLISIONS exist. Independent of scatteringArms — absorbing-only
     *  heterogeneous media need the ratio pass-through arm with no phase machinery. */
    heterogeneousArms: boolean;
    /** Emissive media present (impl-plan-medium-emission): the MediumProperties ε
     *  field, the generated medium_emission accessor, the arms' per-collision
     *  collection, and the walk's ms.radiance line exist. */
    emission: boolean;
    /** Some material is model 'none' (§3.6): the null-crossing branch exists. */
    nullInterfaces: boolean;
    /** Media AND NEE: the spectral segment walker (shadow_media) replaces the boolean
     *  fast path (shadow_opaque) behind the §6.3 contract. */
    shadowWalker: boolean;
    /** Distinct volume scattering models present (registry order), for the MediumProperties
     *  field union + the generated interaction_medium_* dispatch. Empty if no scattering. */
    models: string[];
    /** The interaction_medium_eval dispatch exists (scattering arms ∧ NEE) — its only
     *  callers are the medium light-sampling sites (light_medium / equiangular). */
    mediumEval: boolean;
    /** The interaction_medium_pdf dispatch exists (scattering arms ∧ mis) — its only
     *  caller is the medium MIS weight. */
    mediumPdf: boolean;
}

/** What samplable-emitter machinery this program contains (§6.2). */
export interface EmittersDesc {
    /** Some light has a region: light_of table + §6.2 emission w-bookkeeping exist. */
    samplable: boolean;
    /** samplable AND mis: the generated lighting_pdf MIS query is emitted. */
    lightingPdf: boolean;
    /** Driven-lights Stage A: some light has a `{param}` RADIOMETRIC row. Gates the
     *  literal→uniform substitutions — the light ctor becomes `light_get_<id>()` (a const
     *  can't read a uniform), and the selection CDF/select-pdf read `u_light_cdf[i]` /
     *  `u_light_selpdf[i]` (CPU-recomputed) instead of literals. FALSE → byte-identical to
     *  the pre-driven emitters (constant scenes are unaffected). */
    driven: boolean;
}

export interface IntersectionDesc {
    /** Which geometry backends this program's scene_intersect combines — the intersection
     *  family's registry occupants (raymarch = the SDF marcher, mesh = the triangle engine)
     *  plus the engine-less analytic closed-form dispatch. A LINK-MAP decision (decision-hoist):
     *  "does this program contain the X backend" is answered ONCE here, symmetrically for all
     *  three, not re-derived per feature (it replaced the fake `method: 'raymarch'` singleton).
     *  scene_intersect / scene_intersect_any / the region tables emit exactly the arms flagged. */
    backends: { sdf: boolean; analytic: boolean; mesh: boolean; instanced: boolean };
    /** Mesh traversal engine (impl-plan-mesh-bvh): a MESH_TRAVERSALS registry id
     *  (components/intersection — 'bvh' walks the SAH tree, 'brute' scans all triangles;
     *  Validator-gatekept). Gates which per-mesh wrapper (and whether the mesh_N_bvh
     *  extern) is emitted. Only meaningful when backends.mesh. */
    meshTraversal: string;
    /** Instance traversal engine (impl-plan-tlas): an INSTANCE_ACCELS registry id ('tlas'
     *  walks the per-batch BVH, 'linear' scans every placement). Gates the instance
     *  dispatch shape + whether the tlas extern is emitted. */
    instanceAccel: string;
    /** Object dispatch regime (fable-object-tables): an OBJECT_DISPATCHES registry id —
     *  'unrolled' emits today's per-object arms; 'table' emits the scene-TLAS walk +
     *  typed-record leaf dispatch + the residual unrolled arm. */
    objectDispatch: string;
    /** The generated scene_intersect_any occlusion query exists — its only caller is
     *  the opaque shadow fast path (NEE without media; shadow_media re-spawns
     *  scene_intersect instead). The static backend walkers (sdf_intersect_any) ride
     *  along inside their component files regardless — the declared wholesale cost. */
    anyQuery: boolean;
    /** Any leaf has a live ({param}-driven) placement (fable-transforms §6) —
     *  gates glsl/core/placement.glsl and the rigid-frame query tiers. */
    drivenPlacement: boolean;
}

export interface MaterialsDesc {
    models: MaterialModel[];
    /** The interaction_surface_eval dispatch (+ material_has_nondelta_lobes guard)
     *  exists — their only caller is the light technique (NEE). */
    surfaceEval: boolean;
    /** The interaction_surface_pdf dispatch exists — its only caller is the surface
     *  MIS weight. The surface twin of emitters.lightingPdf. */
    surfacePdf: boolean;
}

export type LightingDesc =
    | {
        method: 'nee' | 'mis';
        selection: 'uniform' | 'power';
        /** Authored OVERRIDE of the env selection probability (estimator.envSelectWeight,
         *  Validator-checked (0,1)). Absent = derived power partition (the closure). */
        envSelectWeight?: number;
    };

// D2: the hand-mirrored strategy-side unions are DEAD — the plan carries the ONE
// authored shape (compiler/types.ts, now registry-open). The local names survive as
// aliases so plan consumers keep reading `CameraDesc` etc.; there is exactly one
// definition to drift from now, which is to say zero.
export type CameraDesc = CameraDescription;
export type AccumulationDesc = AccumulationDescription;
export type TonemapDesc = DisplayDescription;

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
    sdfType: string;   // registry-validated upstream (A2)
    /** Authored provenance name (naming batch N5): flows into emitted symbols
     *  (`sdf_<name>`, hoisted shape consts) after sanitization + dedup. Optional,
     *  collision-legal (fable-transforms §7.6) — unnamed objects emit `object_<i>`. */
    name?: string;
    parameters: Record<string, number | number[]>;
    /** Constant: composed local→world similarity (fable-transforms §5.2; any local
     *  'center' folded in as a pre-translation) lowered to wrapper tiers. Driven
     *  (§6): the uniform record — parameters stay LOCAL (center NOT folded; the
     *  rigid-frame query scales params in-shader). */
    placement: PlannedPlacement;
}

/**
 * Resolved analytic object for code generation — intersected in closed form (a second
 * geometry backend behind scene_intersect). `index` shares the region-id space with SDF
 * objects (regions are globally unique — §2.3), so material_of() spans both.
 */
/** The planned SCENE TABLE (fable-object-tables): everything the table-mode codegen
 *  bakes — ledger bases + counts + the present-kind header codes. Built from the
 *  dataTenantsOf adapter's table (the one truth the App packs from too). */
export interface PlannedSceneTable {
    slot: SceneTableSlot;
    leafCount: number;
    analyticCount: number;
    /** Records [0, solidCount) are SOLID (the containment loop's range). */
    solidCount: number;
    /** Present tabled primitive kinds with their record-header codes. */
    kinds: Array<{ type: string; code: number }>;
    /** Mesh ordinals with table leaves (constant-placement meshes). */
    tabledMeshOrdinals: number[];
}

export interface PlannedAnalyticObject {
    index: number;
    materialId: number;
    shapeType: string;   // registry-validated upstream (A2)
    /** Authored provenance name (naming batch N5) — see PlannedSDFObject.name. */
    name?: string;
    parameters: Record<string, number | number[]>;
    /** Present ONLY for driven placement (§6): parameters are then LOCAL (unfolded)
     *  and the generated arm conjugates the ray into the rigid frame. Constant
     *  placements fold entirely into `parameters` and this stays undefined. */
    placement?: DrivenPlacement;
    /** This object has a scene-table record (fable-object-tables): under 'table' dispatch
     *  it leaves the unrolled arms (intersect via the TLAS leaf, containment via the
     *  record loop). Constant + bounded, per the adapter's ONE eligibility predicate. */
    tabled?: boolean;
}

/**
 * Resolved triangle mesh for code generation (impl-plan-meshes). A third geometry backend
 * behind scene_intersect. `index` shares the region-id space with SDF/analytic objects
 * (regions are globally unique — §2.3), so material_of() spans all three. v0: thin surface
 * (no `scene_region_at` containment — §3), single material (one region), ray-into-local
 * placement (the mesh's vertex data stays object-LOCAL; the generated arm conjugates the ray).
 * The vertex/triangle DATA never reaches the compiler as tables — it is uploaded as extern
 * data textures by the app (like the env map); only the counts/flags/region are planned here.
 */
export interface PlannedMesh {
    /** Ordinal among the scene's meshes (scene order) — keys the extern texture names
     *  (components/intersection/mesh meshExternNames) so compiler and app agree. */
    ordinal: number;
    /** Region id (shared index space with SDF/analytic objects) — material_of(index). */
    index: number;
    materialId: number;
    /** Authored provenance name (naming batch N5) — see PlannedSDFObject.name. */
    name?: string;
    /** Triangle count — baked as the literal loop bound (the compiler has the mesh data). */
    triCount: number;
    /** Authored vertex normals present → smooth (barycentric) shading; else flat geometric. */
    smooth: boolean;
    /** Validator-PROVEN solid (fable-mesh-containment): joins scene_region_at, leaves the
     *  thin set, earns ior_of rows. False = v0 thin surface. */
    closed: boolean;
    /** The mesh's baked ledger slot (rail v2, fable-data-rail): base offsets into the
     *  shared channels — the ONE layout truth (planDataLayout via dataTenantsOf). */
    slot: MeshSlot;
    /** The mesh's LOCAL AABB (baked literals) — the containment query's root-box early-out.
     *  Present iff closed (the compiler has the positions; O(V) at plan time). */
    localBox?: { min: [number, number, number]; max: [number, number, number] };
    /** Constant similarity or a live driven placement — the ray is conjugated into the mesh's
     *  local frame (positions stay local; never folded into vertices). */
    placement: PlannedPlacement;
}

/**
 * A resolved INSTANCED batch (impl-plan-instancing): one prototype placed at N transforms, sharing
 * the geometry, as ONE region/material. `index` shares the region-id space (globally unique). The
 * codegen view only — the actual placement values + prototype geometry are computed from the scene
 * and uploaded by the app (like meshes); the Planner carries counts/flags/backend for the loop.
 */
export interface PlannedInstanceBatch {
    /** Ordinal among instance batches (scene order) — keys the extern texture names. */
    ordinal: number;
    /** Region id (shared space) — one region for the whole batch (material_of(index)). */
    index: number;
    materialId: number;
    name?: string;
    /** Number of placements — the baked loop bound. */
    instanceCount: number;
    /** Per-instance attribute rows (fable-instance-attributes), in SLOT order (model-schema
     *  order — the ONE order truth shared with the app's packer via instanceAttributeRows).
     *  Present iff the batch authored attributes; gates the records-channel fetches. */
    attributeRows?: Array<{ source: string; shape: 'float' | 'vec3' }>;
    /** The batch's baked ledger slot (rail v2): placements/attrs bases in `records`,
     *  the TLAS base in `nodes`. */
    slot: BatchSlot;
    /** The prototype's backend + what the loop's local-intersect needs. mesh: BLAS counts (data
     *  uploaded by the app). analytic: the canonical params, baked + scaled by s per instance. */
    prototype:
        | { backend: 'mesh'; triCount: number; smooth: boolean; geometrySlot: MeshSlot }
        | { backend: 'analytic'; shapeType: string; parameters: Record<string, number | number[]> };
}

/** A per-instance ATTRIBUTE reference (fable-instance-attributes — the fourth storage
 *  class): the row's value lives in batch `batch`'s instance_k_attrs texture at slot
 *  `slot` of `count` rows, indexed by Hit.element. Never authored — the Planner mints it
 *  onto the batch material's values from InstancedObject.attributes. Its ONLY legal use
 *  site is the scene_material_properties fill (emitAttributeValue); emitValue throws on it. */
export interface AttributeValue {
    attribute: {
        batch: number;
        /** Records-channel base of the batch's attrs region (rail v2 — ledger-baked). */
        base: number;
        slot: number; count: number; shape: 'float' | 'vec3';
    };
}

export function isAttributeValue(v: unknown): v is AttributeValue {
    return typeof v === 'object' && v !== null && 'attribute' in v;
}

/** A schema-resolved property value: constant, expression, live param (§2.8), or a
 *  per-instance attribute reference. */
export type ResolvedProperty = Vec3 | number | GlslExpression | ValueParam<Vec3 | number> | BlackbodyValue | AttributeValue;   // BlackbodyValue survives resolution ONLY when driven (constants fold at plan entry)

/**
 * Resolved interior medium (§3.5) — sigma_a/sigma_s/model are the RTE partition CORE, read
 * by every arm regardless of phase model — fixed fields (the material side's analogue of
 * geometry's `p`). Coefficients may be GLSL expressions of `p` when `majorant` is declared
 * (heterogeneous media; the Validator enforces the pairing). Phase parameters are
 * schema-resolved (materials-§7): `values` holds exactly the medium's own model's rows,
 * keyed by row source — expressions remain rejected there.
 */
export interface PlannedMedium {
    sigma_a: Vec3 | GlslExpression | ValueParam<Vec3>;
    sigma_s: Vec3 | GlslExpression | ValueParam<Vec3>;
    /** Volume scattering model id (volume_scattering/ registry): 'hg' | 'rayleigh'. */
    model: string;
    /** Density ceiling σ̄ (heterogeneous D1) — present iff authored, honored ONLY for
     *  expression coefficients (the D1 clamp in scene_medium_properties). Non-expression
     *  tracking media DERIVE σ̄ from their (live) values — a literal for constants, a
     *  compute-closure uniform for {param} coefficients (impl-plan-env-power-selection
     *  batch 2); an authored ceiling there is inert (Validator warns). */
    majorant?: number;
    /** Volume emission coefficient ε (impl-plan-medium-emission P1) — resolved like the
     *  extinction core; [0,0,0] when unauthored. The D1 scale applies to it (P2). */
    emission: Vec3 | GlslExpression | ValueParam<Vec3>;
    /** Phase params of THIS medium's model (union fields of OTHER present models fall
     *  back to their row defaults at emit time). */
    values: Record<string, number | GlslExpression | ValueParam<number>>;
}

/**
 * Resolved material for code generation (materials-§7): property resolution is DERIVED
 * from the model's schema rows — `values` holds exactly the declared rows (field AND
 * region-table storage), keyed by row source, each `authored ?? row.default` shaped by
 * glslType. No compiler type names a property; a model with a new property adds a row,
 * not a field here.
 */
export interface PlannedMaterial {
    id: number;
    name: string;
    model: MaterialModel;
    values: Record<string, ResolvedProperty>;
    medium: PlannedMedium | null;                               // interior medium (§3.5); null = no medium block
}

/**
 * Resolved samplable-light registry entry (§6.2). Explicit area lights DESUGAR into a
 * synthesized emissive region + one of these; sampleAsLight emitters contribute one per
 * region (two objects sharing an emissive material = two lights). Registry order = light id
 * = CDF order. Delta kinds carry no region.
 *
 * Shaped like PlannedMaterial (struct-alignment batch): `values` holds exactly the
 * kind descriptor's rows, keyed by row name — point: position/intensity (radiant
 * intensity = the authored emission as radiant intensity, W/sr); quad: corner/edge1/edge2/radiance;
 * sphere: center/radius/radiance. Radiometric products are computed ONCE here (the
 * old color×intensity factoring died with the loose-arg emitters).
 */
export interface PlannedLight {
    id: number;
    /** Registry key (registry-validated — A3; 'directional' is Validator-rejected input). */
    kind: string;
    /** Rows keyed by name. A RADIOMETRIC row may be a `ValueParam` (driven-lights Stage A):
     *  the emitted ctor reads the row's uniform instead of a literal, and the selection CDF
     *  is CPU-recomputed on change (`resolveLightValues` → `computeSelectPdf`). Geometry rows
     *  stay constant in v1 (driven light geometry = Stage B). Mirrors PlannedMedium.values. */
    values: Record<string, number | number[] | ValueParam<number> | ValueParam<number[]> | BlackbodyValue>;
    /** The emitter's region id (quad/sphere/mesh) — feeds the generated light_of table. */
    regionId?: number;
    /** DATA-DRIVEN kind (mesh — fable-mesh-lights, rail v2): the backing mesh's ordinal +
     *  the CDF walk's triangle count + the baked channel bases (tbase = the mesh's index
     *  region; wposBase = the world-position bake in `vertices`; cdfBase in `records`).
     *  All literal sampler args, deliberately NOT schema rows. */
    mesh?: { ordinal: number; triCount: number; tbase: number; wposBase: number; cdfBase: number };
}

/**
 * Uniform required by the generated shader.
 */
export interface PlannedUniform {
    name: string;
    type: 'float' | 'float[]' | 'int' | 'vec2' | 'vec3' | 'vec4' | 'mat4' | 'sampler2D';
    parameterPath: string;
    /** Additional parameter paths when the uniform is a function of SEVERAL params
     *  (driven placement: one uniform ← position + rotation + scale paths). The
     *  binding's parameter list is [parameterPath, ...parameterPaths]; `compute`
     *  receives the whole value map (fable-transforms §6). */
    parameterPaths?: string[];
    default?: number | number[];
    /** Array length N for a `float[]` uniform — the GLSL declaration needs `float u_x[N];`
     *  (the upload infers length from the Float32Array). Required for `float[]`, unused else. */
    arrayLength?: number;
    /**
     * Optional transform from parameter values to the uniform value — used when the
     * uniform is a *function* of a parameter, e.g. u_tanFov = tan(camera.fov / 2).
     * When absent, the uniform value is `params[parameterPath] ?? default`.
     */
    compute?: (params: Record<string, unknown>) => number | number[];
}

/**
 * Live (uniform-driven) placement of one object (fable-transforms §6/§6.1). Built by
 * the Planner (decisions + closures); the intersection feature forwards the uniforms/
 * metadata and emits the rigid-frame query against the §6.1 ABI:
 *   q  = inverse rotation quat;  ts = (t_rigid = −Rᵀt, s)
 * The primitive's parameters stay LOCAL (never folded); s scales them in-shader.
 */
export interface DrivenPlacement {
    kind: 'driven';
    /** vec4 uniform names: the inverse quat and (t_rigid, s). */
    uniformQ: string;
    uniformTS: string;
    /** Ready-to-forward uniform declarations (multi-path, fp64 compute, guard rails). */
    uniforms: [PlannedUniform, PlannedUniform];
    /** Slider metadata for the authored `{param}` fields, keyed by param path. */
    parameters: Record<string, ParameterMetadata>;
}

/** A leaf's placement: a constant similarity (folds/wrapper tiers) or a live one. */
export type PlannedPlacement = Similarity | DrivenPlacement;

export function isDrivenPlacement(p: PlannedPlacement): p is DrivenPlacement {
    return (p as DrivenPlacement).kind === 'driven';
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
    meshes: PlannedMesh[];
    instanceBatches: PlannedInstanceBatch[];
    /** Present when the scene has table-eligible objects (fable-object-tables) —
     *  read ONLY by 'table'-dispatch programs; 'unrolled' ignores it. */
    sceneTable?: PlannedSceneTable;
    materials: PlannedMaterial[];
    lights: PlannedLight[];

    /** Material id the ambient region (−1) resolves to via material_of(-1), or −1 = vacuum (§2.4). */
    ambientMedium: number;

    /** What the generated program does */
    program: ProgramDescription;

    /** How the GPU program executes */
    pipeline: PlannedPipeline;
}
