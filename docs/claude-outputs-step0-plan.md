# Step 0: comparison tools (outputs and accumulation plan)

**Date:** 2026-09-29
**Status:** Built 2026-09-30 and reviewed. See "As built" at the end, and the CHANGELOG.
Part of `claude-outputs-accumulation.md` §9. This step changes no renderer code.

## Why

Steps 1–6 of the plan each promise "these pictures are unchanged" or "only these
structures changed". The existing tools can't show either promise precisely enough.

- **`npm run digest` keeps only hashes** (`scripts/digest-compiled.ts:54-66`, read). It
  says *that* a scene's shaders or pipeline changed, but not *how*. The old structure can't
  be recovered afterwards to look at.
- **Nothing compares rendered images exactly before and after a change.** The witnesses
  are statistical checks with tolerances, so they cannot establish that a picture was
  preserved exactly. `oneshot` has no witness at all (read).
- **Witness renders are deterministic** with a pinned salt on SwiftShader
  (`tools/witness.mjs:65-72` relies on it for its frame cache, read). So an exact,
  bit-for-bit image comparison is possible.

## The change

**A. `npm run digest -- <out.json> --keep <dir>`.** It also writes the text each hash was
taken from, to `<dir>/<scene>/<part>.json`:
- the shaders;
- the rest of the compiled renderer (pipeline, exports, recipe);
- the closures;
- the scene data;
- the data reads;
- the warnings.

It uses the same `compiledJson` text that is hashed today, so hash and file cannot
disagree.

- The digest JSON records the path of its kept directory, so `--compare` finds the kept
  files from the two digest files alone.
- `--compare` is unchanged. When both digests were kept, it also prints a
  `git diff --no-index <a> <b>` line for each differing part, so a difference can be read
  instead of trusted.
- **What the kept text shows, and what it doesn't.** Pipelines, exports, recipes, uniforms,
  closure results and shader text are shown in full. Packed data arrays are shown only as
  their length and hash (`tests/helpers/compiledJson.ts:18-20`). That is enough for this
  plan, which does not change scene-data packing.
- Kept output goes under `.digest/`, a new line in `.gitignore`. The expected size is tens
  of MB (not measured).

**B. A frames mode in the witness runner:**
- `npm run frames -- record <dir>`;
- `npm run frames -- compare <a> <b> [--rename old=new]`.

It reuses the runner's existing dev-server handling, SwiftShader launch, pinned salt
(`WITNESS_SALT = 1234`), page driving and download capture (`tools/witness.mjs`). So there
is no second browser harness. The one new script line in `package.json` is
`"frames": "node tools/witness.mjs --frames"`.

**The fixed cases:**

| # | Scene / strategy | Mode | Size and samples |
|---|---|---|---|
| 1 | `cornell-area` / 0 | average, NEE | 64×64, 8 spp |
| 2a | `furnace` / 1 | variance, zero by design | 64×64, 8 spp |
| 2b | `cornell-area` / 0, with variance forced on | variance, noisy | 64×64, 8 spp |
| 3 | `cornell-oneshot` / 0 | oneshot | 64×64, 8 frames |
| 4 | `spectral-materials` / 0 | spectral | 64×64, 8 spp |
| 5 | `fog-area` / 0 | scattering medium | 64×64, 8 spp |
| 6 | `grin-furnace` / 0 | GRIN | 64×64, 8 spp |
| 7 | `cornell-area` / 0, tiled | tiled, `format: 'both'`, `tileSize: 64` | 150×100 (3×2 tiles with partial edges; tiles round up to 64, `app/tiling.ts:47`), 8 spp |

**Why two variance cases.** Every furnace sample is the same number (albedo 0.5, emission
0.2, no NEE, no roulette, a fixed 16 bounces: `furnaceBox.ts:17-31`, read), so its
variance is exactly zero. A broken variance update could still produce zeros there. Case
2b records a noisy scene with variance on, and `record` checks that its baseline variance
is nonzero.

2b forces variance the way the witness runner does today
(`accumulation = { type: 'variance' }`, `tools/witness.mjs:349`). Step 2 of the plan
migrates this site along with the others.

All the scenes are synchronous suite entries. `cornell-oneshot` is a demo, so the mode reads
strategy ids from the lab page's full registry (`window.sceneSuite`), not only the witness
registry.

**Fresh renders only.** `record` never reads or writes the witness runner's frame or
variance caches (`tools/witness.mjs:73-133, 293-294`). Otherwise two matching recordings
might only show that cached data was copied twice. `compare` reads files only; it starts
no browser and no dev server.

