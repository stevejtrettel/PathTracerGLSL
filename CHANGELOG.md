# Changelog

What was built, fixed, and measured, newest first. This is the project's history; for how the
code works now, read [CLAUDE.md](CLAUDE.md), the docs it points to, and the code itself. When
you finish a batch of work, add a dated entry here — not to CLAUDE.md.

## 2026-09-26 — review batch 5: tests that can fail

Review Part 3, test-only work as planned in docs/claude-review-batch5-plan.md (owner: "if this is
test stuff do it"). Every item was re-checked first. Every new or changed test was run against a
deliberately broken version of the code it guards: it failed there, and passed once the code was
restored. The breakages were never committed.

| Commit | Test | Broken code it was run against |
|---|---|---|
| 2269993 | The CWBVH over four identical boxes keeps every item once (the old check was `order.length`, always n) | the builder writing item 0 twice |
| 827c32f | The procedural-sky params rule, with the real `params` shape (no `as any`), and an empty list accepted | the rule inverted |
| b4b7d3d | RGBE export clamps a negative channel to 0 | the clamp removed (the byte came out 230) |
| 535af02 | PNG export round-trips a 1000×800 image, which spans three write batches | the filter's previous row reset at each batch (the small-image test still passed) |
| a018f4b | Each emitter's light values equal `valuesFromRegion` of its **planned** surface and material emission, across 6 lights (2 self-comparing assertions replaced) | emission without the blackbody fold (3 tests fail); placement ignoring the transform (the new test fails; the old assertions passed) |
| 1d4b287 | `mesh-light-smooth`'s text: it guards the spawn rule, not the MIS pdf normal (worth ~0.05% here) | — |
| 67a95d1 | `null-budget`'s pt tripwires at 1.5× the measured rmse (97%, 112%) | — (a black arm reads ≥ 200%) |
| 18a6051 | New witness `emit-sat-budget`: the fog budget at `maxBounces` 0, 1, 2 against the exact truncated sums | the fog branch's budget off by one: N = 1 read N = 0's value, N = 2 read N = 1's |

- **`emit-sat-budget` numbers:** channel means over salts 11/22/33 (160×120, 96 spp): N = 0 exactly
  0.77778 (no noise); N = 1 1.0372 ± 0.0004 against the exact 1.0370; N = 2 1.1236 ± 0.0004 against
  1.1235. So the renderer honours "at most N events" inside media.
- **Paused (plan §"Paused"):** 5.5, rough glass at η = 1. Its premise was wrong. Measured with the
  twin at η = 1 ± 10⁻⁴: the samples converge on −wo, but the weight is 0.999, 0.612 and 0.219 for
  (cos θ, roughness) = (0.9, 0.3), (0.3, 0.8) and (0.1, 0.9), while the η = 1 shortcut transmits
  everything. The rough dielectric is therefore discontinuous at η = 1 (microfacet masking loss),
  and the shortcut is the physical answer, not the model's limit.
- **Owner-approved, done (d10152a):** a `{param}` camera row's slider bounds must satisfy the
  row's constraint, as its default does. For `fov` that is (0, π). A missing bound warns, because
  the panel then shows a free number box. The test was written first and failed before the rule.
  All 20 slider-driven fovs in the suite already comply.
- **Owner-approved, done (4635a64):** a witness check kind, `tiled`. On `cornell-area` the runner
  renders with `app.renderTiled` (160×120 in 64px tiles: a 3×2 grid with partial edge tiles),
  then in one piece at the same size, spp and pinned salt, and compares the saved files: the HDR
  pixel bytes and the PNG image data must be identical. It passes. With `renderTiles` not
  setting the tile's pixel offset, it fails (54291 of 76800 HDR bytes and 41637 of 57720 PNG bytes
  differ). CLAUDE.md and docs/production-rendering.md no longer call this untested.
- **For the owner (not done):** a witness for the mesh light's pdf normal (research).
- vitest 2967 passing; tsc clean.

## 2026-09-26 — review batch 4: one answer per fact

Review Part 2, as planned in docs/claude-review-batch4-plan.md: twelve commits (d61e76a …
db0c163), each a fact that was decided in more than one place, now decided once by the layer that
owns it. No step was meant to change a picture.
- **The approved plan was re-checked mid-batch.** Its "nothing reads `CompiledScene.dataReads`"
  was false: a search cut off at ten lines hid a test reader. The re-check, with complete searches,
  corrected seven claims before any further code. `dataReads` is kept.

- **Removed:** the materials feature's always-empty `defines`.
- **App:** `RenderCoordinator.fail` calls the one stop sequence. A test pins the event order
  (error, then stop).
- **Validator:**
  - one rule for emission on a model that cannot emit (it gave two diagnostics);
  - camera rows shape-checked once;
  - the similarity scale and rotation rules are stated once, in similarity.ts
    (`scaleProblem`, `quaternionProblem`, `AXIS_DEGENERATE_LENGTH`). Object transforms, instance
    placements and the Planner's runtime quaternion guard all use them.
- **Witness constants:** fixtures read `MAX_DIST` and `SHADOW_BACKOFF` from math.glsl (sun-haze;
  fog-sky's e^{−σ·1000}). A test pins the three expected values, and they are unchanged.
- **Lighting generator:** reads the Planner's `environmentSelectionLive` in its four functions.
- **Which objects are lights:** the light registry answers "shape T can be sampled"
  (`regionLightKind`); the geometry descriptor flag `samplableAsLight` is removed. The census's
  shape leg is its own predicate (`isSamplableEmitterShape`), used by the census, the mesh
  predicate and the Validator.
- **One spectrum resolver:** `resolveColorProperty`, moved to compiler/plan/values.ts, also
  resolves emissive objects' and authored lights' emission. Two redundant blackbody pre-folds are
  gone.
- **Scattering media:** the Planner records which media scatter
  (`ProgramDescription.media.scatteringMedia`, via `mediumScatters`), and the generators read the
  record.
- **Instanced sphere lights:** the App computes their tree boxes and powers with the sphere light
  descriptor's `treeBounds`/`power`, from a plan entry that now carries the kind and the emission
  colour.
- **One equirect mapping:** `equirect_uv` (components/env/equirect/equirect_map.glsl) is used by
  the chart and by the image sky's lookup. The chart registry's `needs` includes it wherever the
  chart is, the bake shader included.

**How "no change" was shown:**
- The generated GLSL changed only at step 4.12, in 6 environment programs, and only as planned.
- The full compiled output of all 202 suite scenes (shaders, uniforms, defaults, parameters, the
  scene-data plan) was digested before and after steps 4.9–4.11 and is byte-identical. The only
  intended differences were the new `scatteringMedia` record, which is not shipped, and the
  batch-light plan entries of the five scenes with instanced lights.
- The scene-data byte fingerprints are unchanged, light tree included. That includes a new case
  with per-instance emission colours, which no suite scene covered; it was recorded before the
  change.
- `sky`, `sky-lamp` and `proc-sky` give identical results on their 7 checks (160×120, spp as in
  the registry, salt 1234, fresh renders). The `sky` scene rotated by 2.0 gives identical frame
  means to 10 digits on its four estimators.
- tsc clean; vitest 2950 passing.

**Left open:**
- A `{param}` emission on a model that cannot emit still gets two warnings (this rule's, and the
  general "knob the model doesn't read" rule). This predates the batch.
- The scene/program restructure: plan the scene once, then each renderer against it. Item 2's
  option (b) waits for it.

## 2026-09-26 — review batch 3: shadow rays aimed at the light point

Review item 1.2, as planned in docs/claude-review-batch3-plan.md, in two commits. The three
witnesses below were written first and failed on the old code.

- **The fault.** A shadow ray starts `hit.eps` off the surface (`ray_spawn`) but kept the
  direction computed from the unmoved hit point, so it ran parallel to the segment it should
  test and passed beside the light point. Seen at a slant, a light that is scene geometry then
  blocked its own light — whenever ε·[(−n_g·n_l)/cos θ_l − cos θ] > `SHADOW_BACKOFF` — and
  pt-nee and pt-mis read darker than pt.
  - Receivers affected: marched surfaces (ε = 10⁻³); every surface in a program with a GRIN
    medium (the spawn margin is floored at 10⁻³ there); surfaces far from the origin (the
    fp-relative margin is 3·10⁻³ at 100 units).
  - Lights affected: every light that is scene geometry — emissive objects, mesh lights, and
    authored quad, disk, sphere and softbeam lights, which become scene objects. The review had
    said authored lights were safe.
  - The media shadow walker added one more offset at every null-interface crossing, where it
    re-spawns the ray.
- **The fix.** The ray keeps `ray_spawn`'s origin and is re-aimed at the light point with a new
  ambient function, `ambient_direction_to(from, to)` (Euclidean: `normalize(to − from)`). The
  walker re-aims after every re-spawn. Only visibility changes: the BSDF, the cosine and the
  pdfs keep the sampled direction. Every light is aimed the same way, the sky and the sun
  included (their light point is on the far clip).
- **Witnesses** `shadow-aim-march`, `shadow-aim-far`, `shadow-aim-fog`: a floor under a disk
  light, with an exact value. The first two use the coaxial-disk view factor; the fog slab uses
  a Simpson quadrature, checked in shadowAim.test.ts. pt, which casts no shadow ray, is the
  control. Measured at 160×120, 256 spp, the runner's salt 1234:

  | witness | exact | before: pt-nee / pt-mis / pt | after: pt-nee / pt-mis / pt |
  |---|---|---|---|
  | march (marched floor, authored light) | 0.9846 | 0.827 / 0.876 / 0.985 | 0.983 / 0.985 / 0.985 |
  | far (floor at x = 100, emissive object) | 0.9846 | 0.473 / 0.863 / 0.985 | 0.983 / 0.986 / 0.985 |
  | fog (two marched null crossings) | 0.9504 | 0.598 / 0.839 / 0.951 | 0.950 / 0.952 / 0.951 |

  - The "before" values match the plan's geometric predictions (0.828 / 0.876, 0.475 / 0.862,
    0.603 / 0.838).
  - With only the surface fix, fog still read 0.600 / 0.839; it passed after the walker fix.
  - Tolerances come from a three-salt spread (salts 11, 22, 33) measured before the fix: pt-nee
    sd ≈ 0.0037, so its tolerance is 0.015; pt-mis and pt have tolerance 0.005.
- **Measured, not fixed.** Both effects below come from the spawn offset itself, not from the
  aim. They belong to the open fp-spawn-margin item.
  - pt reads 0.98474 and 0.98498 in the open scenes. That is exactly the disk's view factor from
    the raised origin, 4/(4 + (0.25 − ε)²).
  - After the fix, pt-mis reads +0.05% (march) and +0.14% (far), growing with ε. A hypothesis,
    not checked: the MIS weight converts the BSDF sample's density from the hit point while its
    ray starts at the raised origin.
- **Also.**
  - The epsilonCoupling check that `SHADOW_BACKOFF` ≥ 2·`MARCH_CLEARANCE` is removed; its
    premise was this fault.
  - `SHADOW_BACKOFF`'s comment now states its one remaining job (the light's own rounding
    error). It also says the back-off is a fixed length: NEE ignores an occluder within 0.002 of
    the light point, which a BSDF ray sees.
  - Corrected the texts that described the old premise: light.md, lights/README.md,
    trace-loop-contract.md, and the reference-implementations §4/§5 notes.
  - Deviation from the plan: the witnesses also had to be filed in a gallery section
    (pages/sections.ts).
- **Targeted witnesses** (21 existing scenes, 42 checks): all pass — cornell-area,
  cornell-disk, orb, mesh-light-twin, mesh-light-smooth, softbeam-wall, tiny-sphere-light,
  veach-mis, hundred-spheres, instance-lights, field-glass, shadow-medium, emit-scatter,
  fog-area, null-budget, region-overlap, instance-fog, sun-haze, sky, beam-slab, spot.
  region-overlap needed a re-run. Its first attempts ran while the Mac was in idle sleep, which
  made them look like a 170× slowdown (a timeout and a page reload). Awake, the same code renders
  8 samples in 3.9 s, against 6.0 s before the fix, and the check passes.

Not in this batch: deriving `SHADOW_BACKOFF` (it needs the light's normal in `LightSample`),
and the curved-space distance in the walker (`length()`).

## 2026-09-25 — review batch 2: contained correctness fixes

The fixes planned in docs/claude-review-batch2-plan.md, one commit each. Where a unit test
was possible it was written first and failed before the fix; fixes inside `App` (which has no
test harness) were checked by a headless probe of the live app, run on the old and the new
code.

- **Session restore** (1.4): the environment values the App measures from the loaded map go
  to the engine directly and are dropped from restored sessions, so a session can neither
  remove them (the engine then sampled a 1×1 table) nor overwrite them with another map's.
  Probe: removed / overwritten before, unchanged after.
- **Tiled rendering** (1.5): leaving production clears the tile offset and image size (unit
  test); `renderTiled` refuses a second job instead of silently killing the first (probe: 0
  files saved before, 1 after), rejects with `RenderStoppedError` when stopped (it resolved),
  and restarts interactive rendering only when nothing else is running. The case that last
  rule guards — a production started while the PNG is being written — could not be reproduced
  in headless Chromium even at 7680×4320.
- **Exports** (1.6): auto-export starts every export (each reads its buffer when called) before
  awaiting any encode, and `exportAllAOVs` reads every AOV before encoding one (unit test).
- **Context restore** (1.7): start/resume/production requests are refused while textures are
  re-registered; any error is shown (frame errors never were, although the overnight runtime
  entry below says they are); a failed environment load is not recorded for later restores; a
  finished production returns to interactive. Probe: all four cases failed before, pass after.
- **A second `initialize()`** (1.8): for the same scene, all strategies are recompiled together
  on one scene-data layout; for another scene, the old renderers are unloaded (unit tests; the
  witness runner's variance path re-rendered mesh-light-twin and fog-area with identical
  numbers).
- **Environment colour** (1.10): validated with the shared spectrum checker (unit test).
- **Small items** (1.11): the rough dielectric compares the two indices rather than their
  quotient against 1; mesh-light sampling rejects a NaN normal (both unreproducible on
  SwiftShader: 18 checks of the rough and mesh-light witnesses identical before and after);
  cancelling OBJ faces get a face normal instead of (0,0,0); `compileScene([])` reports a
  diagnostic; `maxBounces`/`maxNullCrossings` above 2³¹ − 2 are rejected (the `<=` loops need
  one more increment); CI's push runs no longer cancel a dispatched witness sweep (checked by
  reading; no YAML parser here); the glslang harness reports a crashed validator as a crash.

