# One spectrum type

**Status:** approved by the owner, September 28, 2026 (Part 1 and the step order in §8).
Part 1 is the design; Part 2 is how the existing code gets there. Owner decisions so far: a single type
for every function of wavelength, index included; wavelength sampling from the lights deferred.
The earlier draft was checked by an independent reviewer; its findings are in Appendix B and
are all addressed below.

Facts are marked **Checked** (read or run by me), **Census** (from a census of every place a
color, spectrum, coefficient or index enters the renderer, spot-checked), **Reviewer** (verified
by the independent reviewer, including compiled scratch scenes) or **Source** (read in pbrt-v4 or
Mitsuba 3 source, Sep 28).

---

# Part 1: the design

## 1. A spectrum is a function of wavelength

A scene holds spectra: functions on 360–830 nm. There are several ways to produce one:

```ts
rgb(0.8, 0.2, 0.1)              // from an RGB color (a single number means gray)
blackbody(3200, 1.5)            // temperature in K, brightness
cauchy(1.5, 0.004)              // a glass's index formula
sellmeier(B, C), N_BK7          // another glass formula; a named glass
sampled([400, 450, …], [ … ])   // later: measured curves, lamp presets
```

Any spectrum can go in any slot that accepts one: a light's emission, a material's color, a
medium's absorption, a glass's index. Every spectrum can do two things:

- **be evaluated at wavelengths**: the compiler writes this as a few lines of GLSL, and each
  way of producing a spectrum brings its own (Planck's formula, Cauchy's polynomial, the RGB
  lookup table);
- **be converted to RGB**, for RGB renders, light-power estimates and color swatches.

A scene stays plain data: `blackbody(3200, 1.5)` is a helper that writes
`{ blackbody: { kelvin: 3200, scale: 1.5 } }`, as scenes already do today.

## 2. The slot says how a spectrum is read

Only one kind of spectrum is light itself. Everything else acts on light as a multiplier:

| Slot's role | What the spectrum is | From RGB | To RGB |
|---|---|---|---|
| **emission** (lights, glowing surfaces, skies, glowing media) | light: a density per nanometer | RGB times daylight white, so (1,1,1) looks white | integrate against the CIE curves: canonical |
| **reflectance** (surface colors, glass tint) | a multiplier in [0,1] | a curve that stays in [0,1] at every wavelength | the color of white light after reflecting (standard, given a chosen white) |
| **coefficient** (absorption, scattering) | a rate per unit length | a curve with no upper bound | a convention only: exp(−σd) does not commute with projection |
| **index** (glass, GRIN) | a pointwise parameter | none: a number is the same index at every wavelength | the index at 587.6 nm, the value an RGB render uses |

So conversions in both directions belong to the slot, not to the spectrum. This is what lets
glass be a spectrum without being "a spectrum you can't convert": in every slot it is allowed
in, it has a well-defined RGB stand-in. pbrt reads its glasses' index as an ordinary spectrum
the same way, and both pbrt and Mitsuba pick the from-RGB variant by use (**Source**; pbrt's
three `SpectrumType`s are our emission, reflectance and coefficient).

The from-RGB method is Jakob–Hanika (already built, and what pbrt and Mitsuba use). In an RGB
render, a color you typed as RGB is used exactly as typed, with no round trip; only spectra of
other kinds are converted.

A slot also restricts which spectra make sense: a blackbody belongs in emission slots, a Cauchy
formula in index slots, and a reflectance must stay in [0,1]. Those checks run when the scene
compiles.

## 3. Along a ray, light is known at four wavelengths

Each path draws four wavelengths at the camera. They ride on the ray (`Ray.wl`), and every
spectrum the path meets is evaluated at those four. The light and the product of multipliers
along the path are four numbers each. The pixel's RGB value is the Monte Carlo estimate of
integrating the light against the sensor curves:

```
pixel = ¼ Σᵢ sensor(λᵢ) · L(λᵢ) / pdf(λᵢ)
```

