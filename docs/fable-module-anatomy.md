# Module Anatomy & Property Machinery — decisions

**Status:** Design decisions from owner discussion (July 2026). Supplements
[fable-compiler-contracts.md](fable-compiler-contracts.md) — §3.3 (model plugin), §3.4
(scene-generated `MaterialProperties`), §3.5 (medium twin), §6.2 (light registry) remain the
authority; this doc makes their TS-side shapes concrete and records the pins reached in
discussion. **File reorganization is DEFERRED by owner decision** — it becomes worthwhile only
once enough model files exist to warrant it (§6 records the agreed layout for that day).
**Date:** July 2026

---

## 1. The constraint this all hangs on (recap)

GLSL has no polymorphism; transport is one generic compiled loop; a single hit needs the same
resolved properties in up to three independent calls (emission, NEE eval, sample). Therefore the
properties either travel through transport in a **model-agnostic container** (union-shaped) or are
**re-derived inside every dispatch call** (fetch-multiplied — real cost once properties go
procedural, and it hits single-model scenes too). There is no third topology.

§3.4's scene-scoped generated struct is the resolution: the union survives as the carrier, but it
is **machine-generated per scene from the schemas of the models present** — so it scales with
*scene diversity* (a handful of models), never with *library size*. Key degeneracy: a
single-model scene's generated struct IS that model's struct — the union/per-model designs
coincide exactly where all the numeric witnesses (F-BOX, F-ETA, F-SLAB) live. Fetch stays
once-per-hit in transport; today's call topology is unchanged.

## 2. The descriptor — §3.3 made concrete

A material model is **one GLSL file + one TS descriptor**, co-located as a pair, discovered via a
per-family registry. Everything else (struct field, resolver arm, dispatch arm, generated tables,
NEE guard, include) is *derived* from the descriptor by the feature planner.

```typescript
interface MaterialModelDescriptor {
  id: string;                               // 'lambert' | 'dielectric' | ...
  glsl: string;                             // ?raw import — provides <id>_eval/sample/pdf/emission (§3.2, (uc,u) form)
  properties: PropertySchema[];             // → scene-scoped struct + resolver (§3.4)
  capabilities: {                           // → compile-time specialization (§3.3)
    deltaLobes: boolean;                    //   NEE guard (material_has_nondelta_lobes), prev_was_delta tracking
    transmission: boolean;                  //   spawn-offset side, current_medium updates (§4.4)
    emissive: boolean;                      //   emission call emitted at all; light-registry eligibility (§6.2)
  };
}

interface PropertySchema {
  name: string;                             // struct field name; shared across models by name+type
  glslType: 'float' | 'Spectrum' | ...;     // typedefs, per §2.5
  semantic: 'radiometric' | 'geometric';    // radiometric constants format via formatSpectrum (§2.5)
  default: unknown;
  storage: 'field' | 'region-table';        // region-table → generated <name>_of(region) (the ior_of lesson:
                                            //   some "material properties" are region-indexed and read for the
                                            //   FAR side of a boundary — a point-fetch can't express that)
  kinds: ('constant' | 'param' | 'procedural')[];  // procedural gated per §10.2 (archive Phase-1 presumptive)
}
```

**Guardrail (the archive's grave):** descriptors declare *facts about one model* — never
composition, ordering, passes, or pipeline structure. All decisions stay in feature-planner
*code*. Schemas declare facts; generators decide.

**Media are the same machinery:** a phase-model descriptor declares into `MediumProperties`
(§3.5, already pinned scene-generated) instead of `MaterialProperties`. Same `PropertySchema`
type, second struct family; a tinted-glass material contributes to both. Emission needs nothing
new here — §6.2 settled it (materials carry the radiometric fact, regions carry identity via
`light_of`); the `emissive` capability flag is what makes "which materials emit" static knowledge.

## 3. Property pins (new in this discussion)

- **Delivery invariance:** model GLSL reads `mp.<field>`, full stop. *How* the resolver delivers
  it — inline if-chain (few materials), uniform array (dozens), float-texture table (hundreds,
  §4.7 batches) — is a generator-owned scaling decision, invisible to model files. This is the
  interface half of §10.2's open "parameter packing at scale"; the packing implementations stay
  open.
- **Shared fields:** two models declaring the same `name` with the same `glslType` share one
  struct field (deliberate — GGX and rough-dielectric share `roughness`). Same name with a
  different type is a **Validator error** (mirrors §2.10 uniform dedupe).
- **Scene-scoped enforcement for free:** a model reading a field it didn't declare happens to
  compile in scenes where another model declared it — and *fails to compile* in that model's
  minimal scene, mapped by ErrorOverlay to the offending line. The suite's minimal scenes are the
  schema discipline's enforcement mechanism.
- **§3.4's "resolution machinery unchanged" clarified:** the *behavior* (constants baked,
  `Value<T>` → uniforms, expressions inlined) is unchanged; the *implementation* becomes one
  generic loop over schemas, replacing the hand-written per-field triples in materials.ts. That
  swap is part of the deferred reorganization pass (§7), not the dielectric.

## 4. Compile-time specialization (the standing principle, named)

