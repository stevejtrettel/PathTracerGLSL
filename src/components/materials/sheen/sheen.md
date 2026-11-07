# sheen — fuzz over a Lambertian base

Cloth, velvet, upholstery, peach skin, a film of dust: a diffuse surface under a layer of fine
fibers that scatter light back and forward at grazing angles. The model is OpenPBR's fuzz layer
over a Lambertian base, with the fuzz lobe of Zeltner, Burley and Chiang, "Practical
Multiple-Scattering Sheen Using Linearly Transformed Cosines" (2022). The GLSL transcribes
MaterialX `libraries/pbrlib/genglsl/lib/mx_microfacet_sheen.glsl` (`mx_zeltner_sheen_*`) and
the layering of `mx_sheen_bsdf.glsl`.

## The model

Rows: the base albedo ρ (`albedo`), the fuzz color c (`sheen_color`), the fuzz coverage W
(`sheen_weight`, in [0, 1]) and the fuzz roughness r (`sheen_roughness`, in [0, 1]). The fits
are read at r clamped to [0.01, 1], the range of the original fits (MaterialX's clamp); that
clamped value is the derived field `sheen_r`.

With μ_o = cos θ_o and μ_i = cos θ_i on the side wo arrives from,

  f(ω_i, ω_o) = W·c·E(μ_o)·D(ω_i | ω_o)/μ_i + (1 − W·E(μ_o))·ρ/π

(OpenPBR's albedo scaling: the base receives what the fuzz does not reflect).

- **D** is a linearly transformed cosine: the clamped cosine distribution D₀(w) = max(w_z, 0)/π
  pushed through a matrix M. In the LTC frame (the local frame turned about n so that ω_o lies
  in the +x half of the xz plane), M⁻¹ = [[a⁻¹, 0, b⁻¹], [0, a⁻¹, 0], [0, 0, 1]] with rational
  fits a⁻¹(μ_o, r), b⁻¹(μ_o, r), and for w' = M⁻¹·w,

    D(w) = D₀(w'/|w'|)·|det M⁻¹|/|w'|³ = (w_z/π)·(a⁻¹/|w'|²)².

  M⁻¹ fixes the z component, so it maps the upper hemisphere onto itself and D integrates to 1
  over it exactly (checked by quadrature in the twin).
- **E**(μ_o, r) is the fuzz lobe's directional albedo, a Gaussian fit. It dips to −2·10⁻⁵ near
  r = 0.05, so it is clamped into [0, 1]; its maximum over the domain is 0.745. Hence
  1 − W·E ≥ 0.255.

D depends on ω_i only through its azimuth relative to ω_o, so the model needs no tangent field:
it is the same on analytic shapes, meshes and SDFs whatever the frame's tangent (checked in the
twin by rotating the frame).

## Sampling

Write p = W·E(μ_o) and g = π·D/μ_i = (a⁻¹/|w'|²)². Then f = (c·p·g + ρ(1 − p))/π. The sampler
draws a cosine-distributed w₀; with probability p it maps it to the fuzz lobe (w = M·w₀
normalized, turned back by φ_o), otherwise it keeps it. The mixture's density is

  pdf = p·D + (1 − p)·μ_i/π = μ_i·(p·g + 1 − p)/π,

whichever lobe drew the direction, and the weight is

  f·μ_i/pdf = (c·p·g + ρ(1 − p))/(p·g + 1 − p).

The LTC sampler's own density (a⁻¹·|M·w₀|²)²·w_z/π equals D at the direction it draws (the
twin checks this to 1e-9), so `sheen_pdf` and the sample's pdf are one formula.

## Energy

  ∫ f·μ_i dω_i = W·c·E(μ_o) + (1 − W·E(μ_o))·ρ.

When c = ρ the directional albedo is ρ at every angle and every sample weight is exactly ρ: the
`sheen-furnace` witness reads 0.4 over the whole sphere. With ρ = 0 a pixel reads W·c·E(μ_o, r)
under a unit sky: the `sheen-fuzz` witness checks this at μ_o = 0.2 and 0.5 on all estimators,
which tests E, the normalization of D (NEE, MIS) and the sampler (pt).

W = 0 is Lambert. c = 0 alone is not: it still removes W·E of the base's light (a dark fuzz).

## Non-reciprocity

E depends on μ_o, so f(ω_i, ω_o) ≠ f(ω_o, ω_i). Every technique of the unidirectional
estimators (BSDF sampling, NEE, MIS) evaluates the same f(· | ω_o) with ω_o the camera-side
direction, so they still agree; the model is not fit for an adjoint or bidirectional estimator.

## Color models

E, D and p are wavelength-free numbers; c and ρ are reflectance rows, lifted like any
reflectance. The lobe choice uses no spectrum reduction, so the model is the same in RGB and
spectral programs.

## What it is not

Not a sheen over a glossy or metallic base (this is fuzz over Lambert only; general layering is
separate work), and no anisotropic fibers (no tangent field).
