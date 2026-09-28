# Spectral authoring in production renderers

Research date: September 28, 2026. Research and recommendations only; sampled-spectrum
authoring is not implemented by this document. Scope: how spectra enter materials and
lights, how their magnitudes are interpreted, and what to adopt for this GLSL renderer.

The evidence supports a shared spectral-value representation with property-specific
meaning. RGB, analytic spectra and measured curves coexist. Spectrum, emitting geometry,
angular distribution and camera response remain separate concerns. A new lamp-specific
transport system is not needed to represent a fluorescent emitter.

## Commercial and production evidence

| Renderer | Documented practice | Relevance here |
|---|---|---|
| Indigo | Material base emission accepts RGB, uniform, blackbody, peak and tabulated spectra. Its technical reference also places a regularly tabulated spectrum in material albedo, with linear interpolation. | Direct precedent for the same curve representation serving emission and material colour. [Manual](https://www.indigorenderer.com/book/export/html/1166), [technical reference](https://indigorenderer.github.io/) |
| Octane | RGB and Gaussian spectrum inputs can supply albedo. Gaussian spectrum controls centre wavelength, width and strength and is also used for emission. Its OSL intrinsics expose Gaussian, rectangular and triangular spectral functions. | Artist-authored spectral shapes are reusable values, not special light geometries. [Material inputs](https://docs.otoy.com/cinema4d/UniversalMaterial.html), [Gaussian node](https://docs.otoy.com/standaloneSE/GaussianSpectrum.html), [intrinsics](https://docs.otoy.com/standaloneSE/InputParameterTypes.html) |
| Maxwell | Area emission comes from object surfaces. Color selection includes RGB/HSV/XYZ; colour-temperature selection can leave intensity independent, while thermal-temperature mode changes both colour and intensity. It also exposes photometric strength controls and lamp presets. | Separating spectral shape from strength is a deliberate user-facing choice; thermal power and a colour-temperature control have different semantics. [Area emitters](https://nextlimitsupport.atlassian.net/wiki/spaces/maxwell/pages/22685394/Area%2Bemitters) |
| Wētā Manuka / PhysLight | The published Manuka pipeline reconstructs spectra for lights and BSDF parameters, with different bounds for reflectance and emission. PhysLight documents the broader light/camera measurement chain and publishes measured camera sensitivity data. | Roles and sensor ownership matter even when spectra share a mathematical representation. [Manuka presentation](https://jo.dreggn.org/path-tracing-in-production/2017/talk-jo/), [PhysLight repository](https://github.com/wetadigital/physlight) |

These are public workflow/interface observations, not claims about proprietary storage
or shader implementations. Indigo's linked technical format reference identifies itself
as version 2.4; it is historical implementation evidence, while its current manual still
documents the emission forms. Manuka's presentation is from 2017, not a description of
every current internal API. Maxwell's examined page does not establish arbitrary sampled
SPD import. No feature comparison here relies on a forum comment or marketing claim of
physical accuracy.

Octane's documentation sometimes describes RGB conversion as finding a colour's wavelength.
We should not take that literally: the relevant documented feature is its spectral input
node. Our reconstruction remains a choice of spectrum consistent with a colour, not a
unique recovery of a light's physical spectrum.

## Open implementations: useful details, distinct from commercial evidence

Mitsuba 3 documents spectral inputs usable as either BSDF or emitter parameters. It has
regular and irregular sample tables with linear interpolation. Its RGB conversion differs
by role: RGB emission uses an illuminant-based reconstruction. An explicitly flat spectrum
is different from RGB white. [Spectra documentation](https://mitsuba.readthedocs.io/en/latest/src/generated/plugins_spectra.html)

In the inspected irregular-spectrum implementation, evaluation reads the unnormalized
curve, while wavelength sampling and its normalized PDF are separate methods. This is a
useful distinction for future narrow-band sampling: a sampling distribution is not the
authored spectral magnitude. [Source](https://raw.githubusercontent.com/mitsuba-renderer/mitsuba3/master/src/spectra/irregular.cpp)

PBRT v4 exposes a common Spectrum interface over constants, sampled curves, RGB-derived
forms and blackbody. Its piecewise-linear form allows nonuniform wavelength spacing.
RGB albedo, unbounded quantities and illuminants have separate conversions. The scene
format supports wavelength/value pairs, files and named spectra, including CIE fluorescent
illuminants. [Representation](https://www.pbr-book.org/4ed/Radiometry%2C_Spectra%2C_and_Color/Representing_Spectral_Distributions),
[RGB roles](https://www.pbr-book.org/4ed/Radiometry%2C_Spectra%2C_and_Color/Color),
[scene format](https://www.pbrt.org/fileformat-v4)

Endpoint and normalization details must be checked at the loader as well as the evaluator.
PBRT's piecewise-linear evaluator returns zero outside its stored range, but its
FromInterleaved constructor path can extend endpoint values across the visible range and
optionally normalize luminance. Reading only the evaluator would give an incomplete
description of imported spectra. [Source](https://raw.githubusercontent.com/mmp/pbrt-v4/master/src/pbrt/util/spectrum.cpp)

These interfaces are useful precedents; copying their class hierarchies or sampling APIs
is not required by our compiler-generated GLSL architecture.

## Actual lamp data

CIE publishes relative fluorescent-lamp spectra at 1 nm spacing, with dataset metadata
specifying 380–780 nm coverage, linear interpolation, zero extrapolation and approximated
data quality. It records a DOI, checksums and CC BY-SA 4.0 attribution/share-alike terms.
This is a concrete source for fluorescent presets; a 1 nm table is not a claim of exact
sub-nanometre lamp physics. [Dataset](https://www.cie.co.at/datatable/relative-spectral-power-distributions-illuminants-representing-typical-fluorescent-0),
[metadata](https://files.cie.co.at/Publications-datasets/CIE_illum_FLs_1nm.csv_metadata.json)

CIE also supplies high-pressure discharge illuminants and daylight datasets. These are
documented relative spectral distributions, not absolute radiance measurements or a
universal spectrum for every bulb of a named technology. Specific neon, sodium and mercury
presets still need identified source data and conditions before being advertised as real
lamp models. [Discharge dataset](https://www.cie.co.at/datatable/relative-spectral-power-distributions-high-pressure-discharge-lamp-illuminants),
[dataset catalogue](https://www.cie.co.at/data-tables)

## Recommendations for this repository

The following are our design conclusions from the evidence, not claims that all renderers
make identical choices.

1. **Keep one sampled spectral value.** Wavelength/value data and evaluation are shared.
   A material's reflectance row or an emission row supplies the physical role. Reuse the
   existing descriptor roles and value-resolution path. Emission can be the first enabled
   reader without defining an emission-only data format.
2. **Retain the useful authoring forms.** Planck remains analytic and first-class. RGB/HSV
   are convenient colour controls; HSV belongs in authoring/UI with an explicit RGB colour
   space and transfer convention. A future Gaussian helper would be a useful spectral
   control for artificial coloured sources, independently of the measured-data work.
3. **Preserve raw sample magnitudes.** The core curve should not silently normalize itself.
   Relative lamp presets can expose a separate strength and an explicitly named normalization
   policy. Our former maximum-reference-RGB Planck convention was a project choice, not
   an industry-wide rule. The owner has since accepted fixed-reference CIE Y for relative
   light controls; the [implementation plan](claude-spectral-implementation-plan.md#accepted-shared-shape-and-strength-direction-sep-28-blackbody-step-implemented)
   defines the direction and explicit migration from the existing Planck convention.
   Raw-data unit conversion remains to be settled.
4. **Start with piecewise-linear wavelength samples in nm.** Supporting nonuniform knots
   accommodates both coarse smooth curves and closely spaced features. Regular tables can
   be authored through a helper. Treat ordinates as point samples, not integrated line
   energies. Keep native sample locations rather than silently converting every spectrum
   to the observer table's 5 nm spacing.
5. **Make range behaviour explicit.** Zero outside the authored range is a useful proposed
   default and matches the CIE fluorescent metadata. It is not a claim about unmeasured
   wavelengths of a real lamp. Presets must record their coverage and source interpretation;
   the renderer still integrates only its supported 360–830 nm domain.
6. **Resolve names to ordinary spectral data.** A fluorescent preset and a user-provided
   curve should use the same reader. Geometry and angular emission continue to belong to
   existing light components. A daylight spectrum alone does not define a sky's directional
   distribution.
7. **Verify the integral, not only the visible colour.** Proposed gates: preserve the area
   of a narrow finite-width band under knot refinement, independently integrate its RGB
   projection, test one curve in emission and reflectance roles, and compare actual sampled
   light and hit-side readers including packed emitters. Correct data representation and
   efficient wavelength sampling are separate tasks; very narrow bands can remain noisy
   under the existing camera wavelength proposal.

## Decisions to settle before implementation

- Exact spelling of a sampled value, scale ownership and first supported reader sites.
- Raw radiometric unit conversion. Relative light helpers use the accepted fixed-CIE-Y
  direction above; material reflectance retains its fractional meaning.
- Adoption of zero extrapolation and the explicit handling of incomplete source coverage.
- CPU projection using the union of spectrum and observer knots, so narrow features are
  not skipped by a fixed coarse quadrature; any RGB reflectance projection must also include
  the declared reference illuminant.
- Shader/data placement and original-form identifiers for packed lights. These must follow
  the existing compiler/engine contract and light-table layout owner.
- Initial source-backed presets and whether narrow-band variance warrants a later sampling
  change. This research does not authorize changing the transport loop or wavelength proposal.

The recommendation is to adapt the established shared-spectrum pattern to our existing
compiler. The remaining work is a small explicit authoring/storage contract, not inventing
new light physics for each bulb type.