The generated shader contains exactly what the scene and strategy use — structure specialized
away at compile time; values stay live as uniforms only where authored as `Value<T>`. Generality
lives in the compiler; emitted GLSL is allowed to be ruthlessly particular. (Already the house
style: backend dispatch, dispatch collapse, `shadow_transmittance` boolean form, dead-guarded NEE,
§7.2's "compiles to something as small as today's template".) Two disciplines attach:

1. **Every specialization branch needs a scene that summons it** (the two-light lesson: the
   multi-light CDF was dead code until a scene exercised it). The suite is the compiler's
   branch-coverage, locked by the GLSL snapshot test.
2. **Specialization comes from generic generators over declarations, never hand-authored
   variants.** `if (model === 'dielectric')` in a generator, beyond including its file, is the
   smell that killed the archive.

## 5. Family taxonomy (generator-facing, not layout-facing)

- **Mix-many families** — materials, lights, phase functions, geometry backends: several members
  coexist per shader, selected per-hit → the compiler generates combination machinery (union
  struct, dispatch, CDF, `material_of`/`light_of`/`ior_of` tables). Rich descriptors now.
- **Pick-one families** — ambient space, camera, transport loop, tonemap: one member per shader,
  chosen by scene/strategy → planner selects a file; no dispatch, no union. Descriptors stay thin
  until a fact needs declaring (H³ will declare `Point = vec4` — same concept, less data).

The distinction decides what a feature planner *does* with a family. It is deliberately **not** a
directory split (an earlier `glsl/` vs `models/` proposal died in review — pluggability is the
whole compiler, not a property of materials).

## 6. File layout — DEFERRED, recorded for when it's warranted

One tree, one folder per contract family, descriptor pairs co-located:

```
glsl/
  core/        structs, math, rng, ray, interaction        # always-present contract spine
  ambient/     euclidean (+ h3, schwarzschild)             # pick-one
  geometry/    raymarch, sdf_primitives, analytic_primitives  # mix-many
  materials/   lambert.{glsl,ts}, dielectric.{glsl,ts}, index.ts  # mix-many
  lights/      point.{glsl,ts}, index.ts                   # mix-many
  phase/       hg.{glsl,ts}                                # mix-many
  transport/   path_trace, shadow_opaque                   # pick-one per strategy
  camera/      camera_pinhole                              # pick-one
  film/        main_accumulate, tonemap_reinhard, fullscreen.vert
```

Adoptable **immediately** (no file moves): the **header discipline** (every model file carries
lambert.glsl's header form — conforms-to §, fields read, provides, depends-on) and **path-shaped
block origins** (`glsl/lambert.glsl`, `generated:material-resolver`) so dump:shaders provenance
reads as a table of contents.

## 7. Staging (owner-decided)

1. **Dielectric first, on today's plumbing.** Hand-add its one struct field (`transmittance`) and
   the generated `ior_of` table; no descriptor machinery yet. Rationale (verification asymmetry):
   the dielectric *creates* the witnesses (F-ETA, R-SUBMERGED, X-GLASS) — refactors should run
   against witnesses, not alongside the feature that introduces them.
2. **Reorganization pass later, as one unit, when file count warrants:** family folders +
   descriptor type (Lambert, dielectric, point light as first instances) + schema-driven
   struct/resolver generation replacing the hand-written triples. Byte-identical GLSL,
   snapshot-guarded, with the numeric witnesses as the semantic backstop.
   *(Trigger watch, July 2026: the media + area-light builds added phase_hg, medium_analytic,
   light_quad, light_sphere on hand-written plumbing — the model-file count now plausibly
   warrants the pass; GGX would make it overdue.)*

## 8. Drift ledger (docs ↔ code), status at writing

- **Decision-hoist batch (July 2026, `impl-plan-decision-hoist.md`):** strategy schema now
  three-sectioned per `fable-strategy-taxonomy.md` (contracts §7.3's flat sketch is
  superseded on *shape*, unchanged on *semantics* — annotated there); `ProgramDescription`
  is the complete link map (Generate never reads analyzer facts — the §2.10 "Planner
  concatenates" wording remains drift: collection happens in Generate, harmless);
  contributions now carry `provides`/`requires` (the review-endorsed `PlannedResource`
  sketch, realized); generated GLSL statically compiled in CI (glslang; NOT ANGLE —
  dialect quirks stay with GPU witnesses).

- **Reconciled by annotation** (uncommitted, July 2026): §2.9/§3.2 `(uc, u)` sampler split;
  §3.1 `LOBE_NULL` dropped for compile-time `is_null_interface`; §7.2 RR metric →
  `spectrum_max` (item 6) with the modular-metric note and the dielectric-era `etaScale` warning.
- **Code change DONE (dielectric phase 0):** RR placement moved to the §7.2 pin (post-`weight` —
  both placements proven unbiased; post-weight decides on strictly better information, kills
  worthless paths before the next trace, matches PBRT).
- **Reconcile at procedural-media ratification (§10.2):** the current slice's raw *expression*
  property kind vs the archive Phase-1 *function/`compute`* form.
