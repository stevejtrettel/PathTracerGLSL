# Step 7: OIDN denoising (outputs and accumulation plan)

**Date:** 2026-10-02
**Status:** Proposed, not built. Sorted into the core (§2) and safeguards for the owner to
decide one by one (§4). Tiling is delayed (§3). The verified facts and the review record are
in the appendices.
Part of `claude-outputs-accumulation.md` §7. Baselines at commit `8a101b6`:
`.digest/grinfixc.json` and `.digest/grinfix-commit-frames`.

"Read" means read in the source, "measured" means run, and "expected" means a prediction.

## 1. The model

Press `n`. The App copies the current radiance, albedo and normal pictures together, at one
sample count, and hands them to OIDN on the GPU. While that runs, the render keeps going. The
cleaned image comes back as one more picture, `denoised`:
- `m` cycles to it;
- `x` saves it;
- it is drawn with radiance's own exposure and tone curve.

Nothing is ever written into the render. The denoised picture goes away when the render it
came from is reset.

pbrt-v4 and Mitsuba 3 do the same thing outside a live App: a finished image plus its albedo
and normal goes in, and a new image comes out, with one brightness scale for the whole image
(Appendix A.5).

## 2. The core: what gets built

1. **The snapshot.** Read radiance, albedo, normal and the stamp in one step, before anything
   waits. Later samples can't leak in.
