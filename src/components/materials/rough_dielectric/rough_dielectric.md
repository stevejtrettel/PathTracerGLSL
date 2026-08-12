# rough_dielectric — the microfacet (rough) dielectric

Design authority: `docs/fable-rough-dielectric.md`. Transcription:
`docs/fable-reference-implementations.md` §7b (Walter et al. 2007 / pbrt-v4 §9.7).

## What it is

A microsurface of GGX-distributed facets, each a perfectly smooth dielectric interface.
Light hitting a facet either reflects or refracts by exact Fresnel; the macroscopic BSDF
is the visible-facet average. Two lobes, both non-delta: **the first model in the house
that is transmissive AND glossy**, which is why it comes with a capability split rather
than just a `.glsl` file.

Roughness blurs successive internal bounces, which is one of the three physical
mechanisms that keep real glass from showing the idealized-specular artifacts the
glass-lab night catalogued (absorption is the second — author it as a `medium` on the
same material; dispersion is the third and awaits the spectral era).

## The math, and the two places it could go wrong

With the shading frame's `n` toward `region_from`, `wo` is always in the upper
hemisphere and `η = n_i/n_t` comes from the hit's regions. `α = max(1e-3, roughness²)`
is derived host-side (D4).

**Sampling.** Draw a visible microfacet normal `m` by VNDF; `F = dielectric_fresnel(wo·m, η)`
picks the lobe (`uc < F` → reflect about `m`, else refract through it). TIR is not a
special case: it is `F = 1`.

Because Smith masking is separable here, both weights collapse to a single factor:

| lobe | weight |
|---|---|
| reflection | `G1(wi)` — the `F` cancels against `P(reflect) = F` |
| transmission | `G1(wi) · η² · transmittance` — the `1−F` cancels against `1−F` |

If a future edit ever needs the full `f·|cos|/pdf` quotient at the sampling site,
something has drifted from the VNDF construction.

**Evaluation** recovers the generalized half-direction `m ∝ wi·etap + wo`
(`etap = 1` reflecting, `n_t/n_i` transmitting), faces it up, and rejects backfacing
microfacets. The transmission lobe carries Walter's change-of-variables denominator
`(wi·m + (wo·m)/etap)²` and the `η²` radiance compression.

The two failure modes worth naming, both caught by the twin
(`rough_dielectric.test.ts`) rather than by inspection:

1. **A wrong Jacobian** (`denom`) keeps the image plausible but breaks
   `weight·pdf = eval·|cos|` — the triple check fails immediately.
2. **A missing η²** looks fine until a path terminates inside the medium (an emitter in
   glass, a camera underwater). It is the same factor F-ETA pins for the smooth
   dielectric: 0.554 correct vs 0.980 without.

## Conventions this model deliberately does NOT follow

- **No `EffectivelySmooth` switch.** pbrt flips to a delta BSDF below a roughness
  threshold. Here `nonDeltaLobes` is a compile-time capability and `roughness` may be a
  live slider, so a runtime flip would break the NEE guard and the MIS bookkeeping.
  Author true smooth glass as `dielectric` — the α floor makes it unreachable here, and
  the library carries both delta/rough pairs on purpose (`mirror : ggx`,
  `dielectric : rough_dielectric`).
- **No Schlick.** A dielectric's Fresnel is exact and cheap; `f0` is a conductor's
  vocabulary and this model declares no such row.

## Energy (a declared truncation, now MEASURED)

Single-scattering microfacet transmission loses energy as roughness grows — the
multiple-scattering terms between facets are simply absent from the model. This is a
property of the model, not a bug, and it lives in the bias ledger.

The number that matters is the **energy albedo** `A(μ, r, η)` — one interaction's
retained fraction, measured by the TS twin (`rough_dielectric.test.ts`). Note the
MEASURE: `∫f|cos|dω` in the radiance measure is *not* the energy fraction, because the
transmission lobe carries η² (a change of basic radiance, not a loss — it reads ≈ 0.47
for a *lossless* air→glass interface). Undo it on the transmitted part and the physical
statement appears. `A = 1` is lossless:

**air → glass** (η = 1/1.5)

| cos θo | r=0.02 | 0.05 | 0.1 | 0.2 | 0.3 | 0.5 | 0.7 |
|---|---|---|---|---|---|---|---|
| 0.95 | 1.0000 | 1.0000 | 1.0000 | 0.9998 | 0.9989 | 0.9909 | 0.9655 |
| 0.70 | 1.0000 | 1.0000 | 1.0000 | 0.9995 | 0.9973 | 0.9791 | 0.9304 |
| 0.40 | 1.0000 | 1.0000 | 0.9999 | 0.9979 | 0.9890 | 0.9450 | 0.8568 |
| 0.15 | 1.0000 | 0.9999 | 0.9985 | 0.9758 | 0.9370 | 0.8906 | 0.7447 |

**glass → air** (η = 1.5, TIR live)

| cos θo | r=0.02 | 0.05 | 0.1 | 0.2 | 0.3 | 0.5 | 0.7 |
|---|---|---|---|---|---|---|---|
| 0.95 | 1.0000 | 1.0000 | 0.9999 | 0.9982 | 0.9905 | 0.9232 | 0.7501 |
| 0.70 | 1.0000 | 1.0000 | 0.9998 | 0.9951 | 0.9753 | 0.8618 | 0.6863 |
| 0.40 | 1.0000 | 1.0000 | 0.9996 | 0.9923 | 0.9595 | 0.8064 | 0.6337 |
| 0.15 | 1.0000 | 0.9998 | 0.9973 | 0.9564 | 0.8795 | 0.7724 | 0.6105 |

**Reading it:** below roughness 0.1 the loss is under 0.3% everywhere — unmeasurable in
a render. At 0.2 it is ≤ 2.4% (worst case, grazing). The curve only bites above ~0.3,
and hardest on the EXIT side at grazing, where the escape-from-TIR geometry needs the
inter-facet bounces the model omits: 8–23% at roughness 0.5, up to 39% at 0.7.

**Consequence for the deferred compensation:** ordinary frosted glass (roughness
0.1–0.3) does not need it. A scene authored above ~0.5 does, and it will read as glass
that is too dark and insufficiently saturated. That is the trigger condition — the
tables above are already the shape a Turquin-style fit would tabulate, so the work when
it comes is a fit plus one multiply, not a re-derivation.

## Rows

| row | storage | shared with |
|---|---|---|
| `roughness` | field | ggx |
| `transmittance` | field | dielectric |
| `ior` | region-table | dielectric |
| `alpha` (derived) | field | ggx |

No new `MaterialProperties` field: every row was already in the union.
