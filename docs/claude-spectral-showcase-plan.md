# A spectral showcase scene and a Gaussian spectral material

**Status:** built September 28, 2026 (see CHANGELOG); the plan was revised after an independent
review (Appendix A). The scene's composition is a first draft, to be tuned from renders. The owner asked
for one beautiful scene that uses spectral rendering: a piece of glass, blackbody lights, and
materials whose color is a spectral function (a Gaussian now; a sum of Gaussians perhaps
later). Long renders are fine.

---

# Part 1: what you will see, and the one new piece

## 1. The scene

The aim is a scene that looks good rendered spectrally; most of it has no special spectral
behavior. Three things carry the spectral character:

- **One piece of glass and one beam.** A prism of dense flint glass, SCHOTT N-SF11 (its index
  spreads about four times as much across the visible as N-BK7's: n_F − n_C = 0.0305 against
  0.00805), catches one narrow sunlight-colored beam (about 5800 K) from a lamp housing, as in
  the existing prism-beam demo, and throws one rainbow across the table or wall. The beam must be
  narrow (a spread under about 0.1 radian): a lamp that lights the whole prism face gives each
  color a wide fan, the fans overlap, and the result is a white patch with colored edges.
- **Metamerism in one frame.** Two pools of light on the table. On the left, a white lamp: in a
  spectral render a plain RGB white light is the daylight spectrum D65, because that is how RGB
  light is lifted. On the right, a warm 2700 K blackbody lamp. Each pool holds the same pair of
  spheres: one colored by a Gaussian band, one by its RGB twin (§2). Under the white lamp the
  twins match; under the warm lamp they visibly differ (for a 610 nm band the twin is about 10%
  redder with 30% less green; **Reviewer**). Both lamps get brightness sliders, so the lighting
  can also be switched live. In the RGB render the twins are identical in both pools.
- **Saturated band colors elsewhere:** a few objects in Gaussian colors (a deep red, a cyan, and
  a magenta, which needs a notch band), and a small object glowing at 1800 K like an ember.

The room is dim and warm so the pools and the rainbow read. Everything else is plain RGB. The
rainbow is the slow part; long renders are fine.

## 2. The Gaussian material

A new spectrum kind, `gaussian`:

```ts
albedo: { gaussian: { center: 610, width: 25, peak: 0.85, floor: 0.04 } }   // nm
```

meaning the fraction of light reflected at each wavelength is

`floor + (peak − floor) · exp(−½ ((λ − center) / width)²)`,

with `width` the standard deviation. It goes in reflectance slots (surface colors, glass tint),
with `floor` and `peak` in [0, 1] and `width > 0`, so it stays a physical fraction at every
wavelength. `floor` above `peak` is a notch, which makes colors such as magenta.

- **Spectral renders** evaluate it exactly at the ray's four wavelengths (one line of GLSL).
- **RGB renders** use its RGB stand-in: the color of daylight (D65) reflected by it, in linear
  sRGB, `s_c = ∫ g · D65 · (M x̄)_c dλ / ∫ D65 · (M x̄)_c dλ`, where `M x̄` are the color-matching
  functions taken to linear sRGB. A perfect white reflector gives (1, 1, 1); the division makes
  that exact despite quadrature error. This is the reflectance convention in the spectrum spec's
  §2, computed once on the CPU.
- **Saturated bands are outside the RGB gamut:** a narrow green band needs a negative red, for
  example (530 nm, width 25) gives (−0.17, 0.62, 0.04) (**Reviewer**). A spectral render is
  unaffected; only the RGB preview needs a rule (§3, decision 2).
- Numbers are constants for now; sliders can come later. A sum of Gaussians would be a second
  kind in the same folder later.

This is the first kind added since the spectrum work, so it is also the test of that work's
promise: one folder and one registry line, plus the value type in compiler/types.ts.

---

# Part 2: how it gets built

1. **Daylight on the CPU.** The RGB stand-in needs the D65 spectrum, which today exists only in
   the binary asset the App loads (`curves.bin`, row 0, fourth channel, normalized to Y = 1); the
   compiler cannot read it (**Checked**). Add a small TypeScript table of the same float32
   samples beside the color-matching table, and a test that reads `curves.bin` and requires the
   table to equal it exactly. If the assets are ever regenerated, the test fails and says so.
