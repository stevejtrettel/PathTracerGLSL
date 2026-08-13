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
import type { AABB } from '../../components/accel/bvh/bvh.js';

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
        russianRoulette: { startDepth: number; maxSurvival?: number } | null;
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
    /** Some SCATTERING medium settles absorption by WEIGHTING the throughput (the analytic
     *  channel-MIS arm, the GRIN arc-length arm) rather than by a collision LOTTERY (the
     *  tracking arms) — `mediumWeightsAbsorption`, the one predicate the Generator routes
     *  `medium_survival` by. Only a weighted arm leaves a survival probability owed, so this
     *  is the existence decision for BOTH the generated `medium_survival` accessor and the
     *  transport family's `roulette_interior` rule (docs/fable-subsurface.md §6). A program
     *  whose every scattering medium is delta-tracked carries neither — and neither does one
     *  with roulette off, since the rule is the accessor's only consumer (§2.12 seam-unused). */
    weightedAbsorptionArms: boolean;
    /** Emissive media present (impl-plan-medium-emission): the MediumProperties ε
     *  field, the generated medium_emission accessor, the arms' per-collision
     *  collection, and the walk's ms.radiance line exist. */
    emission: boolean;
    /** Some material is model 'none' (§3.6): the null-crossing branch exists. */
    nullInterfaces: boolean;
    /** A DEFLECTING (gradient-index) medium is present (fable-variable-ior.md): the
     *  MediumProperties `ior` field, the GRIN arm in medium_sample, the grin.glsl walker,
     *  and the walk's `deflected` branch exist. Exact-linkage — off ⇒ zero GRIN surface. */
    deflecting: boolean;
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
    /** Which geometry CLASSES this program's scene_intersect combines. A LINK-MAP
     *  decision (decision-hoist): "does this program contain X" is answered ONCE here,
     *  never re-derived per feature; scene_intersect / scene_intersect_any / the region
     *  tables emit exactly the arms flagged.
     *
     *  `primitive` covers every primitive object regardless of how it is intersected:
     *  since impl-plan-sdf-as-shape T5 there is no SDF *backend* to flag — marching is
     *  one object's choice of intersect routine, recorded per object on
     *  PlannedPrimitiveObject.intersect, and both kinds share one generated dispatch. */
    classes: { primitive: boolean; mesh: boolean; instanced: boolean };
    /** Mesh traversal engine (impl-plan-mesh-bvh): a MESH_TRAVERSALS registry id
     *  (components/intersection — 'bvh' walks the SAH tree, 'brute' scans all triangles;
     *  Validator-gatekept). Gates which per-mesh wrapper (and whether the mesh_N_bvh
     *  extern) is emitted. Only meaningful when classes.mesh. */
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
    /** Region→material lookup form (impl-plan-region-materials): 'baked' emits the
     *  per-region constant arms (small scenes — the constants fold); 'data' emits ONE
     *  rail fetch against the regionMaterials tenant, and `ior_of` decomposes to
     *  ior_of_material(material_of(region), p) — generated size follows the MATERIAL
     *  count, never the object count. Decided with objectDispatch ('table' ⇒ 'data'),
     *  never re-derived by a generator. */
    regionLookup: 'baked' | 'data';
    /** The interaction_surface_eval dispatch (+ material_has_nondelta_lobes guard)
     *  exists — their only caller is the light technique (NEE). */
    surfaceEval: boolean;
    /** The interaction_surface_pdf dispatch exists — its only caller is the surface
     *  MIS weight. The surface twin of emitters.lightingPdf. */
    surfacePdf: boolean;
    /** Some PLANNED material can be lit from below its shading normal AND runs NEE
     *  (fable-rough-dielectric §3.1: support 'sphere' ∧ nonDeltaLobes). Gates the
     *  generated `material_two_sided` predicate and makes light_query_surface's
     *  two-sidedness a RUNTIME question; false folds it to the constant `false`, so
     *  a program with no such material carries neither. The light tree's
     *  below-horizon cull is licensed by exactly this being false at a receiver. */
    twoSidedShading: boolean;
    /** Some present material reads Hit.uv (checker/expression — fable-imagery P1). Gates
     *  emission of the REAL per-primitive uv charts: when false (the common case — no scene
     *  material reads uv), every hit-fill keeps the cheap planar placeholder, so a scene
     *  with no uv materials pays zero chart cost (pre-P1 behavior). Not a linkage seam —
     *  hit.uv is core state — purely the "don't derive what nothing consumes" gate. */
    materialsReadUv: boolean;
    /** Directional-emission gates (softbeam v0 — fable-emitter-profiles.md): backing
     *  materials whose hit-side emission dispatch arm multiplies the kind's cone gate,
     *  with the SAME direction/cosδ literals the light struct's sampler reads (one
     *  profile truth — pt ≡ pt-nee). Baked constants (light geometry rows are never
     *  driven, the v1 pin). PRESENT only when non-empty — programs without cone-gated
     *  emitters carry no field and no dispatch arms (exact linkage, zero churn). */
    emissionCones?: Array<{ materialId: number; direction: [number, number, number]; cosDivergence: number }>;
}

