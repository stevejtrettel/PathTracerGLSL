# Components — the top-level library of swappable research code

**Author:** Fable (July 2026)
**Status:** §§1–6 BUILT (July 12 2026 — the migration landed byte-identical: all 47
registry pairs hash-verified, snapshot churn = provenance renames only, GPU spot-checked;
purity enforced by `tests/components/purity.test.ts`). Three calls the draft left
implicit, resolved in the migration: (1) the leaf rule distinguishes types from values —
components may `import type` contract types from the compiler (PlannedLight,
ProgramDescription, ShaderBlock, FeatureContribution — moving those types is a separate
cleanup, not batch-1 work), but may import NO values; (2) `descriptors.ts` and
`glsl-format.ts` moved INTO components (what a component IS belongs to the library),
`quadNormal` moved to `components/geometry/`, the octahedral TS twin + test co-located
per §4's tree; (3) the transport pt generator moved AS-IS to
`components/transport/pt/transport.ts` with its one value import (`emptyContribution`)
inlined as a typed literal. The sampler slot is carved: `rng.glsl` became
`components/sampler/pcg4d.glsl` whole (state layout, seeding, and the [0,1) mapping are
all occupant-specific — Owen–Sobol replaced exactly this file), call-surface contract
documented on the registry.
**§7 (transport anatomy) DECIDED + BUILT** (July 12 2026, after GGX + the veach-mis
witness landed per the agreed sequence): the technique-centric carve — see §7 for the
pinned anatomy (techniques/ + combiner + integrators/) and the byte-identity proof.
**Companions:** `fable-strategy-taxonomy.md` (what the inputs mean — pinned),
`fable-module-anatomy.md` (descriptor shapes — implemented by `impl-plan-descriptor-reorg.md`),
`docs/trace-loop-contract.md` + `fable-compiler-contracts.md` (the GLSL contracts every
component is written against).

---

## 1. Why a top-level folder

The swappable physics — materials, transports, samplers, spaces — IS this project's
research output. Today it lives inside `src/compiler/generate/glsl/`, filed as an
implementation detail of one layer. Two reasons to lift it out (and one non-reason):

1. **The research code should not be buried inside the compiler.** Owner-stated. The
   compiler orchestrates; the components are the subject matter.
2. **The dependency rule makes top-level placement safe:** `src/components/` is a LEAF
   layer — components import NOTHING from app/engine/compiler. Everyone imports from
   components. The three-layer diagram (App → Engine → Compiler) gains a fourth layer
   *underneath*, not beside; no arrow reverses.
3. *(Explicit non-reason, owner correction: the octahedral chart's GLSL/TS-twin
   co-location is a pleasant side effect, not a justification — that chart is a pbrt
   copy that may be replaced wholesale. Occupants are disposable; slots are the
   commitment.)*

**Name: `src/components/`** (owner preference over "modules"; consistent with the
established "volumetric component" vocabulary). Known trivial collision: `src/app/ui/`
has a `UIComponent` base class — different tree, no confusion expected.

## 2. Vocabulary (from the pinned taxonomy work)

- **Slot** — an extension point with a pinned GLSL contract (the seams: `<model>_sample`,
  `lighting_sample`, `medium_sample`, `ambient_geodesic`, `transport_trace`, …).
- **Component / occupant** — one implementation of a slot: GLSL and/or TS emit-code plus
  a descriptor of declared facts.
- **Family** — the slot's kind: *mix-many* (several occupants coexist per program,
  selected per-hit → compiler generates dispatch/union/CDF machinery) or *pick-one*
  (one occupant per program → planner selects).
- **THE GUARDRAIL** (module-anatomy §2, "the archive's grave"): descriptors declare
  facts about ONE component — never composition, ordering, passes, or pipeline
  structure. Registries are lookup tables. All decisions live in compiler feature
  planners. A component tree that implies orchestration is how the archive died.

## 3. The census — everything swappable

