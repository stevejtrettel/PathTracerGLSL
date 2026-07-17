# Implementation plan: geometry primitive descriptors

**Status: OWNER-APPROVED July 16 2026, building.** Review amendments: NO byte-
identity gate (proof = tsc + vitest with re-goldened snapshots + glslang + the full
witness sweep — the numbers are the truth); defaults-in-rows approved; stage 3
(cylinder) approved. Without the byte gate the two stages collapse into ONE build
straight to the final shape (math in the primitive GLSL from the start — no interim
authored-TS-emitter step), then cylinder through the new door.

**Goal:** collapse the ~8-site per-primitive scatter into per-primitive descriptors
behind a registry, so a new primitive = one folder + one registry line + one word in
the type union. **Zero rendered-pixel changes; zero input-language changes**
(SceneDescription untouched; torus/capsule stay declared-but-unimplemented).

**Non-goals:** naming-batch items (fable-naming-audit P1–P3), mesh backend, custom
SDF support (Planner.ts:74 rejection stands), torus/capsule implementations (the
door just gets cheap).

---

## 1. Current state (the evidence, file:line)

Per ANALYTIC primitive, knowledge lives in SIX hand-written arms in
`intersection.ts` — `analyticTest` (:317, call + which params are lengths under
driven scale), `analyticNormal` (:361), `drivenLocalNormal` (:345),
`analyticSignedDistance` (:378), `drivenSignedDistance` (:438) — plus the fold arm
(`foldAnalyticParameters`, geometry/index.ts:65), the `PRIMITIVE_PARAMS`
`'backend:type'` row, and the type unions. Per SDF primitive: the body +
`generateSDFCall` (:220) + `IMPLEMENTED_SDF_TYPES` (Planner.ts:26) + row + unions.

Two semantic FACTS are hardcoded inline at their consumers instead of declared:
quad's zero-thickness (`shapeType === 'quad'` at intersection.ts:92 and :418 —
drives `scene_region_thin` and the region-at skip; load-bearing for the one-sided
pin) and quad/sphere samplable-as-light eligibility (Planner.ts:191, Validator
V1-C2).

GLSL: `sdf_primitives.glsl` (sdf_sphere/plane/box, 16 lines),
`analytic_primitives.glsl` (ray_sphere/plane/quad, 50 lines),
`raymarch.glsl` (the marching engine — 119 lines, NOT primitive-specific, stays).

Consumers of `geometry/index.ts`: Planner (canonicalPlane, foldAnalyticParameters,
IMPLEMENTED_SDF_TYPES), Validator (PRIMITIVE_PARAMS), intersection.ts (quadNormal),
lights/quad/quad.ts (quadNormal), tests/compiler/plannerHelpers.test.ts.
(`similarity.ts` consumers are untouched — it stays a family-root shared part.)

Drift evidence motivating the batch: torus/capsule sit in `StandardSDF` with no
arms anywhere; the six-arm pattern is why.

## 2. Target design

### 2.1 Layout (structure.test.ts-compliant)

```
components/geometry/
    README.md          ← REWRITTEN family contract (occupant recipe changes)
    index.ts           ← registry + shared types; re-exports for consumers
    similarity.ts      ← unchanged (allowed root shared part)
    raymarch/          ← the SDF marching engine, content unchanged
        raymarch.glsl
    sphere/   sphere_sdf.glsl   sphere_analytic.glsl   sphere.ts
    plane/    plane_sdf.glsl    plane_analytic.glsl    plane.ts
    box/      box_sdf.glsl      box.ts
    quad/     quad_analytic.glsl  quad.ts     ← hosts quadNormal (one formula, two readers)
```

### 2.2 The descriptor (facts about ONE primitive — the module-anatomy guardrail)

```ts
interface PrimitiveParamSpec {          // extends today's PrimitiveParam
    name: string;
    shape: 'number' | 'vec3';
    required: boolean;
    constraint?: …;                     // as today
    scales: boolean;                    // NEW: length-like → × s under driven placement
    default?: number | number[];        // today's generator defaults, made explicit
}

interface PrimitiveDescriptor {
    type: string;                       // registry key = plain type name (kills 'backend:type')
    params: PrimitiveParamSpec[];       // ONE row; ORDER = GLSL signature order (checked)
    /** Similarity-closure fold (fable-transforms §5.1). Analytic-only for now. */
    fold?(params: Params, g: Similarity): Params;
    sdf?: {
        glsl: string;                   // must define  float sdf_<type>(vec3 p, …row)
        emitCall?(values: Params, scaleExpr?: string): string;   // override; default DERIVED
    };
    analytic?: {
        glsl: string;                   // must define  bool ray_<type>(Ray, …row[, extra], out float t)
        emitTest?(values: Params, rayVar: string, scaleExpr?: string): string;  // override (quad)
        emitNormal(values: Params): string;                 // stage 1: authored (moved verbatim)
        emitLocalNormal(values: Params): string;            // driven rigid-frame arm
        emitSignedDistance(values: Params, driven?: boolean): string;
        thin?: boolean;                 // zero-thickness (quad): region-at skip, scene_region_thin, one-sided
        samplableAsLight?: boolean;     // quad/sphere: §6.2 eligibility (Planner + Validator read here)
    };
}

export const PRIMITIVES: Record<string, PrimitiveDescriptor> = { sphere, plane, box, quad };
```

