# Blackbody migration: measured comparison

**Status (Sep 27, 2026): comparison complete; the subsequent migration is implemented. See the [current contract](../src/components/color/blackbody/README.md).**

This report compares formulae under maximum-RGB normalization. The renderer now uses
reference-CIE-Y strengths; the current contract records that separate normalization change
and the gallery's converted strengths. The numbers below remain the historical audit.

The Planck projection is close to the current RGB approximation within its effective
1667–25,000 K range. The largest signed linear-channel difference on an inclusive 1 K
sweep is **0.013921645 at 1667 K** (1.392% of the unit peak). It is the negative blue
component that the current implementation clips. If negative values are clipped for
display only, the maximum linear-channel difference is **0.001888537 at 2759 K**
(0.189% of the peak). These are sampled channel differences, not perceptual metrics,
continuous-domain bounds, or bounds on arbitrary rendered scenes.

At the Hearth demo’s 2900 K default, the largest channel changes by 0.180% of the
peak and signed luminance by −0.243%. No renderer or scene has been changed by this audit.

## Definition and measurement

Compare the actual `kelvinToRGB` function with the proposed definition in
[the implementation plan, §4.4](claude-spectral-implementation-plan.md#44-resources-and-numeric-definitions).
Both outputs have maximum linear RGB channel one (`scale = 1`). The current function
clamps temperature to [1667, 25000], approximates CIE xy, uses its existing RGB matrix,
and clips negative channels. The candidate integrates Planck radiance through the
shipped CIE 1931 sensor, using its own current matrix and curve normalization, preserving
signed channels. The measured change therefore includes the small matrix difference too.

For numerical convenience the audit evaluates the dimensionless ratio

```text
b(λ,T) = B(λ,T) / B(550 nm,T)
       = (550/λ)^5 · expm1(c₂/(550T)) / expm1(c₂/(λT))
c₂ = hc/k = 1.4387768775039338e7 nm·K
K(T) = max(P_CIE[b(·,T)])
emission(λ) = scale · b(λ,T) / K(T)
```

The reference wavelength and Planck’s common prefactor cancel in the final normalized
spectrum. Temperature changes colour; `scale` retains the current artistic magnitude
convention, rather than becoming absolute thermal radiance. No D65 factor multiplies
Planck emission. D65 remains the illuminant of the existing RGB emission reconstruction.
The normalization is defined against the reference CIE sensor; it is not recomputed
against a future camera’s response, which would change the light when switching sensors.

Physics: [PBRT’s Planck law](https://www.pbr-book.org/4ed/Radiometry%2C_Spectra%2C_and_Color/Light_Emission).
Constants: exact SI h, c and k from [NIST](https://physics.nist.gov/cuu/Constants/Table/allascii.txt).
Curve data: `jh-cie1931-d65-v1`, using the actual float32 samples and their piecewise
linear interpolation over 360–830 nm. This is a reference for the shipped sensor, not
an integration against an independently resampled or full continuous observer.

Composite Simpson quadrature at 0.5 nm was checked against 0.25 nm at every integer
temperature in the existing range: maximum normalized discrepancy **3.913e-12**.
Direct SI Planck evaluation at five wavelengths and all 15 report temperatures agrees
with the ratio formula within **7.106e-15 relative**. These checks verify this CPU audit;
they do not certify a future GLSL evaluation or its float32 bounds.

## Representative direct-emission values

All values below are signed linear RGB, before display clipping or tonemapping.
Rows outside the existing clamp range evaluate the candidate at the authored temperature:
they describe a separate range change, not just replacing the Kim approximation.

| K | Current RGB | Planck RGB | Maximum channel change (% of unit peak) |
|---:|---|---|---:|
| 1000 | 1.000000, 0.175754, 0.000000 | 1.000000, 0.008697, -0.019584 | 16.706% |
| 1500 | 1.000000, 0.175754, 0.000000 | 1.000000, 0.133091, -0.019663 | 4.266% |
| 1667 | 1.000000, 0.175754, 0.000000 | 1.000000, 0.175029, -0.013922 | 1.392% |
| 2000 | 1.000000, 0.256221, 0.007923 | 1.000000, 0.256792, 0.008144 | 0.057% |
| 2900 | 1.000000, 0.458632, 0.135407 | 1.000000, 0.456832, 0.134729 | 0.180% |
| 3200 | 1.000000, 0.516821, 0.194301 | 1.000000, 0.515655, 0.194124 | 0.117% |
| 6500 | 1.000000, 0.943558, 0.992755 | 1.000000, 0.942923, 0.992537 | 0.064% |
| 12000 | 0.527804, 0.634505, 1.000000 | 0.527266, 0.634502, 1.000000 | 0.054% |
| 25000 | 0.377354, 0.512346, 1.000000 | 0.377677, 0.512025, 1.000000 | 0.032% |
| 40000 | 0.377354, 0.512346, 1.000000 | 0.342393, 0.480175, 1.000000 | 3.496% |

The candidate has negative blue at integer temperatures 1667–1899 K within the current
range. This is a positive spectrum outside the sRGB gamut, not negative emitted energy.
The signed film contract should preserve it until display. This observation also matters
for any RGB light-selection heuristic: future migration checks must cover negative RGB
projection components while requiring nonnegative sampling probabilities.

## Why direct lamp colour is not a sufficient spectral test

The audit also projects a Planck source through the existing RGB-authored reflector
`[0.1, 0.5, 0.8]`. It compares this with reconstructing a spectrum from the same Planck
source’s RGB using the existing emission lift. The common geometric/Lambert factor is
omitted. The direct RGB reconstruction errors and reflected differences are:

| K | Direct RGB reconstruction max error | Reflected max channel difference |
|---:|---:|---:|
| 3200 | 0.0003740 | 0.0005758 |
| 6500 | 0.0001032 | 0.0062837 |
| 12000 | 0.0003468 | 0.0071532 |

At 6500 K and 12000 K the reflected channel differences substantially exceed the direct
RGB reconstruction errors. A near-match on a grey receiver would miss the discarded
spectral shape. This motivated the fixed-wavelength and selective-receiver tests in
the subsequent implementation, covering emitter-hit and light-sampling paths.

## Migration decision

Use one Planck definition in both colour modes, keep the max-channel `scale` convention,
and preserve signed RGB projection. This audit supplied the appearance evidence for D5. The owner subsequently accepted the
shared spectral-first replacement; the implemented domain is 1000–40000 K.

Treat the temperature range explicitly. The Hearth slider advertises 1000 K but the
old function gave every input below 1667 K the same colour. A true 1000 K source
is much redder and has 35.724% lower signed luminance at the same max-channel scale.
The recommended low-temperature behavior is to evaluate 1000 K as 1000 K. Extending the
supported domain and choosing rejection versus saturation outside it must be stated in
the migration contract; the samples here do not certify every positive temperature.

The migration requires original-form storage for packed constant emitters, shared
constant/live normalization, fixed-wavelength GPU checks, and both renderer projections.
The old implementation accepted blackbody on some non-emission surface properties;
the migration now restricts it to emission, rather than treating normalized Planck emission
as a bounded reflectance or clamping it into one. The audit itself introduced no production code. The linked implementation note records
the completed migration and its tests.

## Reproduce and inspect

```bash
npx vite-node scripts/audit-blackbody.ts /tmp/blackbody-comparison
open /tmp/blackbody-comparison/comparison.html
```

The script writes the machine-readable `comparison.json` and a standalone HTML table
with paired swatches, the unclamped-range rows marked separately, and a selective-receiver
comparison. Swatches apply sRGB encoding and display-only clipping, with no exposure or
tone map. The page was rendered and visually inspected in Chromium.
