# Camera and film realism: pixel filters, bladed apertures, photographic lens, white balance

**Status:** draft plan for owner review. Nothing built. Four small parts, each its own
commit, each independent of the others (A, B, C, D in any order). Two further items (glare,
vignetting) were researched and are **not** planned here; §6 says why and what they would need.

Evidence labels: [code file:line] read in this repo; [src URL:line] read in pbrt-v4 /
Mitsuba 3 / Cycles source (downloaded copies in `scratchpad/photoreal/camera-film/src/`);
[num script] computed by a scratch script here (`proto.ts`, `lens.ts`; outputs `proto.out`,
`lens.out`); [reasoning] derived, not run.

pbrt-v4 base: `https://raw.githubusercontent.com/mmp/pbrt-v4/master/src/pbrt/`.

---

## 0. Which ones matter most for "looks like a photograph"

My ranking. All of it is [reasoning]; none of it was measured on renders.

| # | Item | Effect on a photograph-like image | Size | Section |
|---|---|---|---|---|
| 1 | **D: photographic lens → thin-lens fields** (focal length, f-number, sensor) | Depth of field matches a real lens (50 mm f/1.8 at 2 m) instead of a guessed `aperture`. The main optical signature of still-life, product and table-top photographs. | tiny, authoring only | §3.D |
| 2 | **B: bladed aperture** (n-gon bokeh) | Out-of-focus highlights become polygons, as they are with a stopped-down real lens. | small | §3.B |
| 3 | Glare/bloom around very bright sources | Strong cue wherever a light, the sun or a hot specular is in frame. | **not small**: needs a pipeline decision | §6.1 |
| 4 | **A: Gaussian/tent pixel filter** | Slight softening that removes the "too crisp" CG edge. pbrt-v4 and Mitsuba 3 both default to a Gaussian with σ = 0.5 px. | small | §3.A |
| 5 | **C: white balance** (kelvin) | Needed when the scene is lit by warm blackbody light (interiors, tungsten); otherwise everything looks orange. No effect on daylight RGB scenes. | small | §3.C |
| – | Exposure (ISO, shutter, f-number) | Not buildable honestly: radiance has no absolute unit here. The existing `exposure` scalar already covers it. | — | §6.3 |
| – | Vignetting | Physically real, but needs a camera-ray weight channel (a contract change). | — | §6.2 |
| – | Chromatic aberration | Needs a dispersive lens and the hero-wavelength collapse. | — | §6.4 |

Tonemapping is already covered by seven curves, including AgX and Khronos Neutral
[code src/components/tonemap/README.md].

---

## 1. The problem, with evidence

- **Box pixel filter only.** `pixel/` has one occupant, which places the sample uniformly
  over the pixel square [code src/components/pixel/box/box.glsl:5-7]. It is included
  unconditionally and no strategy field selects a pixel filter [code src/compiler/generate/features/pixel.ts:14-20].
  The README already names tent/gaussian/mitchell as the next occupants
  [code src/components/pixel/README.md "Status"]. The imagery plan's P3 (tent and Gaussian)
  is still pending. Its fork 3, where to truncate the Gaussian, is still open
  [code docs/fable-imagery.md:115-124, 159-160].
- **Circular aperture only.** The thin lens samples the lens with `concentric_disk(xiLens) * u_aperture`
  [code src/components/camera/thinlens/thinlens.glsl:27]. "Polygonal bokeh" is on the
  deferred list [code src/components/camera/README.md:57] and in the shelved realistic-camera plan
  [code docs/impl-plan-realistic-camera.md:198-201].
- **`aperture` and `fov` are raw numbers in scene units and radians.** Nothing relates them
  to a real lens [code src/components/camera/thinlens/thinlens.ts:14-17], so matching a
  photograph's depth of field means guessing.
- **No white balance.** The display applies `safe_color(x) * DISPLAY_EXPOSURE`, then the curve
  [code src/compiler/generate/ShaderBuilder.ts:127,132,157]. Nothing adapts the white point.
  The spectral design lists white balance as future work [code docs/claude-spectral-design.md:1423].

Classification under the pinned taxonomy [code docs/fable-strategy-taxonomy.md §10]:
anything that shapes **what accumulates** is measurement, and anything applied to **converged
pictures** is view. The pinned text names "Pixel filtering … measurement" and "Exposure/tonemap: view".