**What is recorded:**
- **Cases 1–6:**
  - every float export the renderer offers (from `app.getAvailableExports()`, so the tool
    survives the step-1 rename), as raw little-endian float32 files;
  - the LDR bytes (`app.renderLdr()` + `readExport('ldr')`);
  - `meta.json`: scene, strategy id, the export names, the git hash and the date, and what
    the App reports *after* the render: the active renderer id, the sample count, the
    canvas size and the salt. The intended values are not recorded.
- **Case 7:** the encoded payloads of the stitched `.hdr` (RGBE) and `.png`, with the
  stamps excluded, because they contain the date and the git revision
  (`app/utils/file-export.ts:23`). This is quantized file output, not float
  accumulation, and `compare` reports it as "encoded bytes differ", not as pixel errors.

**What `compare` does:**
- **The records must be complete first.** A missing case or picture, a truncated file (a
  size that doesn't match the dimensions), incompatible identities (a different scene,
  strategy, size, sample count or salt) or a `--rename` collision is an error, before any
  pixel is compared.
- For each case and picture, it checks bitwise equality of the arrays.
- On a difference it reports the picture, the number of changed pixels, the largest
  absolute difference, and the non-finite counts on each side.
- The git hash and date are ignored.
- Any non-finite value on either side is a failure, even when both sides agree.
- `--rename hdr=radiance` matches the renamed export in step 1.
- The exit code is non-zero on any difference.

## Boundaries

- **Changed:**
  - `scripts/digest-compiled.ts` (`--keep`, about 20 lines);
  - `tools/witness.mjs` (the frames mode, about 150 lines);
  - `package.json` (one script);
  - `.gitignore` (one line);
  - `CHANGELOG.md` and `docs/README.md`;
  - `CLAUDE.md`'s Commands list: two lines, with the owner's approval.
- **Not changed:**
  - anything under `src/`, `tests/`, `demos/` or `pages/`;
  - the witness registry and its checks.

## Verification, written first

1. **Nothing in the renderer changes.** `git diff --stat -- src tests demos pages` is empty.
   `npx tsc --noEmit` and `npx vitest run` give the same results as before.
2. **Repeatability (to be measured).** Record twice at the same commit, both fresh
   renders; `compare` should report every case identical. That result is the evidence that
   bit-exact comparison is meaningful on this machine. If it fails, stop and report it.
3. **It catches a change.** In a copy of a record, change one float in one picture.
   `compare` reports exactly that one pixel and its difference.
4. **Metadata doesn't cause false failures.** In a copy, change `meta.json`'s date and git
   hash. `compare` passes, and notes the metadata difference.
5. **Non-finite values are rejected.** In a copy, write a NaN into one picture. `compare`
   fails and reports it.
6. **Incomplete or mismatched records are refused.** Delete one picture file from a copy,
   and separately change a copy's `meta.json` salt. `compare` refuses both with a clear
   error, before comparing pixels. Case 2b's baseline variance is nonzero.
7. **The rename option works.** In a copy, rename the `hdr` files and meta entries to
   `radiance`. `compare --rename hdr=radiance` passes.
8. **The kept digest is real.**
   - Run `digest --keep` twice: `--compare` reports everything identical.
   - The kept rest file for `furnace`'s variance renderer contains
     `accumulation_previous:1`. That shows the kept text is the actual structure, not a
     placeholder.
9. **Record the baseline.** The step ends by recording `frames` and `digest --keep`
   baselines at its own commit, for step 1 to compare against. Their paths and case
   counts go in the CHANGELOG entry.

The runtime is expected to be a few minutes on SwiftShader; the CHANGELOG records the
measured time.

**Scope of the evidence.** The fixed cases are regression coverage for those cases. They
do not prove anything about scenes they don't render. The digest covers every suite
scene's compiled output.

## Not in this step

- Any renderer change.
- New witnesses.
- The table test of the planned pipeline, which belongs with step 3, where the list is
  introduced.
- Making the fixed cases configurable.

## As built (2026-09-30)

The plan above was implemented as written. The code review then found four ways the tool
could pass when it shouldn't. All four were fixed, and each fix was measured:

1. **Each record is validated on its own,** against the fixed case list
   (`FRAME_CASES` in `tools/witness.mjs`, which also declares each case's exact pictures).
   It is not enough for two records to agree with each other: both could be missing the same
   case, or both could have the wrong salt. `record` also validates what the App reports
   before it writes a case.
2. **The tiled case keeps the structure its payloads need.** It records the `.hdr`
   resolution line and the PNG header (width, height, bit depth, color type), checks them
   against the case, and checks both payload lengths.
3. **WebGL error flags are drained before each render, and must be empty afterwards.**
   `Engine.readBuffer` does not check them, and a failed `readPixels` can leave finite zeros
   with no exception. A temporary copy of the tool that reads an incomplete framebuffer
   failed with 1286.
4. **`digest --keep` refuses a non-empty directory,** so a kept directory stays the evidence
   for exactly one digest.
