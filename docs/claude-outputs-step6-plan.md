# Step 6: albedo and normal pictures (outputs and accumulation plan)

**Date:** 2026-10-01
**Status:** Built 2026-10-01 (the owner chose definition C; two independent reviews folded in,
§6). Every prediction held; where the build differs from this text is in §7, "As built", and
the results are in the CHANGELOG.
Part of `claude-outputs-accumulation.md` §1, §2, §4, §6 and §9. Baselines at commit `43d5b2e`
(record fresh ones before coding: `npm run digest -- .digest/step6-before.json --keep …` and
`npm run frames -- record .digest/step6-before-frames`).

"Read" means read in the source, "measured" means run, and "expected" means a prediction.

## 1. The gate: what a guide means in media

The outputs plan (§6) requires this to be settled before step 6 is coded. A guide is a
per-pixel average, so a definition is really a statement of its **expected value**. That
value must not depend on the estimator (taxonomy: guides are measurements, declared in
`measurement.aovs`).

### Facts (read)

- **The walk** (`components/transport/integrators/pt/pt.ts`, `walk()`): each iteration
  samples the medium segment up to the next boundary, then handles the surface there.
  - Null interfaces pass through with `bounce--`, so a path stays at `bounce == 0` until its
    first non-null surface or medium event.
  - A medium scatter and a GRIN traversal both `continue`, so `bounce` becomes 1.
  - **One exception:** a GRIN segment no longer than one walker step is not bent. It is
    resolved on the straight segment and is not deflected; this is the declared
    sub-resolution truncation. It happens near a GRIN region's silhouette and through GRIN
    slabs thinner than one step. Each GRIN arm handles it its own way:
    - **absorbing** (`grin.glsl:193-200`): deterministic, weight `exp(−σ_a t)`;
    - **scattering** (`grin.glsl:313-329`): the analytic channel-MIS collision lottery over
      σ_a + σ_s. It either scatters (`bounce` becomes 1) or arrives with weight `tr/pdf`.

    An arriving path reaches the next surface still at `bounce == 0`.
  - A path that exceeds `maxNullCrossings` before its first surface ends (`pt.ts`, the
    null-interface branch), so its guide is 0.
- **The arms end paths with zero weight and no flag,** then the walk carries on to the
  surface its straight ray hit:
  - delta-tracking absorption sets `ms.weight = SPECTRUM_ZERO` (`delta_tracking.glsl`, the
    `xi_evt < pa` branch);
  - GRIN no-return does the same (`grin.glsl`, `grin_no_return`).

  So "the walk evaluated the first surface" does not mean "the path reached it". This is
  the gate's concern, confirmed.
- **What the path carries when it reaches the first surface:** the product of the arms'
  weights, and nothing else. Null crossings don't change the throughput, medium emission
  adds to radiance only, and equiangular NEE only reads the throughput
  (`techniques/equiangular/equiangular.glsl:55`). Russian roulette runs only after a surface or scatter event.
- **Every arm's arrival weight averages to the transmittance, in the ideal derivation.**
  This is the property that makes radiance unbiased, so the arms already guarantee it:
  - constant absorbing medium: deterministic Beer–Lambert, weight = T;
  - constant scattering (`analytic.glsl`): the path arrives with probability
    `pdf = avg_c e^{−σ_c t}` and weight `tr/pdf`, so E = `tr`;
  - expression media (ratio tracking, delta tracking): unbiased transmittance estimators.
    An absorbed path has weight 0.
- **The implemented arms carry two tiny numerical safeguards,** and C inherits them exactly
  as radiance does. Neither is a reason to change the guides:
  - **pdf floors:** `max(pdf, 1e-20)` in the analytic and GRIN-scatter arms (`analytic.glsl:33,
    40`; `grin.glsl:322, 327`), and `max(ps, 1e-20)` / `max(pn, 1e-20)` in delta tracking.
    Where a true pdf falls below 1e-20, the expectation is T·pdf/1e-20 instead of T. That
    happens only for paths whose probability is itself below 1e-20.
  - **The tracking cap** (`tracking_cap`, `delta_tracking.glsl:48`): a walk that runs out of
    iterations keeps its current weight. The probability of this is below 1e-10 by
    construction.

  "Exact" below means the ideal derivation. The implementation equals it up to these
  safeguards.
