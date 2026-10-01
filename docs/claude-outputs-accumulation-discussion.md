> **RECORD (2026-09-29).** This is the design discussion (Part 1 facts, Part 2 pieces,
> Part 3 reviews) that led to `claude-outputs-accumulation.md`, which is the one plan. Where
> the two differ, the plan wins. Do not implement from this file.

# Outputs and accumulation: how they work today (part 1: facts)

**Date:** 2026-09-29
**Status:** Part 1 of a design discussion. Facts only; nothing is proposed yet. It comes
before the OIDN work (`claude-oidn-test-plan.md`, on hold), because denoising guides are
extra per-pixel outputs, and the current output system has no clean place for them.

"Read" means read in the source; nothing here was measured.

## 1. The model

Each frame, every pixel j draws one camera sample and evaluates a random value `X_k`
(the path tracer's radiance estimate for that sample). The film keeps a per-pixel
record, which the fragment shader updates from the previous frame's record and `X_k`.
The accumulator decides what the record is:

| Accumulator | Record after k samples | Images per pixel |
|---|---|---|
| `average` | the mean `(1/k) Σ X_i` | 1 |
| `oneshot` | the latest `X_k` only | 1 |
| `variance` | the mean, plus the per-channel sample variance (Welford) | 2 |

The record lives in a ping-pong pair of float textures. With two images per pixel, both
are attachments of one framebuffer, so they swap together.

Denoising guides would be two more per-pixel quantities, the first-hit albedo and the
first-hit normal. Each would be averaged the same way as the color.

## 2. How it is wired today (read)

**The engine is generic.**
- Framebuffers, attachments (`'accumulation_previous:1'`), pass outputs and export
  targets are all plain data. They are parsed in `ResourceManager.ts:648-668` and
  `RenderExecutor.ts:445-455`, and read in `Engine.ts:354-401`.
- Nothing in the engine knows the word "variance".
- The locked contract's own type comments already show albedo at attachment 1 and normal
  at 2 (`compiler/types.ts:917-920, 1028-1036`).

**The compiler hard-codes the one extra output.** The fact "the `variance` accumulator
has a second output" has no single home. It is re-derived by testing the name in five
places:

| Where | What it decides |
|---|---|
| `compiler/plan/Planner.ts:695-716` | two formats for the accumulation buffer; the input `u_previousMoment` ← `accumulation_previous:1`; two outputs |
| `compiler/generate/Generator.ts:22` | re-tests the name and passes a boolean to the two builders below |
| `compiler/generate/ShaderBuilder.ts:131-141` | declares `layout(location = 1) out vec4 fragMoment` |
| `compiler/generate/PipelineBuilder.ts:74-86` | adds the export target `'variance'` at attachment 1 |
| `components/accumulator/index.ts:24` and `generate/features/accumulation.ts:24-27` | the registry fact `readsMoment`, and the sampler declaration it gates |

The GLSL output name (`fragMoment`), the sampler name (`u_previousMoment`), the attachment
index (1) and the export name (`'variance'`) each appear as separate literals in different
files.

**The app reads outputs by name.**
- `'hdr'` is the color, read by HDR export (`App.ts:769`) and tiled renders
  (`TiledRenderer.ts:114`).
- `'ldr'` is the tonemapped display (`App.ts:749`, `TiledRenderer.ts:119`).
- `'table'` is the environment bake (`App.ts:328`).
- "AOVs" are defined as every export except `hdr` and `ldr` (`App.ts:822`).

**Getting the variance means changing the accumulator.** The witness runner clones a
strategy and sets `accumulation = { type: 'variance' }` to read the variance
(`tools/witness.mjs:349`). So "which statistics are recorded" is tied to "how samples
are combined". A renderer can't be `oneshot` and have a variance, and couldn't be
`variance` and have guides.

## 3. How pbrt-v4 and Mitsuba 3 organize it (read)

**pbrt-v4** (`src/pbrt/film.h`, `film.cpp`, commit `b4ce968`):
- The **film** owns the per-pixel record, and the scene chooses the film type.
  - `RGBFilm` keeps the weighted RGB sum and the weight (`film.h:302-305`).
  - `GBufferFilm` also keeps albedo, position, the geometric and shading normals, uv, and
    a variance estimator for every pixel (`film.h:376-386`, `film.cpp:588-635`).
- Variance is simply part of that film's record, not a separate way of averaging.
- The integrator computes the first-hit surface data only when the film asks for it
  (`UsesVisibleSurface()`, `film.h:236, 346`; `integrators.cpp:688-708`).
- Every quantity in the record is accumulated with the same filter weight.

**Mitsuba 3** (`include/mitsuba/render/film.h`, `integrator.h`, commit `fd9c9ce`):
- The film's channels are its **base channels** (R, G, B, optionally A) followed by
  **the integrator's AOV names** (`film.h:28-33`).
- The integrator declares its extra channels as a list (`aov_names()`, `integrator.h:308`).
  The film sizes its storage from that list (`prepare(aovs)`, `film.h:86-106`).
- Storage and accumulation are generic over the list, so every channel gets the same
  filter (`film.h:35-37`: "Everything else … is implemented here").
- The `aov` integrator writes its channels next to a nested radiance integrator's, from the
  same camera ray (`integrator.h:394-399`; `src/integrators/aov.cpp`).

**What the two have in common.**
- The set of per-pixel channels is **one list**, declared by whoever produces the values:
  the film type in pbrt, the integrator in Mitsuba.
- Storage and averaging are written once, generically over that list.
- Neither ties "which extra quantities are recorded" to "how samples are averaged".

## 4. What this shows about our design (observations, not a proposal)

`estimator.accumulation.type` currently answers three different questions at once:
1. **How samples combine.** Mean, or latest sample only. This is a genuine pick-one
   choice.
2. **Which extra statistics are recorded.** For example, the variance of the samples.
   These are additions, and more than one could apply.
3. **Which extra quantities are recorded,** if guides were added there. For example,
   first-hit albedo and normal. These are also additions, and they come from the
   transport, not from the averaging.

Both references keep (2) and (3) as a list of channels, separate from (1).

In our code, (2) is expressed by picking a different answer to (1), and the list of extra
channels exists only as literals scattered over five files.

**Questions for part 2, to discuss before any options are written:**
- Who should declare an extra channel: the accumulator, the transport or measurement, or
  both, each contributing to one list?
- Is the variance a statistic that any accumulator could carry, rather than an
  accumulator of its own?
- Where do the names used by the app (`hdr`, `ldr`, `variance`, and future `albedo`,
  `normal`) come from, so there is one answer for each?

## 5. The rest of the output path today (read)

The owner asked to rethink the whole output side as one subsystem, in the "post-compiler"
mindset. These are the remaining parts.

**Every renderer gets the same pipeline template,** whatever its averaging mode
(`compiler/plan/Planner.ts:690-730`):
- **Buffers.**
  - the accumulation ping-pong pair, with 1 or 2 attachments;
  - `screen`;
  - an 8-bit `ldr` texture, allocated for every renderer but used only for PNG export.
- **Passes, every frame.**
  - pathtracer → `accumulation_current`;
  - display (`accumulation_current` → tonemap → `screen`);
  - then swap.
- **Cost.** The display pass runs after every sample, including during production renders.

**"The newest image" is stated three times, in two forms:**
- the display pass reads `accumulation_current`, before the swap (`Planner.ts:723-724`);
- the HDR and variance exports read `accumulation_previous`, after the swap
  (`PipelineBuilder.ts:74-86`, with a comment warning not to "fix" it);
- the LDR recipe points the display pass at `accumulation_previous`
  (`PipelineBuilder.ts:62-70`).

These are the same fact, "where the latest value of this picture lives", written for two
moments in the frame.

**LDR/PNG export re-runs the display pass** into the `ldr` texture on demand
(`engine/Engine.ts:213-235`, the `ldrRecipe`). The tonemap is written once, in GLSL, and
reused, which is good. But the recipe is a second, hand-written description of that pass.

**The display is assembled separately from the feature system**
(`compiler/generate/ShaderBuilder.ts:43-127`): exposure baked as a define, then the tone
curve, then sRGB and blue-noise dither. It can show only the color picture; its input is
fixed to `u_radiance`.

**Tiling is app orchestration over the same pipeline** (`app/TiledRenderer.ts`,
`ProductionOrchestrator.renderTiles`):
- the canvas is resized to each tile;
- the camera is given the full image's size and the tile's offset, through the builtins
  `engine.imageSize` and `engine.pixelOffset`;
- each tile is rendered to spp, and its `hdr` and `ldr` are read;
- the tiles are stitched on the CPU.

The compiler takes part only through those two builtins.

**Buffers belong to one renderer and are sized to the canvas.** Each renderer has its own
buffer set (`engine/ResourceManager.ts`, per-renderer resources), and `App.resize` sets
the canvas size, which is the render size. `clearAccumulation` clears every buffer of the
active renderer except `screen` (`ResourceManager.ts:318-329`).

**The environment bake is a separate one-off renderer.** It has its own fixed-size
`env_table` texture and a `'table'` export (`compiler/EnvironmentBake.ts:75-93`,
`App.ts:318-332`).

**The references don't cover display.** pbrt-v4 and Mitsuba 3 are offline renderers: the
film is "developed" into linear images and written to files. Tone mapping and on-screen
display are outside them. So for display and LDR there is no direct reference in their
source; this part is ours to design.

---

# Part 2: the direction, checked against the code

**The direction (agreed in outline with the owner, 2026-09-29).** A render keeps a list of
per-pixel pictures. The averaging mode decides how each picture is updated. The path loop
and the averaging mode can each add pictures to the list. Everything else is generated
from the list: the buffer layout, the shader outputs, the exports and the names.

Part 2 takes that direction one piece at a time.

## Piece A: how the extra values reach the averaging step

**Today** one value flows per sample. The accumulation `main()` calls
`Radiance L = transport_trace(ray)` and averages `L` (`average.glsl:16-17`). Nothing else
leaves the path loop. `transport_trace` is the only seam between them
(`transport/integrators/pt/pt.ts:83`).

Guides need a second flow: "what did the first real surface look like". Three ways were
considered.

1. **Return a bundle.** `transport_trace` hands back the color together with the extra
   values. This is pbrt-v4's form: `Li(…, VisibleSurface *visibleSurf)` fills the
   first-hit record through an out-parameter (`cpu/integrators.cpp:628-630, 688-708`).

   The data flow is visible in the function signature, and there is one way to hand values
   over.

   *Cost:* the seam's signature changes for every program. If the bundle is generated
   per render (holding only the fields this render keeps), every program's text changes
   once, even with no extras. Behavior should not change, but the digest can then only
   show that the text changed, not that the images are the same. So the proof would be a
   witness run, and possibly the full sweep, with the owner's permission.
2. **Shared variables.** The path loop writes the extra values into program-wide
   variables, and `main()` reads them after the call. There is a precedent: the RNG state
   is program-wide (`sampler/pcg4d/pcg4d.glsl:8-9`).

   The signatures stay as they are, and programs without extras stay byte-identical.

   *Cost:* hidden coupling. Nothing in the signature says the loop writes them, and this
   would be only the second use of such variables in the codebase.
3. **Re-trace the first hit in `main()`.** This is what Mitsuba's `aov` integrator does.
   It was rejected earlier because it copies the loop's rule for skipping invisible
   boundaries (against "one answer per fact") and ignores fog.

**Lean (for discussion, not decided): way 1.** It is the one explicit mechanism with no
hidden state, which matches the owner's priority on clean code with no second way of
doing things. Its cost is a one-time text change to every program, plus a witness run to
show that the images did not change.

## Piece B: the averaging step would be generated, not hand-written

**Today** each averaging mode is a hand-written `main()`: `average.glsl`, `variance.glsl`,
`oneshot.glsl`. All three repeat the same camera setup: the seed, the pixel jitter, the
lens sample, the wavelengths, the camera ray, the trace and the color conversion
(`average.glsl:7-17`, `variance.glsl:11-21`, `oneshot.glsl:13-24`). The only differences
are how the new sample is folded in, and which outputs are written.

**With a list of pictures,** `main()` could be generated:
- the camera setup, written once;
- then, for each picture in the list, one line that applies the averaging mode's update
  rule;
- each mode supplies only its rule: "running mean" for `average`, "take the new value"
  for `oneshot`.

This deletes the three copies of the setup.

**One wrinkle to settle.** The variance's update needs the color's previous mean and its
new mean (Welford, `variance.glsl:34-41`). So it is a picture whose rule reads another
picture, not a stand-alone one. With a stand-alone update rule, variance under `oneshot`
means nothing, and would have to be rejected or defined.

**Who uses these today (read).**
- `accumulation: { type: 'variance' }`: one witness strategy
  (`tests/witnesses/scenes/furnaceBox.ts:76`), and the witness runner's forced swap
  (`tools/witness.mjs:349`).
- `oneshot`: one demo (`demos/index.ts:62`).

So moving to the new form touches very little authored content.

*(Pieces still to write, after the owner has read A and B: where each picture is declared
in the strategy, and in which taxonomy section; how names and exports are generated; how
the app and the witness runner ask for pictures; and the migration and verification.)*

## Piece C: storage follows the averaging mode, and "the newest value" has one answer

**Owner decision (2026-09-29):** the screen updates every frame, as now. The display pass
is a few operations per pixel against the hundreds to thousands of a path sample
(expected). The lab's stats panel shows the measured split per pass (`App.getStats`,
`gpuTimings`).

