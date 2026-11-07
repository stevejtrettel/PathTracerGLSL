# How pbrt-v4, Mitsuba 3 (and Cycles, Falcor) are built — lessons for a small, clean GPU path tracer

Reader: research survey, read-only. Date 2026-11-06.

## Provenance

**Read from source** (downloaded with curl from raw.githubusercontent.com, master/main, today):

- pbrt-v4 (`src/pbrt/…`): base/bxdf.h, base/light.h, base/medium.h, base/material.h,
  base/texture.h, base/lightsampler.h, base/camera.h, base/film.h, base/filter.h,
  base/sampler.h, base/shape.h, bsdf.h, bxdfs.h, interaction.h, interaction.cpp, lights.h,
  lights.cpp, lightsamplers.h, media.h, materials.h, textures.h, paramdict.h, samplers.h,
  util/scattering.h, cpu/integrators.h, cpu/integrators.cpp, wavefront/integrator.h.
- Mitsuba 3: core/object.h, core/properties.h, core/plugin.h, render/bsdf.h,
  render/emitter.h, render/endpoint.h, render/medium.h, render/phase.h, render/texture.h,
  render/sensor.h, render/film.h, integrators/path.cpp, integrators/volpath.cpp,
  bsdfs/roughconductor.cpp, bsdfs/normalmap.cpp.
- Cycles (blender/cycles main): kernel/integrator/ directory listing, megakernel.h,
  volume_stack.h, guiding.h, kernel/light/tree.h header.
- Falcor: Source/Falcor/Rendering/Materials/IMaterialInstance.slang.
- OpenPBR Surface spec v1.1.2 (academysoftwarefoundation.github.io/OpenPBR, first 100k chars
  via WebFetch summary — summarized by a fetch model, so treat details as "read via summary").

Downloaded copies (untrusted data, for re-checking line numbers):
`/private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/src-pbrt/`,
`…/scratchpad/src-mi3/`, `…/scratchpad/src-cycles/`, `…/scratchpad/src-falcor/`.
File names flatten the path: `base/bxdf.h` → `base_bxdf.h`, `cpu/integrators.cpp` →
`cpu_integrators.cpp`, Mitsuba `render/bsdf.h` → `render_bsdf.h`.

**Remembered, not re-read** (marked [mem] below): papers (Miller–Georgiev–Jarosz 2019
null-scattering path integral; Kulla–Conty 2017 energy compensation; Jakob–Hanika 2019;
Müller 2017 practical path guiding; Bitterli 2020 ReSTIR; Lin 2022 GRIS; Conty–Kulla 2018 light
tree); Cycles path guiding being CPU-only; Falcor's IMaterial/Slang dispatch details beyond the
one file read.

---

## 1. Scene description and parameters

### pbrt-v4 (read)
- Text scene file → `ParameterDictionary` per directive. Typed getters with defaults:
  `GetOneFloat(name, def)`, `GetOneSpectrum(name, def, SpectrumType, alloc)`
  (paramdict.h:142–154). Every parameter records `lookedUp` (paramdict.h:46) and
  `ReportUnused()` (paramdict.h:170) errors on parameters nobody read — the dictionary,
  not a schema, catches typos.
- `SpectrumType { Illuminant, Albedo, Unbounded }` (paramdict.h:70): the *role* of a
  spectrum slot decides how an RGB value is lifted (bounded reflectance vs illuminant vs
  unbounded coefficient). The project's spectrum "roles" (reflectance, emission, coefficient,
  index) are the same idea — independent confirmation of that design.
- Each class has `static X Create(const ParameterDictionary&, …)`: the constructor reads its
  own parameters. No separate descriptor/schema object; the code that reads the parameter is
  its declaration.
- pbrt has **no live parameters**: a render is a batch job.
- Polymorphism: `TaggedPointer<A, B, C…>` (e.g. base_bxdf.h:166–169; base_light.h:40–45)
  — a closed list of types and a switch-dispatch, which is what the GPU build needs. Adding a
  type = add the class + add it to the list. That is the same shape as the project's
  "one folder + one registry line".