The wavelengths come from one fixed density shaped like the eye's response (pbrt's default),
the same for the whole image. This is fine for blackbodies and RGB lights and noisy for lamps
whose light sits in narrow bands. Sampling wavelengths partly from the lights would fix that
without changing the converged image; it is deferred until measured lamp spectra are added
(owner, Sep 28). A true line spectrum, a Dirac mass in wavelength, cannot be point-evaluated at
all; it would need its own design, the way a point light is a delta in space.

## 4. Numbers can be live

A spectrum's numbers can be constants, sliders (a temperature knob), spatial formulas (a color
that varies over a surface) or per-instance values (a different color per sphere). This
machinery already exists and does not change. Today it covers RGB colors fully and
blackbody's temperature and brightness as sliders. Per-instance temperature, or a temperature
formula across an accretion disk, is possible later but needs work (§8).

## 5. What changes for you

Nothing in how scenes are written, at first. The change is inside the compiler: today the
question "is this a blackbody? is it Cauchy?" is asked in about 30 places (§6). After the
change, each kind of spectrum lives in one file that answers every question about it, and
adding a kind (the next is measured curves) is one new file and one registry line.

---

# Part 2: getting there from today's code

## 6. What the code does today

*Census, spot-checked.* Where spectra appear, and what each slot accepts (K constant, P live
`{param}`, E GLSL expression, A per-instance attribute, BB blackbody, CY Cauchy, SM Sellmeier):

| Slot | Role | Accepted today |
|---|---|---|
| Material reflectance rows: `albedo`, checker `albedo_a/b`, `f0`, glass `transmittance` | reflectance (declared on the row) | K, P, E, A |
| Material `emission` (lambert) | emission (row) | K, P, E, A (sphere batches), BB |
| Material `ior` (dielectrics) | index (row) | K, P, CY, SM |
| `lights[*].emission` (radiance, intensity or irradiance by kind) | emission (row) | K, P, BB |
| `environment.color` (constant sky) | emission (hard-coded in the generator) | K, P, BB |
| Image and procedural skies | emission (hard-coded) | RGB texture or formula |
| `medium.sigma_a`, `sigma_s` | coefficient (hard-coded) | K, P, E |
| `medium.emission` | emission (hard-coded) | K, P, E |
| `medium.ior` (GRIN field) | index (no role passed to validation) | K, P, E |