**Storage.** Every picture in a render is updated by the render's one averaging mode, so
all pictures either need last frame's value or none do.
- **`average`:** a running mean reads last frame's value, so all the pictures are
  attachments of one ping-pong pair, swapped together after each frame. This is today's
  layout, generalized from 1–2 attachments to the length of the list.
- **`oneshot`:** it reads nothing, so the pictures get a single set of textures with no
  swap. The unused second buffer and the pointless swap disappear. The fact already
  exists as the registry's `readsPrevious` (`components/accumulator/index.ts`).

So the layout is decided once, from two facts: the list of pictures, and whether the mode
reads history. Nothing tests the mode by name.

**The newest value.** Today three places state separately where the newest image is
(section 5). With the layout derived, one function answers it for any picture at either
moment of the frame:
- **during the frame**, after the path-tracer pass and before the swap: `<buffer>_current`
  if the storage is a ping-pong pair, otherwise the single buffer. The display pass reads
  this.
- **after the frame,** after the swap: `<buffer>_previous` for a pair, otherwise the single
  buffer. Exports and the PNG path read this.

Every reader calls that one function. The "don't fix it" comment in `PipelineBuilder.ts`
then describes a derivation instead of warning about a hand-written rule.

**What stays the same.** Everything above can be expressed with the existing,
locked compiler↔engine types: framebuffers with several attachments, `double_buffer` or
`texture`, `postFrame.swaps`, `exportTargets`, `ldrRecipe`
(`docs/compiler-engine-contract.md`). The engine does not change.

