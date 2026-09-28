# Sellmeier surface index

Smooth and rough dielectric materials accept a constant three-term index:

```ts
ior: { sellmeier: { B: [B1, B2, B3], C: [C1, C2, C3] } }
```

The definition is `n²(lambda) = 1 + sum(B_i lambda² / (lambda² - C_i))`.
B is dimensionless and C is in µm², **not** the resonance wavelength in µm.
The evaluator converts the ray's nm coordinate to µm. Spectral mode evaluates at
the hero wavelength; RGB uses the helium d line, 587.5618 nm. A wavelength-independent
form folds to a scalar. Coefficients are not live controls.

## Domain

B and C are finite nonnegative triples. Every C must lie outside the closed interval
`[(0.360)², (0.830)²]`, excluding poles throughout the renderer's wavelength range.
The resulting index must be positive and finite over that interval. With these signs,
`d(n²)/d(lambda²) = -sum(B_i C_i / (lambda²-C_i)²) <= 0`; the red endpoint is the
minimum, so validation does not rely on sampling a grid. The blue endpoint bounds the
maximum. A zero-strength term still requires an out-of-band C because the shader
evaluates all three divisions.

This is a restricted normal-dispersion form, not an arbitrary rational function or
an absorbing resonance model. As with scalar/Cauchy indices, coefficients and the
resulting arithmetic must remain representable in GPU float32. No runtime pole
clipping, index clamp or fallback is applied. Mathematical validity does not establish
the physical validity of a fit outside its source's wavelength range.

## Ownership

`color/values.ts` owns the common index-form predicates, fixed RGB reference and CPU
evaluation dispatch. Each component owns its formula. The planner records which index
helpers the spectral program uses; the generator includes only those helpers and
emits either a scalar RGB index or a hero-wavelength call in the existing `ior_of`.
Coefficients survive ordinary and data-backed material planning unchanged.

The [Cauchy surface-dispersion contract](../cauchy/README.md) also governs Sellmeier:
one-time collapse before index-dependent surface scattering, no changes to camera PDFs
or earlier radiance, and the existing smooth/rough BSDFs. Spatially dispersive
`medium.ior` remains unsupported. Sellmeier is an index form, not reflectance or emission.

## N-BK7 example and provenance

```ts
import { N_BK7 } from 'src/authoring/opticalGlass.js';

glass: { model: 'dielectric', ior: N_BK7 }
```

The authoring constant contains nominal SCHOTT N-BK7 coefficients from the
[December 1, 2023 datasheet](https://media.schott.com/api/public/content/41e799d0bf874807a0bb8e702fbb75b5?v=54856406).
That sheet supplies refractive indices from 312.6 to 2325.4 nm, encompassing our
360–830 nm interval. The equation and micrometre convention are in
[SCHOTT Optical Glass 2025, §10, equation 10.10](https://media.schott.com/api/public/content/b37dbd8fa7e64662b2d0ae523ae56238?download=true&v=97f67105).
These are room-temperature relative indices; the renderer treats ambient air as n=1.
This constant supplies only refractive index: it does not import the sheet's absorption,
temperature dependence, or manufacturing tolerances. The clear demo is idealized lossless glass.

The gallery scene `spectral-dispersion-bk7` uses this index with a thin white source stripe.
Its dispersion is substantially weaker than the synthetic Cauchy prism example.

## Verification

Compiler tests compare CPU values with eight independently tabulated spectral-line
indices, check RGB reference/constant folding, invalid coefficients and poles, and
compile smooth/rough glass under both region-table layouts, including mixed Cauchy
and Sellmeier scenes. `npm run witness:dispersion` checks the generated GPU index at
three tabulated lines and oblique Snell refraction under both layouts. A deliberately
missing square root must fail. The integrated N-BK7 slab is compared with independent
quadrature of its two-transmission Fresnel spectrum; the existing collapse and medium
regressions run alongside it. `--fixed` selects only the deterministic probes.