| Part | Section | Why |
|---|---|---|
| A pixel filter | **measurement** | changes the pixel's kernel h_j (§10 names it) |
| B aperture shape | **measurement** | changes the camera functional W_j (§5) |
| D lens helper | **measurement**, authoring only | produces `fov`, `aperture`, `focusDistance` |
| C white balance | **view** | a fixed linear map of each converged pixel, which commutes with the mean |
| glare (not planned) | view | a shift-invariant PSF is linear, so it commutes with the mean (§6.1) |
| exposure (exists) | view | §10 |

---

## 2. The models, in plain terms

### A. Pixel filter by exact importance sampling (weight 1)

The pixel value is `I_j = ∫ h(u) L(camera(c_j + u)) du`, where `c_j` is the pixel center and
`h` is a probability density. If the offset `u` is drawn **exactly** from `h`, the plain
average of `L` is unbiased for `I_j`. No weights are needed, and the `average` accumulator,
the variance statistic, the AOV guides and tiling stay as they are. This is pbrt-v4's
**filter importance sampling**: `GetCameraSample` draws `fs = filter.Sample(u)`, sets
`pFilm = pPixel + fs.p + 0.5` and records `filterWeight = fs.weight`
[src samplers.h:797-805]. The film accumulates `Σ w·L / Σ w` [src film.h:251-264]. For
exactly-sampled filters pbrt returns weight 1 (box [src filters.h:67-70], triangle
[src filters.h:224-227]). Because the samples are never splatted, a pixel never writes to its
neighbors. That is the only way possible in a fragment shader, and it is why pbrt-v4 chose it.
Mitsuba splats instead.

The kernel **is** the density of the warp, so the measurement is exactly "the kernel the
warp produces". The twin tests check that density against the stated formula.

- **tent**, radius 1 px: `h(x,y) = (1−|x|)(1−|y|)`. Inverse CDF per axis:
  `t(u) = u<½ ? √(2u) − 1 : 1 − √(2−2u)`. This is pbrt's `SampleTent`
  [src util/sampling.h:196-201], which uses pbrt's default radius of 2 [src filters.cpp:104-105].
  Radius 1 here is box ⊛ box.
- **gaussian**, σ = 0.5 px, **untruncated**: Box–Muller,
  `u = σ·√(−2 ln(1−ξ₀))·(cos 2πξ₁, sin 2πξ₁)`, transcribed from pbrt-v4 `SampleTwoNormal`
  [src util/sampling.h:245-249]. Both references default to σ = 0.5: pbrt-v4 truncates at 1.5 px,
  subtracts the edge value and samples a table, so its weight is not 1
  [src filters.h:79-117, filters.cpp:43-45; default filter "gaussian", src scene.cpp:94].
  Mitsuba cuts off at 4σ with the edge value subtracted [src mitsuba3 src/rfilters/gaussian.cpp:50-53].
  The untruncated version needs no table, no erfinv and no truncation constant. The only
  truncation is the sampler's 24-bit ξ (`random()` ∈ [0,1) on a 2⁻²⁴ grid
  [code src/components/sampler/README.md:12-19]): radius ≤ 2.884 px, tail mass 6·10⁻⁸ [num proto.out].
  This is a numerical tolerance, not a field. **It answers fork 3 differently from the
  imagery plan's suggestion (truncate at 2σ). The owner decides (§7 Q1).**
- Mitchell and Lanczos (negative lobes) need signed weights and a tabulated sampler (pbrt
  `FilterSampler`, [src filters.h:26-45]). They are **out of scope** (§5).

RGB and spectral: the warp is geometric and wavelength-free. The same GLSL is used in both programs.

### B. Bladed aperture: uniform sampling of a regular n-gon

