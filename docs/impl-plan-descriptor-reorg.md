# Implementation Plan — Descriptor/Schema Reorg (module-anatomy §7 step 2)

**Author:** Fable (July 2026, owner-approved sequence: after the transport split, before GGX)
**Status:** planned
**Authority:** [fable-module-anatomy.md](fable-module-anatomy.md) §2–§6 (descriptor shapes,
family taxonomy, file layout — this plan implements them); contracts §3.3/§3.4/§3.5.
**Kind:** refactor-only. R1 is byte-identical (stronger than the split's gate: zero text
churn, not proven-equivalent churn); R2 has one contained, intended churn (the §3.4 struct
finally becomes scene-scoped). Don't mix GGX in — GGX is the first *customer*, not part
of the batch.

## Why now

The §7 trigger fired: lambert, dielectric, hg, three light kinds, two env charts — all on
hand-written plumbing. Adding a material today means editing four places (property triples,
struct field, dispatch arm, capability constant); after this batch it means **one GLSL file
+ one descriptor**, and the extension-cost test (≤2 touchpoints) finally holds. This also
pays back the decision-hoist's temporary three-touchpoint tax: descriptors declare facts,
the feature planners derive generically.

**The guardrail (module-anatomy §2, "the archive's grave"):** descriptors declare facts
about ONE model — never composition, ordering, passes, or pipeline structure. All decisions
stay in feature-planner code. `if (model === 'dielectric')` in a generator, beyond
including its file, is the smell that killed the archive — R1's job is to delete the
instances that exist today.

## The descriptor types (module-anatomy §2, adjusted to current reality)

```typescript
interface MaterialModelDescriptor {
    id: MaterialModel;
    glsl: string;                            // ?raw — provides <id>_eval/sample/pdf/emission, (uc,u) form
    properties: PropertySchema[];            // fields this model READS → struct + resolver (§3.4)
    capabilities: {
        deltaLobes: boolean;                 // → material_has_nondelta_lobes arm
        transmission: boolean;               // → ior region-table eligibility, HAS_TRANSMISSION-era logic
        emissive: boolean;                   // → emission gate eligibility, light-registry eligibility (§6.2)
    };
}

interface PropertySchema {
    name: string;                            // struct field; shared across models by name+type
    glslType: 'float' | 'Spectrum';
    semantic: 'radiometric' | 'geometric';   // radiometric → formatSpectrum (§2.5)
    source: keyof PlannedMaterial;           // which resolved material field feeds it
    default: string;                         // GLSL default expr (e.g. 'SPECTRUM_ONE')
    storage: 'field' | 'region-table';       // region-table → <name>_of(region) (the ior lesson:
                                             //   read for the FAR side of a boundary — no point-fetch)
}

interface LightKindDescriptor {
    kind: 'point' | 'quad' | 'sphere';
    glsl: string;                            // sampler library file
    delta: boolean;                          // LIGHT_DELTA; no region, no pdf arm
    power(l: PlannedLight): number;          // CDF weight (pbrt formulas — moves from lighting.ts)
    emitSampleCall(l: PlannedLight, xiExpr: string): string;      // the dispatcher arm
    emitPdfArm?(l: PlannedLight, selectExpr: string): string[];   // lighting_pdf arm (non-delta only)
}

interface PhaseModelDescriptor {
    id: 'hg';
    glsl: string;                            // provides <id>_eval/sample/pdf (§3.5)
    properties: PropertySchema[];            // → MediumProperties (same machinery, second family)
}
```

Descriptor fields MAY be functions (power/emitSampleCall are facts about one kind expressed
as code); they may NOT reference other descriptors, ordering, or plan structure.

## R1 — descriptors + generic generators, byte-identical

Wire descriptors and make the feature planners generic, reproducing today's emission
exactly. The derivation inventory (descriptor fact → replaces this hand-written site):

| Descriptor fact | Generated artifact | Today's hand-written site |
|---|---|---|
| material `glsl` | model include | `if (model === 'lambert') blocks.push(...)` (materials.ts) |
| material id list per model | §3.3 dispatch arms | `generateInteractionDispatch` (stays, but iterates registry order) |
| `capabilities.deltaLobes` | `material_has_nondelta_lobes` | `MODEL_HAS_NONDELTA_LOBES` const (materials.ts:19) |
| `capabilities.emissive` (+ constant/param analysis) | `material_is_emissive` | `isEmissive()` (materials.ts:35) |
| `capabilities.transmission` | ior_of inclusion, transmission flags | `model === 'dielectric'` checks (materials.ts, intersection.ts, Planner brdf logic) |
| `properties` (+ `source`) | `{param}` uniform scan | the hand-listed `addParamUniform` calls (materials.ts:97–106) |
| light `glsl` | per-kind sampler include | `plan.lights.some(kind) && blocks.push` (lighting.ts:72–80) |
| light `power` | CDF weights | `lightPower()` (lighting.ts:144) |
| light `emitSampleCall` | selection dispatcher arms | `sampleCall()` (lighting.ts:155) |
| light `emitPdfArm` | `lighting_pdf` arms | quad/sphere branches in `generateLightingPdf` |
| phase `glsl` | phase include | the `scatteringLive` push (materials.ts) |