- **Which arm a medium uses is fixed by the scene and the measurement**, not the
  estimator:
  - constant media stay analytic whatever `volumeSampling` says;
  - `volumeSampling` must match the scene (the Validator: an error if tracking is needed and
    missing, a warning if it controls nothing);
  - `scattering: 'ignored'` is a measurement field.
- **pbrt-v4** (`VolPathIntegrator::Li`, read):
  - it captures the guide at the first surface with a BSDF, at `depth == 0`, skipping
    medium boundaries;
  - an absorbed path returns before the capture, and a scattered one `continue`s with
    `depth` incremented, so either leaves the guide at 0;
  - the captured value is not weighted.
- **Mitsuba 3** (`aov.cpp`, read): one `scene->ray_intersect` from the camera. It ignores
  media entirely (the medium argument is unused) and does not skip null boundaries.
- **OIDN** (README, read): it says nothing about media. Guides "should be as noise-free as
  possible", and albedo must be in [0, 1].

### Three possible definitions

| | A. pbrt, unweighted | B. Mitsuba, media ignored | C. weighted by the path |
|---|---|---|---|
| Captured sample | g(first surface) if the path arrives, else 0 | g(first non-null surface on the straight camera ray) | g(first surface) × the path's weight on arrival |
| Expected value in a medium | g × P(the arm lets the path arrive): T for a gray tracked medium, the channel average for the analytic arm, **1 for an absorbing one** | g, at full strength, through any fog | **g × T**, the transmittance along the camera ray, in every arm |
| Physical meaning | a property of the sampler, not the scene | the scene without its media | "what the camera sees of the surface through the medium" |
| Estimator-independent | today yes (the arm is fixed by the scene), but it changes if an arm's sampling changes | yes | yes, by the arms' own unbiasedness |
| Tells termination apart | needs a new flag from every arm | not applicable | **no flag needed**: a terminated path has weight 0 |
| GRIN | needs a rule | the straight ray is wrong behind a lens | a traversal is an event (`bounce` 1): 0; a sub-step segment flown straight gives g·T, as for any absorbing segment |
| Noise | Bernoulli noise in media | none | the arm's weight noise, in media only |
| New random numbers | none | none (but a second intersection loop) | none |

`g` is the albedo fact for the albedo guide and the facing shading normal for the normal
guide. Outside media all three agree exactly: the weight is exactly 1, so **C equals the
standard first-hit guide bit for bit** in media-free scenes.

### Decision: C (the owner's choice, 2026-10-01)

C is the only definition whose expected value is a physical quantity that holds in every
arm (ideally, and up to the safeguards above in the implementation). It needs no termination flag, because the zero weight already says the path ended. It
adds one capture in the walk and no random numbers. The approved outcomes table (§6) still
holds, with two refinements:
- these all give 0: a miss, a first medium event, a GRIN traversal, absorption, GRIN
  no-return, and exceeding `maxNullCrossings` (a row to add);
- a GRIN segment shorter than one walker step is not a traversal: the path flies straight
  through it and its guide is g·T. Its expectation is still exact; only where the
  sub-resolution rule applies depends on the step size, the same truncation radiance already
  makes.

**What C changes in the approved text:** §6 says "attenuation alone isn't termination". C
keeps that (an attenuated path is still captured), but the captured value is *multiplied
by* the attenuation. That is a change to reviewed work, so it needs the owner's approval and
an independent review before code. The evidence for it is the derivation above. The
measurement that would refute it is the witness in §4: guide = g·T, region by region, in
every arm.

Precisely:
- **albedo sample** = `clamp(albedo fact, 0, 1) ⊙ w`;
- **normal sample** = `n_facing · avg_c(w)`;
- `w` is the path throughput at the first non-null surface reached at `bounce == 0`, and
  both samples are 0 otherwise;
