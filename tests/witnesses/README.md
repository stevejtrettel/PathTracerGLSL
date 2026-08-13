# witnesses/ — the GPU witness system

The durable, executable form of `docs/fable-validation-scenes.md`: every derived
number and convergence equality the project has proven, as fixtures + machine-readable
checks that `npm run witness` (tools/witness.mjs) renders headless and asserts.

**This is NOT the demo gallery.** `demos/` is the replaceable layer —
scenes made while building and testing, free to churn or be deleted. Everything a
witness needs (scene, strategies, checks, camera pose) is owned HERE, under
`scenes/`, so no demo churn can silently lose a regression test. The dependency
direction is one-way: demos may import witness fixtures (the gallery merges
`witnessSuite` into its display registry, so every witness stays viewable in the
lab), but nothing here imports from `compiler/scenes/`.

## Layout

- `index.ts` — `witnessSuite`: one entry per witness scene (entries without checks
  are fixture partners — a twin's other half, kept here so twin scene-id references
  can never dangle).
- `types.ts` — `WitnessCheck`/`WitnessSpec` (the check vocabulary) + `SceneSuiteEntry`.
- `scenes/` — the fixtures: scene + strategy definitions, with their derivations in
  comments (why 0.4, why RR is off, what a failure implicates).

## Known failing witnesses — the Aug 12 2026 sweep

**Read this before diagnosing a red row.** The suite is not expected to be all-green: ten checks
fail, in four unrelated groups, and every one is a standing marker for real work rather than an
oversight. If your change did not touch these areas and these are the only reds, you have not
broken anything.

Sweep result: **153 exact checks — 143 passed, 10 failed; 1 cross-check, agreed.**

### A. The four GRIN furnaces — a ~25% energy loss, cause NOT established

| witness | measured | expected |
|---|---|---|
| `grin-furnace` | 0.3004 / 0.3065 / 0.3179 | 0.4 |
| `grin-furnace-emit` | 0.2960 | 0.4 |
| `grin-furnace-scatter` | 0.2949 / 0.2951 / 0.2953 | 0.4 |
| `grin-furnace-hard` | 0.3067 | 0.4 |

All four are furnace-conservation gates on the variable-IOR walker (design + derivations:
`docs/fable-variable-ior.md` §6). All four are low by 23–26% with the same signature, which
suggests **one** defect in the walker rather than four, and 25% is far too large to be an epsilon
or a truncation. `grin-furnace` in particular is documented as catching
"weight/absorption/bounce-starvation/coexistence breaks", so it is doing its job.

These were already failing on the Aug 10 sweep. Three of the four (`-emit`, `-scatter`, `-hard`)
had never been run before that; `docs/fable-variable-ior.md:11` still records them as awaiting
their first sweep. **Nobody has investigated the deficit.** That is the honest state — treat the
attributions in older session notes as unverified.

### B. `softbeam-wall` core — +3.34%, a normalization, not an estimator

`F-SOFTBEAM core ρ·Le·sin²δ` reads 1.0326 against 0.9992. The excess is shared by the `nee` and
`mis` arms (their equality check passes at χ² 0.01), so it is a bias in the emitted `Le`
normalization for the finite-divergence softbeam kind, not an estimator defect. From the Aug 9
beam batch; unchanged since. The other two `softbeam-wall` checks pass.

### C. `slab-albedo` — RESOLVED (Aug 12 2026): the epsilon batch closed it, GREEN at the exact values

Kept as the worked example of the red-and-documented discipline paying off. The four exact
plane-albedo checks were low by 2.7 / 1.9 / 1.1% at µ = 1, rising toward grazing — a **real
renderer bias** in the world-space surface-proximity constants. The resolution arc, in order:

- Diagnosis: **`docs/fable-epsilon-discipline.md`** (the graded investigation), then settled by
  measurement — a CPU walk mirroring the renderer's exact algorithm reproduced **all nine** dense
  measurements to ~1σ and split the bias roughly half/half between J1 (the `ray_spawn` normal
  offset) and J2 (the primitives' `t > EPSILON` acceptance floor + the walk's unrepaired
  fictitious-medium continuation), **interacting** (J1 masks J2 ⇒ one fix, never half).
