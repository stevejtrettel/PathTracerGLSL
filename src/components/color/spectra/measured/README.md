# measured — tabulated spectra

`{ measured: { table, scale? } }`, where `table` names one of the shipped tables, each a function
of wavelength in nm. A table goes in settings of its own role:

| Tables | Role | Meaning |
|---|---|---|
| `metal-Ag-eta`, `metal-Ag-k`, `metal-Al-eta`, `metal-Al-k`, `metal-Au-eta`, `metal-Au-k`, `metal-Cu-eta`, `metal-Cu-k`, `metal-CuZn-eta`, `metal-CuZn-k` (CuZn is brass) | optical | the real (`eta`) or imaginary (`k`) part of a metal's complex refractive index η + iκ: the `eta` and `k` rows of `conductor` and `rough_conductor` |
| `colorchecker-<patch>`: `dark-skin`, `light-skin`, `blue-sky`, `foliage`, `blue-flower`, `bluish-green`, `orange`, `purplish-blue`, `moderate-red`, `purple`, `yellow-green`, `orange-yellow`, `blue`, `green`, `red`, `yellow`, `magenta`, `cyan`, `white-9.5`, `neutral-8`, `neutral-6.5`, `neutral-5`, `neutral-3.5`, `black-2` | reflectance | the fraction of light a ColorChecker Classic patch reflects (surface colors) |
| `illuminant-A`, `illuminant-D65`, `illuminant-FL2`, `illuminant-FL11`, `illuminant-LED-B3` | emission | the relative spectral power of a CIE illuminant: incandescent (A), daylight (D65), cool white fluorescent (FL2, called F2 in older CIE tables), narrow-band tri-phosphor fluorescent (FL11, F11), phosphor-converted blue LED (LED-B3) |

A table in a setting of another role is an error, as is an unknown name.

**Emission and `scale`.** An illuminant is normalized to unit reference CIE Y and multiplied by
`scale` (default 1, nonnegative, a constant or a `{param}` slider), the blackbody kind's
convention: the emission's luminance is `scale` in renderer-relative units, whatever the table's
overall factor. In formulas, with T the table and the CIE 1931 curves of the sensor,

`E(λ) = scale · T(λ) / K`, `K = ∫ ȳ T dλ / ∫ ȳ dλ` over 360–830 nm.

`illuminant-D65` at scale 1 is the same light as the RGB emission (1, 1, 1): sRGB's white is D65
at unit Y. `scale` is an error on other tables.

## Sources

`data.ts` (metals): pbrt-v4's named spectra of the same names, copied verbatim from
`src/pbrt/util/spectrum.cpp` at commit b0bdf461ba5dd6504b70ebf0932acc0fe7aa744f
(https://github.com/mmp/pbrt-v4), Apache License 2.0, "Copyright(c) 1998-2020 Matt Pharr,
Wenzel Jakob, and Greg Humphreys"; the license text is shipped at `public/licenses/pbrt-v4.txt`.
The Ag, Al, Au and Cu tables have 56 knots from 298.8 to 885.6 nm, brass 61 knots from 290 to
890 nm in 10 nm steps.

`colors.ts` (patches and illuminants) is written by `tools/spectral/measured-colors.mjs` from the
downloads listed in docs/claude-2026-11-review/spectral-data-sources.md:
- the patches are the BabelColor average of 30 charts
  (https://www.babelcolor.com/index_htm_files/ColorChecker_RGB_and_spectra.zip) as colour-science
  ships it (`DATA_BABELCOLOR_AVERAGE`, colour commit 9072a98d), 36 knots from 380 to 730 nm in
  10 nm steps;
- A and D65 are the CIE 1 nm tables (https://cie.co.at/data-tables) taken every 5 nm from 360 to
  830 nm. D65's 1 nm values are linear between its 5 nm values; A's differ from that line by at
  most 0.13%;
- FL2, FL11 and LED-B3 are the CIE 5 nm tables, 380–780 nm. The script checks every illuminant
  against colour-science's copy.

## Evaluation

A table that starts above 360 nm or ends below 830 nm (the renderer's wavelengths) holds its end
values beyond them, out to 359 and 831 nm: pbrt-v4 reads every named spectrum this way
(`PiecewiseLinearSpectrum::FromInterleaved`). The patches therefore hold their 380 nm value
below 380 nm and their 730 nm value above 730 nm, and FL2, FL11 and LED-B3 hold their 380 and
780 nm values. The metal tables already cover 360–830 nm.

**Spectral programs** evaluate a table at each wavelength lane: linear interpolation between
the knots that bracket λ (pbrt's `PiecewiseLinearSpectrum`), found by a binary search over
const arrays. Each table the program uses becomes one generated function
`measured_<table>(Wavelengths)`; a program links only the tables its values name. An illuminant
on a light-table row (the light tree) is read from the row header: the table's index in the
shipped order and `scale / K`; the reader chooses among the illuminants the program holds.

**RGB programs** use stand-ins:
- an optical or reflectance table: `d65StandIn(table)` (standIn.ts), the table weighted by
  daylight (D65) and projected to linear sRGB, divided channel by channel by the same projection
  of the constant 1. A patch's stand-in is its linear sRGB color under D65; it agrees with
  colour-science's ASTM E308 computation within 0.0020 for every patch. `colorchecker-cyan` has a
  negative red (−0.028, outside the sRGB gamut); RGB programs clip it to 0 with a compile
  warning, and spectral programs are exact.
- an illuminant: `scale · unitLuminanceStandIn(table).rgb` (standIn.ts), the table's color at
  unit Y. D65 gives (1, 1, 1) and A (1.845, 0.826, 0.233), Planck's law at 2856 K.

A plain RGB color equal to a patch's stand-in matches the patch under daylight and differs from
it under other light (metamerism): FL11's narrow lines, for example, light the measured patch
and the color's smooth spectrum differently.

Fresnel is not linear in η and κ, so a metal shaded with its stand-ins differs from the
projection of its spectral reflectance. Measured against that projection from 0° to 89°
incidence, the worst channel error is 0.047 for gold (red at normal incidence, where the true
value 1.022 is outside the sRGB gamut), 0.018 for brass, 0.017 for copper, 0.002 for aluminium
and 0.001 for silver (plan docs/claude-2026-11-review/photoreal/conductor/plan.md §6).

## Verification

tests/components/measured.test.ts: the tables' roles and domains, the end-value extension, the
search twin against pbrt's interpolation at every knot and midpoint, the patches against
colour-science (`tools/spectral/colorchecker-reference.py`, tolerance 0.0025), each illuminant's
normalization against an independent quadrature of the GPU curves, D65 white, A against Planck,
exact linkage, the light-table row and the diagnostics. tests/compiler/measuredColors.test.ts:
the linked helpers in both color models and the light-tree reader. Witnesses
(tests/witnesses/scenes/measuredColorsWitness.ts): `spectral-colorchecker-d65` (a patch under a
measured D65 sky, exact) and `spectral-measured-lamps` (A and FL11 quad lamps under power
selection and the light tree, NEE and MIS).