Other slots hold plain numbers (roughness, a phase function's g, light geometry). They are not
spectra and nothing here touches them.

What goes wrong:
1. **Kinds are recognized case by case.** Outside the color folder there are 28 calls to
   `isBlackbody`, `isCauchyIndex` and their relatives (**Checked**), plus uses without a call
   such as `.some(isBlackbody)` (**Reviewer**). Adding Sellmeier touched nine files outside its
   own folder (**Checked**).
2. **Readers classify values in different orders**, by which keys an object has. An
   unrecognized object is passed through, ignored, or turned into a raw error depending on the
   reader. A malformed value with two kinds' keys compiles today and is treated as live by
   light selection but as blackbody by the shader (**Reviewer**, compiled).
3. **"Can this emission be nonzero?" has four spellings** that disagree on negative and NaN
   values (**Census**).
4. **Checks differ between RGB and spectral renders.** A negative live material emission, and
   a constant negative medium emission, compile in RGB and are rejected in spectral
   (**Checked**, design review 3.1).
5. **Small consequences:** a blackbody light skips its light kind's own shape checks
   (Validator.ts:136–139, **Checked**); the constant sky applies its intensity inside the RGB
   lift for RGB and outside it for blackbody (environment.ts:122–124, **Checked**; same result,
   inconsistent code); `formatSpectrum` has no caller (**Checked**).

None of this is an estimator error.

## 7. The code interface

Each way of producing a spectrum is a *kind*, described once. As built in step 1
(`src/components/color/spectrumKind.ts`):

```ts
type SpectrumRole = 'reflectance' | 'coefficient' | 'emission' | 'index';

interface SpectrumKind<V> {
    id: string;                                  // 'rgb', 'blackbody', 'cauchy', 'sellmeier'
    label: string;                               // its name in diagnostics
    is(value: unknown): value is V;              // recognizes its own authored data
    roles: readonly SpectrumRole[];              // slots it may go in
    liveParams(value: V): string[];              // parameter paths of its live sliders
    validate?(value: V, label: string, report: (message: string) => void): void;
    toRGB(value: V, role: SpectrumRole, params): Vec3 | number;   // RGB stand-in (§2)
    constantNonzero(value: V): boolean;          // the light census's question
    mayBeNonzero(value: V): boolean;             // can its emission be nonzero at run time
    dispersive(value: V): boolean;               // varies with wavelength as an index (collapse)
    emit(value: V, ctx: EmitContext): string;    // GLSL: Spectrum for radiometric roles, float for index
    mint?(value: V, ctx: MintContext): void;     // uniforms and sliders it derives (blackbody's T)
    packed?: { code: number; header(value: V): [number, number]; read(header: string, wl: string): string };
}

interface EmitContext {
    role: SpectrumRole;
    wl: string;          // GLSL expression of the wavelength carrier
    spectral: boolean;   // true when the program evaluates spectra at wavelengths
    factor?: string;     // a scalar strength (the sky's u_envIntensity); rgb applies it before
                         //   the lift and blackbody after, exactly as before
    bind(value, format): string;   // the compiler's literal / uniform / expression binding
    lift(rgb: string): string;     // the color model's RGB lift in this role
}
// MintContext carries the uniform and parameter lists and the compiler's `mint` for plain sliders.
```

Kinds import only types from the compiler (the components purity rule); the compiler's own
operations (binding, lifting, minting a slider) reach them through the two contexts.

`SPECTRUM_KINDS` is one ordered registry. `namedKindOf(value)` returns the named kind that
claims a value, and `kindOf(value)` falls back to the `rgb` kind, which covers numbers, triples,
`{param}`, expressions and attributes; in a radiometric slot its `emit` is the
`color_lift_<role>(…)` call, in an index slot the scalar index. As built in step 1, `kindOf` does
not take the slot: the loops that pass over every light row (light-row resolution, the
driven-emission census) keep their conditions, so a number in a geometry row is never read as a
color, and the `rgb` kind's answers equal the old fallback branches exactly. In step 2 the
plain-value checker rejects anything that is not a number, triple, `{param}` or expression, and
a value with two kinds' keys, so readers after validation never see an unrecognized value.

What the kinds do **not** take over yet (**Reviewer**): the attribute binding, decided at three
sites today (materials.ts:390, lighting.ts:689, sceneData.ts:171), two of which hard-code the RGB
lift and which need different GLSL at a hit and in a light-selection loop; the media code, which
builds coefficients as RGB `vec3`s, clamps them and then lifts (materials.ts:560–593); the GRIN
index field (`ior_at`); derived fields; and the tracking majorant, whose RGB bound already has
an owner in the color model (`mediumBound`). These accept only `rgb` today and change when a
later kind first needs them.

How the readers change:

| Reader today | Becomes | Step |
|---|---|---|
| propertyValidation's blackbody, Cauchy and Sellmeier blocks | `kind.validate` | 1 |
| Validator light branch, material emission checks, analyze/spectral.ts | unchanged in step 1; one table of role domains in step 2 | 2 |
| `projectRGB`, `resolveLightValues` (radiometric rows only), env selection, sceneData projection | `kind.toRGB` | 1 |
| `emitIndex` (behind `ior_of`), `evaluateIndex`, `planDispersion`, `indexIsDispersive` | `kind.emit`, `kind.toRGB`, `kind.dispersive` | 1 |
| `radiometricValueDeps`, `isDrivenRadiometric` | `kind.liveParams` | 1 |
| `hasConstantNonzeroEmission`, `emissionMayBeNonzero` | kind methods with today's semantics; one rule in step 2 | 1, 2 |
| `emitSpectrum`, `emitBlackbody`, the constant sky | `kind.emit` (sky via `ctx.factor`) | 1 |
| `mintValueUniform`'s blackbody branch | `kind.mint` | 1 |
| `packLightTable` header and the generated row reader | `kind.packed` | 1 |
| Planner `blackbody` flag, core.ts includes | the kinds a program evaluates spectrally | 3 |
| attribute binding, media, `ior_at`, derived fields, majorant | unchanged | 4+ |

## 8. Build steps

Each step is approved separately. Step 1 is written out in full; the others get their own plans.

### Step 0: make the refactor checkable (tests and fixtures only; built Sep 28)

The compiled-output digest cannot yet see everything step 1 touches (**Reviewer**, **Checked**):
it writes uniform compute closures as `[fn]` (tests/helpers/compiledJson.ts:16), so live sliders
are invisible to it; no suite scene has an instanced blackbody light, a blackbody sky in an RGB
render, or a blackbody light under equiangular sampling; and it compiles only valid scenes. So:
1. add compile-only fixture scenes for those three blackbody paths;
2. extend the digest to evaluate each uniform's compute closure at its defaults and at one moved
   parameter set, and hash the results;
3. add a test snapshotting the sorted diagnostics of a list of invalid scenes (each kind in a
   wrong slot, bad blackbody/Cauchy/Sellmeier numbers, a blackbody quad light with zero area, an
   index formula in a color slot).

No production code changes. The new snapshots are reviewed once, then frozen for step 1.

### Step 1: kinds behind the interface, output unchanged (built Sep 28)

**Rule after this step:** every spectrum value is recognized by exactly one registered kind, and
no code outside `components/color/` names a kind's predicate or compares a kind's id, except the
named allow-list below.

**What changes:**
1. `components/color/spectrumKind.ts` (new, the contract), `components/color/spectrumKinds.ts`
   (new: the registry, the lookups, the `rgb` kind) and `components/param.ts` (new: the
   `{param}` recognizer, moved out of the color folder so the kinds can share it).
2. `blackbody/`, `cauchy/`, `sellmeier/`: each exports its kind. No `.glsl` file changes.
3. `color/values.ts`: its helpers dispatch through the registry, with **today's semantics kept
   exactly**, including their disagreement on negative values.
4. `compiler/generate/values.ts` and `color.ts`: blackbody emission, its sliders and index
   emission move into the kinds.
5. `compiler/generate/features/` `environment.ts`, `lighting.ts`, `core.ts` and (through
   `emitIndex`) `intersection.ts` emit **exactly the same text**. The kelvin slider keeps its
   default range `[1000, 12000]`.
6. `components/lights/table.ts` (header via `kind.packed`; the blackbody tag stays `1`),
   `compiler/plan/values.ts`, `plan/Planner.ts`: recognition through `kindOf`.
   (`compiler/sceneData.ts` needed no change: it reaches the kinds through `projectRGB`.)
7. `compiler/analyze/propertyValidation.ts`: the three named-kind blocks become `kind.validate`,
   same messages. **The checks on plain RGB values stay where they are** (Validator light
   branch, material checks, analyze/spectral.ts with its current exemption), so every diagnostic
   is unchanged.

**Named allow-list** (in the scan test, each removed in the step shown): the Validator's light
emission branch and its private emission predicate (Validator.ts:136 and :1699; the predicate
differs from the shared one on negative or NaN blackbody scales and on arrays with non-number
entries; step 2); analyze/spectral.ts's three plain-value exemptions (step 2); the "no
blackbody in a medium" message in propertyValidation.ts (step 2); the Planner's `blackbody`
flag (step 3). `dispersion.forms` needed no entry: it now records the kind's id.

**Known behavior change:** a malformed value with two kinds' keys is classified by one registry
order everywhere, instead of each reader's own. No suite scene has one; step 2 rejects it.

**Unchanged:** `.glsl` files, `ProgramDescription`, folders, validation outcomes and messages,
packed bytes, slider metadata, the App and the engine.

**Verification, written first:**
1. *Fails today:* a scan of `src/` outside `components/color/` for the predicate identifiers
   (`isBlackbody`, `isCauchyIndex`, `isSellmeierIndex`, `isSpectralIndex`, `indexIsDispersive`,
   `evaluateIndex`, `indexForm`, `emitBlackbody`, matched as identifiers so `.some(isBlackbody)`
   counts) and for comparisons of a kind's id to a string. Today: 28 calls plus point-free uses.
   After: only the allow-list.
2. Each kind recognizes its own examples and no other kind's; every spectrum value in every
   suite scene is recognized by exactly one kind.
3. The step-0 digest, before and after: every synchronous scene identical (shaders, uniforms,
   closure results, parameters, source maps, packed data, warnings). First, show the compare
   catches a change by editing one character in `blackbody.glsl`. The seven async scenes it
   skips use only RGB constants and per-instance emission attributes (**Checked**), paths the
   `spheres` demo and the instance witnesses also compile.
4. The step-0 diagnostics snapshot passes unchanged.
5. `npx tsc --noEmit` and the full `npx vitest run` pass, snapshots unchanged.
6. No GPU runs needed: identical shaders, closures and packed data mean identical renders.

**Not in this step:** new kinds, validation changes, folder moves, the color-model cleanup
(design review 3.4), binding unification.

### Step 2: one set of checks per role (behavior change; built Sep 28)

**Problem (evidence):** the step-0 diagnostics snapshot. Negative emission from a slider or in a
medium, and an expression as the constant sky's color, compile in RGB and are rejected in
spectral; a blackbody quad light with zero area passes validation and crashes the compile; a
Cauchy formula as medium emission passes RGB validation and throws an internal error; a value
with blackbody and `param` keys compiles. RGB never sign-checks reflectance, medium emission or
per-instance colors, and never checks a slider's `max`.

**Rule after this step:** every spectrum slot is checked against its role's domain by one
shared checker (`validatePropertyValue`, with `roleDomain` also used for per-instance values), in
both color models, for constants, slider defaults and both slider bounds: reflectance, coefficient
and emission are nonnegative, index is positive. A few slot rules the role cannot express stay
beside it: media take no named kind, and lights and the constant sky take no expression. The spectral model then narrows only where its lift or its tracking bound cannot
represent a value: reflectance at most 1, and the media ceilings. A value is either plain or one
named kind; one that carries two kinds' keys is an error.

**What changes:**
1. `validatePropertyValue`: the role implies its domain; slider `max` is checked like `min`; a
   value with two kinds' keys is an error.
2. Lights: the light branch validates emission through `validatePropertyValue` for every kind
   (no `continue`), so every light runs its kind's shape checks; expressions stay rejected.
3. Materials: a model without an emission row still has its `emission` checked against the
   emission domain; the hand-written negative-emission check goes; the Validator's private
   "may emit" predicate is replaced by the shared one.
4. Media: `sigma_a`/`sigma_s` get the coefficient role, `emission` is validated at all (emission
   role), `ior` gets the index role; media accept plain values only, one message for any named
   kind (replacing the blackbody-only message and the misleading "Cauchy is an index form" on
   `medium.ior`). `mediumPropertyMayBeNonzero` becomes the shared predicate.
5. Constant sky: an expression is an error (the type already excludes it; RGB would compute a
   NaN selection weight).
6. Instance attributes: spectrum rows are sign-checked in both models.
7. analyze/spectral.ts keeps only the spectral narrowing (reflectance ≤ 1; media ceilings and
   majorant range), applied to plain values; named kinds are checked by their kinds.
8. The kelvin slider's default minimum reads the blackbody domain's constant (same value); its
   default maximum stays 12000 K as a UI choice.

**Verification:** the digest is identical for every suite scene (valid scenes compile the same;
if any suite scene is newly rejected, that is a finding to report, not to paper over); the
diagnostics snapshot changes, and each changed case is reviewed and listed in the CHANGELOG; the
scan test's allow-list shrinks to the Planner's `blackbody` flag; typecheck and the full test run.

**Not in this step:** `formatSpectrum` (unused, with a wrong comment) is left for the owner to
decide; RGB reflectance above 1 stays allowed, as today.

### Step 3: folders and plan fields (own plan)

Move the kinds to `components/color/spectra/` (one folder each: `rgb/`, `blackbody/`, `cauchy/`,
`sellmeier/`, later `sampled/`, beside the two color models); replace
`ProgramDescription.blackbody` and `dispersion.forms` with one list of the kinds a program
evaluates spectrally, and retire the old `IndexForm` type. Shaders then differ only in
origin-path comments, shown by a path-normalized compare.

### Step 4: bindings in one place (own plan)

One owner for constants, sliders, expressions and attributes, including the attribute address
(written three times today) and its GLSL at a hit versus in a light-selection loop. Per-instance
temperature becomes possible here; it also needs a per-instance normalization and light power.

## 9. Left for the measured-curve spec

The public spelling of a curve and its strength (`amount × curve`); interpolation, support and
knots; where curve data lives (shader constants or a scene-data table, especially for packed
lights and per-instance use); to-RGB conventions for reflectance and coefficient curves; a
maximum over wavelength for media, designed together with the color model's existing bound;
CPU access to the RGB reconstruction table for normalized light colors; and wavelength sampling
from the lights (§3).

One piece of evidence for it: pbrt normalizes a light by its spectrum's photometric integral but
leaves an RGB light's own brightness in place, so a red light is dimmer than a white one. The
implementation plan's checkpoint suggests normalizing the reconstructed spectrum of an RGB light
color instead. The choice matters only for a future "normalized RGB light color" control.

## 10. Decisions for you

1. **Part 1 as the design**? (Single type decided.)
2. **The step order** 0 → 1 → 2 → 3 → 4, with step 0 test-only and step 1 a pure refactor?

After your answers I would do step 0, show you its new snapshots, then build step 1 exactly as
§8 lists, and stop and ask if anything in the code does not fit.

---

## Appendix A: what a new kind touches today

Type unions and guards (compiler/types.ts, plan/types.ts, descriptors.ts, dataTenants.ts);
color/values.ts (dependencies, both emission predicates, `projectRGB`); Validator.ts,
propertyValidation.ts, analyze/spectral.ts; the medium predicates if allowed in media;
plan/values.ts and Planner.ts; generate/values.ts, color.ts, environment.ts; lighting.ts;
lights/table.ts; compiler/sceneData.ts and app/sceneData.ts; core.ts includes; materials.ts if
allowed in media; `emitIndex` and `planDispersion` if used as an index; slider metadata and the
authoring helpers. (**Census**)

## Appendix B: the independent review of the first draft

| Finding | Severity | Change |
|---|---|---|
| The digest writes compute closures as `[fn]`, no suite scene reaches three blackbody paths step 1 rewrites, and it never sees diagnostics | overclaim | step 0 |
| `emit` could not reproduce the sky's intensity placement without a kind test | infeasible as written | `EmitContext.factor` |
| Plain-number slots (roughness, g, light geometry) pass through the same readers; one would have turned a light's radius into a color, giving NaN power | design error | `kindOf` takes the slot; only spectrum slots reach it |
| The scan matched only calls, missing `.some(isBlackbody)` and id comparisons | overclaim | identifier and id scan; named allow-list |
| Routing plain-value validation through the kinds would drop one of two errors and cannot keep the light branch's wording | conflict | plain-value checks stay put in step 1 |
| "Bindings have one owner" was wrong: attributes are decided in three places | overclaim | stated; step 4 |
| Missing readers (`ior_of`, `ior_at`, media, majorant, derived fields, a sceneData projection) | imprecise | added to §7 with their steps |
| Per-instance temperature is not "just a binding"; media need more than one method; dispersive GRIN needs `planDispersion` changed | overclaim | §4, §7, §9 |
| Name clashes (`IndexForm` exists; `rgb` meant three things) | readability | the interface is `SpectrumKind`, the method `toRGB`; `IndexForm` retired in step 3 |
| pbrt reads `eta` as a spectrum; Mitsuba's blackbody throws in RGB modes; `SpectrumToPhotometric` is not divided by ∫ȳ | overclaim | corrected; single type adopted |

The reviewer confirmed the counts, the blackbody light's skipped checks, the unused
`formatSpectrum`, the hard-coded roles, the async scenes, the include order, the pbrt and Mitsuba
interface facts used here, and that nothing assumes Euclidean space. This revision (Part 1 and
the renaming) has not been re-reviewed.
