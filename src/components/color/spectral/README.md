# Spectral colour model

`measurement.color: 'spectral'` uses four wavelengths in nanometres on [360, 830],
with a CIE 1931 sensor by default. Current public support is nonnegative RGB
emission and constant/image/procedural skies, reflectance colours in [0,1], live RGB
colour parameters, surface RGB expressions, PT/NEE/MIS, light-tree selection and
instancing with constant or per-instance RGB colours. Homogeneous and heterogeneous media support absorption, scattering and volume emission.
Wavelength-independent GRIN and [Planck blackbody emission](../blackbody/README.md) are supported; Cauchy and Sellmeier indices are also supported; other non-RGB forms remain rejected. All six existing surface models are supported: Lambert, checker, mirror, GGX, dielectric and rough dielectric. Glass supports scalar, Cauchy and Sellmeier wavelength-dependent IOR; see the
[index/collapse contract](../cauchy/README.md).

## Measurement and sampling

The sensor returns `M * xyz(lambda) / C`, where `C = integral(ybar)` and `M` maps
XYZ to linear sRGB. The colour model estimates the integral as
`sum(L[i] * sensor_response(lambda[i]) / pdf[i]) / 4`. Film values are signed:
negative RGB channels survive accumulation. Display transforms follow averaging;
the existing RGBE exporter cannot preserve negative components.

`estimator.wavelengths` selects `uniform` or `visible` (default). Both use one uniform
random value and four cyclic quarter-interval offsets in CDF space. Each lane keeps
its own marginal PDF. Uniform density is 1/470. Visible density is the normalized
restriction of `sech²(0.0072 * (lambda - 538))` to the wavelength interval. Its CDF
and inverse use the same two endpoint tanh values; there is no endpoint clipping.
The original camera sample stays with the accumulator; `Ray.wl` carries the current
wavelengths. This implementation does not change wavelengths along a path.

## RGB lift and the serialized model

The bounded Jakob–Hanika representation is
`rho(lambda) = 0.5 + 0.5 * p / sqrt(1 + p*p)`, with
`p = (a*t + b)*t + c`, `t = (lambda - 360)/470`.
Exact greys bypass the table, including black and white. The maximum RGB channel
chooses one of three tables (first channel wins ties); the other two divided by that
maximum are the horizontal coordinates. The maximum itself uses 64 nonuniform
nodes. Six binary-search steps locate the interval, and eight texel fetches implement
trilinear interpolation. CPU and GPU use the same nodes and coefficient bytes.

Reflectance uses the bounded lift directly. A nonnegative coefficient uses
`scale = 2*max(rgb)` and `scale*rho(rgb/scale)`, with exact zero handled separately.
Emission additionally multiplies by the normalized D65 curve. Coefficient evaluation
is used by homogeneous and heterogeneous media. Tracking uses the numerical majorant
certificate below. Reflectance gain above one remains an unresolved policy;
there is no silent clamp or implemented gain extension.

The shipped model is `jh-cie1931-d65-v1`. Its metadata, matrices and SHA-256 hashes
are generated in [data.ts](data.ts). Both binary files are little-endian float32 RGBA:

- `coefficients.bin`: 2048 × 384, 12,582,912 bytes. Flattened node index is
  `((channel*64 + z)*64 + y)*64 + x`; RGB stores `(a,b,c)`, alpha is zero.
- `curves.bin`: 128 × 2, 4,096 bytes. Row zero contains 95 CIE XYZ/D65 samples at
  5 nm intervals; row one holds the 64 intensity nodes in red. Unused entries are zero.
  Curve evaluation is manual linear interpolation, including both wavelength endpoints.

The total payload and RGBA32F allocation are both 12,587,008 bytes (about 12.0 MiB),
without mipmaps. Spectral programs add two samplers; the direct-emitter and plane
fixtures have these plus the accumulation-history sampler. Existing scene-data
textures add their usual samplers when needed. RGB programs reference neither asset.
The App loads only referenced built-ins, checks length and checksum, and retains CPU
bytes for context restoration. Missing or corrupt assets fail initialization by name.

## Live colours

A colour may be authored as `{param, default, min?, max?}`. The default is required
and must be a finite scalar or three-component RGB value in its role's domain:
[0,1] for reflectance, nonnegative for emission. Declared scalar slider bounds must
also fit that domain and be ordered. Scalars broadcast on both initial upload and
subsequent writes. Uniforms remain authored RGB; the shader lifts their current values
at the ray's wavelengths. The existing computed bindings update finite-light and sky
selection probabilities when their dependencies change.

