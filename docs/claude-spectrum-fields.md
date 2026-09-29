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
stated fact of that color model. "Step 4 in full" (below) is the detailed plan. The owner
chose to leave that limit where it is (decision B): reflectance above 1 stays allowed in RGB
renders.

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


## Step 4 in full: each value is checked once

**Status:** approved by the owner (Sep 29), with decision B, and built the same day; see "As
built" at the end of this section. The plan was revised after an independent review, whose
findings follow the plan.

### The rule after this step

A setting holds one of four forms of value:
- a number or an RGB triple;
- a slider, `{ param, default, min?, max? }`;
- a formula, `{ kind: 'glsl', source, params? }`, whose `params` are sliders too;
- a named kind, `{ <id>: … }` (blackbody, Gaussian, Cauchy, Sellmeier).

An instanced batch can also give a setting one plain value per instance.

One function checks a value in its setting. It asks four questions:
1. **Keys.** A value has only its form's keys. A named kind has the one key `<id>`; a slider
   has `param`, `default`, `min` and `max`; a formula has `kind`, `source` and `params`. Any
   other key is an error. The form is decided in a fixed order: a named kind (in registry
   order), then a formula, then a slider. A value with an unknown key gets that one message
   and no other. An object that has no form's key (`{ foo: 1 }`) gets only the shape message,
   as today. Today's "keys of more than one kind of value" check is a special case of this
   rule, and it goes.
2. **Slider.** A slider has only its four keys, a parameter path and a default. Its min is at
   most its max, and its default lies between them. This holds for every slider in a setting:
   the value's own, a blackbody's kelvin and scale, and a formula's `params`.
3. **Domain.** Every number the value can take lies in the setting's domain: a constant, a
   slider's default and both ends, and each per-instance entry. The domain is the setting's
   own constraint, or else its role's: reflectance, coefficient and emission ≥ 0, index > 0.
   A formula's numbers are not known before the render, so its domain stays the author's
   contract, as today.
4. **Kind.** A named kind sits only in settings of its roles. Where its numbers sit in an
   object, the kind declares them as data: each one's name, its domain, whether it may be a
   slider, whether it may be omitted, and whether it is a triple. The checker applies
   questions 1–3 to them, and reports numbers that are not an object. The kind's own
   `validate` keeps only rules that relate several numbers, and runs only when the declared
   numbers are valid.

   | Kind | Declared numbers | `validate` keeps |
   |---|---|---|
   | blackbody | kelvin in [1000, 40000], may be a slider; scale ≥ 0, may be a slider, optional | nothing |
   | Gaussian | center; width > 0; peak in [0, 1]; floor in [0, 1], optional | nothing |
   | Sellmeier | B and C, triples ≥ 0 | poles outside the visible range; n² > 0 |
   | Cauchy | none (its numbers are an array) | its whole check, as today |

Every setting calls this function: material rows, a material's fallback emission, light
emission, the constant sky, the fog's settings and the phase rows. The per-instance check
calls its constant test once per entry.

