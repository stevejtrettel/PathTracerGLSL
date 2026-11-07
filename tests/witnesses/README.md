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

## Colour primitive checks

`npm run witness:color` runs the shipped colour GLSL directly in headless Chromium/SwiftShader,
without a dev server or scene. It uses the same Playwright installation as the scene runner.
It checks reductions and channel selection at N=2,3,4, signed/HDR RGB projection, and a
nonidentity sensor response. Three deliberately broken shaders must compile and then fail
the numerical assertions: divide by three, select only three channels, and bypass the sensor.
This is a repeatable primitive gate, separate from the scene witnesses and static Vitest checks.
It runs before the scene sweep in the existing opt-in GPU CI job.

`npm run witness:wavelengths` compiles small scene fixtures, then executes their generated GLSL
with a test-only carrier containing four distinct wavelengths. It checks all six cameras,
a wavelength-dependent camera through the accumulator, arrival/spawn/copy, placed analytic
and marched geometry, properties/defaults, light and sky reads, the RGB-before-lift medium
clamp, phase continuation, medium shadow spawning/null crossings and the GRIN gradient/handoff.
Camera and current-ray carriers differ. Camera/placement uniforms have valid inputs, skies
have nonzero intensity, and the light row reads the actual packed texture. Deliberate carrier
loss/substitution, discarded packed RGB and conversion errors must compile and fail numerical assertions.
These probes use test-only observable evaluations, not a physical spectral colour model.
They share the standalone float-framebuffer runner with `witness:color` and run in GPU CI.

## Curved-space witnesses (H³)

`scenes/h3Witness.ts`: `h3-furnace` (six emissive planes, every path Σ_{k≤6} 0.8^k, pinhole and
fisheye), `h3-disk-light` (a lambert disk receiver under a disk light of geodesic radius 1.2, large
enough that a Euclidean inverse-CDF radius would be off by about 4.5%) and `h3-point-light` (the
same receiver under two point lights, power and uniform selection), against closed forms integrated
over the readout window; `h3-medium` (a scattering ball and a floor, pt = pt-nee = pt-mis, with the
light out of frame so the frame mean is the ball and the floor); `h3-sky` (the sky 1 + key read at
each camera ray's ideal endpoint, pinhole and fisheye); `h3-sky-ball` (a lambert ball under a
constant sky reads ρ·L; its {param}-driven placement must put it where the frame mean says). The
expected values are computed by the fp64 twin `scenes/h3Twins.ts`; `h3Twins.test.ts` recomputes
them and checks the twin against the on-axis closed form, an independent Monte Carlo estimate, the
limit that defines the sky key and a marched ball test. Not yet in a full sweep.

## Curved-space witnesses (S³)

`scenes/s3Witness.ts`: `s3-furnace` (six emissive great spheres, every path Σ_{k≤6} 0.8^k, pinhole
and fisheye), `s3-long-arc` (a lambert disk receiver lit only through the long arc by a disk light of
geodesic radius 1.2 facing away from it; a Euclidean radius map would be off by about 3%) and
`s3-point-light` (the same receiver under point lights above and below it, power and uniform
selection), against closed forms integrated over the readout window; `s3-long-arc-blocker` (an
opaque ball about −o on every long arc from the window, beyond the short-arc distance: 0 under every
estimator; a shadow ray searched only to d reads 0.451 under pt-nee); `s3-medium` (a scattering ball
lit by two disk lights out of frame, one reachable only through the long arc: pt = pt-nee = pt-mis;
applying the one-sided arc rule at medium events moves pt-nee 67% away from pt). The expected values
are computed by the fp64 twin `scenes/s3Twins.ts` (space-free parts in `scenes/curvedTwins.ts`);
`s3Twins.test.ts` recomputes them and checks the twin against the on-axis closed form, an
independent Monte Carlo estimate, the blocker's position on every long arc and the lights' absence
from every camera ray's geodesic. Not yet in a full sweep.

## Curved-space witnesses (box, cylinder, quad, quad light)

`scenes/curvedShapesWitness.ts`: `h3-shapes` and `s3-shapes` (a rotated lambert box, a tilted
cylinder and a quad under a point light, pt-nee; readout windows inside single lit faces — a box
face, the tube, a cap, the quad, and in S³ a box face lit only through the long arc — against
(ρ/π)·Σ_arcs I·max(0, cos θ)·visibility/S(d)² at the first hit, within 0.5%), `h3-quad-light` and
`s3-quad-light` (the H³/S³ direct-lighting receiver under a quad light, in S³ facing away so only
the long arc lights it; pt-nee, pt-mis and pt against the window mean of the quadrature over the
quad). The expected values are computed by the fp64 twin `scenes/curvedShapeTwins.ts`;
`curvedShapesTwins.test.ts` recomputes them, checks each window lies inside its one lit face, and
checks the quad quadrature against an independent cosine-sampled estimate; the twin's intersectors
and normals are checked against marched membership by tests/components/curvedShapes.test.ts. A
shapes window does not see a normal's sign (the hit fill turns the normal toward the arriving ray).
Not yet in a full sweep.