Live writes through `app.setParameter` / `setParameters` carry the same author contract.
Slider limits are UI metadata; the App does not enforce them or clamp spectral inputs.
Out-of-domain writes are unsupported. A parameter shared by several roles must satisfy
every role's domain. The proposed gain extension above one is still undecided.

Existing light eligibility rules remain: driven authored lights use power/uniform
selection; light-tree rows are constant until refitting is implemented. A driven material
emitter is path-found unless a supported authored-light accessor represents it. The
`constant` sky model means spatially uniform; its colour can be live.

The `spectral-live` lab scene exposes surface albedo/emission, quad emission and sky
colour. `npm run witness -- spectral-live spectral-live-changed` compares defaults and
changed values with constant scenes, and checks NEE/MIS. Against a running dev/preview
server, `npm run witness:spectral-live` changes controls repeatedly in one renderer,
compares with constant renders, tests scalar/zero values, restores the initial session,
and asserts that the live renderer was not recompiled.

## Packed colours

Instance colour arrays and ordinary light rows retain authored RGB. The
existing generated readers lift those values at the supplied wavelengths after the
texture fetch. No spectral coefficients replace the shared scene-data payload.
Nested RGB arrays, scalar broadcasts and interleaved float32 arrays follow the existing
attribute format. Spectral validation checks their role's input domain: reflectance
in [0,1], emission nonnegative, all finite. Existing restrictions on instance geometry,
emission attributes and light-tree eligibility still apply.

Tree power remains a strategy-independent RGB proposal. Nonzero nonnegative RGB has
positive RGB power, so a spectrally emitting row is not omitted for having zero RGB
power. The light's evaluated spectrum, rather than this proposal weight, contributes
to transport. The same carrier reaches sampled emission and hit-side emission.

## Provenance and regeneration

