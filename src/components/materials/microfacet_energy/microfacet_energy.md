# Microfacet energy compensation

A shared part of the materials family, not an occupant (no registry line). It gives the
microfacet models (`ggx`, `rough_dielectric`) the energy their single-scattering form drops,
under `measurement.microfacet: 'energy-compensated'`. The default, `'single-scattering'`, is a
declared truncation: its limit is multiple scattering on the Smith microsurface (Heitz 2016),
which is not built.

## The loss

GGX with Smith masking counts one bounce between microfacets. A white conductor (F ≡ 1) keeps

    E(μₒ, α) = ∫ f_ss(ωᵢ, ωₒ) |cos θᵢ| dωᵢ,

which is 1 − ln 2 = 0.3069 at normal incidence and roughness 1 (closed form:
(1/4π)·2π∫₀¹ 2c/(c+1) dc), 0.409 at μₒ = 0.5, and 0.916 at roughness 0.5. Rough glass loses
up to 39% at roughness 0.7 on the exit side (the tables in `rough_dielectric/rough_dielectric.md`).
For glass the energy albedo A(μₒ, α, η) is the same integral with the transmission lobe's η²
radiance factor undone (energy, not radiance).

## The model (Turquin 2019, as Blender Cycles ships it)

The compensated BSDF is f_ss times a gain g(ωₒ):

- **Conductor** (Turquin Eqs. 10, 12): g = 1 + F_ms (1 − E)/E with
  F_ms = F_avg E_avg / (1 − F_avg (1 − E_avg)), E_avg(α) = 2∫₀¹ E(μ, α) μ dμ,
  F_avg = 2∫₀¹ F(μ) μ dμ. F_ms sums the further bounces, each reflecting F_avg and escaping
  with E_avg (Kulla–Conty). For F ≡ 1, F_ms = 1 and g = 1/E: the albedo is exactly 1. For
  `ggx`'s Schlick Fresnel, F_avg = f0 + (1 − f0)/21 exactly (`ggx_fresnel_average`); f0 ≤ 1
  keeps F_avg (1 − E_avg) < 1, which is why ggx's f0 row is constrained to [0, 1].
  (MaterialX uses Turquin Eq. 14, 1 + F_avg (1 − E)/E, a visually close variant.)
- **Dielectric** (Turquin Eq. 18): g = 1/A(μₒ, α, η), applied to both lobes. The interface
  then loses nothing, and reflection and transmission keep their single-scattering split.
  The index-matched delta pass-through loses nothing already and carries no gain.

The gain depends on ωₒ only, so **sampling and the pdf are unchanged**: eval' = g·f,
weight' = g·weight, pdf' = pdf, and weight'·pdf' = eval'·|cos θᵢ| holds wherever it held. It
is not reciprocal. This renderer always evaluates f with ωₒ the direction back along the
camera path (BSDF sampling and NEE alike), so pt, pt-nee and pt-mis estimate the same
integral; a light-tracing estimator would need the adjoint.

Exact: the energy of a white conductor and of a lossless dielectric, up to the table's
error. Approximate: the angular shape of the restored energy (the single-scattering lobe,
rescaled) and its color (F_ms).

pbrt-v4's `ConductorBxDF` and Mitsuba 3's `roughconductor` do not compensate; OpenPBR asks
for it.

## The table

`data/energy.bin`: one RGBA float32 texture, 32 wide and 32·32 high (512 KiB), built by
`tools/microfacet-energy/generate.ts` from `build.ts` (`data.ts` records the version
`ggx-smith-energy-v1`, the size, the quadrature and the sha256). The App uploads it as a
built-in asset after checking the hash.

- Texel (i, k·32 + j) is the node (μ_i, α_j, z_k): √μ_i = i/31 (μ ≥ 1e-4), √α_j = j/31
  (α ≥ 1e-3, the models' floor), z_k = k/31 with z = √((r−1)/(r+1)), r = max(η, 1/η)
  (Cycles' `ior_to_z_index`).
- R: A with ωₒ on the rarer side (η = n_i/n_t < 1); G: A with ωₒ on the denser side
  (η > 1, total internal reflection live); B: E_avg(α_j), repeated along the row; A: 0.
- Slice z = 0 is the index-matched limit A = G₁(μₒ) (every microfacet passes ωₒ straight
  through); slice z = 1 is F ≡ 1, where both sides are the white conductor's E. The
  conductor reads that slice: one table serves both models.
- Nodes are the VNDF mean of the sample weight (the lobe choice integrated out), by a
  256 × 256 midpoint rule over the VNDF's square (quadrature error ≤ 2.3e-4); E_avg by a
  64-node midpoint rule in μ.
- `microfacet_energy.glsl` reads it bilinearly in (√μ, √α) and linearly in z, with sizes
  from `textureSize`. Measured furnace error |g·A − 1| at off-grid points: conductor
  ≤ 3.7e-3 (worst at grazing), glass entering ≤ 1.3e-3, leaving ≤ 6e-3 (worst near index
  match and grazing); 16 slices in z would triple the last.

`microfacet_energy.test.ts` checks the asset (hash, the analytic slices, E_avg), that
`build.ts` reproduces it, and the furnace errors through the TS lookup; the `ms-furnace`
witness checks the GLSL lookup under pt, pt-nee and pt-mis, in RGB and spectral.

## Limits

- Not Heitz 2016's random walk; not Kulla–Conty's reciprocal lobe; no light-tracing adjoint.
- Roughness above 1 lies outside the table. The roughness rows (and ggx's f0) are
  constrained to [0, 1], which the Validator checks for constants and for a slider's
  `default`, `min` and `max`. Not checked, and the author's contract: a formula's values, and
  a slider authored without `min` or `max`, whose value `setParam` can move anywhere (the
  panel's own slider stays in [0, 1]). Past roughness 1 the lookup extrapolates linearly in
  √α: at μ = 1 it reads E = 0.203 / 0.046 / −0.215 at roughness 1.1 / 1.25 / 1.5, where
  the quadrature gives 0.220 / 0.132 / 0.057, so the gain is off at once and negative by 1.5.
- The gain makes sample weights exceed 1, so inside strongly trapping glass (high index,
  high roughness) a path's weight is a product of many gains and the estimate is
  heavy-tailed. For a clear sphere at ior 2.4 and roughness 1 seen face-on, a TS random walk
  (this folder's sampling and lookup, 4 × 10⁷ paths) reads 0.999 on average, but its batches
  of 4.6 × 10⁵ paths range from 0.954 to 1.084 (each run's median batch 0.983 to 1.003),
  so a single render of that size can read a few percent off; the `ms-furnace` witness
  leaves that sphere out for this reason (on the GPU it read 2% low at 1024 spp).
- A `transmittance` tint on rough glass scales the transmitted lobe as before; the gain does
  not model the tint's own multiple bounces.
- A future complex-index conductor declares `microfacet: { energy: 'conductor' }` and passes
  its own F_avg.