The thin lens samples the entrance pupil uniformly. A bladed diaphragm makes the pupil a regular
n-gon of circumradius `R = aperture`, with vertices at angles `rotation + 2πk/n` in the
lens plane (camera right/up). Uniform sampling: choose the sector `k = ⌊n ξ₀⌋` and reuse
`ξ₀' = nξ₀ − k`. Then sample the triangle (0, v_k, v_{k+1}) uniformly with
`s = √ξ₀'`, barycentrics `(1−s, s ξ₁)`. All sectors have equal area, so the density is
`1/Area` over the polygon. This is transcribed from Cycles `regular_polygon_sample`
[src blender intern/cycles/kernel/sample/mapping.h:188-213], called by Cycles'
`camera_sample_aperture` when `blades > 0` [src blender intern/cycles/kernel/camera/camera.h:22-35].
Cycles' rotation puts vertices at `rot ± π/n`, so ours is `cycles_rot = rotation − π/n`.
pbrt-v4 has polygon apertures only on `RealisticCamera`, as rasterized images
[src cameras.cpp:1351-1405]. Its thin lens uses the disk only [src cameras.cpp:292-301].
The weight stays 1: the camera measures radiance (pbrt's `PerspectiveCamera::We` divides
out lens area and cos⁴ for the same reason, [src cameras.cpp:552-555]). So brightness does
not change with blade count. Only the defocus shape changes. `aperture = 0` still collapses
exactly to the pinhole. The sample is two-dimensional in the lens plane, so the
Category-A rule holds [code src/components/camera/README.md "Camera randomness"].

### D. Photographic lens → thin-lens fields (authoring)

The thin lens here is object-space: rays leave a lens disk of radius R at the eye and
converge on the focus plane at distance F. For a real thin lens with focal length f and
f-number N, focused at F, with sensor height h:

- `aperture R = f / (2N)` (the entrance-pupil radius),
- `fov = 2·atan(h / (2v))`, with `v = F f / (F − f)` (the image distance at that focus),
- `focusDistance = F`, and every length divided by `metersPerUnit`.

Claim: with R = f/(2N), the angular blur radius of a point at any depth z is identical in both
models. In object space it is `R |1 − z/F| / z`. For the real lens it is `(f/N)|v_z − v| / (2 v_z v)`,
with `v_z = z f/(z−f)`. [reasoning, derived] and [num lens.out]: max relative difference
4·10⁻¹⁴ over z ∈ {0.5 … 100} m for a 50 mm f/1.8 lens at 2 m. That lens gives fov 0.459728 rad
and aperture 0.013889 m.

### C. White balance (Bradford, kelvin)

`view.tonemap.whiteBalance: <kelvin>` maps the white of a Planck source at that temperature
to the display white (D65) with the Bradford chromatic adaptation. This is transcribed from
pbrt-v4 `WhiteBalance` and its LMS matrices [src util/color.h:546-566], applied as pbrt
applies it to the film's XYZ [src film.cpp:496, film.h:80-91]. In linear sRGB:

`M = XYZ→RGB · XYZfromLMS · diag(LMS_D65 / LMS_src) · LMSfromXYZ · RGB→XYZ`, with `src = XYZ(Planck(T))`.

