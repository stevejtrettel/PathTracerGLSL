# Spectra in every slot

**Status:** proposal (September 28, 2026), for the owner. Part 1 is the model, Part 2 the build
steps. Steps 1–3 were approved and built on Sep 28 (see the CHANGELOG); later steps each need
their own plan and approval.

This builds on the approved [one-spectrum-type spec](claude-spectrum-spec.md), whose §1–3 stand
unchanged. It would replace that spec's §4 ("numbers can be live") and its step 4, and the
parked [bindings design](claude-spectrum-bindings.md).

Owner decisions (Sep 28):
- clean, uniform code above all;
- media absorption and scattering take any spectrum;
- per-instance colors stay RGB;
- procedural and per-instance color (for example HSV) belong in the design.

This draft was revised after an independent review; Appendix A lists what it found.

---

# Part 1: the model

## 1. A slot holds a field of spectra

A **slot** is a place in the scene that needs a spectrum: a material's color, a light's emission,
a medium's absorption, a glass's index, and so on. It holds

    F(x, λ) = K( θ(x) )(λ)

- **K, the kind,** is a family of functions of wavelength with a few parameters θ:
  - RGB (θ is a triple, or a single number);
  - blackbody (θ = temperature and brightness);
  - a Gaussian band;
  - Cauchy or Sellmeier, for an index;
  - later, measured curves.
- **θ(x), the binding,** says what the parameters depend on. The inputs x are the sliders, the
  instance that was hit, and the point (position, uv, or a direction in the sky). So a
  parameter may be:
  - constant;
  - a slider, or a function of sliders computed on the CPU (blackbody's normalization already
    works this way);
  - read from a per-instance table;
  - a GLSL formula of the point;
  - read from an image.
- **The role belongs to the slot:** emission, reflectance, coefficient or index. It says what F
  means, which values are allowed, and how an RGB triple becomes a spectrum and back (spec §2).
  For RGB input the role picks the conversion: three radiometric lifts, and for an index the
  number itself.

At a shading point the shader computes θ, then evaluates K at the path's four wavelengths.

| Example | K | θ depends on | Role |
|---|---|---|---|
| a red Lambert sphere | RGB | nothing | reflectance |
| marble veins | RGB | the point (a formula) | reflectance |
| colored lamps in a batch | RGB | the instance | emission |
| a flame | blackbody | temperature on a slider; brightness = a density formula of the point | emission, in a medium |
| seawater (later) | measured curve | nothing | coefficient |

## 2. What the CPU must know

Some consumers need numbers computed on the CPU from θ:
- the RGB stand-in of a non-RGB kind, for RGB renders;
- a blackbody's normalization, which is an integral that depends on the temperature;
- a light's power, for choosing which light to sample;
- a medium's tracking bound;
- sky sampling tables.

The CPU knows constants, sliders and per-instance tables. It does not know formulas or images,
which live on the GPU and vary by point.

**One rule follows:** a parameter may be bound to a formula or an image only if no
CPU-computed quantity needs its value. The one exception is a factor that can be applied on the
GPU afterward. A blackbody's brightness multiplies its normalization, so brightness can be a
formula wherever the normalization is the only CPU quantity involved. A sampled light is
different: its power is the brightness summed over the whole light, which the CPU cannot know
for a formula (the last row below).

This rule produces the table of what is possible:

| | Depends on sliders or the instance | Depends on the point |
|---|---|---|
| RGB, any role | yes | yes (its stand-in is itself) |
| blackbody brightness | yes | yes, except on a sampled light (it is a GPU-side factor) |
| blackbody temperature | yes (normalization computed on the CPU) | no: the normalization would be an integral per pixel |
| index formulas (Cauchy, Sellmeier) | constants today | no: dispersion is decided when compiling |
| any emission a light sampler must know | yes | no: such emission is only found by paths that hit it, as formula emission is today |

The rule also covers the existing limits: the light tree needs constant emission (its power per
light is baked), and formula media need an authored density ceiling.

What is built is a subset of the table. Per-instance values are RGB only, and for emission only
on simple sphere batches. The new cells follow this rule and don't need special cases.

## 3. Color coordinates

HSV and hex codes are other ways of writing an RGB triple of the same role. They are defined on
sRGB-encoded values, so each is decoded to the renderer's linear RGB. How that happens depends
on θ's binding:
- **constant or per instance:** an authoring helper writes RGB into the scene;
- **slider:** a CPU function of the sliders. A numeric "hue" parameter works this way; a live
  color on a lamp needs nothing new in the compiler, since the panel's color control could offer
  an HSV picker;
- **formula:** a GLSL helper the formula calls.

So HSV is one small pair of functions, TypeScript and GLSL, that must agree. It is not a kind.

