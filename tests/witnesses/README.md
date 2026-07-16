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

## Adding a witness

One fixture file (or a new export in an existing family file) under `scenes/` with
the derivation in comments, plus one entry in `index.ts` with `exercises`/`expected`
prose and the `witness` block. Budgets: default 160×120; pick `spp` so mean checks
have ~10× tolerance headroom and χ² arms are past the transient. Calibrate any
`rmse` threshold by running the check and setting ~1.5× the measured value.
Witness protocol for derived-number scenes: RR off, no unrelated features.
