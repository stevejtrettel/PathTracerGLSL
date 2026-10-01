# Step 1: rename the `hdr` export to `radiance` (outputs and accumulation plan)

**Date:** 2026-09-30
**Status:** Built 2026-09-30. Every prediction held; the results are in the CHANGELOG.
Part of `claude-outputs-accumulation.md` §5 and §9. The baselines to compare against were
recorded at commit `d6fc27b`: `.digest/step0-frames` and `.digest/step0.json` with
`.digest/step0-keep`.

## Why

The color picture's export is named `hdr`. That is a file format, not what the picture is.
The plan names pictures by content (`radiance`, `variance`, `albedo`, `normal`), and every
later step builds names from that vocabulary. This step changes only the export's
identity: no shader, no pixel, no file format.

## What changes

The search below covered every quoted `'hdr'`/`"hdr"` in `src`, `tests`, `tools`, `scripts`,
`pages` and `demos` (`grep -rn "['\"]hdr['\"]"`, untruncated, read). Each hit is either
renamed or deliberately kept.

**Renamed: these name the export.**

| Where | What |
|---|---|
| `src/compiler/generate/PipelineBuilder.ts:79` | the definition: `'hdr': { bufferId: 'accumulation_previous', … }` → `radiance` |
| `src/app/App.ts:761, 769` | `exportHDR` checks for, and reads, the export |
| `src/app/App.ts:822` | `exportAllAOVs`'s "everything except" filter (the filter itself goes in step 5) |
| `src/app/TiledRenderer.ts:86, 114` | the export-presence check and the tile read |
| `src/engine/Engine.ts:353`, `src/compiler/types.ts:1068` | comments that name the export |
| `tests/compiler/compiler.test.ts:74`; `tests/compiler/validateCompiledRenderer.test.ts:25, 123` | test fixtures and assertions that name the export |
| `tests/compiler/__snapshots__/generated-glsl.snapshot.test.ts.snap` | the 50 `"hdr"` export keys, updated with `vitest -u` on that one file |
| `tools/witness.mjs:382, 464, 604, 609` | the runner's reads |
| `tools/witness.mjs:735-743` | `FRAME_CASES`' declared pictures |
| `tools/witness-spectral-lifecycle.mjs:22, 40`; `tools/witness-spectral-live.mjs:22` | reads |
| `docs/fable-validation-scenes.md:5, 6, 119`; `docs/fable-compiler-contracts.md:738`; `docs/fable-measurement-bench.md`; `docs/architecture.md`; `docs/claude-oidn-test-plan.md` | docs that describe the current API (`readExport('hdr')`) |

**Kept: these mean the file format, or something else.**

| Where | Why it stays |
|---|---|
| `src/app/TiledRenderer.ts:32, 84` | the `format: 'hdr' \| 'png' \| 'both'` option is the file type (replaced in step 5, not here) |
| `src/app/App.ts:770, 802` | the `.hdr` file extension |
| `src/compiler/types.ts:818`, `src/compiler/generate/values.ts:173` | `ParameterMetadata.hdr`, a color-slider setting |
| `tools/witness.mjs:932, 1040, 1043` | the frames tool's encoded-file kinds (`.hdr` and `.png` payloads) |
| `scripts/witness-environment.ts:12, 16, 107` | a test case named for a high-dynamic-range environment |
| method names `exportHDR`, the UI's "Export HDR", and the prose "HDR export" (CLAUDE.md, the accumulator README) | they save an `.hdr` *file*, which is still true |
| history docs (`fable-review.md`, `claude-review-handoff.md`, the outputs discussion record and review draft) | records of what was true then |

## Verification, with the prediction written first

**Prediction.** Shader text, closures, scene data, data reads and warnings are unchanged for
every suite scene. Each renderer's `.rest` part changes in exactly one way: its export key
`hdr` becomes `radiance`. Every picture is bit-identical.

1. `npx tsc --noEmit` clean; `npx vitest run` has the same counts as before (109 files,
   4095 tests).
2. **The digest.** `npm run digest -- .digest/step1.json --keep .digest/step1-keep`, then
   `--compare .digest/step0.json .digest/step1.json`. Only `rest` parts differ. Reading
   their kept diffs, the only changed lines are the export key, checked with a script that
   counts the changed lines across all differing parts and their content.
3. **The snapshot diff** changes only `"hdr"` → `"radiance"` export keys: the same kind of
   check, on `git diff` of the snapshot file.
4. **The frames.** `npm run frames -- record .digest/step1-frames`, then
   `compare .digest/step0-frames .digest/step1-frames --rename hdr=radiance`: 18 of 18
   pictures identical.
5. **After the rename, `git grep` for `'hdr'` finds only the kept lines** in the table
   above.
6. **With the owner's OK,** a targeted witness run under `caffeinate -i`:
   `npm run witness -- furnace cornell-area`. Furnace exercises the mean and variance
   reads; cornell-area includes the tiled check. This shows the runner and the tiled
   renderer still find the renamed export. Expected: a few minutes.
7. **Review:** an independent reviewer gets the diff, this plan and the evidence. The
   CHANGELOG entry records the literal results and the reviewer's findings.

## Not in this step

- Replacing `format: 'hdr' | 'png' | 'both'` and `exportAllAOVs` (step 5).
- Any other export or name.
- Any change to what is computed or saved.
