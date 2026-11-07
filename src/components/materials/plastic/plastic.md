# Plastic: what it computes and why

A smooth dielectric coat with relative index η lies over a Lambertian base with reflectance
R(λ). The coat is infinitely thin and does not absorb. Light refracts in, reflects diffusely
off the base, and bounces between the base and the underside of the coat any number of times
before it leaves. This is Mitsuba 3's `plastic` with `nonlinear = true` (the "interfaced
Lambertian"); the infinite series has a closed form.

## Notation

Local frame n = +z, with μ_i, μ_o > 0 the cosines on the arrival side. Every Fresnel call
takes eta = n_i/n_t, so light arriving from outside sees F(μ) = `dielectric_fresnel(μ, 1/η)`.

D(η) = ∫₀¹ F(μ; η)·2μ dμ is the reflectance of an interface for cosine-distributed light.
K = D(η) is the coat's **internal** diffuse reflectance: light inside the coat meets the
interface with n_i/n_t = η, and for η > 1 everything below the critical cosine is totally
reflected. K is the derived field `coat_fdr`, computed on the host by
`diffuseFresnelReflectance` (plastic.ts) and baked, or recomputed per frame for a `{param}`
`coat_eta`.

## The BSDF

    f(ω_i, ω_o) = F(μ_o)·δ_mirror(ω_i, ω_o) + R/(1 − R·K) · (1 − F(μ_i))(1 − F(μ_o)) / (π η²)

- The first term is the coat's mirror reflection (a delta lobe).
- The second is the base seen through the coat: 1/η² is the radiance compression into the
  coat, R/(1 − R·K) the geometric series of internal bounces. It is symmetric in i and o.
- `plastic_eval` and `plastic_pdf` return only the diffuse lobe; the mirror lobe is delta.

## Sampling

`uc` picks the lobe with P_spec = F(μ_o)/(F(μ_o) + (1 − F(μ_o))·avg R) (Mitsuba's rule;
`plastic_specular_prob`, read by sample and pdf alike). avg is `spectrum_average` over the
program's channels, the same in sample and pdf.

- Mirror lobe: ω_i = 2μ_o n − ω_o, weight F/P_spec, pdf 0, flags `LOBE_REFLECTION | LOBE_DELTA`.
- Diffuse lobe: cosine-weighted ω_i, pdf (1 − P_spec)·μ_i/π, weight f_d·π/(1 − P_spec).

The model has `nonDeltaLobes: true`, and a single sample may still be delta. Transport records
delta-ness per sample (the kernel's `prev_was_delta`), so NEE sees only the diffuse lobe and an
emitter reached through the mirror lobe scores with MIS weight 1.

The selection total is 0 only when nothing scatters (η = 1 over a black base); P_spec is then
0 and the diffuse branch carries weight 0. Where P_spec = 1 (total reflection from outside,
possible for η < 1 at grazing angles) the diffuse branch is never taken, and eval there is 0.

## The directional albedo (exact)

    A(μ) = F(μ) + (1 − F(μ)) · R(1 − K)/(1 − R·K)

It follows from the Stokes identity 1 − D(η) = (1 − D(1/η))/η², which the TS twin checks to
1e-12. **With R = 1, A ≡ 1 for every μ and η**: an exact furnace. At η = 1, K = 0 and F = 0,
so the model is Lambert. For η = 1.5 at normal incidence: K = 0.5963457597, F = 0.04, and gray
R = 0.5 gives A = 0.316071.

## Settings

- `albedo`: the base reflectance, confined to [0, 1] in both color models. R/(1 − R·K) has a
  pole at R = 1/K (1.68 for η = 1.5) and is negative beyond it.
- `coat_eta`: η, positive, the coat's index **relative to the medium outside the object**
  (Mitsuba's int_ior/ext_ior). An object in water with a 1.5 coat takes 1.5/1.33; the model
  does not read the region table. It feeds the host-derived K, so it takes a constant or a
  `{param}`, never an expression or a per-instance attribute.
- The albedo guide reads `albedo`, the base's diffuse color.

In a spectral program R/(1 − R·K) applies per wavelength to the lifted R(λ); in RGB it applies
per channel. For a chromatic R the two differ (the model is nonlinear in R): that is the
declared RGB-color truncation, and the spectral program is the physical one. A gray R is not
lifted through the table, so it is the same flat value in both.

## Two deliberate deviations from Mitsuba

1. **K is exact, not a fit.** Mitsuba uses the Egan–Hilgeman / d'Eon–Irving fits of D (0.1–0.6%
   error for η ≤ 2). Here D is a quadrature: the part below the critical cosine is μc² exactly,
   and the substitution μ = μc + (1 − μc)s² makes the rest smooth for composite Simpson, accurate
   to about 1e-15. It runs once per material, and per frame only for a `coat_eta` slider.
2. **Only the physical `nonlinear` form.** Mitsuba's default divides by (1 − K) instead of
   (1 − R·K) to keep texture colors; for R = 0.5, η = 1.5 at normal incidence that reads 0.520
   where the physical value is 0.316. Mitsuba's `specular_reflectance` row is also dropped
   (its documentation says it should never be touched for realism).

## Not modelled

A rough coat (`rough_plastic` needs tables of the rough interface's transmittance), coat
absorption, a coated conductor, emission.