## Curved-space witnesses (H²×R)

`scenes/h2xrWitness.ts`: `h2xr-furnace` (a box of four vertical and two horizontal planes holding an
emissive ball and column, every path Σ_{k≤6} 0.8^k, pinhole and fisheye; it checks bookkeeping, not
where a surface is hit), `h2xr-disk-light` (a lambert disk receiver under a horizontal disk light of
radius 1.2 off to the side, pt = pt-nee = pt-mis against the closed form; the d² density would read
0.547, sinh² d 0.336 and the Euclidean radius map 0.511 against 0.499), `h2xr-point-light` (two
oblique point lights on five windows: the disk, a vertical wall, a ball placed with a height and a
rotated offset center, a column's wall and top cap; the d² density moves every window by 0.014 to
0.036), `h2xr-sky` (black shapes under the sky 1 + key from a camera 1.2 from o: every silhouette, the
{param}-driven ball placement and the key; the view direction as key reads 0.10 in red against 0.29,
the ball without its height shift 0.302). The expected values are computed by the fp64 twin
`scenes/h2xrTwins.ts`; `h2xrTwins.test.ts` recomputes them, checks the windows (covered, unshadowed)
and the wrong models' values; `tests/components/h2xr.test.ts` checks the twin's formulas against an
ODE integration, finite differences of exp, Monte Carlo ray hits and sphere tracing. Not yet in a
full sweep.

## Closed-manifold witnesses (Seifert–Weber)

`scenes/seifertWeberWitness.ts`: `seifert-weber-windows` (three emissive spheres of different
colors in the dodecahedral domain, pt, maxBounces 0, farClip 6; eleven pixel windows that the
float64 twin `tests/helpers/seifertWeberTwin.ts` certifies, by brute force over the sphere images in
the cover with a one-pixel margin, as seeing one sphere through 0, 1, 2 or 3 face crossings, or
nothing within the far clip, so each reads that sphere's emission exactly, or 0) and
`seifert-weber-lights` (a disk light near face 0 facing the face, so D is lit mostly by its copies
across the faces, and three lambert balls; pt = pt-nee = pt-mis, maxBounces 3, farClip 8).
`seifertWeberWindows.test.ts` re-derives every window from the scene as authored. Each can fail:
with a twist of 1/10 turn in place of 3/10, 6 of the 11 windows read wrong (the twin predicts the
five crossing windows; the other two crossing windows lie on a face path along which the two twists
agree, since they differ by a symmetry of D); with the image index off by one (`first_face` for
`1 + first_face`) the frame means differ by 2.6%. Under the pinned salt pt-nee and pt-mis
draw the same numbers, so their χ² stays near 0 even then; the mean gate is what catches it.

Both scenes carry a `walk-counter` row (report only): the runner adds counters to the program's
own Seifert–Weber walk (`renderWalkCounter` in tools/witness.mjs, at fixed anchors in the generated
text, failing if one is missing) and reports the segments that reached the crossing cap, the most
faces one segment crossed, and the largest constraint drift after a crossing. With the cap set to
6 it counts 24,880 capped camera segments, so it can count.

## Known failing witnesses — current (Sep 25 2026 sweep)

**Read this before diagnosing a red row.** Full sweep after the Sep 25 fixes (CHANGELOG.md):
**181 exact checks — 180 passed, 1 failed; 1 cross-check, agreed.** The one failure:

- `cube-cloud` — the render does not finish in time, section D below.

Resolved Sep 25: the four GRIN furnaces (section A — lenses rendered black, a region/material
id mix-up in the walker's exit test) and `softbeam-wall` (section B — an under-sampled check,
not a bias). `slab-albedo` (section C) was resolved in August. New since Sep 24 and in that
sweep: `tiny-sphere`, `tiny-sphere-light`, `sun-haze`, `fog-area-ignored`, `instance-lights-sky`
(each fails on the code before its fix).

**Not yet in a full sweep.** The sweep ran at commit c5f3543. The transport changes after it
(`Hit.ng`, the mesh margin, `maxNullCrossings`, the GRIN roulette, the derived tracking bound,
shadow rays aimed at the light point) had targeted runs only, and these witnesses were added with
them: `mesh-light-smooth`, `mesh-slab-albedo`, `mesh-scale-twin`, `null-budget-view`,
`null-budget`, `grin-long`, `shadow-aim-march`, `shadow-aim-far`, `shadow-aim-fog`,
`emit-sat-budget`. Also added after it, with targeted runs only: `filter-edge` and the
gaussian arm of `furnace` (the pixel filter); `bokeh-edge` and the six-blade arm of
`thinlens-zero` (the bladed pupil).

**`cube-cloud` (updated Sep 25).** Since the lab page stopped starting its own render loop
under the runner, the runner takes control immediately; the failure is now the RENDER not
finishing within 8 minutes — consistent with a very long SwiftShader shader compile of
cube-cloud-ref's 25-object program (sdf-table-twin's unrolled arm compiles in ~110 s).

