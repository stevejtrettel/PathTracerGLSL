# Spectral implementation plan — draft for adversarial review

**Status:** S0a–S0c and the restricted S1a spectral foundation are implemented, Sep 27, 2026. Four-wavelength rendering works on RGB-authored surface scenes with the CIE 1931 sensor. S1b now covers all six existing surface models (wavelength-independent IOR), packed RGB lights, instance colour attributes and live RGB uniforms; expressions/media, blackbody migration/public release (S1c), and dispersion (S2) remain planned. See the S1a evidence below and the [implemented model](../src/components/color/spectral/README.md).
**Baseline inspected:** `1ed553b`, plus the working-tree spectral design and its review edits.
**Audience:** the implementing agent and an independent reviewer familiar with this tracer.

The objective is to add spectral transport without changing what existing RGB renderers
compute during the preparatory refactor. A scene must support RGB and spectral renderers
together, using one strategy-independent scene plan and shared authored data. Spectral
transport must handle the existing supported material/media combinations before dispersion
is enabled. Unsupported combinations must fail validation rather than silently fall back.

This plan makes concrete proposals for the unresolved implementation choices. **Only the
decisions explicitly marked accepted below are owner decisions.** Review and reconcile the
remaining proposals before implementing the affected stage. The request to write this plan
was not approval to implement it. The owner subsequently authorized starting implementation,
with clear, minimal code as an explicit constraint.

Implementation discipline: keep the mathematics visible, validate unsupported authoring at
the boundary, and add runtime cases only when required by a supported algorithm. Proof
obligations and diagnostic probes do not each imply another production branch. Build one
coherent stage at a time; avoid temporary APIs for stages whose real inputs are not present yet.