Not in this batch: the fp spawn margin (needs a measurement plan), and review items 1.1–1.3.

## 2026-09-25 — review of the Sep 24–25 work; the documents corrected

- **Review.** Five read-only reviewers read the 33 commits 8d04f34 … cdccd81 against CLAUDE.md's
  standards, and their findings were checked against the code:
  docs/claude-review-2026-09-25.md (correctness items, duplicated decisions, tests that cannot
  fail, wrong documents, history in comments), each marked by how it is known, with a proposed
  fix and a batch order. The review itself changed no code.
- **Batch 1 (documents).** The normative transport documents (fable-reference-implementations
  §4/§5, fable-compiler-contracts §6.1/§7.2) now say what is superseded — the separate shadow-
  segment limit, the old bounce loop, a 1e20 light distance, fixed-EPSILON spawning, the old RR
  rule — and where the implemented form lives. The GRIN hard-stop claim is corrected everywhere
  (GRIN entry below). CLAUDE.md's status claims and the design documents are corrected (the
  sweep's scope, the data textures, the App's remaining derivation, pixel- not byte-identical
  tiling, built work listed as deferred, "always uploaded" structures). The same-day entries
  below are consolidated; corrections are marked *Correction (review)*.

## 2026-09-25 — the tracking collision cap, derived per segment

The delta and ratio tracking loops stopped at a fixed `MAX_NULL_COLLISIONS` = 64 tentative
collisions. A walk that reached it dropped the rest of its segment — the attenuation still owed
and the emission not yet collected — although the comments called that conservative. Whether it
binds depends on the scene's majorant, so it cannot be a measurement field; it is a step limit
(taxonomy §4.1), which must not decide the picture.

- **Now** each loop is bounded by `tracking_cap(σ̄·t) = ⌈λ + 6.5√λ + 12⌉` (delta_tracking.glsl),
  where λ = σ̄·t is the mean number of tentative collisions over the segment it walks. A walk
  runs out only if N ≥ cap for N ~ Poisson(λ), which has probability below 1e-10 for every λ:
  checked exactly at 16 values of λ from 1e-3 to 1e6 in tests/compiler/nullBudget.test.ts
  (constants read from the GLSL); the supremum is the λ → ∞ normal limit, 4e-11. The tracking
  weights are bounded, so this probability bounds the bias. The bound adapts to slider-driven
  majorants, moving regions and closed rooms without any analysis.
- **Tried the same day and dropped:** a fixed cap of 1024 with a Planner warning
  (compiler/plan/trackingBudget.ts, deleted; `derivedMajorant` is back in materials.ts), and a
  fixed-size box around groundfog's fog (reverted: a fixed box is an arbitrary cut of the world
  that someone editing the formula has to know about).
- **Measured on groundfog**, the one demo whose fog is open to the sky. (fogblobs and glowblobs
  sit in a closed Cornell room — front wall at z = 5 — so their longest segment is ≈ 7.9 units,
  ≈ 65 collisions at σ̄ = 8.2.) Witness-runner renders at 160×120, 128 spp, the pinned witness
  salt, strategy pt-nee-het. The old cap of 64 changed the image by at most 0.09% (the horizon
  band; whole frame 0.05%): the attenuation it dropped multiplied a black sky. With the derived
  bound the image matches the cap-1024 render to five digits (whole frame, top and bottom
  quarters). SwiftShader frame times, which include shader compilation and so are rough: 6.5 s
  at cap 64, 13.6 s at cap 1024, 14.5 s with the derived bound (a variance-mode render).
- **Correction (review):** the budgets entry below said constant media never have null
  collisions because σ̄ = σ_t. That holds only for grey media; for a chromatic constant medium σ̄
  is the largest channel's σ_t, so the other channels have null collisions. The derived bound
  covers them like every other medium.
- **Tested:** het-const, het-slab, clamp, het-driven, emit-swap, emit-sat, emit-driven and
  emit-scatter, 11 checks, all pass with numbers identical to the earlier runs. Not run:
  het-driven-theta2 (a slider set after load). Open fogs still pay σ̄ × 1000 steps per escaping
  ray; improvements §3.3 (local majorants) is the plan.

## 2026-09-25 — GRIN: one event per traversal, unbiased roulette for long ones

A GRIN traversal charged one bounce per 512 integration steps (`MAX_ODE_STEPS`), so which paths
the measurement kept depended on the integrator's step size — a step limit charged against a
budget, which taxonomy §4.1 forbids. Now:

- **A traversal is one event** of `measurement.maxBounces`, however long it is.
- **Long and trapped traversals end by Russian roulette inside the walker**: every
  `GRIN_ROUND_STEPS` (512) steps the ray survives with probability `GRIN_ROUND_SURVIVAL` (0.9)
  and a survivor's weight is divided by it. Unbiased; only those rays get noisier. Radiance
  collected before a kill is kept (it belongs to the prefix). The walker owns the roulette, so it
  works with the strategy's roulette off (ratio tracking's precedent). Both arms (absorbing and
  scattering) do this; capture, roulette kill and the hard stop share one exit, `grin_no_return`
  (first committed as `grin_killed`). A readability pass moved the round check into one helper,
  `grin_round_survives`, and gave both arms an explicit `round_comp` (the absorbing arm had
  divided its transmittance `absorb` by the survival probability, which read like absorption).
- **Hard stop**: `GRIN_MAX_ROUNDS` (200) rounds. `MAX_ODE_STEPS` is gone.
  *Correction (review):* this entry called the stop harmless because a traversal reaches it with
  probability 0.9¹⁹⁹ ≈ 8·10⁻¹⁰. A survivor carries weight 0.9⁻¹⁹⁹, so the stop drops the full
  contribution of traversals longer than 102,400 steps: a fixed step limit that can decide the
  picture (taxonomy §4.1). Giving up without it is part of the GRIN design note.

Lenses that leave within 512 steps (every registry GRIN witness) never draw and are unchanged.
New witness `grin-long`: an orthographic view through a 30-unit and a 60-unit `ior: 1` region at
a unit sky with maxBounces 1. The old walker read 0.0000 on both halves (the bounce budget cut
every ray); now 1.0000 (2 rounds) and 1.0009 (5 rounds). Targeted run: grin-long and the eight
`grin-*` witnesses, 10 checks, all pass (furnaces 0.3989–0.4002 against 0.4); `rough-grin`, which
also runs the walker, was not run. Full sweep not run.

## 2026-09-25 — budgets vs step limits (taxonomy §4.1), and a survey of the step limits

The taxonomy now separates **budgets** (truncations: predicates on paths, counted the same way
by every technique) from **step limits** (loop bounds inside the machinery: estimator side,
must be shown unreachable, never charged against a budget). A survey of every loop bound:

- checked and unreachable: the light tree's 48 levels (the builder caps depth).
- warned at build only (fixed sizes that still drop subtrees past them): the binary BVH stack
  (64), and now the wide BVH stack (24): `buildCWBVH` warns when its depth reaches
  `CWBVH_STACK_DEPTH`; the random 50,000-sphere cloud in cwbvh.test.ts measures under half.
- diagnosed: the tracking collision cap (then by a Planner warning; derived since, entry above).
- still able to decide the picture: GRIN's `MAX_ODE_STEPS` (charged against `maxBounces`
  until an unbiased give-up rule is designed), and the SDF marcher's step budget when a ray
  runs out of steps farther than 16× the acceptance tolerance from a surface (reported as a
  miss, rest of the interval unexplored).
- not limits: fixed-count loops that set accuracy or define a shape (GRIN exit bisection, SDF
  refinement, fractal iterations).
- *Correction (review):* the survey said it covered every loop bound but missed the wide-BVH
  walk's fixed 65,536-iteration guard; GRIN's later hard stop belongs on the same list.

The bias ledger gains a row for numerical tolerances (the marcher's acceptance and its grazing
rule, the ODE step, refinement counts, spawn margins), with the limit tolerances → 0.

## 2026-09-25 — declared budgets in media: `maxNullCrossings`, the collision cap

Three fixed budgets could make the image depend on the estimator or drop energy silently
(docs/claude-improvements-2026-09.md §1.2).

- **`measurement.maxNullCrossings`** (default 32) replaces the walk's fixed `MAX_NULL_CROSSINGS`
  and the shadow walker's separate `MAX_SHADOW_SEGMENTS = 8`. It is a declared truncation: paths
  with at most K null-interface crossings, counted along the whole path. A shadow ray gets what
  its path has left: `shadow_transmittance` takes a third argument, `crossings_left`, which the
  NEE sites fill from the generated `shadow_crossings_left(s)`. With the old limits, a shadow ray
  needing more than 7 crossings returned zero while pt counted the light. The Planner resolves
  the field (`compiler/plan/measurement.ts`, `resolveMeasurement`), the Validator requires a
  non-negative integer, and the taxonomy's bias ledger lists it.
- **The tracking collision cap** went from 64 to 1024 with a Planner warning; both were replaced
  the same day by a bound derived per segment (the collision-cap entry above, which also records
  the corrections to what this entry first said about constant media and the three fog demos).
- **GRIN's `MAX_ODE_STEPS`** was left at 512 here: reaching it dropped nothing (the walker handed
  back its state and the walk continued, spending one more event). Replaced the same day by the
  GRIN roulette (entry above).
- **Export stamps** carry the resolved measurement (`measurement=` in HDR headers and PNG text),
  so defaulted truncations are recorded.

New witnesses: `null-budget-view` (exact: a quad light through 5 null-walled absorbing slabs reads
1.5578 against the derived 1.5576 at budgets 32 and 10, and 0 at 9) and `null-budget` (a floor
lit through the slabs, half of it under a null-walled carpet; at budget 11 the carpet half loses
its direct light through the stack: carpet-half mean nee/pt 0.0248/0.0244, against 0.0445/0.0440
at the default). With the walker capped at the old 7 crossings, null-budget's pt comparison read
180% apart. Targeted run: 22 checks across the two new witnesses and haze, fog-area, het-const,
het-slab, clamp, emit-swap, emit-sat, emit-scatter, shadow-medium and instance-fog, all pass after
the new pt tripwire's rmse bound was calibrated (measured 64.5% and 74.4%; set to 90%). The full
sweep was not run.

## 2026-09-25 — mesh self-intersection: fp-relative margin, side test by `ng`

- **`MESH_T_MIN` removed.** Triangle hits ignored anything closer than a fixed 1e-3 world
  units, and a spawned ray was pushed off by the same amount. Triangle hits now search
  strictly ahead (`t > 0`) like analytic primitives and fill `Hit.eps` with the fp-relative
  margin, so the only escape mechanism is `ray_spawn`'s offset along `Hit.ng`.
  `spawn_eps_analytic` is renamed `spawn_eps_fp`, since it now serves triangle hits too.
- **The dispatcher's front/back test and region probes use `ng`** instead of the shading
  normal: which side of a surface a ray is on is a geometric fact. `mesh_test_range` still
  flips a smooth mesh's interpolated normal onto the ray's side of the triangle; the general
  rule for that belongs with the normal-mapping design.

Measured before the change with two new witnesses. `mesh-slab-albedo` is the slab-albedo
scene (exact Chandrasekhar plane albedo, σ_t = 20) with the slab as a closed mesh: with the
fixed floor it read µ=1 (0.2420, 0.4293, 0.6395) and µ=0.3 (0.3627, 0.5704, 0.7561) against
exact (0.2488, 0.4375, 0.6466) and (0.3741, 0.5824, 0.7654), the same 1–3% loss the analytic
slab had in August; now (0.2487, 0.4375, 0.6465) and (0.3739, 0.5824, 0.7654).
`mesh-scale-twin` renders a mesh floor and block under a uniform sky and the same scene shrunk
100×: Δmean 0.28%, rmse 1.04% before; 0.00%, 0.03% after, and its tolerances are now tight
enough (0.1%, 0.4%) to catch a world-space margin. Targeted run: the 19 checks of the mesh
witnesses (accel-triple, mesh-furnace, mesh-quad-twin, mesh-light-smooth, mesh-light-twin,
mesh-glass-box, mesh-fog, mesh-submerged, mesh-instance-twin, instance-glass-mesh and the two
new ones) all pass. The full sweep was not run.

## 2026-09-25 — `Hit` carries the geometric normal (`ng`)

`Hit` gained `Direction ng`: the true normal of the surface hit, oriented like `frame.n`. It
equals `frame.n` everywhere the shading normal is the true normal (analytic and marched
surfaces, flat meshes) and differs on smooth meshes (and, later, under normal and bump maps,
which is why it is a field and not a special case). Filled by the shared primitive hit fill,
by both mesh arms (from the triangle's winding normal, which `mesh_test_range` now returns as
`gLocal`), and flipped with the frame on exit in the dispatcher. Two readers:

- **`mesh_light_pdf`** now takes `light_hit.ng`, matching the sampler's area → solid-angle
  conversion. With the interpolated shading normal the two pdfs disagreed and the MIS weights
  of a smooth-shaded mesh light did not sum to 1.
- **`ray_spawn`** offsets along `ng`, on the side of the true surface the new direction goes
  into. With the shading normal, a direction sampled below a smooth mesh's true plane started
  on the outside and crossed back through its own triangle; on an emitter that spurious hit
  counted the emission under MIS (weight ≈ 1, since the light pdf at a hit millimetres away is
  ≈ 0) but not under NEE. For every non-mesh surface and every flat mesh, `ng = frame.n`, so
  those renders are unchanged.

