# Step 5: viewing and saving (outputs and accumulation plan)

**Date:** 2026-09-30
**Status:** Built 2026-09-30 in two commits (5a viewing, 5b saving). Every prediction held;
the results are in the CHANGELOG.
Part of `claude-outputs-accumulation.md` §3–§5 and §9. Baselines at commit `24dced1`:
`.digest/step4-commit-frames`, and `.digest/step4c.json` with `.digest/step4c-keep`.

There are two commits, each with its own checks: **5a, viewing**, then **5b, saving**.

## 5a. Viewing: any picture on screen, switched live

**Picture facts gain how they are viewed and saved** (data, in `PictureFacts`):
- `display`, the display program's sampler name. Radiance keeps today's `u_radiance`;
  variance gets `u_variance`.
- `view`, the mapping to the screen. Radiance and variance use `'tonemap'`, the strategy's
  exposure, curve and encoding (today's display math). The data mappings for albedo
  (`'unit'`) and normal (`'signed'`) arrive with their pictures in step 6, so no unused
  mapping code is emitted now.
- `formats`, the file formats it can be saved in. Radiance and variance get `['hdr', 'png']`.

**The contract extension (owner-approved).** `ExportTarget` gains an optional `picture` with
the `view` and `formats` above. The export targets that carry it are the pictures, in
planned order, and the first is the main picture. Nothing repeats a name. The environment
bake's `table` export has none.

**The display program,** built from the list:
- **One picture:** exactly today's shader, with no selector and no extra uniform.
- **More than one:** it binds each picture's sampler and chooses one with an if-chain on
  an `int` uniform `u_picture` (GLSL ES 3.00 has no dynamic sampler indexing). Each branch
  applies that picture's mapping. `u_picture` is bound to the reserved display channel
  `renderer.picture`, which never resets accumulation (`app/events.ts:63-67`). It defaults
  to 0, the main picture.
- **Inputs:** each picture's newest value during the frame, from `pictureBuffer`.
- **The recipe** re-aims every picture input to its after-frame value, as today's recipe
  does for radiance.

**One engine call, `renderView(target, parameters?)`,** generalizes `renderLdr`.
- It re-runs the display pass from the recipe into `target`: `'ldr'` for a PNG, `'screen'`
  for a redraw.
- Optional parameter overrides apply to that one draw only.
- It traces no sample, swaps nothing, resets nothing, and leaves the salt alone.
- The engine stays blind: the pass, inputs and buffers come from the recipe. The field
  keeps its contract name, `ldrRecipe`.

**The App holds the displayed picture's *name*** (display state, outside the parameter
store; precedent: `App.ts:201-210`).
- `app.showPicture(name)` maps the name to its index in this renderer's picture list,
  sets the engine value `renderer.picture` directly, and redraws with
  `renderView('screen')`. So switching works on a finished or stopped render too.
- On a renderer switch (`RENDERER_SWITCHED`), the App re-resolves the name, falling back to
  the main picture.
- It is not saved in sessions; a fresh page shows the main picture.
- Production's parameter lock doesn't apply, because this value never enters the store.
- `app.getPictures()` lists the names. The `m` shortcut, documented but unhandled today
  (`AppShortcutsExtension.ts:24`), cycles them.

## 5b. Saving: one operation, declared lists

**One operation: `app.save(picture, format, filename?)`.**
- `'hdr'` reads the picture's float export.
- `'png'` draws the picture through its view mapping into `ldr`, using
  `renderView('ldr', { 'renderer.picture': i })`, then reads the bytes. The screen and the
  displayed picture are unchanged.
- Pixels and stamp are read synchronously, before any asynchronous encoding.
- The stamp gains `picture`, the picture actually saved (`RenderStamp`, `stampEntries`).
- An unknown picture, or a format not in its `formats`, is an error with a plain message.

**Capture and encoding are shared.** A small `app/capture.ts` holds two functions:
- *capture*: one picture in one format, as pixels, synchronously;
- *encode*: pixels as an `.hdr` or `.png` file.

