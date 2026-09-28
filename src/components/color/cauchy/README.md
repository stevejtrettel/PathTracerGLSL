# Cauchy index and surface dispersion

A surface index row accepts `ior: { cauchy: [A, B, C?] }`, meaning

```
n(lambda) = A + B / lambda_um² + C / lambda_um⁴
```

Coefficients are constant; omitted C is zero. The initial supported form is normal
dispersion: finite A > 0 and B, C >= 0. These signs make n positive and pole-free on
360–830 nm without sampling a validation grid. Coefficients, indices and the existing
Snell/Fresnel arithmetic must remain representable in GPU float32, as with scalar indices.
There is no runtime index clamp or replacement value. Wavelength carriers remain in nm;
the evaluator converts the units. RGB evaluates the same function at the helium d line,
587.5618 nm. Zero B/C folds to the scalar index in both renderers and needs no collapse.

This is an explicit authoring function, not a fit to a named glass. Sellmeier/Abbe forms,
glass catalogues, live coefficients and spatially dispersive GRIN remain separate work.
Cauchy is rejected on radiometric fields and on `medium.ior`. Existing wavelength-independent
spatial index formulas keep their current GRIN behaviour. This stage supports smooth and
rough dielectric interfaces, including closed meshes and instances, with the existing
opaque-dielectric shadow policy.

## Ownership

Material descriptors mark region-index rows with `semantic: 'index'`. `modelIndexRow`
reads that declaration; the planner records the consumer materials and actual dispersive
interior regions. Open meshes and thin batches do not supply an interior index. The
spectral program's dispersion record also selects the Cauchy evaluator; an empty region
list needs no collapse state. RGB has no dispersion record or collapse code.

`ior_of(region,p,wl)` keeps its existing signature and evaluates the hero's index. The
ordinary and data-backed region accessors use the same value emitter. The dielectric
BSDFs, Snell/Fresnel conventions and eta-scale arithmetic are unchanged.

The generated transport owns one Boolean and one helper:

```
if (!wavelengths_collapsed) {
    throughput *= (4,0,0,0);
    wavelengths_collapsed = true;
}
```

At an index-consuming interface with a dispersive region on either side, the walk calls
it after scoring arrival emission and checking the bounce budget, before NEE or continuation.
The predicate uses declared index consumption, not transmission sampled at this event.
Consequently both reflection and refraction at a dispersive dielectric collapse; an
index-independent mirror or Lambert boundary does not. Repeated interfaces do not rescale.
The ray wavelengths, original camera PDFs and accumulated radiance are never modified.

## Why the compensation is valid here

The film averages four wavelength contributions. Until the first dispersive event, the
packet distribution is invariant under cyclic relabelling: both wavelength proposals use
uniformly shifted quarter-quantiles. Existing cameras are wavelength-independent. The
pre-collapse transport decisions preserve that symmetry:

- Surface sampling uses scalar, wavelength-independent indices and roughness. RGB spectra
  affect weights, with no special lane selected by the surface proposal.
- Analytic/GRIN free flight selects uniformly among all lanes and divides by the complete
  mixture density. Tracking probabilities use symmetric spectral reductions.
- Roulette uses maxima; light/sky selection uses wavelength-independent CPU RGB powers.
- Intersection, event budgets and the first-collapse predicate do not depend on a hero's
  sampled Fresnel branch. Index is first used by scattering after collapse.

For such a prehistory and stopping event, the expected contribution in each cyclic lane is
equal after accounting for its wavelength density. Keeping lane zero and multiplying its
future throughput by four therefore preserves the expected four-lane sum. Earlier radiance
retains its own four-lane estimate. The camera PDF remains the marginal wavelength density;
the factor four cancels only the film's lane average, not that density.

After collapse, the other wavelengths can still participate in medium proposal mixtures.
Their continuation weights are zero; the actual mixture PDF still accounts for the sampled
proposal, so the surviving lane remains unbiased. Those extra proposals can affect variance.
This argument is specific to the current proposal rules; a future hero-biased prehistory or
wavelength-dependent camera requires its own accounting.

| Path | First collapse and subsequent handling |
|---|---|
| Air → glass → air | Before first BSDF/NEE; exit keeps the flag and uses the same hero |
| Two glass objects / internal reflection | One compensation, regardless of later crossings or branches |
| Chromatic fog → rough glass | Symmetric fog history; collapse before rough NEE and continuation |
| Emission before glass | Earlier radiance untouched; only later throughput loses companions |
| Camera inside uniform dispersive glass | Interior straight flight keeps the packet; first index-consuming wall collapses |
| Non-dispersive GRIN → glass, or glass → GRIN | Existing bend remains wavelength-independent; glass owns collapse |
| Spatially dispersive GRIN | Not supported by this authoring form; needs collapse before the interior advance |

Background references: [PBRT's dielectric material](https://www.pbr-book.org/4ed/Textures_and_Materials/Material_Interface_and_Implementations)
selects an index wavelength before constructing its BSDF; its secondary-termination storage
convention differs from this renderer's throughput-only compensation. The
[dielectric equations](https://pbr-book.org/4ed/Reflection_Models/Dielectric_BSDF) are the
existing library's reference.

## Verification

`tests/compiler/dispersion.test.ts` covers coefficient/role validation, RGB reference-line
and zero-dispersion equivalence, both index-table layouts, declared consumers, thin/closed
regions, generated event ordering and mixed renderer order.

`npm run witness:dispersion` executes the actual generated index and BSDF readers, checks
oblique Snell directions and eta² weights, one-time collapse, earlier emission preservation,
index-independent boundaries and the final budget vertex. Missing and repeated compensation
mutations must fail. A separate actual-walk lane check rejects moving collapse after rough NEE. A normal slab at exactly two bounces is compared with independent
quadrature of `(1-F(lambda))²` times the source spectrum. Chromatic-fog scenes (analytic, tracking and wavelength-independent GRIN) compare packet
transport with a one-wavelength reference, which duplicates the hero coordinate in all lanes
and disables collapse; its measurement is the same, but its prehistory samples one spectrum.
The comparisons use measured standard errors, not agreement of the BSDF with its own PDF.
`--fixed` runs only the deterministic probes, including volume emission accumulated before glass.

The gallery exposes `spectral-dispersion-slab`, the view-through white-stripe scene
`spectral-dispersion-prism`, and `spectral-dispersion-beam`: a finite-cone white source,
prism, floor and receiving screen. The beam scene uses deliberately strong synthetic
Cauchy dispersion, not a named optical glass. Its wall caustic arrives through
BSDF-sampled screen → glass → aperture paths; MIS retains aperture hits after the
specular chain at full weight. Straight NEE shadow connections cannot sample that chain.
The existing delta `beam` has no hittable aperture and cannot replace `softbeam` here.
Expect slow, speckled convergence; decreasing divergence further increases variance.
There is no scattering medium, so the beam is visible on surfaces, not in empty air.

This is a surface-dispersion stage, not completion of all S2 forms or the full spectral
release gate.
