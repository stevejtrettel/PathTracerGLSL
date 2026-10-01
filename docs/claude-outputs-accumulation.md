# Outputs and accumulation: the plan

**Date:** 2026-09-29
**Status:** Merged plan: the owner's decisions, plus three independent reviews and a
further review draft. Each build step still gets its own written plan and approval before
code. Nothing is implemented yet.

This file is the one plan. The discussion that led to it (the facts about today's system,
the design pieces and the reviews) is kept as a record in
`claude-outputs-accumulation-discussion.md`. The superseded review draft is
`claude-outputs-accumulation-revised.md`.

"Read" means read in the source, "measured" means run, and "expected" means a prediction.

## 1. The model

A render keeps a short, ordered **list of per-pixel pictures**. Each frame traces one
sample per pixel, and every picture in the list is updated by the render's **averaging
mode**. The compiler generates everything else from the list:
- the buffer layout;
- the shader outputs;
- the accumulation code;
- the exports;
- the display.

Nothing tests a mode or a picture by name.

**What can be a picture.** Each kind is declared where the strategy taxonomy puts it.

| Kind | First members | Declared in |
|---|---|---|
| the main picture | radiance | `measurement.response` (exists today) |
| estimator statistics | variance | `estimator.accumulation`, as an option of a mode that supports it: `{ type: 'average', variance: true }`. The mode's descriptor lists the statistics it supports. |
| first-hit AOVs | albedo, normal | `measurement.aovs: ['albedo', 'normal']`; one folder per AOV in a new `components/aov/` family |