- **expected values:** `g ⊙ T` and `n · avg_c(T)`.

A single sample can exceed 1 (the analytic weight `tr/pdf` reaches 3 in a strongly
chromatic medium); the average converges to at most 1. The saved albedo `.hdr` holds the
average unclamped. The `'unit'` view clamps for display, and step 7 clamps at the OIDN
hand-off.

## 2. The change

**Declaration.**
- `measurement.aovs?: string[]`, listing names from the new `components/aov/` registry. It
  is declared in the measurement section.
- **The Validator rejects:**
  - an unknown name;
  - a duplicate;
  - `color: 'spectral'` (the plain message names the recorded follow-up);
  - (no picture-count rule: with the current registries the maximum is exactly 4, and the
    Generator already rejects a fifth.)
- When `aovs` is absent, `resolveMeasurement` leaves it out, so existing stamps and digests
  don't change.

**The `aov` family** (`components/aov/`, one folder per AOV, a README stating the contract):

| | albedo | normal |
|---|---|---|
| static GLSL | `vec3 albedo_aov(int mat, Hit hit, Direction wo, MaterialProperties props, Spectrum weight)` = `material_albedo(mat, hit, props) * weight` | `vec3 normal_aov(...)` (same signature) = the shading normal faced toward `wo` with `ambient_dot`, times `spectrum_average(weight)` |
| picture facts | `albedo`, `fragAlbedo`, `u_previousAlbedo`, `u_albedo`, view `'unit'`, formats `['hdr', 'png']` | `normal`, `fragNormal`, `u_previousNormal`, `u_normal`, view `'signed'`, formats `['png']` |
| requires | `material_albedo` | — |

- One signature for every AOV, so the walk calls each one the same way.
- **The normal is faced explicitly,** as the parent plan's §6 says ("faced toward the
  incoming ray with `ambient_dot`"), and as pbrt does (`FaceForward(si.shading.n, wo)`).
  `scene_intersect` flips the frame by the *geometric* normal (`intersection.ts:1720-1727`),
  so a mesh shading normal can still face away from `wo` near a silhouette.
- **Who emits it:** a new compiler feature, `features/aov.ts`, includes each listed AOV's
  `.glsl`, provides `<name>_aov`, and requires what the AOV's descriptor lists (albedo:
  `material_albedo`). The materials feature emits `material_albedo` when the plan says an
  AOV requires it: a planned fact taken from the registry, never a test of the name
  `'albedo'`. The forward-declared interface header already handles a `transport_trace`
  signature that varies by program (`features/index.ts:56-64`).

**Albedo facts** (as in the reviewed OIDN plan, "Albedo facts"):
- `MaterialModelDescriptor.albedo: { row } | { fn }` is a required field. A `{ fn }` names
  a function with the fixed signature `Spectrum fn(Hit hit, MaterialProperties mp)`, as
  `checker_albedo` already has (`checker.glsl:13`):
  - lambert `{ row: 'albedo' }`;
  - checker `{ fn: 'checker_albedo' }` (exists, `checker.glsl:13`);
  - mirror and ggx `{ row: 'f0' }`;
  - dielectric and rough_dielectric `{ row: 'transmittance' }`.

  All five rows were read in the descriptors.
- A generated `material_albedo` dispatch, emitted only when the albedo AOV requires it,
  clamps each value to [0, 1]. Visible area lights keep their albedo of 0.

**The walk** (`pt.ts`), only in programs that list AOVs:
- `transport_trace` gains one `out vec3` per AOV: `Radiance transport_trace(Ray ray, out vec3
  aov_albedo, out vec3 aov_normal)`. Each is set to 0 on entry.
- One capture, right after `props` is computed and before the budget `break`, so that
  `maxBounces: 0` still has guides: `if (bounce == 0) { aov_albedo = albedo_aov(mat, hit,
  wo, props, s.throughput); … }`.
- Programs without AOVs are generated exactly as today.

