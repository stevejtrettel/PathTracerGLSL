# Realistic (multi-element) camera — the physical measurement functional

**Author:** Fable (August 2026) · **Status:** SHELVED (owner-declined Aug 1 2026 — "if this
has essentially no optical benefit let's stay with thin lens"; §0's honest assessment was
the deciding read. **Re-triggers:** the spectral axis landing (dispersion/chromatic
aberration is the real optical payoff, and it rides this design as a data-only rider), or
a concrete want for cat's-eye/aberrated bokeh. The T1 weight channel + fisheye mask and
the thin-lens blade aperture remain independently available small batches if ever wanted.)
**Authority context:** `impl-plan-cameras.md` (the camera carve; realistic lens sat on its
deferred ledger "when research calls" — this is that call), `fable-strategy-taxonomy.md`
(camera = W_j, measurement), `components/camera/README.md` (Category A/B randomness pins),
`components/sensor/README.md` (the reserved exposure occupant), trace-loop contract (`Ray`
= pure geodesic seed). References: pbrt-v3 §6.4 (RealisticCamera — element tracing, exit
pupil, thick-lens focusing, ray weighting; the v4 code is `realistic.cpp`), pbrt-v4 §5.4
(PixelSensor — the camera/sensor radiometric split, the imaging ratio).

## 0. Honest payoff statement (read before scoping)

For most current scenes — stopped-down or moderate apertures, subjects near frame center —
the converged image will be **visually near-identical to thin-lens**. Thin lens is a good
model of a well-corrected lens at moderate f-numbers. The realistic camera is *visibly*
different in exactly these regimes:

1. **Wide-aperture bokeh character** — out-of-focus highlights off-center become cat's-eye
   (mechanical vignetting truncates the pupil), and spherical aberration shapes the disk
   (bright-edged / soap-bubble bokeh) instead of thin-lens's perfectly uniform circles.
2. **Wide-angle designs** — real barrel distortion and strong corner falloff (cos⁴ ×
   vignetting) emerge from the element stack.
3. **Field curvature** — the surface of sharp focus is not a plane; edge focus genuinely
   differs from center focus at wide apertures.
4. **Radiometrically correct exposure falloff** across the frame (the cos⁴·A/z² weight).

The single most *recognizable* lens artifact — chromatic aberration — is **deferred**: it
needs per-wavelength η, i.e. the Category-B wavelength seed (`color: 'spectral'`). It is a
data-only rider once spectral lands (dispersion coefficients per glass in the same table).

Consequence for this plan: the demo/witness scenes must be designed IN the differing
regimes (small bright emitters at varying depth, wide aperture, wide-angle design), or the
batch will "prove" the new camera looks like thin-lens. The infrastructure payoff (the
weight channel, table-valued derived uniforms, the sensor axis) is real regardless and is
what the spectral/dispersion future builds on.

## 1. Shape of the build — three batches, strictly ordered

Per the standing rule (refactors never mixed with features):

- **T1 — the weight channel**: a family-wide contract change, features frozen. Gate: exact.
- **T2+T3 — the `realistic` occupant**: CPU lens machinery (TS-twin-tested) + the GLSL
  occupant through the existing registry door (one folder + one line).
- **T4 — sensor `exposure` occupant**: independent, small; opens `measurement.sensor`.

## 2. T1 — the weighted camera ray (contract change, own batch)

**The fact forcing it:** a multi-element camera's ray carries weight `cos⁴θ ·
A_pupilBounds / z²`, and **zero** when the ray dies inside the stack (aperture clip / TIR).
The weight depends on the lens sample and traversal success — only `camera_generateRay`
knows it; it cannot ride `sensor_response(film, ray_dir)`.

**New contract** (glsl/core — the contract spine; README + structs comment updated same
batch, the A/B-split doc obligation pattern):

```glsl
struct CameraRay { Ray ray; float weight; };   // weight ≥ 0; 0 = no contribution (still a sample)
CameraRay camera_generateRay(vec2 film, vec2 xiLens);
```

- Weight is a **scalar float** (achromatic) until the spectral seed exists — it is a
  measure-theoretic factor, not a radiometric literal, so spectral discipline is untouched
  (scalar × Spectrum).
- All six occupants: wrap the existing return in `CameraRay(make_ray(...), 1.0)`. No math
  changes.
- All three accumulator occupants (`average`/`variance`/`oneshot`):

```glsl
CameraRay cr = camera_generateRay(film, xiLens);
Spectrum color = SPECTRUM_ZERO;
if (cr.weight > 0.0)
    color = cr.weight * sensor_response(film, cr.ray.direction) * transport_trace(cr.ray);