## Piece D: one view step, for the screen and for PNGs, over any picture

**Today** the display pass tonemaps only the color picture onto the screen. A PNG
re-runs that pass into the 8-bit `ldr` texture through a hand-written recipe, which
points the pass at the post-swap buffer (section 5).

**The model.** A *view* turns one picture into display values. Each picture's declaration
says how it is viewed:
- **radiometric pictures (the color):** the strategy's view section, meaning exposure,
  tone curve, sRGB and dither. This is exactly today's display math, in
  `compiler/generate/ShaderBuilder.ts:66-127`.
- **data pictures,** with a fixed mapping stated by whoever declares the picture. For
  example:
  - albedo: clamp to [0, 1], then sRGB;
  - normal: `0.5·n + 0.5`;
  - variance: a scale chosen at view time (open).

**Switching the picture on screen is a runtime choice**, not a recompile. The display
program binds every picture's newest-value texture and chooses one by a uniform: a new
app-level parameter; its name and reserved prefix are for piece E. Changing it doesn't
touch the accumulation, so no reset is needed.

The display is its own small program, so the extra samplers don't compete with the
path tracer's sampler budget (`Generator.ts:26-38` counts per program).

**PNG export uses the same view step,** pointed at the after-frame location. The
`ldrRecipe` is then generated from piece C's function instead of being hand-written. By
default it saves the picture currently on screen.