`M` is a constant 3×3. The display applies `DISPLAY_EXPOSURE · M` to each tonemap-view picture
before the curve. It is the same map in RGB and spectral programs: both produce linear sRGB
with a D65 white (the cie1931 sensor's `M·xyz/∫ȳ`, [code src/components/sensor/README.md]).
Conjugating by RGB↔XYZ makes it exactly pbrt's `RGBFromXYZ · WB · XYZ`
[src film.cpp:496] [reasoning]. Source white: pbrt uses `Spectra::D(T)`, which is a blackbody
below 4000 K and the CIE daylight locus above [src util/spectrum.cpp:2533-2553]. This plan
uses **Planck at every T**, so a scene lit by `blackbody(T)` lights becomes exactly neutral
at `whiteBalance: T` [num proto.out: M·rgb_bb(T) = (1.000003, 0.999998, 1.000000) for T = 2700…6504].
The source chromaticity comes from the renderer's own blackbody integration
(`blackbodyColor`, [code src/components/color/spectra/blackbody/blackbody.ts:21-41]). It is
not a second copy.

---

## 3. The change and its boundaries

### A. Pixel filters (measurement)

- **Add** `src/components/pixel/tent/{tent.glsl,tent.md}`:
  `vec2 pixel_sample(vec2 coord, vec2 xi) { return coord + vec2(tent_offset(xi.x), tent_offset(xi.y)); }`
  (`coord` is the pixel center, as box assumes [code box.glsl:5-7]).
- **Add** `src/components/pixel/gaussian/{gaussian.glsl,gaussian.md}`: Box–Muller as in §2.A,
  `log(1.0 - xi.x)` (ξ < 1, so the argument is ≥ 2⁻²⁴).
- **Edit** `src/components/pixel/index.ts`: two registry lines.
- **Edit** `src/compiler/types.ts` `MeasurementDescription` (:574-614): `pixel?: string`,
  a `PIXEL_MODELS` key, default `'box'`.
- **Edit** `src/compiler/plan/types.ts` (:48-64) and `plan/measurement.ts` (:14-35): resolved
  `pixel: string`, recorded in `ProgramDescription.measurement` and therefore in export stamps.
- **Edit** `src/compiler/analyze/Validator.ts`: registry gate (`invalid-setting`), next to
  the sensor check (:855-858).
- **Edit** `src/compiler/generate/features/pixel.ts`: read `plan.program.measurement.pixel`,
  with a backstop error as in accumulation.ts:52-57.
- **Edit** `src/components/pixel/README.md`: status, the "kernel = warp density" rule, and
  the reset discipline.
- Nothing changes in the cameras, accumulators, AOVs, tiling or the engine. The film point
  may land outside the image at the border pixels. Every camera maps such a point to a valid
  ray: fisheye clamps [code fisheye.glsl:13-16], and equirect continues over the pole [reasoning].

### B. Bladed aperture (measurement, the `thinlens` occupant only)

- **Edit** `src/components/camera/thinlens/thinlens.ts`:
  - two optional rows, `blades` (`number`, required: false) and `bladeRotation` (`number`, radians, required: false);
  - `validateAuthored`: `blades` must be an integer ≥ 3, and `bladeRotation` without `blades` is an error;
  - `defines(cam)`: `LENS_BLADES <n>.0` when `blades` is authored. The blade count is
    structural, like fisheye's `projection` [code camera/index.ts "defines"];
  - `controls`: `camera.bladeRotation` → `u_bladeRotation`, only when `blades` is authored.
- **Edit** `thinlens.glsl`: add `vec2 aperture_polygon(vec2 u, float n, float rotation)`
  (the Cycles transcription, §2.B) and
  `#ifdef LENS_BLADES lens = aperture_polygon(xiLens, LENS_BLADES, u_bladeRotation) * u_aperture; #else concentric_disk … #endif`.
  It stays in the thinlens folder because it has one user.
- **Edit** `thinlens.md` and `camera/README.md` (move polygonal bokeh off the deferred list).
- Without `blades` the generated text is unchanged, so `npm run digest` stays identical for
  every existing scene.

### D. Photographic lens helper (authoring)

- **Add** `src/authoring/photoLens.ts`:
  `thinLensFromPhoto({ focalLengthMm, fNumber, focusDistance, sensorHeightMm, metersPerUnit })`
  → `{ type: 'thinlens', fov, aperture, focusDistance }`. Every input is required. No default
  sensor and no default unit, because nothing may guess. It throws if `focusDistance·metersPerUnit ≤ f`
  (no real image) or any input is non-finite or ≤ 0.
- Export it from the authoring index. Nothing else changes.

### C. White balance (view)

- **Edit** `src/compiler/types.ts` `DisplayDescription` (:759-761): `whiteBalance?: number` (kelvin).
- **Edit** the Validator: finite and in `blackbodyTemperatureRange` [code blackbody.ts:9].
- **Add** `src/components/tonemap/whiteBalance.ts`:
  `whiteBalanceMatrix(kelvin): number[]` (column-major mat3). It contains the Bradford pair
  from pbrt and uses `spectralData.rgbToXYZ/xyzToRGB/white` and the blackbody chromaticity.
  Expose the XYZ that `blackbodyColor` already computes (currently it returns only rgb), so
  there is one integration, not two.
- **Edit** `src/compiler/generate/ShaderBuilder.ts`: when `whiteBalance` is authored, emit
  `const mat3 DISPLAY_VIEW = mat3(…)` (exposure × M) and use `DISPLAY_VIEW * safe_color(x)`
  in place of `safe_color(x) * DISPLAY_EXPOSURE`. Both spellings, :127/:132 and :157, change
  together through one helper (`viewScale(expr)`), so neither copy can drift. When
  `whiteBalance` is absent, the text is byte-identical. Under `tonemap: 'none'` (the raw probe
  path) neither exposure nor white balance applies (:79). The rule is one line: "the probe
  path applies no view transform".
- **Edit** `src/components/tonemap/README.md`. HDR export is unchanged: it carries the
  unbalanced estimate, as for exposure.

**Nothing in any part** touches transport, materials, lights, the trace-loop contract or
`ambient_dot`. The lens and pixel samples are 2D lens-plane and film-plane quantities, so
they add no new Euclidean assumption; the existing thin lens is already Euclidean.

---

## 4. Verification (written first)

### TS twins (vitest; next to each component, the ggx.test.ts pattern)

| Test | What it asserts | Prototype result |
|---|---|---|
| `pixel/pixel.test.ts` tent | χ² of 2·10⁶ offsets in 64 bins vs the exact CDF; support ⊂ [−1,1] | χ² 71.9 / dof 63, crit 103.5 [num proto.out] |
| … gaussian | χ² of 4·10⁶ offsets on a 32×32 grid over [−2,2]² plus an outside cell vs Φ-products | χ² 812.3 / dof 881, crit 1016.5 [num] |
| … box | `coord + xi − 0.5` uniform (regression) | — |
| … furnace identity | ∫h = 1 for all three: the expected counts sum to N | yes [num] |
| `thinlens/aperture.test.ts` | χ² of the polygon warp vs **exact** cell∩polygon areas (Sutherland–Hodgman), n = 5, 6, 9 with arbitrary rotations; every sample inside the polygon; first vertex at `rotation` | χ² 1059.8/1028, 1200.3/1119, 1286.7/1229, all below crit; 0 outside [num] |
| `authoring/photoLens.test.ts` | object-space blur radius = real-lens blur radius for a z sweep (≤ 1e-12 rel); the 50 mm f/1.8 @ 2 m values; throws on F ≤ f and on a missing unit | 4·10⁻¹⁴ [num lens.out] |
| `tonemap/whiteBalance.test.ts` | `M · rgb_bb(T)` ∝ (1,1,1) to 1e-5 for T ∈ {1000, 2700, 3200, 5000, 6504, 40000}; `M · white_RGB(D65)` is not tested as identity (Planck 6504 K ≠ D65); the Bradford pair product is I to 1e-6; M equals pbrt's formula, transcribed independently in the test | 1.000003, 0.999998, 1.000000; ‖I−P‖ 5.4·10⁻⁷ [num] |
| snapshots | program-description and generated GLSL: only the intended lines change (A adds `pixel: 'box'` to every ProgramDescription; B and C change no existing scene's text) | — |

`npm run digest` before and after B and C: identical for every suite scene (refactor-safe
check). For A, the digest is identical except where the ProgramDescription is not part of
it. If the stamp/description snapshot changes, that is expected and reviewed by kind.

### GPU witnesses (targeted only; ask before running; `caffeinate -i`; never the full sweep)

**Existing, to run:** `furnace` (A: add tent and gaussian arms, checked at mean 0.4. A flat
field is filter-invariant, as fable-imagery P3 noted), `thinlens-zero` (B: the
aperture-0 ≡ pinhole anchor must still hold, and an extra arm with `blades: 6, aperture: 0`
must equal pinhole too), `cornell-area` (A: contains the `tiled` check; the cameras are untouched),
`spectral-furnace` (A in a spectral program).

**New fixture 1: `filter-edge`** (A; exact; `tests/witnesses/scenes/filterEdgeWitness.ts`).
A pinhole camera, fov 0.8, 160×120, posed at the origin looking along −z. One emissive quad
(Le = 1, black environment, no other light, `maxBounces: 0`, tonemap `none`) covers
camera-space x ∈ [0, 50], y ∈ [−50, 50] at z = −4. Its edge projects to film x = 80
exactly (ndc 0). Pixel column c has center offset d = c + 0.5 − 80 px. The expected
column mean is `P(d + U > 0)`, where U is the filter's x-marginal [num proto.out]:

| column (d) | box | tent r=1 | gaussian σ=0.5 |
|---|---|---|---|
| 78 (−1.5) | 0 | 0 | 0.001350 |
| 79 (−0.5) | 0 | 0.125000 | 0.158655 |
| 80 (+0.5) | 1 | 0.875000 | 0.841345 |
| 81 (+1.5) | 1 | 1 | 0.998650 |

The regions pick exactly one column: `{x: (c+0.5)/160, w: 0.25/160, y: 0, h: 1}`. The
runner floors x0 and ceils x1 [code tools/witness.mjs:177-185]. Use spp 256 and tol 0.008
(Bernoulli σ ≈ 0.002 per column) [reasoning]. Arms: box, tent, gaussian, gaussian with
`color: 'spectral'` (same values; take the tolerance from `spectral-furnace`), and a
`{kind:'tiled'}` check on the gaussian arm, whose samples cross tile seams.

**New fixture 2: `bokeh-edge`** (B; exact). A thin lens, fov 0.8, aperture R = 0.5, focusDistance F = 2.
An emissive half-plane (Le = 1, `maxBounces: 0`) covers camera-space x < −R/2 at depth 2F = 4.
A ray from lens point p through the focus point hits that plane at `x = 2s − p_x`, where s
is the pixel's focus-plane offset. For the two center columns (79, 80), whose s values cancel
to first order, the mean is the fraction of the aperture with p_x > R/2:
**disk 0.195501** (`(θ − sinθcosθ)/π`, cosθ = ½) and **hexagon (blades 6, rotation 0, vertex on +right) 1/6 = 0.166667**.
The full-geometry Monte Carlo with pixel jitter gives 0.1952 ± 0.0003 and 0.1672 ± 0.0003
[num proto.out]. Use spp 256 and tol 0.006. The disk arm is also a **new exact check of the
existing thin lens**.

White balance (view) gets snapshots and the TS test only, as the taxonomy prescribes for view
fields [code fable-strategy-taxonomy.md §6.4], plus one `verify`-skill screenshot of a
blackbody-lit card at T and at 6500 K, for the owner to look at.

---

## 5. What it does NOT do

- No negative-lobe filters (Mitchell, Lanczos, Blackman–Harris windows with negative parts):
  they need a signed sample weight through `color_to_pixel`, the AOVs and the variance
  statistic, plus a tabulated sampler. Negative pixels also cannot be saved as RGBE
  [code src/compiler/types.ts:1033-1034]. Not planned.
- No change to the default filter. `box` stays the default, so no existing image changes.
- No curved blades, no cat's-eye or mechanical vignetting, no aperture images. Those are
  realistic-camera territory [code docs/impl-plan-realistic-camera.md].
- No glare, vignetting, photographic exposure units or chromatic aberration (§6).
- No automatic exposure or metering.
- White balance does not alter the saved HDR (view, like exposure).

---

## 6. Researched, not planned, with reasons

### 6.1 Glare / bloom (view). Physically sound, but not small.
- **Physics:** veiling glare is the lens/sensor PSF's long tail. For a shift-invariant PSF
  K, `K ⊛ (mean of samples) = mean of (K ⊛ samples)`, so applying it to the converged HDR
  image is **exact**, not an approximation. The one exception is light from sources outside
  the frame, which post-processing cannot see [reasoning]. It belongs in view.
- **Why not small:** the display is one fragment pass [code ShaderBuilder.ts:72-107].
  A blur pyramid needs framebuffers at fractions of the canvas, while the locked contract
  allows only canvas size or a fixed absolute `size` [code src/compiler/types.ts:858-875].
  Tiled PNG export re-runs the display pass **per tile** [code src/app/TiledRenderer.ts:207-227],
  so a kernel tens of pixels wide would show seams. That breaks the pixel-identical tiling promise.
- **Two routes, for an owner conversation (not recommended; thought through, not checked):**
  (a) a live GPU pyramid, which needs a contract extension plus a tiling answer;
  (b) glare applied once to the finished full-size HDR on the CPU at save time, a separable
  sum of Gaussians in TS. Earlier docs called bloom "view-layer sugar"
  [code docs/fable-imagery.md:146] and deferred it [code docs/impl-plan-display.md:115].

### 6.2 Vignetting (measurement). Needs the camera-ray weight channel.
- For a pinhole on a flat film, irradiance ∝ cos⁴θ exactly. For a finite lens it is
  `(1/z_i²)∫_lens L cos⁴θ(x,p) dA` [reasoning]. pbrt-v4's thin-lens `PerspectiveCamera`
  **cancels** cos⁴ in `We`, so pixels measure radiance [src cameras.cpp:552-555]. Only
  `RealisticCamera` weights rays by cos⁴/(pdf·z²) [src cameras.cpp:945-946]. The thin lens
  here matches pbrt's perspective camera (weight 1).
- A physical vignette needs the image distance z_i, which this thin lens does not model,
  and a per-ray weight that `camera_generateRay` cannot return today. That is the shelved
  realistic-camera T1 contract change [code docs/impl-plan-realistic-camera.md §2].
  A display-side cos⁴(pixel center) multiplier would be a view effect, not physics.

### 6.3 Exposure in ISO / shutter / f-number (view)
- Exposure is pinned as view [code fable-strategy-taxonomy.md §10] and already exists
  (`view.tonemap.exposure`).
- pbrt's imaging ratio is `shutter · ISO / 100` [src film.cpp:233]. It is meaningful only
  for radiance in absolute units. Here units are renderer-relative
  [code src/components/color/spectra/blackbody/README.md:29], and the Poly Haven HDRIs are
  not absolutely calibrated [reasoning]. Mapping ISO/shutter/N to a number would need an
  undeclared constant, which is a guess. **Not planned.**
- Doc disagreement to flag: impl-plan-sensor.md ("exposure … arguably a MEASUREMENT property")
  and impl-plan-realistic-camera.md T4 (the imaging ratio in `sensor/`) both predate taxonomy
  §10's pinned "Exposure/tonemap: view". The code follows §10.
- f-number already has a physical meaning through D (depth of field). In a radiance-measuring
  camera it does not change brightness, and that is consistent [src cameras.cpp:552-555].

### 6.4 Chromatic aberration. Skip.
It needs a wavelength-dependent lens. That fits the camera seam (it already receives `wl`),
but in spectral programs it requires the one-time hero collapse, and in RGB it has no physical
form. That is realistic-camera/spectral territory [code docs/impl-plan-realistic-camera.md:33-35, 196].

---

## 7. Risks and open questions (each answerable in a line)

1. **Gaussian truncation (fable-imagery fork 3).** Options: untruncated Box–Muller (this plan:
   weight 1, no erfinv, no table, effectively cut at 2.88 px by 24-bit ξ) or truncated at 2σ
   (that plan's pick: needs an erf/erfinv approximation, and the kernel is then whatever the
   approximation's density is). My pick is untruncated, because it has fewer parts. Owner decides.
2. **Field name.** `measurement.pixel: 'box' | 'tent' | 'gaussian'` (the family's name) or
   `measurement.filter`? I suggest `pixel`, to match `sensor`.
3. **Blade count compile-time, rotation live.** This follows the fisheye `projection` precedent.
   Alternatively both could be live uniforms with `blades = 0` meaning a disk, but that is a sentinel.
4. **White balance source white:** Planck at every T (neutralizes the scene's own blackbody
   lights) vs pbrt's daylight locus above 4000 K. I suggest Planck.
5. **White balance under `tonemap: 'none'`:** skipped, like exposure (the probe path stays raw),
   or a Validator error? I suggest skipping it, with one rule for both.
6. **Stamp/description churn (A):** adding `pixel` to the resolved measurement changes every
   ProgramDescription snapshot and export stamp. Alternatively record it only when it is not
   `box`, as `aovs` does (:33). I suggest always recording it, because it is part of the integral.
7. Risk: region rounding in `filter-edge`/`bokeh-edge` depends on tools/witness.mjs:177-185
   (checked). The spectral arm's tolerance has not been checked.
8. Glare (§6.1) is the item most likely to matter visually after D and B. It needs its own
   design conversation before any plan.

---

## 8. Estimate (lines, including tests)

| Part | Source | Tests and fixtures | Docs |
|---|---|---|---|
| A pixel filters | ~45 (2 GLSL, registry, types, plan, Validator, feature) | ~90 twin + ~90 witness | ~40 |
| B blades | ~40 (GLSL ~15, descriptor ~25) | ~70 twin + ~70 witness | ~20 |
| D lens helper | ~35 | ~40 | ~10 |
| C white balance | ~60 (matrix module, Validator, ShaderBuilder helper, blackbody XYZ export) | ~50 | ~15 |
| **Total** | **~180** | **~410** | **~85** |

A CHANGELOG entry is added after the batch.