export type LightingDesc =
    | {
        method: 'nee' | 'mis';
        /** LIGHT_SELECTIONS registry id (fable-light-bvh §2) — Validator-gatekept. */
        selection: string;
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

/** The planned SCENE TABLE (fable-object-tables): everything the table-mode codegen
 *  bakes — ledger bases + counts + the present-kind header codes. Built from the
 *  dataTenantsOf adapter's table (the one truth the App packs from too). */
export interface PlannedSceneTable {
    slot: SceneTableSlot;
    /** Records-channel base of the region→material id table (impl-plan-region-
     *  materials; four ids per texel, region-id order) — allocated with the table. */
    regionMaterialsBase: number;
    leafCount: number;
    analyticCount: number;
    /** Records [0, solidCount) are SOLID (the containment loop's range). */
    solidCount: number;
    /** Present tabled primitive kinds with their record-header codes. */
    kinds: Array<{ type: string; code: number }>;
    /** Mesh ordinals with table leaves (constant-placement meshes). */
    tabledMeshOrdinals: number[];
    /** Boxed-SDF leaf records (impl-plan-sdf-accel T2) in RECORD order — slots
     *  [analyticCount, analyticCount + length) in the same region/stride, solids first
     *  within the block (the containment loop's second range). `region` = the object's
     *  region id (≡ scene index, the A5 convention). */
    sdfRecords: Array<{ region: number; type: string; solid: boolean }>;
    /** Present SDF-arm kinds with their header codes (offset past `kinds` — globally
     *  unique headers across both arms). */
    sdfKinds: Array<{ type: string; code: number }>;
}

/**
 * Resolved primitive object for code generation — ONE type for both intersection
 * methods (impl-plan-sdf-as-shape T5, owner-decided Aug 10 2026: "an SDF is a shape
 * with a slow intersect"). There is no SDF *backend*: `intersect` names the routine
 * this object's generated arm calls — the shape's closed form, or its marching form
 * restricted to its declared bound. Everything else about an object is the same
 * either way, which is the whole point of the merge.
 *
 * `index` is the region id (globally unique — §2.3), shared with meshes and batches,
 * so material_of() spans every geometry class.
 */
export interface PlannedPrimitiveObject {
    index: number;
    materialId: number;
    /** The primitive type — registry-validated upstream (A2). */
    type: string;
    /** Authored provenance name (naming batch N5): flows into emitted symbols (hoisted
     *  `shape_<name>` consts, `sdf_<name>` containment helpers) after sanitization +
     *  dedup. Optional and collision-legal (fable-transforms §7.6) — unnamed objects
     *  emit `object_<i>`. */
    name?: string;
    parameters: Record<string, number | number[]>;
    /** Which intersect routine the arm calls: 'closed-form' → `<type>_intersect`,
     *  'march' → `<type>_sdf_intersect` inside the shape's declared bound. Resolved by
     *  the Planner from the primitive's `provides` + any authored `backend:` pin. */
    intersect: 'closed-form' | 'march';
    /** Present when the object keeps a LOCAL frame (parameters are then canonical/unfolded
     *  and the generated arm conjugates the ray into the rigid frame): a DrivenPlacement for
     *  {param} transforms (§6), OR a constant Similarity retained for a PATTERNED + rotated
     *  shape (fable-imagery P1b — the chart needs the frame the fold would dissolve), OR a
     *  rotation residual a non-closed shape cannot absorb. Plain constant placements fold
     *  entirely into `parameters` and this stays undefined. */
    placement?: PlannedPlacement;
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
    localBox?: AABB;
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
    /** This batch claims an INTERIOR (impl-plan-instanced-containment): it leaves the
     *  thin set and `scene_region_at` gains its containment arm, so `ior_of`/
     *  `material_has_medium` answer for points inside its instances. The DECISION
     *  (batchNeedsInterior — wants an interior ∧ can answer containment); generators
     *  read it, never re-derive it. Absent/false = surface-only, the v1 behaviour. */
    hasInterior?: boolean;
    /** The prototype's backend + what the loop's local-intersect needs. mesh: BLAS counts (data
     *  uploaded by the app). analytic: the canonical params + the placement-record tier
     *  (impl-plan-placement-fold stage 3 — the dataTenants adapter's ONE truth): 'frame' =
     *  2-texel rigid record, ray-into-local, params ×s in-shader; 'params' = 1-texel
     *  folded-parameters record, intersected in WORLD space with no conjugation. */
    prototype:
        | { backend: 'mesh'; triCount: number; smooth: boolean; geometrySlot: MeshSlot }
        | {
            backend: 'primitive';
            shapeType: string;
            record: 'frame' | 'params';
            parameters: Record<string, number | number[]>;
            /** Which intersect routine the leaf item calls — the same per-object fact
             *  PlannedPrimitiveObject carries (impl-plan-sdf-as-shape T7). 'march' runs
             *  the prototype's <type>_sdf_intersect inside its declared bound; the
             *  placement record is FRAME tier for marched prototypes (the bound test and
             *  the march both run in the prototype's own frame). */
            intersect: 'closed-form' | 'march';
        };
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
    /** Refractive index n(x) — present iff this is a DEFLECTING (GRIN) medium
     *  (fable-variable-ior.md); a scalar constant/{param}/formula over `p`. */
    ior?: number | GlslExpression | ValueParam<number>;
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
    /** Registry key (registry-validated — A3). */
    kind: string;
    /** Rows keyed by name. A RADIOMETRIC row may be a `ValueParam` (driven-lights Stage A):
     *  the emitted ctor reads the row's uniform instead of a literal, and the selection CDF
     *  is CPU-recomputed on change (`resolveLightValues` → `computeSelectPdf`). Geometry rows
     *  stay constant in v1 (driven light geometry = Stage B). Mirrors PlannedMedium.values. */
    values: Record<string, number | number[] | ValueParam<number> | ValueParam<number[]> | BlackbodyValue>;
    /** The emitter's region id (quad/sphere/mesh) — feeds the generated light_of table. */
    regionId?: number;
    /** Planner-stamped scene context for `power(values, ctx)` (impl-plan-directional-beam
     *  P6) — stamped on EVERY light after desugar (no kind branch; kinds read it or don't).
     *  Never parameter-driven, so the driven-CDF recompute closures are untouched. */
    powerCtx?: { worldRadius: number };
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
    /** Every primitive object, both intersection methods, in scene order (T5). */
    objects: PlannedPrimitiveObject[];
    meshes: PlannedMesh[];
    instanceBatches: PlannedInstanceBatch[];
    /** Present when the scene has table-eligible objects (fable-object-tables) —
     *  read ONLY by 'table'-dispatch programs; 'unrolled' ignores it. */
    sceneTable?: PlannedSceneTable;
    /** The light tree's baked rail slot (fable-light-bvh §5/§7) — present whenever the
     *  scene's lights (registry roster + light-eligible batch instances) are non-empty
     *  and tree-eligible (allocated strategy-independently, the always-upload
     *  precedent); read ONLY by lightSelection 'bvh' programs. `count` spans the GLOBAL
     *  light-index space: [0, registryCount) = table-resident roster lights;
     *  [base, base+count) per instanceLights entry = batch instances in RECORD order
     *  (= Hit.element). strideTexels restates the table-layout truth (0 when no
     *  registry lights). */
    lightTree?: {
        treeBase: number; tableBase: number; trailsBase: number;
        strideTexels: number; count: number; registryCount: number;
        instanceLights: Array<{ ordinal: number; base: number; count: number }>;
    };
    materials: PlannedMaterial[];
    lights: PlannedLight[];

    /** Material id the ambient region (−1) resolves to via material_of(-1), or −1 = vacuum (§2.4). */
    ambientMedium: number;

    /** What the generated program does */
    program: ProgramDescription;

    /** How the GPU program executes */
    pipeline: PlannedPipeline;
}
