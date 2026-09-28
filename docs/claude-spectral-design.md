# Spectral rendering — design

**Author:** Claude, Sep 26 2026. **Status (Sep 27):** four-wavelength spectral rendering
is built for the capability set documented in the
[spectral component](../src/components/color/spectral/README.md), including Planck emission.
Wavelengths belong on the ray; the sensor owns spectral response. Initial Cauchy surface
dispersion is built; other non-RGB/index forms, dispersive GRIN and full public-release
verification remain planned. The original analysis
below records the design's starting point; the implementation plan identifies accepted
choices and the current verification evidence.

The [implementation plan](claude-spectral-implementation-plan.md) turns this design into
reviewable interfaces, stages and verification gates. It marks accepted decisions and built
stages separately from proposals; its additional choices are not implicitly owner-approved.

**Starts from:**
- [fable-compiler-contracts.md](fable-compiler-contracts.md) §8 (hero wavelengths,
  Jakob–Hanika upsampling, XYZ film) and §2.5 (the `Spectrum` discipline);
- [fable-strategy-taxonomy.md](fable-strategy-taxonomy.md) (`color: 'rgb'` is a truncation
  whose limit is `'spectral'`);
- [trace-loop-contract.md](trace-loop-contract.md) (the `Ray` is a pure geodesic seed);
- [fable-module-anatomy.md](fable-module-anatomy.md) (descriptors state facts; no generator
  branches on a model's name);
- [claude-scene-once-plan.md](claude-scene-once-plan.md) step 4, which waits on §3.5 and §6
  of this document.

**How facts are marked.**
- *read*: I read the code at HEAD `1ed553b` (file:line given).
- *measured*: I ran something.
- *derived*: worked out in this document.
- *source*: literature or another renderer's source, cited in §2.
- *prediction*: expected, not checked.

---

## 0. Summary

**The colour-model system (§3).** Today `#define Spectrum vec3` is a typedef written before
the compiler existed. It names the type but not what the numbers mean, so a spectral mode has
no place to plug in. The proposal is a pick-one component family `color/`, the colour
counterpart of `ambient/`, with two occupants, `rgb` and `spectral`, selected by the existing
`measurement.color` field. The occupant owns four things:

- **the representation:** `Spectrum` is a `vec3` of RGB coordinates, or a `vec4` of values at
  four wavelengths;
- **the carrier:** the per-path `Wavelengths` that give those numbers their meaning. It is a
  placeholder in RGB, as Mitsuba 3 does;
- **the lift:** how an authored value becomes a `Spectrum`, by the role the consumer declares
  (reflectance, coefficient, emission);
- **the projection:** how a path's `Spectrum` becomes a pixel.

Nothing else in the program interprets a `Spectrum`'s components. Materials, lights, phase
functions, the transport techniques, MIS and roulette stay model-free.

The wavelengths are passed explicitly to the functions that resolve scene quantities, and
the resolved records (`MaterialProperties`, `MediumProperties`) carry them. So no material,
light or phase signature changes for the wavelength-preserving models in this scope.
**D3 is decided (§3.4): current wavelengths live on `Ray` and the arrival record `Hit`.**
The original camera wavelengths and their sampling PDFs stay with the estimator; throughput
and accumulated radiance remain on `PathState`.

**How do we deal with wavelengths?** Every camera path carries four wavelengths: a hero λ₀
drawn from a density p(λ) on [360, 830] nm and three companions at equal steps of p's CDF. At
the film each sample is projected through the CIE 1931 colour-matching functions to linear
sRGB, so the accumulators, tonemaps and exports are unchanged. An RGB render and a spectral
render of one scene can be compared pixel by pixel. When a path's *geometry* starts to depend
on wavelength (a dispersive refraction), the path keeps one wavelength from then on (§4.3).

**How do we store wavelength-dependent quantities?** In the form the author wrote them. Each
renderer lifts a value in its own stage, at the value's binding time:
- constants, when the shader is compiled;
- everything known only at run time, where the shader reads it. That covers driven
  parameters, per-instance colours, light-tree rows, sky images and formulas.

Shared GPU memory is therefore byte-identical whichever renderers share a scene (§6). Numbers
used only to choose samples (light power, sky importance) stay as they are: they are estimator
quantities.

**How do we define spectra for materials?** Every colour input has a *form* and a *role*:
- **Forms:** grey, RGB, blackbody, named or tabulated spectrum, dispersion formula, and GLSL
  formula in λ.
- **Roles:** reflectance, coefficient, emission and index, declared by the consumer, as
  pbrt-v4 does.

Each form has one meaning in each colour model (§5.2). RGB stays the everyday authoring form.

**Findings that constrain any implementation:**
- **The collapse is unbiased only if no earlier sampling decision singled out the hero**
  (§4.3). Derived, and measured 16% high on a toy when violated.
  - Today's media code meets the condition.
  - the proposed extension of the toy result to pbrt-v4 is unverified (§13 item 3).
- **The heterogeneous-medium clamp must act on the authored value** (§5.5). Otherwise the
  medium depends on which four wavelengths were drawn.
- **The CPU and GPU lifts must be the same function** (§5.2). pt ≡ pt-nee needs a light's
  table row and its hit-side emission to be equal.
- **A typedef plus conversion points is not enough without the carrier.** Blender Cycles has
  `Spectrum` and identity `rgb_to_spectrum(float3)` functions with no wavelength argument, and
  it is still RGB-only (§2.7).

**Decisions** (§11):
- **The structural ones:**
  - D1: the shared-memory form;
  - D2: the RGB→spectrum method;
  - D3: current wavelengths on the `Ray` (decided);
  - D7: the sensor owns the spectral response (decided);
- **The smaller ones:** film space, blackbody, formulas in λ under RGB, and the media lift.

---

## 1. The mathematics

### 1.1 The measurement with wavelength

Pixel j, output channel k ∈ {1, 2, 3}:

```
I_{j,k} = (1/C) ∫_Λ ∫ h_j · W_e · s_k(λ) · L(x, ω, λ)  dA dω dλ,      Λ = [360, 830] nm
```

- `W_e · s_k(λ)` is the sensor's response: in spectral programs the sensor supplies `s_k`.
- For the CIE observer reported in linear sRGB, `(s_1, s_2, s_3) = M · (x̄, ȳ, z̄)`, where M is
  the XYZ → linear-sRGB matrix and `C = ∫ ȳ dλ`.
- This is contracts §8's "XYZ film" with the output matrix folded into the response. The
  taxonomy puts it in the measurement (taxonomy §10: spectral→XYZ film integration is
  measurement).

The RGB renderer transports three numbers instead of a function of λ. It computes a
different functional because projection does not commute with products:

```
P(f · g) ≠ P(f) ⊙ P(g)
```

Every bounce multiplies spectra, so RGB is exact only for grey scenes and for one coloured
factor per path. This is the taxonomy's `color: 'rgb'` truncation (taxonomy §4).

### 1.2 An RGB colour is an incomplete spectrum

Let P send a spectrum to its RGB coordinates. For a reflectance ρ, "its colour" means its
colour under the white illuminant of the colour space:

```
P_ρ(ρ) = M ∫ ρ(λ) D65(λ) x̄ȳz̄(λ) dλ / ∫ D65 ȳ dλ          P_L(L) = M ∫ L(λ) x̄ȳz̄(λ) dλ / C
```

- An *upsampling* U is a right inverse of P: `P(U(c)) = c`.
- P has a huge kernel (metamers: infinitely many spectra share one RGB), so U is a modelling
  choice. Different U's give different images wherever light meets two or more coloured
  factors.
- They agree on paths with one coloured factor under white light, because of the round trip.
  The one-bounce witness (§9, W3) rests on this.
- The round trip holds only up to the method's fit. For Jakob–Hanika only greys round-trip
  exactly (§2.3). So witnesses compare against P(U(c)) computed on the CPU from the same
  table, not against c.

Two consequences carry the rest of the design.

**(a) U belongs to the scene's meaning.** An RGB-authored albedo does not define T until U is
chosen, so U completes the scene's (T, E). It is not an estimator setting: two estimators must
converge to the same image, and different U's do not. It is not a camera setting either. The
RGB renderer is then the `'rgb'` truncation of *that* spectral scene.

**(b) U applies pointwise, after the author's RGB arithmetic.** The standard U (Jakob–Hanika,
§2.3) is nonlinear: U(a + b) ≠ U(a) + U(b), and U(bilinear(c)) ≠ bilinear(U(c)). So "the
spectrum of this RGB field" needs a rule.

The rule chosen here: the author's description produces an RGB value at a point, and that
value is then upsampled. The RGB value is what the formula returns, what the bilinear sky
lookup returns, what the attribute row holds. This is pbrt-v4's texture model: it filters RGB,
then upsamples at every lookup.

Mitsuba 3 uses the other consistent model. It upsamples every texel, then interpolates the
spectra, and its code calls blending RGB first "incorrect" (§2.6). Both models define a valid
scene. They differ between texels only. Neither is a bias; they are two different skies. One
model must be chosen and stated. Choosing pbrt's model decides the shared-memory question (§6).

### 1.3 Roles

How RGB becomes a spectrum depends on what the number is. The descriptor rows already declare
`semantic: 'radiometric' | 'geometric'` (descriptors.ts:52, :158 — *read*). Spectral splits
`radiometric` into three roles and adds one:

