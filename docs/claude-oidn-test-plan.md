# OIDN, first version: guided denoising of a finished render

**Date:** 2026-09-29
**Status:** ON HOLD (2026-09-29).

The owner reopened the choice between separate renderers and extra render targets. Extra
render targets also accumulate, and they suit "keep accumulating, denoise any time"
better. The owner then asked to design the output and accumulation system first, in
`claude-outputs-accumulation.md`, because the current system hard-codes its one extra
output (variance) in five places. The route below is therefore not decided. No code has
been written.

## The model

OIDN's guided HDR filter needs three images of the same shot, made with the same pixel
filter:
- **the color image** (radiance);
- **the albedo image**: at each pixel, the average over the pixel's camera rays of the
  reflectance at the first surface each ray hits;
- **the normal image**: the same average of the shading normal at that first surface.

Rays that hit nothing contribute 0 to both guides.

In this renderer's terms, albedo and normal are two more **measurements** of the same
scene: the same camera rays and pixel filter, a different functional of the first hit.
The strategy taxonomy says so directly (§9: a "normal view" is an alternative
measurement, "first-class, not hacks"). The owner's reviewed design for them already
exists: "probe integrators" in `fable-measurement-bench.md` §2.3, deferred "to their first
consumer". OIDN is that consumer.

So the first version has two parts.
- **Part 1 (compiler).** `measurement.response` gets two new values, `'albedo'` and
  `'normal'`. A renderer with either value runs a new, tiny **first-hit walk** in place of
  the path tracer, and the rest of the pipeline (averaging, export) is unchanged. The path
  tracer's own programs do not change.
- **Part 2 (a dev page).** The page renders a scene three times, **guides first and
  radiance last**: albedo, then normal, then radiance.
  - It pins the RNG salt, so sample k of each render uses the same camera ray.
  - It hands the three images to oidn-web's guided model, shows raw, denoised and the
    guides, and saves raw and denoised as `.hdr`.
  - Because radiance is rendered last, the path tracer is still the active renderer with
    its film intact. You can keep adding samples and denoise again whenever you like; the
    guides, which do not change, are reused.

Denoising itself is a filter on the finished image, so it is view-side
(`accumulator/README.md`). The raw film is only read.

## Part 1: two new measurement responses

### What they mean

For `response: 'albedo'` or `'normal'`, the pixel value is `(1/N) Σ_k g(first hit of ray k)`,
with the same camera rays and box pixel filter as the radiance render. `g` is:
- **albedo:** the material's albedo fact (the table below), clamped to [0, 1];
- **normal:** `hit.frame.n`, the shading normal. `scene_intersect` flips it to face the
  arriving ray (`compiler/generate/features/intersection.ts:1714-1728`). pbrt-v4 does the
  same for its guide (`FaceForward(si.shading.n, wo)`, `film.cpp:198-199`). It is not
  renormalized after averaging; OIDN does not require that.
- **a miss:** 0.

**Supported in this version.** Anything else is a Validator error with a plain message:
- `color: 'rgb'`;
- `directLighting: 'none'` and `russianRoulette: null`;
- a scene with no media at all (`features.media.hasMedia`, which also covers null
  interfaces, since model `'none'` requires a medium, and GRIN).

Of 268 synchronous suite scenes, 111 have media and are refused. Of the rest, 32–35 have a
spectral strategy and are refused for that (measured by the reviewer). That leaves about
122–125 eligible scenes. With the guide estimator below, those produce no new Validator
errors (measured).

Other measurement fields (`maxBounces`, …) are recorded as usual; the first-hit walk does
not read them.

### Albedo facts

Each material descriptor states its albedo as a small piece of structured data. It is a
required field, so a future model cannot forget it:

```ts
albedo: { row: string } | { fn: string }
```

- `{ row }` names one of the model's own Spectrum reflectance properties.
- `{ fn }` names a function `fn(Hit, MaterialProperties)` that the model's own `.glsl`
  defines.

The math stays in GLSL; the descriptor only points at it, which is the house rule
(`descriptors.ts:197-200`, "never TS strings").