**Runner flake.** A check can report `ERROR: page.evaluate: TypeError: Cannot read properties
of undefined (reading 'readExport')` — the page's `app` was not ready when the runner read
back. It hit a different check on each of the two Sep 24 sweeps and never on a re-run of the
same scene. Re-run that scene before treating the row as red.

**GRIN spawn floor — RESOLVED (Oct 1 2026, docs/claude-grin-spawn-floor-plan.md).** In any
program with a GRIN medium, every fp-accurate spawn was floored at 0.001, so every medium segment
after a crossing skipped its first 0.001 (a 0.015 slab read 0.01400 thick, GRIN or not, whenever a
GRIN object was in the scene). The floor is removed. `guides-grin-substep`, `-substep-scatter`
and `guides-grin-elsewhere` gate it at the exact geometric transmittance.

**Several GRIN materials with NEE are extremely slow (open item, Oct 1 2026).** A scene with
four GRIN materials rendered with NEE took over 9 minutes for ONE sample on SwiftShader (each
GRIN material alone: 4–14 s per sample; no scene in the suite has more than one GRIN material).
Cause unknown; the guides witnesses therefore use one GRIN material per scene.

**The sky through the Luneburg lens reads 0.1% dark (open item, Oct 1 2026; no witness yet).**
In `grin` (a lossless Luneburg lens, n = 1 at its 'none' wall, under a constant sky), a pixel
that sees the sky through the lens must read exactly the sky: radiance is invariant through a
lossless region whose index is 1 at both ends. Measured over 1704 deterministic pixel-channels
(256 spp, salt 1234): −0.096% mean (largest 0.133%). Before the spawn floor was removed it read
+0.293%. Expected cause, not yet measured: the interior (n_in/n_out)² factor takes n_out from |T| at
the last drift, inside the wall rather than at it (grin.glsl, grin_finish); the floor's deeper
entry point had partly cancelled that.

**`torus-lights-fog` (open items, Nov 7 2026).** Registered at 1,024 spp: at 256 spp the
nee/mis/mis-bvh mean gap read 0.94% against the 1% gate, a margin that any change in how many
random numbers the program draws could cross; at 1,024 spp it reads 0.33%. Its χ²ᵣ rose from
1.27 (256 spp) to 1.45 (1,024 spp); whether the excess is fireflies or a small bias is untested
(compare the open roughness-0.15 pt-nee deficit in the 3-torus, CLAUDE.md). This witness does
not catch a missing `quotient_reduce` at medium event points: with the reduction removed from
the generated loop it still passed (Δmean 0.28%, χ²ᵣ 1.37, pt rmse 11.20%). No check catches
that error yet.

**Thin dielectrics are one-sided (open defect, no witness yet).** On a FRONT-face hit of a
zero-thickness surface the dispatcher reports `region_to` = the surface's own region, which
carries the material's index, so a thin glass sheet refracts as if entering glass and never
exits (bent, darkened by η²); from its back both sides are air (η = 1). The same asymmetry is
what makes quad lights one-sided. The Validator's thin-surface warning ("will refract as
η = 1") is only true from the back. `rough-sheet` deliberately views its sheet from the back.

## The Aug 12 2026 sweep (historical record)

At the time the suite was not expected to be all-green: ten checks failed, in four unrelated
groups, each a standing marker for real work rather than an oversight. The current state is
the section above.

Sweep result: **153 exact checks — 143 passed, 10 failed; 1 cross-check, agreed.**

### A. The four GRIN furnaces — RESOLVED (Sep 25 2026): GRIN regions rendered black

| witness | before | after the fix | expected |
|---|---|---|---|
| `grin-furnace` | 0.3004 / 0.3065 / 0.3179 | 0.3989 / 0.3994 / 0.3996 | 0.4 |
| `grin-furnace-emit` | 0.2960 | 0.3997 | 0.4 |
| `grin-furnace-scatter` | 0.2949 / 0.2951 / 0.2953 | 0.3997 / 0.4001 / 0.4002 | 0.4 |
| `grin-furnace-hard` | 0.3067 | 0.4000 | 0.4 |