The 8-bit texture is still allocated for every renderer: 1 byte per channel, a quarter of
one float picture. Allocating it only when needed would be an engine change, so it is
left as it is (a note, not a proposal).

**Tiling** keeps its current shape: resize to the tile, render, read, stitch. It reads
pictures by their names from the list instead of the fixed `hdr` and `ldr`. So a tiled
render can save any picture.

One caveat: `.hdr` files are RGBE, which cannot store negative values. A signed picture
such as the normal would have to be saved through its view mapping, or in a different
file format; this is open.

**Owner decision (2026-09-29).** Every picture has a named export, which can be read and
saved by that name. The save buttons save the picture currently on screen.

**Settled:**
- **Saving signed pictures.** The OIDN handoff happens in memory: float arrays for OIDN's
  API, or 8-bit for oidn-web's float-array path. It never needs a file. Saving signed
  pictures to disk is needed only for offline use. There the choice is PFM, which is
  OIDN's own example app's default input format (OIDN README v2.5.1, "oidnDenoise"), or
  EXR. That is deferred until it's wanted.

**Owner decision (2026-09-29):** the variance picture is viewed with the same exposure
and tonemap as the color. Nothing new is needed.

**Deferred.** Our `.hdr` save writes RGBE, which cannot store negatives. So saving a signed
picture (the normal) through the save button would lose its negative parts. Nobody needs
to save normals to disk now. It does not affect OIDN, which receives the normals in
memory.

## Piece E: where pictures are declared, and how names and exports follow

**Three kinds of picture, three owners.** Each is declared where the taxonomy says it
belongs.

| Kind | Example | Declared in | Why that section |
|---|---|---|---|
| the main picture | radiance | `measurement.response` (exists today, `compiler/types.ts:575`) | it is what the render measures |
| statistics of the main picture | variance | `estimator.accumulation`, as an option of the averaging mode (for example `{ type: 'average', variance: true }`), replacing today's separate `variance` type | it records how the estimate is doing and never changes the converged image. The accumulator README already calls it "instrumentation (extra outputs)". Valid only for a mode that keeps history. |
| first-hit features (AOVs) | albedo, normal | a list in the measurement section, for example `measurement.aovs: ['albedo', 'normal']` | they are different functionals of the same camera rays: taxonomy §9 ("a normal view … alternative measurements") and §10 (what accumulates is measurement) |

**AOVs become a component family.** There is one folder per AOV, `components/aov/<name>/`,
plus a registry line, like every other family. Each AOV's descriptor states:
- what it records at the first real surface: the albedo fact, or the shading normal;
- its view mapping (piece D).

The walk captures the listed AOVs at its first real hit (piece A), and the accumulation
averages them (piece B). Adding a new debug view later, such as depth or a region id,
means one more folder.

This largely covers the deferred "probe integrators" of `fable-measurement-bench.md`
§2.3, without a second integrator.

**One list.** The Planner turns those three declarations into one ordered list in the
`ProgramDescription`: the main picture first (attachment 0), then the statistics, then the
AOVs. Each entry has a name, an attachment index, a format and a view mapping. Everything
else is generated from this list:
- the buffer layout and swap (piece C);
- the shader outputs and the generated `main()` (piece B);
- the display's picture switch and the PNG path (piece D);
- one export per picture, named after it (below).

Nothing tests a mode or a picture by name.

**Names.** A picture's name is its registry key: `radiance`, `variance`, `albedo`,
`normal`. Each picture gets one export under that name. The 8-bit view output (for PNGs)
is not a picture: it is the result of viewing one.

**How the app asks for pictures.**
- The app gets the list from the compiled renderer. It builds the view switch from the
  list and saves the picture on screen by its name.
- `exportAllAOVs` saves the list, instead of today's rule "every export except `hdr` and
  `ldr`" (`App.ts:822`).
- The witness runner stops swapping the averaging mode (`tools/witness.mjs:349`). It turns
  on `variance: true` and reads the `variance` picture.
- Tiled renders read pictures by name.

**Open, for the owner:**
1. **Renaming `hdr` to `radiance`.** Today the color export is called `hdr`, which names a
   file format, not the content. Renaming it means one consistent vocabulary. It touches
   about 12 call sites, all of them read:
   - `App.ts:761, 769`;
   - `TiledRenderer.ts:86, 114`;
   - `tools/witness.mjs:380, 462, 602, 607`;
   - `tools/witness-spectral-lifecycle.mjs:22, 40`;
   - `tools/witness-spectral-live.mjs:22`.
