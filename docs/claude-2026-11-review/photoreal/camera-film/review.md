# Review: camera-film plan (pixel filters, bladed aperture, lens helper, white balance)

**Verdict: approve with changes.** The four parts are small, independent and well-classified
(A/B/D are measurement, C is view). The core math checks out. There are four concrete defects
to fix before the owner sees the plan: one witness would fail as written, one display-order
bug, one verification gap that cannot fail, and one wrong statement in an owner question.
There is also one behavior the plan never states.

Evidence labels: [checked-code file:line], [checked-src URL], [checked-num script],
[reasoning]. Review scripts are in `scratchpad/photoreal/camera-film/review-scripts/`
(`col.mjs` and `wbm.ts`, a copy of `proto.ts` that also prints M).

---

## Must fix

### 1. `bokeh-edge` fails as written. Its expected value holds only for the average of two columns.
The plan gives 0.195501 (disk) and 1/6 (hexagon) "for the two center columns (79, 80), whose s
values cancel to first order". Its own Monte Carlo pools both columns
(proto.ts:175, `for (const col of [79, 80])`). The fixture never states the region, and the
sibling `filter-edge` uses one-column regions. One column alone is far off:

| column | disk | hexagon |
|---|---|---|
| 79 | 0.21123 | 0.18616 |
| 80 | 0.18016 | 0.14858 |
| mean | 0.19570 | 0.16737 |

[checked-num review-scripts/col.mjs: exact in p, quadrature over the box jitter]

With tol 0.006, a one-column region fails by about 0.015 to 0.018. **Fix:** state the region
as exactly columns 79 to 80, for example `{x: 79.25/160, w: 1.5/160, y: 0, h: 1}`. The runner
floors x0 to 79 and ceils x1 to 81 [checked-code tools/witness.mjs:177-185]. Also note the
residual second-order offset from the exact fraction: +0.0002 for the disk and +0.0007 for the
hexagon. Both are inside tol, but they should be stated so nobody reads them as noise.

### 2. White balance must be applied before `safe_color`, not after it.
The plan emits `DISPLAY_VIEW * safe_color(x)`. `safe_color` clamps negatives to 0 because the
curves expect non-negative input [checked-code src/glsl/shared/display.glsl:7-12]. The Bradford
matrix in linear sRGB has large negative entries. At 2700 K, row 0 is
`0.7415 −0.5109 −0.1248`, so pure green (0,1,0) becomes red −0.51
[checked-num review-scripts/wbm.ts]. A saturated pixel therefore reaches the curve negative:
Reinhard's x/(1+x) has a pole at −1, and AgX applies `pow(max(..))`.
**Fix:** `safe_color(DISPLAY_VIEW * x)`. A NaN or Inf in x still propagates through the product
and is caught. The no-WB text can stay byte-identical, because only the WB branch uses the
helper's new form.

### 3. The white-balance verification cannot catch a transposed matrix in GLSL.
The TS test checks M. The snapshot only records the text. GLSL `mat3(…)` is column-major, so
emitting M row-major gives Mᵀ. That passes both checks but does not neutralize blackbody light.
At 2700 K, M is strongly asymmetric (m01 = −0.51 against m10 = 0.02), so a test would catch the
error easily, but no test in the plan reads the emitted constant. The `none` probe path
skips WB (§3.C, Q5), so no witness can see it either.
**Fix:** add one vitest that compiles a strategy with `whiteBalance: 2700`, parses the
`DISPLAY_VIEW` literal from the display shader, interprets it column-major, and asserts
`DISPLAY_VIEW · rgb_bb(2700) ≈ exposure·(1,1,1)`. [reasoning]

### 4. Q1 (Gaussian truncation) misstates the alternative.
The plan says truncating at 2σ "needs an erf/erfinv approximation". That is true only for
separable truncation to a square. **Radial** truncation at kσ is exact with Box–Muller and one
constant: `r = σ·√(−2 ln(1 − ξ₀(1 − e^{−k²/2})))`, then the same cos/sin. It needs no table, no
erfinv, and the weight is 1. [checked-num review-scripts/col.mjs: 10⁶ samples, max r = 1.0000
for σ = 0.5, k = 2, all inside]

The owner's question should list three options:
- untruncated;
- radially truncated, with one extra constant, but a jump at the cutoff (e^{−2} = 13.5% of the
  peak at 2σ, about 1.1% at 3σ), because pbrt and Mitsuba subtract the edge value and this does not;
- pbrt's separable, edge-subtracted truncation, which is tabulated.

Radial truncation also changes the `filter-edge` expected values: the x-marginal is no longer Φ.
The plan's pick (untruncated) stays defensible. The comparison just has to be correct.

### 5. State what white balance does to the variance picture.
The variance statistic is displayed through the `tonemap` view
[checked-code src/components/accumulator/index.ts:54], so `view_tonemap` would apply M to it.
M·(per-channel variances) is not the variance of M·L, which would need the covariances, and its
negative entries can make it negative before the clamp. Exposure already scales variance
linearly rather than by exposure², so the existing view already treats the variance picture
loosely. The plan should give a one-line rule: either WB, like exposure, applies to every
tonemap-view picture, with variance shown "for looking only", or WB applies to the main picture
only. Right now this is unstated behavior.

---

## Checked and correct