| Model | Albedo | Why |
|---|---|---|
| lambert | `{ row: 'albedo' }` | OIDN: diffuse color |
| checker | `{ fn: 'checker_albedo' }` | exists already (`checker.glsl:13`) |
| mirror, ggx | `{ row: 'f0' }` | OIDN: "reflectivity at normal incidence" |
| dielectric, rough_dielectric | `{ row: 'transmittance' }` | OIDN: "1, or … the transmitted albedo". Equal to 1 for clear glass, and to the tint for tinted glass. Matches Mitsuba (`dielectric.cpp:403-417`) up to its small Fresnel term |

A generated `material_albedo(mat, hit, mp)` dispatch groups the ids by model, like
`generateInteractionDispatch` (`features/materials.ts:861-913`), and emits
`clamp(mp.<row>, 0.0, 1.0)` or `clamp(<fn>(hit, mp), 0.0, 1.0)`. Expression materials and
per-instance attributes are covered, because they are already resolved into `mp` fields.

It is emitted only in albedo programs. The material `.glsl` files do not change.

Visible area lights are lambert with albedo 0 (`compiler/plan/Planner.ts:293-298`), so they
are black in the albedo guide. The OIDN README says nothing about emitters.

### Changes, file by file (line counts are estimates)

| File | Change |
|---|---|
| `compiler/types.ts:575`, `plan/types.ts:53` | `response?: 'radiance' \| 'albedo' \| 'normal'` |
| `components/transport/integrators/index.ts` | register `first_hit`, plus one table: response → integrator (`radiance: 'pt'`, `albedo`/`normal: 'first_hit'`). The table is typed `Record<NonNullable<MeasurementDescription['response']>, …>`, so tsc forces it to agree with the union. It is the one answer: the Validator's legal responses are its keys. |
| new `components/transport/integrators/first_hit/first_hit.ts` | the generated walk below (~40 lines) |
| `compiler/generate/features/index.ts:43` | pick the integrator from that table instead of importing `pt` directly (~3 lines) |
| `compiler/analyze/Validator.ts:878` | legal responses from the table, and the supported-configuration rules above (~20 lines) |
| `components/descriptors.ts` | `albedo: { row } \| { fn }` on `MaterialModelDescriptor`, with its meaning in the doc comment |
| 6 material descriptors | one line each |
| comments and docs that would become false | `compiler/types.ts:573-574` ("'radiance' is the sole occupant"); the header of `integrators/index.ts` ("arrives with the second occupant"); `components/materials/README.md` (the new required fact); `fable-components.md` §3 (the integrator is now chosen by `measurement.response`); the §2.3 status line in `fable-measurement-bench.md` |
| `plan/types.ts`, `Planner.ts` (materials record) | `albedo: true` only when the response is `'albedo'`, and omitted otherwise, like `emissionCones` (`Planner.ts:634-638`), so every existing `ProgramDescription` is unchanged |
| `compiler/generate/features/materials.ts` | `generateAlbedoDispatch` and the `material_albedo` provide, both behind that decision (~25 lines) |

The walk, as emitted:

```glsl
// albedo program
Radiance transport_trace(Ray ray) {
    Hit hit;
    if (!scene_intersect(ray, hit)) return SPECTRUM_ZERO;          // a miss contributes 0
    int mat = material_of(hit.region_owner);
    MaterialProperties props = scene_material_properties(mat, hit.p, hit.uv, hit.element, hit.wl);
    return material_albedo(mat, hit, props);
}
// normal program: after the miss test, `return hit.frame.n;`
```

`first_hit` provides only `transport_trace`. It requires `scene_intersect`, plus
`material_of`, `scene_material_properties` and `material_albedo` for albedo. The
accumulator's `main()` is unchanged. In RGB, `color_to_pixel` is the identity
(`color/rgb/rgb.glsl:7-9` with the ideal sensor), and `average.glsl` only averages. So
signed normals reach the float buffer intact.

Returning a normal through a function typed `Radiance` works only because RGB `Radiance`
is `vec3` (`color/rgb/types.glsl:1-2`). That is one reason the responses are RGB-only; the
walk carries a comment saying so.

**Known gap, accepted for this version.** A guide program still receives the radiance
features' always-provided seams that it doesn't call. Merge reports each one as a
`seam-unused` warning (`features/merge.ts:73-87`). Counts measured by the reviewer over
every eligible scene:
- **Albedo programs:** 4 warnings (`interaction_surface_sample`,
  `interaction_surface_emission`, `material_is_emissive`, `environment_radiance`), and 5
  with glass (adds `ior_of`).