2. **The OIDN math** (`src/app/denoise/oidnMath.ts`, pure, copied from native OIDN's C++,
   each function citing its lines):
   - **one brightness scale** for the whole image (OIDN's auto-exposure);
   - **inputs:** color × scale, with NaN and negatives set to 0, through OIDN's PU curve;
     albedo clamped to [0, 1]; normal clamped to [−1, 1], then mapped to 0.5·n + 0.5;
   - **padding:** to a multiple of 16 pixels with zeros, which the network requires;
   - **output:** the curve undone, and the scale divided out.

   The stored pictures are never changed; only the copies handed over are clamped.
3. **Running the network** (`src/app/denoise/oidn.ts`, browser only):
   - one WebGPU device, asking for the GPU's full memory limits;
   - the model file fetched once;
   - oidn-web's lower-level network call on the whole image in one piece, then freed.
4. **The `denoised` picture.** The App keeps its pixels and the snapshot's stamp. It appears
   at the end of the picture list, so `m`, `x` and `app.save` work on it with no changes.
5. **Showing it.** The display program draws it in place of radiance, with radiance's tone
   mapping.
   - **Engine:** one setting that points the display's radiance input at the denoised
     texture, used in every frame. A PNG save passes its own inputs and never uses that
     setting, so a radiance PNG stays radiance.
   - **Contract:** one added field, `ExportTarget.picture.display`, telling the App which
     display input shows radiance. It needs the owner's OK, since the contract is locked.
6. **Dropping it** on a reset, a renderer switch or a resize: the two existing listeners, plus
   one line in `resize`. Without this the screen would keep showing an old or stretched image.
   Resets happen on every camera move, so this is normal use, not a rare case.
7. **The `n` key.** Production keeps blocking it, as it blocks most keys today.
8. **The model file** committed: `public/oidn/rt_hdr_alb_nrm.tza` (1.8 MB) and its Apache-2.0
   license.
9. **Dependencies:** `oidn-web` pinned at exactly 0.4.0; `@webgpu/types` (types only, one
   reference line).

**Why the lower-level network call** and not oidn-web's all-in-one tiler: in the released
0.4.0, the tiler
- computes a brightness scale per tile, which OIDN's manual says causes seams;
- cuts the guides to 8 bits;
- returns NaN images for non-square sizes;
- swallows errors.

The owner's other tracer moved to the lower-level call for the same reasons (Appendix A).

## 3. Delayed: tiling

Tiling comes with the production step: denoising big production renders and tiled jobs. Until
then, an image is denoised in one piece. That needs the GPU to allow large buffers. The base
model's widest layer at fp16 is 128 bytes per pixel, so a 1080p window needs about 265 MB.

- **Measured:** under WebGPU's guaranteed minimum limits, only about 704 × 704 fits.
- **Read:** the owner's other tracer ran 1080p in one piece on the owner's M2, per its
  commit message.
- **Unmeasured:** the limits of the owner's own Chrome. The headless test browser only has
  software WebGPU.

**Before relying on one piece:** denoise one window-sized frame in the owner's Chrome. A very
large image may still fail with a GPU error (see safeguard S1). That is the cost of delaying
tiling.

## 4. Safeguards: decide one by one

Each row guards a case that is rare or avoidable for a sole user. "Lean" is my suggestion.

| | Guards against | How likely | If skipped | Size | Lean |
|---|---|---|---|---|---|
| S1 | **The GPU rejecting the work** (an image too big, or out of memory). oidn-web then returns garbage silently, without an error (measured). An error check around the run turns that into a plain error. | Real for large images once tiling is delayed | A garbage image on screen, plus a warning in the console | ~4 lines | keep |
| S2 | **Pressing `n` twice quickly.** A one-line "already running" flag. | Likely now and then | Two runs overlap; with S1 their error checks can mix up | 1 line | keep if S1 is kept |
| S3 | **Moving the camera during the 1–2 s run.** A counter discards the late result. | Occasional | The old view's denoised image appears until `m` | ~3 lines | either |
| S4 | **The filename's sample count.** Use the snapshot's count, not the live one. | Whenever rendering continued after `n` | The filename shows the later count; the stamp inside is right | 1 line | keep |
| S5 | **A missing or wrong model file** (HTTP status, Vite's fallback page, checksum). | Very unlikely: the file is committed | A confusing parser error from oidn-web | ~10 lines | skip |
| S6 | **A lost GPU device** (driver reset). Make a new device on the next run. | Rare | Denoising fails until the page is reloaded | ~3 lines | skip |
| S7 | **Context loss and a second scene load** dropping the image. A normal context restore is already covered: it pauses, then resets. | Rare | An error after a failed restore, which needs a reload anyway | ~6 lines | skip |
| S8 | **GPU memory** of a dropped image: free its texture. | Always, but small | One image's worth of GPU memory is kept until the next denoise | ~5 lines | skip |
| S9 | **Custom refusal messages** (a renderer without guides, 0 samples, a tiled job). A renderer without albedo already throws "Export target 'albedo' not defined… Available: …"; 0 samples gives black; tiled jobs and production block `n` already. | Rare | Natural errors instead of custom ones | ~10 lines | skip |
| S10 | **A production save list naming `denoised`.** A separate picture list for production. | Only by typing it | An error when the production finishes | a second list in the App | skip |

## 5. Checks

**Predictions** (against the baselines):
- **Digest:** every shader is identical; every renderer structure differs only by the new
  `display` field.
- **Frames:** 18 of 18 identical.
- **Snapshots:** the GLSL snapshot changes only by `display` fields.
- **The table test** (`tests/compiler/pictures.test.ts`) gains `display` in its expected
  export targets.

**Tests (vitest):**
- **The copied math, with hand-worked values.** It catches a missing clamp, remap or
  sanitize, and swapped channels. These cases:
  - normal (1, 0, −1) → (1, 0.5, 0);
  - albedo (1.3, −0.1, NaN) → (1, 0, 0);
  - color NaN → 0;
  - the curve's pieces meet, and its inverse undoes it;
  - an image half black and half L gets scale 0.18/L (OIDN's rule, which skips black
    regions).
- **A fake network that echoes one input channel back.** On a lopsided image, the output must
  equal that channel decoded at every pixel. It catches flipped or shifted pixels and swapped
  channels.
- **The App, with fakes:**
  - the snapshot is read before the first wait;
  - with `denoised` on screen, a radiance PNG still draws radiance.
- `npx tsc --noEmit`; `npx vitest run`.

**On the GPU:** one scripted run in the headless browser, with `--enable-unsafe-webgpu`
(software WebGPU), under `caffeinate -i`. Each sample is timed first. It checks:
- a flat image comes back flat (measured today: within 0.2%);
- the raw pictures are unchanged by a denoise;
- radiance's own floats drawn as `denoised` give a byte-identical image;
- a reset drops it.

The script is a one-off, not committed; its results go in the CHANGELOG. Then one denoise in
the owner's Chrome at window size (§3).

No witnesses: nothing about sampling, transport or accumulation changes.

## 6. Not in step 7

- tiling and production denoising (§3);
- color-only denoising for renderers without guides;
- OIDN's clean-guide models;
- better specular guides;
- spectral;
- a panel button.

One commit.

---

## Appendix A: facts (re-verified 2026-10-01)

### A.1 oidn-web 0.4.0

The six cited files are byte-identical to tag `v0.4.0` = `ab265fc` (measured by diff).

| Fact | Evidence |
|---|---|
| **The release.** 0.4.0 is still the latest release (npm, 2026-08-20). `main` is 15 commits ahead (`a1cee63`, 2026-09-24) and unreleased, with a breaking device API, an error callback, `wholeImage` and edge padding. | `npm view` (measured); `git log` (read) |
| **The tiler's color and guides.** `tileExecute` takes float color, and guides as 8-bit `ImageData` divided by 255. It never maps normals to 0.5n + 0.5. | `UNet.ts:30-40, 299-315, 506-516`; `process.ts:303-306` |
| **Exposure.** The tiler computes a separate exposure for each tile, by its own rule: log2(L + 1e-4) over every pixel, black ones included. | `UNet.ts:416-428`; `process.ts:51-76` |
| **Sizes.** Only square sizes that are multiples of 16 work: tiles are forced square, and reads past the image give NaN. | `UNet.ts:243-249, 320-340, 397-417` |
| **Errors.** The tiler has no error callback: a failure is an unhandled rejection, and `done` never fires. | `UNet.ts:596-687`; `tileScheduler.ts:129-138` |
| **Loading.** Loading from a URL skips the HTTP status check. | `main.ts:91-101` |
| **WebGPU** is required. oidn-web asks for the adapter's largest limits. | `backend.ts:1-41` |
| **Node** cannot import oidn-web: its imports have no file extensions (measured). | `node -e "import('oidn-web')"` |
| **`executeCPU(input, w, h)`** (`NativeUNetExecutor`, public): it takes 9 interleaved channels per pixel (color, albedo, normal), already encoded, and returns encoded RGB. Sizes must be multiples of 16. Pipelines are cached per device; `dispose()` frees the buffers. | `nativeUNet.ts:30-39, 1381-1408, 1674-1689, 2139-2255` |
| **`executeCPU`'s errors.** Only a lost device rejects it. A GPU validation or out-of-memory error returns finite garbage (measured, A.4). | `nativeUNet.ts:2214-2216` |
| **The model.** `rt_hdr_alb_nrm.tza` is 1,841,160 bytes, sha256 `e586ef2f…f959e1a`, Apache-2.0, with receptive field 174. | LFS pointer (read); hash (measured) |

### A.2 Native OIDN (v2.5.1, `6602ee2`): what we copy

- **Input** (`devices/cpu/cpu_input_process.isph:31-75`):
  - color: × scale, NaN → 0, clamped to [0, FLT_MAX], PU curve × normScale;
  - albedo: NaN → 0, clamped to [0, 1];
  - normal: NaN → 0, clamped to [−1, 1], × 0.5 + 0.5;
  - the order is color, albedo, normal. Training does the same (`training/dataset.py:125-138`).
- **Normals** need not be unit length (`README.md:1715`). Training flips images at random
  (`dataset.py:427-436`), so bottom-first rows are fine.
- **The PU curve:** constants at `core/color.h:77-87` (equal to oidn-web's); forward and
  inverse at `color.h:89-107`; normScale = 1/PU(65504) (`color.cpp:13-14`).
- **Output** (`cpu_output_process.isph:40-66`): NaN → 0, clamped to ≥ 0, PU inverse, × 1/scale.
- **Auto-exposure** (`core/autoexposure.h:16-30`, `cpu_autoexposure.cpp:40-64`): bins of at
  most 16 × 16; the bin's mean luminance 0.212671 R + 0.715160 G + 0.072169 B; only bins
  with L > 1e-8 count; scale = 0.18 / 2^(mean log2 L), or 1. It is computed once per image.
- **Tiling** (later, §3): overlap 96 for this model. When tiling HDR by hand, one scale must
  be used for the whole image, "to avoid seam artifacts" (`README.md:1724`). The loop is at
  `unet_filter.cpp:221-251, 309-339`.
- **The widest full-resolution layer** has 64 channels (`training/model.py:83`).

### A.3 Our code (read)

- **Reading pictures.** `App.readExport` reads a float picture synchronously, bottom row first
  (`App.ts:772`). `capture`/`saveAll` read every picture before any await (`App.ts:783-816`).
  The filename takes the live sample count (`App.ts:863`).
- **Drawing pictures.**
  - The display program samples `texture(<sampler>, gl_FragCoord.xy / u_resolution)`
    (`ShaderBuilder.ts:136, 165`), and every picture has its own sampler.
  - The contract's picture facts carry only `view` and `formats` (`compiler/types.ts:1064`).
  - `Engine.renderView` re-runs the display with one-draw parameter overrides
    (`Engine.ts:214-230`). PNG saves use it (`App.ts:786`).
- **Textures.** `Engine.registerDataTexture` makes an RGBA32F NEAREST texture bound by
  `extern:<name>` (`Engine.ts:438-441`). A missing name is a hard error
  (`RenderExecutor.ts:370-400`).
- **Where the accumulation is cleared:** a reset (event, `RenderCoordinator.ts:138-143`; a
  reset while stopped waits for the next start, `:150-156`); a renderer switch (event,
  `RendererManager.ts:248-251, 278-283`); `App.resize` (no event, `App.ts:713-720`). A context
  restore pauses, then resets (`App.ts:259-290`).
- **Keys.** The production lock lets only Escape, `\`, `m`, `M` through
  (`AppShortcutsExtension.ts:67`). `n` is unbound.

### A.4 Measured on the test browser (2026-10-01)

Headless Chromium 149 (Playwright):
- **WebGPU** needs `--enable-unsafe-webgpu`, and then gives a software (SwiftShader) adapter:
  fp32, 1 GiB limits. It never reaches the Mac's GPU.
- **Speed:** a one-time setup of 11.5 s; then about 16 µs per pixel (128² in 1.0 s, 256² in
  4.0 s).
- **Deterministic:** the same input gives bit-identical output.
- **Flat images:** a flat image comes back within 0.2% away from the border.
- **Default limits:** 704² runs; 1024² fails GPU validation, yet `executeCPU` returns finite
  numbers without an error.

### A.5 Elsewhere (read)

- **pbrt-v4.** `imgtool denoise-optix` (`src/pbrt/cmd/imgtool.cpp:2233-2345`) reads a saved
  image with albedo and normal channels and writes a new one, with one intensity for the
  whole image (`gpu/optix/denoiser.cpp:103-115`).
- **Mitsuba 3.** `OptixDenoiser` (`include/mitsuba/render/optixdenoiser.h:54-161`) returns a
  new image, with one intensity (`src/render/optixdenoiser.cpp:97-98`).
- **The owner's other tracer** (`~/Code/PathTracer`, commits `f2f57eb`, `0c34b3a`, plus later
  uncommitted work; read, not re-measured; code not copied):
  - it uses oidn-web's lower-level call with its own tile loop and one scale for the whole
    image;
  - fixed large tiles were faster;
  - it ran 1080p in one piece on an M2;
  - memory is about 300 bytes per pixel, and it frees the network after each run.

## Appendix B: review record

A fresh-agent review of the earlier, fuller draft (2026-10-01) made 18 findings. Each was
checked in the source, or measured where marked. This version keeps them as follows.

- **In the core:**
  - the blocker: a PNG save must not use the on-screen setting;
  - the snapshot read before any wait;
  - dropping the image on reset, switch and resize;
  - the contract field, or deriving it from the view recipe instead (rejected: two fields
    agreeing by construction);
  - the `display` change to `pictures.test.ts`;
  - the fake-network test;
  - `@webgpu/types` through a reference line;
  - the stamp doc wording;
  - the corrected `color.h` lines;
  - pbrt-v4 and Mitsuba 3 read.
- **Moved to §4 for the owner to decide:**
  - the GPU error check (S1, measured);
  - the in-flight discard (S3);
  - the filename count (S4);
  - context loss and a second scene load (S7);
  - freeing the texture (S8);
  - `n` during tiled jobs (now blocked by the lock, S9);
  - the separate picture list (S10).
- **Delayed with tiling (§3):**
  - the small-image tile-count bug;
  - the tile-size limit (measured);
  - the tiling test cases;
  - the tiled-equals-one-piece check.
- **Moot without tiling or the extra checks:**
  - the G1 overclaim about exposure (exposure is tested in the math tests);
  - the engine test harness (the engine helper is now trivial).