- **Pixel-filter estimator.** Warping ξ by the inverse CDF of h makes the plain average
  unbiased for ∫h·L, with weight 1. The film point goes only to the camera and to
  `color_to_pixel(film, …)` [checked-code accumulation.ts:14-25]. The sensors take `film` but
  ignore it for the response [checked-code sensor/*/…glsl]. Each pixel seeds its own stream from
  the global pixel, so samples landing in neighbors do not break tiling (there is no splatting).
  Equirect continues over the pole [checked-code equirect.glsl:13-25], and the fisheye sin-maps
  clamp [checked-code fisheye.glsl:13-16]. The plan is right.
- **Tent inverse CDF.** `√(2u)−1` and `1−√(2−2u)` invert (1+x)²/2 and 1−(1−x)²/2. pbrt's
  `SampleTent` reaches the same density by a different route (SampleDiscrete + SampleLinear)
  [checked-src https://raw.githubusercontent.com/mmp/pbrt-v4/master/src/pbrt/util/sampling.h].
  Wording: call it "equivalent to", not "is", pbrt's SampleTent.
- **Box–Muller.** pbrt's `SampleTwoNormal` uses `−2·log1p(−u0)`, then cos/sin of 2πu1
  [checked-src same URL]. `log(1−ξ)` with a 24-bit ξ is equivalent. The cutoff 2.884 px is
  correct (0.5·√(48 ln 2)).
- **Cycles `regular_polygon_sample`** (re-fetched,
  [checked-src https://raw.githubusercontent.com/blender/blender/main/intern/cycles/kernel/sample/mapping.h]).
  It picks a sector, reuses u, takes s = √u, places vertices at `rotation ± π/n`, and samples the
  triangle (center, +π/n, −π/n) uniformly. The plan's mapping `cycles_rot = rotation − π/n`
  puts a vertex at `rotation`, which is correct. The hexagon value 1/6 needs a vertex on +right:
  with a flat side on +right the fraction is 0, so the witness does check the rotation
  convention. Note that proto.ts used `+π/6` (its comment ends in "?"). That is equivalent for
  n = 6 but not for n = 5, so the `first vertex at rotation` twin test is the one that pins it.
- **Disk segment fraction** (θ − sinθcosθ)/π with cosθ = ½ gives 0.195501. The hexagon cap
  area ratio is (√3/4)/(3√3/2) = 1/6 [reasoning, re-derived].
- **Lens helper (D).** In object space the blur angle is R|1/F − 1/z|. The real lens gives
  (f/2N)|1/v − 1/v_z|, and the lens equation makes the two identical [reasoning, re-derived].
  The existing fov is the full vertical angle [checked-code thinlens.ts:14], so `sensorHeightMm`
  is the right input. The focus surface is a plane [checked-code thinlens.glsl:20-21], which
  matches the model.
- **White balance.** The Bradford matrices and the `WhiteBalance` structure match pbrt
  [checked-src util/color.h:546-566, local copy]. The equation M·rgb_bb(T) = (1,1,1) holds in
  the prototype. M at 6504 K is not I (Planck is not D65), as the plan says.
- **Citations spot-checked:** ShaderBuilder.ts:79/95/127/132/157, types.ts MeasurementDescription
  and DisplayDescription, Validator.ts:855-858, plan/measurement.ts aovs-omission at :33,
  pixel.ts:14-20, box.glsl:5-7, accumulation.ts backstop, and witness ids `furnace`,
  `thinlens-zero`, `cornell-area`, `spectral-furnace` all exist [checked-code]. pbrt's defaults
  are confirmed: Gaussian xradius 1.5 with σ 0.5, triangle radius 2. Mitsuba cuts off at 4σ.
  The perspective `We` divides out lensArea·cos⁴ [checked-src local copies].
- **No ambient_dot or Euclidean issue.** The lens and film samples are 2D, and the thin lens is
  already Euclidean.

## Weaker points (not blocking)

- **The `furnace` and `spectral-furnace` filter arms cannot fail on a wrong kernel.** A flat
  field is filter-invariant, which fable-imagery P3 says too. They are compile, NaN and smoke
  gates only, and the plan should label them that way. `filter-edge` is the real gate, and it
  does separate box, tent and Gaussian at column 79 (0, 0.125, 0.159) by more than 4× tol.
  Column 78's Gaussian value (0.00135) is below tol, so it checks nothing about the tail.
- **The A digest sentence is garbled** ("identical except where the ProgramDescription is not
  part of it"). Say plainly that the shader text is identical, because box is still the block
  included, and that only the resolved measurement and stamps gain `pixel: 'box'` if Q6 is
  answered "always record".
- **The `filter-edge` spectral arm's tolerance is unchecked** (the plan says so).
- **Q5 (WB under `none` silently skipped).** This follows the exposure precedent, but the
  owner's no-guesses rule leans toward a Validator error for an authored field that has no
  effect. Leave it as the owner's question, but say that the rule exists.
- **The f-number with blades is nominal.** R is the polygon's circumradius, so a hexagonal
  pupil's area is 83% of the disk's, and its depth of field is very slightly smaller than a
  real lens with the same nominal N. This is negligible, but worth one sentence in thinlens.md.

## Simplifications (optional)

- **Ship only `gaussian`.** It is the pbrt and Mitsuba default and the item that removes the CG
  edge. `tent` is about 10 lines plus one witness arm, but nothing in the photoreal goal needs
  it. It is the owner's call, since the pixel README names it.
- **Drop the live `bladeRotation` control** (the conditional control row and the
  "rotation without blades" validation rule). Fold the rotation into the compile-time define, or
  fix a vertex on +up. Blade rotation is rarely tuned live.
- **Folding exposure into `DISPLAY_VIEW`** only when WB is present is fine. Keep it as the plan
  has it.
