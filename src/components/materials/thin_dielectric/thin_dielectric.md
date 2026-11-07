# thin_dielectric — an infinitely thin sheet of glass

A window pane, the glass of a display case or a picture frame: a slab whose thickness is
negligible next to everything else in the scene. Source: pbrt-v4 `ThinDielectricBxDF`
(`src/pbrt/bxdfs.h`), which this model transcribes.

## The model

The sheet has index η relative to the medium around it (`sheet_eta`). Light meeting it at
cosine μ = cos θ_i is partly reflected at the first face; the rest enters, bounces between the
two faces, and leaves either back through the first face or out through the second. Let

  R = F(μ; 1/η),  T = 1 − R,

with F the house `dielectric_fresnel` (its η argument is n_i/n_t, so entering the sheet from
outside it is 1/η). The inner face reflects exactly as much as the outer one: for the refracted
cosine μ_t, F(μ_t; η) = F(μ; 1/η) (the Stokes relation; checked in the twin). So each of the
infinitely many internal bounces carries the same R, and the series sums in closed form:

  R_tot = R + T·R·T + T·R³·T + … = R + T²R/(1 − R²) = 2R/(1 + R),
  T_tot = T²/(1 − R²) = (1 − R)/(1 + R) = 1 − R_tot.

The sheet is lossless: R_tot + T_tot = 1.

**Lobes.** Both are delta.

- Reflection: ω_i is the mirror of ω_o, chosen with probability R_tot.
- Transmission: ω_i = −ω_o, chosen with probability T_tot. The two refractions bend the ray in
  opposite senses, and with no thickness there is no lateral shift.

Each lobe is chosen with the probability of its own weight, so f·|cos|/pdf with the delta
cancellation leaves weight 1 on both branches, in RGB and spectral programs alike (η is one
number for every wavelength). `eval` and `pdf` are 0; NEE skips the model.

**Total internal reflection.** For η < 1 (an air gap inside a denser medium, written as a
relative index) F = 1 beyond the critical angle, and 2R/(1 + R) = 1 there: no special case.

**Values** for η = 1.5 (the thin-pane witness): at normal incidence R = 0.04 and
T_tot = 0.923077; at μ = 0.5, R = 0.089187 and T_tot = 0.836232. A single interface would
transmit 0.96 at normal incidence. An inverted η (2/3 instead of 1.5) is total internal
reflection at μ = 0.5, so the witness's tilted pane would read 0.

## What η means

`sheet_eta` is the sheet's index over the index of the medium around it, as in pbrt (which
carries no surrounding index here) and Mitsuba. A pane in air takes 1.5; a pane under water
takes 1.5/1.33. Nothing checks this: the model does not read the region table, so it cannot
know the surrounding index. The row is a plain positive number (a constant or a `{param}`); a
dispersive Cauchy or Sellmeier index is rejected, because nothing here reads one.

## Boundaries of this version

- **No interference colors.** Soap films and oil slicks need thin-film interference, a
  different spectral model.
- **No tint.** The sheet absorbs nothing. Absorption needs a thickness and σ_a, which change
  the series to R + T²Rτ²/(1 − R²τ²) and T²τ/(1 − R²τ²).
- **No media in the scene.** The walk takes `hit.region_to` as the medium behind a
  transmission. On the front hit of a zero-thickness surface the dispatcher reports
  region_to = the surface's own region, which is not the medium behind it. The dispatcher cannot
  change that without breaking one-sided emitters, which key on the same value. So the Validator
  rejects this model in any scene with a medium (`modelTransmitsWithoutCrossing`).
- **The roulette metric inside a transmissive solid.** When some other model transmits, the walk
  multiplies its roulette metric by (ior_of(region_to)/ior_of(region_from))² at every
  transmission. A pane inside a glass or water solid sees region_from = the solid and
  region_to = the pane's own region (pinned to 1.0) on its front face, and the factor is not
  undone on the way out. It feeds only the roulette's survival probability, so the image stays
  unbiased; such paths are only noisier.
- **Opaque shadow rays.** A shadow ray stops at the pane (`shadows: 'opaque-dielectrics'`, the
  bias ledger's entry for dielectric interfaces). Light from an area emitter or the sky behind
  a window still arrives through BSDF sampling, under every estimator alike; light from a delta
  light behind a window (a `directional` sun) does not arrive at all.
- **Zero thickness is a model, not a shell.** fable-subsurface §5.1's "thin shells absent"
  concerns a scattering thin-walled mode; this sheet has no interior transport.
