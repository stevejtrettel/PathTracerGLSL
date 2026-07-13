# The measurement bench — making the instrument measure itself

**Author:** Fable (July 2026) · **Status:** REVIEWED & PARTIALLY BUILT (July 13 2026).
The owner cut this proposal down on review; the built subset is §2.1 + §2.4 + stamps:

- **BUILT — witness runner** (`npm run witness`, `tools/witness.mjs`): machine-readable
  `witness` specs beside the `expected` prose in the suite registry; headless SwiftShader
  renders read LINEAR floats via `readExport('hdr')`; check kinds `mean` / `equality` /
  `twin` / `noise`. All numeric witnesses reproduce (furnace 0.4000, F-ETA 0.5541, slab
  3-channel, F-BOX-M, furnace-sky ρ·L + L). Equality gates: Δ frame-mean in linear HDR
  (bias) + noise-normalized χ² (structure; requires the variance occupant) for arms with
  shared event coverage, or a calibrated display-space RMSE tripwire for chance-hit pt
  arms — see the `WitnessCheck` doc comments for why both exist.
- **BUILT — variance occupant** (`components/film/accumulate_variance/`): Welford δ·δ′,
  one MRT double_buffer (mean+moment swap in lockstep), `variance` export target at
  attachment 1. Witness: mean untouched (Δmean 0.00%, display-rmse 0.02% vs `average`).
  Powers the runner's χ² gate and `noise` checks — the equiangular halo win reproduces
  as σ/µ 18.05% vs 21.24% at 192spp; veach measures pt-mis 4.43% < pt 9.99% < pt-nee
  11.64% (assertFirstLowest).
- **BUILT — reproducibility stamps**: HDR header comments + PNG tEXt chunks carrying
  scene / strategy JSON / parameters / spp / resolution / resetSalt / git hash / date
  (`App.buildRenderStamp`); `pinResetSalt` reproducible mode.
- **CUT — §2.2 compare mode**: its "display composition only" premise is false — the
  engine runs ONE active pipeline and no API lets a draw sample another renderer's
  textures; needs a deliberate engine-surface discussion if ever wanted. The runner's
  numbers replace most of its research value.
- **DEFERRED — §2.3 probe integrators**: to their first consumer (heterogeneous-media
  or camera bring-up), per owner review.

Found along the way (not fixed here): `exportPNG` requires an `ldr` export target that
`buildExportTargets` never defines — PNG export is currently dead for all standard
renderers; the equiangular χ² vitest ("long segment") is flaky under parallel load.

The original proposal follows, unedited.

## 1. Where the project stands (one paragraph)

