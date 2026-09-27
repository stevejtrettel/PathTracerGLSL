# Spectral colour model

`measurement.color: 'spectral'` uses four wavelengths in nanometres on [360, 830],
with a CIE 1931 sensor by default. Current public support is nonnegative RGB
emission and constant/image/procedural skies, reflectance colours in [0,1], live RGB
colour parameters, PT/NEE/MIS,
light-tree selection and instancing with constant or per-instance RGB colours. Homogeneous nonemissive media are supported. Other media,
material expressions and non-RGB forms remain rejected. All six existing surface models are
supported: Lambert, checker, mirror, GGX, dielectric and rough dielectric. Glass uses
a wavelength-independent scalar IOR; dispersion is not implemented.

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
is used by homogeneous media. Tracking media remain rejected pending their numerical
majorant certificate. Reflectance gain above one remains an unresolved policy;
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

No all-wavelength majorant is needed for this analytic stage. Heterogeneous coefficients,
volume emission and GRIN remain gated; the tracking bound proof remains open. Existing
small-PDF normalization floors are unchanged, so these checks do not certify extreme
optical depths.

`npx vite-node scripts/audit-spectral-media.ts` computes slab references by independent
wavelength quadrature. `witness:spectral-bindings` checks the generated medium resolver,
live coefficients, shadow transmission and all four analytic sampling lanes on the GPU.
The `spectral-slab`, `spectral-shadow-slab`, `spectral-scatter-furnace`,
`spectral-rayleigh-furnace`, `spectral-fog` and `spectral-fog-placement` scenes provide the
rendered checks and gallery examples.