2. **The app needs the picture list.** It needs each picture's name, and whether it is
   signed, to build the switch. The locked compiler↔engine contract has no field for it.
   The options are one small owner-approved extension, as `ldrRecipe` was (E5), or having
   the app read the export names. The names alone do not say how to view each picture.
3. **AOVs in spectral renders.** The albedo is a spectrum there, and needs converting to RGB
   for OIDN and the screen. Either support it now, or allow AOVs only in RGB renders at
   first.
4. **The view-switch parameter.** It needs a name, for example `view.picture`, and
   possibly a reserved prefix `view.` (today's reserved prefixes: `compiler/types.ts:803`).

**Owner decisions on piece E (2026-09-29):**
1. `hdr` is renamed to `radiance` at every call site.
2. The compiler↔engine contract is extended so the compiled renderer carries its picture
   list: names, and how to view each. This is an owner-approved extension, like `ldrRecipe`.
3. AOVs are RGB-only at first. **Recorded follow-up:** extend AOVs to spectral renders,
   which needs a spectrum → RGB conversion for albedo.
4. The view switch is a live parameter named `view.picture`. It is added to
   `RESERVED_PARAM_PATHS` (`compiler/types.ts:804`) as one reserved name, not a reserved
   `view.` prefix. It becomes a namespace only if a second display-only setting (such as
   a live exposure) is ever wanted.

## Piece F: the build, as small separately checked steps

Each step is its own commit, with its own check and CHANGELOG entry, and is revertible on
its own. Refactors come first and change nothing that is rendered.

| Step | What | How it is checked |
|---|---|---|
| 1 | **The extra-output list (refactor).** The accumulator descriptor declares its extra outputs as data. The Planner, Generator, ShaderBuilder and PipelineBuilder build the layout, outputs and exports from that list. One function answers "where is the newest value" (piece C). Variance becomes one entry; nothing tests the name `'variance'`. | `npm run digest` before and after is identical for every suite scene; the snapshot tests are unchanged |
| 2 | **Generated `main()` (piece B).** The three hand-written mains become one generated `main()` plus a per-mode update rule. | The shader text changes, so the digest can only show text. The images are checked with targeted witnesses for each mode (`average`, `variance` via the χ² runs, `oneshot`). A full sweep is optional, with the owner's permission. |
| 3 | **Storage follows the mode (piece C).** `oneshot` gets single buffers and no swap. Display, exports and the PNG recipe all use the newest-value function. | The digest changes only for `oneshot` programs (`cornell-oneshot`); a runtime check of a oneshot scene and of PNG and HDR export |
| 4 | **Variance becomes an option of `average` (piece E).** `{ type: 'average', variance: true }` replaces the `variance` type. Migrate `furnaceBox.ts:76` and the witness runner's swap (`tools/witness.mjs:349`). | Validator cases; the variance χ² witnesses still pass |
| 5 | **Rename `hdr` → `radiance`** at the ~12 call sites. | tsc; the witness runner and tiled render still read correctly (targeted runs) |
| 6 | **The picture list reaches the app (piece D and E).** The contract extension; the display program binds every picture and chooses one by `view.picture`; the save buttons save the picture on screen by its name; `exportAllAOVs` uses the list. | A contract test; a runtime check that switching the picture needs no recompile and no reset |
| 7 | **AOVs: albedo and normal.** Piece A's hand-off from the walk; the `components/aov/` family; the per-material albedo facts; RGB-only validation; a witness with exact region values (for example the red wall's albedo (0.65, 0.05, 0.05) and normal (1, 0, 0)). | Digest: programs without AOVs are unchanged if piece A is done the zero-change way (see open decision). The new witness passes. |
| 8 | **OIDN** (from `claude-oidn-test-plan.md`, updated). The page reads `radiance`, `albedo` and `normal` from **one** render, which can keep accumulating, and denoises through oidn-web. | As in that plan, minus everything about separate renderers |

**Open decision before step 7: piece A,** how the walk hands the first-hit values to
`main()`.
- **A bundle** is explicit, and it is pbrt's form. But it changes every program's text
  once.
- **Shared variables** leave programs without AOVs byte-identical. But the coupling is
  hidden.

The earlier lean was the bundle. Steps 1–6 do not depend on this.

**Next:** a fresh-agent review of the whole design (parts 1–2), then the owner's approval,
then step 1.

---

# Part 3: review findings (2026-09-29) and how each is resolved

Three fresh reviewers each read this whole document and the code: one on facts and
feasibility, one on architecture and the project's rules, one adversarial. Every finding
below that would change the design was checked in the code before it was accepted. Where
a finding was not re-checked, it is marked "reviewer, read". The citations in parts 1–2
were confirmed correct, with small wording fixes noted below.

## 3.1 Errors in the design (fixed; no decision needed)