- **Normal programs:** 6 or 7, adding `material_of` and `scene_material_properties`.
- **Environment resources:** in a scene with a sky, the environment's extern texture and
  its `env.*` parameters come along unread.

Closing that gap means gating those features on the response, which touches the radiance
programs' generation paths, so this version leaves it alone. It is recorded here and in the
CHANGELOG. If the probes stay, closing it is the follow-up.

### What stays the same

- The radiance programs' GLSL, uniforms, parameters and warnings, for every suite scene
  (the digest checks this).
- Every existing `ProgramDescription` (the snapshot test).
- The scene-data layout. The page gives its guide strategies the radiance strategy's
  `meshTraversal`, `instanceAccel` and `objectDispatch`. So their data reads are a subset
  of the radiance renderer's (`dataTenants.ts:27-33`), and the shared layout is unchanged.
  The reviewer measured this at every strategy index: `DataReads`, the scene-data plan and
  the radiance shaders are identical with and without the guides.
- **Environment tables.** The guides leave `envSampler` unset, so `envVariants` counts one
  more variant (equirect, uncompensated; `App.ts:1003-1012`). With an image sky that is
  the loader's default. With a procedural sky and a non-equirect radiance strategy it is
  one extra bake that nothing reads. That is harmless. `envCompensation` is not copied,
  because it requires `'mis'`.

## Part 2: the dev page

It is reached at `/oidn.html?scene=<id>&strategy=<n>` on the dev server. The facts below
come from the earlier step-1 plan and its review.

### Facts it relies on

**Our code (read).**
- `App.renderProduction(N)` resolves once N samples are done, and rejects if the render
  is stopped (`app/ProductionOrchestrator.ts:60-92`). It runs one sample per animation
  frame (`app/RenderCoordinator.ts:214-236`).
- `readExport('hdr')` reads RGBA floats synchronously, bottom row first
  (`engine/Engine.ts:354-401`), from the newest finished frame
  (`compiler/generate/PipelineBuilder.ts:74-79`).
- `app.selectRendererByStrategy(id)` switches renderer, re-sends the parameters and clears
  accumulation (`app/App.ts:451`, `app/RendererManager.ts:259-282`).
- **With the salt pinned, sample k of each render uses the same camera ray** (read):
  - a pinned salt survives every clear (`engine/Engine.ts:309`);
  - each renderer's sample count restarts at 0 (`Engine.ts:306`);
  - the seed is `rng_init(pixel, u_sampleCount, u_resetSalt)`, followed by the pixel jitter
    and then the lens sample (`accumulator/average/average.glsl:10-13`);
  - RGB `wavelengths_sample` draws nothing (`color/rgb/rgb.glsl:2-4`).
- `new App(canvas)` works without a page layout (`App.ts:59, 154`;
  `ProductionOrchestrator.ts:174, 210`).
- `saveHDRFile` takes bottom-first rows (`app/utils/file-export.ts:95-117`).

**oidn-web 0.4.0 (tag `v0.4.0` = `ab265fc`, MIT; read, several items also measured by a
reviewer's simulation of the library's CPU side).**
- `tileExecute({ color, albedo, normal, done })`:
  - `color` is `{ data: Float32Array, width, height }` (RGBA);
  - `albedo` and `normal` must be 8-bit `ImageData`, which it divides by 255
    (`src/UNet.ts:30-40, 302-313, 506-516`);
  - `done` receives a float RGBA image with alpha 1.
- **Normal encoding.** Normals must already be encoded as `0.5n + 0.5`. OIDN does this
  internally (`gpu_input_process.h`) and so does its training (`dataset.py:135-138`), but
  oidn-web does not.
- **WebGPU.**
  - The library creates its own WebGPU device (`src/backend.ts:1-45`).
  - It throws without WebGPU (`backend.ts:2`).
  - It uses fp16 where available.
- **The input must be clean.** A pixel with luminance below −1e-4, or with Inf, makes the
  exposure NaN, and with it the whole output (`src/process.ts:68`; measured).
- **Sizes.** Only square sizes that are multiples of 16 work on this path, with
  `dynamicTile: false, maxTileSize: 1024`: 256 to 1024 each run as one tile. Other sizes
  give all-NaN output (measured).
