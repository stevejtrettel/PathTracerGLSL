// components/descriptors.ts
// Descriptor types for mix-many families (impl-plan-descriptor-reorg R1; shapes from
// fable-module-anatomy.md §2, adjusted to current reality — (uc,u) samplers, the
// region-table storage kind from the ior lesson). These interfaces define what a
// component IS, so they live with the component library; the resolved-data types they
// reference (PlannedLight/PlannedMaterial/PlannedMedium) stay compiler-owned and cross
// type-only (the components purity rule: contract TYPES may cross, values may not).
//
// THE GUARDRAIL (module-anatomy §2, "the archive's grave"): a descriptor declares facts
// about ONE model — never composition, ordering, passes, or pipeline structure. Fields
// may be functions (a pdf arm is kind-specific math, a fact expressed as code); they may
// NOT reference other descriptors or the plan. All decisions stay in feature-planner code.

import type { MaterialModel } from '../compiler/types.js';
import type { Similarity } from './geometry/similarity.js';

/**
 * A field of a scene-scoped properties struct (MaterialProperties / MediumProperties)
 * that a model READS. The struct is the union of declared fields of the models present
 * (§3.4); the resolver assigns only declared fields (R2). The row's `source` IS the
 * property vocabulary (materials-§7): no compiler type names a property, so a new model
 * with a new property adds a row here and nothing anywhere else.
 */
export interface PropertySchema<TSource extends string = string> {
    /** Struct field name; shared across models by name+type (same name, different
     *  glslType is a Validator error — module-anatomy §3). */
    name: string;
    glslType: 'float' | 'Spectrum';
    /** radiometric constants format via formatSpectrum (§2.5); geometric via formatFloat. */
    semantic: 'radiometric' | 'geometric';
    /** Mathematical input domain required by the implementation. Omitted means the model
     *  accepts the full numeric range; this is not a general artistic-policy clamp. */
    domain?: 'nonnegative' | 'positive';
    /** Which resolved data field feeds it — ALSO the authored scene key the resolver
     *  reads (materials-§7 reorg: resolution derives from the row). */
    source: TSource;
    /** Numeric default — ONE truth (the geometry batch's defaults-in-rows lesson).
     *  Spectrum rows broadcast the scalar; the GLSL default expression is DERIVED
     *  (semantic formatter + the SPECTRUM_ZERO/ONE constants), never authored. */
    default: number;
    /** 'field' → struct member resolved at the shading point; 'region-table' → a
     *  generated <name>_of(region) table (read for the FAR side of a boundary — a
     *  point-fetch cannot express that; the ior lesson). */
    storage: 'field' | 'region-table';
}

/** A surface material model: one GLSL file + these facts (contracts §3.2/§3.3). */
export interface MaterialModelDescriptor {
    id: MaterialModel;
    /** ?raw source providing <id>_eval / <id>_sample / <id>_pdf / <id>_emission
     *  in the (uc, u) sampler form. */
    glsl: string;
    /** Fields this model READS → scene-scoped struct + resolver (§3.4, R2). */
    properties: PropertySchema[];
    capabilities: {
        /** Has lobes NEE can sample (false = pure delta: eval ≡ 0, shadow rays wasted).
         *  Feeds material_has_nondelta_lobes directly. (Polarity flipped vs
         *  module-anatomy §2's `deltaLobes` sketch for clarity — same fact.) */
        nonDeltaLobes: boolean;
        /** Transmissive models: ior region-table exists, transport tracks eta_scale. */
        transmission: boolean;
        /** May emit — eligibility for the emission gate + light registry (§6.2);
         *  whether a given MATERIAL emits stays a per-value analysis. */
        emissive: boolean;
    };
}

/** One row of a light kind's parameter schema (struct-alignment batch): struct field
 *  AND `PlannedLight.values` key. ROW ORDER = STRUCT FIELD ORDER = CTOR ORDER —
 *  the struct itself is GENERATED from these rows (A1: one declaration, everything
 *  derived), and the dispatcher constructs it positionally. */
export interface LightParamSpec {
    name: string;
    shape: 'number' | 'vec3';
    /** radiometric values format via formatSpectrum + type Spectrum (§2.5); geometric
     *  via formatFloat/Vec3. */
    semantic: 'radiometric' | 'geometric';
    /** Geometric kind (required for geometric rows): drives the generated struct's
     *  typedef (point → Point, direction → Direction, vector → vec3, length → float)
     *  and, later, the Value<T>-light-params transform rules — the same table as
     *  geometry. Ignored for radiometric rows (they are Spectrum). */
    kind?: ParamKind;
}

/** A DERIVED struct field declaration (A1): computed by derivedCtorFields, appended
 *  after the rows — name + typing declared here so the generated struct and the
 *  positional ctor cannot disagree. */
export interface DerivedFieldSpec {
    name: string;
    kind: ParamKind;
    shape: 'number' | 'vec3';
}