Run `npm run generate:spectral` with Python 3 and a C++17 compiler. It uses the pinned
[Mitsuba rgb2spec source](https://github.com/mitsuba-renderer/rgb2spec/tree/721145dedf2491851bd46ab8fd165955cb38ddaf),
including its CIE/D65 samples, optimizer and BSD-3-Clause license, vendored under
`tools/spectral/vendor/rgb2spec`. The license is also shipped at `public/licenses/rgb2spec.txt`.
The method is [Jakob and Hanika, 2019](https://rgl.epfl.ch/publications/Jakob2019Spectral).
The visible proposal follows the shape used in
[PBRT's visible-wavelength sampler](https://github.com/mmp/pbrt-v4/blob/master/src/pbrt/util/sampling.h),
with explicit finite-interval normalization here.

The generator patches temporary copies, leaving the vendor files intact. It rounds
CMFs to float32, normalizes D65 using the exact product integral of piecewise-linear
curves, and derives the RGB matrix from sRGB primaries and that sampled white. It fits
against those curves/matrices, using the upstream optimizer's 15 iterations and 64³
resolution per largest channel. It keeps coefficients in normalized `t` rather than
converting to nanometre polynomials, avoiding cancellation between large terms.
On the development Apple Silicon machine with Apple Clang 21.0.0, compilation plus
fitting took 3.18–4.24 seconds. A second generation reproduced both assets and metadata
byte-for-byte. Changing these conventions requires a new model version and regenerated hashes.

`lookup.ts` supplies CPU lookup for audits/probes. Production constants currently use
the GLSL lookup too; compile-time coefficient folding has not been implemented.

## Verification and costs

`npm run audit:spectral` integrates the serialized lift independently in wavelength
space for a 7³ RGB grid and 1,024 fixed random colours. This asset measured RMS
channel error 0.0005581 and worst channel error 0.013779. Halving Simpson spacing
from 0.5 to 0.25 nm on the grid changed results by at most 2.30e-9. These are measured
errors, not a universal bound. Declared acceptance budgets are RMS < 0.003,
maximum < 0.03 and quadrature discrepancy < 1e-5.

`npm run witness:spectral` executes the actual lookup, both wavelength proposals,
coefficient/emission roles, and signed film integration on SwiftShader. It rejects
compiled mutations using a shared PDF, dropping a lane, or clamping film early.
`npm run witness -- spectral-direct spectral-furnace spectral-colored-furnace spectral-plane`
checks direct D65 emission, finite-depth grey/coloured furnaces, and PT/NEE/MIS on a
coloured plane against independent quadrature.

An additional manual run used salts 71, 173 and 907 at 32², 128 spp for every
direct-emitter, coloured-furnace and plane strategy: 30 frames, all within the
prespecified 0.008 absolute-channel tolerance. The worst error was 0.005109. All
90 channel means were within 1.58 estimated standard errors of their targets
(standard errors estimated across pixels, assuming independent pixel streams).
For a running dev or preview server,
`npm run witness:spectral-lifecycle` checks asset fetching, resolved export metadata,
and identical pixels after losing and restoring the WebGL context.

`npm run witness:spectral-bindings` executes generated attribute and light-row readers
on data packed by the App, checking all four wavelengths against the serialized-model
CPU reference. It covers nested/flat attributes, both instance placement formats,
point/spot/quad/sphere/disk/softbeam/mesh rows, and agreement between sampled instance
emission and its hit-side material. A lost-instance-index mutation must fail.
`npm run witness -- spectral-packed spectral-packed-ref` checks complete scenes:
packed attributes versus individual materials, packed light rows versus inline lights,
and NEE versus MIS for ordinary and instanced emitters, with a sampled sky.

`npm run benchmark:spectral` compares table lookup with precomputed polynomial
coefficients for the same 256² four-lane output. It records the renderer, image
agreement and repeated draw/readback wall times. SwiftShader has no timer-query
extension here. After 24 warmup draws, three batches of 24 draws measured
polynomial-only costs of 0.146, 0.188 and 0.254 ms/draw, versus table-lookup costs of
1.479, 1.879 and 1.792 ms/draw. Output disagreement was at most 8.95e-8. These are
software-renderer draw/readback costs for one repeatedly accessed colour, not native GPU
shader timings or a scene-level speed estimate. Native-GPU and heavy-scene ray-carriage
measurements remain outstanding.

## Surface material verification

Radiometric inputs are checked through each model's property schema: albedo, both
checker colours, conductor `f0` and interface transmittance use the reflectance domain;
Lambert emission uses the emission domain. Existing scalar IOR validation and the
opaque-dielectric shadow policy apply unchanged. The shaders already operate on
`Spectrum`; enabling these models required no BSDF or transport changes.

`npm run witness:spectral-bindings` includes fixed-wavelength BSDF probes: normal
mirror/GGX weights, both checker colours, glass transmission weights with the η²
factor, and GGX/rough-glass evaluation against closed forms. All four lanes are checked.
`npm run witness -- spectral-materials spectral-mirror spectral-eta spectral-inclusion`
checks a mixed coloured scene's NEE/MIS agreement, grey mirror reflectance, glass
radiance compression and rough glass's two-sided light-tree selection at the first
surface event. The mixed
scene is available in the lab as `spectral-materials`.

## Surface RGB expressions

A radiometric material property may use `{ kind: 'glsl', source, params? }`. The
source returns a linear-sRGB `vec3`; `p` is the world shading point and `uv` is the
surface chart. Declared parameters are live float uniforms, using the existing
`pattern.phase` → `u_pattern_phase` naming. The expression performs all RGB arithmetic
before the resolver lifts its result at the hit wavelengths, with the property's
reflectance or emission role. Lifting the inputs before blending is a different field.

At every evaluated point and live parameter value, the result must be finite and
within the role's domain: each reflectance component in [0,1], emission nonnegative.
This is an author contract; the compiler does not prove arbitrary GLSL bounds and adds
no runtime clamp. Parameter bounds describe the controls, not the resulting colour;
a negative phase parameter is valid when its formula still returns valid RGB.
Expressions return RGB, not explicit wavelength-dependent spectra.

Expression emission remains path-found under the existing light eligibility rules;
it is not inserted into the finite-light sampling roster or light tree. PT, NEE and
MIS all retain that hit-side contribution. Constant reference emitters must also set
`sampleAsLight: false` to compare the same sampling setup.

`npm run witness:spectral-bindings` checks every radiometric surface row at distinct
world/UV coordinates and two live control values, in four unequal wavelength lanes.
A deliberately incorrect lift-before-blend implementation must fail these probes.
`npm run witness -- spectral-expressions-constant spectral-expressions` compares
constant formulas and a spatial field with four independently authored constant
patches under PT/NEE/MIS. The spatial scene has a live horizontal split control;
its emission split follows the quad's vertical UV coordinate.

## Image and procedural skies

Image textures are filtered in authored RGB, multiplied by intensity, then lifted as
emission at the ray wavelengths. Procedural skies evaluate their RGB formula after
direction rotation, apply intensity, then lift. Their RGB bake only guides sampling.
Image data and formula results must be finite and nonnegative. The table builder checks
its input samples; the author contract applies between bake samples too. Formula
parameters remain unsupported, while environment intensity and rotation stay live.

Uncompensated tabulated proposals include a 1/16 uniform-sphere component (entirely
uniform for an empty table). Equirectangular cell sampling and PDF use exact solid
angles. Compensated tables remain MIS-only, including the intentionally empty case.
These estimator corrections apply in RGB as well; see [env](../../env/README.md).

The `spectral-sky` and `spectral-proc-sky` lab scenes compare NEE/MIS and both charts.
`sky-missed-cap` has a bright cap missed by both bakes and an analytic reflection
target in RGB and spectral modes. `spectral-comp-empty` checks the zero-table MIS
case. `spectral-image-constant` compares an actual RGBE texture with a constant sky.
The fixed-wavelength binding probe separately checks filtered image RGB and rotated
procedural radiance in all four lanes.

## Homogeneous media

Absorption and scattering accept nonnegative RGB constants or live parameters. Each is
lifted as a coefficient at the current ray wavelengths; neither includes a D65 illuminant.
Homogeneous Beer–Lambert attenuation, the four-channel analytic distance mixture, HG and
Rayleigh phases, medium/shadow NEE and MIS, and delta-light equiangular placement use the
existing transport seams. `scattering: 'ignored'` removes scattering from both main and
shadow extinction. Zero selected extinction means survival to the segment boundary.

Nonemissive analytic sampling needs no all-wavelength majorant. Expression coefficients
and emissive scattering media on straight paths use the tracking bound below. Existing
small-PDF normalization floors are unchanged, so these checks do not certify extreme
optical depths.

`npx vite-node scripts/audit-spectral-media.ts` computes slab references by independent
wavelength quadrature. `witness:spectral-bindings` checks the generated medium resolver,
live coefficients, shadow transmission and all four analytic sampling lanes on the GPU.
The `spectral-slab`, `spectral-shadow-slab`, `spectral-scatter-furnace`,
`spectral-rayleigh-furnace`, `spectral-fog` and `spectral-fog-placement` scenes provide the
rendered checks and gallery examples.

## Wavelength-independent GRIN

All four wavelengths follow one curved path through a scalar index field. Index constants,
live controls and spatial GLSL expressions are supported. The authored index must be
wavelength-independent; this is an author contract for raw GLSL, not a property the compiler
proves. `ior_at(material,p,wl)` and `ior_of(region,p,wl)` already receive the carrier.
Finite-difference gradient queries hold it fixed, and event/exit rays preserve it.

Absorption and emission use their respective spectral lifts at each step. Spatial RGB
fields need no density ceiling and undergo no tracking field clamp: the ODE controls the
step. The finite, nonnegative lift domains still apply. Scattering uses constant or live
coefficients, with uniform selection among four lanes and the full mixture density in arc
length. A zero-rate selected lane has no finite collision, even at a zero random draw.
Expression coefficients with scattering, and emission plus scattering in one GRIN region,
remain rejected by the existing curved-transport restrictions.

PT, NEE and MIS retain the existing opaque-shadow policy for deflecting media. The walker
owns interior propagation; the wall material owns Snell/Fresnel. The geometry-free interior,
step and boundary errors, traversal event budget, capture and long-walk limits are unchanged;
see [the GRIN model](../../transport/volume/grin/grin.md). GPU probes check four unequal
attenuation/source lanes, exact vacuum, zero-rate sampling and a curved trajectory with
`n²=1+0.2y`. Spectral slab, source, hard-interface/scattering furnaces, an analytic scattering
twin and a Luneburg NEE/MIS comparison exercise complete renders.

Dispersion is a separate planned stage: collapse to one contributing wavelength before the
first wavelength-dependent refraction or interior advance, then evaluate the scalar index
at that wavelength. The existing walker and source/attenuation math remain in use. Cameras
starting inside dispersive media need collapse before their first interior step too.

## Volume emission

A medium's `emission` is radiance added per unit path length. Its RGB value is lifted
with the emission role, including D65; absorption and scattering use the coefficient
role without an illuminant. Constants, live RGB controls and RGB expressions are
supported. The existing expression nonnegativity floor applies before conversion.
Emission must stay finite through evaluation and lifting; a nonzero RGB vector needs
a normal normalization denominator, as with the coefficient lift below.

Homogeneous absorbing media integrate the source analytically:
`epsilon * integral_0^len exp(-sigma_a*s) ds`. Attenuation uses the actual absorption,
including exact zero. The integral returns `len` in vacuum. For optical depth below
0.1, it evaluates the fourth-degree Taylor polynomial of `(1-exp(-tau))/tau`; the
omitted term is bounded by `0.1^5/720 < 1.4e-8`. Larger depths use the exponential
formula. This avoids cancellation without inventing extinction, and applies to RGB too.
The GRIN walker uses the same integral for full steps, the exit partial step and the
near-wall straight segment, with its existing basic-radiance source factor.

On straight paths, expression media and homogeneous emissive scattering media use the existing tracking
arms. They collect `weight * epsilon / M` at every tentative collision, **before**
the absorption/scattering/null lottery or ratio-weight update. Emission is path-found;
there is no volume light sampler. Shadow queries return transmittance only. Ignoring
scattering retains volume emission, integrating it against absorption alone. PT and NEE
support tracking; MIS supports analytic absorbing emission and the GRIN route described below.

For expression media, the common authored RGB field scale multiplies emission as well
as absorption and scattering before any lift. This preserves the source-function
convention. The sampling rate bounds extinction, not emission brightness; luminous
vacuum with spatial emission still needs an authored positive rate/ceiling.

For homogeneous emissive scattering media, let `A0 = max(1e-6, maxRGB(a+s))` on the CPU,
using current authored constants or live values. The colour model applies the same
outward-rounded envelope below to `A = float32(A0)`. This does **not** clamp the field.
Both input dependencies drive the existing derived uniform. The small positive floor
keeps a sampling process when live extinction reaches zero; at very small extinction,
path-found glow can have high variance under that inherited rate choice.

The derived-rate domain limits each authored absorption/scattering component to
`2^17`, so A0 stays at most `2^18`; compilation checks constants, defaults and declared
bounds. Live writes carry the same contract. Each GPU input maximum is at most
`A*(1+delta)/(1-delta)`, accounting for its upload/literal conversion and A's float32
rounding. The finite bounded lift and final sum therefore give
`sigma_t <= 4*A*(1+delta)^3/(1-delta)`. Even after downward serialization of M, the
existing `(1+delta)^5/(1-delta)^2` envelope exceeds that bound. Nonzero coefficient
maxima retain the normal-denominator condition below. Emission does not enter this
extinction bound and need not have its magnitude limited to the density ceiling.

`scripts/audit-spectral-emission.ts` independently integrates slab and finite-scattering-
order targets in wavelength space. The `spectral-emit*` witnesses cover analytic and
varying-density glow, common field scaling, luminous vacuum, scattering orders 0–2,
live derived rates and glowing fog under PT/NEE. Binding probes check vacuum and the
Taylor branch boundary; the majorant probe also executes the actual derived uniform
bindings. Deliberate artificial-absorption and stale-rate mutations must fail.

## Tracking bound

Nonemissive RGB-expression media use the existing delta/ratio trackers under PT or NEE.
The authored `majorant` is a **field ceiling**, A. The colour descriptor returns its
nominal float32 value and a separate, outward-rounded **sampling majorant**, M. Both path and
shadow dispatch consume the same planned sampling rate. Raising M does not change the
field clamp. MIS with tracking and equiangular heterogeneous lighting remain gated.

Numerical author contract for this stage:

- The nominal quantized ceiling is in [2^-60, 2^18]. Compilation checks the authored value against
  this interval. The upper limit keeps the existing signed-int tracking cap representable
  even at the 1000-unit far clip; the lower limit supports the division error bound below.
- Evaluated, nonnegative RGB absorption and scattering components are finite and at most
  2^60, after the existing expression nonnegativity floor. Constants and declared parameter
  bounds are checked; expression results and runtime writes carry the author contract.
- Each effective RGB coefficient vector after the common field scale is either zero or
  has maximum at least 2^-120. This keeps its normalization denominator normal. No claim
  is made for overflowing formulas, infinities or subnormal normalization denominators;
  they are outside this stage's domain, with no runtime replacement value.
- Wavelengths stay in [360,830] nm and the versioned spectral assets are unchanged.
  Their samplers explicitly request
  highp: GLSL ES texture-fetch return precision follows the sampler, independently of
  the default float precision (§8 of the specification linked below).

For a highp normal result, use delta = 2^-20 as a conservative relative envelope for
addition/multiplication and division. This exceeds the 1-ULP rounding allowance and the
2.5-ULP division allowance in [GLSL ES 3.00 §4.5.1](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf).
Subnormal components may flush to zero; normalization denominators must remain normal.
The proof starts from shader-evaluated RGB, so it does not assume accurate transcendental
functions in authored formulas.

Let A_g be the ceiling actually parsed by the shader. Literal conversion is covered by
`A_g <= A*(1+delta)`; being a nominal float32 does not make its shortened decimal text an
exact real-number spelling. Let x be the computed max channel of a+s. A true channel
sum is at most x/(1-delta).
If the field clamp fires, division A_g/x and multiplication by that scale each contribute
at most (1+delta). Thus each effective coefficient's maximum is bounded by
`B = A_g * (1+delta)^2 / (1-delta)`. If the clamp does not fire, x <= A_g gives a smaller
bound. The clamp division's denominator is within rounding distance of [2^-60, 2^61];
its positive result is
at least approximately 2^-121, so it does not encounter a subnormal denominator or result.

The bounded lift returns a finite value in [0,1]. For the coefficient lookup, the largest
normalized RGB channel is near 1/2, keeping table addresses in range. The asset checks
establish finite polynomial coefficients below 2048 in magnitude, increasing intensity
nodes with gaps at least 2^-24, and endpoints 0 and 1. With coordinate rounding, interpolation
fractions stay within [0,1.001]; three interpolation stages keep coefficients below 4096.
On the wavelength interval the quadratic magnitude is below 16384. Squaring it cannot
overflow; sqrt's argument is at least one. The final range clamp enforces the sigmoid's
mathematical range, including rounded endpoint evaluations. The exact-grey branch is
also within [0,1] for coefficient-normalized RGB.

Multiplication by twice the effective maximum gives at most `2*B*(1+delta)` for each
coefficient. Summing absorption and scattering contributes one more factor. Therefore

```
M >= 4*A * (1+delta)^5 / (1-delta)^2,  delta = 2^-20.
```

Power-of-two amplitude scaling is exact in this domain. Underflow of a small component
cannot exceed this bound: its rounding error is below one ULP of the normal amplitude;
flushing only lowers it. `spectralMediumBound` rounds the positive envelope upward to
float32: one representable step above round-to-nearest also covers the finite chain of
CPU binary64 products/division (no approximate power function is used). That chain’s
relative rounding error is below 2^-48, far below half a float32 ULP. The fifth numerator
factor covers A’s literal conversion; the second denominator
factor covers a downward literal conversion of M, since `M_g >= M*(1-delta)`. The
allowance is about 6.7 ppm above 4A, before the outward float32 step. It also bounds absorption-only tracking when scattering is ignored;
the field definition still scales the authored absorption-plus-scattering pair first.

`npm run witness:spectral-majorant` checks the asset premises and executes generated
lookups across ceiling extremes, black/grey/saturated inputs, table-cell neighbors,
wavelength endpoints, oversaturation and live gains. It inspects M-(sigma_a+sigma_s)
before the tracker's null clamp. An RGB-ceiling-as-majorant mutation must fail. These
samples test the implementation; the inequality above supplies the all-wavelength bound.


## Surface dispersion

`ior: { cauchy: [A, B, C?] }` uses micrometre coefficients with nm wavelength carriers.
The initial form supports constant A > 0 and B/C >= 0. Smooth and rough glass evaluate
index at lane zero, after the generated transport has collapsed future throughput once.
Arrival emission is scored first; rough NEE sees the collapsed packet. Sensor response,
camera PDFs and accumulated radiance remain unchanged. RGB uses the helium d-line index.

The [Cauchy component contract](../cauchy/README.md) records ownership, the prehistory
symmetry argument, numerical checks and scope. The [Sellmeier component](../sellmeier/README.md)
adds the three-term normal-dispersion formula and an N-BK7 authoring example; it uses
the same collapse and index accessors. Spatially dispersive GRIN, live coefficients,
other index forms and broader glass catalogues remain unimplemented.