The list is ordered: the main picture first, then statistics, then AOVs in authored order.
At most 4 pictures are allowed (WebGL2's guaranteed draw buffers). A fifth, a duplicate, an
unknown request or an unsupported statistic is a compile-time error.

**The working rule for categories.** A quantity's *meaning* is either a measurement of the
scene or a diagnostic of the computation. Its *role* is either the main picture or an
additional one. Keep the two questions apart.
- For this plan: radiance through `response`, first-hit guides through `aovs`, and variance
  under accumulation.
- Any future debug output gets a mathematical definition before it gets a place in the API.
- A broader classification of everything the renderer could measure is **deferred**. See
  pbrt-v4's film, Mitsuba 3's `aov`/`moment`/`depth` integrators and Cycles' passes for
  prior art.

**Taxonomy.** The view section acts on "the converged pictures". This wording was updated
in `fable-strategy-taxonomy.md` §2 and §10 with the owner's approval.

## 2. Accumulation

**Modes.** `average` keeps the equal-weight running mean, and supports `variance`.
`oneshot` keeps the latest sample.
- Every mode keeps today's ping-pong pair: storage is the same for all modes.
- `oneshot` loses the previous-frame input the Planner hands it and never reads
  (`compiler/plan/Planner.ts:711-713`).

**One generated `main()`** replaces the three hand-written ones
(`components/accumulator/{average,variance,oneshot}/*.glsl`), which repeat the same camera
setup.
- The camera setup and the radiance conversion are written once.
- Each picture is updated by a static GLSL rule that lives in its mode's folder: "math is
  static GLSL; policy and plumbing are generated".

What each picture's update reads:

| Picture | Update reads |
|---|---|
| radiance | the converted sample, and the previous mean |
| variance | the same sample, the previous mean, the new mean, and the previous variance (Welford) |
| albedo, normal | the captured value, and its previous mean |

- Keep today's arithmetic exactly: the `u_sampleCount == 0` branch, the draw order, and
  alpha written as 1.
- Variance stays `M2/n`. The witness runner divides it by `n − 1`
  (`tools/witness.mjs:263`).
- AOV values skip `color_to_pixel`. Misses contribute 0 and still count as samples.
  Averaged normals are not renormalized.

**One function answers where a picture's newest value is:**
- during the frame, `<buffer>_current`;
- after the swap, `<buffer>_previous`.

Display, redraw, exports and the PNG path all call it. Only inputs backed by pictures are
re-pointed; external inputs such as blue noise stay as they are.

## 3. Compiled contract and engine

- **Picture facts ride on the export targets** (an owner-approved extension of the locked
  contract), so every name appears once. Each picture's entry states its view mapping and
  whether it is signed.
  - Picture-bearing entries keep the planned order, and the first is the main picture.
  - The field is optional: the environment bake stays a renderer with a plain `table`
    export.
- **The view recipe** (today's `ldrRecipe`) is generated from the list and the
  newest-value function. It names its target explicitly; a framebuffer id is not assumed
  to equal an export name (`compiler/types.ts:1083`).
- **One small engine change: "run the view recipe into a target".** The target is
  `'screen'` for a redraw or `'ldr'` for a PNG. It traces no sample, swaps nothing, resets
  nothing, and doesn't touch the salt. The engine stays blind; the recipe is compiler data.
- **`validateCompiledRenderer` gains checks** for:
  - attachment indices within the buffer's formats;
  - valid `_current`/`_previous` suffixes;
  - the 4-picture cap;
  - recipes that reference existing passes and targets.

## 4. Viewing and the picture switch

- **Which picture is displayed is display state, not a render parameter.** The App holds it
  as a picture *name* and passes its index straight to the engine as `renderer.picture`, a
  reserved display prefix. It does not go through the parameter store.
  - There is precedent: the environment map's size and total weight bypass the store for
    the same reason (`app/App.ts:201-210`).
  - So it never resets accumulation, is never frozen by the production lock, and can be
    changed during a production render. Every image-affecting parameter stays locked.
  - On a renderer switch or session restore, the App maps the name to that renderer's
    picture, falling back to the main picture.
- **The display** binds every picture's texture and selects one by an if-chain on the
  index. GLSL ES 3.00 allows only constant indices into sampler arrays.
- **Switching redraws immediately** through the view-recipe call, including after a render
  has finished.
- **View mappings:**

  | Picture | Mapping |
  |---|---|
  | radiance, variance | the strategy's exposure and tonemap |
  | albedo | clamp, then sRGB |
  | normal | `0.5·n + 0.5` |

- The unused `m` shortcut (`app/extensions/AppShortcutsExtension.ts:24`) cycles the
  displayed picture.
- **For the step-5 plan to settle:** the display state's lifecycle.
  - Is the selected name saved in sessions, and where? The proposal is not at all, since it
    isn't a render setting, and a fresh page shows the main picture.
  - How do older sessions default?
  - How is the selection resolved after a renderer change?
  - Saving a different picture must leave the displayed one unchanged.

## 5. Saving

- **There is one save operation: save picture P in format F.** P is a picture name, and F
  is a raw float file or a PNG of the view. It reads the pixels and the stamp together at
  the moment it is called, before any asynchronous encoding. The stamp names the picture
  actually saved. The operation knows nothing about production, tiles or a main picture.
- **The Save button** saves a PNG of exactly what is on screen.
- **Everything else declares its saves in code** as a list, for example
  `save: [{ picture: 'radiance', format: 'hdr' }]`. A raw radiance download is declared
  this way. A tiled render fixes its list when the job starts.
- **An impossible save is an error at declaration,** for example `normal` as `.hdr`, which
  cannot store negatives. The whole list is validated before any rendering starts.
- **Which formats a picture can be saved in is declared data,** in each picture's entry. It
  is not derived from "signed". Spectral radiance is signed too, and its `.hdr` export is
  deliberately kept, so a signedness rule would forbid it. So radiance declares `.hdr` and
  PNG, and normal declares PNG only, until a signed float format exists.
- **Ordinary and tiled output share one capture-and-encode path.** A tiled render only
  stitches the tiles' captured pixels before encoding. The step-5 plan shows this
  explicitly.
- **Deleted:**
  - `exportAllAOVs` and its name rule;
  - the production switches `autoExportPNG`, `autoExportHDR` and `autoExportAllAOVs`;
  - the tiled renderer's own `'hdr' | 'png' | 'both'` option;
  - the main-versus-extras logic.

  The UI extensions pass declared lists instead. `autoSave`, which saves the session file,
  is untouched.
- **Rename the export `hdr` → `radiance`.** This covers export identity only: the
  definition (`PipelineBuilder.ts:79`), App, TiledRenderer, the witness tools, tests,
  snapshots, comments and docs. It does **not** cover file formats and extensions
  (`TiledRenderer.ts:32, 84`, `App.ts:770, 802`) or `ParameterMetadata.hdr`
  (`compiler/types.ts:818`).

## 6. AOVs: albedo and normal

- **RGB only at first.** Spectral renders reject AOVs in the Validator. **Recorded
  follow-up:** spectral AOVs, which need a spectrum → RGB conversion for albedo.
- **The hand-off.** `transport_trace` returns AOV values through explicit `out` parameters.
  These are generated only in programs that list AOVs, as pbrt passes `nullptr` when the
  film doesn't want them (`cpu/integrators.cpp:257-260`). Programs without AOVs stay
  byte-identical.
- **The capture** draws no random numbers, and changes no throughput, sampling or event
  decisions.
- **Albedo facts** are structured descriptor data: the name of the model's own reflectance
  row, or of a function its own `.glsl` defines.
  - lambert: `albedo`;
  - checker: `checker_albedo`;
  - mirror and ggx: `f0`;
  - dielectric and rough_dielectric: `transmittance`.

  Each is clamped to [0, 1]. The `material_albedo` dispatch is emitted only when an AOV
  needs it. Visible area lights keep their albedo of 0.
- **The normal** is the shading normal, faced toward the incoming ray with `ambient_dot`.
- **Outcomes before a guide is captured:**

  | Outcome | Guide |
  |---|---|
  | the first eligible surface, after null interfaces | material albedo and facing normal |
  | a miss | 0 |
  | a first medium scattering event | 0 |
  | a first GRIN traversal (counted as an event) | 0 |
  | absorption termination, or GRIN no-return | 0 |

  - Attenuation alone isn't termination.
  - Once a guide is captured, later events don't erase it.
  - Mirrors and glass use their own surface values. **Recorded follow-up:** better guides
    for perfectly specular surfaces, following OIDN's "first non-delta hit" and
    Fresnel-blend recommendations.
- **Gate before step 6 is coded.** The medium code signals termination with zero weight
  and no flag, and the walk then falls through to its straight-ray surface
  (`delta_tracking.glsl:97-102`, `grin/grin.glsl:160-165`, read). So "the walk evaluated a
  surface's material" does not mean "the path reached the surface". The step-6 plan must:
  - design how arrival is told apart from termination, including GRIN's near-wall case;
  - define what the guides mean in scattering media, and check that it holds under every
    estimator (the taxonomy's rule);
  - show that programs without AOVs stay byte-identical.

  If the existing sampling cannot give the intended meaning, stop and bring that conflict
  to the owner.

  This gate is about the guides' mathematical expectation and its correctness under every
  supported estimator. It is not satisfied by adding a termination flag alone.

## 7. OIDN, after the output system

- OIDN reads `radiance`, `albedo` and `normal` from **one** render at one sample count. The
  snapshot is taken synchronously, before denoising starts.
- Rendering may continue afterwards. The denoised result stays tied to its snapshot.
- Denoising is a view operation: it never writes into accumulation, and it reuses the view
  and save machinery.
- `claude-oidn-test-plan.md` (on hold) keeps the verified oidn-web facts: types, encodings,
  sizes, exposure, and the pinned model and checksum. Its separate-renderer workflow is
  superseded.

## 8. Deferred: the parameter system revamp

The parameter store answers "does this change the image?" in two inconsistent ways:
- **Reset:** the compiler's `triggersReset` metadata, falling back to a name-prefix guess
  (`app/App.ts:402-408`, `app/events.ts:63-67`).
- **Production lock:** a blanket lock on every change (`app/ParameterStore.ts:27-30`).

The clean version is one fact per parameter, "changes the render" or "display only", read
by both behaviors. It is its own design, and it gets a map of today's system first:
- the store;
- engine binding;
- compiler metadata;
- reserved names;
- the sliders panel;
- orbit controls;
- sessions;
- driven parameters;
- engine built-ins;
- the `engine.`/`env.` load-time values.

This plan doesn't depend on it: display state bypasses the store (section 4). It is the
next design topic after this plan is approved.

## 9. The build

Each step has its own written plan, the owner's approval, one commit, a dated CHANGELOG
entry, and a written prediction of what will change. Predictions are relative to the
previous step. A result outside the prediction means stop, report and discuss. Steps are
reverted in reverse order.

| Step | Work | Prediction |
|---|---|---|
| 0 | Comparison tools: the frame record/compare mode, and an inspectable digest (`claude-outputs-step0-plan.md`) | nothing that is rendered or compiled changes |
| 1 | Rename the export `hdr` → `radiance` | shaders and pixels unchanged; export names change |
| 2 | Variance becomes an option of `average`; migrate every site that forces it (`furnaceBox.ts:76`, `tools/witness.mjs:349`, `pages/scene-lab.ts:101`, `validator.test.ts:142`, the snapshot case, `colorContract.test.ts:42`) | the variance furnace's digest identical; `git grep "type: 'variance'"` → 0 |
| 3 | The Planner builds the picture list; layout, outputs, inputs, exports and recipe generated from it; `oneshot`'s dead input removed; the validator checks | declared structural changes only; pixels unchanged |
| 4 | Generated `main()` | shader text changes; every picture bit-identical |
| 5 | Viewing and saving: contract picture facts, the view-recipe engine call, the display switch, the save operation, stamps, UI lists, the `m` key | accumulated pictures unchanged; display and saving behavior as specified |
| 6 | AOVs (after the section 6 gate is planned) | programs without AOVs unchanged; radiance and variance identical with AOVs on; the new AOV witness passes |
| 7 | OIDN | raw pictures unchanged |

## 10. Verification and review, every step

- **Before:** record `npm run digest` (with the kept structure) and `frames record`.
- **Always:**
  - `npx tsc --noEmit`;
  - `npx vitest run` (glslang via Rosetta);
  - `digest --compare`;
  - `frames compare`.
- **Focused tests:**
  - a table test of the planned pipeline over {average, average + variance, oneshot} ×
    {no AOVs, each AOV, both}. It checks formats, output order, previous-frame inputs,
    exports, recipes and `layout(location)` lines.
  - the new validator rules;
  - first-sample initialization, and both ping-pong parities;
  - switching and saving on a stopped render, without changing accumulated state;
  - radiance and variance identical with AOVs on and off;
  - the AOV outcomes table, including medium termination, null boundaries, zero-bounce
    renders, emitters, mixed hits and misses, and smooth normals;
  - tiled consistency.
- **Witnesses:** targeted ones only, with the owner's OK and under `caffeinate -i`, after
  steps 2, 4 and 6. Never a full sweep unprompted.
- **Reviews:** two fresh reviewers per diff, shown to the owner beside it:
  - a *contract-breaker* (indices, swap timing, names, after-frame reads);
  - a *one-answer and simplicity* reviewer, who greps for the literals `'variance'`,
    `'hdr'`, `fragMoment`, `u_previousMoment` and `_previous`, and flags anything beyond
    the plan.

  Steps 4 and 6 add a *numerics* reviewer.
- **CHANGELOG:** literal command results, each reviewer finding and what was done about it,
  and anything expected but not measured.