- **Exposure.** Because each size is a single tile, oidn-web computes one exposure for the
  whole image. Its rule differs from native OIDN's on images with large black areas
  (`process.ts:51-76` vs `cpu_autoexposure.cpp:25-64`). This version accepts that.
- **Failures.**
  - There is no error callback. A failure is an unhandled rejection, and `done` never fires
    (`UNet.ts:596-687`).
  - Loading from a URL skips the HTTP status check (`src/main.ts:96-100`), and Vite
    answers a missing file with `index.html`. So the page fetches the model itself.
- **Imports.** Node cannot import oidn-web, so the tested helpers never import it.

**Model file (measured).**
- `rt_hdr_alb_nrm.tza`: 1,841,160 bytes, sha256
  `e586ef2ff48d7fbb7611986405220ed8fc5c13ca79bfc40be4dc742fbf959e1a`.
- It is identical in `pissang/oidn-web@v0.4.0/weights/` and `RenderKit/oidn-weights@28883d1`.
- License: Apache-2.0.

### The page

**Loading.**
- The scene comes from the lab's registry. An async data scene is awaited, as
  `pages/scene-lab.ts:36` does.
- **Three strategies.** From the chosen radiance strategy R, the page builds two guide
  strategies:
  - `measurement`: R's, with `response` set to `'albedo'` or `'normal'`;
  - `estimator`: `{ directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } }`
    plus R's `meshTraversal`, `instanceAccel` and `objectDispatch`;
  - `view`: R's;
  - ids `R.id + '-albedo'` and `R.id + '-normal'`.
- `new App(canvas)` is initialized with `[R, albedo, normal]` and the entry's
  `initialParameters` (seven registry entries have some).
- A Validator error (for example, a scene with media, or a spectral strategy) is shown in
  the Validator's own words, and the page stops there. `initialize` already raises the
  error overlay (`App.ts:415-427`). The page adds no wording of its own, which would be a
  second answer.
- **The model** is loaded once:
  1. fetch `/oidn/rt_hdr_alb_nrm.tza`;
  2. check `res.ok`;
  3. check the sha256 (`crypto.subtle`);
  4. call `initUNetFromBuffer(bytes, undefined, { hdr: true, aux: true, dynamicTile: false, maxTileSize: 1024 })`.

  Any failure is shown in plain words.
- There are no camera or parameter controls; the authored camera is used.

**Controls.**
- Size: square, 256 / 512 / 768 / 1024, default 512.
- Samples N: default 32.
- A Run button: render the guides and the radiance, then denoise.
- Added samples M (default 32) and an "Add samples and denoise again" button, which is
  enabled after a run completes.
- A view selector: Raw / Denoised / Albedo / Normal.
- A display exposure.
- Save raw and save denoised.

**One thing at a time.** One busy flag covers both Run and "Add samples". While either
is working, both buttons are disabled. Switching renderers has no production guard of
its own (`RendererManager.ts:259-282`). So a Run clicked during an extension would switch
the still-running extension onto a guide renderer.

**A run.**
1. **Render.** Clear the "run complete" flag. Resize with `app.resize` if the size
   changed; not with `renderProduction`'s `width`/`height` options, which make each later
   production restore the old size first. Pin a fresh random salt for this run
   (`app.pinResetSalt`). Then, for each of albedo, normal and R, in that order:
   - `selectRendererByStrategy`;
   - `await app.renderProduction(N)`;
   - check `app.getActiveStrategy()?.id` against the expected id, and abort the run on a
     mismatch (renderer selection has been seen to get lost intermittently,
     `tools/witness.mjs:300-306`);
   - read `readExport('hdr')` synchronously;
   - build its stamp.

   Reading each image before the next selection is load-bearing: selecting clears every
   buffer (`Engine.ts:310`). Unpin the salt afterwards, in a `finally` block. Unpinning
   keeps the current salt value (`Engine.ts:324-327`).

   The order matters: radiance is rendered **last**, so it stays the active renderer, its
   production stays settled, and its film is kept. Nothing on the page selects another
   renderer until the next Run. Set "run complete" only when all three renders and the
   reads succeed.