/** A samplable light kind: one GLSL file + these facts (contracts §6.1/§6.2).
 *
 *  The GLSL is STRUCT-SHAPED (struct-alignment batch — the house pattern): the file
 *  declares `struct <Kind>Light` whose field order = the rows (+ derivedCtorFields)
 *  and BOTH halves of the kind's math as adjacent functions —
 *  `LightSample <kind>_light_sample(<Kind>Light l, Point p, vec2 xi)` and, for
 *  hittable (non-delta) kinds, `float <kind>_light_pdf(<Kind>Light l, Point p,
 *  Point light_p, Direction wi)` (the uniform pdf signature; kinds ignore what they
 *  don't need). The §6.1 byte-match invariant (pdf mirrors sampler) is now two
 *  ADJACENT GLSL functions reading one struct — never TS strings.
 *
 *  Descriptors declare facts and return numbers; the lighting feature composes
 *  (selection CDF, two-stage env wrapper, dispatcher, hoisted consts). */
export interface LightKindDescriptor {
    /** Registry key — validated against the registry (A2/A3: adding a kind touches
     *  no union). */
    kind: string;
    /** ?raw source per the struct contract above. */
    glsl: string;
    /** Delta kinds: not hittable, LIGHT_DELTA, no region, no <kind>_light_pdf. */
    delta: boolean;
    /** The kind's AUTHORED input schema (C7 parity with geometry): the fields an
     *  authored light carries BESIDES `kind` and `emission` (B2's universal radiometric
     *  word — validated generically, never listed here). The authored language may
     *  differ from the registry rows (sphere: authored `position` → row `center`), which
     *  is exactly why this second list exists. The Validator's generic loop enforces
     *  unknown-key/required/shape from it and runs `validateAuthored` ONLY when shapes
     *  pass — degeneracy rules may assume well-shaped input. The desugar-totality
     *  contract test keeps this list and toValues/region.parameters honest in BOTH
     *  directions (declared-but-unread and read-but-undeclared both fail vitest). */
    authoredParams: { name: string; shape: 'number' | 'vec3'; required: boolean }[];
    /** DESUGAR FACTS (A3 — the lights door): how an AUTHORED light of this kind
     *  lowers. `toValues` builds the registry values from the authored fields + the
     *  precomputed radiometric product (color·intensity). Hittable kinds declare
     *  `region` — the backing emitter primitive the desugar synthesizes — and
     *  `valuesFromRegion`, the sampleAsLight route's inverse (registry values from a
     *  FOLDED region's parameters + Le), so both authoring routes share one kind
     *  definition. `validateAuthored` returns degeneracy messages (quad area,
     *  sphere radius) the Validator emits verbatim. */
    toValues(authored: Record<string, unknown>, product: number[]): Record<string, number | number[]>;
    region?: {
        primitive: string;
        parameters(authored: Record<string, unknown>): Record<string, number | number[]>;
    };
    valuesFromRegion?(parameters: Record<string, number | number[]>, Le: number[]): Record<string, number | number[]>;
    validateAuthored?(authored: Record<string, unknown>): string[];
    /** Struct rows, keyed into PlannedLight.values (row order = ctor order; the
     *  struct is GENERATED from them — A1). */
    params: LightParamSpec[];
    /** Declared derived struct fields (A1) — the generated struct's tail. */
    derivedFields?: DerivedFieldSpec[];
    /** Computed compile-time values for `derivedFields`, same order (quad: the
     *  precompiled one-sided normal + area — the normal MUST stay the same
     *  compile-time literal geometry's quad bakes; bit-exact one-sided pin). */
    derivedCtorFields?(values: Record<string, number | number[]>): (number | number[])[];
    /** Emitted power for CDF selection (pbrt PowerLightSampler formulas) over the
     *  resolved values — a CPU selection heuristic, returns a number. */
    power(values: Record<string, number | number[]>): number;
}

/** A phase model: one GLSL file declaring into MediumProperties (§3.5) — the same
 *  schema machinery, second struct family. */
export interface PhaseModelDescriptor {
    id: string;
    /** ?raw source providing <id>_eval / <id>_sample / <id>_pdf (LOBE_MEDIUM). */
    glsl: string;
    properties: PropertySchema[];
}

// ============================================================================
// Geometry primitives (impl-plan-geometry-descriptors) — one descriptor per
// primitive; both backends' facts together. Same guardrail as every family:
// facts about ONE primitive, never composition (the dispatch loops, placement
// tiers, and region tables stay in the intersection feature).
// ============================================================================

/** Authored parameter values as they appear in the scene description. */
export type PrimitiveValues = Record<string, number | number[]>;

/** Geometric kind of a parameter — how it transforms under a similarity g = (R, t, s).
 *  ONE declaration from which BOTH derivations flow (T1–T5, owner-approved):
 *    point → g·p (rotate, scale, translate)   vector → sR·v (no translation)
 *    direction → R·d (rotation only)          length → s·ℓ (scale only; number or vec3)
 *  Driven ×s scaling derives from the same table: every kind scales except direction. */
export type ParamKind = 'point' | 'vector' | 'direction' | 'length';

/** One row of a primitive's parameter schema. ROW ORDER = GLSL SIGNATURE ORDER
 *  (the derived call emitters splice arguments positionally — checked by the
 *  symbol-contract test). */