```

  A zero-weight sample is **still accumulated** — it is part of the estimator (masked /
  vignetted regions must converge to 0, not be resampled).
- `provides` signature string in `generate/features/camera.ts` updates; snapshots
  re-goldened (signature churn only); glslang green.
- **Gate: ×1.0 is exact** — every witness number unchanged. Full sweep is the batch gate
  (owner-called, as always).

**Rider — the fisheye circular mask** (deferred since the camera batch precisely for want
of this channel): fisheye returns weight 0 outside the image circle. This is the cheap
*proof of the zero path* — witness: corner-patch mean of a masked fisheye render is
exactly 0; interior numbers unchanged. Small, same seam, lands with T1.

## 3. T2 — CPU lens machinery (`components/camera/realistic/lens.ts`, pure TS)

The whole expensive half is host-side — the precompute-the-HOW discipline is the design:

- **`LensElement { curvatureRadius, thickness, eta, apertureRadius }`** (meters; authored
  tables in mm, scaled on load). `curvatureRadius == 0` marks the aperture stop. Shipped
  designs transcribed from the published (patent-derived) data pbrt ships: `dgauss50`
  (double-Gauss 50mm), `wide22`, `telephoto`, `fisheye10` — data modules, one file.
- **`traceLensesFromFilm` / `traceLensesFromScene`** — spherical-interface intersect +
  Snell refraction + aperture clip; the reference implementation for both the probe
  tracing below and the GLSL twin (transcribe MATH, per standing rule).
- **Cardinal points** (paraxial traces from both sides → f_z, p_z pairs) and the
  **thick-lens focus solve**: focal length `f = f_z − p_z`, and the film-to-lens spacing
  offset (pbrt eq. 6.4)
  `δ = ½ (p′_z − z + p_z − √((p′_z − z − p_z)(p′_z − z − 4f − p_z)))`.
- **`boundExitPupil(r0, r1)`** — probe-trace a grid of (film strip × rear-element tangent
  plane) rays; 2D bbox of survivors, expanded by the sample-spacing guard. **64 radial
  strips** (rotational symmetry; runtime rotates the sample by the film azimuth). Probe
  density is a knob: pbrt's 1024² per strip is seconds of CPU — we pin a **reduced default
  (128² per strip, ~1M traces)** sized for interactive slider response, with the density a
  constant in lens.ts (raise it if a witness shows bbox clipping).
- **f-number**: the f-stop control scales the stop row's aperture radius
  (`R_stop = f / 2N`, clamped to the physical stop).

**Tests (vitest, the TS-twin regime — this is the math gate):** dgauss50 focal length
matches the published value; the focus solve round-trips (an axial bundle from
`focusDistance` converges at the film plane); pupil bboxes are contained in the rear
aperture and shrink monotonically with f-number; `traceLensesFromFilm` energy bookkeeping
(survivor fraction sane per strip).

## 4. T3 — the occupant (`components/camera/realistic/`)

One folder + one `CAMERA_MODELS` line, per the carve's acceptance rule.

**Authored fields** (`authoredParams`): `lens` — enum over the shipped designs
(STRUCTURAL: table length N is a compile-time array size and the choice changes the
integral; recompiles, like fisheye's projection); `filmDiagonal` (mm, default 43.27 — full
frame). **No `fov` field exists on this occupant** — field of view is an *output* of
lens + film size. (README taxonomy note; the perspective-fov mint in the feature already
gates on `pinhole|thinlens`, untouched.)

**Controls:** `camera.focusDistance`, `camera.fstop` — always-live sliders (instrument
principle), both `triggersReset`.

**Derived values — the first TABLE-valued derived uniforms.** Two `float[]` uniforms
(`PlannedUniform` already supports `float[]` + `arrayLength`; engine uploads via
`uniform1fv` — the driven-lights CDF precedent):

- `u_lensEl[4N]` — the element table, stop radius scaled by the live f-stop, rear
  thickness set by the live focus solve.
- `u_exitPupil[4·64]` — the pupil bbox table. **Depends on focusDistance AND fstop** (both
  move the pupil), so its compute closure is **memoized on the input pair** — exactly the
  `basisFor` memo pattern already in `features/camera.ts`. Cost per *change* ≈ the reduced
  probe (~100ms JS); per frame ≈ a key compare.
- Scalars: `u_rearZ`, `u_pupilArea` companion terms, film-mm-per-pixel.

The `CameraDerived` interface grows a `'float[]'` type arm (+ `arrayLength`) — a small,
additive extension of the mint rail. Uniform budget: ~(15·4 + 256)/4 ≈ 80 vec4 — inside
even the ES 3.0 minimum (224) alongside the main program's existing load; if a future
budget squeeze appears, the tables move to a small RGBA32F texture (the data-textures
fallback), not a redesign.

**GLSL** (`realistic.glsl`, transcribed from lens.ts — the TS twin is ground truth):

1. `film` → physical film-plane mm via `filmDiagonal`/`u_imageSize` (centered, y-up).
2. Pupil: strip index from film radius → bbox from `u_exitPupil` → bilinear sample by
   `xiLens` → rotate by film azimuth. (2D — the Category-A ceiling holds; no sampler or
   film plumbing changes anywhere in this plan.)
3. Trace film→scene through N interfaces (constant-bound loop; dynamic uniform-array
   indexing is fine in ES 3.0 — the CDF arrays already do it): sphere intersect, aperture
   clip, Snell; any failure → `return CameraRay(ray, 0.0)`.
4. Success: transform to world via the shared basis (`u_cameraForward/Right/Up` +
   position — the lens's optical axis rides the same look-at frame; orbiting works
   unchanged), weight `= cos⁴θ · u_pupilArea / z²`.

## 5. T4 — sensor `exposure` occupant (independent)

pbrt-v4's split, committed: the **camera** owns aperture radiometry (T3's weight); the
**sensor** owns shutter × ISO, one scalar — the **imaging ratio**. Second occupant of
`sensor/` (`components/sensor/exposure/`), which per its README opens the
`measurement.sensor` strategy knob. Controls: `camera.iso`, `camera.shutter` (+ the
calibration constant). Spectral response curves / white balance stay deferred with the
wavelength seed. Witness: exact-multiple twin vs `ideal` (imaging ratio k ⇒ every pixel
×k — an exact-scalar equality).

## 6. Witnesses (registry entries; sweep owner-called)

| Witness | Kind | Asserts |
|---|---|---|
| weight-1 sweep (T1) | all existing | every number unchanged (×1.0 exact) |
| `fisheye-mask` (T1) | mean | masked corner patch ≡ 0; interior unchanged |
| `realistic-white` (T3) | twin | constant-radiance env: GPU center/edge pixel means match the TS twin's predicted `L·cos⁴·A/z²` values — the radiometric gate |
| `realistic-focus` (T3) | structural | focus-wedge: sharpest silhouette at `focusDistance`; CoC grows both ways |
| `realistic-vignette` (T3) | structural | corner-patch mean < center-patch mean (cos⁴ + mechanical vignetting), monotone with aperture |
| `exposure-scale` (T4) | equality | imaging ratio ≡ exact scalar multiple of `ideal` |

**Demo card** (the visible payoff, designed in the differing regime): `nightlens` — small
bright emitters at staggered depths, wide-open dgauss50 → cat's-eye + aberrated bokeh
across the frame; f-stop slider walks it back to thin-lens-like. Cat's-eye character and
converged bokeh shape are the owner's visual check.

## 7. Deferred ledger

- **Dispersion / chromatic aberration** — per-λ η (Sellmeier/Abbe per glass row) rides the
  Category-B wavelength seed; data-only rider on this table when spectral lands.
- **Polygonal-blade aperture on thin-lens** — legitimate idealized-diaphragm optics
  (uniform N-gon map, still 2D), its own mini-batch; NOT the parametric
  vignetting/CA sliders of production renderers (fakes — the element stack gives the real
  effects).
- **Aperture bitmap importance sampling** (bokeh textures) — 2D CDF machinery, needs the
  weight channel (pdf factor); after blades if wanted.
- **Polynomial optics** (Hanika & Dachsbacher 2014; Schrade 2016 wide-angle) — an
  *optimization occupant* replacing the trace loop with a fitted sparse polynomial; not
  worth the offline fitting toolchain while camera-ray cost is negligible vs the path.
- **Tilt-shift / anamorphic** — occupants behind the same door when wanted.
- **Motion-blur shutter time** — Category B seed field, unchanged by this plan (the
  exposure occupant's `shutter` control is a radiometric scalar, not a time sample).