2. **Prepare.**
   - **Color:** zero non-finite and negative components, set alpha to 1, and show both counts.
   - **Albedo bytes:** `round(clamp(a, 0, 1) · 255)`.
   - **Normal bytes:** `round((clamp(n, −1, 1) · 0.5 + 0.5) · 255)`.
   - Non-finite counts for the guides are shown too.
3. **Denoise.** Call `tileExecute`, wrapped in a promise that rejects on a synchronous
   throw, or on an unhandled rejection while it is pending.
4. **Show and print.**
   - Timings: each render's wall time and ms per sample; the denoise time, with the first
     one labeled as including setup.
   - fp16 or fp32 (`unet.getRuntimeInfo()`).
   - The number of non-finite values in the output.
   - The radiance sample count.

**Add samples and denoise again.** Enabled only when:
- "run complete" is set;
- `app.getActiveStrategy()?.id` is the radiance strategy's id (checked again on each click);
- M is an integer ≥ 1. The render loop draws a frame before it checks the target
  (`RenderCoordinator.ts:219-229`), so M = 0 would still add a sample.

If the WebGL context is lost and restored, the App restarts interactive rendering
(`App.ts:290-292`), and `extendProduction` then throws. The page shows that error and
asks for a new Run.
1. Call `await app.extendProduction(M)`. It continues from the current film without
   clearing it, and resets only if something marked the render dirty
   (`ProductionOrchestrator.ts` `extendProduction`; `RenderCoordinator.consumeDirtyReset`).
   The page has no controls that could do that. Its display exposure is page-side only,
   not an App parameter.

   The added samples continue the same seed stream with new sample indices, so they are
   independent of the first N (read: `average.glsl:10`, `Engine.ts:324-327`).
2. Read `readExport('hdr')`, clean it, denoise it with the **stored** albedo and normal
   bytes, and show it. The guides are not re-rendered.

   They were averaged over the first N camera rays only. Near edges they are therefore a
   slightly noisier estimate of the same filtered guide than the color now is. That is
   acceptable for a preview (expected, not measured). A new Run re-renders everything.
3. The save buttons then save the current film and its denoised result, with the stamp
   built after the extension, so its sample count is the new total. The denoised stamp's
   `denoiser` entry also records `guideSpp: N`, so nobody reads the guides as having
   N+M samples.

**Display.**
- Raw and denoised: exposure, then Reinhard `v/(1+v)` per channel, then sRGB, 8-bit.
- Albedo and normal: their encoded bytes, as data.
- All four views flip rows once (the film is bottom-first).
- The helpers return bytes; the page wraps them in `ImageData`.

**Saving.**
- Raw carries its stamp.
- Denoised is `…_oidn.hdr`, with `strategy.view.denoiser = { oidnWeb: '0.4.0', model: 'rt_hdr_alb_nrm.tza', sha256, guideSpp }`.

## Boundaries

| | Files |
|---|---|
| New | `components/transport/integrators/first_hit/first_hit.ts`; the witness fixture `tests/witnesses/scenes/guides.ts` and its registry line; new vitest files (below); `oidn.html`; `pages/oidn-test.ts`; `pages/oidn/image.ts` (pure helpers; never imports oidn-web); `public/oidn/rt_hdr_alb_nrm.tza`; `public/licenses/oidn-weights.txt` |
| Edited | the compiler and component files in Part 1's table (including the comments and docs row); `tests/compiler/glsl-compile.test.ts` (the canary skip, item 6); the two snapshot files (new entries for the new witness only); `package.json` and lock (`oidn-web` at exactly `0.4.0`); `docs/README.md`; `CHANGELOG.md` |
| Unchanged | `pt.ts` and every transport technique; every material, geometry and light `.glsl` file; the engine; the accumulators; the pipeline builder; `vite.config.ts`; the lab page and the gallery |

There are two commits: Part 1 (compiler and witness), then Part 2 (page). Each can be
reverted with `git revert`; a `npm install` follows for Part 2. The model file stays in
git history.

## Verification, written before the code

**Before any change.**
- Record the results of `npx tsc --noEmit` and `npx vitest run` ("pass" below means the
  same failures before and after; glslang needs Rosetta on Apple silicon).
- Record `npm run digest -- before.json`.

**Part 1, automated.**
1. `npx tsc --noEmit` and `npx vitest run` pass.
2. `npm run digest -- after.json`, then `--compare`. No existing scene changes. The only
   difference is the one new witness scene.