Registries: `materials/index.ts`, `lights/index.ts`, `phase/index.ts` — plain
`Record<id, Descriptor>`; feature planners iterate models/kinds PRESENT (per-scene
specialization unchanged).

**File layout (module-anatomy §6, adopted verbatim + an env family):**

```
glsl/core/       structs, structs_media, interaction, math, math_media, math_mis, rng, ray
glsl/ambient/    euclidean
glsl/geometry/   raymarch, sdf_primitives, analytic_primitives
glsl/materials/  lambert.{glsl,ts}, dielectric.{glsl,ts}, index.ts
glsl/lights/     point.{glsl,ts}, quad.{glsl,ts}, sphere.{glsl,ts}, index.ts
glsl/phase/      hg.{glsl,ts}, index.ts
glsl/transport/  shadow_opaque, shadow_media, medium_analytic     (pick-one bodies; loop is TS)
glsl/camera/     camera_pinhole
glsl/film/       main_accumulate, tonemap_none, tonemap_reinhard, fullscreen.vert
glsl/env/        env_chart_equirect, env_chart_octahedral, env_sampler_cdf
```

Header discipline (module-anatomy §6): every model file carries the conforms-to / fields-read
/ provides / depends-on header form.

**R1 gate:** emitted shader TEXT byte-identical for every registry pair (the snapshot diff
may contain ONLY provenance-origin renames from the file moves — verified by diff shape);
tsc clean; 443 green; glslang green.

## R2 — the §3.4 struct goes scene-scoped (the one intended churn)

`MaterialProperties` is currently a fixed superset in structs.glsl (the hand-added
`transmittance` comment marks the IOU). R2 generates it as **the union of fields declared
by the models present**, and the resolver assigns only declared fields with schema
defaults. Consequences, all intended:

- a Lambert-only scene's struct is `{albedo, emission, emission_strength}` — no
  `transmittance`, no `roughness` (no current model declares roughness; it returns with
  GGX's schema);
- resolver arms lose dead assignments; the `{param}` scan follows schemas (a driven
  parameter on an undeclared field is a Validator WARNING — silently-inert params are the
  C5 bug class);
- shared fields dedupe by name+type; same name/different type is a Validator error
  (module-anatomy §3 pin);
- `MediumProperties` gets the same treatment from the phase schema (its shape today
  already matches hg's declaration — likely zero churn).

This is the owner's goal #1 made literal: no unused properties in any emitted program.

**R2 gate:** snapshot churn = MaterialProperties/MediumProperties struct blocks + resolver
assignment lines ONLY (diff-shape verified); glslang green (proves nothing read a removed
field); GPU spot-checks: furnace (Lambert-only program) + cornell-glass (dielectric
program); scene-scoped enforcement note (module-anatomy §3): a model reading an undeclared
field now FAILS to compile in its minimal scene — that's the discipline working.

## R3 (small, rides along) — geometry-primitive parameter schemas (review C7, assigned here)

Per-primitive parameter name/shape schemas for sphere/plane/box/quad (the `{ r: 2 }`
silently-renders-unit-sphere hole). Validator diagnostics only — zero GLSL change; its own
commit.

## Order of work

R1a descriptors + generic material planner (no file moves) → R1b lights + phase →
R1c file moves + registries + headers → R2 struct/resolver → R3 primitive schemas →
docs close (module-anatomy §7 status flip + drift ledger, CLAUDE.md, memory). One commit
per step, gates at each.

## Pitfalls

- **The emission/emission_strength coupling** in the resolver is an oddity (strength is
  set iff emission is nonzero/driven) — transcribe it into the emission schema row's
  resolver logic faithfully in R1/R2; do not "clean it up" (its reader is lambert_emission).
- **transmittance is assigned only for dielectric materials today** — R2 reproduces this
  *from the schema* (only dielectric declares it), not from a model check.
- **Vite `?raw` import paths** change with every file move — mechanical, but a missed one
  is a runtime-only failure in dev; the glslang suite catches it in CI (empty/missing
  import would fail assembly), and `examples/` is now typechecked.
- **Do not let descriptors grow knobs** (defaults-for-strategies, ordering hints). Facts
  about one model only. When in doubt, it goes in the feature planner.

## After this lands

GGX = `glsl/materials/ggx.{glsl,ts}` — a transcription of reference §7 plus a descriptor
(declares `roughness`, non-delta, no transmission) — and nothing else. Built alongside:
the §11.3 pdf-histogram harness (its first customer), per the locked roadmap.