Spectral renders keep one more check, in analyze/spectral.ts: what the spectral lift can
represent (reflectance ≤ 1, and the fog's ceilings). See the decision below.

### The decision: reflectance above 1

Today a reflectance above 1 is an error in spectral renders and allowed in RGB renders.

| | A: [0, 1] becomes reflectance's domain | B: leave it as today |
|---|---|---|
| Albedo 1.5 in an RGB render | error | allowed |
| Earlier decisions | Reverses the approved spec: "RGB reflectance above 1 stays allowed, as today" (claude-spectrum-spec.md:344). Closes the open research-gain proposal R-6, which would let the spectral lift accept values above 1 (claude-spectral-implementation-plan.md:268–282). The pinned taxonomy admits non-physical transport (fable-strategy-taxonomy.md:203–204). | keeps all three |
| RGB and spectral | the same errors, except the fog's ceilings | a scene can fail only in spectral |
| Code | analyze/spectral.ts loses its reflectance checks | analyze/spectral.ts unchanged |
| pbrt-v4, Mitsuba 3 | both reject an RGB albedo above 1: pbrt paramdict.cpp:399; Mitsuba srgb.cpp:56, in its RGB modes too, unless the author sets `unbounded` | — |
| Scenes affected | none of the 268 suite scenes (measured). The data scene `c32`'s color ramp reaches about 1.00005 (from the hit count in its comment, demos/dataScenes.ts:94; the file is not in this checkout), so it would need `min(t, 1)`. | none |
| Tests to update | spectralPacked.test.ts:39–57 (three cases), and the snapshot's three reflectance cases | none |

**Recommendation: B.** My first draft recommended A. The review showed that A reverses a
decision the spec records and would close R-6. That is a policy choice for you, not a
cleanup. B is the smaller step. If you decide R-6 is not wanted, A is a short separate
change, and the table above is its whole cost: no suite scene breaks, and `c32` needs one
line.

A third route, making the spectral model state its limit instead of analyze/spectral.ts,
would pass the color model into seven checks. That is not worth it while R-6 may change the
limit.

### Problem (read and measured Sep 29, at commit 25d2320)

**Four checkers:**
- `validatePropertyValue` (propertyValidation.ts:81–148) checks the keys of two kinds, the
  role, the slider's structure, the shape and the domain.
- analyze/spectral.ts, spectral renders only:
  - reflectance ≤ 1 on material rows (:47–55) and per-instance entries (:21–31), with its own
    reading of slider defaults and bounds (`atMost`, :15–20);
  - the fog's ceilings (:32–46), which also use `atMost`.
- Blackbody's `checkDial` (blackbody.ts:96–105) is a second slider check, with its own
  combined message ("requires finite values in [1000, 40000], including defaults and bounds").
- The per-instance entry check (Validator.ts:1202–1245) has its own shape and domain tests.

**Two more readers:**
- The RGB preview warning (rgbPreview.ts:16–20) tests the role itself, and runs the kind's
  check with a dummy reporter to learn whether a value is valid.
- A formula's `params` (Validator.ts:1721–1746) are checked only for a path and a finite
  default. `params: [{ param, default: 5, min: 0, max: 1 }]` passes (measured by the review).

**Inputs that pass silently today.** Measured with a probe of the Validator, in both color
models:
- `{ blackbody: { kelvin: 3000 }, scale: 5 }`: a key beside the kind, and the lamp renders at
  scale 1;
- `{ gaussian: { …, flor: 0.1 } }` and `{ sellmeier: { B, C, D } }`: unknown keys inside a
  kind (blackbody reports its own since the A2 fix; the others do not);
- `{ param: 'm.a', default: 0.5, mn: 0 }`, the same on blackbody's kelvin, and
  `{ kind: 'glsl', source, sorce }`: a misspelled key on a slider or a formula;
- `{ param: 'm.a', default: 0.9, min: 0, max: 0.5 }`, and the same on blackbody's kelvin and
  on a formula's parameter: a default outside its own slider range.

**Impact of the new errors (measured).** The 268 synchronous suite scenes hold 58 sliders in
settings (6 of them blackbody numbers), 17 formula parameters, 59 formulas and 37 named-kind
values. None has an unknown key or a default outside its slider range. (They also hold 14
sliders in placements and 76 in strategies, which this step does not check.) The 7 data
scenes load files that are not in this checkout.

### What changes

1. **The constraint vocabulary** (descriptors.ts) gets a closed interval,
   `{ kind: 'closed-interval', min, max }`, for blackbody's kelvin and Gaussian's peak and
   floor. The existing `interval` is open (the camera's field of view).
2. **One checker** (propertyValidation.ts):
   - `valueProblems(value, setting, label)` returns messages. It replaces
     `validatePropertyValue`, and its six call sites report what it returns.
   - `numberProblems(value, shape, domain, label, slider)` checks a constant or, where
     allowed, a slider. Plain values, a kind's declared numbers and a formula's `params` all
     use it.
   - `constantProblem(value, shape, domain)` checks one constant; the per-instance check uses
     it.
3. **The slider's structure** (param.ts, `valueParamProblems`) gains three checks:
   - only the four keys;
   - "needs a default", moved from propertyValidation.ts;
   - "default between min and max": per component, against each finite bound, and skipped
     when min > max, which is already reported.

   The formula's key list sits beside `isGlslExpression` (compiler/types.ts).
4. **The kind contract** (spectrumKind.ts):
   - It states that a named kind's value is `{ <id>: … }`; all four already are.
   - A new `fields?` holds the declared numbers of the table above.
   - `validate` keeps its signature. It now holds only rules that relate several numbers, and
     the checker calls it only when the fields are valid.
   - Blackbody's `validate` goes, including `checkDial`, and so does Gaussian's. Sellmeier's
     loses its triple test.
   - `namedKindsClaiming` (spectra/index.ts) loses its only caller and goes.
5. **A formula's `params`** (Validator.ts:1721–1746) are checked by `numberProblems` as
   sliders with no domain. The warning for a parameter the formula never reads stays.
6. **The per-instance check** (Validator.ts) keeps its rules about which settings may vary per
   instance, array lengths and exclusivity. It tests each entry with `constantProblem`, and
   reports the first bad entry as today.
7. **The RGB preview warning** asks the checker whether a value is valid
   (`valueProblems(…).length === 0`), instead of its own role test and dummy reporter.
8. **Documents:** the spectra README (the contract and the registry), and the blackbody,
   Gaussian and Sellmeier READMEs where they state their domains.

### Unchanged

- Shaders, uniforms, parameters, the Planner and scene data. Only diagnostics change.
- analyze/spectral.ts (decision B), including the fog's ceilings, which step 5 rewrites.
- The fog still rejects named kinds (step 5).
- Rules that belong to a setting rather than a value: lights and the constant sky take no
  formula, and some rows cannot vary per instance.
- Cauchy's check, and Sellmeier's pole and n² checks, with their messages.
- Every message about a plain value, except the new errors and a packed per-instance array's
  non-finite message, which now names the entry like the others.

### Verification, written first

1. **A new test fails today** (tests/compiler/valueChecks.test.ts). Each input listed under
   "pass silently today" gets an error, in both color models. The same value with the key or
   the default corrected gets none.
2. **A contract test** (spectrumKinds.test.ts):
   - every named kind has an example value;
   - each example has the single key `<id>`;
   - where a kind declares `fields`, they name every key of its example.
3. **The diagnostics snapshot** changes in exactly these 12 cases:
   - kelvin below range, and kelvin slider default above range: "…blackbody kelvin must be in
     [1000, 40000]";
   - negative scale, both cases: "…blackbody scale components must be >= 0";
   - Gaussian peak above 1 and zero width: a message for the one number ("…Gaussian peak must
     be in [0, 1]", "…Gaussian width must be > 0");
   - Sellmeier negative B: "…Sellmeier B components must be >= 0";
   - Sellmeier wrong length: one message each for B and C;
   - the three "keys together" cases: an unknown-key message instead of "more than one kind
     of value";
   - albedo slider max −1: a second error, since its default 0.5 lies above its max.

   The other 37 cases are unchanged, including kelvin min above max, the unknown-object cases
   and the RGB gamut warning. The new inputs are added as cases.
4. **The digest** is identical for all 268 synchronous scenes: only diagnostics change, and no
   suite scene trips a new error.
5. **Static checks:** `npx tsc --noEmit` and the full `npx vitest run`.
6. **No GPU runs.** The digest shows the shaders are unchanged.
7. **An independent review** of the diff, before it is reported as done.

### Not in this step

- **Sliders shared across settings.** When two settings name the same parameter path, the
  first declaration's range wins (generate/values.ts:135, :152). A slider shared by a light's
  emission (max 5) and an albedo (max 1) reaches 5 in the albedo, and each declaration passes
  its own check (measured by the review). A rule that every declaration of a path agree would
  close this; it is a separate item.
- **Misspelled setting names.** `albdo`, `sigam_s` or `colr` on a material, medium or sky
  pass silently; unknown light fields only warn (Validator.ts:96–101). This step checks the
  keys inside a value, not the names of a setting. Making those errors is a separate item.
- **Sliders in other families** keep their own checks: placements and the camera
  (Validator.ts:808–826). With `numberProblems` in place, the camera's becomes one call.
- **HG's |g| ≤ 0.99** (Validator.ts:398–412) could become that row's closed-interval
  constraint. It is a separate item, because it turns a warning into an error.
- **A NaN** is still reported by the scene-wide finiteness sweep as well.
- **Named kinds in fog, and the fog's ceilings:** step 5.

### The independent review of this plan's first draft

| Finding | Change |
|---|---|
| `atMost` cannot go: the fog's ceilings use it (spectral.ts:43) | analyze/spectral.ts is untouched under B |
| Option A breaks three cases in spectralPacked.test.ts:39–57, missing from the verification | listed under A |
| The decision table omitted the spec's "RGB reflectance above 1 stays allowed", the open R-6 gain proposal and the pinned taxonomy | added; the recommendation changed from A to B |
| "Every number the value can take lies in the domain" fails for a slider shared across settings | listed under "Not in this step", with the measured case |
| A kind's slider numbers skipped the key rule (`{ kelvin: { param, default, mn } }` passes) | the slider's key check sits in `valueParamProblems`, which every slider uses |
| The order in which a value's form is decided, and the `{ foo: 1 }` case, were unstated | stated in rule 1 |
| The kind contract was underspecified (`ctx.number` had no shape; labels and reporting unstated). The reviewer suggested declaring a kind's numbers as data. | adopted: `fields`, with `validate` kept for rules relating several numbers |
| Under A, descriptor row defaults would lose their only check (spectral.ts:49) | moot under B; if A is chosen, a contract test checks every row default against its domain |
| Under A, [0, 1] would be stated three times (the role, the stand-in clip, Gaussian) | noted for A: `roleDomain` would move beside `SpectrumRole` |
| "165 sliders" mixed settings, formula parameters, placements and strategies; formula parameters inside these settings kept a weaker check | counts corrected; formula parameters are included |
| Unknown keys inside values become errors while misspelled setting names pass silently | listed under "Not in this step" |
| `checkDial` does reject a missing default, through its range message; B would touch seven call sites, not six | corrected |

The reviewer confirmed the line citations, the callers of every function this step deletes or
changes (a full search of src, tests, scripts, tools, pages and demos), every input listed as
passing silently, the suite counts, the form `{ <id>: … }` of all four kinds, and, for option
A, the snapshot prediction case by case.

### As built (Sep 29), and what the independent review changed

Built as planned, with decision B: a reflectance above 1 stays allowed in RGB renders, and
analyze/spectral.ts keeps its checks (one stale comment line changed).

**Details the plan left open, or that differ from it:**
- **The slider's key check** is made by the checker (`numberProblems`), so that a slider with
  an unknown key gets that one message. The key list `SLIDER_KEYS` and the one wording
  helper `unknownKeysProblem` sit in param.ts. `valueParamProblems` checks the path, the
  default's presence and the order of the bounds.
- **The default is compared with its slider's ends** in the checker as well, after its shape
  is checked (a review fix, below).
- **Unknown keys** read "has an unknown key 'x' (its keys: …)".
- **A per-instance array** reports its first entry with any problem. Before, a shape problem
  anywhere was reported ahead of a domain problem.
- **A formula's parameters** get the slider messages, which replace "params entries must be
  { param: string, default: finite number }". A formula with an unknown key still has its
  parameters checked by their own sweep, so it can get two messages.
- **`rowSetting`** turns a material or phase row into a setting; that mapping was written in
  three places.
- **The blackbody, Gaussian and Sellmeier READMEs** needed no change: what they state is
  still true.

**The independent review of the code:**

| Finding | Change |
|---|---|
| A formula whose `params` is a string made the Validator throw (before, it was reported); an object or a number threw before too | all three are reported; test added |
| A slider default of the wrong shape also got "default must be <= max" | the comparison moved after the shape check; test added |
| Deviations: where the slider's key check sits, which per-instance entry is reported, the formula-parameter messages, and blackbody's "{ kelvin, scale? }" losing its "?" | recorded above; the "?" restored for optional numbers |
| Stale text: this note, the spectra README (Sellmeier's rules; a new kind needs an example in the contract test), the constraint list in descriptors.ts, a comment left above the wrong function, analyze/spectral.ts's comment | fixed |
| Two regexes also matched "needs a default"; the contract test checked only its own literal | regexes tightened; the test also asks the kind's `is` |

Not fixed, because they predate this step:
- a formula without `source` passes validation, and with `params` the Validator throws on it;
- with decision B, a NaN in a spectral render still gets analyze/spectral.ts's extra
  "requires RGB in [0,1]".

The reviewer confirmed that all 268 suite scenes (495 renderers) get the same errors and
warnings before and after, and ran about 100 malformed inputs against both versions.

**Checks:**
- The new value test failed first on all 20 of its cases, and the contract test failed first.
  The two regression tests from the review were added after the fixes; the reviewer measured
  the old behavior.
- The diagnostics snapshot changed in exactly the 12 predicted cases, and 9 cases were added.
- The digest: 268 of 268 scenes identical, before and after the review fixes.
- The full test run: 109 files, 4,095 tests, and `tsc` clean. One earlier run had a glslang
  static-compile test time out at 80 s; it passed alone and in a full rerun.

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