### Mitsuba 3 (read)
- `Properties` (core/properties.h): a typed dict; `get<T>(name)`, `get<T>(name, default)`
  (:293, :306); it also tracks queried keys: `was_queried`, `unqueried()`,
  `mark_queried` (:100–102, :543–565) → unknown keys are reported, as in pbrt.
- `PluginManager::register_plugin(name, variant, type, instantiate, …)` (core/plugin.h) —
  a string → factory registry. Plugins nest: a `normalmap` BSDF holds a nested `bsdf`
  (bsdfs/normalmap.cpp, `PerturbedBSDF` base, `m_nested_bsdf`).
- **Live/differentiable parameters = `traverse()`** (core/object.h:132) +
  `parameters_changed(keys)` (core/object.h:154). Every object reports its parameters to a
  callback: `cb->put("alpha", m_alpha_u, ParamFlags::Differentiable | ParamFlags::Discontinuous)`
  (bsdfs/roughconductor.cpp:241–254). Keys are the object-graph path (e.g.
  `"red.reflectance.value"` in Python's `mi.traverse(scene)` [mem for the key spelling]).
  After a change, the owner of the field recomputes derived data in
  `parameters_changed` (roughconductor.cpp:214–224 precomputes the microfacet distribution
  when roughness is uniform).
- `ParamFlags { Differentiable, NonDifferentiable, Discontinuous, ReadOnly }`
  (core/object.h:408–420): one small per-parameter fact sheet.

**Lesson for this project.** Both systems keep parameter *declaration* next to the code that
reads it, and they get typo detection from "was this key read?" instead of a schema. Mitsuba's
model of live parameters is the cleanest available: the parameter set is *derived from the
object graph* (`traverse`), not authored separately, and one hook per object
(`parameters_changed`) updates derived quantities. The project instead marks sliders
explicitly in the scene with `{param, default, min, max}` (src/components/param.ts:1–35) and
descriptors declare `derived` fields (e.g. ggx.ts:19–22, alpha = max(1e-3, roughness²)
computed on the host). The two models differ in who decides what is live: Mitsuba exposes
everything; the project exposes only what the author marks. Neither is wrong; Mitsuba's
`parameters_changed` hook is the same idea as the project's host-side `derived` closures.

## 2. BSDF interface and textures

### pbrt-v4 (read)
- `BxDF` interface (base/bxdf.h:166–196): `Flags()`, `f(wo, wi, mode)`,
  `Sample_f(wo, uc, u, mode, sampleFlags)`, `PDF(wo, wi, mode, sampleFlags)`, `rho(...)`,
  `Regularize()`. All directions are in the **local shading frame** (z = shading normal).
- `BSDF` (bsdf.h:19–) = `BxDF` + `shadingFrame = Frame::FromXZ(normalize(dpdus), ns)`; it
  converts world↔local and rejects `wo.z == 0`, `pdf == 0`, `wi.z == 0`.
- `BSDFSample { f, wi, pdf, flags, eta, pdfIsProportional }` (base/bxdf.h:121–152).
  `f` is bare f (the integrator multiplies `AbsDot(wi, ns)`, cpu/integrators.cpp:724).
  `pdfIsProportional` exists for stochastic BxDFs (layered) whose sample pdf is not exact.
- Flags: Reflection/Transmission × Diffuse/Glossy/Specular (base/bxdf.h:48–64). **Flags are
  per instance, at run time**: `ConductorBxDF::Flags()` returns Specular when
  `mfDistrib.EffectivelySmooth()` (`max(alpha) < 1e-3`, util/scattering.h:137), else Glossy;
  `DielectricBxDF` likewise (bxdfs.h:176–180). So one conductor model covers mirror and rough
  metal, one dielectric covers smooth and rough glass, even under a roughness texture.
- `Regularize()` (scattering.h:200–204): after a non-specular bounce, low roughness is raised
  to [0.1, 0.3] — an opt-in *bias* (`regularize` parameter, default false).
- Materials vs BxDFs: `Material::GetBSDF(texEval, ctx, lambda, buf)` (base/material.h:53–55)
  evaluates textures, then builds a BxDF. Normal/bump mapping live on the material
  (`GetNormalMap`, `GetDisplacement`), applied in `SurfaceInteraction::GetBSDF`
  (interaction.cpp:159–199): differentials → resolve MixMaterial → normal/bump map (needs
  `shading.dpdu/dpdv`, materials.h:86–139) → BSDF. `MixMaterial` picks one of two materials
  stochastically with a hash (materials.h, `ChooseMaterial`).
- Spectrally varying IOR: `if (!eta.Is<ConstantSpectrum>()) lambda.TerminateSecondary();`
  (materials.h:186, :231) — the same "hero collapse" the project does.
- Conductors use full complex Fresnel `FrComplex(cos, eta, k)` per wavelength
  (util/scattering.h:81–100).
- Thin dielectric: inter-reflections summed in closed form, `R += Sqr(T) * R / (1 - Sqr(R))`
  (bxdfs.h:228).
- Layered: `LayeredBxDF<Top, Bottom, twoSided>` (bxdfs.h:432–899) evaluates f *stochastically*
  (random walk between interfaces, `nSamples`, `maxDepth`) and returns an approximate pdf
  `Lerp(0.9, 1/(4π), pdfSum/nSamples)` (bxdfs.h:882). CoatedDiffuse / CoatedConductor are
  instances (bxdfs.h:903–919).
- Textures: `FloatTexture` / `SpectrumTexture` tagged pointers with
  `Evaluate(TextureEvalContext)` (base/texture.h:34–94). The context carries
  `p, dpdx, dpdy, n, uv, dudx, dudy, dvdx, dvdy` (textures.h:30–60) for filtering. pbrt
  approximates differentials after the first bounce from the camera
  (`Camera::Approximate_dp_dxy`, interaction.cpp:63–66), and has an option
  `disableTextureFiltering` (interaction.cpp:43).

### Mitsuba 3 (read)
- `BSDF::sample(ctx, si, sample1, sample2) → (BSDFSample3f, weight)`, `eval`, `pdf`,
  `eval_pdf`, `eval_pdf_sample` (render/bsdf.h:400–530). **`eval` includes the cosine**
  ("multiplied by the cosine foreshortening factor", render/bsdf.h:396). `weight` = f·cos/pdf.
- `BSDFContext { mode, type_mask, component }` (render/bsdf.h:137–175) lets a caller sample
  only some lobes.
- `BSDFSample3 { wo, pdf, eta, sampled_type, sampled_component }` (render/bsdf.h:183–215).
- Flags (render/bsdf.h:31–110): adds `Null` (index-matched pass-through), `Delta1D`,
  `Anisotropic`, `SpatiallyVarying`, `NonSymmetric`, `FrontSide/BackSide`, `NormalMapped`,
  and the compound `NeedsTangents = Anisotropic | NormalMapped`.
- `eval_null_transmission` (render/bsdf.h:535–545) for null lobes; the path integrator
  treats a null crossing as "not a path vertex" (integrators/path.cpp, Vertex comment).
- Normal mapping is a *decorator* BSDF that wraps another BSDF (bsdfs/normalmap.cpp).
- `eval_attribute(name)` / `eval_diffuse_reflectance` give denoiser/AOV values.

### Falcor (read: IMaterialInstance.slang)
- `eval(sd, wo, sg)` (:168), `sample(sd, sg, out BSDFSample, useImportanceSampling)` (:187),
  `evalPdf(sd, wo)` (:195), `getProperties(sd) → BSDFProperties` (:201, guide albedo,
  roughness, F0 — for denoisers), `getLobeTypes` (:233). `BSDFSample.weight` =
  f·cos/pdf (:46). Material (data) vs MaterialInstance (per-hit BSDF) split, like
  pbrt Material vs BxDF and the project's `scene_material_properties` + model functions.

**Lesson for this project.** The project's material contract (src/components/materials/README.md:13–29)
already matches the consensus: eval/sample/pdf triple, bare f (pbrt convention), weight =
f·cos/pdf (pbrt/Falcor), delta lobes with pdf 0, `uc`/`u` split, an albedo fact for AOVs
(Falcor `BSDFProperties`). Differences that matter for future photorealism:
1. **Delta-ness is a static per-model capability** in the project (`nonDeltaLobes: false` for
   mirror/dielectric, `true` for ggx/rough_dielectric — materials/*/*.ts) with GGX alpha
   clamped at 1e-3 on the host (ggx.ts:19–22). pbrt decides per hit from the actual alpha.
   With roughness textures (a photorealism staple) a model must be able to be "delta here,
   glossy there".
2. **No tangent from the parameterization**: `Hit.frame` is built from the normal only,
   `ambient_frame(hit.p, n)` (compiler/generate/features/intersection.ts:709, :906, :1025),
   whose tangent is an arbitrary choice (ambient/euclidean/euclidean.glsl:13–19). Normal maps,
   anisotropic roughness and tangent-space textures need `dpdu` (pbrt `shading.dpdu`,
   Mitsuba `NeedsTangents`).
3. **No texture differentials.** Fine for a progressive tracer: stochastic supersampling over
   the pixel converges to the pixel integral of the texture; prefiltering (mipmaps) actually
   *changes* the converged image (blurs), which under the project's measurement/estimator
   rule would be a measurement choice. pbrt itself can turn filtering off
   (interaction.cpp:43).

## 3. Lights and light sampling

### pbrt-v4 (read)
- `Light` (base/light.h:40–95): `Type()` ∈ {DeltaPosition, DeltaDirection, Area, Infinite},
  `SampleLi(ctx, u, lambda, allowIncompletePDF) → {L, wi, pdf, pLight}`,
  `PDF_Li(ctx, wi, allowIncompletePDF)`, `L(p, n, uv, w)` for area lights, `Le(ray)` for
  infinite lights, `Phi` (power), `Bounds()` (for the light BVH). `allowIncompletePDF` is the
  hook for MIS compensation of environment maps.
- **One area light for every shape**: `DiffuseAreaLight::SampleLi` calls
  `shape.Sample(shapeCtx, u)` and `PDF_Li` calls `shape.PDF(shapeCtx, wi)`
  (lights.cpp:740–768). The *shape* owns sampling as seen from a point
  (base/shape.h:57–64: `Sample(u)`, `PDF(Interaction)`, `Sample(ctx, u)`, `PDF(ctx, wi)`).
- `LightSampler` (base/lightsampler.h:29–47): `Sample(ctx, u) → {light, p}`,
  `PMF(ctx, light)`; Uniform, Power, Exhaustive, BVH. The BVH sampler gives infinite lights a
  separate probability (`pInfinite`, lightsamplers.h:267–288) and computes `PMF` for MIS by
  walking a per-light bit trail (lightsamplers.h:323–355) with `LightBounds::Importance(p, n)`
  (:144).
- The integrator multiplies the two: `p_l = lightSampler.PMF(ctx, light) * light.PDF_Li(ctx, wi)`
  (cpu/integrators.cpp:668–670).

### Mitsuba 3 (read)
- Emitters and sensors share one base, `Endpoint` (render/endpoint.h): `sample_ray`,
  `sample_direction`, `pdf_direction`, `eval_direction`, `sample_position`, `pdf_position`,
  `eval`, `sample_wavelengths` (:102–313). The scene wraps emitter choice:
  `scene->sample_emitter_direction(si, u, test_visibility)` and
  `scene->pdf_emitter_direction(...)` (integrators/path.cpp:242, :197) — the integrator never
  sees the light-selection policy.

### Cycles (read: tree.h header)
- Light tree = Conty–Kulla 2018, modified: no splitting, importance chosen between max and min
  bounds, distant lights added.

**Lesson for this project.** The project matches pbrt in its light sampler (power, uniform,
BVH light tree) and in the solid-angle pdf convention (src/components/lights/README.md:9–19).
It differs in giving every emitter shape its own light kind with its own sampler + pdf
(quad, sphere, disk, mesh — lights/README.md), plus a `region` link and the
`valuesFromRegion` inverse. pbrt puts the "sample me from a point" pair on the *shape*, so an
area light is just "shape + emission". The pbrt split gives one place to answer "how do I
sample this shape from p", which is also where curved space must plug in (§8 below).

## 4. Media

### pbrt-v4 (read)
- A medium has two methods: `SamplePoint(p, lambda) → {sigma_a, sigma_s, phase, Le}` and
  `SampleRay(ray, tMax, lambda) → RayMajorantIterator` (base/medium.h:76–100; media.h:73–77).
  Majorant iterators: homogeneous (one segment) and DDA over a majorant grid
  (base/medium.h:61–73).
- **One routine for every medium**: `SampleT_maj(ray, tMax, u, rng, lambda, callback)`
  (media.h:735–797) walks majorant segments, samples exponential distances with
  `sigma_maj[0]` (the hero wavelength), and calls back at each tentative collision with
  `(p, mp, sigma_maj, T_maj)`. Even `HomogeneousMedium` goes through it
  (media.h:217–261: its iterator is one segment with sigma_maj = sigma_t, so null
  collisions never happen).
- The integrator's callback decides absorb / scatter / null with probabilities
  `sigma_a/sigma_maj`, `sigma_s/sigma_maj`, rest (cpu/integrators.cpp:997–1012).
- **MIS with delta tracking** via *rescaled path probabilities* `r_u`, `r_l`
  (cpu/integrators.cpp:956, :1043–1050, :1072–1078; shadow rays with ratio tracking and a
  roulette on `T_ray`, :1343–1374; final weights `beta*f*T_ray*L / (r_l + r_u).Average()`,
  :1388–1392). This is the Miller–Georgiev–Jarosz 2019 null-scattering formulation [mem for
  the paper]. It also gives spectral MIS over the wavelengths (the `.Average()` is a
  one-sample balance heuristic over the 4 wavelengths).
- Media are attached to surfaces as a `MediumInterface {inside, outside}`
  (base/medium.h:103–118); a surface with no material is an interface that rays skip
  (`SkipIntersection`, cpu/integrators.cpp:1197–1200). No medium stack.

### Mitsuba 3 (read)
- Medium: `intersect_aabb`, `get_majorant(mi)`, `get_scattering_coefficients(mi) →
  (sigma_s, sigma_n, sigma_t)`, `sample_interaction(ray, sample, channel)`
  (render/medium.h:20–55). `volpath` documents: no good sampling for spectrally varying
  extinction; use `volpathmis` for spectral MIS (integrators/volpath.cpp docstring).

### Cycles (read: volume_stack.h)
- Cycles keeps a **volume stack** (array of object/shader ids the path is inside).

**Lesson for this project.** The project's "innermost wins, no stack, null interfaces"
(docs/fable-transport-verification.md, per CLAUDE.md) is the pbrt/Mitsuba model
(MediumInterface on surfaces), not Cycles'. Its listed gap "MIS with delta tracking" (CLAUDE.md
"Not built") has a reference solution in ~60 lines of pbrt (r_u/r_l). pbrt also shows that
analytic homogeneous and delta-tracked heterogeneous media can share one code path (a
homogeneous medium = one majorant segment with sigma_maj = sigma_t), where the project has
separate `transport/volume/analytic` and `transport/volume/delta_tracking` occupants.

## 5. Integrator structure

### pbrt-v4 PathIntegrator (read: cpu/integrators.cpp:628–812)
About 135 lines for `Li` + 50 for `SampleLd`. Concepts: `L, beta, depth, p_b, etaScale,
specularBounce, anyNonSpecularBounces, prevIntrCtx`. Loop: intersect → (miss: env with MIS)
→ emission with MIS → GetBSDF (null material = skip interface, `specularBounce = true`) →
`if (depth++ == maxDepth) break` → NEE if non-specular → sample BSDF → update beta, p_b →
spawn → RR on `beta * etaScale` after depth 1. **Emission at the max-depth vertex is counted,
NEE and continuation are not** — the same budget rule the project pins.

### pbrt-v4 VolPathIntegrator (read: :953–1406)
About 320 lines for `Li` + 130 for `SampleLd`, including BSSRDF probe-ray sampling. Same
skeleton plus `r_u, r_l` and the `SampleT_maj` callback.

### Mitsuba 3 path (read: integrators/path.cpp:102–300)
About 200 lines. One `dr::while_loop` whose state is a struct (`LoopState`, `Vertex`).
Uses `bsdf->eval_pdf_sample` (one call for NEE eval + BSDF sample, :255). It keeps a
`Vertex` = last *real* scattering vertex; "Null crossings are not path vertices and leave it
unchanged". Scene-constant features fold at compile time: "Null tests fold to literals in
scenes without null shapes" (:122, `bool has_null = scene->has_null_shapes()`). The same loop
compiles to a megakernel or wavefront (comment at the loop).

### Cycles (read: megakernel.h)
The path is a **state machine** over kernels (INTERSECT_CLOSEST, SHADE_SURFACE,
SHADE_VOLUME, INTERSECT_SHADOW, SHADE_SHADOW, SHADE_BACKGROUND, …). On GPU each is a separate
kernel with queues; the megakernel is a `while(true) switch(next_kernel)` over the same
functions (megakernel.h:22–110).

### pbrt-v4 wavefront (read: wavefront/integrator.h:168–185)
Queues: ray (double-buffered), escaped, hit-area-light, material-eval (basic/universal),
medium-sample, medium-scatter, shadow, BSSRDF. Requires compute + global memory queues — not
available in WebGL2 (owner decision 6 in docs/claude-2026-11-review/decisions.md keeps this
repo WebGL2; a megakernel per program is the right shape here).

**Lesson for this project.** All three references write the loop **once, by hand, as
straight-line code**, with scene features as run-time or compile-time-constant booleans. The
project instead *generates* the loop text in TypeScript (src/components/transport/integrators/pt/pt.ts,
475 lines; `walk()` at :299) from a `Flags` object (transport/flags.ts), with generated
`PathState` fields per flag (:147–176), two roulette functions, light-query constructors,
`shadow_crossings_left`, and so on. The concept count of the walk itself is comparable to
pbrt's VolPath, but a reader must read TS that emits GLSL rather than the GLSL. Mitsuba's
`has_null` folding is the reference pattern for "pay only for what the scene uses" without
text generation: a scene-constant `const bool` in GLSL is folded by every GLSL compiler. This
conflicts with the owner's *exact-linkage* rule (a function exists only if something calls it;
CLAUDE.md "Exact linkage") because the static loop would reference every technique's
functions, needing stubs. Owner decision needed; not a recommendation.

## 6. Camera / film / sensor / filter

### pbrt-v4 (read)
- `CameraSample { pFilm, pLens, time, filterWeight }` (base/sampler.h:19–25).
- `GetCameraSample` (samplers.h:797–814): `FilterSample fs = filter.Sample(u)`;
  `pFilm = pPixel + fs.p + 0.5`, `filterWeight = fs.weight` — **filter importance sampling**:
  any filter (Gaussian, Mitchell, Lanczos, triangle; base/filter.h:25) works with plain
  per-pixel averaging, no splatting to neighbors.
- `Camera::GenerateRay(sample, lambda)` (base/camera.h:46); `Film::AddSample(pPixel, L,
  lambda, visibleSurface, weight)` (base/film.h:28); the film owns the `PixelSensor`
  (base/film.h:58; film.h:36) and **wavelength sampling** (`Film::SampleWavelengths`,
  base/film.h:41). Films: RGB, GBuffer (AOVs for denoising), Spectral (base/film.h:25).

### Mitsuba 3 (read)
- `Sensor` is an `Endpoint` (render/endpoint.h) — symmetric with emitters; it owns a `Film`
  and a `Sampler`; film owns the reconstruction filter (render/film.h `prepare_sample`).

**Lesson for this project.** The project's split — camera, pixel (filter), sensor (spectral
response: ideal, cie1931), sampler, accumulator, tonemap (CLAUDE.md "Cameras", src/components/)
— is pbrt's split with display stages added. pbrt's filter importance sampling means a new
filter is only a new `pixel/` occupant (offset + weight), with no change to accumulation.

## 7. What state-of-the-art photorealism needs (and what a GPU unidirectional tracer usually lacks)

Project status from CLAUDE.md "Built" and the component folders (checked listings).

| Feature | Reference | Project status | Note |
|---|---|---|---|
| Image textures + filtering | pbrt textures.h, TextureEvalContext; Mitsuba bitmap | Not built: "V1-C4. No image textures in materials; procedural properties only" (docs/fable-compiler-contracts.md:54) | WebGL2: texture arrays/atlas for many images (fragment shaders get ~16 texture units). Differentials are optional (see §2). |
| Normal / bump maps | pbrt materials.h:86–139, interaction.cpp:175–188; Mitsuba normalmap decorator | Planned: Hit.ng exists (structs.glsl:29–36 says "later normal/bump maps") | Needs a parameterization tangent (`dpdu`); Hit.frame has none (see §2). |
| Conductor complex IOR | pbrt `FrComplex` (scattering.h:81–100); OpenPBR F82-tint | Schlick `f0` (ggx.ts:13, mirror) | F82-tint works in RGB and spectral; measured n,k needs spectral data. |
| GGX energy compensation | OpenPBR spec: "implementations should add multiple-scattering compensation"; Kulla–Conty [mem] | Declared single-scattering loss for rough dielectric (docs/README.md rough-dielectric line) | Needs small LUTs (E(μ,α), E_avg(α)); fits WebGL2 textures. |
| Coated / layered | pbrt LayeredBxDF (stochastic, approximate pdf, bxdfs.h:882); OpenPBR albedo scaling `f_coat + (1 − E_coat)·f_sub` | Not built | Albedo scaling is deterministic and has exact pdfs of a lobe mixture → better fit for an estimator-correctness-first project than pbrt's stochastic evaluation. |
| Thin dielectric | pbrt ThinDielectricBxDF (bxdfs.h:209–, closed form :228) | Not built | Tiny; windows, bubbles, leaves. |
| Diffuse transmission, sheen/fuzz, Oren–Nayar | pbrt DiffuseTransmissionBxDF; OpenPBR fuzz and EON | Not built | |
| Hair | pbrt HairBxDF | Not built | Needs curve geometry first. |
| Measured BRDF | pbrt MeasuredBxDF (RGL format) | Not built | Data-heavy; low priority. |
| Subsurface | pbrt BSSRDF probe rays (cpu/integrators.cpp:1238–1290); OpenPBR suggests volumetric random walk | Volumetric (media + albedo inversion in authoring) | The project's route (media inside closed meshes) is the OpenPBR-endorsed one. |
| Spectral uplifting | pbrt RGBSigmoidPolynomial (Jakob–Hanika) [mem] | Built: Jakob–Hanika (spectral README.md:29, :109) | |
| Low-discrepancy sampler | pbrt default ZSobol (samplers.h:225–) | Only `pcg4d`; Owen-Sobol "built once and reverted" (sampler/README.md Status) | Read the owner's memory note before proposing again. pbrt's ZSobol wants a power-of-two spp known up front. |
| Filter importance sampling | pbrt samplers.h:797–814 | Box only (pixel/box) | New occupant, no plumbing change. |
| Many lights | pbrt BVHLightSampler; Cycles light tree | Built (light tree) | |
| MIS with delta tracking | pbrt r_u/r_l | "Not built" (CLAUDE.md) | Reference solution read (§4). |
| Path guiding | Cycles + Open PGL (guiding.h:135–140 calls `openpgl::cpp::…`); Müller 2017 [mem] | Not built | Training needs scattered writes; very hard in WebGL2 → per owner decision 6, note and skip. Cycles' guiding is CPU-only [mem]. |
| ReSTIR | Bitterli 2020, GRIS 2022 [mem] | Not built | Per-pixel reservoirs + spatial/temporal reuse; the image is correlated, and unbiased variants (GRIS) need shift-mapping Jacobians — in curved space those are geodesic Jacobi fields. Conflicts with the progressive, independent-sample accumulation. Not unidirectional-path-tracing in the estimator sense the owner pins. |
| Denoising | OIDN; Falcor `BSDFProperties` guides; pbrt GBufferFilm | AOVs built (albedo, normal); OIDN plan step 7 written, awaiting owner (memory) | |
| Wavefront | pbrt-v4 GPU, Cycles | Megakernel | WebGL2: no compute. Correct choice. |

## 8. Curved-space lessons drawn from the references

These are the places where the reference interfaces are Euclidean, and therefore where
the project's interfaces must differ (thought-through, mathematical, not checked against the
owner's geometry repo):

1. **BxDFs are space-agnostic** when written in a local orthonormal frame of the tangent
   space (pbrt bsdf.h `RenderToLocal`). The project's ggx already goes through
   `microfacet_to_local(hit.frame, hit.p, …)` (ggx.glsl:17–18). Lambert/checker/mirror/
   dielectric use `ambient_dot` in world coordinates — also fine as long as the frame is
   metric-orthonormal.
2. **Light sampling is where curvature enters**: pbrt's `shape.Sample(ctx)`/`PDF(ctx, wi)`
   convert area → solid angle with `cosθ_l / d²`. In a space form the factor is
   `cosθ_l / s(d)²` with s(d) = d (E³), sinh d (H³), sin d (S³); in H²×R the exp-map
   Jacobian is direction-dependent. A generic "sample by area, convert with the space's
   Jacobian" fallback would work for every shape in every space; closed-form cone samplers
   (sphere lights) are per-space optimizations. The ambient seam today has
   `ambient_dot`, `ambient_geodesic`, `ambient_direction_to`, `ambient_frame`,
   `ambient_parallel_transport` (ambient/euclidean/euclidean.glsl) — no distance and no
   Jacobian. (The Sep 28 design review already proposed `ambient_distance`:
   docs/claude-design-review-2026-09-28.md:379.)
3. **The two-point geodesic is not unique in S³** (short and long arc between two points,
   plus antipodal degeneracy), nor in quotient manifolds (one geodesic per deck
   transformation), which the owner wants eventually (decisions.md item 5). pbrt/Mitsuba NEE
   assume one shadow ray per light sample. `ambient_direction_to(from, to)` returns one
   direction. A NEE estimator that is unbiased in S³ must either sum over the geodesics or
   sample among them, and BSDF-sampled hits must be MIS-weighted against the matching
   geodesic's density.
4. **"Escaped rays" do not exist in S³** (geodesics are closed, length 2π for unit
   curvature). pbrt's `infiniteLights` / Mitsuba's environment emitters and the project's
   `MAX_DIST` far clip (glsl/core/math.glsl, CLAUDE.md invariants) where "the environment
   and the directional light are found" are Euclidean/hyperbolic concepts. In H³ the
   environment is a function on the ideal boundary; in S³ there is none.
5. Media and phase functions (pbrt `SampleT_maj`) only need arc length along the geodesic —
   space-agnostic if `ray(t)` is the geodesic. Majorant grids (DDA) are Euclidean data
   structures.
6. Texture differentials (pbrt `ComputeDifferentials`, plane intersection) are Euclidean; in
   curved space they need Jacobi fields. One more reason to skip prefiltering.
7. Light BVH bounds (pbrt `LightBounds`: AABB + normal cone) are Euclidean; in H³ balls are
   convex and usable, direction cones need parallel transport.

## 9. One-paragraph takeaways for a small, clean codebase

- The consensus interfaces are small: BxDF {flags, f, sample, pdf}, Light {sample, pdf, Le},
  LightSampler {sample, pmf}, Medium {properties at p, majorant along ray}, Camera
  {generateRay}, Filter {sample → offset, weight}, Film {addSample}. The project already
  has almost exactly these.
- Both references put the parameter's declaration in the code that reads it and detect
  typos by "was the key read". Mitsuba derives the live-parameter set from the object graph
  and has one `parameters_changed` hook per object.
- pbrt-v4 decides delta-vs-glossy per hit, has one conductor and one dielectric covering
  smooth and rough, one area light for all shapes (sampling lives on the shape), and one
  free-flight routine for all media. Each of these is "fewer occupants, one more run-time
  test".
- All three write the path loop by hand; Mitsuba folds scene-constant features at compile
  time with plain booleans.