**Pictures and accumulation:**
- The picture list gains the AOVs after the statistic, in authored order, with role `'aov'`.
- Each AOV is updated by the mode's own rule: `average_update(previous, aov_x, n)`, or
  `oneshot_update(aov_x)`. The generated `main()` passes the AOV value, which skips
  `color_to_pixel`.
- Layout, outputs, inputs, exports, display bindings and the recipe already come from the
  list (step 3).

**Views:**
- `PictureView` becomes `'tonemap' | 'unit' | 'signed'`:
  - `'unit'` is a NaN/Inf guard, `clamp(x, 0, 1)`, then sRGB;
  - `'signed'` is a NaN/Inf guard that keeps negatives, then `clamp(0.5·x + 0.5, 0, 1)`,
    with no sRGB encoding.

  Neither applies exposure or the tone curve.
- **Each branch of the display `main()` computes its final color.** The tonemap branch is
  today's text exactly: `safe_color`, which clamps negatives, then exposure and the curve.
  Applied to a normal, that would erase every negative component, so the views can't share
  it. A program whose pictures all use `'tonemap'` keeps today's display shader unchanged.
- **Dither:** the unit and signed branches use the same switch as the tonemap path. They are
  dithered when the strategy's tonemap encodes to display bytes, and not under `'none'`, the
  raw probe path. No new sampler.
- Their GLSL is a new static file, `glsl/shared/views.glsl`, included in the display shader
  only when a picture uses one.