3. **Snapshot tests.** The existing entries of `program-description.snapshot.test.ts` and
   `generated-glsl.snapshot.test.ts` are unchanged. The only additions are the new
   witness's entries.
4. **New Validator cases.** An albedo or normal response is accepted for an RGB, no-NEE,
   no-roulette, media-free scene. It is rejected for:
   - spectral color;
   - `directLighting: 'nee'`;
   - roulette on;
   - a scene with media (one rule and one message: an absorbing medium and a null
     interface both trigger it);
   - an unknown response.
5. **New structure cases.**
   - An albedo program's `material_albedo` has exactly one arm per present model, reading
     that model's `row` or calling its `fn`, inside a clamp.
   - A normal program's `transport_trace` returns `hit.frame.n` after the miss test.
   - Both return `SPECTRUM_ZERO` on a miss.
   - Neither contains `light_query_surface` or `kernel_`.
   - No radiance program contains `material_albedo`.
6. **New glslang cases.**
   - An albedo program for a single-model scene of each of the six material models. This
     catches a model reading a field that only another model provides, which the union
     `MaterialProperties` struct would otherwise hide.
   - Albedo and normal programs for these scenes:
     - `hearth` or `charts` (checker);
     - `paint` (expression materials);
     - `attr-twin` (instance attributes);
     - `meshes` (smooth-normal mesh);
     - `bazaar` (`objectDispatch: 'table'`);
     - `sky` (image environment);
     - `proc-sky` (procedural environment).
   - The RG canary loop (`glsl-compile.test.ts`) skips only normal programs, with a
     comment giving the reason: the normal walk relies on RGB `Radiance` being `vec3`.
     Albedo programs are Spectrum-typed and run under the canary.
7. **New descriptor contract case.** For every registered material model, `albedo.row` is
   one of the model's own `Spectrum` properties with role `reflectance`, or `albedo.fn` is
   defined in the model's own `.glsl` with the signature `(Hit, MaterialProperties)`.

**Part 1, witness.** This is the taxonomy's §6.4 obligation for a new measurement value:
a witness with a derived expected value. There is one new fixture, `guides`: the
`cornell-area` scene under a new id, with two strategies (albedo and normal) sharing
`cornell-area`'s camera. It gets `mean` checks over small regions, each lying wholly
inside one surface.

Derivation: every camera ray through such a region, whatever its jitter, hits that one
surface, so every sample is the same constant, and the mean is that constant up to float
rounding. So these values are exact (`tier: 'exact'`, tolerance 1e-4):

| Region | Albedo | Normal |
|---|---|---|
| red wall (the plane x = −1.5; `plane_sdf = dot(p, n) + offset`) | (0.65, 0.05, 0.05) | (1, 0, 0) |
| back wall (z = −2) | (0.73, 0.73, 0.73) | (0, 0, 1) |
| floor (y = 0) | (0.73, 0.73, 0.73) | (0, 1, 0) |
| clay sphere interior (a `{param}` albedo) | (0.8, 0.4, 0.2) | — (varies) |

The regions are chosen from one render at implementation time, and the choice is
recorded in the fixture. The check runs as `npm run witness -- guides` (targeted, a few
minutes).

**Part 2, automated.**
8. `npx tsc --noEmit` and `npx vitest run` pass. `tsconfig` includes `pages/`, and the
   page imports oidn-web.
9. Helper tests:
   - cleaning (counts, zeroing, input untouched);
   - display bytes: 0 → 0, and 1 at exposure 1 → 188 (Reinhard 0.5, sRGB 0.7354);
   - a 2×2 flip;
   - albedo bytes: 0 → 0, 1 → 255, 1.3 → 255;
   - normal bytes: (0, 0, 0) → (128, 128, 128), and (1, 0, −1) → (255, 128, 0).
10. `git diff --stat` for Part 2 touches only Part 2's files.

**Part 2, by hand**, in Chrome on the owner's Mac (the test browser has no WebGPU):

11. `cornell-area` at 512 with N = 32:
    - the Albedo and Normal views look right;
    - raw, denoised and the guides line up;
    - the saved raw `.hdr` has the displayed orientation;
    - the output has 0 non-finite values.