1. **Switching the picture after a render has finished would not redraw the screen.**
   - The engine draws to the screen only as part of a full frame, which also adds a sample
     and swaps (`Engine.ts:202`). `renderLdr` draws only into `'ldr'` (`Engine.ts:227`).
   - **Fix:** a small engine change, the one piece C said wouldn't be needed. Generalize
     `renderLdr` into "run the view recipe into a target": `'screen'` to redraw, `'ldr'` to
     save a PNG. It is the same recipe, reading the after-frame buffers.
   - The engine stays blind: the recipe is still compiler data.
2. **The PNG stamp would record the wrong picture.**
   - `buildRenderStamp` records `imageParameters`, which are refreshed only on a reset
     (`App.ts:82, 883-884`), and switching the picture doesn't reset.
   - **Fix:** the stamp states explicitly which picture was saved.
3. **A fourth place forces the variance mode:** the lab page's witness-cache digest
   (`pages/scene-lab.ts:101`). There are also test sites: `validator.test.ts:142`, the
   `furnace + variance` snapshot case, and `colorContract.test.ts:42`.
   - Migrating without them would silently disable the witness cache.
   - **Fix:** the step includes all of them, and is checked with
     `git grep "type: 'variance'"` returning 0 hits.
4. **The Planner hands `oneshot` a previous-frame input it never reads**
   (`Planner.ts:711-713`). It is harmless only because oneshot declares no sampler for it.
   - **Fix:** the pass inputs come from the mode's `readsPrevious` fact.
5. **At most 4 pictures.**
   - WebGL2 guarantees only 4 draw buffers (reviewer, from the spec). Radiance, variance,
     albedo and normal fill that exactly. Today it is checked only at load time
     (`ResourceManager.ts:358-365`).
   - **Fix:** a compile-time error past 4, like the sampler budget. The doc's "a depth view
     is one more folder" holds only if something else is left out.
6. **The rename list for `hdr` → `radiance` was incomplete, and had a trap.**
   - **Missing:**
     - the definition itself (`PipelineBuilder.ts:79`);
     - three tests;
     - about 49 snapshot keys;
     - comments at `Engine.ts:353` and `types.ts:1068`;
     - about 17 docs, including CLAUDE.md.
   - **Trap:** `'hdr'` is also a file format and extension (`TiledRenderer.ts:32, 84`;
     `App.ts:770, 802`), and those must NOT be renamed.
7. **The on-screen picture needs a stable meaning.** An index means different pictures in
   different renderers, and in saved sessions.
   - **Fix:** the App holds the picture's *name*, and maps it to the current renderer's
     picture on every switch or restore, falling back to radiance.
   - The display selects with an if-chain over separate samplers, because GLSL ES 3.00
     allows only constant indices into sampler arrays (reviewer, from the spec).
8. **"Save all AOVs" over the whole list would save radiance twice** alongside auto-HDR
   export (`ProductionOrchestrator.ts:82-84`).
   - **Fix:** it saves every picture except the main one, and is renamed accordingly.
9. **`oneshot` has no witness at all.** The step that touches it needs an image check of
   its own (see 3.4).
10. **Small corrections.**
    - The variance picture holds the *population* variance M2/n (`variance.glsl:4`), not
      the sample variance.
    - §5's buffer clearing is `clearAllBuffers`, called by `Engine.clearAccumulation`.
    - The `'display-pass'` id is hard-coded in the recipe (`PipelineBuilder.ts:66`), where
      it should be derived from the pass role.
    - The unused `m` shortcut ("cycle display mode", `AppShortcutsExtension.ts:24`, no
      handler) becomes the picture switch.

## 3.2 Design refinements (recommended; the owner confirms)

1. **Use the existing display channel instead of `view.picture`.**
   - The `renderer.` prefix is already reserved as a "display-mode extension channel"
     (`compiler/types.ts:797-803`). It is one of the two prefixes that never reset
     accumulation (`app/events.ts:63-67`).
   - `view.picture` would reset unless it got special metadata, and it would be a second
     mechanism for the same job.
   - **Proposal:** `renderer.picture`. No new reserved name, and no reset by construction.
   - This replaces the earlier decision on `view.picture`.
2. **Extend the contract without repeating the names.**
   - `exportTargets` is already keyed by name. A separate picture list would state every
     name twice.
   - **Proposal:** each export target that is a picture carries its picture facts (how it
     is viewed, whether it is signed). "The pictures" are then the export targets with
     those facts, and the PNG output's name comes from the recipe.
   - It is still an owner-approved contract extension, only shaped so each name appears
     once.
3. **The boundary between AOVs and `measurement.response`,** stated as one rule so there
   aren't two homes for debug views:
   - quantities recorded at the first hit, alongside radiance, are **AOVs** (albedo,
     normal, later depth or region id);
   - quantities a whole walk scores *instead of* radiance are **response values** (the
     repair counter, bounce count, the pdf histogram of the bench doc).

   The comments on `response`, the integrators header, the components census and bench
   §2.3 are updated to say this.
4. **The main picture gets a registry row.** `response` is a literal union today, so
   radiance's facts (name, format, "viewed through the strategy's view section") would be
   hard-coded in the Planner. A one-row registry keeps "nothing tests a picture by name"
   true.
5. **Variance is checked by what the mode declares,** not by "keeps history".
   - Welford's form belongs to the equal-weight running mean. A future exponential mode
     would need a different variance.
   - So each averaging mode's descriptor lists the statistics it supports, and the
     Validator checks membership.
   - The strategy field stays `variance: true`. It would become a list only if a second
     statistic ever appears.
