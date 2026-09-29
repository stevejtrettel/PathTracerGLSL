# Spectra in every slot

**Status:** proposal (September 28, 2026), for the owner. Part 1, the model, is on this page;
Part 2, the wiring and build steps, follows once Part 1 is agreed.

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
  taken from the kind instead of the slot (plan/values.ts:13, Planner.ts:1016, lighting.ts:342).
- **Each named kind implements RGB rendering itself.**
- **The bindings are spread out.** Per-instance values are read at three sites, and the
  CPU-derived binding exists only inside blackbody and a few fields.

## 6. Media

Media are where the decision "any spectrum" first bites. There are two ways to write a medium
that varies in space:
- **An RGB field (today):** a formula returns RGB σ per point. The RGB is clamped to the
  authored ceiling, then lifted. The tracking bound, 4 × ceiling, holds because the RGB lift is
  at most twice the largest channel.
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