- The falsifier: `slab-albedo-sparse` confirmed tenfold density scaling on cue (and caught its own
  first-version width bug — blue leaked out the sides; lateral margins now pinned by
  `slabAlbedo.test.ts`).
- The fix: **`docs/impl-plan-epsilon-discipline.md`** (rewritten by a six-agent adversarial audit
  before build) — provenance-based offsets (`Hit.eps`), fp-relative analytic tier, `t > 0` floors;
  mesh/marched/GRIN/shadow kept their magnitudes as named derived constants; `EPSILON` deleted.
- Post-fix filtered sweep (owner, Aug 12): **all rows green at the exact Chandrasekhar values** —
  including the interior-roulette arm (step 2's gate) and the aniso cross-check.

The expected values were never loosened along the way — hiding a measured bias behind a tolerance
is how the next real defect gets missed. Full-suite re-gate after the batch is the remaining step
(every program's frames changed: pt tripwires recalibrate).

### D. `cube-cloud` — a hang, not a slow render

`ERROR: page.waitForFunction: Timeout 120000ms exceeded`. Investigated Aug 12, headless
SwiftShader, not resolved:

- the page loads in ~1 s, then **`window.app` never appears** — 400 s budget, still nothing;
- `page.evaluate` afterwards never returns, so the **main thread is hard-blocked**, which rules
  out "slow but progressing";
- the **compiler is not the problem**: `Compiler.compile` produces the 1361-line program in 45 ms;
- the emitted GLSL contains **no unbounded loops** — only the bounce loop (its twin `cube-cloud`
  renders fine in 3.6 s and does have the TLAS `while` walks);
- `cube-cloud-ref` is the half that hangs — 24 individually transformed rotated boxes as separate
  analytic objects, from the Aug 10 stage-4 batch. It had never been swept before this run.

Remaining suspect is SwiftShader's synchronous shader JIT on a 25-object unrolled program, which
would make it environment-specific rather than a renderer defect — **unverified**.

## Tiers: where a `mean` check's expected value came from

Until Aug 2026 every expected value here was a pen-and-paper number, so provenance never
needed saying. The subsurface work introduced expectations produced by a reference
implementation, and those are not the same kind of claim — so `kind: 'mean'` now carries an
optional `source`, and the runner reports the two tiers apart.

- **`exact`** (the default; every check written before the field existed) — the value is exact
  mathematics. Evaluating it in your head (`furnace = E/(1−ρ) = 0.4`) or iterating it to
  fourteen digits (Chandrasekhar's `H`, `tests/helpers/halfspace.ts`) does not change its kind.
  **A miss is a renderer bug.** Reported `FAIL`.
- **`cross-check`** — the value comes from a second, independent implementation of the same
  physics, with a statistical error of its own: a CPU Monte-Carlo reference for a configuration
  that has no closed form (anisotropic scattering, say). **A miss means the two disagree and
  both are suspects.** Reported `DISAGREE`, counted separately, and still non-zero exit.

Rules:

- A `cross-check` row **must** state `source.refTol` — the reference's own uncertainty. The
  runner adds it to `tol` (the render's noise budget) rather than letting a fixture merge them,
  so the table shows both halves and no defect can hide inside one fat number.
- `source.from` is one line naming the derivation or the reference; it prints in the row.
- **A reference must itself be gated.** `halfspace.ts` is pinned by `halfspace.test.ts` against
  single-scattering limits derived on paper, Chandrasekhar's moment identity, and the
  conservative constants — a reference nobody checks is a second opinion, not a reference.

## The gate policy (read before adding an `equality` check)

Every equality/twin check asserts a **bias gate** — pairwise |Δ frame-mean|/mean in
LINEAR HDR (`meanTol`) — plus exactly one **structure gate**:

- **χ² (default, parameter-free)**: arms re-render with the variance accumulation
  occupant; the runner computes per pixel-channel (a−b)²/(σ²ₐ+σ²ᵦ) against the
  MEASURED variance of each mean, averaged over the frame. Same integrand ⇒ ≈1 at
  any sample count; fireflies self-normalize. **Valid only when both arms share
  event coverage** (nee≡mis, sampler/placement/chart pairs).
- **`rmse` (opt-out)**: display-space (l/(1+l)) per-pixel RMSE on plain renders,
  threshold calibrated ~1.5× the measured noise floor at the declared budget.
  Required for:
  - **chance-hit pt arms** — their empirical variance cannot see rare events never
    sampled (a pt arm that never found the small light in 192spp has v=0 there and
    a systematically different mean → χ² explodes on pure noise);
  - **cross-backend twins** — marching vs closed-form differ deterministically at
    silhouette pixels; the converged IMAGES agree, the per-sample estimators don't;
  - **identical-stream arms** (average vs variance occupant) — χ² degenerates 0/0.

  A pt tripwire is deliberately loose: it catches gross breaks; converged pt
  equality remains the owner's GPU check (say so on the card).

## The render cache

Because renders are deterministic (pinned salt, below), a frame is a pure function of
its inputs, and the runner memoizes it: `.witness-cache/` (gitignored) stores FRAMES
keyed by sha256 of (per-pair compiled-shader digest + scene/strategy/initialParameters
JSON [computed in-page by `__witnessDigest`] + a global hash of `src/**/*.ts`,
`src/glsl/shared/*.glsl`, and `public/` assets + size + spp + salt + mode).

- **Frames are cached, never verdicts** — editing a check/gate re-evaluates against
  cached pixels with no invalidation needed.
- **Granularity**: a component/core `.glsl` edit invalidates exactly the scenes whose
  EMITTED shaders change; any `.ts` edit under `src/` invalidates everything (coarse
  but sound — uniform compute closures live in TS and are invisible to shader
  sources); `glsl/shared/` is globally hashed because the env-bake template compiles
  outside the per-pair digests.
- `--no-cache` skips reads (still writes) for a paranoid full re-render.
- A no-change sweep re-renders nothing; a post-batch sweep re-renders only affected
  scenes.

## Determinism: the pinned salt

The runner pins `resetSalt` (`WITNESS_SALT` in tools/witness.mjs) for EVERY render —
§2.11 reproducible mode. Two consequences:

- **Identical-stream checks are valid.** Unpinned, each page's salt depends on how many
  accumulation clears its lifecycle happened to run (selecting the already-active
  strategy-0 renderer vs switching renderers differ), so two arms of a near-zero-rmse
  check could silently land on different salts — thinlens-zero once read 26% rmse of
  pure decorrelated noise while the pinned arms are bit-identical at 512spp.
- **Chance-hit pt frame means are ONE fixed realization.** They are heavy-tailed
  (a single firefly can move a 160×120 frame mean by ~2%; sky's pt arm ranged 2–13%
  across salts), so their `meanTol` gates are calibrated AT the pinned salt and mean
  nothing at any other salt. Changing `WITNESS_SALT` re-rolls every pt tripwire —
  recalibrate them if you touch it.

## Perf checks (`--perf` mode)

`kind: 'perf'` rows measure **ms per accumulation frame** and run ONLY under
`npm run witness -- --perf` — a separate mode with a separate browser: the numeric
sweep deliberately uses SwiftShader (deterministic software rasterizer, cacheable
frames), but timing a software rasterizer misjudges bandwidth-bound work, so perf
launches the REAL GPU (ANGLE Metal on macOS; the runner prints the GL renderer string
first, and warns loudly on a SwiftShader fallback — rerun `--headed` for guaranteed
hardware). Methodology: warmup frames outside the clock, then 3 timed batches via
`extendProduction` (steady-state accumulation, no resets), each closed by an hdr
readback as the sync barrier; the row reports the MEDIAN ms/frame plus all batches.

Policy: perf rows are **report-only** (always PASS — milliseconds are machine state,
never a sweep gate) and never cached. The numbers are read across adjacent rows:
`perf-cloud` vs `perf-cloud-frame` is the placement-record-tier delta; future accel
occupants (wide/compressed BVH nodes) add arms to the same fixture. Run perf alone on
a quiet machine and compare within one run, never across machines or days.

## Adding a witness

One fixture file (or a new export in an existing family file) under `scenes/` with
the derivation in comments, plus one entry in `index.ts` with `exercises`/`expected`
prose and the `witness` block. Budgets: default 160×120; pick `spp` so mean checks
have ~10× tolerance headroom and χ² arms are past the transient. Calibrate any
`rmse` threshold by running the check and setting ~1.5× the measured value.
Witness protocol for derived-number scenes: RR off, no unrelated features.