`save` uses both. The tiled renderer captures each tile with the same function, stitches,
then encodes once.

**Declared lists.**
- `renderProduction(N, { save: [{ picture, format }, …] })` replaces `autoExportPNG`,
  `autoExportHDR` and `autoExportAllAOVs`. `autoSave` (the session file) stays.
- `renderTiled({ width, height, spp, tileSize, save: [...] })` replaces
  `format: 'hdr' | 'png' | 'both'`.
- In both, the whole list is validated **before** rendering starts, and saved exactly as
  listed.

**Deleted:**
- `exportPNG`, `exportHDR`, `exportAOV` and `exportAllAOVs`, with the "everything except
  radiance and ldr" rule;
- the `renderLdr` name, which becomes `renderView`.

**Callers updated:**

| Caller | Change |
|---|---|
| ProductionPanel | "Export PNG" → `save(displayed, 'png')`; "Export HDR" → `save('radiance', 'hdr')`, the raw radiance download |
| AppShortcuts | PNG and HDR as above; the "export all AOVs" key is removed |
| RenderControls | production saves `[{ picture: 'radiance', format: 'png' }]`, which is today's effective behavior: PNG plus "all AOVs", and a standard renderer has none; the tiled job saves the same |
| `tools/witness.mjs`, the frame tool | the tiled check and the frames tiled case use `save` lists; the one-piece files come from `app.save` |
| `tests/app/productionOrchestrator.test.ts` | rewritten for save lists, including validation before rendering |

## Verification, with the predictions written first

**Prediction for 5a:**
- **Path-tracer shaders:** identical for every scene.
- **Display shaders:** identical for single-picture programs. The variance programs gain
  the selector and the `u_variance` sampler.
- **Renderer structure:** every renderer's `rest` changes by the `picture` facts on its
  picture exports. Variance renderers also change by their display inputs, the recipe
  inputs and the `u_picture` binding.
- **Frames:** 18 of 18 identical, including the variance renderers' LDR, which still shows
  radiance at `u_picture = 0`.

**Checks for 5a:**
1. `tsc` clean, and vitest passes.
2. **The digest,** with a structural script confirming exactly the predicted differences.
3. **The frames:** 18 of 18.
4. **New tests:**
   - the picture facts on the exports, and their order;
   - the selector emitted only for more than one picture;
   - the recipe re-aiming every picture input;
   - `validateCompiledRenderer` accepting it all.
5. **A one-off browser check** on SwiftShader (scratch script; nothing new in the repo) on
   the furnace variance renderer, after a finished production:
   - `showPicture('variance')` changes the screen pixels;
   - the sample count is unchanged;
   - there is no reset;
   - `showPicture('radiance')` restores the original pixels exactly.

**Prediction for 5b:**
- **Compiled output:** identical to 5a's, since saving is App code only.
- **Frames:** 18 of 18 identical. The tiled payloads are unchanged, now that the files come
  through `save`.

**Checks for 5b:**
1. `tsc` clean, and vitest passes, including the rewritten orchestrator tests and new tests
   for `capture.ts`:
   - an unknown picture is rejected;
   - a format not declared is rejected;
   - a list is validated before anything renders;
   - the stamp carries the picture.
2. **The frames:** 18 of 18. The tiled case exercises the shared capture path.
3. **A minimal witness:** `npm run witness -- cornell-area`, whose tiled check compares
   tiled against one-piece files through `save`. A few minutes.
4. **The one-off browser check:** on a finished render showing radiance, `save('variance',
   'png')` downloads a variance PNG whose stamp says `variance`, and the screen still shows
   radiance.
5. `git grep -n "exportPNG\|exportHDR\|exportAOV\|exportAllAOVs\|autoExport\|renderLdr"`
   finds only history docs.

## Not in this step

- The `'unit'` and `'signed'` view mappings (step 6).
- A live exposure.
- Saving signed pictures to disk.
- Session persistence of the displayed picture.