2. **The kind:** `components/color/spectra/gaussian/` (the `SpectrumKind`, its README), one line
   in the registry. In compiler/types.ts, one `NamedSpectrumValue` union (blackbody, gaussian)
   used where code now says `BlackbodyValue` for "a named kind" (plan/values.ts, `ParamValue`,
   `ResolvedProperty`), so the next kind is one union line. The scan test and the spectra
   README list the new kind. GLSL squares by multiplication (`d * d`, never `pow` of a negative).
   No change to any other kind or to the transport.
3. **N-SF11:** the Sellmeier coefficients B = (1.73759695, 0.313747346, 1.89878101),
   C = (0.013188707, 0.0623068142, 155.23629) µm², from the SCHOTT catalog (as published on
   refractiveindex.info), as an authoring constant beside `N_BK7`, checked against n_d = 1.78472
   and V_d = 25.68. The data covers 370–2500 nm, so 360–370 nm is an extrapolation; the scene
   keeps about 12 bounces, since total internal reflection is common in a flint prism.
4. **The scene:** a demo file with a spectral renderer (MIS) and an RGB preview, filed in the
   gallery. The beam lamps are `softbeam` lights with blackbody emission, which the light kind
   accepts but no witness has covered; the verification adds that case. Quad lights are
   one-sided, so the room light faces the table.
5. **Verification, written first:**
   - CPU: a flat reflector (`floor = peak = 1`) projects to (1, 1, 1); the stand-in agrees with
     an independent fine quadrature; the D65 table equals the binary.
   - Diagnostics: out-of-domain values (`peak > 1`, `width ≤ 0`, the kind in an emission slot)
     get messages; a snapshot case each.
   - Output: the digest unchanged for every existing scene (the kind is new, nothing else
     moves); the new scene's shaders pass the static GLSL compile.
   - GPU: a Gaussian-colored surface under a known light against its analytic value, and a
     blackbody softbeam against a blackbody quad of the same power, in a targeted witness run (a
     few minutes; I will ask before anything long); and the metameric pair identical in the RGB
     render. The rainbows themselves are judged by eye, and I will measure how many samples they
     need.
   - An independent review before reporting.

## 3. Decisions for you

1. **Spelling:** `{ gaussian: { center, width, peak, floor } }` in nm, with `width` the standard
   deviation? (Or give the width as the full width at half maximum, which is 2.355 σ.)
2. **A band outside the RGB gamut, in an RGB render:** clip its negative channels to 0 with a
   compile warning naming the material (recommended: the RGB render is a preview, and the
   spectral render stays exact), or make it an error, which would forbid saturated bands in any
   scene that also has an RGB renderer?
3. **The scene** in §1: one beam through the prism, the two lamp pools with the metameric pair,
   band-colored objects, an ember, a dim room. Anything to add or drop?

## Appendix A: what the independent review found

| Finding | Change |
|---|---|
| A lamp lighting the whole prism face makes overlapping color fans: a white patch with colored edges, not a rainbow; SF11's spread (~0.16 rad at minimum deviation) needs a beam under ~0.1 rad | narrow blackbody softbeams in housings, as in the existing beam demo |
| Many bands' RGB stand-ins leave [0,1]³ (negative for saturated greens, above 1 for broad bands) and nothing catches it | decision 2 |
| The metameric pair differs visibly under 2700 K (ΔE ≈ 8 for 610 nm, ≈ 16 for 580 nm narrow); the RGB render is identical under any light, and the scene has no daylight to show the match | wording in §1 |
| Code that means "a named kind" says `BlackbodyValue` in three places; the scan test and README list kinds by name; `pow` of a negative is undefined in GLSL | step 2 |
| The flat reflector already projects to (1,1,1) because the matrix is derived from the same white; the division only absorbs quadrature error | §2 wording |
| "SF11" must name one glass; N-SF11 matches N-BK7's naming; "four times" is right but follows from (n_d − 1)/V_d, not the Abbe ratio; the data starts at 370 nm | §1, step 3 |
| `floor ≤ peak` excluded notches (and so magenta) | domain relaxed |

The review confirmed: the formula and domain, the stand-in convention, spectral evaluation after
the dispersion collapse, that every reflectance slot of every material model reaches the kind,
that paths through the glass to a hittable lamp are counted in full (so the rainbows converge),
and the D65 table plan.