**Not touched:** the engine, the contract types (beyond `PictureView`'s new values), the App
(new pictures appear in `getPictures`, `m` and `save` automatically), any arm or technique
file, radiance and variance arithmetic.

## 3. Boundaries

- RGB only. Spectral AOVs, better guides for perfectly specular surfaces (first non-delta
  hit, Fresnel blend), and a signed float file format are recorded follow-ups, not part of
  this step.
- No OIDN code (step 7).
- No new random numbers, and no change to throughput, sampling or event decisions.
- One commit.

## 4. Verification, with the predictions written first

**Predictions:**
- **Programs without AOVs:** digest identical for every suite scene. No suite scene lists
  AOVs; the new descriptor field is data.
- **Frames:** 18 of 18 identical against the before-record.
- **Radiance and variance with AOVs on:** bit-identical to the same strategy without AOVs at
  the same salt. That is *expected*, not certain: the program text differs, so a compiler
  could schedule differently. **If they differ, stop and report the largest difference;
  don't chase it in code.**
- **Guides equal g·T in every arm** (definition C), within noise, and agree across
  estimators.

**Checks:**
1. `npx tsc --noEmit` clean; `npx vitest run` passes, including:
   - **the table test** (`tests/compiler/pictures.test.ts`) extended to {average,
     average + variance, oneshot} × {none, albedo, normal, both}: formats, outputs, inputs,
     the `main()` calls, exports with picture facts (albedo `['hdr','png']`, normal
     `['png']`), display bindings and views, the recipe, validity;
   - **Validator cases:** unknown, duplicate, spectral;
   - **the walk:** the capture sits before the budget `break`, and appears only when AOVs
     are listed;
   - **materials:** every registered material declares `albedo` (tsc forces it). Each
     `{ row }` names one of the model's Spectrum rows, and each `{ fn }` is defined in its
     `.glsl` (a test, since tsc only sees the field). The dispatch exists only in albedo
     programs.
   - **glslang compiles:** one small albedo-and-normal scene per registered material model,
     added to `tests/compiler/glsl-compile.test.ts`. Suite programs have no AOVs, and the
     table test uses the minimal scene, so without this the generated `material_albedo`
     dispatch would never be compiled for most models. One case keeps all four pictures.
2. **Digest** against the before-baseline: 268 of 268 identical.
3. **Frames** against the before-record: 18 of 18.
4. **A new witness, `guides`** (one fixture and one registry entry).

   **Runner changes:**
   - an optional `picture` field on `mean` checks (default `'radiance'`);
   - one `kind: 'identical'` check: a picture compared bit for bit between two strategies at
     the pinned salt;
   - the picture name goes into both frame caches, the in-memory key (`renderFrame`) and the
     disk key (`cacheKey`). Without it, an albedo check would replay the cached radiance.

   The χ² and rmse `equality` gates are not used on guides. AOVs have no variance picture,
   and the rmse statistic's luminance tone map has a pole at −1, near a normal picture's
   mean.

   **Geometry:**
   - an orthographic camera at normal incidence, so every pixel in a region has the same
     path length;
   - the expression medium varies only along the ray, σ(z), kept below its majorant;
   - the delta-tracking slab has σ_a > 0, so the absorption branch (the terminated-path
     case) runs;
   - the GRIN region is kept away from its silhouette;
   - one configuration keeps all four pictures (radiance, variance, albedo, normal), so the
     fourth attachment runs on the GPU for the first time.

   **The regions,** each with a value derived before the run. Tolerances are stated in the
   fixture: a few ulp where the value is constant (`average_update` is a `mix`, which need
   not return a constant exactly), and k·σ from the closed-form variance for the analytic
   arm (Var = tr_c²(1/pdf − 1) per sample).

   | Region | Expected albedo | Expected normal |
   |---|---|---|
   | lambert wall, direct view | g exactly | the wall normal exactly |
   | sky (miss) | 0 exactly | 0 exactly |
   | through a constant **absorbing** slab (null boundary) | g·e^{−σ_a d}, deterministic | n·avg(T) |
   | through a constant **chromatic scattering** slab (analytic arm) | g·T per channel, within noise | n·avg(T) |
   | through an **expression** chromatic scattering slab (delta tracking), T from the integral of the field | g·T per channel, within noise | n·avg(T) |
   | through a GRIN region | 0 exactly | 0 exactly |
   | behind clear glass (its own value) | the glass's `transmittance` | the glass normal |

   **Configurations for the gate's exceptional cases,** each with its expected value
   derived before the run:

   | Configuration | Expected albedo | Why it is here |
   |---|---|---|
   | through an **expression absorbing** slab (ratio tracking) | g·e^{−∫σ_a}, within noise | the absorbing tracking arm |
   | through a GRIN slab **thinner than one walker step**, absorbing arm | g·e^{−σ_a d}, deterministic | sub-step arrival, absorbing |
   | the same, scattering arm | g·T(σ_a + σ_s), within noise | sub-step arrival, collision lottery |
   | a GRIN field whose index exceeds `GRIN_CAPTURE` on the ray's line | 0 exactly | GRIN no-return: zero weight falling through to the surface |
   | nested null boundaries, more than `maxNullCrossings` before the surface | 0 exactly | budget exhaustion before the first surface |

   These are configurations of the same witness, not new infrastructure.

   Plus:
   - **guides identical across estimators:** pt, pt-nee and pt-mis (pt-mis only where the
     arms allow it) with `mediumLightSampling: 'vertex'`. They are *expected* bit-identical,
     because no estimator-specific random draw happens before the first `medium_sample`.
     Equiangular draws first (`equiangular.glsl:29, 38`), so with it the per-region `mean`
     checks are the gate;
   - `maxBounces: 0` still gives the guides;
   - `identical` checks on radiance and variance with AOVs on and off.

   Run only this witness: `npm run witness -- guides`.
5. **A one-off browser check:** a scene with both AOVs. `m` cycles radiance → variance →
   albedo → normal. `save('normal', 'png')` works and `save('normal', 'hdr')` is refused
   before anything renders. The sample count and salt are unchanged.
6. **Reviews:** an independent review of this plan before code (definition C above all), and
   of the diff after. The diff review includes a numerics pass on the capture and the g·T
   argument.

## 5. Owner decisions (2026-10-01)

1. **The guide definition (§1): C, weighted by the path.**
2. **Normal display:** `0.5·n + 0.5` shown without sRGB encoding (the usual look of a normal
   map), as the outputs plan's §4 table says.
3. **Reviews:** a fresh agent here and the owner's external reviewer, both on this plan before
   code.

## 6. Review record

**Fresh-agent review (2026-10-01).** It read every cited file, ran nothing, and found no
blocker. It confirmed:
- C's expectation in every arm, including delta tracking (Kutz Alg. 4), ratio tracking, the
  analytic floor, and `tracking_cap` (bias below 1e-10, shared with radiance);
- that arm choice never reads `volumeSampling`;
- that nothing but the arms touches the throughput before the first surface;
- pbrt-v4's and Mitsuba 3's behavior, and the albedo rows.

Its findings, each checked in the source and folded in above:
1. GRIN sub-step segments are flown straight (`grin.glsl:193-200`): §1 now states the
   exception, and the witness avoids silhouettes.
2. The shading normal is not guaranteed to face `wo`: `normal_aov` faces it with
   `ambient_dot`, as the parent plan says.
3. The missing `maxNullCrossings` row: added.
4. `safe_color` clamps negatives (`display.glsl:8`): each display branch now computes its
   own final color, and the dither under `'none'` is decided.
5. Who emits and provides the AOV GLSL: the new `features/aov.ts`, with `material_albedo`
   decided from the registry.
6. The Validator's picture-count rule could not fire: dropped.
7. Stamps would change if `aovs` defaulted to `[]`: it is omitted when absent.
8. The `{ fn }` signature: fixed.
9. Witness caches ignore the picture (`witness.mjs:96, 409`): the picture goes into both
   keys.
10. The χ² and rmse gates don't fit guides: replaced by `identical` across estimators and
    per-region means.
11. Region values need constant path length: orthographic camera, σ(z), σ_a > 0 in the
    tracked slab, stated tolerances.
12. A constant may not average exactly through `mix`: few-ulp tolerance.
13. Missing tests: rows and fns exist; one four-picture configuration.

**External review (the owner's reviewer, 2026-10-01).** It found the remaining design sound:
- the capture before the budget break;
- explicit facing of shading normals;
- descriptor-driven linkage;
- the existing accumulator rules;
- separate unit and signed views;
- the pbrt and Mitsuba citations.

Its four revisions, each checked in the source and folded in:
1. "Exactly unbiased" is the ideal derivation. The implementation inherits the pdf floors
   and the tracking cap: §1 now says so, with locations.
2. The GRIN sub-step case differs by arm. The scattering arm runs the analytic collision
   lottery over σ_a + σ_s (`grin.glsl:313-329`): §1 now describes both arms.
3. The witness omitted the gate's own exceptional cases: added ratio-tracked absorption,
   sub-step arrival (both GRIN arms), GRIN no-return via capture, and `maxNullCrossings`
   exhaustion.
4. The albedo dispatch would not be compiled for every model: one glslang case per material
   model.

## 7. As built (2026-10-01)

- **The witness is five scenes, not one.** A first `guides` scene held all eleven columns,
  four of them GRIN materials. With NEE it took over 9 minutes for one sample on SwiftShader
  (each GRIN material alone: 4–14 s per sample; no suite scene has more than one GRIN
  material). So `guides` keeps the media, null slabs, glass and sky, and each GRIN case is its
  own scene with one GRIN material (`guides-grin-traversal`, `-substep`, `-substep-scatter`,
  `-capture`). Every check of §4 is kept. `guides` uses `maxBounces: 1` and 32 spp: the guides
  are captured at bounce 0, and the radiance checks hold at any budget.
- **A defect found by the witness, outside this step:** a GRIN segment is attenuated over
  0.001 less length than it travels (a 0.015 slab reads 0.01400, the same slab as a plain
  medium 0.01498). `guides-grin-substep` and `-substep-scatter` keep their exact geometric
  expected values and fail by design until it is fixed (tests/witnesses/README.md).
- **`normal` requires no seam:** `ambient_dot(a, b, p)` is core GLSL, not a provided seam.
- **The canary:** AOV programs are skipped under the two-channel canary of the glslang suite
  (they are RGB only by declaration) and compile under RGB in their own cases.
- **The runner** reads every picture of a render at once and caches each under its own key;
  radiance keeps its old disk key.
