# Planck emission

`{ blackbody: { kelvin, scale? } }` authors one emission spectrum in both colour modes.
`kelvin` and `scale` may be constants or scalar parameters with defaults. Temperature and
all declared slider bounds must lie in **1000–40000 K**; scale and its declared bounds
must be finite and nonnegative. Live writes carry the same contract, as with other
radiometric parameters. There is no temperature clamp. Scale defaults to one when absent;
a parameter without a default is invalid. Magnitudes must remain finite in GPU float32.

Blackbody is an **emission form**. It is accepted on emitting surfaces, authored lights,
mesh and constant batch emitters, and constant-type skies. It is rejected on reflectance,
index and medium fields. Existing driven-emitter/tree restrictions still apply: this
feature does not introduce dynamic mesh/instance light-tree updates.

## Definition and ownership

With wavelengths in nm and temperature in K, the dimensionless relative Planck spectrum is

```
b(lambda,T) = (550/lambda)^5 * expm1(c2/(550*T)) / expm1(c2/(lambda*T))
c2 = h*c/k = 14387768.775039338 nm K
K(T) = integral_360^830(y_bar(lambda) * b(lambda,T) d_lambda) / cieYIntegral
E(lambda,T,scale) = scale * b(lambda,T) / K(T)
```

The reference uses the shipped float32 piecewise-linear CIE 1931 curves on 360–830 nm.
Its normalization is an authoring convention: reference **CIE Y equals `scale`**.
Changing temperature at fixed scale preserves this reference brightness while radiant
energy can change. The scale is in renderer-relative units, not lumens or electrical
watts; this is not absolute thermal-power authoring. The active camera sensor owns the
measurement response and does not participate in defining the source. Equal reference
Y does not promise equal perceived brightness or equal pixels after coloured reflection.
Planck has no D65 multiplier and does not pass through the RGB emission lift.

`blackbody.ts` integrates the reference projection on the CPU with 0.5 nm Simpson
quadrature within each 5 nm observer interval. The generated observer data belongs to
`sensor/cie1931/curves.ts`; `tools/spectral/generate.py` emits it from exactly the same
float32 CMFs as the GPU texture. The spectral math uses the relative spectrum above;
its arbitrary 550 nm reference cancels in normalization. RGB uses the signed projection
of this spectrum. Negative RGB is a gamut effect, not negative spectral emission.

`blackbody.glsl` evaluates four wavelengths, given temperature and CPU normalization.
On the supported domain, the exponential argument is between 0.433 and 39.966; neither
exponential overflow nor a near-zero `exp(x)-1` occurs. No small-x branch, artificial
floor, clamped temperature or fallback colour is needed.

Physics: [Planck law in PBRT](https://www.pbr-book.org/4ed/Radiometry%2C_Spectra%2C_and_Color/Light_Emission).
Constants: [NIST exact SI h, c and k](https://physics.nist.gov/cuu/Constants/Table/allascii.txt).
The [historical Planck comparison](../../../../../docs/claude-blackbody-comparison.md) records
the formula and temperature-range migration under the former maximum-RGB convention.
It does not define the current scale.

## Converting maximum-RGB strengths

For a source previously normalized by `M(T) = max(P_CIE[b])`, preserve its evaluated
spectrum at a chosen temperature using `newScale = oldScale * K(T) / M(T)`.
`P_CIE` is the fixed CIE 1931 → signed linear-sRGB projection. This conversion concerns
authored strengths only; runtime evaluation has a single reference-Y convention.

The blackbody gallery uses the following converted values. Its direct-emission and
selective-receiver numeric targets retain their previous values.

| Source | Temperature | Former scale | Reference-Y scale |
|---|---:|---:|---:|
| Direct emitter | 1000 K | 1 | 0.2174975862105915 |
| Receiver sky | 6500 K | 1 | 0.9586431216686195 |
| Warm quad | 2900 K | 14 | 7.687615923237919 |
| Changed quad | 1000 K | 8 | 1.739980689684732 |
| Cool point | 12000 K | 3 | 1.914207773915614 |
| Scene sky | 6500 K | 0.04 | 0.03834572486674478 |

The live quad's slider spans reference Y 0–22. Its default and the separate 1000 K
witness setting preserve their source spectra. Sweeping temperature while leaving the
slider alone now keeps Y constant; preserving the former temperature-dependent
brightness would be a different control.

## Constants, uniforms and packed data

The scene plan retains the authored form.

**Spectral programs** evaluate Planck's law at the wavelengths. A constant temperature folds its
normalization into a literal. A live temperature mints one uniform,
`vec2(temperature, normalization)`, that depends on the temperature slider only. Scale is a
separate literal or float uniform at every use, so two emitters sharing a temperature keep
independent brightnesses.

**RGB programs** show the blackbody by its RGB stand-in, `toRGB` (scale times the normalized
RGB of the temperature), as they show every named kind (`rgbStandIn`, color/values.ts):
- a constant value is a literal;
- a live one is one uniform the CPU recomputes from both sliders when either moves.

Hit and sampled-light readers use the same `emitSpectrum` path.

`ProgramDescription.blackbody` records whether the spectral program uses original Planck
forms, linking the static GLSL evaluator and the corresponding packed readers.
Ordinary light rows retain their RGB payload for RGB readers and CPU selection power.
The existing header is owned by `lights/table.ts`:

| Component | Meaning |
|---|---|
| x | Light kind code |
| y | Emission form: 0 = RGB payload; 1 = Planck |
| z | Planck temperature in K (zero for RGB) |
| w | `scale / K(T)` (zero for RGB) |

The tag identifies a representation, not an index into another registry. The first
non-RGB form fits entirely in the existing header; no form registry, new texture or
stride change is needed. Packing is independent of renderer order and colour mode.
Future forms must extend this declared representation rather than consume padding
implicitly. Instanced emitters use one original-form expression per batch; their
per-instance RGB attributes continue through the existing attribute path.

## Verification

`tests/helpers/planckReference.ts` evaluates SI Planck directly and integrates the serialized
GPU observer at 0.25 nm. Unit/compiler checks compare this independent reference, enforce
role/domain rules, inspect specified packed bytes, and compile all six binding sites under
both modes and power/tree selection. Mixed renderer orders and singleton compilation
preserve shared data.

`npm run witness:blackbody` executes real generated readers and the actual App packer.
It tests low/high temperatures, signed RGB, four spectral lanes, live temperature/scale,
shared controls, sky intensity and sampled instances. Deterministic integration of the
generated GPU reader checks reference Y at four temperatures. Deliberately discarded-form
and maximum-RGB-normalization mutations must fail. `spectral-blackbody-*` witnesses cover true 1000 K direct emission,
a selective receiver with an independently integrated target, live/constant comparisons,
and power/tree NEE/MIS equality. The old Kim fit exists only in the historical audit
helper; no renderer imports it.