New witness `mesh-light-smooth`: an octahedron lamp with radial vertex normals (up to 54.7°
from the face normals) over the mesh-light floor, nee ≡ mis. Before: nee 0.14572 vs mis
0.15312 over four seeds (mis 5% bright); the pdf fix alone moved it only to 4.95%; with the
spawn fix too, nee 0.14573 vs mis 0.14574. The same octahedron with flat normals agreed before
the change. Still open then (docs/claude-improvements-2026-09.md §1.1): whether the mesh tier's
1e-3 self-intersection floor (`MESH_T_MIN`) could shrink — it was removed in the next entry — and
the shading-normal re-orientation in `mesh_test_range`, left for the normal-mapping design.
*Correction (review):* by these numbers the witness guards the spawn rule, not the pdf: the pdf
fix alone moved the error from 5% to 4.95%, far below the witness's 2% tolerance.

## 2026-09-25 — full witness sweep after the overnight fixes

At commit c5f3543: **181 exact checks — 180 pass, 1 fails; 1 cross-check agrees.** The failure
is `cube-cloud`, whose reference render does not finish within the runner's time under
SwiftShader (tests/witnesses/README.md §D). The four GRIN furnaces and `softbeam-wall`, failing
before the overnight fixes, pass. Everything committed after this sweep had targeted witness
runs only.

## 2026-09-25 — accel and data: CWBVH on coincident centroids, mesh-light NaN, workers

- **CWBVH threw on coincident centroids** (duplicate rows in a `.inst` file, concentric
  shells: four or more coincident items). Its collapse assumes one item per binary leaf, but
  the leaf-size-1 input tree left such ranges as multi-item leaves. The input is now built
  with `alwaysSplit` (only degenerate ranges differ; every suite scene's packed data is
  unchanged). That path exposed a second bug: a fallback split has no SAH axis, and the flat
  node format encoded axis −1 as `A = 0`, i.e. an empty leaf. Test in cwbvh.test.ts.
- **Worker task failures no longer rerun on the main thread.** A build that throws inside a
  worker was treated as "worker unavailable", so the same failing build ran again on the main
  thread (freezing the page for a large cloud) before failing. Worker entries now post
  `{ workerError }` and `runInWorker` rejects with it.
- **Mesh-light sampling** picked the first triangle with `cdf ≥ ξ`, so at ξ = 0 it took
  triangle 0 whatever its area; a degenerate triangle there gave a NaN sample that stuck in
  the pixel. The search is strictly greater, which never selects a zero-area triangle.