The production side is done and proven: `src/components/` is the leaf library of
swappable research code (materials/lights/phase/geometry/ambient/transport/env/
sampler/camera/film — every occupant one folder with descriptor + optional math md;
family READMEs are the contracts), the compiler emits function-shaped bespoke programs
(fable-transport-glsl-target.md), and a new sampling technique/material/etc. is one
folder + one registry line — proven by GGX and equiangular NEE. The gap is the
**measurement side**: comparing estimators is still keys-1-through-9 and eyeballs.
Every experiment this session (veach MIS behavior, equiangular's −19% halo noise)
needed throwaway headless scripts. This plan turns that into infrastructure — the
difference between a renderer you do research *on* and an instrument you do research
*with*.

## 2. What to build (one batch, four reinforcing pieces)

### 2.1 Variance accumulation occupant
The reserved second occupant of `film/accumulation`: alongside the running mean, keep
a second-moment buffer (`accumulation` already owns the ping-pong pipeline; this
occupant declares one more buffer — the resource-contribution machinery supports it).
Per-pixel variance ≈ (M₂ − mean²)/n. Estimator section; the mean is untouched
(witness: same converged image as `average`). This is the primitive everything below
reads.

### 2.2 Compare mode in the lab
A lab view rendering TWO strategies of the current scene side by side:
A | B | amplified difference (k·(A−B) + 0.5, k live-tunable) | variance overlay.
App-layer only — two renderers already load simultaneously (keys); this is display
composition, no compiler work. The §11.2 equality witness becomes something the owner
*sees*: converged A−B must go gray everywhere, and "which estimator is noisier where"
becomes visible structure. Respect the engine boundary: the engine stays blind; the
app orchestrates which renderer draws into which viewport/target.

### 2.3 Probe integrators
A trivial walk in `transport/integrators/` with an EMPTY technique roster that scores
a local quantity instead of radiance: normals, depth, `region_owner` /
`current_medium` id (as color), self-heal repair count (§11.4), bounce count. One
generated walk + a measurement axis value (probes change the integral by definition —
declare them measurement-side, they never converge to radiance). Pays twice: debug
views for every future component bring-up, and the §11.3 GPU histogram harness is a
probe walk (the TS-twin form exists — `ggx.test.ts`; the GPU form closes the loop on
actual shader code). Also dogfoods the integrator slot: second occupant → the
strategy-level integrator axis it's been waiting for.

### 2.4 The witness runner
`npm run witness`: headless chromium (SwiftShader — the recipe is proven and lives in
`.claude/skills/verify/SKILL.md`), render every suite card that has an `expected`,
assert the NUMERIC ones automatically (furnace = 0.4 linear, F-ETA = 0.5540, slab
per-channel numbers, three-way convergence RMSE < threshold at N spp, X-CHART
agreement), print a pass/fail table. validation-scenes §7 sketched exactly this
("start manual, automate when the suite stabilizes" — it has stabilized). Structured
`expected` data can live beside the prose field in the suite registry (e.g.
`expectedNumeric: { kind: 'uniform-linear', value: 0.4, tol: 0.01 }`) so cards state
their pass criteria machine-readably; keep the prose for humans. NOT in vitest/CI by
default (minutes-long, GPU) — a separate command the owner runs before/after
transport-adjacent batches.

### Alongside (small): reproducibility stamps
Embed scene id + full strategy JSON + sample count + git hash in HDR/PNG export
metadata; add the pin-the-salt reproducible mode (contracts note it as a trivial add —
`resetSalt` is already the only nondeterminism). Every figure knows what produced it.

## 3. Priorities and sequencing

2.1 → 2.4 first (variance + witness runner: the measuring core), then 2.2 (compare
view reads the variance buffer), then 2.3 (probes; the §11.3 GPU form last). Stamps
whenever. Each piece lands with its own witness: variance occupant (same mean as
average), compare view (converged A−B gray), probes (normals view on cornell), runner
(reproduces the known numbers).

## 4. What NOT to do

- Don't put GPU witnesses in vitest — the split (structure in vitest, GPU behind
  `npm run witness`) is deliberate; glslang stays the static gate.
- Don't leak any of this into the engine — it executes blindly (`CompiledRenderer`
  in, pixels out); compare/probe/variance are app + compiler + components work.
- Don't build the scene-authoring DSL / presets / parameter-sweep runner in this
  batch — that's the NEXT discussion (contracts §10.2; the owner wants it eventually,
  and sweeps+contact-sheets should be designed WITH the authoring layer). Don't mix.
- Don't start the docs/ folder reorganization here either — flagged by the owner as
  its own discussion (prerequisite for the derivation compendium).
- Known research features (multi-material objects / R-CUP, heterogeneous media,
  spectral, H³) are content, not bench work — their seams already exist.

## 5. Owner working style (for the next session)

Discuss structure before implementing; open at the high-altitude "what are we doing"
level with cost tables — never open with math-deep detail. Commit to one position,
no A/B/C hedging. One invariant per batch, with its proof named up front (this repo's
proofs: byte-identity for moves, token/witness equality for refactors, named numeric
witnesses for features). Don't mix refactors with feature work. Read
`docs/fable-*.md` before designing — most "open" questions are already pinned.