Review navigation: [decisions](#1-authority-decisions-and-scope),
[runtime contracts](#3-runtime-contracts-to-review-before-s0),
[media bounds](#5-media-field-definition-and-estimator-bounds-are-different),
[collapse](#6-dispersion-and-the-one-time-collapse),
[build sequence](#7-implementation-sequence-and-exit-gates),
[verification](#8-verification-with-independent-targets),
[review questions](#9-questions-for-the-adversarial-reviewer).

## 1. Authority, decisions and scope

Read alongside [the design](claude-spectral-design.md), especially §§3–6 and §13,
[the trace-loop contract](trace-loop-contract.md), [component anatomy](fable-module-anatomy.md),
[strategy taxonomy](fable-strategy-taxonomy.md), and [scene-once step 4](claude-scene-once-plan.md).
This document specifies execution and proof obligations; it does not silently supersede an
owner-pinned contract. Where it proposes an interface amendment, it identifies it.

| Decision | Status | Consequence |
|---|---|---|
| Current wavelengths belong on `Ray`; arrival wavelengths on `Hit` | **Accepted** | `Ray` is a seed for light propagation, with a geometric projection |
| Camera wavelengths/PDFs remain with the estimator; throughput/radiance remain on the path | **Accepted** | Film uses the original camera sample, even after future wavelength changes |
| Shared scene data retains authored meaning; renderer performs conversion | **Accepted in scene-once plan** | No spectral coefficients replace shared RGB rows |
| Colour-model family with RGB and spectral occupants (D0) | **Accepted** (owner, Sep 26) | Own representation, lift, projection and model-specific bounds |
| Four wavelengths, Jakob–Hanika lift (D2) | Proposed | Float32 coefficient table; separate reflectance/coefficient/emission roles |
| Linear-sRGB float film (D4) | Proposed | Preserve negative channels until display; disclose RGBE export clipping |
| One Planck definition for blackbody in both modes (D5) | Proposed, deliberate RGB change after S0 | Compare and document old/new blackbody results |
| Sensor owns the spectral response (D7) | **Decided** (owner, Sep 26) | The sensor family is the measurement response: `ideal` (identity) in RGB programs; a spectral sensor with response curves (CIE 1931 → linear sRGB now, camera curves later) in spectral programs, selected per program by `measurement.sensor`; sensors declare the colour models they support and the Validator rejects mismatches. The colour model's projection only estimates the wavelength integral, calling the sensor's response at each sampled wavelength. |
| Lift absorption and scattering separately (D8) | Proposed | Conservative sum of individual spectral bounds |
| Arbitrary wavelength GLSL expressions under RGB (D6) | Unresolved; narrow first release below | No fixed-quadrature promise without an expression contract |
| Camera receives already-sampled wavelengths; mandatory carrier in `make_ray` | **Accepted** (owner, Sep 26) | No camera RNG or geometry-only intermediate; future lenses can read lambda |
| Nonnegative reflectance inputs above one | Proposed after R-6 | Preserve research gain with the scaled bounded extension in §4.2; never silently clamp |

The draft design's D1 is already substantially answered by the accepted scene-once rule.
Optional form-index storage may depend on the union of actual readers, like existing optional
data tenants. **Authored payload meaning and form identity must not depend on strategy order.**
Do not claim the entire packed allocation must be identical when the required tenants differ.

Deliverables are S0 (RGB-preserving preparation), S1 (spectral rendering without dispersive
indices), and S2 (explicit spectra and dispersion). Each has an independent acceptance gate.
Redshift, fluorescence, polarization, complex-IOR conductors, thin films, arbitrary spectral images,
new transparent-shadow policies and spectral MIS for delta tracking are outside this build.
Existing validation restrictions on estimator/media combinations remain in force.

## 2. What the current code requires us to change

These are code observations, not claims that the proposed replacement already exists.

| Concern | Current source and observation | Planned responsibility |
|---|---|---|
| Ray and spectrum types | `src/glsl/core/structs.glsl`: geometric `Ray`; RGB aliases | Colour types before core structs; carrier on `Ray`/`Hit` |
| Constructors | `src/glsl/core/ray.glsl`: two-argument `make_ray`; hit-based spawn | Explicit wavelength construction and inheritance |
| Walk and path state | `src/components/transport/integrators/pt/pt.ts` | Preserve carrier; own one-time collapse state and ordering |
| Material/medium resolution | `src/compiler/generate/features/materials.ts` | Explicit carrier; role-aware values; index evaluation; bounds |
| Value binding | `src/compiler/plan/values.ts`, `generate/values.ts` | Preserve forms in planning; renderer conversion at binding/read sites |
| Blackbody forms | `resolveColorProperty` retains the form; `projectRGB` evaluates RGB at read boundaries | Preserve the original dials for spectral evaluation |
| Ray-producing cameras | `src/components/camera/*/*.glsl`, `generate/features/camera.ts` | Receive sampled carrier and return fully initialized `Ray` (§3.2) |
| Film entry | Three accumulator GLSL files | Camera sample creation and explicit colour projection |
| Spectrum helpers | `src/glsl/core/math.glsl`; channel picks in volume occupants | Correct channel count; preserve RGB operation order in S0 |
| Lighting/sky | `generate/features/lighting.ts`, `environment.ts` | Lift every radiometric read; preserve sampling-density meaning |
| Shared storage | `src/compiler/sceneData.ts`, data ledger/packers, light table layout | Authored RGB plus stable references for non-RGB forms |
| Static resources | Feature `PlannedTexture` references, Engine texture upload/registry | App loads requested immutable assets; Engine stays generic |
| Mode selection | `plan/measurement.ts` hard-codes RGB; Validator rejects spectral | Registry-backed selection, enabled only as stages become complete |

Additional readers easy to miss: `medium_survival`, both shadow occupants, GRIN's `ior_at`
gradient chain, environment miss scoring, alternate emitter-material resolution in
`kernel_score_emitter_hit`, instanced light emission, and the three accumulator entry points. Review R-1 confirmed that only average, variance and
oneshot call the camera and transport entry at the inspected baseline; no debug/probe renderer
exists there. Inventory actual call sites again at implementation time; counts are not a gate.

## 3. Runtime contracts to review before S0

### 3.1 Three different kinds of state

Proposed spectral declarations (RGB supplies initialized placeholder wavelength types):

```glsl
#define Spectrum vec4
#define Radiance Spectrum
#define SPECTRUM_N 4

struct Wavelengths { vec4 lambda; };              // current coordinates, nm
struct WavelengthSample { Wavelengths wl; vec4 pdf; }; // original camera sample, nm^-1

struct Ray { Point origin; Direction direction; Wavelengths wl; };
```

`WavelengthSample` is immutable after sampling for S0–S2. It never lives on `Ray` or `Hit`.
`PathState` retains its existing `ray`, `throughput` and `radiance` fields. A generated
`bool wavelengths_collapsed` is added only when a program can encounter dispersive events.
Static techniques access `s.ray.wl`, which is within their existing permitted `ray` field;
they do not directly read the program-dependent collapse flag.

Every returned `MaterialProperties` and `MediumProperties`, including fallback branches,
has an initialized carrier. Its spectral values have been evaluated at that carrier.
Surface emission may come from `region_to` rather than the boundary owner; that second lookup
must use the same arrival carrier. `MediumSample` need not gain a second wavelength copy in
S0–S2: propagation and scattering here preserve wavelength, including dispersive GRIN bending.
Redshift/fluorescence would require an explicit arriving/continuing carrier in that result.

During S0–S2, lane i remains evaluated at the original camera wavelength i. Throughput
collapse changes weights, not wavelengths. Future wavelength-changing transport must maintain
the association to camera lanes, with its own transfer weights; it must not relabel previously
accumulated contributions with the final ray's wavelengths.

### 3.2 Fully initialized rays, including the camera

**Revised proposal after R-1:** sample wavelengths in the accumulator and pass the resulting
carrier into the camera. A future realistic lens needs lambda while tracing through its glass;
a geometry-only return type would require another input-contract change at that point.

```glsl
Ray camera_generateRay(vec2 film, vec2 xiLens, Wavelengths wl);
Ray make_ray(Point origin, Direction direction, Wavelengths wl);
Ray ray_spawn(Hit hit, Direction wi); // inherits hit.wl for wavelength-preserving scattering
```

Every current camera returns `make_ray(origin, direction, wl)` with its existing geometric
formulas. No `RayGeometry` type, two-argument transport constructor, temporary uninitialized
carrier or default wavelength is introduced. Local-frame intersection rays pass `ray.wl` to
`make_ray`; Euclidean object placements do not rescale nm.

This amends the camera README's prohibition on Category-B arguments: **sampling stays outside
cameras, while an already-sampled physical coordinate may be an input.** `wl` is not an extra
random dimension and the camera never resamples it. Amend the family contract and its signature
test in S0b. Add a test-only camera that makes its output direction depend on the supplied
wavelengths, so merely checking a copied field cannot conceal a discarded input.

Accumulator entry, shared semantically by average, variance and oneshot. **D7 (decided) changes
the last line:** the sensor owns the spectral response, so the pixel is
`color_to_pixel(film, ray.direction, L, cameraSample)`, where the RGB model applies the `ideal`
sensor's response (identity) and the spectral model computes
`(1/4) Σ_i sensor_response(lambda_i, film, dir) * L_i / pdf_i`:

```glsl
vec2 film = pixel_sample(pixel, random2());
vec2 xiLens = random2();
WavelengthSample cameraSample = wavelengths_sample();
Ray ray = camera_generateRay(film, xiLens, cameraSample.wl);
Radiance L = transport_trace(ray);
vec3 color = color_to_pixel(film, ray.direction, L, cameraSample);
```

RGB `wavelengths_sample` consumes no random number. Spectral consumes one after the existing
pixel/lens draws and before camera evaluation. Sampling policy is selected by
`estimator.wavelengths`; types/lift/projection are selected by `measurement.color`. The colour
descriptor may declare whether wavelength sampling is needed, but changing uniform versus
visible sampling must not change the integral. No wavelength global is introduced; deterministic
tiling seeds are retained. Current cameras neither change wavelengths nor collapse the packet.

**Future lens caveat.** Receiving lambda is necessary, not a complete dispersive-camera
contract. A lens that selects a hero trajectory must also communicate its weight and collapse
state to path initialization before any transport scoring. That must avoid a second factor of
four at a later surface. Keep sampling PDFs with the original camera sample. The realistic-camera
plan already proposes a weighted camera result; reconcile these requirements when that deferred
feature is built. Do not claim a bare `Ray` return already provides that result channel, or
collapse every camera packet now to anticipate it.

### 3.3 Lookup and arrival rules

Representative signatures (use existing `Point` aliases consistently):

```glsl
MaterialProperties scene_material_properties(int id, Point p, vec2 uv,
                                             int element, Wavelengths wl);
MediumProperties scene_medium_properties(int mat, Point p, Wavelengths wl);
float ior_of(int region, Point p, Wavelengths wl);
float ior_at(int mat, Point p, Wavelengths wl);
Radiance environment_radiance(Direction d, Wavelengths wl);
```

Lighting sample/query entry points receive the carrier alongside their existing geometric
query context. Keep existing light-selection PDFs independent of sampled wavelengths in this
build; wavelength arguments are for evaluating radiance. Do not add wavelength to replayed
`LightQuery` unless a real wavelength-dependent selection policy is introduced later.
Declare and update all `provides`/`requires` signatures, not only function definitions.

`scene_intersect` initializes `hit.wl` from the input ray and geometry writers preserve it.
Audit whole-record assignments and out-parameter helpers: an outer initialization is not
sufficient if a nested helper overwrites the record. S0–S2 intersection leaves its input ray
unchanged. Every spawned shadow ray, medium event continuation, GRIN handoff and null crossing
inherits the parent/arrival carrier. GRIN finite-difference index queries hold it fixed across
the position perturbations. Numerical origin offsets do not resample wavelengths.

`ior_of` reads the leading wavelength only after the transport ordering in §6 makes any
wavelength-dependent event eligible. Existing material function signatures can remain unchanged
because they already receive `Hit` and/or resolved properties; internal accessor calls change.

## 4. Colour model, authored forms and storage

### 4.1 Descriptor boundaries

The `color/` family supplies types, model math, constant/runtime lift emitters, projection,
spectral bounds, and immutable resource facts. Generators compose these facts; they do not
branch on model names. Type blocks precede structs; function bodies follow their math/RNG
dependencies. Both normal and debug shader assembly must be audited for the ordering change.

The draft's `liftConstant(c, role)`/`liftRuntime(expr, role)` sketches leave their wavelength
variable implicit. Make that input explicit, for example:

```ts
liftConstant(value: AuthoredColour, role: ColourRole, wlExpr: string): string;
liftRuntime(rgbExpr: string, role: ColourRole, wlExpr: string): string;
bound(value: ResolvedAuthoredColour, role: ColourRole): number;
```

These are interface sketches, not finalized exported type names. Constant lifting precomputes
coefficients, but the emitted GLSL still evaluates them at the runtime carrier. Runtime values
use the same serialized coefficient table/interpolation rule. CPU precomputation must operate
on the shipped float32 table, not an unrounded optimizer result.
The lift and its version complete the scene's spectral meaning; they are not an estimator
setting. This build supplies one lift. A later alternative must be an explicit change of scene
interpretation, with corresponding provenance, rather than a supposedly equivalent sampler.

Preserve `semantic`'s existing geometric/radiometric responsibility unless a separate
schema cleanup is justified. Add a role for radiometric rows; identify index rows explicitly
without pretending IOR is an RGB colour. Fixed medium fields and emission rows need equally
explicit roles. Do not infer roles from parameter names or material IDs in generators.

### 4.2 Binding sites and authored arithmetic

| Source | Shared/planned representation | Renderer action |
|---|---|---|
| Scalar or RGB literal | Authored grey/RGB | RGB identity; spectral coefficient literal evaluated at wl |
| `{param}` colour | Authored live scalar/RGB | Existing RGB-shaped uniform; lift after read |
| Instance attribute | Authored RGB data | Lift once after attribute fetch |
| Light row | Authored RGB, plus form reference when necessary | Same lift/form evaluation as the hit-side emitter |
| Image sky | Authored RGB texels | Filter RGB, then lift; same evaluation for miss and NEE |
| Procedural sky | Authored directional RGB formula; bake only guides sampling | Evaluate the formula at the queried direction, then lift; never fetch radiance from the bake |
| RGB expression | Source and its existing parameter bindings | Evaluate authored expression, validate/clamp under the stated contract, then lift |
| Blackbody | Temperature and scale form | Model projection/evaluation; never reconstructed from a discarded RGB fold |
| Named/tabulated spectrum or index formula | Stable form description | RGB projection/reference index or spectral evaluation |

All authored RGB is linear sRGB. Upsampling follows authored RGB arithmetic and image
filtering. A procedural sky remains a direct formula evaluation after its existing direction
rotation/intensity handling; the baked values feed importance distributions only. Do not move a
nonlinear reflectance lift through multiplication, blending or an expression. Distinguish authored
emission scaling from conversion normalization.

**Proposed policy for research gain (R-6).** Preserve finite, nonnegative albedo, f0 and
interface-transmittance inputs above one. They remain nonphysical transport coefficients, as
allowed by the taxonomy. For reflectance-role RGB c, extend the bounded lift by

```
a = max(1, maxRGB(c))
U_reflectance(c, lambda) = a * Ub(c / a, lambda)
```

This is exactly the current proposed bounded lift for c in [0,1]^3, and it preserves grey
values above one through the grey special case. It bounds the spectrum by a, not by one.
Provided Ub is continuous, it introduces no discontinuity at maxRGB(c)=1; verify the actual
lookup numerically across that threshold. Projection is linear, so its RGB round-trip error
is a times the bounded lookup's error for c/a. This is a specified modelling extension, not
an assertion of a unique physical spectrum for an unphysical RGB value.

Do not switch abruptly to the coefficient-role rule `2*m*Ub(c/(2*m))` only when m exceeds one:
that is a different lift and can change spectral shape at the threshold. Coefficient/emission
roles retain their existing rules. Constant, uniform, expression and attribute values must
use the same reflectance extension; test a live control crossing one. No new UI toggle or
scene flag is required. Negative/signed authored spectra remain a separate unsupported spectral
input domain unless a signed lift is designed; RGB's existing acceptance is unchanged.
This policy is proposed for owner/reviewer acceptance, not recorded as an owner decision.

`emitValue` remains the binding split point. Update every bypass of it (including table,
attribute and sky reads) to invoke the same model-owned evaluation. Light power and sky
importance use strategy-independent authored projections; they are proposal distributions,
not the emitted spectrum. Verify nonzero sampling support for every supported emissive form.
Do not assume a heuristic or MIS compensation inherited from RGB preserves support without
checking the estimator that uses it, particularly NEE-only environments.

### 4.3 Preserve forms through scene-once step 4

Stop constant blackbody folding in `plan/values.ts`; retain the old RGB fold at renderer
evaluation during S0. Audit all downstream array assumptions identified in scene-once step 4:
driven predicates, emission-zero predicates, instanced emission and packed tree rows.
Predicates read authored facts, including a constant zero scale; an arbitrary expression is
not proven black merely because one sample/default is zero.

The form registry and GPU references below are implemented with their first spectral readers
in S1b. S0c retains the descriptions in planned values and keeps the existing RGB packing.

For a shared non-RGB light, retain its strategy-independent RGB projection plus a stable form
reference. Spectral GLSL dispatches the reference to the original form. **Proposed concrete
layout amendment:** declare header.y of the ordinary light row as `emissionFormCode` in
`components/lights/table.ts`, alongside header.x's kind code. Zero means authored RGB;
`formId + 1` names an original non-RGB form. Validate the encoded integer is below 2^24.
The existing header is `(kindCode,0,0,0)`: this proposal names and owns a formerly reserved
slot rather than secretly consuming padding. Payload offsets and stride need not change.
Assert that each supported kind has one emission field; multiple such fields require an
explicit schema/layout extension, not reuse of one ambiguous code.

The scene plan owns the form registry. Walk material, light, medium and environment fields
in a documented, fixed order over the authored scene, independent of renderer traversal.
Deduplicate exactly equal canonical descriptions, including role, units, temperature/table
identity and scale; never deduplicate by approximate RGB projection or fitted coefficients.
IDs can remain sparse in a program that only emits the forms it reads. Driven values remain
subject to the existing tree restrictions.

Record the actual form-code reader in ProgramDescription and the union of DataReads: the
program needs original-form evaluation, registry table access, and non-RGB entries. The shared
layout/packing decision consumes that union; generator and App must not decide independently.
When nobody reads the codes, header.y stays zero, preserving S0's RGB bytes. There is no new
data tenant for the proposed header field. `lightTableLayout` remains the single owner used
by `dataTenantsOf`, the packer and the generated loaders; trails/tree/region bases continue to
come from the ledger. If review chooses separate storage instead, revise all three consumers
and its ledger allocation together before implementing it.

Instanced tree leaves do **not** have ordinary light rows: they read placement records and
a batch emission arm. A constant non-RGB batch emission refers to the same scene form registry
from that arm; it needs no form code duplicated per instance. Existing RGB attributes retain
their attribute route and lift at evaluation. CPU tree power uses the form's RGB projection.
No branch may silently turn a retained form into `[0,0,0]`. Supporting constant blackbody
forms does not authorize a new dynamically updated light-tree design.

Recompile the same scene with `[rgb,spectral]`, `[spectral,rgb]`, singletons and duplicates.
Shared form identities and authored payloads must agree where present. Optional allocations
may differ with the reader union. Each renderer's physical results must be unchanged; compare
programs under an identical layout separately from byte comparisons across different layouts.
Test independently specified header bytes and sentinel meanings, not just a pack/load round
trip that could share the same wrong offset. Include two distinct non-RGB forms, RGB entries,
mixed light kinds, mesh emitters, constant-form batches and RGB-attribute batches. Check
neighboring payloads and trails as well as spectral values.

### 4.4 Resources and numeric definitions

Use one versioned CIE/D65 dataset with documented units, range, interpolation and quadrature.
Define `C = integral(ybar)` and scale D65 so `integral(D65n*ybar)/C = 1`.
Derive the sRGB output matrix from the chosen primaries and the white computed with those
same conventions. Record dataset sources/licenses, optimizer version/settings, atlas mapping,
checksums and a reproducible generation command. Measured table error is a property of this
generated asset, not a literature number copied into a test threshold.

The coefficient atlas uses existing 2D float textures and manual interpolation; add no 3D
texture capability. **Start with bounded binary search of stored z nodes.** The inverse-
smoothstep shortcut is a later measured optimization, not an initial correctness dependency.
Handle RGB zero, equal-channel grey, endpoints and channel ties explicitly. Exact black/white
must not evaluate infinite coefficients into NaNs. GLSL highp is required; float32 evaluation
and interpolation error must be measured against the CPU, including saturated boundary cases.

Feature texture references already name external resources. Proposed loading route: a
family-owned immutable asset manifest keyed by those references, consumed by the App after
compilation and before rendering, using existing `Engine.registerDataTexture`/registry support.
Its RGBA32F allocation means a three-coefficient atlas needs padding; the design's 9.4 MB raw
coefficient payload is not the GPU allocation size (about 12.6 MB with four floats per texel).
Scan compiled resource references rather than re-deriving
requirements from the scene or colour mode. Deduplicate by versioned asset identity, await
uploads before rendering, restore after context loss, and report load failures explicitly.
No spectral logic belongs in Engine and no locked compiler–engine type change is assumed.
The external-resource rule in fable-compiler-contracts §2.10(3) must allow declared built-in
assets as well as scene data. Blue noise is already an instance; spectral model tables are
another. Every reference still needs an accountable provisioning source and a named failure
if absent. Do not describe the existing scene-origin validation as implemented when it is not.
Validate actual sampler counts with the existing assembled-program check.

Blackbody's later Planck implementation must state nm-to-SI conversion, stable exponential
evaluation, temperature limits and normalization. For each T, let `K(T)` be the maximum RGB
channel of the projected Planck spectrum; evaluate `scale*B(lambda,T)/K(T)` in spectral mode
and its same projection in RGB. Driven T can use CPU-derived normalization with a temperature
uniform; there is no need to integrate the CMFs per fragment. Preserve finite negative RGB
projection channels where appropriate. The existing temperature clamp and Kim approximation
are retained in S0; any range/appearance change belongs to the explicit S1 migration.

### 4.5 Environment proposal support and density

The existing `envCompensation` validation allows it only with MIS. Preserve that restriction:
a compensated table intentionally has zero probability in directions with positive radiance.
The competing BSDF/phase proposal must cover those contributing paths. Verify the combined
support, the actual miss weight and delta/camera exceptions in each supported transport arm.
A uniform compensated sky produces a zero table; its environment sample contributes nothing,
and a covered BSDF miss must receive full weight. This is not a normalized environment-only
proposal and must not be reused by NEE-only transport.

Uncompensated tables also need attention. A procedural formula can be bright between every
bake sample, leaving an entirely black bake. Float32 CDF storage can erase tiny positive masses
in HDR images even after the coverage blur. NEE-only suppresses non-delta BSDF misses, so these
are missing contributions, not merely poor importance sampling. Both risks exist in RGB.
Formula evaluation at the sampled direction is necessary but does not fix missing support.

**Proposed correction before public S1:** for uncompensated tabulated environments, use

```
q_env(w) = (1 - epsilon) * q_table(w) + epsilon / (4*pi)
```

Start with epsilon=1/16 as a tunable efficiency choice, and epsilon=1 when the stored table
has no usable mass. Sample the uniform component independently of CDF quantization; adding
a tiny floor to the CPU weights alone does not establish support after float32 rounding.
Both branches return the full mixture density, and `environment_pdf` evaluates that same
density before the existing environment-versus-finite-light selection probability is applied.
Repartition/remap a sample dimension correctly if reusing xi; a selector's conditional value
is not an untouched uniform sample. Preserve the distinction between this empty-table fallback
and the intentionally empty compensated MIS technique. Handle invalid/nonfinite table data
explicitly. Do not silently turn the proposed epsilon into an authoring control.

Support alone is insufficient: `q_table` must match the actual directional distribution.
The current equirect sampler uses uniform subtexel UV but divides cell mass by a midpoint
solid angle. Its evaluated PDF is consequently not the UV sampler's exact directional PDF.
With H rows and the usual midpoint sine, its sphere integral is
`sin(pi/(2*H))/(pi/(2*H))`, rather than one (ignoring pole guards and float rounding).
Checking that `sample.pdf == environment_pdf(sample.wi)` would miss this shared error.

Proposed equirect correction: sample azimuth uniformly within the chosen column and cos(theta)
uniformly between the selected row's edges. Divide cell mass by its exact solid angle
`(2*pi/W)*(cos(pi*j/H)-cos(pi*(j+1)/H))`. Give the chart ownership of within-cell sampling and
cell solid angle, with a numerically stable formula near the poles. The CDF weights may still
use midpoint luminance/Jacobian as a heuristic; their normalization need not equal the exact
cell area. Octahedral's equal-area within-cell mapping keeps its own implementation. Verify
both charts by independent integration and directional sampling histograms, including rotation,
seams and finite-RNG endpoints; neither a CPU twin nor sample/evaluate agreement is sufficient.

Land these environment corrections as an identified estimator fix separate from S0's RGB
identity gate. Record the intentional RGB result changes and verify them before advertising
spectral support for the affected strategies. No environment code is changed by this plan.

## 5. Media: field definition and estimator bounds are different

### 5.1 Clamp the authored field before lifting

For the existing bounded RGB-expression media, evaluate authored absorption `a`, scattering
`s` and emission `e`. Compute the existing common scale from `maxRGB(a+s)` and the authored
ceiling A, then evaluate the spectral forms of the scaled authored values. The same scale
applies to emission, preserving the existing source-field convention. It does not depend on
which four wavelengths were sampled. GRIN's existing exemption from this ceiling stays intact.

RGB retains current arithmetic ordering. A refactor must not accidentally change clamping
when `measurement.scattering` is ignored; follow the current field/measurement ordering, and
ensure main and shadow transport see the same resulting extinction.

For future wavelength-authored coefficients, an RGB maximum is not their field contract.
Require an explicit all-wavelength bound or a form with a proven bound. Arbitrary lambda GLSL
without such a contract is rejected in tracking routes. Sampling four wavelengths cannot
establish a majorant for the underlying field.

### 5.2 Spectral majorants

For constants and live parameters, bound the **sum** of the lifted coefficients. Start with
the amplitude envelope `2*maxRGB(a) + 2*maxRGB(s)`, with outward numerical allowance and a
finite, bounded implementation of Ub. This avoids making the first majorant depend on tight
extrema of interpolated fit coefficients. A later per-lift quadratic/sigmoid extremum bound
may reduce cost, but it is not the exact maximum of the sum and needs its own rounding proof.
Preserve RGB's existing maximum of combined channels in S0.

For the proposed unbounded RGB lift, `Uu(c) = 2*m*Ub(c/(2*m))`, `m=maxRGB(c)`, so
`Uu(c) <= K*m` with analytic `K=2`. After the common authored ceiling clamp,
`maxRGB(a)+maxRGB(s) <= 2*A`, hence `sigma_t(lambda) <= 2*K*A = 4*A`.
Use this conservative bound first, with finite-precision allowance. A tighter K needs proof,
not a grid search presented as a supremum. A sampled-grid test supplements, never replaces,
the bound. Preserve the existing vacuum guard and distinguish it from physical extinction.

These are real-arithmetic bounds, not float32 certificates. Even a nearest-rounded authored
clamp can overshoot A: for float32 A=0.11772707849740982 and x=0.6680627465248108,
`f32(x*f32(A/x))` is 0.11772708594799042. This is a CPU arithmetic counterexample to an
exact clamp claim, not evidence of an observed GPU majorant failure.

Before enabling tracking in S1, write the numerical certificate for the actual emitted code:

- Bound from the same quantized inputs that uniforms, packed rows and GLSL literals consume,
  not the original JS doubles. Cover live extrema and shared parameter updates before sampling.
- State finite input/intermediate ranges, underflow/vacuum policy and overflow rejection.
  Evaluate the sigmoid stably; clamping its finite result into [0,1] enforces its mathematical
  range but does not repair NaNs or an overflowed intermediate.
- Bound authored-clamp division/multiplication error, lift scaling, sigma_a+sigma_s addition
  and serialization of the final majorant. Round the final bound outward. A magic epsilon
  without this chain of obligations is not a proof.
- Use GLSL ES's allowed arithmetic behavior, including division accuracy, possible fused
  operations and subnormal flushing. `Math.fround` is a useful witness, not the entire driver
  model; see [GLSL ES 3.00 §4.5.1](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf).
- Execute adversarial GPU probes at black/grey/saturated limits, table-cell boundaries,
  wavelength endpoints and live-bound transitions. Inspect M-sigma_t **before** the existing
  nonnegative null-coefficient guard; that guard must not conceal a violated majorant.

The numerical allowance remains an implementation gate: there is no generated spectral asset
or emitted evaluation to certify yet. Analytic envelopes plus sampled maxima alone do not
close it. Keep the same bound contract in main and shadow tracking.

Analytic channel selection uses `SPECTRUM_N` and its actual mixture density. After collapse,
the first implementation may still choose uniformly among all four coefficient channels and
retain the full mixture denominator; zero contribution lanes do not invalidate that proposal.
Do not switch the proposal to hero-only while retaining the old mixture denominator.
Delta tracking's throughput-dependent probabilities need independent post-collapse coverage;
the analogous argument must not be assumed just from the analytic arm.

## 6. Dispersion and the one-time collapse

### 6.1 Exact rule and its limited proof claim

Before collapse, choose wavelength packets with cyclically exchangeable labels and require
the estimator's sampling/termination decisions to respect that symmetry. This is a sufficient
design discipline for the proposed collapse, not a theorem that every possible hero-based
estimator is biased. The pbrt hypothesis is not a dependency or an acceptance criterion.

On the first dispersive event, multiply continuation throughput by `(4,0,0,0)` and set the
generated collapse flag. On later dispersive events, do neither again. Preserve accumulated
radiance and the original camera PDFs. Never infer the flag from zero secondary weights.
Use a generated transport helper so the state and factor have one owner; no per-material
copies. Post-collapse wavelength-dependent decisions legitimately use the hero.

The film is `M * (1/4) * sum(CMF(lambda_i) * L_i / p_i) / C`. Multiplying future slot-0
throughput by four removes the factor 1/4 for those future contributions. Earlier contributions
retain their four-lane estimate. This argument requires symmetry of the pre-collapse history
and a collapse predicate that does not select paths according to one hero's sampled outcome.
Use a declared index-consumption predicate combined with adjacent-region index dependence,
not a test of whether one sampled refraction actually bends. Derive `usesRegionIndex(mat)`
from the model's declared index-role, region-table row (the schema declares what it reads),
with one planner helper. Current consumers are dielectric and rough_dielectric. Do not infer
consumption from the mere presence of an authored IOR, proximity to a dispersive region, or a
material-name list. If a future model reads index without such a row, extend the declaration
contract explicitly rather than guessing from `transmission`.
The review must check roulette, media proposals, light selection and every affected event site.

### 6.2 Ordering in the generated walk

At a surface:

1. Resolve wavelength-preserving data needed to score arrival emission.
2. Score emitter-hit radiance using arrival throughput, settling the previous technique.
3. Apply the existing event-budget check. A final emission-only vertex does not collapse.
4. Collapse once only if `usesRegionIndex(material_of(hit.region_owner))` and at least one
   of `hit.region_from` / `hit.region_to` has a wavelength-dependent index form. A mirror or
   Lambert boundary that does not read those indices leaves the packet intact.
5. Evaluate/sample scattering and direct lighting consistently at the hero. NEE must see
   collapsed throughput before evaluating a rough dispersive BSDF, not only before sampling it.
6. Record the continuation PDF/delta status, update medium/eta state, apply roulette as today,
   and spawn the continuation with the same wavelength carrier.

Resolved spectral properties may be reused across the collapse because the carrier did not
change. Index evaluation is scalar at the hero; no pre-collapse sampling decision may use it.
The conservative first implementation collapses reflection and transmission at smooth and
rough index-consuming dispersive interfaces. This does not include index-independent mirror
reflection. Delaying collapse until a dielectric chooses refraction is separate estimator work.

For dispersive GRIN, collapse **before the first interior wavelength-dependent advance**,
including cameras starting inside the region, and before any source/scattering contribution
from that bent segment is sampled. Placing it only on an entry surface misses those cameras.
Null interfaces can preserve the packet on crossing; the next medium-dispatch site performs
the collapse before bending. Respect existing GRIN event-budget, opaque-connection policy,
eta accounting and exit handoff. Do not re-derive its radiometric factor while adding lambda.

State-machine examples required in review: air→glass→air; two glass objects; repeated internal
reflection; chromatic fog→rough glass with NEE; emission before glass; camera inside dispersive
GRIN; GRIN scatter followed by glass. For each, mark first collapse, contribution scoring,
sampling densities, camera-lane identity and the next carrier.

## 7. Implementation sequence and exit gates

Commit boundaries below are proposed review units, not permission to leave broken intermediate
states. If a signature change requires simultaneous callers, keep that closure in one commit.
Each stage updates its status and measured results here, the affected family contracts and
CHANGELOG. Retire superseded assertions in the design rather than layering conflicting notes.

### P0 — freeze the contracts and establish the baseline

Resolve the decision table and reviewer objections. Confirm all accepted authoring forms and
the camera constructor choice. Record current typecheck/unit/static-compile status, relevant
GPU witness baselines, the native glslang path if needed and known failures. Capture the
compiled digest before edits. Include constant blackbody fixtures in each currently accepted
consumer, since the main scene suite does not cover all those paths.

Artifacts: accepted interface sketches; shader/data baseline; scene/strategy test matrix;
review disposition explaining what changed and which evidence resolved each correctness item.
No spectral asset generation or large implementation begins before its assumptions are clear.

### S0a — colour family and explicit film boundary, RGB only

**Implemented foundation:** the colour types/registry, RGB film boundary and generic spectrum
operations are built. RGB still uses the ideal sensor's response. The cleanup passed
typecheck/build and all 2707 tests. `npm run witness:color` now provides the repeatable
N=2,3,4 and sensor-response gate: 14 GPU cases passed, with three deliberate defects rejected.
The earlier 6 targeted scene checks and five before/after RGB comparisons are recorded in
the Sep 26 changelog. This does not complete S0 or enable spectral mode.

Add `src/components/color/` with its contract, registry and RGB occupant. Move Spectrum/Radiance
aliases out of core structs into the model type block. Introduce the explicit film projection
in every accumulator. The projection calls the sensor, which owns the measurement response;
RGB programs retain `ideal`. Display and export still see the same RGB pixels.
For this intermediate RGB-only commit, the camera sample is an initialized local placeholder
used by projection; the existing geometric `Ray` remains until S0b attaches the carrier.

Value-conversion dispatch is scheduled with S0b's real wavelength context, and shared
form/predicate ownership with S0c's authored-form preservation. This avoids a provisional
conversion API that would immediately need new arguments. The existing RGB/blackbody binding
path is unchanged in S0a.

Create N-generic spectrum helpers. For average, retain sum-then-scale ordering, including the
same RGB reciprocal literal; do not replace it with per-component scaling in a dot product.
Change both analytic and GRIN channel picks to the declared channel count. Read all remaining
`.x/.y/.z`, constructor and reduction uses on radiometric data; mechanical searching alone
cannot distinguish geometric vectors from spectra.

Gate: existing scene static compilation and appropriate numeric checks pass; RGB shader changes
are explained by category; random draws and RGB computations are preserved. No spectral
strategy is publicly accepted yet. Sensor and camera-contract changes are recorded as proposed
interfaces becoming implemented, not historical claims that they always existed.

### S0b — carry wavelengths through rays and resolution (implemented)

Implement the sampled-carrier camera input in §3, placeholders and camera-sample split. Update
all transport, intersection, camera, shadow, property, light, environment, index and GRIN
call chains together as required. Add the carrier to generated property structs once, outside
individual material schemas; ensure defaults/fallbacks are initialized. Do not add collapse
behavior or extra RGB random draws.
Route constant and runtime radiometric binding through model-owned conversion with the
explicit carrier, retaining the existing RGB arithmetic and blackbody calculation.

Gate: every registered camera and intersection backend compiles; generated exact-linkage
prototypes match definitions; targeted RGB pixels match baseline at fixed salts; carrier
probes verify actual propagation at distinct nonuniform test wavelengths. A constant or empty
RGB placeholder cannot detect a lost carrier, so use a test-only carrier with visible values.

Implementation evidence: `npm run witness:wavelengths` exercises 30 numerical carrier cases
and rejects ten compiled defects. The full static suite passes; five fixed-salt RGB renders
match the S0a foundation exactly, and the targeted medium/GRIN scene checks pass. See the
Sep 26 S0b changelog entry for the precise coverage; this does not satisfy the broader S0 exit
matrix or measure a physical four-wavelength model's cost.

### S0c — complete authored-data preservation and enforcement

Complete scene-once step 4 under §4.3, retaining RGB blackbody output and shared bytes where
the existing reader set is unchanged. The scene plan now preserves blackbody forms even
though RGB evaluation folds them later. Fix every previously implicit array/predicate consumer.
The colour family owns the shared authored-form predicates and projections.
Keep role validation changes that would reject formerly accepted inputs out of the no-change
claim; schedule those as explicit S1 validation changes.

Add the two-channel canary with defined conversions: for example lift RGB to `.rg` and project
two channels to `(x,y,0)`. It is a test utility, not a physically meaningful colour model or
a public strategy. Test reductions and channel selection numerically at N=2,3,4. Apply the
whole-suite canary compile to the RGB-era fixtures without wavelength-specific authored forms.

S0 exit: typecheck and full unit/static suite; digest reviewed for expected text only and
unchanged numerical uniforms/data; targeted fixed-salt GPU identity spanning cameras, surfaces,
media, GRIN, instancing, shadows, trees, sky, accumulators and tiling. Investigate differences
rather than widening a tolerance automatically. Bitwise matching on tested devices is an
empirical gate, not a universal claim about every driver's optimizer.

S0c evidence (Sep 27): 26 preservation/equivalence/order/live-binding tests; all 377 static
shader cases under both RGB and the RG canary; 203 scene digests exactly unchanged. Nineteen
fixed-salt SwiftShader renders match the S0b baseline at 32×24, 16 spp (oneshot: one sample),
including all six cameras, media/GRIN, instanced tree lights, medium shadows, procedural sky,
three accumulators, and six blackbody binding sites. All six cameras match tiled versus whole
HDR/PNG at 96×80, four spp, four tiles. Colour probes: 17 cases / five rejected mutations;
carrier probes: 30 cases / ten rejected mutations. These are targeted comparisons, not a full
high-sample witness sweep. See the changelog for the zero-scale sky classification correction.

### S1a — spectral data, sampling and film on controlled fixtures

Generate/load the versioned assets and implement spectral types, uniform/visible wavelength
sampling, CMF/D65 evaluation and pixel projection. Fit/generate the coefficient table offline;
implement its matching CPU/GPU lookup and role-specific evaluations. A visible sampler belongs
to estimator configuration and export stamps; measurement records the spectral model.

Develop first on constant grey, one coloured surface and direct-emitter fixtures. Exercise
four genuinely different wavelengths and per-slot PDFs. Keep unsupported scene combinations
behind validation until the remaining S1 stages land. No global early enablement followed by
silent approximations for media or non-RGB forms.

Gate: actual GPU lookup/sampling/projection tests in §8 pass, including negative projected
channels, and asset missing/load/context-restore behavior works. Validate runtime resources in
the Vite production build as well as dev. Record CPU generation cost, download size, padded
GPU allocation, sampler roster and runtime lookup cost; do not claim an optimization is free.

Implemented foundation: four-lane Jakob–Hanika lift; uniform and normalized visible
proposals; signed film integration through the selected CIE 1931 sensor; immutable,
checksummed built-in textures; resolved sensor, proposal and model version in exports.
The compiler currently admits only constant RGB Lambert albedo in [0,1], constant
nonnegative RGB emission/skies, and no media, instancing or light tree. It rejects
unverified inputs. The proposed gain extension has not been implemented or accepted.
Constants currently use the shader table lookup; CPU coefficient precomputation remains
an optimization for S1b, not a completed path.

Asset evidence: 12,587,008 bytes for two RGBA32F textures; 1,367-colour serialized-table
quadrature measured RMS 0.0005581 and maximum channel error 0.013779. Half-step
quadrature discrepancy was 2.30e-9. GPU lookup error against CPU evaluation was at most
9.64e-7. Uniform/visible sampling and signed, unequal-PDF film probes pass; deliberately
using one PDF, dropping a lane or clamping samples is detected. Twelve transport checks
cover direct emission, grey/coloured furnaces and PT/NEE/MIS on a coloured plane. Thirty
additional 32², 128-spp frames across salts 71, 173 and 907 pass a predeclared 0.008
channel tolerance; maximum error is 0.005109, with all channel means within 1.58
estimated standard errors of the reference. Dev
and production asset loading/context restoration reproduce the same fixed-salt pixels.
The existing 203 synchronous RGB scene digests remain exactly unchanged; the seven async
scenes are outside that digest tool. No complete high-sample witness sweep was run here.

`benchmark:spectral` records lookup versus precomputed polynomial cost on the same
four-lane output. The available SwiftShader backend has no timer-query extension;
its wall times are not native GPU timings. Native hardware lookup and the heavy-scene
ray-carriage performance audit remain outstanding. See the model README for reproducible
commands, layout, license and source provenance.

### S1b — complete all RGB-authored radiometric read paths

Lift constants, live uniforms, expressions, attributes, ordinary/instanced light rows and all
environment paths. Implement authored clamps and model-aware majorants, including live updates,
main/shadow consistency, volume emission and GRIN carrier/index plumbing. Implement the first
constant non-RGB form references needed for blackbody tree leaves.

**Implemented subset (Sep 27):** constant-RGB packed light rows and instancing, including
nested RGB, scalar-broadcast and packed float32 attributes. The existing generated readers
already lift RGB at the supplied wavelengths; they are now admitted by validation after
numeric checks. Attribute domains use the descriptor's radiometric role. Shared authored
bytes and renderer outputs agree under mixed RGB/spectral compilation and reordered
strategies. The full scene checks compare packed attributes to individual materials,
light rows to inline lights, and NEE to MIS. Generated-reader probes separately test all
four lanes and reject a dropped instance index. Live RGB uniforms are also enabled for
material reflectance/emission, authored lights and constant-type skies. All six existing
surface models are admitted after fixed-wavelength BSDF and rendered-scene checks;
radiometric validation uses descriptor roles rather than material/property names.
Glass still uses a wavelength-independent scalar IOR, with the existing opaque shadow
policy. No packet collapse, BSDF rewrite or transport change was needed. Defaults and declared
slider bounds are checked at compilation; runtime writes retain the same author contract.
`setParameter` does not enforce UI ranges or clamp the lift. Repeated live updates and
session restoration are compared to constant renders, including changes to the selection
CDF and sky/finite split. Expressions remain validation-gated; spectral media bounds,
non-RGB form codes and CPU constant precomputation remain unimplemented. Reflectance inputs above
one still have a diagnostic while the proposed gain policy is unresolved.

Add role-aware validation: finite nonnegative coefficients/emission, the proposed extended
reflectance domain in §4.2, positive indices, form/role compatibility, and defined runtime
behavior at parameter bounds. Under the proposed gain policy, inputs above one are supported
through the declared lift, not rejected or clamped; negative/nonfinite inputs are outside it.
For arbitrary runtime expressions whose domain cannot be proven, state the author contract and
the explicit enforcement/diagnostic policy; this is not solved by the `role` field alone.
An RGB scene with an unphysical legacy input may need a clear spectral diagnostic rather than
the blanket promise that every accepted legacy scene renders spectrally unchanged.

Gate: all supported estimator/media combinations compile and pass their spectral witnesses;
mixed-renderer scene-data order tests pass. Test constant values and live/row versions of the
same values against one another, not merely against duplicate CPU formulas.
Tracking stays gated until §5.2's finite-precision certificate and GPU probes pass. Land
§4.5's environment support/density correction separately from the RGB-preserving refactor,
with its own before/after evidence; an inherited RGB bug is not a spectral acceptance target.

### S1c — blackbody migration and public spectral release

Replace Kim RGB projection with the shared Planck definition after explicit acceptance of D5.
Cover constant/driven temperatures and scales, zero scale, the temperature domain, tree rows,
instanced emitters and skies wherever those forms are currently accepted. Report the actual
old/new RGB differences; there is no assumed sub-percent bound.

Enable `measurement.color: 'spectral'` for the verified capability set. Export stamps include
resolved colour/sampling settings and asset/model version identifiers. Explain signed linear
RGB and RGBE clipping in output documentation; do not clamp transport samples before averaging.
Run the existing RGB suite plus the spectral matrix, production build and full numeric gate
under the repository's established witness policy. Record standing failures separately, without
claiming a partially run sweep passed. Release criteria are §8 and §10, not attractive images.

### S2a — explicit spectrum and index authoring

Begin with grey/RGB/blackbody already supported, then named/tabulated spectra and Cauchy,
Sellmeier or Abbe index forms. Specify units per form (carrier nm; catalogue formulas may use
micrometres), interpolation, domain and extrapolation/rejection. Validate pole-free positive
indices across the supported interval, not only at the sampled wavelengths. Each named dataset
records provenance and validity limits. RGB index evaluation uses the specified reference line.

Define the RGB projection for each allowed form/role explicitly; reflectance uses the white
illuminant convention, emission uses radiance projection, and coefficients require a declared
preview convention rather than an implicit claim that projecting extinction preserves Beer
attenuation. A sampled narrow-band emitter must keep its integrated energy under refinement.
Do not resample every form at 5 nm regardless of spectral bandwidth.

**Proposed D6 scope:** defer arbitrary wavelength GLSL in the first S2 release. Reject it with
a precise diagnostic rather than pretend a fixed small quadrature is generally accurate.
RGB expressions already supported continue to work. A later expression stage needs units,
vectorization rules, integration error/truncation policy and coefficient/index bounds. If
review chooses to include it now, specify those items and add it as an explicit stage before
claiming S2 completion; do not quietly expand the parser project during dispersion work.

### S2b — dispersion and its estimator proof

Plan wavelength-dependence facts from authored index forms, including adjacent-region indices
and medium indices, combined with the material's declared use of region index; do not
recognize a glass by a material name. Implement the generated
one-time helper and the ordering in §6, extending index accessors through both surface and
GRIN paths. Keep opaque dielectric shadow policy and existing technique eligibility unchanged.

Gate: first/second-collapse tests, pre-collapse emission, chromatic-media-before-glass, rough
glass NEE/MIS, oblique direction checks and camera-inside-GRIN all pass. Compare packet rendering
to an independent one-wavelength reference for the same finite-bounce measurement. Require an
explicit derivation or counterexample review for pre-collapse symmetry across the supported
samplers; a passing grey furnace alone cannot establish this.

## 8. Verification with independent targets

### 8.1 Four layers of evidence

1. **Structural:** typecheck, exact-linkage, generated shader compilation, data/strategy order,
   capability rejection and sampler/resource limits. A compile proves type compatibility only.
2. **CPU mathematics:** reference quadrature, sampler normalization, conditional-density
   calculations, closed-form bounds and finite-bounce expected values. Use independently
   expressed formulas where possible; label TS twins as implementation comparisons.
3. **Actual GPU primitives:** execute the shipped GLSL lookup, CMF projection, channel helpers
   and selected volume-arm behavior in small numeric probes using the witness infrastructure.
   A TypeScript transcription does not verify shader execution.
4. **End-to-end transport:** the scenarios below, read from signed float buffers before display
   or HDR export. Test legal strategy pairs at the same measurement and bounce/null budgets.

Record expected values/tolerances before observing the implementation's answer. For stochastic
checks, use fixed multiple salts, independent reference error bounds and adequate sample counts;
report confidence intervals and systematic offsets. RGB versus spectral are different
measurements except in explicitly derived special cases. Convergence comparisons must not
silently demand equality of arbitrary coloured RGB and spectral scenes.

### 8.2 Required scenarios

| ID | Measurement/reference | Failure exposed |
|---|---|---|
| R0 | Existing targeted RGB renders at fixed salt, before/after S0 | Extra draws, rounding/order changes, changed scene meaning |
| R1 | Known four distinct carrier values through every ray-construction/arrival route | Lost/defaulted wavelengths, local-transform corruption |
| R2 | N=2,3,4 reductions; random channel frequencies; four different wavelength PDFs | Hard-coded three channels, common-PDF film division |
| C1 | Direct grey D65 emitter, and a grey finite furnace | Film normalization, emission lift, wavelength sampling |
| C2 | Coloured finite furnace: integrate `Le(lambda)*sum(rho(lambda)^k, k=0..N)` | Multi-bounce spectral products; correct bounce truncation |
| C3 | Unoccluded Lambert plane with albedo c, unit D65 environment, `maxBounces: 1`: reference `P_rho(Ub(c))` | Reflectance round trip against independent quadrature of the actual lift |
| C4 | Same radiometric value as constant, live uniform, attribute, light row and emitter hit | Missing/different conversion at a binding site |
| C5 | PT/NEE/MIS and uniform/visible wavelength pairs where supported | Technique weighting, sampling-density normalization/support |
| C6 | Grey procedural sky with detail finer than its bake, evaluated at fixed directions and through miss/NEE paths | Accidental radiance fetch from sampling-only bake |
| C7 | Grey and coloured reflectance above one, all binding sites, live sweep across maxRGB=1, finite-bounce reference | Clamping/rejection, threshold discontinuity, inconsistent gain lifts |
| C8 | Equal-area procedural cap missed by its bake; HDR positive texels lost by float32 CDFs; uniform compensated sky under MIS | Missing NEE support, wrong empty-table policy, component-only mixture PDF |
| C9 | Integrate environment PDF over solid angle independently; compare sample histograms with predicted mass for both charts at coarse resolution | Shared sample/evaluate PDF error, wrong within-cell Jacobian |
| M1 | Pure absorbing slab: quadrature of `L_in(lambda)*exp(-sigma_a(lambda)*d)` | Spectral coefficients and shadow/main consistency |
| M2 | Actual analytic-arm probe: score only survival, whose expected weighted lanes are `exp(-sigma_t*d)` | Four-channel mixture PDFs without contamination from scattered radiance |
| M3 | Bounded expression field with saturation; hold one wavelength fixed while changing its companions; constant/driven twins; emitted volume source | Packet-dependent field clamp, live majorant, emission scaling |
| M4 | Spectral delta tracking and non-dispersive GRIN under existing legal strategies | Four-channel probabilities, carrier at interior/exit sites |
| B1 | Fixed-wavelength original-form probes plus Planck illuminating a spectrally selective receiver via tree and emitter-hit routes | Loss of original form hidden by RGB metamerism, blackbody normalization, non-RGB tree branches |
| D1 | Lossless normal slab, unit tint, equal exterior indices, dark camera-side exterior, lit far side, `maxBounces: 2`: integrate `(1-F(lambda))^2*L_in(lambda)` | Exactly two transmissions, eta cancellation, repeated collapse |
| D2 | Same slab, higher finite N: integrate `(1-F)^2*sum(F^(2j), j=0..floor((N-2)/2))*L_in` | Internal reflections, bounce counting, multiple revisits |
| D3 | Oblique planar refraction/prism compared with Snell-law direction references at fixed wavelengths | Wavelength-dependent direction; normal-incidence tests cannot detect it |
| D4 | Known contribution before glass plus contribution after glass | Earlier emission preserved; only future throughput collapsed |
| D5 | Chromatic medium then smooth/rough dispersive interface; compare to scalar-wavelength reference | Pre-collapse sampling bias and collapse-before-NEE ordering |
| D6 | Dispersive GRIN with camera both outside and inside; fixed-lambda ray/weight reference | Entry-only collapse omission, gradients, handoff/eta bookkeeping |
| D7 | Index-independent mirror/Lambert boundary adjoining a dispersive region: inspect the flag when emitted and all packet lanes | Over-broad collapse predicate; an unbiased image alone would miss the lost lanes |
| O1 | Signed/out-of-gamut samples through average, variance and oneshot; tiled/untiled render at same salt | Early clamping, accumulator inconsistency, sample-coordinate errors |
| O2 | RGB+spectral permutations, resource load failure, renderer switching and context restoration | Shared-data dependence and resource lifecycle failures |

For C1's furnace use the finite sum: with albedo 0.5 and emission 0.2, the exact N-bounce
value is `0.4*(1-0.5^(N+1))`, not exactly 0.4. C2 can have much larger truncation error when
a lifted reflectance approaches one; use a stable finite summation including the rho=1 limit.
For D1/D2, verify light placement and angular support so no other paths contribute. Neither
formula describes a coherent thin film, absorption, interface tint or unequal exterior indices.

M2 is deliberately a GPU arm probe: an absorbing-only scene using a direct Beer formula does
not exercise stochastic channel selection. M3 must verify that its fixed lane's coefficient
does not change with companion wavelengths; an image of a grey medium cannot expose a
packet-dependent clamp. D7 must inspect the collapse state/lanes because unnecessary collapse
can leave the image expectation correct while increasing variance.

For C8, use an 8x8 equal-area octahedral bake and a unit grey D65 cap with angular radius
delta=0.1 radians about +Y. Every texel center misses this cap; verify that property explicitly
against the chart. An unobstructed Lambert plane facing +Y with albedo rho and one scattering
event has expected output `rho*sin(delta)^2` in each linear-sRGB channel. For rho=0.5 this is
about 0.00498335554, while the present black-table NEE route contributes zero. Separately
build an 8x8 HDR table with grey 1e-10 everywhere and grey 1e10 in the first texel. Its tiny
positive masses can disappear on storage even with the default blur; inspect the actual CDF
differences, then test the uniform component at those directions. This numeric support probe
does not need an image tolerance capable of seeing a 1e-20 radiance ratio. The compensated
uniform-sky case checks MIS's competing route, not the uncompensated fallback.

C9 must include a coarse equirect grid: at H=8 the current evaluated density integrates to
about 0.99358685 in exact arithmetic. Compare solid-angle quadrature and subcell distributions,
not just texel frequencies or sample/evaluate agreement. Check mixture density after the
chart correction as well as the unmixed table density.

B1's light-tree case needs actual direct-light sampling; merely viewing an emitter directly
does not read its sampled-light row. Direct viewing or a grey receiver can also pass after
Planck has been projected to RGB and incorrectly lifted back: the replacement is approximately
metameric. Require a fixed-wavelength GPU probe against independently evaluated Planck and
a receiver whose spectral response separates `B(lambda,T)` from `U(P(B))(lambda)`. Choose
a coloured bounded RGB reflectance in S1, and a tabulated bandpass in S2. Compute the expected
separation before accepting the fixture and require it to exceed the combined reference and
sampling tolerance. Use this fixture on both ordinary rows and constant-form batch arms.

### 8.3 Deliberate breakages

Before accepting a gate, demonstrate that its relevant check fails when the following defect
is temporarily introduced, then restore the correct code. These are targeted checks, not
permanent alternative implementations:

- Drop the carrier at a medium continuation, shadow null crossing, GRIN handoff or local ray.
- Ignore the fourth channel; divide film lanes by the hero PDF; consume a random draw in RGB.
- Bypass the spectral lift on a table/sky read; discard a blackbody form ID.
- Disable the independent environment-support component; evaluate only the selected component
  PDF; use the old equirect midpoint area or UV subcell sampler with the new area.
- Apply the medium ceiling to the sampled packet; keep a stale majorant after a slider update.
- Multiply by four at both slab interfaces; erase pre-collapse radiance; collapse after rough
  surface NEE; omit collapse for a camera starting in dispersive GRIN.
- Sample the hero's free-flight distribution but keep the four-channel mixture weight in the
  dedicated toy/reference check. Do not label that mutation a reproduction of another renderer.

### 8.4 Measure ray-carrier overhead separately from spectral arithmetic

Benchmark cacti, forest and bazaar with fixed scene, camera, resolution, sample count, seed,
shader warm-up and accumulation policy. Record GPU/browser/backend, timing method, repeated
runs and variability. Use the existing scene benchmark facilities; CPU frame timing alone
must not be labelled shader execution time. Exercise native hardware and ANGLE/D3D where
available; report untested backends as untested.

Use a temporary experimental comparison in which traversal rays carry versus omit the vec4,
while spectral values, lookup inputs, random stream and rendered result stay identical. The
comparison may pass the carrier separately around geometry-only traversal; it is not a second
production API. Verify matching outputs first, then report traversal and total-render timing.
Also report end-to-end RGB versus spectral costs, clearly separating that larger comparison
from field overhead. If the optimizer removes the field, report the measured absence of cost
on that backend rather than a universal guarantee. No unsupported overhead threshold is set
before the benchmark; investigate material regressions before declaring S1 complete.

### 8.5 Commands and artifacts

Use the repository commands, substituting witness IDs registered during implementation:

```sh
npm run digest -- /tmp/spectral-before.json
npx tsc --noEmit
npx vitest run
npm run build
npm run dump:shaders -- --scene <scene-module>
npm run witness:color
npm run witness -- <registered-witness-id>
npm run digest -- /tmp/spectral-after.json
npm run digest -- --compare /tmp/spectral-before.json /tmp/spectral-after.json
```

S0 is not a byte-identical shader refactor: types/signatures/film text change. Review digest
differences by kind and verify numerical data separately; do not normalize away changed numeric
expressions. S1 intentionally changes blackbody RGB only in its migration stage. Retain run
logs, reference calculations, asset provenance and selected shader dumps in a documented
artifact location. Do not commit large generated dumps unless the repository convention asks
for them. `dump:shaders` replaces its output directory on each invocation, so copy any selected
baseline dumps before another run. The 45-minute witness sweep is never run concurrently with
another witness server.

## 9. Questions for the adversarial reviewer

Review this plan rather than defend the original design. For each objection, give the violated
contract or a concrete counterexample, severity, smallest correction and a test capable of
failing. Distinguish established errors from hypotheses and preferences. Trace at least one
complete generated program for a surface-only scene and one for scattering/GRIN.

1. Does passing sampled wavelengths through the three camera callers preserve RGB draw order
   and enable wavelength-dependent camera geometry? Does the probe actually fail if wl is
   ignored? Keep the future camera weight/collapse result explicitly deferred.
2. Can any whole-Hit assignment lose `wl`? Can any material, shadow, medium, alternate emitter
   or environment read evaluate at a different carrier from its multiplying throughput?
3. Is pre-collapse symmetry sufficient for every supported proposal, including history-dependent
   delta tracking and roulette? Identify an actual asymmetric decision or missing density term.
4. Is emission/NEE/collapse ordering correct at rough glass, nested regions, null boundaries,
   cameras in GRIN and max-bounce vertices? Are repeated collapses impossible by construction?
5. Are the declared bounds valid over all wavelengths and allowed live values in float32?
   Challenge both the analytic bound and the numerical allowance. Does emission follow the
   existing authored clamp convention in every arm?
6. Are all authored forms preserved through ordinary and instanced light-tree storage? Does
   the proposed named header field have one layout owner and deterministic scene form IDs?
7. Is the sampling support adequate for every supported emitter/sky and estimator, including
   out-of-gamut spectral projection and compensated environment proposals?
8. Can the App load/restore the exact model assets through existing external texture references
   without a new scene interpretation or a locked compiler–engine contract change?
9. Which stated test would pass a wrong implementation? In particular challenge C3's lighting
   normalization, the finite-bounce slab/furnace references, M2's execution path, and B1's actual
   use of the tree. Require a deliberately failing version for each new correctness gate.
10. Which accepted legacy scenes become unsupported, and is the change explicit? Are D5/D6
    migrations and the proposed S2 scope acceptable, or does a needed authoring form lack a stage?
11. Does any stage mix a no-change refactor with a physical-model change? Is a proposed interface
    change being smuggled in as already approved? Identify the exact boundary to separate.

Reviewer deliverable: blocking findings first, then nonblocking issues, then explicit answers
to the unresolved decisions. A general endorsement or list of stylistic preferences is not a
substitute for estimator and code-path scrutiny. No renderer implementation is requested during
the adversarial review.

## 10. Definition of completion

S0 is complete only with its RGB identity evidence and preserved authored forms. S1 is complete
only when every advertised existing capability has spectral validation, actual GPU conversion
coverage, mixed-renderer data independence, asset lifecycle support and recorded numeric gates.
S2 is complete only for an explicitly declared authoring set and independently verified
dispersion/collapse behavior. Deferred wavelength GLSL must remain listed as deferred if the
narrower scope is adopted; do not report the entire original design as built.

The final implementation report must say what was built, exact commands/results, measured
conversion error and performance, accepted appearance changes, remaining unsupported cases and
standing test failures. Matching images alone, clean static compilation alone, and TypeScript
twins alone are each insufficient evidence of correct spectral transport.

## 11. Review (Claude, Sep 26 2026)

**Disposition of this review:** the main plan now adopts the sampled-wavelength camera input
(R-1), corrects procedural radiance (R-2), restricts surface collapse to index consumers (R-3),
clarifies built-in resource provenance (R-4), and adds carrier-overhead benchmarks (R-5).
R-6 now has a concrete proposed scaled bounded extension in §4.2, still subject to acceptance.
The original findings below are retained as the review record of the earlier draft. They do
not override the revised sections. §12 records subsequent investigation of the unchecked
areas; its CPU/code evidence is distinct from the remaining implementation and GPU gates.

Everything below was checked against the code at `1ed553b` (file:line given) or in shaders
dumped with `npm run dump:shaders -- cornell` and `-- grin`. Items I did not examine are listed
as such.

### Needs a decision before S0b

**R-1. The camera interface should let a camera see the wavelengths.** Severity: medium, a
contract choice rather than a bug.
- **What §3.2 proposes.** `RayGeometry camera_generateRay(...)` makes every camera
  wavelength-blind.
- **Why that conflicts.** The shelved realistic camera names the spectral axis as its
  re-trigger. Its payoff is chromatic aberration, "a data-only rider once spectral lands
  (dispersion coefficients per glass in the same table)" (impl-plan-realistic-camera.md:3-5,
  :34-35). A dispersive lens bends the primary ray per wavelength, inside
  `camera_generateRay`. Under `RayGeometry` that needs a second camera-contract change.
- **Smallest correction:** §3.2's own alternative, `Ray camera_generateRay(vec2 film,
  vec2 xiLens, Wavelengths wl)`.
  - The camera receives the already-sampled carrier (not a random dimension), and every
    camera builds its ray with `make_ray(o, d, wl)`.
  - No second struct or constructor is needed.
  - A future dispersive lens is then a camera-side chromatic event: collapse before transport,
    with an empty pre-collapse history.
- **What it costs.** Both routes amend a contract. This one amends the camera README's
  "Category B … NOT generateRay arguments" (camera/README.md:38-45), whose stated reason is
  about random dimensions, not sampled values.
- **Tests either way:** update tests/components/cameraContract.test.ts:11, which pins
  `Ray camera_generateRay(vec2, vec2)` by regex. Add a probe camera that encodes `wl` into its
  direction, so a dropped carrier fails R1.
- **What would change this:** a decision that lens dispersion is permanently out of scope.

### Nonblocking

**R-2. §4.2 misdescribes the procedural sky.** Its radiance is the author's formula evaluated
per direction (environment.ts:211). The baked texture only feeds the importance tables
(`EnvironmentBake.ts`). The table row "Sky image or baked RGB procedural sky → authored RGB
texels" could lead to lifting the bake.
- **Correction:** the procedural sky belongs to the "RGB expression" row: lift the formula's
  value at the direction.
- **Test:** a procedural sky with detail finer than the bake's resolution, where spectral and
  RGB must agree on a grey formula at that detail.

**R-3. State the collapse predicate precisely** (§6.1–6.2, S2b). "The participating interface
has a wavelength-dependent index" should read: the material at the hit consumes the region
index, and at least one adjacent region's index form depends on λ.
- The models that consume the index are the dielectrics (dielectric.ts:14, the `ior`
  region-table row), plus the walk's transmission `eta_scale`.
- Otherwise a mirror or Lambert surface bounding dispersive glass would collapse. That is
  unbiased, but throws away three wavelengths.
- **Test:** a probe showing the flag stays unset after a mirror hit on a dispersive region's
  boundary.

**R-4. The external-texture contract needs a sentence.** Contracts §2.10 (3) says every
`extern:` traces to a scene declaration, but model assets do not.
- The code does not enforce that rule: a search of analyze/ and plan/ finds only
  `extern:blue_noise` (Planner.ts:716).
- `blue_noise` is already a scene-independent exception (engine/loaders/blueNoise.ts:2-4).
- Name model assets as the second exception in the contracts doc.

**R-5. Measure the carrier's cost on traversal.** In spectral programs every `Ray` carries a
`vec4` through the intersection functions. S1a records lookup cost but not this.
- Add a bench comparison on the heaviest scenes (cacti, forest, bazaar), with and without the
  field.
- *Prediction:* small, because most intersection functions inline. That is unmeasured,
  especially on ANGLE/D3D.

**R-6. Unphysical legacy reflectances need a decision.** The taxonomy explicitly admits
non-physical T (§9: "nothing in the interaction contract requires reciprocity or energy
conservation"), and no range check exists on albedo, f0 or transmittance. U_b cannot represent
values above 1. S1b's "reflectance input domain" validation therefore needs the owner's
choice: reject such values in spectral programs, or lift them with the unbounded rule and
declare it.

### Answers to §9 (what was checked)

- **Q1 (camera callers).** Only the three accumulators call `camera_generateRay` and
  `transport_trace`: average.glsl:14, variance.glsl:18, oneshot.glsl:20. The camera feature
  provides the seam (camera.ts:107), accumulation requires it (accumulation.ts:41), and a
  contract test pins its signature (cameraContract.test.ts:11). There are no debug or probe
  renderers (search over src, pages, tools, demos, tests).
- **Q2 (Hit).** Exactly two `Hit` variables exist in all GLSL and generated code: the walk's
  (pt.ts:296) and the shadow walk's (media.glsl:44). Both are filled by `scene_intersect`, and
  no whole-record assignment exists. In both traced programs every lookup reads the carrier of
  the ray or hit whose throughput it multiplies.
- **Q3 (pre-collapse symmetry).** Every λ-dependent decision found is symmetric in the lanes:
  - analytic/GRIN channel pick (analytic.glsl:12, grin.glsl:308, uniform);
  - delta-tracking probabilities (averages, delta_tracking.glsl:87-89);
  - ratio-tracking and interior roulette (`spectrum_max`);
  - phase pdfs (`spectrum_average`).

  Light selection, sky importance and non-dispersive BSDF sampling do not depend on λ. This
  is an inventory of the present code, not a proof for future samplers.
- **Q8 (assets).** Yes. `Engine.registerDataTexture` is RGBA32F, NEAREST, texelFetch-ready
  (Engine.ts:441-444), which matches manual interpolation. §4.4's 12.6 MB padded size follows.
- **Traces.**
  - Surface (pt-nee-cornell-area-glass): every carrier site is covered by §3's rules. That
    means the material and emitter-material lookups, the miss sky, `light_get_0` with its
    literal radiance, the shadow ray via `ray_spawn`, the dielectric's two `ior_of` calls and
    the walk's `eta_scale`.
  - GRIN (pt-grin-glass): a camera inside the medium reaches the medium dispatch first, where
    §6.2 places the collapse. The index chain `grin_force` → `grin_grad_n` → `grin_n` →
    `ior_at` reads the arm's ray; the handoff is one of the four explicit `make_ray` sites;
    `scene_region_at` needs no carrier.
- **Not examined in depth:** Q5 (float32 bounds and allowance), Q6 (layout ownership of form
  IDs), Q7 (support under compensated sky proposals), Q9 (tests that would pass a wrong
  implementation), Q10 and Q11 beyond R-6.

## 12. Follow-up audit (Codex, Sep 26 2026)

This continues the unchecked portions of §11. Findings below came from source inspection,
analytic calculations and temporary CPU probes; no GPU spectral implementation exists yet.
The corrections live in the main plan so an implementer need not merge competing appendices.

| Review question | Finding and disposition | Evidence still required |
|---|---|---|
| Q5: float32 bounds | Real-arithmetic 4A is not a rounding proof. §5.2 starts with amplitude envelopes and lists the required error analysis. A CPU clamp overshoot is reproduced there. | Certificate for emitted arithmetic and input ranges; actual GPU boundary probes |
| Q6: form IDs/layout | `lights/table.ts` owns the ordinary header/stride; instanced leaves have a different route. §4.3 names header.y and scene registry ownership explicitly. | Review the proposed amendment; test bytes, mixed reader order and both light routes during implementation |
| Q7: sky support | Existing MIS-only compensation gate is necessary. Uncompensated bake/CDF support holes and an equirect density mismatch need separate fixes (§4.5). | GPU support, density and transport witnesses, including every supported BSDF/phase competitor |
| Q9: weak tests | Direct or grey-receiver blackbody images can pass a discarded-form implementation; sample/PDF self-agreement can pass a wrong distribution. §8 adds independent targets and mutations. | Demonstrate that each deliberately broken implementation fails its intended check |

**Current-code CPU evidence.** A temporary TypeScript probe called the actual
`buildEnvImportanceTable` in `src/components/env/importance.ts` through the installed
`vite-node`, with W=H=8, `chart: 'octahedral'` and the default blur. Cell mass was read from
the stored arrays as
`(marg[j]-marg[j-1])*(cond[j,i]-cond[j,i-1])`, with preceding entries zero at each axis's
start. Inputs and outputs were:

| Input RGB values | Compensation | Returned totalWeight | Sum of stored cell masses | Zero-mass cells |
|---|---|---:|---:|---:|
| All channels 1 | false | 64 | 1 | 0/64 |
| All channels 1 | true | 0 | 0 | 64/64 |
| All channels 0 (a missed procedural bake) | false | 0 | 0 | 64/64 |
| All channels 1e-10, first texel's channels 1e10 | false | 10000000064 | 1 | 60/64 |

The last input is a Float32Array; all authored texels are positive. The exact count depends
on these specified values and resolution. It establishes a concrete failure of the claim
that blur guarantees positive stored probability wherever radiance is positive. It does not
measure the image error or test a GPU. For the all-zero bake, §8's cap supplies a continuous
radiance formula whose missed contribution has an independent positive integral.

The support consequence follows through `sampler_cdf.glsl` (zero cell differences give zero
PDF), `transport/techniques/light/light.glsl` (nonpositive-PDF samples contribute nothing),
and the NEE combiner in `transport/combiner.ts` (non-delta misses are suppressed). The
compensated MIS case intentionally relies on the competing path and is a separate witness.
`compiler/analyze/Validator.ts` already rejects compensation outside MIS.

The equirect finding is analytical: `env/equirect/equirect.glsl` maps linear v to theta and
uses midpoint sine in `env_texel_dOmega`, while `env/sampler_cdf.glsl` samples each selected
cell uniformly in UV. Integrating its reported cell-constant density yields the factor in
§4.5. A corrected chart must change within-cell sampling and PDF together. The proposed
mixture alone would leave this density mismatch intact.

**Remaining scope.** This audit does not certify GPU behavior, the completed spectral asset,
all future non-RGB emitters' light-selection support, or the performance of a ray carrier.
Those remain their stated release gates. Owner choices including the gain extension and
blackbody migration remain proposals; this audit neither approves nor implements them.