6. **Piece A is decided: the bundle, generated only when AOVs are listed.**
   - pbrt passes `nullptr` when the film doesn't want the first-hit record
     (`cpu/integrators.cpp:258-260`, read).
   - Our equivalent: `transport_trace` gets `out` parameters only in programs with AOVs.
   - Programs without AOVs stay byte-identical, and the handoff stays explicit in the
     signature. That removes the only argument for shared variables.
   - The capture draws no random numbers.
   - The architecture reviewer found that the trace-loop contract's own text favors an
     explicit data flow, and that it does not fix `transport_trace`'s signature.
7. **Defer the "oneshot gets single buffers" step.**
   - It serves one demo with no witness. It adds a second storage case to the newest-value
     function, and puts accumulation in a buffer type that only the environment bake uses.
     Its gain is one idle float buffer.
   - Keeping every mode as a ping-pong pair keeps "newest value" one rule. Finding 3.1.4
     still removes oneshot's dead input.
8. **A pinned-wording edit for the owner.** Taxonomy §2 and §10 say view acts on "the
   converged linear HDR quantity". With a picture switch and a denoiser that reads the
   albedo and normal, it should say "the converged pictures". A pinned doc changes only
   with the owner's approval.

## 3.3 The AOV measurement, defined (proposed defaults; the owner confirms)

The architecture reviewer noted that "the first real surface" was not yet a definition.
The proposal follows the walk's own rules and pbrt's. The capture happens where the walk
first evaluates a surface's material properties, after it has passed through null
interfaces.

