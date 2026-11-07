# Conductors — the mathematics

*(Occupant math doc for `conductor` and `rough_conductor`. Transcribed source:
`fable-reference-implementations.md` §7c, normative. Fields: `eta`, `k`; `rough_conductor` also
`roughness`.)*

## The Fresnel term

A metal has a complex refractive index η + iκ relative to the outside medium, a function of
wavelength. The unpolarized reflectance at incidence cosine c = cos θᵢ ∈ [0, 1] is

  F(c; η, κ) = ½ (r_s + r_p),
  s² = 1 − c², t = η² − κ² − s², A = √(t² + 4η²κ²), a = √(½(A + t)),
  r_s = (A + c² − 2ca)/(A + c² + 2ca),
  r_p = r_s (A c² + s⁴ − 2ca s²)/(A c² + s⁴ + 2ca s²)

(Mitsuba 3's `fresnel_conductor`; pbrt-v4's `FrComplex` is the same function in complex form).
At c = 1, F = ((η−1)² + κ²)/((η+1)² + κ²); at c = 0, F = 1. η = 0 with κ > 0 is a perfect mirror,
which is the default (η = 0, κ = 1). Real metals show a dip in F and a shift of color toward
grazing incidence that Schlick's approximation from the normal-incidence color cannot produce:
for aluminium the gap reaches 0.118 at 85° in the red, against the projection of the exact
spectral reflectance (docs/claude-2026-11-review/photoreal/conductor/plan.md §1).

Each wavelength lane gets its own F, since reflection sends every wavelength the same way; no
lane is singled out (no hero collapse). In RGB programs the three channels are three lanes,
with η and κ at their stand-ins (a measured table's daylight projection, color/spectra/measured).

## The models

- **`conductor`**: a delta reflection about the shading normal with weight F(cos θᵢ), as
  `mirror` with Schlick replaced (pbrt-v4's `ConductorBxDF` smooth branch: f = F/|cos θᵢ|,
  pdf 1; the delta cancellation leaves weight F).
- **`rough_conductor`**: f = F(|ωₒ·h|)·D(h)·G₁(ωᵢ)G₁(ωₒ)/(4|cos θᵢ||cos θₒ|), the F-free GGX
  lobe of glsl/core/microfacet.glsl (see ggx/ggx.md for D, G₁ and VNDF sampling) times this F.
  The sample weight is F·G₁(ωᵢ), the pdf the lobe's. F depends only on |ωₒ·h|, which the lobe's
  sample and eval report identically, so weight·pdf = eval·|cos θᵢ| holds lane by lane, and F is
  symmetric in ωᵢ, ωₒ, so the BRDF is reciprocal. Separable Smith G, as Mitsuba's
  `roughconductor` (pbrt-v4 uses the height-correlated form).

Single scattering only: the light that bounces between microfacets more than once is lost, as
in `ggx` under `measurement.microfacet: 'single-scattering'`. The energy gain would need the
hemispherical average 2∫₀¹ F(μ) μ dμ per lane, which is not built.

## Conventions

- η and κ are relative to the medium the ray arrives from, and are not corrected for it.
- κ > 0 (a row constraint): η = κ = 0 is 0/0 at normal incidence.
- In a spectral program an optical row takes a number (the same at every wavelength), a scalar
  slider or a named kind with the optical role; an RGB triple of η or κ says nothing about the
  wavelengths between its channels, so it is an RGB-only value.

## Verification

`rough_conductor/rough_conductor.test.ts`: the twin (`conductor/fresnel.ts`) against pbrt's
complex form (≤ 1e-12), float32 rounding (≤ 4e-6), the limits above, 0 ≤ F ≤ 1, and the §11.3
χ² / triple / pdf checks through the shared lobe for gold, aluminium and F ≡ 1. Witnesses:
`conductor-gold` (normal incidence and 70°, spectral and RGB), `conductor-perfect` ⇄
`conductor-perfect-ref` (F ≡ 1 against ggx and mirror with f0 = 1), `veach-metals`.
