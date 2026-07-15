# HG–Draine (approximate Mie) — what it computes and why

Jendersie & d'Eon 2023's analytic stand-in for tabulated Lorenz–Mie scattering off water
droplets (fog, cloud, mist). It is a **two-lobe mixture**

```
φ_fog(θ) = (1 − w_D)·φ_HG(g_HG) + w_D·φ_Draine(α, g_D)
```

where the Draine lobe `φ_Draine = (1/4π)·(1−g²)/(1+g²−2g cosθ)^{3/2}·(1+α cos²θ)/(1+α(1+2g²)/3)`
generalizes HG (α=0 ⇒ HG, α=1 ⇒ Cornette–Shanks). A single authoring knob — the droplet
**diameter `draine_d` (µm)** — drives all four internal parameters via the paper's fitted
maps (Eqs. 7–10, valid ~5–50µm), so the medium reads as physical droplet size, not four
abstract dials.

## Why over hg / rayleigh

`hg` is a smooth, monotone fit — it can't match a real Mie forward peak *and* the correct
falloff at once. `rayleigh` is exact only for molecules ≪ λ. Mie (this) is the right regime
for **λ-sized water droplets**: the strong, correctly-shaped forward peak that gives fog and
cloud edges their true brightness and silver lining. The blend matches ~95% of Mie's forward
half. **Limit (paper's own):** it does NOT reproduce the weak backscatter fogbow/glory peaks
— those still need tabulated Mie.

## Exactness

`evalDraine` and `sampleDraineCos` are transcribed **verbatim** from the authors' reference
`draine.hlsl` (MIT). The sampler is an exact closed-form quartic CDF inversion (weight = 1);
the mixture is importance-sampled by selecting a lobe by `w_D` (reusing the rescaled `ξ.x`),
so the whole model samples exactly with the combined pdf `= (1−w_D)p_HG + w_D p_Draine`,
which equals the eval. NaN-guards cover g→0 (isotropic) and α→0 (Draine→HG); neither fires
in the fitted fog range.