12. `sky`: the sky pixels are black in both guides, and there is no shift between raw,
    denoised and the guides.
13. `fogblobs` shows the Validator's media message.
14. Run, then "Add samples and denoise again" twice:
    - the sample count grows by M each time;
    - the raw image gets less noisy;
    - the denoised result updates;
    - the albedo and normal views are unchanged.

    Clicking Run while an extension is working is impossible (both buttons are disabled).

    Two runs in a row with different N both complete. With the model file renamed away,
    the page says "model file missing".
15. The timings, browser and hardware are recorded here.

## Not in this version

- Media, null interfaces and GRIN in the guides.
- Spectral renders.
- Following glass or mirrors to a later hit for the guides.
- Closing the `seam-unused` gap.
- Native-OIDN exposure.
- The GPU-buffer handoff.
- A color-only fallback for unsupported scenes: about 10 lines and a second model file, if
  wanted.
- Camera controls.
- Other image sizes.
- A build entry.
- Lab integration.
- Interactive denoising.

## Research record: the routes compared (2026-09-29)

Three read-only research agents compared ways to produce the guides. The owner chose
separate renderers ("Route A") over extra render targets of the radiance program ("Route B").

**Route B** would have used the `variance` pattern: albedo and normal as attachments 1 and
2, which the locked contract already documents (`compiler/types.ts:917-920, 1028-1036`).
- First, a refactor: the layout is decided in four files today, and would become one
  descriptor fact (about 40 lines over 5 files).
- Then a capture of the guides:
  - either in the walk at bounce 0, which matches pbrt-v4 exactly, including media and
    null interfaces, but changes transport generation;
  - or by re-intersecting the camera ray in the accumulator, which copies the walk's
    null-skip rule and ignores fog.
- Its switch would be `accumulation.type: 'guides'`, even though the guides are
  measurement-side quantities; it could not be combined with `variance`; and the witness
  runner replaces the accumulator.
- **Its advantages:** no extra render passes, and media work by the walk's own rules. It
  may suit a later production version, where larger changes are allowed.

**Albedo.** pbrt-v4's generic estimate (the average of 16 BSDF samples at fixed points)
was the alternative to per-material facts. It needs less code. But a JS transcription gave
0.444 for glass head-on, bands of 0.48–0.86 as the viewing angle changes, values above 1
from inside glass, and rough metal below f0. The per-material facts match OIDN's guidance.
Mitsuba 3 moved to per-BSDF facts in September 2026 (`aov.cpp:263-267`).

## Review record

- **First draft** (guides built into the compiler, with one-sample guides). My own review
  and an independent review agreed:
  - one-sample guides contradict the OIDN README;
  - a fixed input scale of 1 is not OIDN's default;
  - the guide switch can't live in `view`;
  - no mechanism was given for getting first-hit data out of the walk;
  - it was too invasive.
- **Step-1 page** (color-only). A second fresh reviewer:
  - measured the library limits above;
  - found the missing-model and exposure issues;
  - simplified the checks.
- **Owner decisions:**
  - the quality experiment was dropped, because OIDN's quality is established;
  - the first version must pass the guides;
  - the guides come from separate renderers.
- **This version.** Reviewed by a third fresh agent, which measured:
  - the guide strategies validate on all eligible scenes;
  - the radiance shaders, `DataReads` and scene data are unchanged when the guides are
    added;
  - a pt-mocked guide program passes Generate and glslang;
  - the seam-unused counts.

  Its fixes, all adopted:
  - albedo as structured data instead of a GLSL string;
  - single-model glslang cases;
  - the GPU checks as a proper witness (taxonomy §6.4) instead of screenshots;
  - `sky` instead of `chrome`, which has no sky;
  - corrected warning counts;
  - a typecheck for Part 2;
  - a narrower canary skip;
  - the Validator's own messages on the page;
  - the table typed against the union;
  - the comments and docs that would become false;
  - `initialParameters`;
  - the active-strategy check.
- **The guides-first reordering** (the owner asked for it). A focused review found it
  sound, with every mechanism matching the code. It added:
  - one busy flag for both buttons;
  - a "run complete" flag, with the active-strategy check repeated before each extension;
  - M must be an integer ≥ 1;
  - context loss requires a new Run;
  - `guideSpp` in the stamp;
  - resize through `app.resize`.