**A coordinate that changes the role is not a coordinate.** "The color this medium shows through
one meter" turned into a coefficient per RGB channel, σ = −ln T, and then lifted, does not
reproduce T in spectral renders. The independent review computed (0.5, 0.1, 0.1) → (0.420,
0.096, 0.100). The correct version applies −ln per wavelength after lifting T as a reflectance.
That is a kind (a "transmittance" kind in the coefficient role), not an authoring shortcut. The
existing subsurface helper (authoring/subsurface.ts) inverts per RGB channel and has the same
error in spectral renders.

## 4. What "uniform" means in the code

- **One path for every slot.** Every slot emits its GLSL through one function, which receives
  the role from the slot: materials, lights, media, skies, and per-instance and image-bound
  values. No slot converts RGB by itself, and no code infers a role from the kind.
- **A kind answers questions about its own parameters.**
  - its GLSL evaluation at wavelengths;
  - the checks on its parameters;
  - its CPU-derived quantities: the RGB stand-in, the normalization, the maximum over
    wavelength, and whether it varies as an index.

  A kind does not know whether the render is RGB or spectral: in an RGB render the compiler
  uses the stand-in. It also does not know how its parameters are bound.
- **Each binding is implemented once,** for every kind and every slot.

## 5. How the code differs today

These facts come from the Sep 28 review and the independent check of this note:
- **Kinds reach only three slots:** material rows, light rows and the constant sky. Eleven lines
  convert RGB directly:
  - media;
  - per-instance values;
  - image and procedural skies;
  - light-table rows (except blackbody's header);
  - derived fields;
  - schema defaults.

  The GRIN index binds its value directly. So media take no named kind.
- **The role is split across two fields** and re-derived in four places. In three of them it is
  taken from the kind instead of the slot (plan/values.ts:13, Planner.ts:1016, lighting.ts:338).
- **Each named kind implements RGB rendering itself.**
- **The bindings are spread out.** Per-instance values are read at three sites, and the
  CPU-derived binding exists only inside blackbody and a few fields.

## 6. Media

Media are where the decision "any spectrum" first bites. There are two ways to write a medium
that varies in space:
- **An RGB field (today):** a formula returns RGB σ per point. The RGB is clamped to the
  authored ceiling, then lifted. In spectral renders the tracking bound is 4 × ceiling. σ_a and
  σ_s each stay under the ceiling after the clamp, and the RGB lift of each is at most twice its
  largest channel.
- **A spectrum times a scalar density (pbrt's grid medium):** σ(x, λ) = d(x)·σ̂(λ), where σ̂ is
  any spectrum and d a scalar formula with a ceiling. The bound is the ceiling times σ̂'s maximum
  over wavelength. Emission works the same way; a flame is d(x) × blackbody.

The second form is what makes any spectrum usable in varying media. It also needs one new kind
question, the maximum over wavelength, which a tracked constant medium needs too. Today no named
kind has the coefficient role, so "σ takes any spectrum" first matters with measured curves, or
with a kind such as a Gaussian absorption band.

The medium's index (GRIN) stays a number: a wavelength-dependent index there is spatially
dispersive GRIN, which remains gated.

## 7. Precedent

Source read on Sep 28: pbrt-v4 at `b4ce968`, Mitsuba 3 at `fd9c9ce`. Paths are relative to their
`src/`.

- **The slot picks the role, and only RGB input cares.**
  - pbrt's three "spectrum types" are our emission, reflectance and coefficient. Each slot's
    constructor names its type (pbrt/materials.cpp:197, pbrt/media.cpp:176–189,
    pbrt/lights.cpp:196). The parser uses the type only to lift RGB (pbrt/paramdict.cpp:384–451).
  - Mitsuba does the same with three getters (core/properties.cpp:592–706).
- **What the numbers are and where they come from are separate.**
  - pbrt's `Spectrum` (constant, sampled, blackbody, the RGB forms) sits apart from its
    `SpectrumTexture` (constant, image, scale, mix, …). Every texture is evaluated at the path's
    wavelengths (pbrt/base/texture.h:72–79).
  - An image texture filters RGB, then lifts it with the slot's type (pbrt/textures.cpp:359–386).
    That is our order.
  - Mitsuba makes every spectrum a texture (render/texture.h:40).
- **Media take any spectrum.**
  - pbrt's homogeneous medium reads σ as any unbounded spectrum and emission as any illuminant
    spectrum.
  - Its grid medium is a constant spectrum times a scalar density, with emission optionally a
    blackbody of a temperature grid (pbrt/media.h:286–314).
- **Index.** pbrt reads a glass's index as a spectrum and collapses to one wavelength when it is
  not constant (pbrt/materials.h:185), which is our rule. Mitsuba's dielectric index is a
  number. Neither has Cauchy, Sellmeier or Gaussian forms.
- **Per instance.** pbrt has no per-instance color. Mitsuba treats a mesh attribute as a color
  only if its name contains "color", and only as a reflectance (render/mesh.cpp:2421).
- **Blend order.** Mitsuba, and pbrt's RGB grids, lift before blending. We blend RGB first, as
  pbrt's image textures do. The two orders give different spectra.

## 8. Questions for you

1. **Is this the model?** F = K(θ(x)), the role from the slot, and the one rule about what the
   CPU must know.
2. **Media:** keep RGB fields as they are, and add "spectrum times density" as the way any
   spectrum enters a varying medium? It gives flames (density × blackbody) and, once curves
   exist, measured absorbers.
3. **Spectral formulas:** do you want a GLSL formula of the point *and wavelength*? Iridescence
   and thin films need one. It would be a kind whose evaluation is your GLSL. It is the most
   direct form of "procedural spectral color", and in RGB renders it would need its own
   stand-in.

---

# Part 2: the steps

Notation, from Part 1:
- K is a kind (RGB, blackbody, Gaussian band, Cauchy, Sellmeier) and θ its numbers.
- θ(x) says what those numbers depend on (x is the sliders, the instance or the point).
- r is the slot's role (emission, reflectance, coefficient, index).
- K_r(θ)(λ) is the spectrum the slot sees at wavelength λ. K̄_r(θ) is its RGB stand-in, used in
  RGB renders.

Each step makes one sentence of Part 1 true in the code. Each is small and approved separately,
with its own detailed plan before any code. Step 1 is written out in full below.

A **refactor** leaves every scene's compiled output byte-identical, which the digest shows. Any
other step says exactly what changes and how it is checked.

| Step | What becomes true | Kind of step |
|---|---|---|
| 1 | **Every material and light setting states its role in one place,** and no code guesses a role from the value. | refactor |
| 2 | **Every spectrum setting goes through one path:** compute its numbers θ(x) (fixed, slider, formula, per instance, image), then evaluate K_r at the path's wavelengths. Fog settings and the sky get the same role declarations as materials. | refactor |
| 3 | **A kind never asks whether the render is RGB or spectral.** RGB renders use its RGB stand-in K̄_r(θ). Numbers computed on the CPU, like a blackbody's brightness normalization, all arrive the same way. | small change: in RGB renders with a blackbody on a slider, shader text changes and values agree up to rounding; checked on the GPU |
| 4 | **Each value is checked once:** against its role's allowed range, its kind's own rules and its slider's structure. | stricter checks (listed below) |
| 5 | **Fog takes any spectrum.** | feature |
| 6 | **HSV colors.** | feature |

**Step 2** removes the 11 places that convert RGB on their own, and the three places that read
per-instance values. The light table stops needing each emission kind to opt in: every emission
kind states how its table row reads, and RGB's row is the plain color. Two traps must come out
byte-identical, and the digest will show whether they do:
- the default color is written `vec3(0.8)` today, while the general path writes
  `vec3(0.8, 0.8, 0.8)`;
- the fog's density clamp sits between computing the numbers and evaluating the kind, so a
  fog's spectrum is K_r(clamp(θ(x))). The one path needs that stage.

**Step 4 makes these errors that pass today:**
- a key the kind doesn't know, inside or next to a named kind
  (`{ blackbody: { kelvin: 3000 }, scale: 5 }`);
- a slider default outside its own min and max.

The four checkers it merges are the shared value check (`validatePropertyValue`), the
spectral-only limits (analyze/spectral.ts), blackbody's own slider check, and the per-instance
check in the Validator. The spectral model's extra limit, reflectance at most 1, becomes a
stated fact of that color model.

**Step 5, the physics.** A fog's absorption, scattering and glow share one density d(x):

    σ_a(x, λ) = d(x)·K_a(λ),  σ_s(x, λ) = d(x)·K_s(λ),  ε(x, λ) = d(x)·K_ε(λ)

- **One density for all three.** The ratio of glow to extinction, ε/σ_t, is a property of the
  material, and today's density clamp already keeps it fixed. So a flame is a density formula
  times a blackbody glow, with its smoke absorption scaled by the same d.
- **Tracking bound:** ceil(d) · max over λ of (K_a + K_s)(λ).
- **What changes in the bound code:** the color model's bound (`mediumBound`) now builds in the
  RGB conversion's factor of 2. It splits into two pieces: the kind's own maximum over
  wavelength, and the color model's rounding allowance.
- **RGB fog formulas stay as they are.** The coefficient conversion scales exactly, so
  d·K(θ) = K(d·θ) for RGB. The density form is needed only for non-RGB spectra.

A "transmittance" kind belongs to this step if wanted. It holds the color a fog shows through a
given depth, converted per wavelength (Part 1 §3). It would also fix the subsurface helper.

**Step 6.** `hsv(h, s, v)` gives RGB of the same role:
- an authoring helper for fixed and per-instance colors;
- a GLSL helper that formulas can call.

These need nothing from the other steps. A hue slider on a lamp needs step 3's CPU-computed
numbers.

**Small cleanups, any time:**
- ~~`MaterialProperties.wl` and `MediumProperties.wl` are written and never read.~~ No other
  code reads them, but they keep the structs non-empty; they stay (see "After step 3").
- `formatSpectrum` has no caller (the owner's call).
- The Validator's false "envSelectWeight controls nothing" warning when a scene's only lamps are
  instanced.

**Not in this plan:**
- per-instance spectra (per-instance stays RGB);
- a blackbody temperature given by a formula;
- formulas of wavelength (§8 question 3);
- a single film formula for RGB and spectral renders, with the wavelengths owned by the color
  model. That would be a separate design; it is not a sentence of Part 1.

## Step 1 in full: every material and light setting states its role in one place

**Problem (read Sep 28; line numbers at commit bd39f8b).**
- **Rows spell the role across two fields.** A setting in a material, light or phase descriptor
  (a "row") is one of three things (components/descriptors.ts:42–53):
  - `semantic: 'radiometric', role: …` (17 rows);
  - `semantic: 'index'` (2);
  - `semantic: 'geometric'` (26).

  materials/index.ts:35–36 writes the same spelling for derived fields.
- **18 places in src read the two fields:**
  - materials/index.ts:80;
  - compiler/sceneData.ts:154;
  - generate/schema.ts:25, :45;
  - Planner.ts:924;
  - rgbPreview.ts:12;
  - lighting.ts:407, :727;
  - materials.ts:209, :233, :392, :394, :602;
  - analyze/spectral.ts:26, :48;
  - propertyValidation.ts:42, :72;
  - Validator.ts:1202.

  Four of them rebuild the role with a ternary: three-way at propertyValidation.ts:42 and :72,
  two-way at Validator.ts:1202 and lighting.ts:727. schema.ts:18 has its own copy of the field.
- **Six places compare a value's kind against a role typed out as a literal**
  (`roles.includes('…')`, untruncated search):
  - **Three guess the setting's role from the value:**
    - plan/values.ts:13, a backstop throw;
    - Planner.ts:1016;
    - lighting.ts:338.
  - **Three restate a role they already know:**
    - Planner.ts:924;
    - lighting.ts:96;
    - rgbPreview.ts:15.
- **A GPU probe script reads the old field and is not type-checked.** scripts/witness-spectral-
  bindings.ts:93 and :157 read it, and tsconfig includes only src, tests and pages. After a
  rename, line 93 would crash and line 157 would silently skip every probe.

**Rule after this step.**
- A row that holds a spectrum has one field, `role`: emission, reflectance, coefficient or
  index. A row holding an ordinary number (roughness, uv scale, a phase parameter) has none.
- No code compares a value's kind against a literal role.

**What changes:**
1. **descriptors.ts.**
   - `PropertySchema` rows get `role?: SpectrumRole`, and light rows get
     `role?: RadiometricRole`, since lights have no index setting. `semantic` and
     `ColorSemantic` go.
   - `SpectrumRole` moves here from the kinds' contract, which imports it.
   - One predicate, `isRadiometric(role)`, answers "light or a multiplier of light, as
     opposed to an index".
   - `MaterialDerivedSpec` (descriptors.ts:82–84) already works this way.
2. **The 45 rows and materials/index.ts:35–36 change spelling.**
   - `semantic: 'radiometric', role: X` becomes `role: X`;
   - `semantic: 'index'` becomes `role: 'index'`;
   - `semantic: 'geometric'` is deleted.
3. **The 18 reads and schema.ts:18 read `role`.**
   - Six sites need "is it radiometric", not "does it have a role", so they use
     `isRadiometric`: materials.ts:209, :233, :392, :394, :602 and schema.ts:45.
   - The two ternaries go.
4. **The six literal comparisons read the setting instead.**
   - Resolution is called only for radiometric settings, so plan/values.ts:13's backstop goes
     (validation already rejects an index kind there).
   - Planner.ts:1016 asks each setting's role which named kinds a program evaluates at
     wavelengths.
   - lighting.ts:338 converts rows that have a role.
   - The three restatements test the setting's role, and where needed only whether the value
     is a named kind. Whether a kind may sit in a setting stays in validation, compared against
     the setting's own role (propertyValidation.ts:102).
5. **Outside the type checker:**
   - scripts/witness-spectral-bindings.ts:93 and :157;
   - the tests that build rows (lightsContract.test.ts:18, spectrumKinds.test.ts:69,
     spectralMaterials.test.ts:22, blackbodyPreservation.test.ts:24);
   - the documents that pin the row shape: fable-module-anatomy.md:49,
     materials/README.md:59 and cauchy/README.md:27.

**Unchanged.**
- Every shader, uniform, parameter and diagnostic.
- The settings with no descriptor row yet. They still write their role at the call:
  - a light's authored emission (Validator.ts:142, lighting.ts:312);
  - a model with no emission row (Validator.ts:268);
  - the sky (environment.ts:120, :158, :211; Validator.ts:908);
  - the fog's four settings;
  - Planner.ts:55 and dataTenants.ts:213.

  Step 2 declares them.
- The redundant `glslType` of spectrum rows. It always follows from the role (17 radiometric
  rows are `Spectrum` or `vec3`, 2 index rows are `float`); removing it is a separate question.

**Verification, written first.**
- **Scan test (fails today).** tests/components/spectrumKinds.test.ts forbids
  `roles.includes('` outside the kinds' folder. Today it finds six; after, none. It catches
  only that spelling. The rest of the rule is carried by the type, since `role` is the only
  field, and by review.
- **Digest before and after.** All 268 synchronous scenes are identical in every part: shaders,
  uniforms, closure values, parameters, source maps, scene data and warnings. Before the
  comparison, one deliberately edited role must show up in it.
- **Snapshots:** the diagnostics snapshot is unchanged.
- **Static checks:** `npx tsc --noEmit` and the full `npx vitest run`.
- **GPU:** `npm run witness:spectral-bindings`, because the script is edited and nothing else
  checks it. No render witnesses are needed, since shaders are identical.
- **Review:** an independent review of the diff.

## Step 2 in full: every spectrum setting goes through one path

**Approved** by the owner ("do step 2!", Sep 28). It is built in three parts. Each part is a
refactor: its compiled output must be byte-identical for all 268 synchronous scenes, it is
committed on its own, and an independent review of the whole step follows the last part.

**The rule after step 2.** Every spectrum setting reaches the shader through one function,
`emitSpectrum(value, role, context)`:
- the value's kind writes its GLSL;
- the kind's numbers come from one binding function, `emitValue`, which handles a constant, a
  slider, a GLSL expression and a per-instance value;
- the role comes from the setting's declaration.

A number computed in GLSL is the expression binding: an image lookup, a procedural sky's
formula, a fog's clamped field. Only the RGB kind converts RGB to a spectrum.

### 2a. Declarations for the settings without a descriptor row (read Sep 28)

The fog's four settings and the constant sky write their roles at each use:
- propertyValidation.ts:53–56;
- Validator.ts:314;
- materials.ts:529, :562–594;
- analyze/spectral.ts:42;
- environment.ts:120;
- Validator.ts:908.

A light's authored emission and a material's fallback emission are validated with a literal
role (Validator.ts:142, :268). The delta-light query writes one too (lighting.ts:312).

**What changes:**
- **compiler/types.ts,** beside `MediumDescription` and the environment description:
  - `MEDIUM_ROLES = { sigma_a: 'coefficient', sigma_s: 'coefficient', emission: 'emission',
    ior: 'index' }`;
  - `SKY_COLOR_ROLE = 'emission'`.

  These sit beside the types they describe. They are not descriptor rows, because the GRIN
  index has neither a field nor a region table.
- **Readers.** The sites above read these declarations. A light's emission reads its kind's
  role row. The fallback emission reads the material emission row's role (`EMISSION_KEY`).

### 2b. A per-instance value is a binding

The per-instance address, row `slot` of instance `k` with `rows` values each, is written three
times:
- the packer's `(i*A + a)*4` (instancing.ts:156);
- the App's `(k*rows + slot)*4` (app/sceneData.ts:130);
- two GLSL fetches (`emitAttributeValue`, generate/values.ts:73, and the batch light arm,
  lighting.ts:695).

`emitValue` throws on a per-instance value (generate/values.ts:52), and two sites convert its
RGB by hand.

**What changes:**
- **instancing.ts** gets the address once, beside the packer:
  - `attributeTexel(instance, slot, rows)`, used by the packer and the App;
  - `attributeFetch(attribute, instanceExpr)`, its GLSL twin.
- **`emitValue`** takes an options object `{ exprFormat?, instance? }` and emits a per-instance
  value through `attributeFetch`. `emitAttributeValue` goes.
- **`emitSpectrum`** takes `{ wl, color, factor?, instance? }`. The material fill and the batch
  light arm emit per-instance values through it, and the App reads through `attributeTexel`.

### 2c. Every spectrum through its kind

- **The eleven direct conversions go.** They are:
  - schema defaults (schema.ts:47);
  - the image and procedural skies (environment.ts:158, :211);
  - the batch arm, already moved in 2b;
  - the light-table payload (lighting.ts:745);
  - derived fields (materials.ts:344);
  - the per-instance fill, already moved in 2b;
  - fog σ_a, σ_s and emission (materials.ts:591–594);
  - fog phase rows (materials.ts:603).

  Each is now `emitSpectrum` of its value. For a GLSL-computed number the value is the
  expression binding `{ kind: 'glsl', source }`, and each call keeps its text: the sky's
  intensity rides the existing `factor`, and the procedural formula keeps its parentheses. The
  derived-field and phase paths have no user today (ggx's `alpha` and `phase_g` are plain
  numbers).
- **Row defaults are gray numbers.** They are written `vec3(0.8)` today, while a triple is
  written `vec3(0.8, 0.8, 0.8)`. The RGB kind formats its constant with `formatSpectrum`,
  which today has no caller:
  - a number becomes `vec3(g)`, a triple `vec3(r, g, b)`, so the text is unchanged;
  - `formatSpectrum`'s wrong comment is corrected.
- **The fog keeps its clamp as a step on the numbers.** The formula's RGB is clamped to the
  ceiling, then the clamped local is evaluated: K_r(clamp(θ(x))). Only the call that evaluates
  it changes.
- **Light-table rows.** A contract test requires every non-RGB kind that may be emission to
  state its row form (today, blackbody), with a nonzero code that no other kind uses. Code 0
  is RGB's plain color. The payload lift goes through the RGB kind.
- **`emitColor` becomes internal** to generate/color.ts, where the RGB kind's lift is built.

### Verification, written first

1. **A scan test (fails today: 11 sites).** Outside generate/color.ts, no generator calls
   `emitColor` or writes `color_lift_`.
2. **After each part, the digest** is identical for all 268 synchronous scenes: shaders,
   uniforms, closure values, parameters, source maps, scene data and warnings.
3. **App packing:** tests/app/sceneData.test.ts byte fingerprints pass unchanged. They cover
   the packer and the per-instance reads, which the digest does not.
4. **The light-row contract test:** codes unique, and every non-RGB emission kind states its
   row.
5. **Static checks:** `npx tsc --noEmit` and the full `npx vitest run`.
6. **GPU:** `npm run witness:spectral-bindings`. It runs the generated per-instance, light-row,
   fog and sky readers on packed data, and must show the same 69 probes passing. Shaders are
   identical, so render witnesses are not needed.
7. **Review:** an independent review of the whole step.

**Not in this step:**
- named kinds in fog (step 5);
- anything that changes a kind's contract beyond the light-row test;
- any change to validation behavior.

### As built (Sep 28), and what the independent review changed

- **One table.** The fog's, the sky's and a material's fallback emission roles live in one
  table, `SETTING_ROLES` in compiler/types.ts, not in `MEDIUM_ROLES` and `SKY_COLOR_ROLE`.
  - The sky's entry covers every sky form, so the image and procedural skies read it too.
  - A light's emission and a batch lamp's emission read their own rows' roles. The review
    found that the table first repeated them, which gave two answers to one fact.
- **The GRIN index goes through its kind** (`emitIndex`), with the same text. The review found
  it still bound directly.
- **Derived Spectrum fields and radiometric phase rows pass their value to their kind.**
  Neither has a user today. The derived uniform, a number the CPU computes, is the expression
  binding.
- **A bug the review found, now fixed and tested:** a medium key named like a built-in object
  property (`toString`) was read as a coefficient. `mediumSettingRole` now checks own keys.
- **The fog's name-based checks** (analyze/spectral.ts:42) are about extinction σ_a + σ_s, not
  roles, and stay as they are.
- **Checks:** after the review fixes, the digest is identical for all 268 scenes, the full test
  run passes (4,058), and `witness:spectral-bindings` passes with 69 probes.
  - The reviewer also compiled 216 renderers outside the suite (RGB and spectral; power, tree
    and uniform selection; per-instance float rows; a 500-instance cloud under the light
    tree; every sky; every kind of fog). All were identical apart from the bug above.


## Step 3 in full: a kind never asks whether the render is RGB or spectral

**Approved** by the owner (Sep 28), who allowed shader-text changes that improve the system.

**Problem (read Sep 28).** Four kinds branch on the render mode:
- blackbody's `emit` and `mint` (blackbody.ts:137, :148, :151);
- Cauchy (cauchy.ts:39);
- Sellmeier (sellmeier.ts:53);
- Gaussian (gaussian.ts:74).

Each writes its own RGB version, so there are two answers to "what does an RGB render show":
- **Gaussian** has `toRGB` (unclipped) and a clipped copy in `emit`.
- **Blackbody** has `toRGB` and `emitRGB` (a GLSL product of its scale and a per-temperature
  uniform).

**`EmitContext.factor`** exists for one caller, the sky's intensity. The RGB kind applies it
inside the RGB lift and blackbody outside it.

**The rule after step 3.**
- **One evaluation per kind.** A kind's `emit` is its spectrum at the path's wavelengths, and
  nothing else.
- **The compiler owns the RGB stand-in.** In an RGB render it uses the kind's stand-in `toRGB`:
  - a fixed value becomes a literal;
  - a slider-driven value becomes one uniform that the CPU recomputes from `toRGB` whenever
    one of its sliders moves (Part 1's "function of sliders" binding);
  - a reflectance stand-in is clipped to [0, 1]. That is the rule the Validator's preview
    warning already states.

  The stand-in then goes through the RGB kind, exactly like a typed color.
- **Sky brightness multiplies the finished spectrum,** L = k·K(θ), for every sky form, at the
  call site. `factor` leaves the kind contract.

**What changes:**
1. **The contracts.** `EmitContext` loses `spectral` and `factor`, and `MintContext` loses
   `spectral`.
2. **The kinds.**
   - Blackbody loses its RGB branch in `emit` (`emitRGB`) and the RGB case of its temperature
     uniform.
   - Cauchy, Sellmeier and Gaussian lose their render-mode branches. An index kind that does
     not vary with wavelength still returns its constant: that depends on its own numbers, not
     on the render.
3. **`rgbStandIn(value, role)` states what an RGB program shows for a value.** It lives beside
   `projectRGB` in components/color/values.ts, and `projectRGB` is its emission case. It is used
   by `emitSpectrum` and `emitIndex` in RGB programs, and by the preview warning.
4. **Minting in an RGB program.** For a named kind, the compiler keeps the kind's sliders and
   replaces the uniforms that only its wavelength evaluation reads with the one stand-in
   uniform. That uniform is named from the value's contents, so identical values share it.
5. **environment.ts** multiplies the sky's intensity outside the spectrum, in all three sky
   forms.

**Expected differences (to be confirmed by the digest):**
- **Shader text** of every scene with a sky: intensity moves outside the RGB lift. In RGB
  renders the values are identical, since the lift is the identity. In spectral renders they
  agree up to rounding, since the lift is 1-homogeneous.
- **Shader text, uniforms and closures** of RGB renderers with a slider-driven blackbody: one
  stand-in uniform replaces `scale × u_<kelvin>_blackbody`. Values agree up to float32
  rounding.

Nothing else should change.

**Verification:**
- The digest, before and after, shows exactly the expected differences.
- The full test run. Tests that pin the old RGB uniform (blackbodyPreservation.test.ts) are
  updated to the stand-in.
- **GPU:** the sky and blackbody witnesses the digest names, both color models, plus
  `witness:blackbody` and `witness:spectral`.
- **Review:** an independent review.

### As built (Sep 28), and what the independent review changed

- **Where the rule lives.** `rgbStandIn` sits beside `projectRGB` in components/color/values.ts,
  and `projectRGB` is its emission case. The preview warning fires exactly when `rgbStandIn`
  differs from `toRGB`.
- **Naming and the sky.** The stand-in uniform is named with a 32-bit hash of the value and role,
  in generate/values.ts. The sky's L = k·K is one helper in environment.ts.
- **One regression found and fixed.** In RGB programs a kind's slider metadata was rewritten at
  every use, so a shared temperature slider lost the range its first declaration gave. Sliders
  are now merged first-wins, as everywhere else, with a test that fails on the old code.
- **The output differences are exactly the predicted ones.**
  - Sky lines: the intensity now multiplies the finished spectrum. Blackbody spectral skies are
    byte-identical.
  - `hearth`, the only suite scene with an RGB slider-driven blackbody, now reads one stand-in
    uniform.
  - Slider metadata is unchanged everywhere.
- **Checks.** Full test run (4,059). GPU: the spectral skies, image, procedural and compensated
  skies, the blackbody twin and the RGB sky pass 16 of 16 checks, and `witness:blackbody` passes
  48 Planck probes.


## After step 3: three small improvements (owner approved Sep 28)

**1. The color model owns the wavelength bookkeeping.**

Problem: two facts about the four lanes live outside the color model:
- "lane 0 is the hero wavelength" is spelled `wl.lambda.x` in the Cauchy and Sellmeier kinds
  (cauchy.ts:42, sellmeier.ts:56);
- "collapse keeps lane 0 times four" is spelled `vec4(4.0, 0.0, 0.0, 0.0)` in the transport
  (pt.ts:448).

Change: the spectral color model's GLSL defines `wavelengths_hero(wl)` and
`spectrum_collapse_to_hero(s)`, and the kinds and the transport call them. The transport keeps
its own "already collapsed" flag, which is path state. Values are identical; shader text changes.

Verification:
- a scan test (fails today on 3 sites): no TypeScript source spells a lane (`lambda.x`,
  `lambda[0]`, `vec4(4.0, 0.0, 0.0, 0.0)`);
- the dispersion probe script's "missing compensation" mutation follows the factor into the
  color model, and `witness:dispersion` passes;
- the digest differs only in those lines.

**2. Delete `MaterialProperties.wl` and `MediumProperties.wl`.**

They are written at every lookup (materials.ts:370, :551; schema.ts:76) and read by nothing in
the renderer. Only the wavelengths probe script reads them, in four "carrier" probes and one
mutation that test the fields themselves; those go too. A future material whose reflection
depends on wavelength would add a way to receive it.

Verification: the digest differs only in the struct field and the two assignments, and
`witness:wavelengths` passes.

**Outcome: not done, reverted.** The field is the one member every properties struct is
guaranteed to have. In scenes whose materials are all `none` (the slab-albedo and GRIN
witnesses) no model reads any field. Without `wl`, `MaterialProperties` becomes an empty
struct, which GLSL rejects; the static compile failed for them. Replacing the field would
need a placeholder member, which is worse than what is there, so the field stays.

**3. The Validator's false "envSelectWeight controls nothing" warning.**

Problem: the warning counts only ordinary lights (Validator.ts:430). A scene whose only lamps are
instanced still splits samples between the sky and its lamps under the light tree, so the
setting is not inert there.

Change: "does this renderer sample instanced lamps" becomes one function in
plan/dataTenants.ts, `samplesBatchLights(strategy, lightBatches)`, which the Planner
(Planner.ts:493) and the Validator both call.

Verification: a test with instanced lamps and a sky under the light tree gets no warning
(fails today); the existing warning tests still pass.

---

## Appendix A: the independent review of the first draft

| Finding | Change |
|---|---|
| The model had no place for numbers computed on the CPU between binding and evaluation: blackbody's (T, 1/Y) today, light power, tracking bounds, stand-ins | §2's rule; the table is now derived from it |
| "A kind knows only two things" dropped its checks, `dispersive`, and the maximum over wavelength | §4 lists what a kind answers |
| The media clamp acts on RGB before the lift, and the 4 × ceiling bound depends on the RGB lift; a tracked constant medium with a named σ needs a maximum over wavelength | §6 |
| "The later cells need no new idea" was overclaimed: GLSL stand-ins, run-time domains, compile-time dispersion and per-instance power were missing | replaced by §2's rule |
| "The color through one meter" as an RGB coordinate is wrong in spectral renders (computed with the shipped lift) | §3: role-changing maps are kinds; the subsurface helper noted |
| "Formula parameters are sliders" is true only for material and medium formulas; a hue slider on a lamp needs a CPU-derived binding; HSV needs a linked GLSL helper and sRGB decoding | §1 lists the CPU-derived binding; §3 rewritten |
| Only three of the six role-from-kind sites substitute the kind's role; the direct-RGB list missed derived fields, schema defaults and the GRIN index; "RGB slider: every slot" is false under the light tree | §5 corrected; §2 covers the tree |
| Cauchy or Sellmeier in `medium.ior` would be dispersive GRIN, which is gated | §6 |
| A constant blackbody in a medium glows uniformly; a flame needs a density formula, and brightness is linear, so that is cheap | §1 example, §2, §6 |
| A formula can set only a kind's parameters, so iridescence cannot be written | question 3 |
| Media mint calls omit the color model, a trap for a blackbody slider in a medium | recorded for Part 2 |

The review found no slot whose role is not a property of the slot, and no conflict with the
measurement/estimator invariant, the trace-loop contract or the components purity rule.

## Appendix B: the independent review of Part 2's first draft

| Finding | Change |
|---|---|
| A GPU probe script reads `semantic` and is not type-checked (tsconfig covers src, tests, pages); after a rename it would crash or silently skip its probes | step 1, item 5; the script is run in verification |
| Medium and sky settings do not fit the material row shape (the GRIN index is neither a field nor a region table; a present `ior` switches GRIN on) | their declarations move to step 2, which rewrites that code anyway |
| "Every reader takes the role from the slot" was not true after step 1: settings without rows still write literal roles | step 1's rule narrowed; the remaining sites listed under "Unchanged", for step 2 |
| Six reads need "is it radiometric", not "has a role"; `SpectrumRole` belongs in descriptors.ts; lights take only radiometric roles; schema.ts has its own copy of the field | step 1, items 1 and 3 |
| Stale line numbers (lighting.ts:338, :96), 47 rows (45 plus 2), two different ternaries, and tests and documents that pin the row shape | corrected; step 1, item 5 |
| Step 7's RGB film formula was wrong (RGB is counting measure over three channels, not p = 1), the step changes RGB text, and it is not a sentence of Part 1 | dropped from this plan |
| Step 3 changes RGB shader text, so it is not a refactor | relabeled, with a GPU check |
| Step 2's byte-identity has two traps: the `vec3(0.8)` spelling of defaults and the fog clamp between numbers and evaluation | named in the step |
| Step 5 (was 4) needed its physics stated: one density for absorption, scattering and glow (keeps ε/σ_t), the bound on K_a + K_s, splitting `mediumBound`, and that RGB needs no density form | stated |
| Step 4 (was 5) did not say what becomes an error or name the checkers, and it rewrites a check the media step would edit | both stated; moved before the media step |
| The hue slider needs step 3; the transmittance kind was listed as a cleanup | step 6 says so; the kind moved into step 5 |
| Notation and code words in the owner-facing lines | notation defined; lines reworded |

The reviewer confirmed:
- that `semantic` can be removed (no production code reads `'geometric'`);
- the 18 reads, the 11 direct conversions and the six literal comparisons;
- that a byte-identical step 1 is possible;
- that a types-only medium declaration would respect the purity rule.

