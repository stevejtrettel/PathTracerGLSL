# measured — tabulated optical constants of metals

`{ measured: '<table>' }`, where `<table>` is one of `metal-Ag-eta`, `metal-Ag-k`, `metal-Al-eta`,
`metal-Al-k`, `metal-Au-eta`, `metal-Au-k`, `metal-Cu-eta`, `metal-Cu-k`, `metal-CuZn-eta`,
`metal-CuZn-k` (CuZn is brass). Each is the real (`eta`) or imaginary (`k`) part of a metal's
complex refractive index η + iκ as a function of wavelength in nm. It goes in optical slots (the
`eta` and `k` rows of the `conductor` and `rough_conductor` materials). The tables have no live
numbers.

**Source.** pbrt-v4's named spectra of the same names, copied verbatim into `data.ts` from
`src/pbrt/util/spectrum.cpp` at commit b0bdf461ba5dd6504b70ebf0932acc0fe7aa744f
(https://github.com/mmp/pbrt-v4), Apache License 2.0, "Copyright(c) 1998-2020 Matt Pharr,
Wenzel Jakob, and Greg Humphreys"; the license text is shipped at `public/licenses/pbrt-v4.txt`.
The Ag, Al, Au and Cu tables have 56 knots from 298.8 to 885.6 nm, brass 61 knots from 290 to
890 nm in 10 nm steps. All contain the renderer's wavelengths, 360–830 nm.

**Spectral programs** evaluate a table at each wavelength lane: linear interpolation between
the knots that bracket λ (pbrt's `PiecewiseLinearSpectrum`), found by a binary search over
const arrays. Each table the program uses becomes one generated function
`measured_<table>(Wavelengths)`; a program links only the tables its materials name.

**RGB programs** use the stand-in `d65StandIn(table)` (standIn.ts): the table weighted by
daylight (D65) and projected to linear sRGB, divided channel by channel by the same projection
of the constant 1, for η and κ separately. Fresnel is not linear in η and κ, so a metal shaded
with its stand-ins differs from the projection of its spectral reflectance. Measured against
that projection from 0° to 89° incidence, the worst channel error is 0.047 for gold (red at
normal incidence, where the true value 1.022 is outside the sRGB gamut), 0.018 for brass,
0.017 for copper, 0.002 for aluminium and 0.001 for silver (plan
docs/claude-2026-11-review/photoreal/conductor/plan.md §6).