### 2.3 Derived call emitters (the default path)

One generic function replaces every mechanical arm:

```ts
emitCall(fn, row, values, scaleExpr?) =
    `${fn}(${lead}, ${row.map(f => maybeScale(format(f, values), f))join(', ')})`
```

— format by `shape` (formatVec3/formatFloat + row default), `scales && scaleExpr`
→ `s * lit`, arguments in row order, `fn` from the naming convention
(`sdf_<type>` / `ray_<type>`). Override hook for the irregular case: quad's
`ray_quad` fifth argument is the PRECOMPUTED `quadNormal(edge1, edge2)` — derived
data, not a param. **Byte-compat requirement:** derived strings must reproduce
today's arm output character-for-character (same formatters, same defaults — the
defaults currently live inline in the arms, e.g. `p.radius ?? 1.0`; they move into
the row).

### 2.4 What stays central in intersection.ts (generators decide)

The dispatch loops (`sdf_object_<i>` wrappers, `scene_march_bound`,
`scene_object_sdf`, `scene_region_at`, the `scene_intersect` combiner with §4.2
classification), the placement tiers (`emitPlacementQuery` — placement-generic),
the region tables (`material_of`/`ior_of`), and `scene_region_thin` EMISSION (now
reading `descriptor.analytic.thin` instead of `shapeType === 'quad'`).

### 2.5 Consumer migrations

- **Planner**: `IMPLEMENTED_SDF_TYPES` → derived (`PRIMITIVES[t]?.sdf` present —
  same diagnostic text); `foldAnalyticParameters` → `PRIMITIVES[t].fold`;
  `canonicalPlane` → plane descriptor's export (re-exported from index.ts, call
  sites unchanged); samplable-kind check → `samplableAsLight` fact.
- **Validator**: `PRIMITIVE_PARAMS['kind:type']` lookups → `PRIMITIVES[type].params`
  + a backend-availability check (same diagnostics; the composite keys die).
  V1-C2's kind list reads the descriptor fact.
- **lights/quad**: `quadNormal` import path only.
- **Type unions**: UNCHANGED (input vocabulary, not registry shadows —
  reject-not-remove; the pinned MaterialModel lesson applies).

### 2.6 Symbol-contract test (fable-naming-audit P4, geometry instance)

New structure-test: each descriptor's GLSL must define its contracted symbols
(`float sdf_<type>(` / `bool ray_<type>(`; stage 2 adds `<type>_normal(`,
`<type>_signed_distance(`). This is the template the naming batch generalizes to
materials/phases/lights.

## 3. Stages and proof

### Stage 1 — extraction, output-preserving

Descriptor type + registry; split the two library GLSL files into per-primitive
files (content verbatim); derived call emitters (+ quad override); the normal /
signed-distance / fold arms move ONTO descriptors as authored functions, bodies
verbatim from intersection.ts; consumer migrations (§2.5); symbol-contract test;
README rewrite.

**Proof — the precise gate:** (a) GENERATED blocks byte-identical across every
suite pair (the derived emitters and relocated arms must reproduce today's strings
exactly); (b) library blocks identical modulo COMMENT lines only (splitting one
file into per-primitive files changes header comments; gate = hash equality of
comment-stripped assembled GLSL, plus an eyeballed diff of the comment delta);
(c) `npx tsc`, full vitest (snapshot churn = provenance/origin renames only — the
components-move precedent), full `npm run witness` green.

### Stage 2 — math into GLSL (the transport rule applied)

Per-shape math leaves the compiler: `<type>_normal(…)`,
`<type>_signed_distance(…)` become real functions in the shape's GLSL files
(driven variants = the same functions with s-scaled arguments), and their calls
derive from the row like everything else. Descriptors shed the authored emitters
(overrides remain where genuinely irregular). "Math is static; policy/plumbing are
generated" — today shape math lives inside compiler-emitted strings, the exact
pattern the transport split killed.

**Proof (byte-identity impossible by design — transport-split style):** glslang
static compile of every pair; snapshots re-goldened (structure diff = inline-expr →
call sites); FULL witness sweep with special attention to the geometry-sensitive
set (transform-bake, flatten-tree, conjugation, regions-transformed, driven ×2,
analytic twins, fog-panel); perf wash check via dump + a timing spot-check; owner
GPU eyeball invited.

Each stage independently shippable; stage 2 is severable if stage 1's shape reveals
problems.

## 4. The door test (optional stage 3 — owner's call)

Add ONE new primitive through the new door (cylinder, SDF backend) to prove the
cost claim end-to-end: folder + registry line + union word + a demo card. This is
the first-occupant-through-the-front-door pattern (GGX's role for materials).

## 5. Deferred ledger

Custom SDF arm (rejection stands; the descriptor's `sdf.glsl` slot is where it
would land); mesh backend (a third backend slot on the descriptor — the shape is
ready, nothing built); torus/capsule bodies; `scales`-driven UBO/table packing
(batch-codegen era); naming-batch items P1–P3; symbol-contract tests for the other
families (naming batch).