| Role | Examples today | RGB → spectrum | Range |
|---|---|---|---|
| **reflectance** | lambert `albedo`, checker `albedo_a/b`, ggx/mirror `f0`, dielectric `transmittance` | U_b(c) for bounded inputs; proposed gain extension in implementation plan §4.2 | [0, 1] for bounded inputs; research gain may exceed one |
| **coefficient** | medium σ_a, σ_s (§5.5) | U_u(c) = 2m · U_b(c / 2m), m = max(c) (pbrt-v4's rule, §2.3) | ≥ 0, unbounded |
| **emission** | material `emission`, every light's `radiance`/`intensity`/`irradiance`, sky, medium ε | U_u(c) · D65ₙ(λ) | ≥ 0 |
| **index** | dielectric and GRIN `ior` (today `geometric`, dielectric.ts:14 — *read*), a future conductor's η, κ | not upsampled: an RGB index is meaningless | > 0 |

These are pbrt-v4's three `SpectrumType`s (Albedo, Unbounded, Illuminant), plus index (§2.7).
The repo permits nonphysical transport. For nonnegative reflectance inputs above one, the
implementation plan proposes scaling a normalized bounded lift rather than rejection or
clamping. That extension is a local modelling proposal, not attributed to pbrt, and still
requires acceptance; see [the policy and tests](claude-spectral-implementation-plan.md#42-binding-sites-and-authored-arithmetic).

**Why emission is multiplied by D65.** D65ₙ is the CIE D65 spectrum scaled to luminance 1.
Without that factor a white RGB light (1, 1, 1) would be the equal-energy spectrum, which is
pinkish in sRGB. With it, a white light is D65 and projects to exactly (1, 1, 1), because
sRGB's white is D65. RGB and spectral renders of a grey scene then agree (W1).

---

## 2. What current systems do

From a survey of the primary sources, done Sep 26 2026:
- pbrt-v4 source at commit `b4ce968`, and pbr-book 4th edition §4.5–4.6, §5.4 and §14.2;
- Mitsuba 3 source at `fd9c9ce`, and mitsuba-renderer/rgb2spec at `721145d` with its commit
  history;
- Blender Cycles' kernel sources on GitHub (main branch);
- the papers cited below, as PDFs;
- the SIGGRAPH 2021 course "Spectral imaging in production" (Weidlich et al.).

Everything below was read in those sources unless marked *recalled*. Smits 1999 and Otsu et
al. 2018 were not obtained; they are described as later papers report them.

### 2.1 The three production systems

| | pbrt-v4 | Mitsuba 3 | Manuka (Weta) |
|---|---|---|---|
| Wavelengths per path | 4 (`NSpectrumSamples`) | 4 (`Spectrum<Float,4>`) | 1 in the 2018 TOG paper; 4 per path by the 2021 course |
| Range | 360–830 nm | 360–830 nm | — |
| Sampling | `SampleVisible`: uᵢ = u + i/4 mod 1, λᵢ = F⁻¹(uᵢ) | the same function and constants | uniform, randomly offset |
| RGB → spectrum | Jakob–Hanika table; albedo / unbounded / illuminant variants | Jakob–Hanika (sRGB table only) | Smits-like until about 2021, then Peters' Fourier moments |
| RGB emission | 2·max scale × table × colour-space illuminant (D65), photometrically normalised | the same 2·max rule × D65 | D65, blackbody or measured spectrum × an upsampled RGB "gel" |
| Film | accumulates sensor RGB (XYZ by default); converts to output RGB at readout | converts each sample to sRGB with M·x̄ȳz̄ | camera spectral responsivities as well as CIE |
| Dispersion | `TerminateSecondary` when a dielectric's η is not constant | none (scalar IOR) | Cauchy at the 4 wavelengths |
| Chromatic media | hero-sampled null scattering with spectral MIS (Miller et al. 2019) | `volpath` (hero); `volpathmis` (Miller 2019) | regular tracking; "spectral tracking cannot provide pdf evaluations" |

**The visible-wavelength density** (pbrt-v4 `util/sampling.h`; Mitsuba `sample_rgb_spectrum`;
from Radziszewski et al. 2009):

```
p(λ) = 0.0039398042 / cosh²(0.0072 (λ − 538))   on [360, 830], 0 outside
F⁻¹(u) = 538 − 138.888889 · atanh(0.85691062 − 1.82750197 u)
```

- The constants were checked by integration: the normaliser is (tanh(292·0.0072) +
  tanh(178·0.0072))/0.0072 = 253.8197.
- pbr-book §5.4.2: sampling by ȳ alone gives too much colour noise, and sampling by x̄+ȳ+z̄
  oversamples 400–500 nm. This curve is the compromise, for about 1% of run time.

**How many wavelengths.**
- Radziszewski found 8 best.
- pbr-book §4.6.5 measured an efficiency optimum at 8 in a complex scene, and at 32 in a
  simple one, but keeps 4. The residual colour noise is below what displays show, and more
  pixel samples bring more wavelengths.
- Four is what every system above ships.

### 2.2 Hero wavelengths, termination and MIS

**Wilkie et al. 2014 (EGSR), "Hero wavelength spectral sampling".**
- A path is sampled for the hero λ_h, and its C − 1 rotations share it.
- Each wavelength's contribution gets the balance-heuristic weight over the C wavelengths'
  path densities (their eq. 10–11).
- "In the extreme case of dispersion via a Dirac interface, our method degenerates to using
  only the hero wavelength."

**The shift must match the denominator.**
- Wilkie shifts λ in nm. pbrt, Mitsuba and Peters shift u instead. Each member then has
  marginal density p(λ_j).
- The consistent estimator is Σ_j f(X, λ_j) / (p(λ_j) · Σ_k p(X | λ_k)): the film divides
  each slot by its own p, and the MIS denominator holds path densities only.
- The two forms agree only for a uniform p. The survey derived this, and pbrt computes it
  this way.
- §4 uses pbrt's form.

**pbrt-v4 `TerminateSecondary`** (`util/spectrum.h`).
- Sets pdf[i] = 0 for i ≥ 1 and divides pdf[0] by 4. A second call does nothing.
- The film divides by pdf with 0/0 = 0 (`SafeDiv`). So everything the secondaries gathered
  is dropped, including emission found before the event, and slot 0 is scaled by 4.
- pbr-book's justification: it is valid "only because every λᵢ has the same marginal
  distribution."
- It fires when a dielectric's material is evaluated with a non-constant η
  (`materials.h:187`). That means reflection as well as refraction, and rough interfaces as
  well as smooth ones.
- Radziszewski and pbr-book's Further Reading note that MIS alone suffices for non-Dirac
  lobes.

**pbrt-v4's volumetric path tracer and the §4.3 condition.**
- `VolPathIntegrator::Li` samples distances and events with the hero:
  - `pdf = T_maj[0] * mp.sigma_s[0]` (integrators.cpp:1026);
  - `pAbsorb = mp.sigma_a[0] / sigma_maj[0]` (:1004).
- It weights by the average of the rescaled path densities `r_u`.
- `r_u` is initialised once (:957) and never reset. Nothing in `VolPathIntegrator` checks
  `SecondaryTerminated()`.
- So a path that scatters in a chromatic medium and then meets dispersive glass combines
  hero sampling with a later collapse. This suggests a possible bias, but the toy in §4.3
  does not establish equivalence to the complete pbrt estimator.
- This is an unverified hypothesis, not a run of pbrt; see §13 item 3.

**Spectral and decomposition tracking** (Kutz, Habel, Li, Novák 2017).
- One majorant for all wavelengths.
- Collision probabilities from the history-aware *average* over wavelengths, which keeps
  avg_λ w = 1 and max w ≤ N. This is what delta_tracking.glsl transcribes.
- **Miller, Georgiev, Jarosz 2019** supply the null-scattering path densities that pbrt and
  Mitsuba's `volpathmis` use for unbiased spectral MIS in heterogeneous media. That is the
  deferred r_u/r_l batch (fable-heterogeneous-media.md §6).

### 2.3 RGB → spectrum methods

**Jakob & Hanika 2019, "A Low-Dimensional Function Space for Efficient Spectral
Upsampling".**
- **The model:** f(λ) = S(c₀λ² + c₁λ + c₂), S(x) = ½ + x / (2√(1 + x²)). Evaluation is 2
  FMAs, a sqrt and a divide.
- **The fit:** minimise the CIE76 ΔE between the target RGB and the RGB of f under the colour
  space's white (D65 for sRGB).
- **The table:** `float[3][64][64][64][3]`, one cube per largest channel = 9,437,184 bytes
  per colour space.
  - Lookup: z = max channel; x, y = the other two channels · 63/z.
  - The z nodes sit at smoothstep(smoothstep(k/63)).
  - Trilinear interpolation of (c₀, c₁, c₂).
- **Round trip.** Only greys are exact: the closed form (0, 0, (v − ½)/√(v(1 − v))) gives
  S ≡ v. Otherwise:
  - The optimiser leaves a residual. rgb2spec's Levenberg–Marquardt table has RMS ΔE 0.0027
    on sRGB (max 0.041); the Gauss–Newton optimiser pbrt-v4 still ships gave RMS 0.66
    (max 17.9) in the same repository's measurement.
  - Trilinear interpolation adds RMS ΔE 0.026 at 64³.
  - A just-noticeable difference is about 2.3.
- **Precision:** fp16 is not enough for the coefficients (Peters et al. 2019, MAM workshop).
- **pbrt-v4's three variants:**
  - `RGBAlbedoSpectrum` requires rgb ∈ [0, 1].
  - `RGBUnboundedSpectrum` uses scale = 2·max(rgb), the table at rgb/scale, times scale.
    The table's largest input is always ½, which keeps saturated colours away from the
    bounds.
  - `RGBIlluminantSpectrum` is the same, times the colour space's illuminant (D65 normalised
    to Y = 1).
- `MaxValue()` takes the maximum over the two ends of Λ and the vertex −c₁/2c₀. The sigmoid
  is monotone, so this is exact.

**Mallett & Yuksel 2019, "Spectral Primary Decomposition".**
- **The model:** U(c) = r·S_r + g·S_g + b·S_b.
- **The basis:** three fixed spectra fitted under D65 with S_r + S_g + S_b ≡ 1 and all three
  non-negative. The data is public: `geometrian/simple-spectral`, 380–780 nm at 5 nm.
  - Checked by the survey: rows sum to 1 ± 1e-5, and values lie in [0.005, 0.973].
- **Consequences** (*derived*):
  - U is linear.
  - U(c)(λ) is a convex combination of r, g, b, so min(c) ≤ U(c)(λ) ≤ max(c).
  - Filtering, sums and max-channel bounds carry over exactly.
- **Limits:**
  - sRGB only;
  - less smooth ("prone to (smoothed) staircasing", 2021 course);
  - the basis stops at 780 nm.

**Peters et al. 2019, "Using Moments to Represent Bounded Signals for Spectral Rendering".**
- Stores 3–8 trigonometric moments and reconstructs with the bounded maximum-entropy
  estimate. It matches the moments exactly and stays in [0, 1].
- Moments are linear in the spectrum, so they filter.
- Manuka switched to it: its ALU cost was "not measurable in a real render."
- Peters (2025) reports ≤ 0.3 ms overhead per 1080p frame in a real-time GPU path tracer.

**Older methods** (Smits 1999; Meng et al. 2015; Otsu et al. 2018) each fail one requirement:
- Smits: no exact round trip, sRGB only.
- Meng: unbounded reflectances, which need gamut mapping.
- Otsu: negative values and discontinuities at cluster boundaries.

**Metamerism research.** van de Ruit & Eisemann (SIGGRAPH 2023, SIGGRAPH Asia 2024) make the
point of §1.2 their subject. Any deterministic U fixes one metamer. They constrain appearance
under several illuminants and indirect light instead.

### 2.4 Film and normalisation

- **pbrt-v4's white is exact by construction** (checked from its tables).
  - An RGB (1, 1, 1) light is exactly D65ₙ.
  - The sRGB white point is computed as the XYZ of that same tabulated D65ₙ,
    W = (0.9504707, 1, 1.0888285).
  - The output is exactly (1, 1, 1).
- **Mitsuba 3 hard-codes M and its normalisation constant,** so its white comes out
  (0.99999, 0.99987, 0.99980). A unit spectrum has Y = 1.0010: its constant is 106.750, while
  its own table integrates to 106.857.
- **The lesson for us:** derive M and C from the one data set the renderer uses.
- **Where the illuminant factor sits.** pbrt normalises every light by the luminance of its
  illuminant (not of the tint). Its film then needs no 1/C. That is the same thing as §4.4's
  1/C with D65ₙ at Y = 1.
- **Blackbody.** pbrt peak-normalises Planck and then applies the photometric scale. Mitsuba
  uses absolute SI radiance.

### 2.5 Data and dispersion

**pbrt-v4's named spectra** (`GetNamedSpectrum`):
- 7 glasses as tables: BK7, BAF10, FK51A, LASF9, F5, F10, F11;
- η and k for Ag, Al, Au, Cu, CuZn, MgO, TiO₂;
- CIE A, D50, D65, F1–F12;
- 17 camera sensors;
- the 24 ColorChecker reflectances.

**Where the data comes from.** The glass data comes from refractiveindex.info (CC0).

**Formulas.**
- Neither pbrt-v4 nor Mitsuba 3 has a Cauchy or Sellmeier formula (untruncated greps of
  their sources). pbrt tabulates glasses; Mitsuba has no dispersion at all.
- SCHOTT N-BK7's Sellmeier coefficients from refractiveindex.info give n_d = 1.51680 at
  587.6 nm (the survey computed it).
- The Cauchy form from a catalogue's n_d and Abbe number V_d (as in the OpenPBR viewer):
  B = (n_d − 1) / (V_d (λ_F⁻² − λ_C⁻²)), A = n_d − B/λ_d², with λ_C, λ_d, λ_F = 656.3, 587.6,
  486.1 nm.

### 2.6 On GPUs

- **pbrt-v4's GPU build** runs the same lookup code:
  - a binary search over the 64 z nodes;
  - 8 corner gathers and trilinear interpolation;
  - then 4 sigmoid evaluations.
- **Mitsuba 3** precomputes per-texel coefficients for bitmaps and environment maps (4 floats
  per texel: c₀, c₁, c₂, scale) and blends evaluated spectra. That is option B of §6, with its
  texture model.
- **The z index needs no search.** smoothstep has a closed-form inverse,
  g(y) = ½ − sin(asin(1 − 2y)/3), applied twice. The survey checked this to 5e-16.
- **Open WebGL spectral tracers** (snelly, the OpenPBR viewer) use one wavelength per path and
  approximate or hand-tuned normalisation. Neither is a model to follow.


### 2.7 How renderers structure the colour model

Read in the sources on Sep 26 2026 (Mitsuba 3 `fd9c9ce`, pbrt-v4 `b4ce968`, Blender `main`).

**Mitsuba 3: the colour model is a compile-time variant.**
- **Types.** `Spectrum` is `Color<Float, 1>` (mono), `Color<Float, 3>` (RGB) or
  `Spectrum<Float, 4>` (spectral).
- **The carrier exists in every variant.** `Wavelength` is `Color<Float, 0>`, a zero-length
  array, in the mono and RGB variants (include/mitsuba/core/traits.h:20, :31), and
  `Spectrum<Float, 4>` in spectral (:42). Code that passes wavelengths compiles in every
  variant and costs nothing in RGB.
- **Where the wavelengths live.**
  - Every `Ray` carries `wavelengths` (core/ray.h:94).
  - So does every interaction record, surface and medium alike (render/interaction.h:200).
  - Rays spawned from a record copy them (:250, :266, :286).
  - Textures and BSDFs read them from the record: `eval(const SurfaceInteraction3f &si, …)`
    (render/texture.h:40).
  - The camera samples them (`Sensor::sample_wavelengths`, render/sensor.cpp:74).
- **Conversion happens once, at load.** `Properties::get_texture_impl` (src/core/
  properties.cpp:592) turns an authored value into a texture according to the variant and to
  flags set by the plugin that reads it (`emitter`, `unbounded`):
  - An RGB emitter colour becomes the `d65` texture in spectral variants and `srgb` in RGB.
  - A measured spectrum is pre-integrated against the CIE curves in RGB variants, "so that
    RGB variants of Mitsuba match the behavior of spectral variants."
  - So the consumer declares the role, and every form has one meaning per variant.
- **Branching is concentrated.** `is_spectral_v`, `is_rgb_v` and `is_monochromatic_v` occur
  118 times in 36 files (untruncated grep). The occurrences sit in:
  - the spectrum plugins (`src/spectra`, 7 files);
  - render core, textures, film and sensor;
  - three BSDFs (the two measured BSDFs and hair).

  The ordinary BSDFs (diffuse, conductor, dielectric) never branch.

**pbrt-v4: always spectral, explicit wavelengths.**
- **RGB transport is gone.** The Preface: "We have excised all use of RGB color for lighting
  calculations."
- **The `Ray` carries no wavelengths:** origin, direction, time and medium only
  (src/pbrt/ray.h:35-38).
- **`SampledWavelengths` is an explicit argument of every resolver:** film, camera, light,
  material, medium and texture interfaces (src/pbrt/base/*.h).
  - Materials take it by mutable reference, so building a dispersive BSDF can terminate the
    secondaries (`GetBSDF`, base/material.h:54).
  - BSDFs themselves never see λ. They are built for one wavelength set.
- **The values do not store their wavelengths.** pbr-book §4.5: "A separate class,
  SampledWavelengths, stores the wavelengths for which a SampledSpectrum stores samples", and
  one must "not perform any operations that combine SampledSpectrums that have samples at
  different wavelengths."
- **The consumer declares the role.** `enum class SpectrumType { Illuminant, Albedo,
  Unbounded }` (paramdict.h:70) is chosen by the code that reads each parameter. Media ask for
  `sigma_a` and `sigma_s` as `Unbounded`, each on its own, and for `Le` as `Illuminant`
  (media.cpp:177-189). Lights ask for `Illuminant` (lights.cpp:197).

**Blender Cycles: a typedef without a carrier.**
- **What it has.** The kernel declares `using Spectrum = float3;` and
  `#define SPECTRUM_CHANNELS 3`, with `FOREACH_SPECTRUM_CHANNEL` and `GET_SPECTRUM_CHANNEL`
  (intern/cycles/util/types_spectrum.h). Its conversion points are identities with no
  wavelength argument: `Spectrum rgb_to_spectrum(const float3 rgb) { return rgb; }` and
  `spectrum_to_rgb` (kernel/util/colorspace.h).
- **What it lacks.** A spectral mode would have to add the wavelengths to every conversion
  call. The public "Thoughts on making Cycles into a spectral renderer" thread on
  devtalk.blender.org runs to many pages, and Cycles is still RGB-only.
- **The design of this repo today is the same.** It has a typedef (structs.glsl:6-7) and a
  single constant formatter (glsl-format.ts:29-31), but no carrier and no run-time conversion
  point.

**What the three agree on.**
- The carrier is explicit and exists wherever a scene quantity is evaluated.
- The consumer, not the author, declares what kind of quantity an RGB value is.
- Each authored form gets one meaning per colour model.
- Only the conversion code and the film know which model is running.

---

## 3. The colour-model system

This section replaces the RGB-era design, `#define Spectrum vec3` in the core spine, with a
structure the compiler can select per program.

### 3.1 What a colour model is

The measurement integrates over λ (§1.1). A colour model is the program's way of handling
that dimension. It fixes four things:

| | RGB | Spectral |
|---|---|---|
| **Representation:** what a `Spectrum`'s numbers are | coordinates in the sRGB basis (3) | values at the path's wavelengths (4) |
| **Carrier:** what a path must carry for those numbers to mean anything | nothing (the basis is fixed) | the four wavelengths and their pdfs |
| **Lift:** authored value → `Spectrum` | identity on RGB; P for spectral forms | U on RGB; evaluation at λ for spectral forms |
| **Projection:** (`Spectrum`, carrier) → pixel colour | identity | the film estimator (§4.4) |

**The rule: only the colour model interprets a `Spectrum`'s components.**
- Everything between the lift and the projection is component-wise arithmetic, identical in
  both models: + − × ÷, exp, component-wise max.
- It may also use reductions that do not care which component is which:
  - the average;
  - the maximum;
  - "is it black";
  - picking a component uniformly at random.
- These symmetric reductions are exactly what the collapse's condition allows (§4.3). One rule
  therefore gives both model independence and an unbiased collapse.

### 3.2 The kinds of number

| Kind | What it is | RGB program | Spectral program | Where it lives |
|---|---|---|---|---|
| `Spectrum` (alias `Radiance`) | a radiometric quantity at the path's carrier | `vec3` | `vec4` | throughput, radiance, BSDF and phase values, σ, resolved properties |
| `Wavelengths` | the carrier | a placeholder struct with one unused field (GLSL has no empty struct) | `{ vec4 lambda; }` | `Ray`, `Hit`, resolved records and resolver arguments |
| `WavelengthSample` | original camera carrier and its sampling PDFs | placeholder state, no random draw | original `Wavelengths` plus `vec4 pdf` | estimator, retained for film projection |
| pixel colour | linear sRGB at the film | `vec3` | `vec3` | accumulators, display, exports |
| authored colour | what the author wrote | not a GLSL type, except the `vec3` read at a run-time site, lifted in the same expression | same | the scene plan (TypeScript) |
| index | n at the path's leading wavelength | `float` (n_d) | `float` (n(λ₀)) | `ior_of`, `ior_at` |

**Why these separations matter.**
- **A `Spectrum` means nothing without its carrier** (pbrt's rule, §2.7). With one carrier per
  path, two spectra from different carriers can never meet.
- **Pixel colour is not a `Spectrum`.** Today the accumulators write
  `vec3 color = sensor_response(...) * transport_trace(ray)` (average.glsl:15 — *read*).
  That is a `Spectrum` used as a pixel, which only works because both are `vec3` in RGB.
- **The display program never had a `Spectrum`.** It does not include structs.glsl
  (ShaderBuilder.ts:71-102, per the compiler survey) and is unaffected.

### 3.3 The family

`components/color/` is a pick-one family in the measurement section. The existing strategy
field `measurement.color` selects it; today that field is reserved end to end but read by no
generator.

```
components/color/
  README.md          the contract below
  index.ts           registry: rgb, spectral
  cie.ts             CIE 1931 matching functions, D65ₙ, and the sRGB matrix derived from
                     them (§4.4); shared by both occupants
  forms.ts           authored colour forms: grey, RGB, blackbody (moves from
                     lights/blackbody.ts), named and tabulated spectra, formulas; each
                     form's projection P and its GLSL spectral evaluation
  rgb/       rgb.ts  rgb.glsl  rgb.md
  spectral/  spectral.ts  spectral.glsl  spectral_lift.glsl  spectral.md  (+ TS twins, tests)
```

- `cie.ts` and `forms.ts` follow the family-root shared-part precedent (`lights/power.ts`,
  `lights/blackbody.ts`).
- The family gets the one-folder rule and README checks (tests/components/structure.test.ts).

**What an occupant supplies: GLSL, in two parts.** The first part must come before
structs.glsl, which uses `Spectrum`.

```glsl
// types part
#define Spectrum vec3                        // spectral: vec4
#define Radiance Spectrum
#define SPECTRUM_N 3                         // spectral: 4
struct Wavelengths { float unused; };        // spectral: { vec4 lambda; }
struct WavelengthSample { Wavelengths wl; float pdf; }; // RGB placeholder; spectral: vec4 pdf

// functions part
WavelengthSample wavelengths_sample(); // RGB: initialised placeholder, no draw
vec3 color_to_pixel(vec2 film, Direction ray_dir, Radiance L, WavelengthSample sample);
// RGB applies sensor_response(film, ray_dir) * L; spectral integrates the sensor response (§4.4).
```

`spectral` also supplies:
- its helpers: sigmoid evaluation, D65ₙ, Planck, and the collapse factor;
- in a separate file, included only when some colour is lifted at run time, the table
  lookup:

  ```glsl
  Spectrum color_lift_reflectance(vec3 rgb, Wavelengths wl);
  Spectrum color_lift_coefficient(vec3 rgb, Wavelengths wl);
  Spectrum color_lift_emission(vec3 rgb, Wavelengths wl);
  ```

**What an occupant supplies: the TypeScript descriptor.** These are facts about one model,
which the generators ask for:

```ts
interface ColorModelDescriptor {
    id: string;
    channels: number;                                   // SPECTRUM_N
    types: string;                                      // GLSL, before structs.glsl
    glsl: string;                                       // GLSL, after math.glsl
    runtimeLift?: { glsl: string; textures: PlannedTexture[] };
    /** GLSL for a value known at compile time. */
    liftConstant(c: AuthoredColour, role: Role): string;
    /** GLSL wrapping an RGB expression known only at run time (uniform, data row, texel,
     *  formula). RGB: the expression unchanged. */
    liftRuntime(rgbExpr: string, role: Role): string;
    /** sup over the carrier of the lifted value — the majorant (§5.5). RGB: max channel. */
    bound(c: AuthoredColour, role: Role): number;
    /** The same bound for run-time values, as a factor on their RGB maximum. RGB: 1. */
    runtimeBoundFactor: number;
}
```

Nothing here is composition. Each entry says how *this model* represents a value, and the
generators still decide where values go. The anatomy doc anticipated exactly this: pick-one
descriptors "stay thin until a fact needs declaring (H³ will declare `Point = vec4`)"
(fable-module-anatomy.md §5).

### 3.4 Wavelengths belong on the ray (D3 — decided)

**The mathematical meaning.** A ray is a seed for light propagation: `(x, ω, λ)`.
Its geometric projection `(x, ω)` is a point of the unit tangent bundle. Four wavelengths
may share that projection, giving a packet in UTM × Λ⁴ until a chromatic event requires
collapse or splitting. Search bounds remain properties of intersection queries.

**Ownership.**
- `Ray.wl` contains the current local wavelengths, without sampling PDFs.
- `Hit.wl` records the arriving wavelengths. With the wavelength-preserving propagation in
  this implementation, intersection copies them from the ray.
- Resolved `MaterialProperties` and `MediumProperties` carry the wavelengths used to evaluate
  their values. Generated scene lookups take the carrier explicitly.
- The estimator retains a `WavelengthSample`: the original camera wavelengths and their
  sampling PDFs. Film projection uses this original sample, never the final ray's carrier.
- `PathState` retains throughput and accumulated radiance. These are estimator quantities;
  adding wavelengths to `Ray` does not move them onto it.

**Construction and propagation.**
- Transport ray construction must explicitly receive or inherit wavelengths. A silently
  usable default carrier is not the contract. The exact constructor signatures, including
  camera construction and geometry-only local rays, must be specified in S0.
- For wavelength-preserving interactions, `ray_spawn` inherits the arrival carrier.
- The revised implementation plan passes the already-sampled carrier into
  `camera_generateRay(film, xiLens, wl)`, so camera optics may read it before constructing a
  fully initialized ray. Sampling remains in the accumulator. RGB uses an initialized
  placeholder and consumes no extra random draws. This is an explicit proposed amendment
  to the current camera contract, not an implemented signature.
- Surface and medium continuation, GRIN handoff, shadow connections, null crossings and
  transformed intersection rays all need explicit coverage of carrier preservation.
- Functions already receiving a ray can read its carrier. The existing survey found four
  transport `make_ray` sites and four `ray_spawn` sites, plus primary-camera construction.
  Site counts describe the current code, not a complete implementation specification.

**Future wavelength changes.** These are not built in S0–S2.
- Redshift produces arrival wavelengths together with the propagated geometric state;
  copying departure wavelengths would then be incorrect. Local frequency requires a defined
  observer frame, and the radiometric weight changes too. This does not require mutating the
  input seed of an intersection query.
- Fluorescence samples a continuation wavelength as well as direction and weight. Its
  scattering result must be able to supply a new carrier; unconditional copying from the
  hit is only the wavelength-preserving case. Camera tracing uses the adjoint process.
- Each spectral lane remains associated with its original camera sample for film scoring,
  even if its current wavelength changes. Contributions already accumulated are not relabelled.

**Contracts.** The code comment on `Ray` already anticipates carried wavelength and time.
The trace-loop contract currently specifies origin and direction only; its approved spectral
extension is recorded there, while the current implementation remains unchanged. The new
physical coordinate does not put query bounds, sampling PDFs or accumulated colour on the ray.

**Alternative considered.** Keeping wavelengths on `PathState` with explicit arguments to
tracking and shadow functions is mathematically valid. The ray representation is chosen to
keep each branch's geometric and spectral propagation coordinates together. No performance
advantage is established; removal of unused fields by the GLSL compiler must be measured.

Per-invocation globals and spectral-only function arguments remain excluded: the carrier is
explicit in every colour model, with a placeholder in RGB.

### 3.5 Lifting authored values

**Roles are declared by the consumer.**
- Descriptor rows gain `role`: reflectance, coefficient, emission or index (§1.3).
- Fixed fields get theirs in the generator that owns them:
  - medium σ_a and σ_s: coefficient;
  - ε, the sky, and light rows: emission.
- This is pbrt-v4's `SpectrumType` and Mitsuba's `emitter`/`unbounded` flags (§2.7).

**Where the lift happens: at the value's binding time, in the renderer's own stage.**

| Value | Known at | Lifted by | RGB | Spectral |
|---|---|---|---|---|
| constant | compile | the compiler: `liftConstant` | literal, as today | coefficients, grey, or the form's code |
| driven `{param}` | frame | the model's GLSL where read (`liftRuntime` over the uniform) | `vec3` uniform | the same `vec3` uniform, lifted in GLSL |
| driven blackbody | frame | RGB: a per-program compute closure, since the projection is an integral (as today, values.ts:125-166). Spectral: GLSL | `vec3` from the closure | kelvin uniform + Planck |
| shared data row, attribute | pack (shared) | the model's GLSL at the read | `.xyz` | lift of `.xyz` |
| sky texel | load (shared) | the model's GLSL after the bilinear fetch | `.rgb` | lift of `.rgb` |
| RGB formula | per point | the model's GLSL | as written | lift of the formula |
| formula in λ | per point | the model's GLSL | quadrature projection (D6) | the formula on `vec4 lambda` |

**One entry point in the compiler.**
- `emitValue` is already the one value split point (values.ts:47-68, enforced by
  tests/compiler/valuesSplitPoint.test.ts). It takes the row's role and asks the model.
- The four run-time read sites wrap their read in `liftRuntime`:
  - the attribute fetch (values.ts:75-79);
  - the instanced-light emission fetch (lighting.ts:731), which reads the same texel as the
    hit side and so must lift it the same way. Its constant branch (:730) calls
    `formatSpectrum` directly today and moves to `liftConstant`;
  - the light-table row loaders (lighting.ts:749-778);
  - the sky bodies (environment.ts:158, :211).
- For RGB the wrap is the identity on text, so generated RGB code at those sites is unchanged.
- Every current caller of `formatSpectrum` becomes a caller of `liftConstant`. The survey
  lists ten, in materials, media, lights, the delta query and the constant sky. The grey
  defaults `SPECTRUM_ZERO`, `SPECTRUM_ONE` and `Spectrum(x)` (schema.ts:45-52) are exact in
  every model for the roles they serve and stay as they are. A grey emission would need the
  D65ₙ factor, but the only emission default is zero.

**This is scene-once step 4's "one function converts an authored colour for a colour model":
it is the model's lift.** The scene plan and the packer keep authored values (§6).

### 3.6 From `Spectrum` to pixel

**The accumulators** (average, variance, oneshot) become:

```glsl
WavelengthSample cameraSample = wavelengths_sample(); // after film/lens draws
Ray ray = camera_generateRay(film, xiLens, cameraSample.wl);
vec3 color = color_to_pixel(film, ray.direction, transport_trace(ray), cameraSample);
```

**The sensor owns the response (D7, decided by the owner).**
- The sensor family is the measurement's response, which is what a sensor is. The code
  already planned this: `core.ts:82-83` includes `ideal` only because it is the sole
  occupant, and says the selection knob "arrives with the first real sensor
  (exposure/vignette/spectral)". `sensor/README.md:28-29` says a second occupant adds
  `measurement.sensor`.
- **RGB programs** include `ideal`: `color_to_pixel` returns
  `sensor_response(film, dir) * L`, exactly today's arithmetic.
- **Spectral programs** include a spectral sensor, `cie1931` (x̄ȳz̄ mapped to linear sRGB by M,
  §4.4), and later measured camera curves (pbrt-v4 ships 17, §2.5). The spectral model's
  `color_to_pixel` only estimates the wavelength integral:
  `(1/4) Σ_i sensor_response(λ_i, film, dir) · L_i / p(λ_i)`.
- **The cost:** each sensor declares the color models it supports, and the Validator rejects a
  mismatch. The compiler already includes only what a program uses, so no sensor has to serve
  both models.

### 3.7 CPU-side facts

**Model facts**, on the descriptor: `liftConstant`, `bound` and `runtimeBoundFactor`.

**Model-free facts about authored values** live in `color/forms.ts`: the RGB projection P,
"is it grey", "is it zero".

**Estimator heuristics use P for every model:**
- light power (power.ts:9-11, the mean of RGB);
- sky importance (importance.ts:48, luminance);
- the sky's selection probability.

That is valid because a heuristic only has to be positive wherever the emission is:
- For any non-zero spectrum on Λ, XYZ ≥ 0 and not all zero.
- The mean of its sRGB projection is (2.3268 X + 0.1348 Y + 0.6002 Z)/3 > 0, since those are
  the column sums of the XYZ→sRGB matrix (*measured* from the matrix in blackbody.ts).

**The predicates the scene-once plan listed read authored values through forms.ts:** the
Planner's `emitters.driven`, "is this emission non-zero", instanced light emission, and the
packer.

### 3.8 What stays model-free

These use only component-wise arithmetic and symmetric reductions (§3.1), so they do not
change:
- every material, light and phase occupant;
- the transport techniques, the combiner and MIS weights, Russian roulette;
- the light tree and light selection, and the sky's importance tables;
- equiangular sampling;
- the analytic, delta-tracking and GRIN arms, once their channel pick uses `SPECTRUM_N`.

The helpers stay in math.glsl, written once for any N:

```glsl
float spectrum_average(Spectrum s) { float a = s[0]; for (int i = 1; i < SPECTRUM_N; i++) a += s[i]; return a * (1.0 / float(SPECTRUM_N)); }   // today's order: ((x+y)+z)·⅓ (§13 item 5)
float spectrum_max(Spectrum s)     { float m = s[0]; for (int i = 1; i < SPECTRUM_N; i++) m = max(m, s[i]); return m; }
bool  spectrum_is_black(Spectrum s){ return all(lessThanEqual(s, Spectrum(0.0))); }
int   spectrum_pick(float u)       { return min(int(u * float(SPECTRUM_N)), SPECTRUM_N - 1); }
```

Today's bodies use `.x/.y/.z` and `/3` (math.glsl:66-68 — *read*). They compile under `vec4`
and silently ignore the fourth component. The channel picks hard-code 3 (analytic.glsl:12,
grin.glsl:308 — *read*).

### 3.9 How the compiler uses it

1. **Validation.** `strategy.measurement.color` is gated against the registry, replacing
   today's rejection of `'spectral'` (Validator.ts:864-868).
2. **Planning.** `resolveMeasurement` records the model id, where today it hard-codes `'rgb'`
   (measurement.ts:28). The Planner decides two things:
   - whether any colour is lifted at run time, which includes the lift file and its table
     (exact linkage);
   - whether any region's index depends on λ, which emits the collapse.
3. **Core assembly** (core.ts):
   - the model's types part first;
   - then structs.glsl, without its `Spectrum`/`Radiance` defines;
   - the rest as today;
   - the model's functions part after math.glsl.
4. **Features** call `emitValue(value, role)` and `liftRuntime`.
5. **Transport** stores the current carrier on `Ray`; the camera sample stays with the estimator (D3).
6. **The accumulators** call `color_to_pixel`.

**The scene plan is untouched:** it stays strategy-free, with colours as authored.

**One mechanism for two families.** An H³ ambient occupant needs the same "types part before
structs.glsl" for `Point = vec4` (ambient/README.md). It is built once here and reused there;
nothing for ambient is built now.

### 3.10 Enforcement

- **Compile every suite scene under every registered model** (glslang). This is contracts
  §11.5, which calls the `Spectrum` discipline "convention-only" until it exists.
- **Add a test-only canary model with N = 2** (`Spectrum = vec2`, explicit test lift and
  pixel projection). Three-component access (`.z`) fails compilation here. A divide by 3 or
  a three-channel random pick requires numeric checks; compilation alone cannot catch it. Such code exists today (§3.8). A stray `vec3(...)` radiometric literal is caught
  by the spectral compile itself.
- **Check that no generator branches on a model's name.** A test forbids `'rgb'`/`'spectral'`
  literals in src/compiler/generate/, which is the anatomy doc's "`if (model === …)` is the
  smell" rule (fable-module-anatomy.md §4).

---

## 4. Wavelengths

### 4.1 Range and count

- **Range:** Λ = [360, 830] nm, the support of the CIE 1931 tables. For the CIE observer
  this loses nothing, since the matching functions vanish outside it.
- **Count:** four wavelengths per path. `vec4` is native in GLSL, and four is what pbrt-v4,
  Mitsuba 3 and Manuka ship. pbr-book measured 8 as more efficient in a complex scene (§2.1);
  eight would be two `vec4`s, and nothing below depends on the number.
- **Cost:** the arithmetic on spectra grows by 4/3 over RGB (*prediction*: small next to
  traversal).

### 4.2 Sampling (estimator)

One uniform number u per camera sample. It is drawn in the accumulator's `main()` after the
pixel and lens draws (average.glsl:12-13 — *read*), and only by spectral renderers, so RGB
random streams are unchanged. From it:

```
λ_i = F⁻¹((u + i/4) mod 1),   i = 0..3,      pdf_i = p(λ_i)
```

F is the CDF of p. Two choices of p:
- **uniform** on Λ;
- **visible**: pbrt-v4's density concentrated where the eye is sensitive (formula in §2).

Which p is used is an estimator field (`estimator.wavelengths`). Both must converge to the
same image, and that equality is a witness (W4).

- The shift is in u, as in pbrt and Mitsuba, so each λ_i is marginally p-distributed.
- The film therefore divides each slot by its own p(λ_i).
- Every MIS denominator over wavelengths holds path densities only. That is the consistent
  form for a non-uniform p (§2.2); Wilkie's nm-shift form would be biased here.
- Given the set {λ_i}, the hero is equally likely to be any member of it. §4.3 needs that
  fact.

### 4.3 Chromatic events: the collapse

**When it applies.** Sometimes the outcome of a sampling decision depends on λ: the direction
refracted by a dispersive surface, or the path bent by a GRIN medium whose n depends on λ.
The four wavelengths can then no longer share one path. The standard response is to keep one
of them (pbrt-v4's `TerminateSecondary`, §2).

**The rule proposed here.** At the first such event, multiply the throughput by (4, 0, 0, 0),
mark the estimator as collapsed, and leave `Wavelengths` untouched. Later such events do not
apply this factor again (§13 item 1):

- Slot 0 continues, carrying the whole estimate.
- The film's average over four slots, each divided by its own pdf, then reduces to
  f(λ₀)/p(λ₀), which is unbiased because λ₀ ~ p.
- Emission gathered *before* the event stays in all four slots. That is correct: the path up
  to the event did not depend on λ.

**How this differs from pbrt-v4.** pbrt instead zeroes the secondaries' pdfs and divides
pdf[0] by 4. Its film then drops everything the secondaries gathered, including emission found
before the event (§2.2). Both are unbiased under the condition below. Keeping the pre-event
emission should lower variance (*prediction*).

**The condition this needs.** Collapsing to slot 0 is unbiased only if no earlier decision
singled out slot 0.

*Derived.* Take a chromatic free-flight sample before the event. Channel c is chosen, a
distance t is drawn from p_c(t), and slot i gets weight f(λ_i, t)/q(t), where
q = (1/4) Σ_j p_j (the one-sample balance heuristic; analytic.glsl:12-35 — *read*). After a
collapse the estimate is

```
E = f(λ₀, t) g(λ₀) / (q(t) p(λ₀)).
```

- **c drawn uniformly and independently of the slots** (what the code does today):
  `E[E | λ₀] = Σ_c ¼ ∫ p_c f g / (q p) dt = ∫ f(λ₀,t) g(λ₀) dt / p(λ₀)`. This is unbiased.
- **c = 0 always** (sampling with the hero, a common simplification):
  `E[E | λ₀] = ∫ f g · p₀(t)/q(t) dt / p(λ₀)`. The factor p₀/q ≠ 1 for a chromatic medium, so
  this is biased.
- **Without a collapse, both are unbiased.** Averaging over which member of the set is the
  hero turns p₀/q back into q/q. The bias comes only from combining the two.

*Measured* with a toy Monte Carlo check: σ(λ) = 1 + 4λ on normalised λ ∈ [0, 1), a
post-event factor g(λ) = λ², truth 0.26467, 4·10⁶ samples, two independent runs.

| Variant | Run 1 | Run 2 |
|---|---|---|
| uniform channel, no collapse | 0.26459 ± 0.00007 | 0.26474 ± 0.00007 |
| hero channel, no collapse | 0.26472 ± 0.00007 | 0.26484 ± 0.00007 |
| uniform channel, collapse | 0.26490 ± 0.00015 | 0.26474 ± 0.00015 |
| **hero channel, collapse** | **0.30622 ± 0.00017** | **0.30638 ± 0.00017** |

The hero-and-collapse variant is 16% high, about 250 standard errors, in both runs. The
script becomes the vitest twin of §9.

**Invariant, to be pinned.** Before the first collapse, no sampling decision may single out
a wavelength slot. The collapse selects slot 0; subsequent chromatic decisions may use it. Today's code satisfies it (*read*):
- the analytic and GRIN arms choose their channel with their own uniform draw
  (analytic.glsl:12, grin.glsl:308);
- delta tracking's probabilities are averages over channels (delta_tracking.glsl:87-89);
- Russian roulette uses a max over channels (pt.ts:194-203);
- light selection and every non-dispersive BSDF pdf do not depend on λ.

A Monte Carlo twin of the derivation, in which the c = 0 variant must fail, goes in the tests
(§9).

**Two things follow.**
- The condition needs no pdf evaluations, only symmetry across slots. So the Kutz tracker
  qualifies, even though Manuka calls spectral tracking incompatible with hero-wavelength MIS
  for exactly that reason (§2.1). The deferred spectral-MIS batch for media would change
  that, and must keep the condition.
- pbrt-v4's volumetric path tracer samples media with the hero and also terminates at
  dispersive glass. Whether its complete estimator has the toy's bias remains unverified
  (§2.2, §13 item 3). Our invariant avoids the demonstrated failure for our own estimator.

**Where it fires:**
- at a surface hit whose material consumes region index and at least one adjacent region's
  index depends on λ, before scattering evaluation/NEE and sampling. Index-independent mirror
  or Lambert boundaries do not collapse merely because they border a dispersive region. pbrt-v4
  does the same, for reflection as well as refraction (§2.2);
- in a GRIN region whose n depends on λ, before the first wavelength-dependent advance —
  including a camera that starts inside the region, which never crosses an entry surface
  (implementation plan §6.2).

After the collapse, η, F, the η² factor and `eta_scale` use λ₀.

**A later refinement** (*derived*, not needed for S2):
- Only the refracted *direction* depends on λ.
- Choose the reflect/refract branch with the slot-average ⟨F⟩, which is symmetric across
  slots. Weight slot i by F_i/⟨F⟩ on reflection, keeping all four, and by (1 − F_i)/(1 − ⟨F⟩)
  on refraction, which then collapses.
- Reflections off dispersive glass would then keep four wavelengths. The literature notes
  that MIS makes termination unnecessary for non-Dirac lobes (§2.2).

**Where it does not fire:** chromatic media. σ(λ) changes weights, not the path, and the
existing channel MIS handles any number of channels once "3" becomes `SPECTRUM_N`.

### 4.4 The film

The spectral model's `color_to_pixel` (§3.6), per camera sample:

```
rgb = M · (1/4) Σ_i x̄ȳz̄(λ_i) · L_i / p(λ_i) / C
```

Zero entries (collapsed slots) contribute nothing. `x̄ȳz̄` and M belong to the `cie1931`
sensor; the spectral model supplies the average and the division by p (§3.6).

- **M and C are derived, not copied.**
  - M comes from the sRGB primaries and the XYZ of the tabulated D65ₙ that the renderer
    actually uses, so that XYZ(D65ₙ) maps to exactly (1, 1, 1).
  - C = ∫ȳ comes from the same table.
  - pbrt-v4 builds its colour spaces this way and its white is exact.
  - Mitsuba 3 hard-codes both, and its white comes out (0.99999, 0.99987, 0.99980) (§2.4).
    W1 would see that.
- **Everything downstream is unchanged.** This `vec3` is accumulated as today, so the average,
  variance and oneshot accumulators, the tonemaps and the exports see linear sRGB from both
  colour models.

**Negative values.** A spectrum outside the sRGB gamut, such as a dispersion rainbow or a
narrow-band emitter, has negative linear-sRGB components. That is correct.
- The float accumulation buffer keeps them.
- The display clamps them.
- The RGBE export clamps them to zero, and its comment calls a negative channel "a transport
  bug" (file-export.ts:67-71 — *read*). That stops being true in spectral programs.
- D4 below: keep sRGB and declare the clamp (recommended for now), or accumulate XYZ and
  export Radiance's XYZE format.
- Witnesses read the float buffer and are unaffected.

---

## 5. Defining spectra

### 5.1 Authoring forms

Today's colour inputs are `number | Vec3 | {param} | {blackbody} | GlslExpression`
(`SpectrumProperty`, types.ts:300 — *read*). Proposed additions (sketch, not final syntax):

```ts
type SpectrumSpec =
    | number | Vec3 | ValueParam<number | Vec3> | BlackbodyValue | GlslExpression   // today
    | { spectrum: string }                                   // named: 'cie-d65', 'cie-a', 'bk7', …
    | { samples: { lambda: number[]; values: number[] } }    // tabulated, nm, piecewise linear
    | { cauchy: [number, number, number?] }                  // index: n = A + B/λ² + C/λ⁴
    | { sellmeier: { B: number[]; C: number[] } }            // index: n² = 1 + Σ Bᵢλ²/(λ² − Cᵢ)
    | { abbe: { nd: number; vd: number } }                   // index: catalogue n_d and Abbe V_d
    | { glsl: string; lambda: true };                        // a formula in λ (and p, uv, …)
```

Examples:

```ts
glass:  { model: 'dielectric', ior: { abbe: { nd: 1.5168, vd: 64.17 } } }         // BK7
prism:  { model: 'dielectric', ior: { spectrum: 'sf11' } }
lamp:   { model: 'lambert', albedo: 0, emission: { spectrum: 'cie-f11', scale: 3 } }
sky:    { medium: { sigma_s: { glsl: '2.0e9 / pow(lambda, 4.0)', lambda: true }, … } }  // Rayleigh
```

**Rules:**
- **Roles gate forms.** An index row takes numbers and index forms, never RGB. A reflectance
  row takes RGB, grey, tabulated and λ-formulas. The Validator enforces this from the row's
  role. Blackbody is now restricted to emission rows; reflectance, index and medium fields
  reject it. The named/tabulated/index forms below remain proposals.
- **The colour space of authored RGB is pinned: linear sRGB (Rec.709 primaries, D65).** No
  document or type states it today; it is only implied by the Rec.709 luminance in
  importance.ts:48 and the display's sRGB transfer (*read*). Spectral needs it stated, because
  U is defined relative to it.
- **A small named library** lives with the data it came from:
  - CIE illuminants A, D50, D65, F2, F11;
  - glasses as Sellmeier coefficients (BK7, fused silica, SF11);
  - metal η/κ (Au, Ag, Cu, Al) for the future conductor (claude-improvements-2026-09.md §2.5);
  - the 24 ColorChecker reflectances, which are useful for validation.

  Each entry records its source.

### 5.2 One meaning per form, per colour model

| Form | RGB renderer | Spectral renderer |
|---|---|---|
| grey g | `vec3(g)` | `Spectrum(g)` — exact, no conversion; emission: g·D65ₙ(λ) |
| RGB constant | literal | coefficients looked up on the CPU through the same table as the GPU, emitted as a literal: `spectrum_sigmoid(c, scale, wl)` (× D65ₙ for emission) |
| RGB `{param}` | vec3 uniform | the same vec3 uniform, converted in GLSL (one run-time path for every run-time colour) |
| RGB from data (instance attributes, light-table rows) | `.xyz` read | `.xyz` read, then `spectrum_from_rgb(rgb, role, wl)` |
| RGB image (sky) | bilinear `.rgb` | bilinear `.rgb`, then conversion |
| RGB formula (GLSL) | as written | as written, then conversion |
| blackbody (T, scale) | P of the Planck spectrum, on the CPU | Planck B(λ, T) in GLSL, same normalisation (§5.4) |
| named / tabulated | P of the spectrum, on the CPU, as a literal | the table in the shader, evaluated at λ |
| index formula (Cauchy, Sellmeier, Abbe) | n at 587.56 nm (the catalogue n_d) | the formula at λ; triggers the collapse (§4.3) |
| formula in λ | projection by a fixed quadrature, declared as part of the `'rgb'` truncation — or rejected (D6) | the formula, evaluated once on the `vec4` of wavelengths |

Two properties follow from the table:

- **The CPU and GPU conversions must be one function.** Light rows and hit-side emission must
  be equal for pt ≡ pt-nee (values.ts:4-5 — *read*). In tree mode a light's row is converted
  on the GPU, while the same light's constant material emission is converted on the CPU.
  Both must therefore compute the *same* U: one table, one interpolation rule, a TypeScript
  twin of the GLSL lookup, and a test that they agree. In particular, a per-colour CPU
  optimisation that bypasses the table is not allowed.
- **Evaluating a formula in λ is free vectorisation.** A formula written with component-wise
  operations (`1.5 + 0.004/(lambda*lambda)`) evaluates on `vec4 lambda` to a `vec4`. The rule
  for authors is "component-wise only", which the Validator can check once expressions are
  parsed (fable-expression-machinery.md).

### 5.3 Where the numbers live

| Data | Kind | Who reads it |
|---|---|---|
| authored constants | GLSL literals (coefficients, grey values, formula code) | the program that emitted them |
| driven colours | uniforms (RGB) | per renderer; spectral converts in GLSL |
| run-time colours in shared memory | unchanged RGB (§6) | every renderer; spectral converts on read |
| tabulated spectra of the scene | `const float[]` arrays in the spectral shader (resampled at 5 nm → 95 values; *prediction*: enough for smooth data, not for line spectra like F11, which want 1 nm) | the spectral program only — nothing shared |
| the upsampling table | one static texture (§7) | spectral programs |
| x̄, ȳ, z̄ and D65ₙ | one small static texture (1 nm × 4 channels) | spectral programs |

A shared "spectra table" in the data rail becomes necessary only when spectra vary per
instance or per texel. Nothing does that yet, and the rule is never to build data nothing
reads (claude-data-exact-linkage.md).

### 5.4 Blackbody — built

Both renderers use one Planck emission definition:

```
emission(λ) = scale · B(λ, T) / K(T)
```

K(T) makes the largest **fixed reference** CIE 1931 → linear-sRGB channel equal to one.
It does not depend on the active sensor; that sensor owns the measurement response.
RGB uses the signed projection of this same spectrum. Spectral readers evaluate Planck
at the ray's wavelengths, without an RGB lift or D65 multiplier. Temperature-derived
chroma/normalization and intensity have separate bindings, so shared temperature controls
do not accidentally share intensities. The supported temperature domain is 1000–40000 K.

The [Sep 27 comparison](claude-blackbody-comparison.md) measures the intentional migration:
on the old 1667–25000 K integer grid, maximum signed linear-channel difference is
1.392% of the unit peak (negative blue clipped by the old implementation); after
display-only clipping it is 0.189%. These are direct-emission comparisons, not bounds
on rendered scenes. True 1000 K emission also replaces the old low-temperature clamp.
The owner accepted D5's single definition. See the
[implemented contract](../src/components/color/blackbody/README.md) for normalization,
quadrature, supported binding sites and verification.

### 5.5 Media

**σ_a and σ_s are lifted separately, each with the coefficient role**, as pbrt-v4 does
(media.cpp:177-183, §2.7).
- Each lift is non-negative, so α = σ_s/(σ_a + σ_s) ∈ [0, 1] at every λ automatically.
- Lifting extinction and albedo (σ_t, α) instead is not needed for validity. Its only
  advantage is a tighter majorant for formula media (see below), which is D8.

Under Mallett–Yuksel (D2) most of this section's rules would disappear.
- U is linear and convex, so U(σ_a) + U(σ_s) = U(σ_a + σ_s) and min(c) ≤ U(c)(λ) ≤ max(c).
- The RGB majorant then bounds the spectral field unchanged (K_U = 1).
- One rule stays under either method: the clamp is applied to the authored value.

**Majorants depend on the colour model.**
- Today σ̄ is the maximum over RGB channels of σ_a + σ_s (`derivedMajorant`,
  materials.ts:760-771 — *read*).
- In a spectral program σ̄ must bound σ_t(λ) for every λ.
- **Constants:** compute max_λ U_u(c)(λ) exactly on the CPU. The sigmoid is monotone, so the
  maximum of s(q(λ)) sits at the quadratic's vertex or at an end of Λ. This is pbrt-v4's
  `MaxValue()`.
- **Expression media with an authored ceiling:** see the clamp below.

**The clamp must happen before upsampling.**
- **Today:** the D1 clamp scales σ_a and σ_s together when `spectrum_max(σ_a + σ_s)` exceeds
  σ̄ (materials.ts:574-578 — *read*).
- **The trap:** if `Spectrum` simply became a `vec4`, that maximum would be over the four
  *sampled* wavelengths. The medium at λ₀ would then depend on which companions were drawn.
  The integrand would depend on the sample, which is a bias.
- **The fix:** apply the clamp to the authored RGB value before upsampling. The ceiling is
  part of the authored field (§1.2 b), and the generated code computes the authored σ first,
  clamps, then lifts (§3.5).
- **The spectral majorant then follows from the model's `runtimeBoundFactor`** (§3.3):
  - Let K_U = sup_c max_λ U_u(c)(λ) / max(c). It is a property of the table, computed once
    (≤ 2 under pbrt-v4's scale rule — *derived*).
  - After the clamp, max(σ_a) + max(σ_s) ≤ 2σ̄.
  - So σ_t(λ) ≤ 2 K_U σ̄ (*derived*).
  - Lifting (σ_t, α) instead would give K_U σ̄ (D8).
- **Cost:** that many times more null collisions in spectral programs, for formula media only
  (*prediction*). Constant and driven media get their exact bound from `bound()`.

**The subsurface albedo inversion** (authoring/subsurface.ts:159-184, per RGB channel —
*read*) is unchanged at first: its RGB output is upsampled like any other. A per-wavelength
inversion is later work.

### 5.6 Dispersion

- `ior` rows take the role *index*.
- `ior_of(region, p, wl)` returns n(λ₀) as a float.
- If an adjacent region's n depends on λ and the surface model consumes region index, its
  dielectric or rough-dielectric scattering collapses first
  (§4.3).
- The RGB renderer uses n(587.56 nm), the helium d-line at which glass catalogues quote n_d.
- GRIN gets the same treatment through `ior_at(med, p, wl)`, as its design reserved
  (fable-variable-ior.md:199-204).

This is also the rider the realistic-camera plan waits for: per-glass dispersion data in its
lens table (impl-plan-realistic-camera.md:34-35 — *read*).

---

## 6. Shared GPU memory — the question scene-once step 4 waits on

**What is there** (*read*):
- **Light-table rows** in tree mode. They hold radiometric vec3s, and the shader *evaluates*
  emission from them, not just selection (table.ts:54-77; lighting.ts:749-778, 849-901).
- **Per-instance attribute colours,** including instanced lights' Le (instancing.ts:148-175;
  values.ts:75-79; lighting.ts:731).
- **The sky image** (RGB32F, HDREnvironmentLoader.ts:110), read bilinearly (importance.ts:52-56).
- **Scalar selection data:** the sky's importance CDFs (R32F) and the light tree's per-node
  power Φ (light_tree.ts:16, the mean of RGB, power.ts:9-11).

**Recommendation (D1 = A): shared memory keeps colours as authored; a spectral shader converts
on read.** Four reasons:

1. **It realises pbrt-v4's texture model (§1.2 b) with one lookup.** The sky is filtered
   bilinearly and then upsampled, which is exactly "convert after the fetch".
   - Mitsuba's model (upsample each texel, then blend the spectra) needs per-texel
     coefficients and four spectrum evaluations per lookup: option B below.
   - Filtering the coefficients themselves would be a third model, which neither system uses.
2. **The bytes are the same for every set of renderers.**
   - The layout gets no colour-model variants; `planDataLayout` and `DataReads` are unchanged.
   - The scene-once rule, that the shared parts depend on no renderer's settings, holds by
     construction.
   - Step 4 can be built now: the packer stores authored values, and each renderer's lift
     happens in its own program (§3.5).
3. **Estimator-only data needs no conversion.**
   - Φ and the sky's CDFs are sampling densities. An estimator stays unbiased under any
     density that is positive wherever the integrand is.
   - That holds here, because the upsampled spectrum is non-zero exactly where the RGB value
     is non-zero (the sigmoid is strictly positive, and D65ₙ > 0 on Λ).
   - The same holds for spectral-authored emitters. The mean of a spectrum's sRGB projection
     is positive for any non-zero spectrum on Λ (§3.7), so the existing heuristics serve every
     form.
4. **It costs one table lookup per run-time colour read, and nothing for constants.**
   - Run-time reads are: a sky lookup per miss or sky sample, an instance colour per hit on an
     instance, and a light row per NEE sample in tree mode.
   - Constants, which are most colours, pay only the sigmoid evaluation.
   - *Prediction*: small next to traversal; to be measured on the bench.

**Rejected (B): one copy per colour model in the layout,** in the way optional structures are
laid out today.
- Mitsuba 3 does this for bitmaps and environment maps (4 floats per texel, §2.6).
- Reads would be faster (no table).
- But the layout would gain colour-model variants and double its colour memory when both
  kinds of renderer are present, and the sky would follow Mitsuba's texture model rather than
  pbrt's.
- It is worth revisiting only if the bench shows table lookups mattering.

**Authored forms that are not RGB, in shared rows — Planck built.**
A packed light retains its RGB projection for RGB rendering and CPU selection, plus its
original Planck definition for spectral rendering. The existing header, owned by
`components/lights/table.ts`, carries `(kind, emissionForm, temperature, scale/K)`.
Form 0 reads the RGB payload; form 1 evaluates Planck. Metadata is authored independently
of renderer order or colour mode. The payload and row stride are unchanged.

This replaces the proposed scene form registry: Planck fits directly in the header, so no
registry or additional texture is needed. Constant batch emitters retain their original
form in the generated batch arm. Future spectral forms must explicitly extend this layout
when their readers are implemented; they are not supported by the Planck tag.

---

## 7. The upsampling table

- **What it is:** Jakob–Hanika's precomputed coefficients. There are three tables, one per
  largest channel, each res³ entries of three coefficients (details and sizes in §2). At
  res = 64 in float32 that is 3·64³·3·4 B ≈ 9.4 MB (*derived*).
- **How it is made:** built offline by a script in `tools/` from the same CIE and D65 data
  the renderer uses, so round trips are measured against *our* matching functions.
  - It uses the Levenberg–Marquardt fit of the current rgb2spec: sRGB RMS ΔE 0.0027. pbrt-v4
    still ships Gauss–Newton, which measured RMS 0.66 (§2.3).
  - The result is shipped as a binary asset, like the sky images.
- **How it fits in WebGL2:**
  - The engine has no 3D textures (a search of src/ found no `TEXTURE_3D`, `texImage3D` or
    `sampler3D` — *read*).
  - The table is laid out as a 2D atlas, for example 2048 × 384, and interpolated by hand
    with 8 `texelFetch` calls.
  - The z node is found in closed form, by inverting smoothstep twice with
    g(y) = ½ − sin(asin(1 − 2y)/3), with no search (§2.6). Interpolation is then linear in z
    between nodes, as in pbrt.
  - Manual interpolation lets the CPU twin match the GPU.
  - The table stays float32: fp16 is not precise enough for the coefficients (§2.3).
- **Error budget.** Trilinear interpolation adds RMS ΔE 0.026 on sRGB at 64³ (§2.3), far
  below a just-noticeable difference (≈ 2.3). The witnesses do not depend on it: they compare
  against P(U(c)) computed through the same lookup.
- **Sampler budget.** Spectral programs add two samplers (the table and the CMF/D65 texture),
  or one if packed together. The floor is 16 (Generator.ts:32). The largest rosters today,
  *measured* on the heaviest suite scenes, are 7: cacti, forest and bazaar each use 6 data
  channels + `u_previous`. The sky scene uses 4.

---

## 8. Things spectral makes possible later

None of these is designed here; each needs the machinery above.
- **Conductors** with measured η(λ), κ(λ) (claude-improvements-2026-09.md §2.5).
- **Spectral MIS for media:** the deferred r_u/r_l tally batch
  (fable-heterogeneous-media.md §6), which lists spectral scheduling as its trigger.
- **Physically-based skies:** Rayleigh σ_s ∝ λ⁻⁴ as a formula, not a tint.
- **Other effects:** thin-film interference, fluorescence (a λ-changing event: re-emission at
  a new wavelength) and polarisation.
- **Redshift in curved spaces** (contracts §8 point 4). The ray's current `Wavelengths` changes at
  each segment by the frequency ratio fixed by the frames at its two ends, with a throughput
  factor. That is an update to the carrier (§3.4), supplied by the ambient space. It needs
  emission defined beyond Λ: upsampled RGB is defined only on Λ, while Planck and formulas are
  defined everywhere.

---

## 9. Verification — written first

### 9.1 For the colour-model refactor (S0: no output change)

- **Every suite scene compiles under every registered model** (glslang). In S0 that is `rgb`
  and the test-only canary with N = 2 (§3.10). The canary must catch component access in the helpers
  (math.glsl:66-68) by compilation and wrong channel counts by numeric checks (§13 item 4).
- **No generator branches on a model's name:** a test over src/compiler/generate/ for `'rgb'`
  and `'spectral'` literals.
- **RGB output is unchanged.**
  - The digest (`npm run digest -- --compare`) differs only in the expected text: the `wl`
    arguments and fields, the moved typedefs, the helper bodies, and the accumulator lines.
  - Its diff is reviewed by kind of line.
  - Preserve RGB arithmetic order as well as draw counts (§13 item 5). Verify pixel identity
    on a targeted witness set chosen by what the text touches:
    furnace, media, heterogeneous, GRIN, dielectric, instanced lights, sky. The full sweep is
    run only with the owner's go-ahead.

### 9.2 For the spectral model (S1, S2): witnesses with derived values

| | Scene | Expected | Catches |
|---|---|---|---|
| **W1** | F-BOX (furnaceBox.ts) in a spectral program | 0.4 in every channel, as RGB | grey constants exact, D65ₙ and M consistent, film normalisation, λ pdf |
| **W2** | F-BOX with a *coloured* albedo c | RGB: 0.2 / (1 − c) per channel. Spectral: M ∫ 0.2 D65ₙ / (1 − U_b(c)(λ)) · x̄ȳz̄ dλ / C, computed on the CPU from the same table | U, the emission rule, the film, the bounce sum. The two numbers differ; their difference is the size of RGB's truncation for that colour |
| **W3** | coloured lambert, white light, `maxBounces: 1` | P_ρ(U(c)), computed on the CPU through the same lookup; it equals c up to the table's round-trip error | the round trip end to end, GPU against the CPU twin |
| **W4** | the existing estimator pairs, in spectral programs | pt ≡ pt-nee ≡ pt-mis; `wavelengths: uniform` ≡ `visible` | carrier plumbing; CPU and GPU lifts are one function (instanced-light and tree scenes) |
| **W5** | chromatic homogeneous slab; heterogeneous medium with an authored ceiling | P of exp(−σ_t(λ) d), computed on the CPU | channel MIS at N = 4; the clamp on the authored value |
| **W6** | (with dispersion) dielectric slab at normal incidence with a Cauchy n(λ) | P of (1 − F(n(λ)))² only for the isolated two-transmission measurement; pin the event budget and add an oblique direction witness (§13 item 2) | index forms, one-time collapse and chromatic direction |
| **W7** | a blackbody emitter seen directly, alone and under the light tree | P of the normalised Planck spectrum | the blackbody definition; the original-form header in shared rows (§6) |

### 9.3 TypeScript twins (vitest)

- the sigmoid and the table interpolation, CPU against a GLSL transcription;
- the round-trip error |P(U(c)) − c| over a grid of sRGB colours, reported and bounded (greys
  exact);
- a χ² test of wavelength sampling against p;
- M · XYZ(D65ₙ) = (1, 1, 1);
- K_U from the table;
- the Monte Carlo check of §4.3, in which the collapse-after-hero-sampling variant must fail.

---

## 10. Staging

Each stage gets its own plan for approval. S0 is a pure refactor and is kept apart from the
feature work, as CLAUDE.md requires.

- **S0 — the colour-model family, with the `rgb` occupant only. No output change.**
  - `components/color/` with its README, registry and `rgb` occupant.
  - core.ts places the model's types part before structs.glsl, which loses its
    `Spectrum`/`Radiance` defines.
  - The N-generic helpers and `spectrum_pick`.
  - The `Wavelengths` carrier on `Ray` and `Hit`, and the separate camera sample (§3.4).
    Thread the carrier through the resolvers and the resolved records.
  - Row roles, and `emitValue(value, role)` through the model.
  - `liftRuntime` at the four run-time read sites (the identity in RGB).
  - The accumulators call `wavelengths_sample` and `color_to_pixel`; the RGB model's
    `color_to_pixel` applies the `ideal` sensor exactly as today (§3.6).
  - The heterogeneous clamp computed on the authored value before the lift (the same
    arithmetic in RGB).
  - `environment_radiance` typed `Radiance`.
  - This is also scene-once step 4.
  - Proof: §9.1.
- **S1 — the `spectral` occupant: spectral renders of the scenes we have.**
  - The table and its CPU twin.
  - `cie.ts`, the film, and wavelength sampling (`estimator.wavelengths`).
  - The runtime lift.
  - Planck blackbody with its original definition in shared row headers (built).
  - Majorants through `bound`/`runtimeBoundFactor`.
  - Witnesses W1–W5 and W7.
  - Every existing scene renders spectrally with no authoring change.
- **S2 — spectral authoring.**
  - Named, tabulated and index forms, and formulas in λ.
  - Dispersion and the collapse; GRIN n(λ).
  - Witness W6.
- **S3 — later:** conductors, spectral MIS for media, then the §8 list.

---

## 11. Decisions for the owner

**D0. Adopt the colour-model family (§3).**
- A pick-one `color/` family owns the representation, the carrier, the lift and the
  projection.
- Nothing else interprets a `Spectrum`'s components.
- `Spectrum` leaves the core spine.
- **Recommended.** It is the repo's own pattern: the pick-one family, the ambient precedent,
  descriptors that state facts. It is also what Mitsuba 3 does with compile-time variants
  (§2.7).

**D1. Shared GPU memory.**
- A: keep authored values, lift on read (recommended).
- B: one copy per colour model.
- §6 gives the reasons.

**D2. RGB → spectrum method.** All three are sourced in §2.3.
- **Jakob–Hanika (recommended).**
  - The method pbrt-v4 and Mitsuba 3 use, and what contracts §8 named.
  - Smooth spectra; reflectances in (0, 1); any gamut.
  - Costs: it is nonlinear, so it brings the rules of §1.2 (b), §5.5 (K_U) and §7 (a 9.4 MB
    float32 table).
- **Mallett–Yuksel.**
  - Linear and convex, so filtering and sums commute with U and RGB majorants carry over.
  - A 3 × 81 table, public.
  - But sRGB only; less smooth spectra; the basis stops at 780 nm.
- **Peters' moments.**
  - What Manuka moved to: bounded, linear in the spectrum.
  - The most machinery of the three.
- **U belongs to the scene;** a second method is a second occupant of the lift, with a scene
  field only when it exists. Rendering W2 under two methods measures how much a coloured scene
  depends on the choice of metamer.

**D3. Where the wavelengths are stored — decided: (A), on the ray.**
- `Ray` carries current local wavelengths; `Hit` carries the arriving wavelengths.
- Original camera wavelengths and their sampling PDFs remain with the estimator.
- Throughput and accumulated radiance remain on `PathState`.
- Transport constructors must receive or inherit the carrier (§3.4); future wavelength-changing
  interactions must be able to supply a new one. RGB uses the placeholder.

**D4. Film space.**
- Accumulate linear sRGB for both colour models and declare the RGBE clamp of out-of-gamut
  colours (recommended for now).
- Or accumulate XYZ, which is non-negative (pbrt-v4's default sensor space), and export XYZE.
  The HDR loader would then also need to read the FORMAT line, which it ignores today
  (engine/loaders/hdr-loader.ts:49-66 — *read*).

**D5. Blackbody — decided and built (owner, Sep 27).**
One normalized Planck definition, with RGB using its signed reference projection.
The old Kim fit has been removed from production. See §5.4.

**D6. Formulas in λ under an RGB renderer.**
- Project them with a fixed quadrature and declare it part of the `'rgb'` truncation
  (recommended, so an RGB preview works on every scene).
- Or reject them with a Validator error.

**D7. Where the spectral response lives — decided (owner, Sep 26): in the sensor.**
- The sensor family owns the response; sensors are selected per program by
  `measurement.sensor` and declare the color models they support (§3.6).

**D8. The media lift.**
- σ_a and σ_s lifted separately, as pbrt does (recommended for simplicity).
- Or (σ_t, α), which halves the spectral majorant of formula media (§5.5).

---

## 12. Not in this design

- Fluorescence, polarisation, thin films (§8).
- Spectral image textures.
- Camera sensor curves and white balance (future spectral sensor occupants, D7).
- A mono (one-channel) model. Mitsuba has one; the family admits it as a third occupant. Not
  planned.
- Wide-gamut authoring (ACEScg).
- Moving `Point`/`Direction` into the ambient family's types part. It uses the same mechanism
  (§3.9) and is not built here.
- The colour picker's missing sRGB decode: ColorPicker.ts:87-92 treats hex/255 as linear
  (*read* by the survey). It is a UI issue, independent of spectral, and worth its own small
  fix.


## 13. Review items to resolve before implementation

The colour-family structure, authored shared data, role-specific lifts and staged rollout
are a sound basis. The following are requirements or unresolved claims, not implemented fixes.

1. **Collapse must be idempotent (§4.3).** Applying `(4, 0, 0, 0)` at every dispersive
   boundary amplifies surviving throughput again on exit or re-entry. Carry an explicit
   estimator flag (or equivalent state) so only the first collapse multiplies by four.
   Do not infer termination from zero throughput lanes: physical absorption can zero them.
   Add repeated-interface coverage and pre-collapse emission coverage. The symmetry condition
   in §4.3 concerns the history before the first collapse; later hero-dependent decisions
   are expected. Specify collapse ordering relative to material resolution and NEE, not only
   BSDF continuation, especially for rough dielectric surfaces.
2. **W6 needs a complete measurement.** `(1-F)^2` is the direct two-transmission term of
   a lossless plane-parallel slab with equal exterior indices and unit tint. With all internal
   reflections included, transmitted power is `(1-F)^2/(1-F^2) = (1-F)/(1+F)` at each
   wavelength (incoherent transport). Pin the geometry, illumination and event budget:
   `maxBounces: 2` can isolate the first expression with an unlit camera-side exterior;
   a larger finite budget needs its finite reflection sum. An oblique prism or interface
   witness must additionally verify wavelength-dependent direction: normal incidence cannot.
3. **The pbrt bias claim is not a reproduced renderer result (§2.2, §4.3).** The toy
   establishes a failure for its specified estimator. Treat its extension to pbrt as a
   hypothesis until the complete estimator, including wavelength termination and density
   bookkeeping, is derived or tested in a pinned-version reproduction. It is not needed to
   justify this renderer's symmetric pre-collapse sampling rule.
4. **The two-channel canary needs actual conversions (§3.10).** A `vec2` spectrum cannot
   use an identity lift of authored `vec3` or an identity projection to a `vec3` pixel.
   Give it explicit test-only lift/projection rules. Compilation catches `.z` access, but
   cannot catch division by three or a channel pick that still samples three channels;
   those require numeric or bounds checks.
5. **S0 bitwise equality is not automatic (§9.1).** Replacing `(x+y+z)/3` with a dot product
   of individually scaled components may alter rounding and subsequent sampling decisions.
   Preserve RGB arithmetic order if pixel identity is the gate, or explicitly distinguish
   numerical tolerance from bitwise identity. Unchanged random-draw counts alone do not prove it.
6. **GPU lookup precision needs a measured boundary check (§7).** The double-precision
   inverse-smoothstep result does not establish correct float32 cell selection near nodes or
   endpoints. Compare actual GLSL lookups against the CPU at those boundaries; correct the cell
   against stored nodes if necessary. The same-function requirement is a numerical contract,
   not merely matching formulas in two languages.