| Family | Kind | Occupants today | Known next | Taxonomy section |
|---|---|---|---|---|
| materials | mix-many | lambert, dielectric | **GGX (next build)** | scene (defines T) |
| lights | mix-many | point, quad, sphere | spherical-rect quads | scene (defines E) |
| phase | mix-many | hg | Mie/Rayleigh | scene |
| geometry backends | mix-many | sdf, analytic | mesh (far) | scene |
| ambient spaces | pick-one | euclidean | **H³, Schwarzschild** | scene |
| transport integrators | pick-one | pt (a TS loop *generator*) | one-shot, Whitted, debug measurements | estimator (+ measurement for truncated ones) |
| volume sampling | pick-one | analytic | delta-tracking | estimator |
| env sampling | pick-one axis | equirect, octahedral (charts × compensation) | hierarchical warp | estimator |
| sampler (sub-pixel) | pick-one — **slot carved by this doc** | pcg4d | **Owen-Sobol (built once, reverted, kept as deferred record)** | estimator |
| camera | pick-one | pinhole | thin-lens | measurement |
| film: accumulation | pick-one | average | (exponential, variance reserved) | estimator |
| film: tonemap | pick-one | reinhard, none | ACES; spectral XYZ film | view |

**What is deliberately NOT a component:** `glsl/core/` (structs, interaction, math, rng
plumbing, ray) — the contract spine every component is written against. It has no
alternatives by construction; placing it under components would suggest otherwise. It
stays in the compiler. *(The rng GENERATOR body moves out into the sampler family; the
rng call-surface `rng_init/random/random2` is core contract.)*

## 4. The tree

```
src/components/
  materials/    lambert.{glsl,ts}  dielectric.{glsl,ts}  index.ts        # (ggx.{glsl,ts} next)
  lights/       point.{glsl,ts}  quad.{glsl,ts}  sphere.{glsl,ts}  index.ts
  phase/        hg.{glsl,ts}  index.ts
  geometry/     sdf_primitives.glsl  raymarch.glsl  analytic_primitives.glsl  index.ts (param schemas)
  ambient/      euclidean.glsl                                          # (h3.glsl, schwarzschild.glsl)
  transport/    flags.ts  combiner.ts       # §7 anatomy (DECIDED + BUILT — see §7)
                techniques/ kernel.ts  light.ts  index.ts
                integrators/ pt.ts  index.ts
                volume/ analytic.glsl       # volumeSampling bodies
                shadow/ opaque.glsl  media.glsl
  env/          equirect.glsl  octahedral/{octahedral.glsl, octahedral.ts twin, test}  sampler_cdf.glsl
  sampler/      pcg4d.glsl  index.ts        # slot carved now; owen-sobol is the known 2nd occupant
  camera/       pinhole.glsl
  film/         accumulate_average.glsl  tonemap_reinhard.glsl  tonemap_none.glsl  fullscreen.vert.glsl
```

