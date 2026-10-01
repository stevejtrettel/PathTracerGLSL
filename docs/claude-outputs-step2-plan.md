# Step 2: variance becomes an option of `average` (outputs and accumulation plan)

**Date:** 2026-09-30
**Status:** Built 2026-09-30. Every prediction held; the results are in the CHANGELOG.
Part of `claude-outputs-accumulation.md` §1, §2 and §9. Baselines at commit `d77a28a`:
`.digest/step1-commit-frames`, and `.digest/step1c.json` with `.digest/step1c-keep`.

## Why

Today, recording the variance means *choosing a different averaging mode*,
`accumulation: { type: 'variance' }`. But variance doesn't change how samples are averaged:
the mean is byte-identical to `average`. It is a statistic recorded alongside. Tying it to
the mode is why "oneshot with variance" is meaningless, and why the witness runner has to
swap a strategy's mode to read a variance.

This step changes only **how variance is declared**:

```ts
accumulation: { type: 'average', variance: true }
```

The machinery behind it (the five places that test for variance, the hand-written mains)
is generalized in steps 3 and 4, not here.

## The change

| Where | Change |
|---|---|
| `src/compiler/types.ts:745-746` | `AccumulationDescription` gains `variance?: boolean`, documented as "also record the per-pixel sample variance (a statistic; supported only by modes whose descriptor lists it)". |
| `src/components/accumulator/index.ts` | `variance` is no longer a mode. The descriptor gains `statistics`, the data each supported statistic needs. `average` lists `variance`, with the main that also updates it (today's `variance/variance.glsl`, unchanged) and `readsMoment: true`. `oneshot` lists none. The `variance/` folder stays where it is, as the variance statistic's GLSL, until step 4 generates `main()`. |
| `src/compiler/generate/features/accumulation.ts` | Picks the main and the previous-frame inputs from the statistic's data when `variance` is on, otherwise from the mode. The block's origin string stays `components/accumulator/variance/variance.glsl`, so the source maps are unchanged. |
| `src/compiler/plan/Planner.ts:581, 695` | Records `variance: true` in the program's accumulation only when it is on (omitted otherwise, like `emissionCones`), and reads it where it read `type === 'variance'`. |
| `src/compiler/generate/Generator.ts:22` | Reads `accumulation.variance === true` instead of `type === 'variance'`. |
| `src/compiler/analyze/Validator.ts:1021` | The type must still be a registered mode. `variance`, if present, must be a boolean. `variance: true` is an error unless the mode's descriptor lists `variance`, with a plain message such as "accumulation 'oneshot' does not support variance". `type: 'variance'` is now an unknown mode, with an error that says to use `{ type: 'average', variance: true }`. |
| `tests/witnesses/scenes/furnaceBox.ts:76` | `furnaceVarianceStrategy` uses `{ type: 'average', variance: true }`. Its id `furnace-var` is unchanged, so its renderer id is unchanged. |
| `tools/witness.mjs:351, 814` (the runner's forced variance, and the frame tool's `variance-noisy` case), `pages/scene-lab.ts:101` (the witness-cache digest) | Force variance as `{ ...accumulation, variance: true }`, keeping the strategy's own mode. |
| `tests/compiler/validator.test.ts:142` | Updated, plus new cases: `average` + variance accepted; `oneshot` + variance rejected; `type: 'variance'` rejected with the hint; a non-boolean `variance` rejected. |
| `tests/components/colorContract.test.ts:42` | Iterates the three configurations: `average`, `average` + variance, `oneshot`. |
| Comments and docs | `tests/witnesses/types.ts:102`, the runner's comments at `tools/witness.mjs:299-306` ("the 'variance' occupant"), `src/components/accumulator/README.md` (variance is a statistic of `average`), `variance/variance.md`, and the "accumulators average / variance / oneshot" line in CLAUDE.md's Status (one line, with the owner's approval). |

**Not changed:** the variance GLSL, the pipeline and exports it produces, and the witness
cache's mode label `'variance'` in `tools/witness.mjs:100, 314`. That label names a kind of
render, not the strategy field.

## Verification, with the prediction written first

**Prediction.** The compiled output is unchanged for every suite scene, including the
furnace's variance renderer: same id, same main, same pipeline and exports, same source
maps. Every picture is bit-identical. Only the program description of `furnace-var`
changes, from `{ type: 'variance' }` to `{ type: 'average', variance: true }`.

1. `npx tsc --noEmit` clean; `npx vitest run` has the same counts plus the new Validator
   cases.
2. **The digest.** `npm run digest -- .digest/step2.json --keep .digest/step2-keep`, then
   `--compare .digest/step1c.json .digest/step2.json`: **268 of 268 scenes identical.**
3. **Snapshots.** `generated-glsl.snapshot` unchanged. In `program-description.snapshot`,
   only the `furnace + variance` entry changes, and only in its accumulation field.
4. **The frames.** `frames record .digest/step2-frames`, then
   `compare .digest/step1-commit-frames .digest/step2-frames`: 18 of 18 identical.
5. `git grep "type: 'variance'"` → 0 hits.
6. **A minimal witness run** (about a minute, under `caffeinate -i`):
   `npm run witness -- furnace two-light`. The furnace checks the variance strategy's mean.
   `two-light` runs an equality check, which goes through the runner's forced-variance
   path (`renderVarianceOnce`).

## Not in this step

- Generalizing the extra outputs into a list (step 3).
- The generated `main()` (step 4).
- Moving `variance/variance.glsl`.