export interface PrimitiveParamSpec {
    name: string;
    /** How the value transforms (see ParamKind). kind is about transformation
     *  semantics; `shape` is about arity — kind cannot imply shape (halfSize is a
     *  vec3 of lengths). point/vector/direction require shape 'vec3' (contract test). */
    kind: ParamKind;
    shape: 'number' | 'vec3';
    /** Required = no sensible default exists (a sphere without a radius is a typo,
     *  not a unit sphere — review C7). REQUIRED XOR DEFAULT (contract-test-enforced):
     *  a default on a required row is dead on the validated path and a silent value
     *  on any path that bypasses validation — declare one or the other. */
    required: boolean;
    /** Generator default, baked when the author omits the param (moved here from
     *  the old inline `?? …` arms — owner-approved). Only on non-required rows. */
    default?: number | number[];
    /** Mathematical domain required by the implementation (Validator-interpreted). */
    constraint?:
        | { kind: 'positive' }
        | { kind: 'positive-components' }
        | { kind: 'min-length'; value: number };
}

/** Call-site context for emitted per-primitive expressions: the query/hit point
 *  expression in the frame the call runs in, and the driven scale expression
 *  (absent for constant placement — literals are pre-folded then). */
export interface PrimitiveEmitCtx {
    point: string;
    scale?: string;
}

/** A geometry primitive: one GLSL file (BOTH backends' math, included wholesale
 *  when the primitive is present — contracts §2.12) + these facts, FLAT (T1–T5:
 *  the nested analytic block died with the hand-written folds).
 *
 *  The GLSL is STRUCT-SHAPED (house convention — the MaterialProperties pattern):
 *  `struct <Type>` whose field order = the schema row (+ derivedCtorFields), and
 *  functions over it — `float <type>_sdf(vec3 p, <Type>)` iff `provides.sdf`;
 *  `bool <type>_intersect(Ray, <Type>, out float t)` and
 *  `vec3 <type>_normal(vec3 p, <Type>)` iff `provides.analytic`. Call sites
 *  construct the struct from compile-time literals (constant placement) or
 *  s-scaled expressions (driven rigid frame); all emission is DERIVED from the row.
 *
 *  Descriptor functions receive RESOLVED values (row defaults already applied) and
 *  return NUMBERS — the framework does all GLSL formatting; descriptors never build
 *  strings. */
export interface PrimitiveDescriptor {
    type: string;
    /** ONE schema row for both backends (order = struct field order = constructor
     *  order — see PrimitiveParamSpec). */
    params: PrimitiveParamSpec[];
    /** ?raw source with this primitive's math. */
    glsl: string;
    /** Declared occupant surface — declare-and-verify, both directions (the contract
     *  test checks symbols exist iff declared). sdf also serves analytic containment
     *  (scene_region_at) — the sdf slot's three clauses bind approximate SDFs too. */
    provides: { sdf: boolean; analytic: boolean };
    /** Declared derived struct fields (A1) — the generated struct's tail; values
     *  computed by derivedCtorFields in the same order. */
    derivedFields?: DerivedFieldSpec[];
    /** Zero-thickness (quad): never claims containment in scene_region_at, is
     *  one-sided under region_to emission, and needs the entering-side probe on
     *  back-face hits (audit H2's scene_region_thin). THE DICHOTOMY (owner, Jul 16
     *  2026): every primitive provides sdf XOR declares thin — contract-test-enforced.
     *  Default false. */
    thin?: boolean;
    /** §6.2 sampleAsLight eligibility (quad/sphere) — Planner registry entry +
     *  Validator V1-C2 both read this fact. Default false. */
    samplableAsLight?: boolean;
    /** Computed compile-time struct fields appended after the row's fields
     *  (quad: the precompiled one-sided normal — MUST stay a compile-time
     *  value so hit side and the quad light's sampler agree bit-exactly).
     *  Values, not strings; never scaled (they are directions/derived data). */
    derivedCtorFields?(values: PrimitiveValues): (number | number[])[];
    /** Canonical-form normalization of authored values (plane: unit normal + scaled
     *  offset — the SDF expression is a true distance bound only then; disk: unit
     *  normal). Applied by the framework ONCE per parameter set, on every Planner
     *  path (constant fold, driven-analytic, SDF placement) — never a type-name
     *  branch, never inside `fold` (folds receive already-canonical values; direction
     *  kinds stay unit under R). Must be idempotent in exact arithmetic; the
     *  framework guarantees single application so fp drift can't accumulate. */
    canonicalize?(values: PrimitiveValues): PrimitiveValues;
    /** Similarity-closure fold OVERRIDE (fable-transforms §5.1). ABSENT = derived
     *  from kinds (point → g·p, vector → sR·v, direction → R·d, length → s·ℓ).
     *  Declare only when a parameter's rule couples several pieces (plane: the new
     *  offset needs the translation AND the rotated normal together). Receives
     *  resolved, CANONICALIZED values. */
    fold?(values: PrimitiveValues, g: Similarity): PrimitiveValues;
}