Rules:
- **Occupant unit:** flat `name.{glsl,ts}` pairs; a folder per occupant only when it
  earns it (≥3 artifacts — e.g. octahedral's GLSL + TS ground-truth twin + test).
- Registries at each family's `index.ts`: plain lookup records. Descriptor fields MAY be
  functions (a pdf arm is a fact-as-code); they may NOT reference other components,
  ordering, or the plan.
- Header discipline per file: conforms-to §, fields read, provides, depends-on.
- Compiler feature planners keep consuming registries exactly as post-reorg; engine may
  import CPU twins (e.g. the env loaders). Components import only from within
  `components/` and language-level utilities. **Enforceable check:** a lint/test that
  greps component imports for `app/|engine/|compiler/` (worth adding in the migration).
  *(Two current impurities to resolve in migration: light descriptors import
  `formatSpectrum` from compiler glsl-format and `quadNormal` from a compiler feature —
  both are pure math/formatting; move them into components/ or a shared leaf util.)*

## 5. Migration plan (after discussion)

R1c-style: pure moves + import/origin renames, **emitted GLSL text byte-identical**,
snapshot churn = provenance renames only, glslang + 448 tests + GPU spot as gates. The
transport loop moves AS-IS (today's proven segments); any re-segmentation per §7 is a
SEPARATE later batch with its own proof (see §7.5). Sampler slot: move `rng.glsl`'s
pcg4d body to `components/sampler/pcg4d.glsl` + registry; call-surface contract
documented; zero behavior change.

## 6. What this buys (the two owner goals, restated)

- **Efficiency** — unchanged; the compiler already emits purpose-built programs. The
  tree changes where truth lives, not what is emitted.
- **Explicit modularity** — "design a path tracer by building and swapping pieces":
  the pieces are now a visible, top-level library; a new piece is one file-pair + one
  registry line; the strategy schema (`measurement/estimator/view`) is the panel of
  switches that selects among them.

---

## 7. DECIDED — the transport loop's internal anatomy ("close to the math")

**PINNED (owner, July 12 2026): Cut B — the technique-centric carve — chosen by the
owner's answer to §7.6 Q2: "new sampling techniques are cheap is what we want."**
BUILT the same day (byte-identity proof: all 50 registry pairs' emitted texts hashed
identical before/after; snapshot churn = provenance renames + block splits only).

The shipped anatomy (see the file headers for each part's contract):

```
components/transport/
  flags.ts                 — the decisions, read ONCE from the link map, shared by all parts
  combiner.ts              — every weighting line; pt/pt-nee/pt-mis are configs of these functions
  techniques/  kernel.ts   — T1: continuation draw (surface+phase) + BOTH deferred scoring
                             sites (emitter-hit, miss) + the carried record (prevBookkeeping
                             is the single emitter of the MIS state writes)
               light.ts    — T2: sample-and-score locally, surface + medium sites
               index.ts    — the registry; A NEW TECHNIQUE IS ONE FILE + ONE LINE HERE
  integrators/ pt.ts       — the recursive walk: path advance, state, self-heal, nulls,
                             tracking, RR, spawn; composes the roster at its event sites
               index.ts    — pick-one registry (one-shot/Whitted/probe = new walks here,
                             composing the SAME techniques)
```

Costs accepted knowingly: one emitted GLSL block is assembled from lines owned by
multiple parts (T1's scoring block calls the combiner inside the surface event) —
flow-reading the EMITTERS crosses ownership; the dump stays linear and provenance-
annotated. The strategy schema is unchanged (`directLighting` maps onto combiner
configs); a technique-roster axis arrives with the second T2 occupant (equiangular).

The original discussion text follows, kept because the deferred-scoring account is the
context every future technique author needs.

### 7.1 Where we are

The item-9 split emits the loop from eleven segment functions (init, walk-skeleton,
medium-event, miss, self-heal, null, surface-setup, emission, nee, bsdf, tracking, rr,
spawn). **These joints are template-shaped, not math-shaped** — they sit where the old
`#ifdef`s sat, because the split's proof was token-identity with the template. They are
correct and witness-verified; the question is whether to re-carve them at mathematical
joints before the loop grows new variants.

### 7.2 The math of one iteration, slowly

At each path vertex the estimator wants the local scattering integral
∫ f·L_i dω. The incident radiance L_i splits into **direct** (from emitters and the
environment) and **indirect** (everything else, handled by recursion). Two *sampling
techniques* can each produce an estimate of the SAME direct term:

- **T1 — kernel sampling** ("BSDF sampling"): draw the continuation direction from the
  material/phase kernel. If that ray happens to reach an emitter (or escapes to the
  env), the emission it finds IS a direct-light sample — drawn with density
  `p_kernel`.
- **T2 — light sampling** ("NEE"): draw a point on an emitter from the light registry's
  density `p_light`, cast a shadow ray, evaluate the kernel toward it.

Both techniques estimate the same integral term. Run both at full weight and every
samplable emitter is counted twice — the classic double-count. The three
`directLighting` strategies are three *weightings* of the same two techniques:

| Strategy | T2 (light sample) weight | T1 (kernel-found emitter) weight |
|---|---|---|
| `pt` | technique absent | 1 |
| `pt-nee` | 1 | 0 for samplable emitters (1 for path-only/delta-preceded — T2 couldn't have found those) |
| `pt-mis` | power heuristic w(p_light, p_kernel) | power heuristic w(p_kernel, p_light) |

*(The env-on-miss term is T1's boundary case — same table, third row of sites.)*

### 7.3 The subtlety that shapes all the code: deferred scoring

T2 samples and scores at the SAME vertex: draw light point, shadow test, add weighted
contribution. Done locally.

T1 cannot: when you draw the continuation direction at vertex k, **you do not yet know
whether it will find an emitter.** You discover that at vertex k+1 (or at the miss).
So T1's *sampling* happens at vertex k, but its *scoring* — including its MIS weight,
which needs the density it was drawn with — happens at vertex k+1. That is exactly what
the loop's `prev_bsdf_pdf` / `prev_p` / `prev_was_delta` state is: **T1's sampling
record, carried one iteration forward so its score can be settled when the sample
lands.** The "emission collection with `w_emit`" block at the top of every surface
event, and the `w_env` logic in the miss branch, ARE the deferred T1 scoring sites.

This displacement is why the estimator structure is smeared in any straightforward
transcription: one technique's code necessarily lives in two places, one bounce apart.

### 7.4 Two candidate cuts (and the honest third option)

All cuts emit IDENTICAL GLSL — the pinned quality bar does not move. The choice is
about which TS emitter OWNS which lines, i.e. where future variation is cheap.

**Cut A — event-centric.** One unified **scattering event** component owning the local
sequence: [settle T1's deferred score from the previous vertex] → [run T2 now] →
[draw the kernel continuation = T1's next sample] → [update state]. Instantiated twice
(surface, medium) with three declared differences: which kernel dispatches, whether the
cosine Jacobian appears (§2.2: the cosine is a SURFACE Jacobian — the pinned
surface/medium symmetry), and how the continuation spawns (`ray_spawn` with offset vs
`make_ray`). The "combiner" is then just the small weight-formula functions the event
calls.
*Cheap under Cut A:* a new integrator that rearranges events (it composes events
differently). *Costly:* a new TECHNIQUE (e.g. equiangular medium NEE as a distinct
sampling strategy) — you edit the event.

**Cut B — technique-centric.** The techniques are peers: **T1** (kernel continuation +
its deferred scoring sites), **T2** (light sampling), each a component that knows its
sampling site AND scoring site; the **combiner** is the policy that says which
techniques are active and with what weight function (off / binary / power heuristic —
i.e. `directLighting` becomes literally a combiner configuration, and §11.2's
"pt/pt-nee/pt-mis differ only in weights" becomes structural instead of
witness-enforced). The event shrinks to kernel dispatch + state update.
*Cheap under Cut B:* new techniques and new heuristics. *Costly:* the emitted lines at
one code site are owned by multiple components (T1's scoring block sits at the top of
the event that T2 and the kernel also write into) — flow-reading the EMITTERS crosses
ownership, even though the emitted GLSL reads the same.

**Cut C — leave it.** Today's template-shaped segments are proven and witness-covered.
Per the second-occupant rule, re-carve only when a concrete second occupant (a new
integrator, technique, or heuristic) actually arrives and tells us which cut it needs.
*This is the honest null option and it is genuinely defensible* — it trades preparation
for certainty about which axis will be exercised first.

**The tension to resolve in discussion:** modular-first (owner default: build the axis
before/with the first implementation) vs second-occupant (don't build machinery on
speculation). The known next arrivals are: GGX (touches materials only — needs NO
transport change), equiangular medium NEE (a T2 *placement* variant — Cut B-shaped),
one-shot/Whitted (integrator variants — Cut A-shaped or just measurement flags),
spectral λ-state (orthogonal to all cuts — touches state + film).

### 7.5 Whatever is chosen: the proof method

Re-segmentation is a refactor of verified code with the equivalence test gone. The
method returns: freeze current emitted output, re-carve, assert token identity per
registry pair (the harness technique from the item-9 split — the test file is deleted
but the approach is in `docs/impl-plan-transport-split.md` and the git history at
5f8590f). Then snapshots + witnesses as standing nets. Shared-invariant rule carries
over unconditionally: RR, prev-bookkeeping, and (if Cut B) each technique's
weight construction stay single emitters.

### 7.6 Questions for the discussion

1. Does the T1/T2/deferred-scoring account match your mental model of the estimator?
   (If not, the right cut can't be chosen yet — fix the model first.)
2. Which future variation do you actually want cheap FIRST: new integrators, new
   techniques/weights, or neither yet? That answer selects A, B, or C almost
   mechanically.
3. If B: are you comfortable with emitter-ownership crossing code sites (one GLSL block
   assembled from lines owned by T1, T2, and the event)? The dump stays clean; the TS
   reads less linearly.
4. Timing: before GGX (GGX doesn't need it) or after (first customer that would
   exercise materials against a re-carved loop)?
5. Does `transport/volume/` (the volumeSampling bodies) stay a sibling family under
   transport/, or fold INTO the walk component of the integrator? (The walk is where
   geometry and volume sampling couple — fable-volumetric-component §2 pins the seam;
   this is only a question about folder placement, not about the seam.)