| Case | Albedo | Normal |
|---|---|---|
| Surface hit | the material's albedo fact (the OIDN plan's table), clamped to [0, 1] | the shading normal `hit.frame.n`, flipped toward the ray (pbrt's `FaceForward`) |
| Miss (sky) | 0 | 0 |
| Emitter surface | its material's albedo (0 for visible area lights) | its normal |
| Mirror or glass | the material's own fact; no following the specular chain | its normal |
| First event is a medium scattering or a GRIN bend | 0 | 0 |

The last row is what pbrt does: a scattering event before any surface records no surface.

## 3.4 The build, re-ordered, and the vetting process

**Order.** The adversarial reviewer found that the original order built a facility and
then undid it. The rename must also come before names are generated. The new order:

1. Rename `hdr` → `radiance` (the list and the trap in 3.1.6).
2. Variance becomes `average`'s option (3.1.3, 3.2.5).
3. The Planner builds the one picture list, from the response registry, the variance
   option and the AOVs (an empty list for now). The layout, outputs, exports and recipe
   are generated from it, and the dead oneshot input goes (3.1.4).
4. A generated `main()`, with the update rules as static GLSL functions in each mode's
   folder ("math is static GLSL; policy and plumbing are generated").
5. The picture switch: the contract extension (3.2.2), `renderer.picture` (3.2.1), the
   view-recipe entry point (3.1.1), the stamp (3.1.2) and the `m` shortcut.
6. AOVs: albedo and normal (3.2.3, 3.2.6, 3.3).
7. OIDN.

Steps are reverted in reverse order; each builds on the ones before it.

**New checking tools and tests, written before the steps that need them:**
- **A frame A/B tool** (`frames record` / `frames compare`), the image-level twin of
  `npm run digest`.
  - It renders a fixed set at 64×64, 8 spp and a pinned salt on SwiftShader, and hashes
    every picture and the PNG bytes.
  - The set: an `average` scene, the variance furnace, `cornell-oneshot` at frame k, one
    spectral scene, one medium or GRIN scene, and one tiled render.
  - Witness renders are deterministic with a pinned salt (`tools/witness.mjs:65-72`), so
    bit-identical images are a meaningful check. That is expected, not guaranteed: if a
    step's comparison fails, stop and report the largest difference.
- **A table test of the planned pipeline** over {average, average + variance, oneshot} ×
  {no AOVs, albedo + normal}. It checks:
  - formats against the list;
  - outputs in list order;
  - each previous-frame input bound to its sampler;
  - each export's buffer and attachment;
  - the recipes re-pointing every display input to the after-frame buffer;
  - the `layout(location = k)` lines.
- **New rules in `validateCompiledRenderer`:**
  - an attachment beyond the buffer's formats;
  - `_previous` on a single buffer;
  - more than 4 attachments.
- **A `--show <scene>` mode for the digest.** A difference in the non-shader part is then
  read, not trusted. The builder also keeps today's JSON shapes where nothing changes, to
  avoid false alarms.

**The vetting process for each step:**
1. **Before any code:**
   - record `npm run digest -- before.json` and `frames record`;
   - write the step's prediction into the plan, for example "digest identical except X;
     frames bit-identical". A different result means stop and ask the owner.
2. **Every step runs:**
   - `npx tsc --noEmit`;
   - `npx vitest run` (glslang via Rosetta);
   - `digest --compare`;
   - `frames compare`.
3. **Targeted witnesses,** with the owner's OK and under `caffeinate -i`, after steps 2, 4
   and 6: furnace (both strategies), tiled `cornell-area`, one noise witness, one spectral
   witness, and the new AOV witness. There is no full sweep unless a frame comparison
   fails.
4. **Two fresh reviewers for each step's diff,** their reports shown to the owner beside
   it:
   - a *contract-breaker*, looking for wrong attachment indices, swap timing, names and
     after-frame reads;
   - a *one-answer and simplicity* reviewer, who greps for the literals `'variance'`,
     `'hdr'`, `fragMoment`, `u_previousMoment` and `_previous`, and flags anything beyond
     the plan.

   The GLSL steps (4 and 6) add a *numerics* reviewer.
5. **The CHANGELOG entry for each step** records:
   - the commands and their literal results;
   - each reviewer finding and its outcome;
   - anything expected but not measured.

## 3.5 Also noted

- **Memory.** Four float pictures in a ping-pong pair is 128 bytes per pixel: about 1 GB
  at 4K, against 265 MB today. That applies only with every picture on, and tiling bounds
  it. Half floats don't work for a running mean: they stop changing after a few thousand
  samples (expected).
- **The main program's samplers** grow by one per averaged picture: 8 + 3 = 11 of 16 at
  most today (measured by a reviewer).
- **The environment bake builds its pipeline by hand** (`EnvironmentBake.ts:73-94`), so it
  is unaffected. The new contract field must be optional.
- **Every step invalidates the whole witness cache,** because the cache key hashes all of
  `src/`.

## 3.6 Owner decisions on part 3 (2026-09-29)

1. **The picture switch is `renderer.picture`,** the existing no-reset display channel.
   This replaces `view.picture`.
2. **Picture facts ride on the export targets,** so each name appears once in the
   contract. Taken as recommended.
3. **How measurements are sorted into categories** is opened as its own question (section
   3.7), before the AOV-versus-response rule is written.
4. **The extras go through a bundle** (explicit `out` parameters on `transport_trace`),
   generated only when a program has extras. This is what pbrt does
   (`cpu/integrators.cpp:257-260`).
5. **Oneshot keeps its ping-pong pair,** and only its dead previous-frame input is
   removed. The single-buffer step is dropped.
6. **The AOV defaults in 3.3 are accepted for now.** **Recorded follow-up:** better guides
   for perfectly specular surfaces (mirrors, clear glass), following OIDN's
   recommendations. OIDN's README describes a "first diffuse or glossy (non-delta) hit"
   albedo and normal, and a Fresnel blend for delta dielectrics.
7. **The taxonomy wording is fixed.** §2 and §10 of `fable-strategy-taxonomy.md` now say
   "the converged pictures". The matching code comments (`compiler/types.ts:555, 708`) are
   updated in the step that adds the picture list.

## 3.7 Open: sorting measurements into categories

This is a structural question, to be researched and written up before the AOV-versus-
response rule is fixed.

**A starting sketch, not researched yet:**
- **Path measurements.** Integrals over whole paths:
  - radiance;
  - its decompositions (direct and indirect, per light, per lobe);
  - ambient occlusion;
  - path statistics such as bounce count or the repair counter.
- **First-hit features.** Properties of the first surface: albedo, normal, depth,
  position, uv, object or material id.
- **Estimator statistics.** Properties of the computation, not the scene: variance, sample
  count, cost per pixel.

**Research sources:** how pbrt-v4 (the film and its G-buffer), Mitsuba 3 (the `aov`
integrator and its other auxiliary integrators) and Blender Cycles (render passes, which
split data passes from light passes) sort the same things. Read from their source or
official documentation.

## 3.8 Saving, simplified (owner, 2026-09-29)

This replaces the saving design in piece D, in 3.1.2 and 3.1.8, and in §8 of the review
draft `claude-outputs-accumulation-revised.md`.

- **There is one save operation: save picture P in format F.**
  - P is a picture name from the render's list.
  - F is either a raw float file or a PNG of the view.
  - It reads the pixels and the stamp at the moment it is called, then writes the file.
  - It knows nothing about production renders, tiles or a "main" picture.
- **The Save button** saves a PNG of exactly what is on screen: the displayed picture
  through its view mapping. There is no button for raw float data.
- **Everything else declares its saves in code as a plain list.** A production render or a
  tiled render takes, for example, `save: [{ picture: 'radiance', format: 'hdr' }]` and
  saves exactly that list when it finishes. Nothing is saved that isn't listed. A raw
  radiance download is declared this way.
- **An impossible save is an error when it is declared,** for example `normal` as `.hdr`,
  which cannot store negatives. It never silently loses data.
- **Deleted:**
  - `exportAllAOVs` and its name rule (`App.ts:822`);
  - the three production auto-export switches (`autoExportPNG`, `autoExportHDR` and
    `autoExportAllAOVs`; `ProductionOrchestrator.ts:14-19, 82-85`). `autoSave` saves the
    session file, not a picture, and is out of scope;
  - the tiled renderer's own `'hdr' | 'png' | 'both'` option;
  - the "main picture versus extras" logic.

  The UI extensions that call these (ProductionPanel, RenderControls, AppShortcuts) pass
  a declared list instead.
- **Two of the review draft's owner questions are resolved by this rule:**
  - "Should auto-save always save radiance?" It saves what is declared.
  - "Should raw normal saving be unavailable?" It is a declaration error.