- The light-tree importance comment claimed its box cull is hereditary ("a descent can never
  die mid-tree"); it is not (a parent's far corner can lie in neither child). Variance only;
  the comment now says so, with the audit's measurement and the fix (child-box lookahead).
- `.inst` provenance padding no longer uses 32-bit arithmetic that wraps for huge lengths.

## 2026-09-25 — OBJ loader: relative indices and mixed normals

- Face corners were cached by their raw token, so a relative index (`f -3 -2 -1`) meant the
  same vertex every time it appeared: a second vertex block's faces reused the first block's
  vertices. The cache now keys on the resolved indices.
- In a file mixing `v//vn` and bare `v` faces, the bare corners got a (0,0,0) normal, NaN once
  interpolated and normalized. They now get the area-weighted vertex normal.

Tests in tests/authoring/loadOBJ.test.ts (both fail on the old loader); every suite scene's
packed data is byte-identical.

## 2026-09-25 — validation: inputs that used to pass and then break or mislead

From the Sep 25 compiler audit (its compile fuzzer and probes). Each case below passed
validation and then crashed the generator, emitted GLSL that cannot compile, or silently
rendered something other than what was written; each is now a named error.

- `measurement.scattering`/`shadows`/`color`/`response` accept only their documented values
  (`scattering: 'none'` used to switch the scattering arms off, i.e. change the integral).
- `estimator.russianRoulette.startDepth` must be a non-negative integer (it is spliced into
  the walk; 2.5 or NaN produced broken GLSL), like `maxBounces` since Sep 24.
- `view.tonemap.exposure` must be finite and > 0 (NaN became `#define DISPLAY_EXPOSURE NaN`).
- Pinhole/thin-lens `fov` must be radians in (0, π) (a degree value like 45 was accepted and
  gave a nonsense field of view); a new `interval` row constraint states it in the camera
  descriptors. Fisheye `fov` is checked per projection (orthographic ≤ π, stereographic < 2π,
  the others ≤ 2π) through a new `validateAuthored` camera hook; its slider range follows.
- A procedural environment cannot declare formula params (the bake has no uniforms; they
  reached GLSL undeclared), and its `tableSize` must be two positive integers.
- Parameter paths must map to valid GLSL identifiers (`key-light.tint` emitted
  `u_key-light_tint`; `a._b` produced a reserved `__`).
- A material `{param}` needs a default (without one the uniform stayed at GL's 0 — an ior of 0).
- `Transform[]` instance placements are checked like object transforms (s > 0, one scale,
  a nonzero rotation axis or a real quaternion, finite position), reported at the first bad
  placement; the packed form was already checked.
- Mesh vertices must be finite (a NaN vertex died later in the GLSL formatter, naming no object).
- `sampleAsLight: true` on a driven, or rotated uv-reading, quad/sphere/disk is an error: the
  rule re-derived the light census without its placement exclusions, so the flag was accepted
  and then silently dropped.
- An object-free scene is an error up front (it can never link; it used to warn "nothing will
  be rendered" and then fail on internal seam errors). Supporting a light in fog with no
  surfaces needs stub intersection functions: open.
- `compileScene` rejects two strategies with the same id (they would overwrite each other's
  programs in the engine), and now RETURNS the warnings of a successful compile
  (`CompiledScene.warnings`, deduplicated across strategies); the App logs them. Every
  "field is ignored" / "knob does nothing" warning used to be discarded unless the compile
  also failed.
- The unknown-primitive error names the object.

Tests: tests/compiler/validator.test.ts (12 new cases, all failing on the old code),
tests/compiler/compileScene.test.ts. All 192 suite scenes still compile.

## 2026-09-25 — runtime: production sessions, pause, dialogs, restore, uniforms, runner

From the Sep 25 runtime audit, each confirmed by a unit test or by reading the call sequence:

- **A stopped render's late `finally` unlocked the next session.** A production promise
  settles a microtask after `stop()`, by which time a new session (e.g. a tiled render) may
  be active; its `finally` then unlocked that session's parameters mid-render. Each run now
  holds a token and settles only its own session.
- **A throw while applying the production view** (a 4K/8K resize can fail to allocate) left
  the parameters locked forever. `beginProduction` now unwinds itself.
- **A new production was refused after a finished one** that was still on display (modal
  dismissed with × or the backdrop). The finished view is now exited first.
- **Extend Render opened two completion dialogs** (the RENDER_COMPLETE listener and the
  extend promise both did); extending from the second one while the first extension ran
  cancelled it. Only the event opens it now, and extending while a render runs is refused
  before anything is touched.
- **A paused production could not be resumed from the UI**: the panel only updated on progress
  events, which stop while paused, and the `\` shortcut was swallowed by the production lock.
  The panel follows RENDER_PAUSED/RESUMED; `\` works while locked.
- **Dismissing the production dialog with × or the backdrop** left rendering paused and the
  canvas unclickable. The cleanup now runs on every close.
- **Switching renderer after a production finished** cleared the image while the panel kept
  offering Export (a 0-sample frame). The panel closes on a renderer switch.
- **Loading a session left stale values in the engine**: keys set after the session was
  saved stayed live on the GPU while the store, the panel and the stamp said "default". The
  restore now reports removed keys, which return to their compiled defaults.
- **Uniform uploads skipped changes smaller than 1e-5** (an absolute tolerance), so small
  parameters (a σ in m⁻¹) never reached the GPU. Comparison is now exact.
- **`app.loadEnvironmentHDR(path)`** swapped the texture but left the old map's size and
  weight (read by the env sampler) and its table variants. It now runs the full loader and
  records the path for context restore.
- **Witness runner**: a page reloaded mid-render (Vite reloads the lab when a watched file is
  saved) was read as "render finished" and its empty frame accepted. A reload is now an
  error, and readbacks are checked for the configured size.

Tests: tests/app/productionOrchestrator.test.ts (four session tests, each failing on the old
code), tests/app/parameterStore.test.ts, tests/engine/shaderUniformUtils.test.ts.

## 2026-09-25 — a sky plus batch lights only (under `'bvh'`) failed to link

With a samplable environment the NEE samplers draw env-vs-finite with `u_envSelectProb`, but
the Planner declared that uniform only when REGISTRY lights existed; batch instance lights
(finite lights under `lightSelection: 'bvh'`) did not count, so such a program read an
undeclared uniform. Now they count. Test in tests/compiler/lightCensus.test.ts (reproduced
first); witness `instance-lights-sky` (the instance-lights twin under a samplable sky) passes
nee ≡ mis. Still open (variance only): the derived selection probability ignores batch-light
power, so with no registry lights it clamps to 0.99 and the batch gets 1% of NEE samples.
Found by the Sep 25 audit's compile fuzzer.

## 2026-09-25 — table dispatch: a scaled scene-local SDF drew at the wrong size

`classifyPlacement` keeps the whole similarity (scale included) as the residual for a
`defineSDF` field with a direction or vector row, and the unrolled marcher applies it; the
scene table's SDF record carries only a rigid tail, so a tabled copy of such an object was
drawn at 1/s of its size (its TLAS box was still scaled). Table dispatch is the default from 9
marched objects, so this changed the image without the author asking for it. Such objects now
stay on the global marcher. Test: tests/compiler/sdfTable.test.ts (fails without the fix). No
registry scene was affected (snapshots unchanged). Found by the Sep 25 audit.

## 2026-09-25 — `scattering: 'ignored'`: shadow rays see the same medium as camera paths

Under `measurement.scattering: 'ignored'` a scattering medium is absorbing-only (σ_t = σ_a),
and camera segments were attenuated that way, but the shadow-ray transmittance was generated
separately and kept σ_a + σ_s. So NEE and MIS darkened light through such a medium that pt
carried: an estimator changed the image. The transmittance generator now drops σ_s exactly
when the dispatch does (closed form on σ_a, or the σ_a ratio tracker for expression media);
media that do not scatter emit the same code as before. New witness `fog-area-ignored` (the
X-FOG scene under 'ignored'): nee vs pt differed by 31.8% in frame mean before, 0.03% now;
nee ≡ mis holds in both. Found by the Sep 25 audit; no registry scene reached it before.

## 2026-09-25 — the sun sits at the far clip

The directional light placed its sample at distance 1e20, so any ambient medium extinguished
the sun completely (and ratio tracking in a heterogeneous ambient medium exhausted its budget
and returned a partial, biased transmittance), while the sky beside it has been attenuated
over `MAX_DIST` since the Sep 24 fix; occluders beyond the far clip could also shadow it. It
now uses `MAX_DIST`, the declared scene-scale truncation ("geometry or an ambient medium
extending past 1000 units is cut"), like the environment. New witness `sun-haze` (a wall
facing the sun through σ_a = 0.001 haze: (ρ/π)·E·e^{−σ_a(MAX_DIST − backoff)}·e^{−σ_a·1} =
0.1838) read exactly 0 before and 0.1838 now; `sun` still passes. No existing registry scene
combines a directional light with an ambient medium.

## 2026-09-25 — precision: small, distant spheres (intersection and sphere lights)

Found by the Sep 25 audit (f32 emulation), confirmed on the GPU with two new exact witnesses.

- **Sphere and cylinder intersection** computed the discriminant as b² − c, subtracting two
  numbers of size |oc|² to find one of size r². For a sphere small against its distance (an
  instance-cloud sphere seen from across the cloud, r/D ~ 1e-3) hit/miss near the silhouette
  was decided largely by rounding and hit points moved by a large fraction of r. Both now use
  the perpendicular-offset form of Haines et al. (Ray Tracing Gems ch. 7), r² − |oc − b·d|²,
  with the near root as c/q; the cylinder's tube uses the 2D version (Lagrange's identity).
- **Sphere lights** computed 1 − cosθmax as 1 − sqrt(1 − sin²θmax), which keeps almost no
  bits for small or distant spheres, and that number is the pdf: at r/d ≲ 1.5e-4 it rounded to
  0 and the 1e-8 floor made the light exactly twice as bright; at r/d = 1e-3 (the embers
  demo) the error is up to ±12% per shading point. Now sin²θmax/(1 + cosθmax); the polar angle
  is sampled as w = u·(1 − cosθmax), sin²θ = w(2 − w) (the old form quantized small cones onto a
  few rings); the distance to the sampled point uses the robust near root. The pdf mirror uses
  the same function, so the sampler/pdf byte match holds.
- New witnesses (tests/witnesses/scenes/precisionWitness.ts): `tiny-sphere` (an emissive
  sphere at r/D = 2.5e-4; frame mean = disk area / frame area) read 0.2195 on the old code
  against 0.0767 and reads 0.0768 now; `tiny-sphere-light` (a wall under a sphere light at
  r/d = 1e-4; L = ρ·Le·r²/d²·(1 + x²/d²)^(−3/2)) read 0.9998 against 0.4997 and reads 0.4997.

Generated-GLSL snapshots changed by exactly these three formulas (plus source-map offsets).

## 2026-09-25 — the GRIN "energy loss" was black lenses; the softbeam "bias" was noise

**GRIN regions rendered black whenever their region id differed from their material id.**
The four GRIN furnaces read ~0.30 against 0.4 (open since August, listed as "a ~25% energy
loss, cause not established"). Rendering `grin-furnace-hard` showed the lens itself nearly
black (mean 0.07) with the rest of the frame near 0.4, and the lens covers about a quarter of
the view. The walker's exit test compared `scene_region_at(p)`, a region id, with `med`, which
the dispatcher passes as a material id. In the furnaces the lens is region 6 (after six wall
planes) but material 1 or 2, so the walker "left" on its first step, rewound to just outside,
re-entered, and repeated until the bounce budget ran out. Every GRIN demo and every GRIN twin
had the lens as region 1 and material 1, so only the furnaces saw it. The walker now asks
whether the MATERIAL at the point has changed (`grin_inside`, grin.glsl), which is also the
right exit physically: a wall between two regions of the same material has the same n on
both sides. After: `grin-furnace` (0.3989, 0.3994, 0.3996), `-emit` 0.3997, `-scatter`
(0.3997, 0.4001, 0.4002), `-hard` 0.4000; the GRIN twins are unchanged.

Tried and rejected: evaluating n exactly at the walker's exit/event points (plus an (n/n_wall)²
factor on the final straight micro-segment), which telescopes on paper, biased
`grin-furnace-scatter` to 0.40101 ± 0.00002 over salts. Velocity Verlet conserves a nearby
"shadow" Hamiltonian whose index along the computed ray is |T|, so the walker's |T|-ratio
factor is the consistent one; the reasoning is now in the `grin_finish` comment.

**`softbeam-wall` +3.3% was noise, not a normalization bias.** NEE samples the whole aperture
but only the 4% of it inside the emission cone contributes, so each sample has a relative sd of
≈4.9; the check averaged 80 pixels at 96 spp (a 7% standard error, against a 1.2% tolerance),
and the runner's pinned salt reproduced the same draw every sweep. Six salts on the old crop:
0.9985 ± 0.030 (expected 0.99917). The check now averages a 3600-pixel crop inside the core
at 384 spp (0.9963 on the runner's salt; 0.9989 ± 0.0028 over three salts).

Verified: `npm run witness` on all nine GRIN witnesses and `softbeam-wall` — all pass.
tests/witnesses/README.md sections A and B record the analysis.

## 2026-09-25 — large images: tiled rendering saves one stitched file

The old `TiledRenderer` was never reachable from the app, and would have failed on its second
tile: it started a fresh production render per tile, and the first one leaves the production
session "settled", which refuses a new one. It also downloaded one file per tile for the user
to stitch.

- **`app.renderTiled({ width, height, spp, format, tileSize })`** renders any size in tiles
  and saves ONE HDR and/or PNG with the full image's stamp. The production dialog offers it
  ("Render in tiles"; on by default for the new 8K size, and a Custom size).
- **Tiling is invisible in the output.** The RNG already seeds with the global pixel, cameras
  map through `engine.imageSize`, tile offsets are multiples of 64 (the display dither's
  blue-noise period), and the job pins one RNG salt, recorded in the stamp. Verified in
  headless Chromium: a 200×150 render in 64-px tiles (edge tiles 8 and 22 px) is
  byte-identical to the one-piece render, HDR and PNG, for each of the six cornell cameras
  (pinhole, thin lens, orthographic, equirect, fisheye, cylindrical); with the salt unpinned
  the files differ, and the stamp records the salt actually used.
- One parameter lock spans the whole job (`ProductionOrchestrator.renderTiles`); the canvas
  and layout are restored and interactive rendering resumes afterwards, including after a stop.
- The stitched image is held at 4 bytes/pixel per format (RGBE or RGBA) and allocated before
  the first tile, so a size the browser cannot hold fails immediately.
- **PNG export no longer goes through a canvas.** `encodePNG` writes the file directly (Paeth
  filter, the browser's zlib via `CompressionStream`, stamp as tEXt chunks). `canvas.toBlob`
  is capped by the browser's canvas-area limit (Safari: 16.7M pixels, below one 8K frame) and
  its failure was silently ignored. All PNG exports use the new encoder, so `exportPNG` /
  `exportAOV` / `exportAllAOVs` are now async (the pixels are still read synchronously).
- `floatToRGBE` clamps negative channels at 0 (a Uint8Array stored −26 as 230).
- The production dialog's stop check compared `err.name` with `'RenderStopped'`; the name is
  `'RenderStoppedError'`, so every cancel was logged as a failure.
- Removed: per-tile downloads, the never-wired session resume (`SessionData.tileJob`), and
  the unused `TILE_START`/`TILE_COMPLETE` events.

Not changed: the production loop draws one sample per animation frame, which caps small
tiles' throughput (a 512² tile at 60 fps is 16M samples/s however fast the GPU); that is the
reason the default tile is 1024. Tests: tests/app/tiling.test.ts, the PNG round trip in
tests/app/fileExport.test.ts, the session in tests/app/productionOrchestrator.test.ts.

## 2026-09-25 — runtime fixes: context loss, render-loop errors, export stamps, workers

- **WebGL context loss was unrecoverable.** On restore the engine rebuilt the renderers but
  not its blue-noise texture, and nobody re-supplied the scene-data or environment textures or
  re-sent parameter values: every later frame threw "Extern texture 'data_nodes' is not
  registered" (and the camera and sliders would have reverted to defaults). Now the engine
  re-registers what it owns and calls `onContextRestored`; the App re-executes the scene-data
  plan, re-bakes / reloads the environment, re-selects the active renderer, re-sends every
  parameter and restarts accumulation. Checked in headless Chromium with WEBGL_lose_context:
  instance-lights, sky and proc-sky render a bit-identical image (pinned salt) after
  loss + restore; the previous code never finished a frame after restore.
- **A frame that threw killed the render loop silently**, leaving the state at 'rendering', a
  production render's promise unsettled (parameters locked for good) and nothing reported. The
  loop now stops cleanly, rejects the pending production render, and emits `RENDER_ERROR`,
  which the App shows in its error overlay.
- **Export stamps could describe different parameters than the pixels**: a change made while
  rendering is stopped defers the accumulation reset, but the stamp read the current values.
  The App now snapshots the parameters at each accumulation restart and stamps that.
- **Worker fallback on detached inputs**: when a worker failed after receiving TRANSFERRED
  inputs (a module worker's load failure arrives after postMessage), the main-thread fallback
  ran on zero-length arrays. It now rejects in that case; cloned inputs still fall back.

Tests: tests/app/renderCoordinator.test.ts (a throwing frame), tests/app/worker.test.ts.

## 2026-09-25 — the App packs scene data from a compiler plan (stage 2)

The App no longer derives anything from the scene to build the data textures. The compiler
returns a scene-data plan (`CompiledScene.sceneData`, built by `compiler/sceneData.ts` from
the Planner's own results): mesh geometry per slot, mesh-light bakes, instance-batch pack
specs, the object table's packed records and leaf-box sources, the light table rows with each
light's box and power, and region→material ids. `app/sceneData.ts` executes it, doing only the
data-sized work (packing vertices, building BVHs, writing bytes).

- The Planner builds its lights FROM the light roster instead of mirroring it, and region ids
  come from its own assignment — the "light roster drift" and "region-material drift" runtime
  checks are gone (the agreement they checked now holds by construction), and so is
  `regionMaterialsOf` (a count remains, `regionCountOf`). tests/compiler/lightRoster.test.ts
  (roster ≡ plan) became a tautology and was removed.
- Proof: tests/app/sceneData.test.ts fingerprints every data texture for every suite scene;
  the fingerprints were recorded from the old App code (moved verbatim first) and the
  plan-driven packer reproduces them exactly (187 scenes). Compiled shaders unchanged.
  GPU smoke test (bazaar, instance-lights, mesh-light-twin): identical numbers.

## 2026-09-25 — build only the scene data the renderers read (stage 1)

Design: docs/claude-data-exact-linkage.md. The optional data structures — the CWBVH, the
light tree, the object table (with its region→material ids) — were built for every scene
whether or not any renderer read them; for large instance clouds the unused CWBVH took more
time at load than the TLAS actually used (+2.6 s at 724k instances, +5.3 s at 1.4M).

- `Compiler.compileScene(scene, strategies)` compiles a scene's renderers together: validate
  all, take each strategy's decisions (`programDecisions`), lay out the union of what they
  read (`dataReadsOf`, `unionDataReads` → `DataReads`), then plan and generate every program
  against that one layout. `compile(scene, strategy)` is the one-strategy case.
- `dataTenantsOf(scene, reads)` allocates optional structures only when read; the App packs
  with the same reads and builds the CWBVH only where the layout gave it a region.
- The ledger puts every always-built region before every optional one, so a renderer that
  reads no optional structure compiles to the same text whatever its siblings read (tested).
- The App now compiles (and validates) BEFORE packing: a bad scene fails in milliseconds
  with its diagnostics. `App.recompile` rebuilds the scene data for the new layout, with
  rendering paused across the swap (it previously kept the old scene's data).
- Tests: tests/compiler/dataReads.test.ts — decisions are identical whichever layout they
  are planned against (every suite pair), and each optional structure appears only when a
  renderer reads it. Snapshot change: two single-strategy programs' light-tree /
  region-material offsets moved down (the other optional structure is no longer allocated).
- GPU check (witness runner): every scene covering an optional structure or the new
  start-up order passes — instance-params-twin (cwbvh ≡ tlas), hundred-spheres,
  instance-lights, accel-triple, bazaar, sdf-table-twin, mesh-light-twin, instance-twin,
  cornell-area.
- Witness harness: the lab page no longer starts its own render loop when opened by the
  runner (`?witness`). At full window size, sdf-table-twin's first frames (a ~110 s shader
  compile under SwiftShader) kept the page busy for ~111 s against the runner's 120 s wait,
  so it passed or failed by a few seconds. cube-cloud now fails later and more precisely:
  the runner takes control at once, but the render itself does not finish within 8 minutes.

## 2026-09-24 — architecture review; estimator and crash fixes; CI

A full review (compiler, component library, emitted GLSL, engine/app, tests, docs) found the
per-component math correct and the bugs concentrated at the seams between components. Fixed:

- **`maxBounces` meant something different under each estimator.** The walk did N
  intersections with NEE at every one, so pt computed Σ_{n≤N−1} TⁿE, pt-nee Σ_{n≤N} for
  samplable lights, and pt-mis only the NEE share of the n = N term. The walk now does N + 1
  intersections; the last one only scores emission (surface, sky, medium emission), and NEE,
  the continuation and medium scattering stop at the budget (pbrt-v4's structure). Every
  estimator now computes Σ_{n≤N} TⁿE, matching the taxonomy. `maxBounces` is now
  Validator-checked to be a non-negative integer. pt renders at a given N gain the
  previously missing last term, so pt images move slightly.
- **Environment pdf under rotation.** The equirect chart's u coordinate was not wrapped, so
  `environment_pdf` clamped it to the edge table column across a band of longitudes as wide
  as the rotation, and pt-mis weights no longer summed to 1. u is now wrapped into [0, 1).
- **Equiangular medium NEE + a samplable environment** silently dropped the sky's
  single-scattered light (the combiner gives the sky weight 0 after a scatter, but
  equiangular only samples delta lights). Now a Validator error.
- **Rough dielectric at η = 1** (thin sheets, index-matched glass) sampled the pass-through
  direction with an infinite pdf, NaN under MIS. It is now the delta pass-through, as in
  pbrt-v4, and `power_heuristic` has pbrt's overflow guard.
- **Environment NEE placed the sky at 1e20**, while missed BSDF rays find it at the far clip
  `MAX_DIST` (1000): planes beyond the clip blocked NEE only, and an ambient medium
  extinguished NEE's sky completely. Environment NEE now uses `MAX_DIST`, which is documented
  as a scene-scale truncation.
- **Blackbody material emission** crashed the Validator, and the Analyzer did not count such
  emitters as lights although the Planner did. **An emissive object whose material omits
  `sampleAsLight`** slipped past the equiangular "delta lights only" rule and crashed the
  generator. Root cause: four modules each re-derived "which objects are lights" from the raw
  scene. There is now one answer, `samplableEmitterObjects` (compiler/plan/dataTenants.ts),
  used by the Analyzer, the Validator and `lightRosterOf`; `hasConstantNonzeroEmission`
  understands the blackbody spelling.
- **A scalar constant-environment color** crashed the GLSL formatter, and **a driven
  blackbody sky** made the NEE selection probability NaN. The environment color now goes
  through the same spectrum normalization as material spectra.

New tests: `tests/compiler/lightCensus.test.ts` (the crash classes above), the η = 1 case in
the rough-dielectric twin tests, and four exact GPU witnesses in
`tests/witnesses/scenes/estimatorAgreementWitness.ts` (bounce-budget, proc-sky-rotated,
fog-sky, rough-sheet).

Verification (full GPU sweeps, SwiftShader):
- Pre-fix code: 156 exact checks, 149 passed. Failures: the four GRIN furnaces (~25% low,
  uninvestigated), softbeam-wall (+3.3%), cube-cloud (the hang) and one runner flake. Every
  other witness the August notes list as "awaiting sweep" passed.
- Fixed code: every check passes except the same four GRIN furnaces, softbeam-wall and
  cube-cloud; no existing check changed status. (Two runner flakes on the first pass passed
  on re-run.)
- The four new witnesses pass on the fixed code and FAIL on the pre-fix code: bounce-budget
  (sky 0 at N = 0; sphere 0.07 under mis and 0 under pt at N = 1, vs 0.4), proc-sky-rotated
  (mis 61% brighter than nee: the sun counted twice), fog-sky (sphere 0 under nee, 0.12 under
  mis, vs 0.147), rough-sheet (1305 NaN pixel components).

Found while building the witnesses, NOT fixed (design question): thin dielectrics are
one-sided — on a front-face hit the dispatcher reports region_to = the surface's own region,
so a thin glass sheet refracts as if entering glass and never exits; from the back, η = 1.
That asymmetry is also what makes quad lights one-sided. The Validator's thin-surface warning
("will refract as η = 1") is only true from the back. See tests/witnesses/README.md.

Added CI (`.github/workflows/ci.yml`: typecheck + vitest incl. glslang on every push; the GPU
sweep on demand) and removed the Pages workflow: its build script is a template from a
three.js demos repo, and here it built 35 pages that load only scene-definition modules (no
renderer), while Pages itself is unavailable on this private repo. The build script
(`scripts/build-all.mjs`, `npm run build:all`) and `PAGES-TODO.md` were removed with it.

## Through 2026-08-13 — the build record formerly kept in CLAUDE.md

Moved here verbatim from CLAUDE.md's "Current state" section (oldest first). It uses the
project's internal batch codes and doc-section references; the docs it cites explain them.


**Done** (see `docs/trace-loop-contract.md` + the impl-plan-*.md docs + memory): the top-level loop conforms to the trace-loop contract (`Ray` pure geodesic seed, generated `scene_intersect` dispatcher, `ambient_dot` metric discipline, no `GeodesicState`); §10.1 items 1–6 & 8; **two geometry backends** (SDF marching + closed-form analytic, combined by the dispatcher); **two-sided hits** (`Hit.region_owner`, generated `scene_region_at` innermost-wins, epsilon classification, owner-shades vs emission-on-`region_to`, `ray_spawn`, interior marching, per-owner normals); the **smooth dielectric** (η² factor, generated `ior_of`/NEE-guard tables, `etaScale` RR metric) with its witnesses (F-ETA 0.5540 GPU-verified, R-SUBMERGED, cornell/analytic-glass twins); RR post-weight per §7.2; **homogeneous media** behind the volumetric component (`docs/fable-volumetric-component.md`): null interfaces (`model: 'none'`), `current_medium` + §4.4 self-heal, `ambientMedium`/`material_of(-1)`, the generated `medium_sample`/`medium_transmittance` seams (absorbing arms deterministic; scattering arms = pbrt-v3 channel-MIS), HG phase (forward convention), spectral `shadow_media` segment walker, the emission gate (`material_is_emissive`) — witnesses GPU-verified (slab exact numbers, F-BOX-M 0.4/channel, haze g-flip, fogcube rim; F-ETA re-verified 0.554); **area lights + MIS** (`docs/impl-plan-area-lights.md`, owner-verified): quad analytic primitive, explicit-light desugar to `__light_n` emissive regions + the `sampleAsLight` route, `light_of`, area-aware power CDF with `cdf_rescale`, ONE-SIDED quads (pinned deviation from the §6.2 two-sided aside), §6.2 emission w-bookkeeping, full MIS (generated `lighting_pdf`, power heuristic, `prev_bsdf_pdf`/`prev_p` at surface AND medium events) — **pt/pt-nee/pt-mis converge on cornell-area, cornell-area-glass (X-GLASS), and fog-area (X-FOG)**; the marcher's grazing-stall fix (stall-aware exhaustion both directions + adaptive `march_epsilon`); the **suite gallery** at the dev-server root (`expected` pass criteria per scene).

**Environment-as-light is BUILT** (July 2026, `docs/impl-plan-env-as-light.md` T1–T5, all GPU-verified): the §2.10 `extern:` chain end-to-end (executor = sole texture-unit authority; legacy engine env binding deleted), `image` + `procedural` environments (procedural = one-shot GPU bake via a fixed-size headless renderer — the `FramebufferConfig.size` contract extension — app-orchestrated), samplable env in NEE/MIS (two-stage selection with `u_envSelectProb` wrapping the baked CDF; miss-branch w-bookkeeping per reference §5/§8 line 3; pdf-from-CDF-differences), the D11 chart axis (`transport.envSampler: 'equirect' | 'octahedral'` — equal-area octahedral is pbrt-v4's mapping; TS twin in `src/engine/loaders/octahedral.ts` is the tested ground truth) and `transport.envCompensation` (MIS-gated). Witnesses in the suite: sky (X-ENV + X-CHART), furnace-sky (convex ρ·L — NOT the closed-furnace L/(1−ρ)), sky-lamp (two-stage), proc-sky (bake + W9 compensation).

**Decision-hoist batch is BUILT** (July 2026, `docs/impl-plan-decision-hoist.md` T1–T4, all gates green): `RenderStrategy` restructured into **measurement / estimator / view** sections per the pinned taxonomy (`docs/fable-strategy-taxonomy.md` — the `volumeIntegrator` split: `measurement.scattering` truncation + `estimator.volumeSampling` axis; `shadows`/`color` declared truncations, `'spectral'` reserved-rejected); **`ProgramDescription` is the complete link map** — Generate reads `plan.program` + data tables ONLY, `RenderPlan.features` deleted (feature generators cannot re-derive decisions), with its own structural snapshot per registry pair; **glslang static compile check** for every pair's shaders in vitest (`tests/compiler/glsl-compile.test.ts` — NOTE: glslang accepts what ANGLE rejects, e.g. struct ternaries; GPU witnesses still own dialect quirks); **provides/requires + the generated interface header** (`generated:interfaces` block = each program's contract surface as its table of contents; seam-conflict/seam-missing diagnostics; cross-feature declaration order no longer load-bearing).

**The transport split is BUILT** (July 2026, `docs/impl-plan-transport-split.md` commits A–D; §10.1 is COMPLETE): the loop is GENERATED — source of truth now lives in `src/components/transport/` per the §7 anatomy (`integrators/pt.ts` walk + `techniques/{kernel,light}.ts` + `combiner.ts`, re-carved from the original segment emitters) with per-part provenance (`generated:transport/<part>`); `path_trace.glsl` deleted; proof was token-equivalence across all 47 registry pairs (test deleted with the template, per plan); ZERO structural defines remain anywhere (library media/MIS sections are conditionally-included blocks — `structs_media/math_media/math_mis.glsl`; only numeric knobs like `MAX_MARCH_STEPS` stay defines). Shared-invariant emitters: `rr()` at both sites, `prevBookkeeping()` at medium+surface. The GPU witness sweep is now covered by `npm run witness` (35/35 green, July 13 2026); dumps for loop reading are regenerable via `npm run dump:shaders` — each program contains exactly its own estimator.

**The descriptor/schema reorg is BUILT** (July 2026, `docs/impl-plan-descriptor-reorg.md` R1–R3): mix-many families are descriptor pairs in family folders (`glsl/materials/lambert.{glsl,ts}`, `glsl/lights/point.{glsl,ts}`, `glsl/phase/hg.{glsl,ts}`, registries at each `index.ts`); `MaterialProperties`/`MediumProperties` are schema-generated per scene (§3.4 literal — **no roughness field exists until GGX's schema declares it**; a driven param with no reader is a Validator warning); primitive parameters are schema-checked (C7). **Adding a material model = one GLSL file + one descriptor + one registry line.**

**The components library is BUILT** (July 2026, `docs/fable-components.md` §§1–6): everything swappable moved to the top-level `src/components/` leaf layer — byte-identical emitted GLSL across all 47 registry pairs (hash-verified), snapshot churn = provenance renames only, GPU spot-checked. The sampler slot is carved (`components/sampler/pcg4d.glsl` + registry — Owen–Sobol is the known second occupant); `descriptors.ts`/`glsl-format.ts`/`quadNormal`/the octahedral TS twin resolved into components; the transport family has the **§7 technique-centric anatomy (owner-decided + BUILT July 12 2026)**: `transport/techniques/{kernel,light}.ts` (T1 = kernel sampling with its deferred scoring sites + carried record; T2 = light sampling, local scoring), `transport/combiner.ts` (every weighting line — pt/pt-nee/pt-mis are combiner configs), `transport/integrators/pt.ts` (the walk skeleton composing them; new integrators = new walks here). **A new sampling technique = one file + one registry line** (the axis the owner chose to make cheap) — **proven by equiangular medium NEE** (`docs/impl-plan-equiangular.md`, BUILT July 13 2026: `techniques/equiangular.glsl` + glue; `estimator.mediumLightSampling: 'vertex' | 'equiangular'`; haze pt-nee/pt-nee-eq equality pair GPU-checked 0.5% @ ~20spp, halo-core noise −19%; v1 = delta lights + nee only — area arms and placement-MIS on that plan's ledger). **The emitted GLSL matches this anatomy too** (`docs/fable-transport-glsl-target.md`, owner-approved + BUILT July 13 2026): the loop emits function-shaped — generated `PathState` (§3.4-style union) + `combiner_w_*`/`kernel_record`/`roulette` generated bodies + STATIC technique files (`techniques/{kernel,kernel_phase,light,light_medium}.glsl`, conditionally included) + a ~40-line generated walk. The rules: **math is static; policy/plumbing are generated**; static files touch ONLY PathState's pinned core (ray/throughput/radiance) — every program-dependent field is behind a generated function. Proof regime for that batch: witness sweep + glslang + re-goldened snapshots + perf wash (byte-identity impossible by design); identity-weight elision is a deferred Generate-stage fold.

**GGX is BUILT** (July 2026, the first occupant through the new front door): `components/materials/ggx/{ggx.glsl, ggx.ts, ggx.test.ts}` — reference §7 transcribed to the (uc,u)/`ambient_dot` contract (VNDF sampling, separable Smith, Schlick; alpha = roughness² clamped ≥ 1e-3), fields `f0` + `roughness` via the §3.4 schema. The §11.3 pdf-histogram harness exists in its TS-twin form (ggx.test.ts: χ² over the spec grid with adaptive per-bin integration, the weight·pdf ≈ eval·|cos| triple, sample/query pdf agreement, reciprocity — the GPU debug-strategy form stays deferred, HG's instance unbuilt). Witness: **veach-mis** in the suite (4 roughness steps × 3 sphere-light sizes at ~equal power; pt/pt-nee/pt-mis; headless GPU check shows means agreeing ~6% at ~20spp and pt-mis visibly firefly-free — converged §11.2 equality is the owner's check, PENDING). Bring-up also fixed a Planner altitude bug: `brdfModels` was a hardcoded hasLambert/hasDisney/hasDielectric if-chain that silently dropped ggx from the generated structs — now registry-driven (registry order = dispatch order; zero churn in existing snapshots proved it).

**The measurement bench is BUILT** (July 13 2026, `docs/fable-measurement-bench.md` — the owner's cut of that proposal: runner + variance + stamps; compare mode CUT, probes DEFERRED): **`npm run witness`** (`tools/witness.mjs`, playwright devDep, SwiftShader headless) renders every entry of **`tests/witnesses/` — the durable GPU test system** (the executable form of fable-validation-scenes.md: fixtures owned in `witnesses/scenes/`, registry + checks in `witnesses/index.ts`, gate policy in its README; `demos/` is the REPLACEABLE demo layer, merged into the gallery view by `pages/registry.ts` — demos may import witness fixtures, never the reverse) and asserts the numbers (check kinds `mean`/`equality`/`twin`/`noise`) — all known witnesses reproduce (furnace 0.4000, F-ETA 0.5541, slab, F-BOX-M, furnace-sky ρ·L & L=1.0). Equality gates: Δ frame-mean in LINEAR HDR (bias) + noise-normalized **χ²** against the measured per-pixel variance (structure; ≈1 for same-integrand arms at any spp, fireflies self-normalize) — χ² requires shared event coverage, so chance-hit **pt arms get calibrated display-space RMSE tripwires** instead (converged pt equality stays the owner's GPU check). The **variance accumulation occupant** (`components/film/accumulate_variance/` — Welford δ·δ′, one MRT double_buffer so mean+moment swap in lockstep, `variance` export at attachment 1; Validator/Planner/ShaderBuilder/PipelineBuilder seams) is GPU-verified mean-untouched (Δ 0.00% vs `average`, same RNG stream) and powers `noise` checks: equiangular's halo win reproduces as σ/µ 18.05% vs 21.24% @192spp; veach asserts pt-mis lowest (4.43% < pt 9.99% < pt-nee 11.64%). **Reproducibility stamps**: every HDR/PNG export embeds scene + strategy JSON + parameters + spp + resolution + resetSalt + git hash (HDR `# key=value` header lines; PNG tEXt chunks, CRC-tested); `app.pinResetSalt(n)` = the §2.11 reproducible mode. Known gaps: `exportPNG` needs an `ldr` export target that `buildExportTargets` never defines (dead for standard renderers, pre-existing); equiangular's "long segment" χ² vitest is flaky under parallel load.

**The camera family + `pixel/` are BUILT** (July 13 2026, `docs/impl-plan-cameras.md`): the camera axis is carved into a registry (`components/camera/index.ts`, minimal `CameraModelDescriptor`) — adding a camera is one folder + one line. Sub-pixel jitter was hoisted OUT of the camera into a new **`pixel/`** family (the reconstruction kernel `h_j(u)`; `box` occupant; `pixel_sample(coord,xi)`), so the camera is a pure map **`camera_generateRay(vec2 film, vec2 xiLens)`** (film point → ray, no RNG). **Six occupants**: pinhole, thin-lens (defocus, `aperture=0 ≡ pinhole` witness `thinlens-zero`), orthographic, equirect (360×180), fisheye (one occupant, four `θ(ρ)` sub-projections behind a `projection` sub-parameter, selected by a value `#define FISHEYE_THETA` — the TAN_FOV mechanism, NOT a generated block; the "no defines" rule is about STRUCTURAL gating only), cylindrical panorama (single `hfov` Width° dial + one focal length → square pixels, vertical follows the window). All switch live on the `cornell` demo card (keys 1-6). Bring-up fixed an unrelated shadow-ray bug (`sdf_intersect_any` accepted occluders past `maxDist` — floor self-shadow under a near-ceiling lamp). Deferred: realistic multi-element lens, tilt-shift, anamorphic, `pixel/` tent/gaussian, fisheye circular mask, motion-blur/spectral (Category-B seed fields). **Camera POSE is authored measurement data** (July 16 2026): `CameraPose` (`position`/`target`, plain Vec3) on every `measurement.camera` variant — the DEFAULTS of the always-live `camera.position`/`camera.target` params (OrbitControls contract; deliberately NOT `Value<>` — pose never bakes, orbiting never recompiles). `(scene, strategy)` alone now determines the converged image; suite registries stamp poses via `withPose` (`src/authoring/strategy.ts`), and `initialParameters` is back to parameter POINTS only (e.g. the driven witness θ′). `App.getParameter` resolves store → compiled metadata default.

**Exact linkage is BUILT** (July 15 2026, `docs/impl-plan-exact-linkage.md`; policy pinned as contracts §2.12): self-authored component files are included WHOLESALE (declared cost — never carve inside an occupant); everything GENERATED is exactly linked — seam existence is a ProgramDescription decision (`materials.surfaceEval`/`surfacePdf`, `media.mediumEval`/`mediumPdf`, `intersection.anyQuery`, `environmentSamplable` now a real decision ∧ NEE, `environmentPdf`, `environmentSelectionLive`), features gate emission + `provides` on those fields, and merge's **`seam-unused` warning** (dual of seam-missing; `componentScoped` provides exempt) enforces it structurally. Killed the audit's dead-code classes (worst was 27% of a `pt`+samplable-env program); env-only programs now fold the selection constant on BOTH sides (no dead `u_envSelectProb`); `MediumProperties` phase fields are strictly schema-driven; `u_resolution`/`u_time` left the main program (display's binding rides the Generator). Bring-up also fixed a latent combiner bug (`hg_pdf` hardcoded where the `interaction_medium_pdf` dispatch belongs — any non-hg medium under `pt-mis` couldn't link) and the glsl-rehome's broken `EnvironmentBake` import (lab.html 500).

**The transform system (stages 1–2) is BUILT** (July 15 2026, `docs/fable-transforms.md` — the placement design authority, owner-approved; supersedes `design-scene-graph-transforms.md`): object placement is a **Euclidean similarity** (`components/geometry/similarity.ts` — s>0 strictly, reflections rejected, nonuniform scale unrepresentable; closed-form compose/inverse, normals by R alone), authored as `transform: {position, rotation: axis-angle|quat, scale}` on any object. Constant transforms compile away: the analytic primitive set is **similarity-closed**, so they fold entirely into canonical parameters at plan time (`foldAnalyticParameters` — light desugar/power CDF/sampler/pdf/signed-distance all read the folded params; the flatten→fold→desugar ordering pin); SDF objects get classified wrapper tiers (identity/translation/rigid mat3/similarity with the `s·d` world-space distance correction that keeps the epsilon discipline valid). Byte gate held (one accepted deviation: explicit zero-center no-op subtraction now elided). Witnesses: **transform-bake** (transform-authored ≡ hand-folded twin), **conjugation** (one global g on every object AND the camera ≡ untransformed — the whole chain in one number), **regions-transformed** (nesting under Ry90·1.25+T). **SceneDescription stays FLAT forever** (owner-decided July 16 2026, doc §3): groups/trees belong to the AUTHORING layer only (seeded by a pure `flattenGroups` utility; the future DSL grows around it) — similarities are closed, so any composed chain re-expresses as one TRS and the compiler never needs to see a tree; the ParameterStore is the only runtime channel. **Stage 3 is BUILT** (July 16 2026): `src/authoring/flatten.ts` — the AUTHORING layer's first file (full stack now Authoring → App → Engine → Compiler → Components); `flattenGroups(SceneNode[]) → ObjectDescription[]` composes constant trees at definition time (TS object literals are the interim authoring syntax), stamps `name` provenance paths, rejects driven-under-transform per the §4 static-composition rule; TRS lowering shared as `similarityFromTransform` in components (Planner's `placementOf` aliases it); witness `flatten-tree` bit-exact vs the hand-folded twin. **Stage 4 is BUILT** (July 16 2026): uniform-DRIVEN placement — any `Transform` field takes `Value<>` (`{param}` → live per-object uniforms; the §6.1 rigid-frame Placement contract in `glsl/core/placement.glsl`: q_inv + (t_rigid, s), primitives' params absorb s in-shader so distances/t/epsilons stay world-exact, zero rcp); multi-path `PlannedUniform` (engine untouched); driven tiers across SDF wrapper + analytic nearest/any/region arms; pins enforced (driven excludes samplable emitters until the `Value<T>` light-params batch — RIGID-only there; transforms never accept GlslExpression). Witnesses `driven`/`driven-theta2` ≡ baked twins at two parameter points (0.00%). Sliders move objects with zero recompiles; the future graph runtime drives these same params.

**The July 17 2026 batch set is BUILT & GPU-SWEPT (vitest 824 + glslang incl. a registry kitchen-sink scene; owner's witness sweep 42/42 green Jul 17 after one fix — the reserved-`__` identifier bug in N5's sanitizer, see memory `reserved-underscore-bug.md`; detailed records: memory `batches-2026-07-17.md`, docs `fable-component-system.md` + `fable-geometry-materials-target.md`):** descriptor **kinds** (`point|vector|direction|length` — folds AND driven ×s scaling derive from one declaration; plane keeps the one coupled fold override); **type-first GLSL symbols** (`sphere_sdf`/`sphere_intersect`/`sphere_normal`, matching `lambert_eval`); **cylinder** (door test passed: math + rows + registry line, NOTHING else — no axis param, orientation is placement); **materials-§7 reorg** (schema rows own the property vocabulary end-to-end: numeric row defaults are the ONE truth, `PlannedMaterial = {id,name,model,values,medium}`, ior found structurally via the region-table row, `EMISSION_KEY` the sole policy-read name); **naming N1–N5** (material ids = INSERTION order — renames are free, integer-like names rejected; declared reserved param prefixes `engine./env./debug./renderer.` + `camera.position/target/frame` with paramToUniform-collision checks; symbol-contract tests for all families; suite/registry clobber guards; authored object names flow into emitted symbols — `sdf_pillar`, hoisted `shape_<name>` consts); **lights struct-alignment + door** (generated `PointLight/QuadLight/SphereLight`, sampler + MIS-pdf as ADJACENT functions in one file — the §6.1 mirror is no longer TS strings; descriptor desugar facts replace every Planner light branch; hoisted `light_<id>` consts); **structs GENERATED from rows** (occupant `.glsl` files declare FUNCTIONS ONLY — typedef-disciplined structs emit from the schema; the field-drift class is structurally dead); **every registry-shadow type union is dead** (primitive/phase/light-kind ids are `string`, registries + Validator gatekeep); **shape-not-backend** (`{ type, parameters, material, transform?, name?, backend? }` — the compiler resolves analytic-if-provided-else-sdf; all-analytic scenes carry NO marcher; `backend:` pins kept on `minimal` + `submerged` as deliberate marcher coverage); **one radiometric authoring word** (`emission` on lights AND materials — Le for area, radiant intensity for delta; `intensity×color` is dead; the ENV's `intensity` survives as the live slider; power-in-watts is authoring-layer sugar). Tooling: `npm run dump:shaders` covers the whole suite or `-- --scene <module>`.

**The doors-close batch is BUILT** (July 17 2026, post-review follow-up; detailed record: the target doc's ledger + memory `doors-close-batch.md`): the **lights door finished for real** — the review found three kind-name branches surviving outside the registry (Analyzer census switch, Planner's `present.add('lambert')` on a hardcoded quad|sphere list, the equiangular pin) — all now registry-derived; `brdfModels` derives from PLANNED materials so the desugared backing model flows alone; **unknown light kinds are rejected** (never silently skipped; 'directional' keeps its reserved-word message); **authored-light input schemas** (`authoredParams` on every kind descriptor + a generic Validator loop with C7 parity — required/shape/unknown-key, `validateAuthored` only on well-shaped input — plus a desugar-totality contract test enforcing both drift directions) ; the **door test** (`tests/compiler/lightsDoor.test.ts`) proves a synthetic registry-only kind compiles + glslang-links end to end. **`MaterialModel` union → string** (the B1 treatment — materials were the last unioned family; 'disney' died; 'emissive' keeps its migration rejection; per-model Analyzer feature flags deleted); **ior/region-table Validator rules structural** (capability + row source, no model names); **`emission_strength` merged away** (fixed-struct fossil — strength was 1 exactly when emission was assigned nonzero, so the product was identically `emission`; lambert_emission now `return mp.emission`; snapshots re-goldened, diff verified to be exactly the rider); **required XOR default** pinned on geometry rows (contract-test-enforced; defaults dropped from required rows). vitest 850; owner's Jul 17 sweep 42/42 green (the strength merge held on GPU). Same day, through the finished doors: **mirror** (Schlick delta conductor, f0 row shared with ggx — first §3.4 union dedupe; F-MIRROR 0.5 GPU-verified) + **disk primitive/light pair** (thin second tenant, normal = real param for similarity closure, kind-derived direction fold, concentric sampling, `canonicalize` descriptor fact replacing the Planner's plane name-branches) — witnesses cornell-disk + disk-bake GPU-verified; `chrome` demo card; memory `occupants-mirror-disk.md`.

**Medium emission is BUILT — GPU-UNSWEPT** (July 17 2026 evening, `docs/impl-plan-medium-emission.md`): `emission` on a medium = **ε, the volume emission coefficient** (W·sr⁻¹·m⁻³, dL/ds = ε — B2's dimensional ladder: intensity/radiance/ε; saturation = ε/σ_t; Kirchhoff coupling is authoring sugar); the D1 scale applies to ε (source-function preservation, owner-pinned); collection is **per-tentative-collision** in both null-collision loops (pbrt's shape, scalar-σ̄ collapse `w ⊙ ε/σ̄`, derivations in the plan) via the generated `medium_emission` accessor — the absorption branch stays a pure terminator; constant absorbing media get the exact closed form `ε(1−e^{−σ_a t})/σ_a`; emissive SCATTERING media route to the tracking arms with an **auto-derived majorant**; glow is path-found only (volume light sampling deferred). Witnesses AWAITING sweep: emit (closed form + equilibrium channel), emit-swap (estimator twin), emit-sat (ε/σ_a through the delta arm), emit-scatter (nee≡pt). Demo: glowblobs. **The mis/tally batch is DEFERRED** (owner, after a planning read — near-zero win for current scenes; re-triggers: nee-only fireflies or the spectral axis).

**Heterogeneous media are BUILT — GPU-UNSWEPT** (July 17 2026, `docs/impl-plan-heterogeneous-media.md`; design authority `docs/fable-heterogeneous-media.md` as amended at kickoff: clamp-in-the-lookup, the absorbing-only ratio arm, **transcribe-with-lottery** — Kutz 2017 Alg. 4 + history-aware avg probabilities transcribed from the fetched papers, deviations declared-and-inert only): `GlslExpression.params` (sliders in formulas → live uniforms), `MediumDescription.majorant`, the D1 clamp emitted INSIDE `scene_medium_properties`, the `delta_tracking` occupant (delta / ratio-absorb / ratio-shadow arms behind the unchanged seams), per-medium 2×2 dispatch (constant media byte-identical — gate held), `volumeSampling: 'delta-tracking'` live under pt/pt-nee (mis Validator-rejected until the tally batch; equiangular × heterogeneous rejected), `MAX_NULL_COLLISIONS` 64. Witnesses in the registry AWAITING the owner's sweep: **het-const** (F-HET-CONST estimator-swap twin — the sharpest gate), **het-slab** (linear chromatic σ(z) → the F-SLAB triple exactly), **clamp** (D1 as a twin equality + e⁻¹), **het-driven** ×2 (formula slider ≡ baked at two points). Gates are pre-calibration estimates. **The mis/tally batch is DEFERRED (see the emission paragraph above).**

**Meshes + instancing + TLAS are BUILT (Jul 19) & AUDIT-HARDENED (Jul 20 2026)** — third geometry class (OBJ triangle meshes, thin/single-material v0, ray-into-local, binned-SAH BLAS per mesh) + instancing (one prototype × N placements — mesh BLAS or s-scaled analytic — the driven wrapper looped over a placement texture) + per-batch TLAS (`buildBVHNodes` over instance world boxes; spheres 500 ~7×). Estimator axes `meshTraversal: brute|bvh`, `instanceAccel: linear|tlas` (registry ids, Validator-gatekept, defaults bvh/tlas). The Jul 20 audit batch set: **validation** (unbounded-prototype rejection — instance prototypes must declare `bounds()`; ONE `validateGeometryObject` for top-level objects AND instanced prototypes; the transmissive-on-thin warning as ONE structural rule over the thin set — dies per-kind as containment lands; traversal-enum + C5 inert rules), **witnesses** (mesh-instance-twin — the ÷s scale≠1 guard; bvh≡brute + tlas≡linear near-exact equality arms — identical-stream gates), **structure** (`components/accel/` carved as the substrate family; the data rail extracted; `sceneMeshes`/`sceneInstanceBatches` = the ONE ordinal truth for Planner + App, pack-dedup for shared prototypes), **doors** (the intersection registry opened; authored names flow into `mesh_<name>`/`instance_<name>` symbols). Numeric sweep owner-gated: mesh-furnace 0.4, mesh-quad-twin (+brute arm), instance-twin (+linear arm), mesh-instance-twin. Deferred: multi-material meshes (THE priority), dielectric/interior-media meshes (winding-number containment), mesh NEE lights, Stage B data-driven distinct objects, Stage C boxed-SDF leaves, SDF instancing.

**Instance clouds (`.inst` data files) are BUILT** (Aug 7 2026, `docs/fable-instance-clouds.md` — design + build same day; format spec/writer's guide for collaborators: `docs/fable-inst-format.md`): large external instance datasets (proven at 194k/289k spheres) enter as **render-ready binary columnar `.inst` files** (positions + optional sizes/LINEAR-colors/quat-orientations + 0–K NAMED f32 scalar columns + positions-only AABB + provenance; ~6× smaller than JSON, zero-parse) — science (radius laws, sRGB→linear) lives OFFLINE in UNTRACKED user-local converters (owner-pinned: the renderer knows ONE data format — external schemas never appear in tracked code; the repo ships only the encoder `tools/inst-format.mjs`, the ONE write-side layout truth, round-trip-gated against `src/authoring/loadInstances.ts`). `InstancedObject.placements` accepts a **packed struct-of-arrays form** (byte-equality-gated vs the Transform[] arm; Validator: s>0, unit quats, finite, per-batch nodes ceiling (DATA_TEX_WIDTH 4096 since Aug 7 — the 1.4M octic tripped the declared trigger; ceiling now ~4M/batch)); `instanceCloud(table, {shape, material, colorDrives, sizeScale, size/color hooks})` is the authoring sugar — **hooks are CPU-only at pack time (laws NEVER on the GPU: TLAS boxes are CPU-built from radii) and retune = repack + re-upload, never recompile**. Data scenes are ASYNC registry entries (`demos/dataScenes.ts`, thunk + entry-level name; registry-iterating tests skip them — coverage = the committed 500-pt fixture `tests/fixtures/cloud-500.inst` through glslang); exports stamp the file's provenance (`SceneDescription.provenance`). Gallery: `clebsch`/`croissant`/`steiner` (724k, no-colors arm)/`crixxi` (744k)/`octic` (1.4M) — `test-data/*.inst`, untracked; converter presets in the untracked `test-data/convert-pointset.mjs` (incl. coordinate scaling + the steiner log law over 9 height decades). SAH builder: typed-array flat core (Aug 8 — byte-identical to the old builder via the reference-twin gate, 2.8×; octic pack ~4s) + the pack in a Web Worker (App-side `utils/packWorker.ts`, sync fallback) — load no longer freezes the page. Deferred (§8): **'cube' shape** (box is DELIBERATELY SDF-only — params not closed under rotation; needs a per-context backend fact, owner discussion), drag-drop, in-app retune.

**The placement-fold batch is BUILT — GPU-UNSWEPT** (Aug 9 2026, `docs/impl-plan-placement-fold.md` stages 1–3; amends `fable-transforms` §5.2/§6.1): the fact conflation is dissolved — **`similarityClosed`** is a declared descriptor fact (a full similarity folds into the param rows; sphere/plane/quad/disk true, box/cylinder false — NOT derivable from kinds, equivariance-contract-tested BOTH directions), independent of `provides.analytic` (intersection method) and `bounds()` (instanceability). `foldAnalyticParameters` → **`foldPlacementIntoParameters`** (backend-neutral; throws on rotated non-closed). **Maximal constant folds on both backends** (`classifyPlacement` — ONE truth): closed shapes emit NO wrapper (bare `<type>_sdf`/params-folded analytic — every centered SDF object lost its `p = p − center` line); non-closed fold T,s and keep a pure-rotation residual on the rigid tier (the constant `s·d` similarity tier is dead); `keepsLocalFrame` gates the fold on BOTH backends (its third reader — the oriented SDF uv chart needs the frame). **The instancing params tier** (the §6.1 stride amendment): per-batch record layout decided at plan time in `dataTenantsOf` (never from data — retune can't change stride): analytic ∧ closed ∧ rows ≤ 4 floats ∧ ¬materialReadsUv → **1-texel folded-params records** (`Sphere(rec.xyz, rec.w)`, WORLD-space intersect, no conjugation/`placement_normal` — half the placement bandwidth for every sphere cloud, orientations absorbed exactly by the fold); else the 2-texel §6.1 frame record. `InstancedObject.placementRecord: 'frame'` is the coverage pin. Witnesses AWAITING sweep: **instance-params-twin ≡ instance-params-frame** (rotated scale-varied OFF-CENTER sphere batch, identical-stream) + the existing transform/instance twins re-gating the fold. **Stage 4 is BUILT — GPU-UNSWEPT** (Aug 10 2026, see the stage-4 paragraph below): box slab/cylinder interval analytic occupants; cube clouds open. Still deferred: disk 2-texel params arm, driven-placement CPU folds via the values rail, exact params-tier TLAS boxes. **The perf witness is BUILT** (same day): `npm run witness -- --perf` — REAL-GPU (never SwiftShader; renderer string printed, `--headed` fallback) report-only ms/frame rows (median of 3 `extendProduction` batches + readback barrier, never cached); fixture `perf-cloud`/`perf-cloud-frame` (tracked procedural 200k-sphere cloud, params vs frame arms). First numbers (M1 Pro @512²): params 30.5 vs frame 35.8 ms/frame (~15% — node fetches now dominate, the wide/compressed-BVH-node thesis). Future accel occupants add arms + gate here. **The accel research batch is BUILT & MEASURED** (Aug 9 2026, `docs/fable-accel-cwbvh.md` — three research agents: the Ylitie 2017 paper transcribed, Meister 2021 survey, WebGL2 spec/practice verified): batch A hygiene shipped (per-ray `1/rd` hoist through all 7 walks, Ize 2013 2-ulp `tf` guard in the slab test, `TLAS_LEAF_SIZE` knob — the leaf sweep REFUTED bigger sphere leaves: 2/4/8 → 31.3/32.9/38.1 ms, leaf 2 stays); **CWBVH (compressed 8-wide quantized BVH) fully built as the `instanceAccel: 'cwbvh'` occupant** — collapse DP (Eq. 5–8), conservative f64→quantized pack (floor/ceil, power-of-two scales, f32-decode-verified), the 7th INTEGER rail channel (`data_nodesq` RGBA32UI/usampler2D — bit-packed data never rides float textures), scalar octant-ordered walk (SWAR popc + float-exponent find-MSB — no ES 3.10 intrinsics), TS reference traversal ≡ brute force + round-trip/containment vitest gates, cwbvh-order records twin region (v1 pins: params-tier, no attrs/mesh protos — Validator-enforced). **GPU equality: cwbvh ≡ tlas Δmean 0.00%/rmse 0.00%. Perf VERDICT: NO-GO — 38.9 vs 32.9 ms/frame (0.85×) on M1 Pro/ANGLE Metal**: the scalar per-slot byte-decode ALU (what the paper's PRMT/SWAR made free) swamps the fetch savings; Meister §9's GPU skepticism vindicated for scalar WebGL2. The occupant stays maintained-but-non-default (equality witness + glslang keep it honest); the first WebGL2 CWBVH datum published either way. Re-open triggers in the doc. Two future accel sessions have STARTER BRIEFS (read at session top; briefs, not designs): `docs/fable-sdf-accel-starter.md` (boxed-SDF leaves — the only unindexed geometry class; interval-restricted marching) and `docs/fable-light-bvh-starter.md` (SAOH light tree for hundreds of small lights; bit-trail pmf).

**The light tree (many-lights selection) stage 1 is BUILT — GPU-UNSWEPT** (Aug 9 2026, design authority `docs/fable-light-bvh.md` — supersedes the starter; owner decisions: NO orientation cones in v1, TWO stages): NEE light selection is a carved registry axis **`estimator.lightSelection: 'power' | 'uniform' | 'bvh'`** (`LIGHT_SELECTIONS`, membership-only per the OBJECT_DISPATCHES precedent; power default byte-identical — snapshots held). The `bvh` occupant: **lights go TABLE-resident** (`components/lights/table.ts` = the row-layout truth: header kind-code texel + schema-row floats in ctor order; generated per-kind loaders `<kind>_light_row`) and selection is a **stochastic light-tree descent** with a **bit-trail pmf walk born adjacent** (same fetches, same importance call, same `p_l`/`1−p_l` expressions — the selectionExprs discipline transported); v1 importance is **NORMAL-FREE** `Φ/max(d², (diag/2)², ε)` (cones provably vacuous for sphere/point emitters; the horizon term needs a seam+PathState change — witness-gated follow-up; pbrt's d²-vs-length clamp transcribed in the SQUARED form), fresh RNG draw per level (pcg4d ⇒ no stratification argument; RTG's fp32-rescale warning voided). Builder `components/accel/light_tree/` (energy-weighted binned SAH = the no-cones SAOH degenerate; leaf = exactly 1 light, 2n−1 nodes, 2-texel `{min,Φ}{max,link}` nodes; 48-level trail cap via balanced-split fallback; coincident lights → power-proportional chains) + TS twins powering the vitest Σpmf=1/trail-replay gates. Rail: `lightTree` tenant (**`lightRosterOf(scene)` census = the ONE scene-side mirror of the Planner's three desugar routes**, Planner-asserted kind-for-kind + vitest-pinned values across all 131 registry scenes; new descriptor fact `treeBounds` — point/spot/sphere/quad/disk/softbeam have it), ledger stanza appended LAST (existing bases byte-stable), App packs table+tree+trails (rail upload now also runs for mesh-free light scenes). v1 pins (Validator, itemized): constant emission only, no equiangular, no directional/beam kinds (MESH kinds joined Aug 10 — the mesh-treeBounds batch below). Witnesses GPU-VERIFIED (owner sweep Aug 9, 5/5): **hundred-spheres** (100 sampleAsLight emitters under objectDispatch table) — nee power≡bvh Δ0.03% χ²0.78, **mis power≡bvh Δ0.04% χ²0.71 — THE trail-pmf gate**, and the win metric **σ/µ @192spp: bvh 2.89% vs power 4.31%** (~2.2× variance, and the bvh arms rendered ~1.8× faster under SwiftShader — the table-resident storage killing the 100-arm chains); two-light bvh arm ≡ power Δ0.01% χ²0.72 (n=2 delta). **Stage 2 (per-instance light identity) is BUILT — GPU-UNSWEPT** (same day): a light-eligible instanced batch (ONE predicate `batchLightEligible`: params-tier SPHERE prototype ∧ constant emission ∧ ¬sampleAsLight:false) contributes its instances as INDIVIDUAL tree lights — the GLOBAL light-index space `[0,R)` registry ∪ per-batch windows in RECORD order (= `Hit.element`); **the params placement record IS the sphere-light row** (no second table; batch Le baked in the arm; per-instance Φ = π4πr²L̄e from packed radii); **`light_of(int region, int element)`** globally (the one seam churn — snapshots re-goldened, audited to exactly that + the new entries); batch lights samplable ONLY under 'bvh' (path-found under 'power' — estimator-only, §11.2); tree builds after batch packs from the same records the arms read. **§7.1 per-instance emission is BUILT** (Aug 10): the old `attributes.emission` hard error is lifted for params-tier sphere batches — the tree's per-instance Φ IS the structure the deferral awaited; ONE storage truth: the minted AttributeValue row feeds the hit-side fill + the sampler arm + the pdf arm (same records texels, element-indexed) + pack-time Φ; `material_is_emissive` treats attr rows as may-emit; `.inst` LINEAR colors columns drive it directly — gallery **clebsch-glow** (own card: 194k individually-colored lights, white rationals + orange quadratics; `glowScale` dial in dataScenes.ts) + demo **embers**. Witnesses AWAITING sweep: **instance-lights ≡ instance-lights-ref** (batch ≡ 64 individual objects, + nee≡mis = the ELEMENT-trail gate), **glow-shell** (camera inside a 100-emitter shell — the near-field-clamp gate nee≡mis + σ/µ report vs pt); the light_of churn touches every samplable-emitter program, so the full sweep re-gates. Stage 3+ ledger (doc §7): cone texel, mesh rows, directional/beam outside stage, medium-vertex entry (mis/tally batch), refit for driven emission. Worker offload BUILT (Aug 10 — clebsch-glow fired the trigger): app/utils/lightTreePack.ts, packWorker pattern, inputs transferred, sync < 4096 leaves. **v1.5 (LightQuery + the horizon term) is BUILT — GPU-UNSWEPT** (Aug 10, doc §3.2): a CPU probe over the real trees measured **54–59% of selection mass wasted on below-horizon lights** (p90 86% on ember-rock surfaces) → witness-justified same-day build. **`LightQuery { p, n }`** (core structs; n=0 = no orientation) is pbrt's LightSampleContext transcribed as DESIGN: static techniques pass (mat, hit) through GENERATED constructors `light_query_surface/medium` (transport-emitted policy; `mat` in the signature ahead of need), seams are `lighting_sample(LightQuery, vec2)`/`lighting_pdf(LightQuery, …)` TOTAL across all programs, and **PathState.prev_query replaces prev_p** (mis-gated; the single-writer `kernel_record(s, pdf, LightQuery, delta)` stores the SAME constructor value the NEE site used — **stored-query replay**: the pmf sees byte-identical context forever, and future context growth churns nothing). Importance v1.5: **EXACT box-below-horizon cull** (sign-selected far corner vs the tangent plane — a declared improvement over pbrt's sphere cone, found by the half-space vitest: sphere culls left 52% dead-descent mass; the box cull is HEREDITARY ⇒ zero dead descents while any light is above) + the composed corner/center shaping min(1, max(cos_center, h/dmax)) — v1.5.1, no sphere anywhere: the sphere shaper saturated on straddling boxes and left diagonal-facing receivers unimproved (the owner-observed "diamond", probe-confirmed 4-fold anisotropy, now second-order; limb noise proxy 0.36–0.87 vs 1.45–1.96 normal-free). Bias-safe one-sided: transmissive models are pure-delta (never run NEE; prev_was_delta short-circuits mis) — **pinned by the lightQuery policy contract test** (`transmission ⇒ ¬nonDeltaLobes`; a future GGX-T fails it pointing at the constructor policy). vitest 1686 green; snapshot churn audited = the migration classes only.

**The accel review + consolidation batches are BUILT & GPU-SWEPT** (Aug 10 2026, the full-review session; vitest 1706 + glslang green; owner sweep Aug 10: accel-triple nee≡mis Δ0.01% χ²0.02 + pt anchor Δ0.11%/rmse 52.4% calibrated, mesh-light-twin power≡bvh Δ0.03% χ²0.53 + bvh nee≡mis Δ0.01%; stage-2/v1.5 witnesses verified same sweep — instance-lights twin Δ0.00% χ²0.00 both gates, glow-shell nee≡mis Δ0.00% + σ/µ 3.10% vs pt 18.01%, hundred-spheres σ/µ 2.22% vs power 4.31%; the 5 sweep failures are PRE-EXISTING — the 4 grin furnaces [the Jul 22 open walker decision] + softbeam-wall core [the Aug 9 beam batch, +3.3% shared by nee AND mis ⇒ a normalization bias in the sin²δ Le, not an estimator bug]): **correctness** — cwbvh × lightSelection 'bvh' × light-eligible batch Validator-rejected (the cwbvh leaf permutation breaks Hit.element→light_of identity — found by cross-referencing the review's reports), the 'bvh' inert warning now counts batch lights (clebsch-glow's shape warned falsely), witness **accel-triple** (mesh BLAS × instance TLAS × light tree in ONE program, mixed-kind tree leaves, nee≡mis χ² + pt RMSE tripwire pre-calibration). **Walk consolidation** — `bvhWalkLines` in accel/bvh/bvh.ts is THE one generated binary-walk skeleton (instance TLAS occupant + both scene-table walks — previously byte-identical copies), `BVH_TFAR_PAD` define single-sources the Ize pad (bvh.glsl + cwbvh walk + TS ref), mesh.glsl's leaf prologue is ONE `mesh_tri_fetch` + `mesh_side_range` (the containment walk's inline leaf absorbed; `mesh_any_bvh`'s unordered push declared deliberate). **Builder consolidation** — `buildBVHCore` (bvh.ts) is THE one binned-SAH recursion, parameterized by per-item weights (Σ1 exact ⇒ ray cost bit-identical — the bvhFlat byte gate held) + stop policy (alwaysSplit/depthCap/sorted-median fallback) + emit callbacks + threaded trail bits; **the light tree is now a feeder** (~30 lines of policy; inherits the O(bins) prefix/suffix sweep — its fork was accidentally O(bins²)); `runInWorker` (app/utils/worker.ts) is the one off-thread skeleton (instancePack gained the 4096 sync gate); `bvhNodeBound` single-sources 2N−1; AABB is ONE exported type (10 structural respellings replaced); pack.ts write/alloc twins unified. **Mesh lights under the tree (mesh treeBounds)** — `treeBounds` gained the `'data'` form (rail-resident geometry, box supplied by the App packer: BLAS root box under the constant placement); the roster's mesh entries carry REAL values (radiance + s²-folded area, vitest-pinned vs the Planner — exception deleted); the tree-regime mesh arms are the table row + per-light baked rail-base dispatch (sampler) and the identity-free area pdf + hit normal (pdf); **one mesh emitter no longer vetoes 'bvh' for the whole scene** (L3 passes via the fact; directional/beam stay ineligible). Witnesses AWAITING sweep: accel-triple (nee≡mis + pt anchor), mesh-light-twin keys 4/5 (power≡bvh + bvh nee≡mis — the one-leaf table-row gate).

**Placement-fold stage 4 + the SDF-accel design are DONE — stage 4 GPU-UNSWEPT** (Aug 10 2026, same session as the review batches): **`docs/fable-sdf-accel.md`** is the owner-approved boxed-SDF-leaves DESIGN (supersedes the starter; BUILD DEFERRED to the trigger — custom distance fields / many-SDF scenes; pinned: LEAF_SDF fourth leaf kind, per-TYPE interval-restricted leaf marchers, scene-TLAS leaf size 1 so the interval IS the node box, containment point-in-box early-out in-batch, the interval-end epsilon rule named, the declared-bounds/blends-share-a-leaf contract for custom fields; stage 4 ordered FIRST because it drains box/cylinder out of the SDF class). **Stage 4 (box/cylinder analytic occupants)**: `box_intersect` (slab, inside-test root selection — the sphere review-finding discipline) + `box_normal`, `cylinder_intersect` (slab ∩ tube INTERVAL form) + `cylinder_normal`, `provides.analytic: true` + `bounds()` on both descriptors — so box/cylinder objects now resolve ANALYTIC by default (backend pins keep marcher coverage), are instanceable (frame tier), and `instanceCloud` gained the **'cube' shape** (fable-instance-clouds §8 CLOSED; fixture-gated through glslang). Two new seams for the FIRST non-closed constant analytic shapes: the Planner's constant analytic route now goes through `classifyPlacement` (rotated box/cylinder = T,s folded + constant-quat rigid arm, the P1b emission shape; identity residual = bare folded arm), and the scene TABLE excludes rotated non-closed analytic (their folded record cannot exist — `foldPlacementIntoParameters` throws; the tabled form is fable-sdf-accel §2.1's deferred quat record). Snapshot churn audited = the backend-flip class (marcher blocks deleted from every all-analytic scene — cornell lost 163 lines). Witnesses AWAITING sweep: **solids-analytic ≡ solids-sdf** (rotated box/cylinder closed forms ≡ marcher, cross-backend rmse) + **cube-cloud ≡ cube-cloud-ref** (48-box frame-tier batch ≡ individual rigid-arm boxes) — plus conjugation/regions-transformed/driven-baked/cylinders re-gate the rotated arms. vitest 1723.

**Boxed-SDF leaves (Stage C) are BUILT — GPU-UNSWEPT** (Aug 10 2026, `docs/impl-plan-sdf-accel.md` T1–T5; design authority `docs/fable-sdf-accel.md`, owner-approved and built the same session): the SDF class joined the scene table as **`LEAF_SDF`** — interval-restricted per-leaf marching under `objectDispatch: 'table'`, the global min-march untouched as the `'unrolled'` reference (and genuinely the right regime below ~10 objects — the shared step loop is the small-N economy). T1: `bvh_aabb_hit_range` (the reserved entry/exit form) + the scene TLAS at **leaf size 1 unconditionally** ("node box = object box" is an invariant — the march interval IS the node box, zero record growth). T2: eligibility = SDF backend ∧ constant ∧ `bounds()` ∧ ¬keepsLocalFrame (ROTATION allowed, unlike the analytic arm) ∧ the record budget; records ride the analytic region/stride with per-(type,arm) header codes + a TEXEL-ALIGNED §6.1 rigid tail (`sdfRecordPack`/`sdfTailTexel` = the one layout truth); packed via `classifyPlacement`. T3: generated per-TYPE `march_leaf_<type>`/`_any` (conjugate ONCE by the tail, march `|<type>_sdf|` in `[lt0, lt1]` dilated by `march_epsilon(lt1)`, commit through `raymarch_commit` — the ONE hit body; per-leaf exhaustion inside = the grazing stall-commit, outside = miss-and-resume), the `bvhWalkLines` range form, `scene_march_bound` shrunk to the RESIDUAL subset (all-tabled scenes carry an empty bound). T4: region-keyed queries (normals/containment/interior/uv) route tabled owners through per-TYPE record fields `sdf_leaf_field_<type>` (prototyped in the dispatch, defined with the table; the conjugated field's gradient IS the world gradient) + the SDF-solids containment record loop (no box early-out — declared: primitive evals cost a box test; expression fields re-open it). Witnesses AWAITING sweep: **sdf-table-twin** (30 rotated pinned SDFs + a grazing ground slab, table ≡ unrolled identical-stream 0.002/0.01 — THE §3 epsilon-rule gate) + **perf-sdf-{8,32,128}** (`--perf` report-only: the crossover referee; no default change until measured). SDF instancing = the follow-up door (the frame wrapper + `march_leaf` as leaf body). vitest 1755.

**The SDF object contract is DESIGNED + BUILT — GPU-UNSWEPT** (Aug 10 2026 evening, `docs/fable-sdf-contract.md` — the design authority for how SDFs work; sits on the sdf-as-shape rebuild + the five-shape library, see memory): **an SDF object = ONE authored CANONICAL field + a declared-facts sheet; everything derivable is generated, every declaration is gated by sampling.** Occupants author `<type>_sdf` (origin-centred — the five marched shapes LOST their `center` rows; position/rotation/scale are placement's alone, via `classifyPlacement`'s new canonical arm: s folds through length rows, R+T ride ONE rigid residual) plus optional uv chart; **`<type>_sdf_intersect` + `<type>_sdf_normal` are GENERATED per marched type** (`emitSdfIntersect`/`emitSdfNormal` in geometry/index.ts — the 18 hand copies deleted, the epsilon/stall rules single-truth, the normal now the 4-tap tetrahedral gradient), exactly linked (analytic-only programs carry zero march code; the presentTypes bound-closure trimmed to interval callers). New descriptor facts: `stepBudget` (per-shape loop bound, default MAX_MARCH_STEPS) + `refine` (hit-refinement conservatism factor — see the hygiene note below; `lipschitz` was carved then DELETED Aug 11, zero occupants — safety factors live IN-FIELD where they can read params); `thickness` stays IN the field (pinned: `<type>_sdf` is the exact field of the object as declared). Cross-type `bounds()` DERIVED from `marchBound` (menger/apollonian/bottle/knob/torus restatements deleted). **B1 fixed a real silent-clipping bug**: `canonicalizePrimitiveParameters` is now THE resolve site, so `marchBound.values`/`bounds` receive RESOLVED values on the driven/retained paths too (previously a driven bottle with defaulted rows got NaN extents and vanished; `marchBound.test.ts` now feeds minimally-authored input so the class stays dead). vitest + glslang green; snapshot churn = the named classes; witness sweep OWNER-GATED (numbers move at epsilon scale: 6→4 tap). **The scene-local door (§5.2) is BUILT** (Aug 11 2026): **`defineSDF`** (`components/geometry/custom.ts`) — a bespoke field defined IN its scene file, one call (GLSL field + REQUIRED TS twin + declaration sheet), `local: true` descriptor, zero registry ceremony; definition-time gates (name/rows/symbols/bound; point rows rejected — canonical) + the **Validator twin-samples the declared bound over each authored object's RESOLVED values** (`geometry/boundCheck.ts` = the shared checker core with marchBound.test; a clipping bound = a compile error naming the object — proven by the shrunk-bound test). Same pass fixed a second resolve-contract violation: `validateValues` now receives resolved values (omitted optional rows no longer produce spurious 'undefined' errors). Demo **custom-fields** (gyroid lattice — conservative √6·k gradient-bound divisor, ball-clip = exact bound by construction; solid glass quartic tangle — f<0 genuine interior, Chebyshev-cell clip owns the bound so the `shape` dial roams): compiled, kitchen-sink + glslang covered (local fields ride automatically, constant+driven arms), link-map snapshot, headless-GPU render-verified. vitest 2013.

**The region→material decomposition is BUILT** (Aug 11 2026, `docs/impl-plan-region-materials.md` — plan + build same session): the last O(object-count) generated construct is dead — under TABLE dispatch `material_of` is ONE rail fetch (the `regionMaterials` tenant: ids 4/texel in `records`, ledger-appended LAST; scene-side mirror **`regionMaterialsOf(scene)`** in dataTenants.ts covering desugared hittable-light regions, Planner-ASSERTED id-for-id — the light-roster pattern) and `ior_of` decomposes to `ior_of_material(material_of(r), p)` (the material half STAYS generated — GRIN formulas/driven uniforms; sized by materials). `materials.regionLookup: 'baked' | 'data'` is the ProgramDescription decision, set with objectDispatch (hoisted to one truth); UNROLLED programs keep baked arms BYTE-FOR-BYTE (snapshot gate held — churn = the regionLookup field only). Pins preserved exactly: region −1 answers before any fetch; open-transmissive-mesh exclusions ride as explicit per-mesh arms. Bonus fix: the App rail-upload early-return now includes `sceneTable` (a tabled scene with no meshes/batches/tree previously skipped upload — latent). **Measured: knot 4515 → 1470 lines (material_of 3002 → 9)**, headless-GPU verified (tabled knot renders per-object materials through the rail). vitest 2017; witness sweep OWNER-GATED (sdf-table-twin/bazaar/accel-triple re-gate the twins).

**The SDF hygiene batch is BUILT** (Aug 11 2026, owner-ordered six-pack; record: memory `sdf-hygiene-batch`): (1) **`lipschitz` fact DELETED** (zero occupants; in-field safety factors + value/gradient authoring made it dead); (2) **`primitiveHitFill`** = THE one hit-fill for all SEVEN primitive-object arms (unrolled marched/analytic ×3, instanced params/frame tiers, both table leaves — audit D4 closed; the normalize rule settled ONCE: primitive normals are unit by contract + world maps are rotations ⇒ never re-normalize; mesh arms keep theirs, interpolated normals are genuinely non-unit); (3) **witness `field-glass`** (defineSDF tangle in real glass, X-GLASS pattern nee≡mis + pt tripwire — the door's numeric gate; the tangle definition MOVED to the witness fixture, demo imports it) + **`sdf-table + table` joined the generated-glsl byte snapshot** (first byte coverage of the table regime incl. the DATA-form material_of); (4) **epsilon-coupling test** (`epsilonCoupling.test.ts` — EPS_INTERFACE = 10× MARCH_EPSILON ∧ ≥ 2× the cap, parsed from the .glsl files: the derived-coupling rule enforceable); (5) **defineSDF twin OPTIONAL** (owner-decided: omit ⇒ the declared bound is TRUSTED, gate skipped — tested); (6) the **intersection refinement is the `refine: C` declared fact** (built same day: sign-only doubling-bracket sized by C + 8 bisections in the ONE generated loop — fixed the glass tangle's ring banding [accepted TRUE residual ≫ EPS_INTERFACE for conservative estimates], then scoped to declaration after always-on taxed the fractals; tangle re-authored VALUE/GRADIENT — the variety-port form, ~2× faster, `refine: 4`). vitest 2032.

**Still Euclidean-only** (equiangular NEE is delta-lights + nee only — area arms and placement-MIS in `impl-plan-equiangular.md`), no spherical-rectangle quad sampling / two-sided quads / `Value<T>` light params (deferred table in `impl-plan-area-lights.md`), no curved spaces (the `ambient_*` seam is ready but H³/Schwarzschild are unbuilt). Glass *shadow rays* remain opaque — a DECLARED truncation (`measurement.shadows: 'opaque-dielectrics'`). Don't describe deferred items as built. **Discuss loop/interface structure before implementing** (owner preference); don't mix refactors with feature work.