Not an energy loss: rendering `grin-furnace-hard` showed the lens itself nearly black (pixel
mean 0.07) with the rest of the frame at ~0.38, and the lens covers about a quarter of the
view. Cause: the walker's exit test compared `scene_region_at(p)`, a REGION id, with `med`,
which the dispatcher passes as a MATERIAL id. In these furnaces the lens is region 6 (after
the six wall planes) but material 1 or 2, so the walker "left" the lens on its first step,
rewound to just outside, re-entered, and repeated until the bounce budget ran out. Every GRIN
demo and the GRIN twins happened to have the lens as region 1 AND material 1, so nothing else
saw it. The walker now asks whether the MATERIAL at the point changed (`grin_inside` in
grin.glsl). These four furnaces are the only witnesses whose GRIN region and material ids
differ, so they are the regression gate for this class.

The remaining −0.1…−0.3% on `grin-furnace` is within tolerance (its per-salt sd is 0.15%).
Tempting "fix", measured and rejected (Sep 25): evaluating n exactly at the walker's exit and
event points (and adding the (n/n_wall)² factor on the straight micro-segment to the wall)
looks exact on paper but biased `grin-furnace-scatter` to 0.40101 ± 0.00002 over salts,
against 0.4000 for the shipped form. Velocity Verlet exactly conserves a nearby "shadow"
Hamiltonian whose index along the computed ray is |T|, so the walker's |T|-ratio factor is
the one consistent with the trajectory actually traced (grin.glsl, the grin_finish comment).

### B. `softbeam-wall` core — RESOLVED (Sep 25 2026): noise, not a bias

The core read 1.0326 against 0.99917 (+3.3%) with the nee and mis arms agreeing, which was
taken as a normalization bias in the softbeam Le. It was an under-sampled check. NEE samples
the whole aperture (r = 0.5) but only the sub-disk inside the cone (radius d·tanδ ≈ 0.1)
contributes, so 4% of samples carry all the signal (per-sample relative sd ≈ 4.9); the check
averaged an 80-pixel crop at 96 spp, a 7% standard error against a 1.2% tolerance, and the
runner's pinned salt reproduced the same unlucky draw every sweep. Six salts on the old crop:
0.9985 ± 0.030. A 3600-pixel crop inside the core at 384 spp: 0.9989 ± 0.0028. The check now
uses that crop and spp (fixture comment in index.ts).

Lesson for new `mean` checks on crops: estimate the standard error first (sample the check
with a few salts), and keep the tolerance at 3σ or more.

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
is how the next real defect gets missed. (The full-suite re-gate after the batch was done by the
Sep 24 and Sep 25 sweeps.)

### D. `cube-cloud` — the Aug 12 investigation

*Superseded in part:* since Sep 25 the page no longer blocks — the runner takes control
immediately and the render does not finish within 8 minutes (the update in the current section
above). claude-improvements-2026-09.md Part 7 lists a third hypothesis, a runner stall. The
Aug 12 findings follow.

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

## Picture checks and `identical`

A `mean` check reads `radiance` unless it names another `picture` the renderer keeps (an AOV
listed in `measurement.aovs`, or `variance`). A render reads every picture its renderer keeps,
and each is cached under its own key, so a check of one picture never replays another; the
radiance keeps its old cache key.

`kind: 'identical'` compares one picture of two strategies at the pinned salt BIT FOR BIT. It
is for pairs that must draw the same random numbers and do the same arithmetic on that picture:
the same strategy with and without extra pictures, or estimators that differ only after the
picture is fixed. `guides` uses it for its AOVs under pt and pt-nee and under maxBounces 4 and
0, and for radiance and variance with and without the AOVs. The χ² and rmse gates do not fit an
AOV: it has no variance picture, and the rmse statistic's l/(1+l) tone map has a pole at −1,
near a normal picture's mean.

## Tiled checks

`kind: 'tiled'` checks that tiling does not change the image. In one page, the runner
renders the scene with `app.renderTiled` (HDR and PNG), then in one piece at the same
size, spp and pinned salt, saved through `app.save`. It catches the four
downloads and requires the HDR pixel bytes (everything after the resolution line) and
the PNGs' inflated image data to be identical, byte for byte. The headers are not
compared, since the stamps carry the date. `tileSize` (a multiple of 64, the blue-noise
tile) should leave partial tiles at the right and bottom edges; `cornell-area` uses 64
at 160×120, a 3×2 grid. The check reads files, not frames, so it is never cached. It can
fail: with `renderTiles` not setting the tile's pixel offset, about 70% of the bytes
differ.

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
