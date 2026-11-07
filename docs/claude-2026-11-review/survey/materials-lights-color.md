# Area map: materials, lights, environment, color/spectral, AOV

Read-only survey, 2026-11-06, branch `claudeapp`. All paths relative to
/Users/stevetrettel/Code/PathTracerGLSL. "checked" = I read the code that proves it.

## 0. Two-minute summary

Five component families describe the *integrand* of the light-transport integral; the
compiler (mostly `src/compiler/generate/features/{materials,lighting,environment}.ts`)
turns their descriptors into GLSL.

- **materials/** (940 lines incl. md): one folder per BSDF model (lambert, ggx, mirror,
  dielectric, rough_dielectric, checker). Each `.glsl` defines `<id>_eval/sample/pdf/emission`
  in the `(uc, u)` sampler form; `eval` returns bare f (no cosine); `sample.weight =
  f|cos|/pdf`; delta lobes have pdf 0 + `LOBE_DELTA`. The `.ts` descriptor declares the
  property *rows* the model reads (name, glslType float|Spectrum, role, default, storage
  field|region-table), optional host-computed `derived` rows (alpha), capabilities
  (`nonDeltaLobes`, `transmission`, `support: hemisphere|sphere`, `emissive`, `readsUv`),
  `usesMicrofacet` (include gate for glsl/core/microfacet.glsl) and an `albedo` fact for the
  albedo AOV. The compiler builds ONE scene-wide `MaterialProperties` struct = union of rows
  of the models present, a generated resolver `scene_material_properties(id, p, uv, element,
  wl)` (if-chain on material id, rows may be constants, `{param}` uniforms, GLSL expressions
  in p/uv, or per-instance attributes), and per-op dispatchers
  `interaction_surface_{sample,eval,pdf,emission}` (if-chain on material id → model).
  Index of refraction is a region-table row read for *both sides* of a hit via
  `ior_of(region, p, wl)`.
- **lights/** (1296 lines): one folder per kind (point, spot, directional, beam, quad,
  sphere, disk, softbeam, mesh). GLSL is functions only: `LightSample
  <kind>_light_sample(<Kind>Light l, Point p, vec2 xi)` returning wi, distance, radiance
  (no visibility), pdf in **solid-angle measure at p**, and for hittable kinds an adjacent
  `<kind>_light_pdf(l, p, light_p, wi)` that mirrors it. The struct is generated from the
  descriptor's `params` rows (+ `derivedFields`). Descriptors also carry the desugar facts
  (`authoredParams`, `toValues`, `region` + `valuesFromRegion` for hittable kinds),
  `power()` (pbrt PowerLightSampler formulas), `treeBounds` (light-tree leaf box),
  `deltaQuery` (equiangular), `emissionCone` (softbeam). Authored area lights desugar to a
  synthesized emissive lambert region `__light_n`; emissive analytic/mesh objects become
  lights through `valuesFromRegion` / the mesh route. Selection is a carved axis:
  `power`/`uniform` (compile-time CDF, per-light accessor `light_get_<id>(wl)`) or `bvh`
  (lights packed into a data-texture table + generated stochastic tree walk with bit-trail
  pmf replay). The environment joins selection through a two-stage draw `u_envSelectProb`.
- **env/** (614 lines): only the *sampling chart* is a registry (equirect, octahedral).
  `sampler_cdf.glsl` is the shared 2D-CDF sampler (+1/16 uniform-sphere defensive mixture
  unless MIS-compensated). `importance.ts` builds the CDF tables on the CPU. Environment
  *kinds* (none/constant/image/procedural) are if-branches in `generate/features/environment.ts`,
  not a registry. Radiance is `environment_radiance(vec3 dir, wl)`.
- **color/** (1982 lines + 12 MiB binary): pick-one color model (`rgb`: `#define Spectrum
  vec3`; `spectral`: 4 wavelengths, `Spectrum vec4`, CIE 1931 film, Jakob–Hanika RGB→spectrum
  lift by role: reflectance / coefficient / emission(×D65)). `spectra/` is a second registry
  of *spectrum kinds* (rgb, blackbody, cauchy, sellmeier, gaussian) that answer every
  question the compiler asks about an authored value (roles, sliders, domain, RGB stand-in,
  GLSL emit, light-table packing). Index kinds emit a float at the hero wavelength; a
  dispersive index forces a one-time hero collapse.
- **aov/** (110 lines): pick-many first-hit guides (albedo, normal), RGB only, each a
  `vec3 <name>_aov(int mat, Hit, wo, MaterialProperties, Spectrum weight)`.

Overall: the per-occupant contracts are clean and well documented; the TS twins + witnesses
make the math trustworthy. The complexity lives in the generators (lighting.ts 940 lines,
materials.ts 954 lines of which ~half is media codegen), in two parallel light-selection
regimes, and in "chart-name" and "mesh-kind" special cases that the registries claim do not
exist. Every light sampler, both env charts, the light tree and some material helpers are
Euclidean closed forms (declared "METRIC EXEMPTION" in 14 files); the curved-space plan for
them is "new bodies", with no mechanism yet to select a body per space.

## 1. File map

### materials/ (src/components/materials)
| file | lines | role |
|---|---|---|
| README.md | 70 | family contract (4 GLSL fns, descriptor facts, compiler consumption) |
| index.ts | 81 | `MATERIAL_MODELS` registry; `modelStructFields` (rows+derived), `materialModel` (throws), `modelTransmission`, `modelTwoSidedShading` (fail-safe true on unknown), `EMISSION_KEY`, `modelIndexRow` |
| lambert/ | 22+37+23 | cosine-weighted diffuse; the only `emissive: true` model |
| checker/ | 26+48 | lambert transcription with albedo = checker(uv); first Hit.uv reader; `albedo: {fn}` |
| ggx/ | 31+64+56 (+208 test) | rough conductor, Schlick from `f0`, VNDF sampling; derived `alpha = max(1e-3, r²)` |
| mirror/ | 22+32 | delta conductor, Schlick |
| dielectric/ | 27+52+35 | smooth glass; delta; η² radiance factor; IOR from `ior_of` both sides |
| rough_dielectric/ | 39+160+115 (+438 test) | Walter 2007 two-lobe; index-matched → delta pass-through |

Shared GLSL used by materials: `src/glsl/core/interaction.glsl` (InteractionSample, LOBE_*),
`src/glsl/core/structs.glsl` (Hit with frame, ng, regions, uv, element, eps; Frame;
LightSample; LightQuery), `src/glsl/core/microfacet.glsl` (D, G1, VNDF, frame maps),
`schlick_fresnel`/`dielectric_fresnel` in core math.

Compiler consumers: `generate/features/materials.ts` (struct union via `generate/schema.ts`,
resolver, dispatch, nondelta/two-sided/emissive guards, albedo dispatch, uniforms; also ALL
media codegen), `plan/Planner.ts` (resolveMaterialValues, dispersion, light desugar),
`analyze/Validator.ts` + `analyze/propertyValidation.ts` (row domains, unknown keys).

### lights/ (src/components/lights)
| file | lines | role |
|---|---|---|
| README.md | 95 | contract (sample/pdf pair, delta conventions, desugar, selection axis) |
| index.ts | 65 | `LIGHT_KINDS`, `LIGHT_SELECTIONS` (power/uniform/bvh ids only), `applyAuthoredDefaults` |
| power.ts | 11 | `radiantScalar` = RGB mean (selection weight) |
| table.ts | 89 | light-table row layout for `bvh` (header texel + payload), `packLightTable` |
| point | 34+23+27 | delta; I/d² folded; isotropic `deltaQuery` |
| spot | 73+30 | delta; pbrt smoothstep cone |
| directional | 34+28 | delta-direction; distance = MAX_DIST; power reads `ctx.worldRadius ?? 10` |
| beam | 40+42 | delta-direction with disk aperture; pdf 0 outside cylinder |
| quad | 79+41+27 | uniform area; d²/(A cos) conversion; one-sided; derived normal/area |
| sphere | 42+71+32 | visible-cone sampling, cancellation-free 1−cosθmax; inside → pdf 0 (open) |
| disk | 64+46 | concentric uniform area |
| softbeam | 77+56 | disk area light whose radiance is cone-gated; pdf geometric only; `emissionCone` fact |
| mesh | 95+75 | data-driven: area CDF in records texture, world positions baked; pdf identity-free, takes `light_hit.ng` |

Compiler consumers: `generate/features/lighting.ts` (940 lines: structs, accessors, CDF,
two-stage env wrapper, light_of, lighting_pdf, equiangular delta query, bvh loaders + tree
walks, env selection probability, scene radius), `plan/Planner.ts:276-341` (roster,
desugar, mesh special case, worldRadius stamp), `plan/dataTenants.ts`
(`samplableEmitterObjects`, `lightRosterOf`, `regionLightKind`), `components/accel/light_tree/`
(77-line importance GLSL + 134-line builder), `compiler/sceneData.ts` (mesh light packing).

### env/ (src/components/env)
| file | lines | role |
|---|---|---|
| README.md | 63 | chart axis contract, mixture density, compensation |
| index.ts | 42 | `ENV_CHARTS` {equirect, octahedral}, `EQUIRECT_MAP`, `ENV_EXTERN_NAMES` |
| sampler_cdf.glsl | 84 | marginal/conditional CDF walk, `environment_pdf`, `environment_sample` (1/16 uniform sphere mixture) |
| importance.ts | 128 | CPU CDF builder (luminance, 3×3 tent blur, sinθ or equal-area weights, MIS compensation) |
| equirect/ | 48+21+34 | chart (exact cell area, uniform-cosθ in-cell sampling), equirect_uv mapping |
| octahedral/ | 69+100+25 (+99 test) | Clarberg equal-area chart; TS twin = ground truth; equirect→octa resampler |

Compiler/App consumers: `generate/features/environment.ts` (252: env kinds as if-chains,
rotation rails, uniforms), `compiler/EnvironmentBake.ts` (97: one-shot bake renderer for
procedural skies), `generate/features/lighting.ts:475-531` (env selection probability),
`app/App.ts:170-350,951-963` (variant tables, octahedral resample, bake orchestration),
`engine/loaders/build-environment-sampler.ts`.

### color/ (src/components/color)
| file | lines | role |
|---|---|---|
| README.md | 69 | color model contract |
| index.ts | 27 | `COLOR_MODELS {rgb, spectral}`, `ColorModelDescriptor`, `resolveWavelengthSampler` |
| values.ts | 50 | compiler questions answered via kinds (deps, nonzero, stand-in, packed header) |
| spectrum.glsl | 24 | SPECTRUM_ZERO/ONE, average, max, is_black, sample_channel |
| rgb/ | 5+8+14 | RGB model: identity lifts, `color_to_pixel = sensor_response·L` |
| spectral/ | ~430 README + ~350 code + 12 MiB data | 4-lane hero-style sampling, visible/uniform proposals, JH lift (trilinear 8-fetch atlas), D65 emission, hero collapse, medium majorant certificate |
| spectra/ | 69 README + 94 contract + kinds | `SpectrumKind` contract; rgb (fallback), blackbody, cauchy, sellmeier, gaussian |

Compiler consumers: `generate/color.ts` (59: `emitSpectrum`, `emitIndex`, stand-in logic),
`generate/values.ts`, `analyze/spectral.ts`, `analyze/rgbPreview.ts`, Planner
(`spectrallyEvaluatedKinds`, `planDispersion`).

### aov/ (src/components/aov)
README 44, index 24, albedo 10+10, normal 11+11. Linked by `generate/features/aov.ts` (21).

## 2. Main data flow

1. Authoring: `MaterialDescription` is open-vocabulary (`[key]: MaterialProperty`), keys
   = row `source`s. Lights author `{kind, emission, ...authoredParams}`.
2. Validator checks rows (domains by role: reflectance [0,1] in spectral, emission ≥0,
   index >0), unknown models/kinds, kind-specific `validateAuthored`, spectrum-kind fields.
3. Planner `planScene`: resolves material values; builds the light roster
   (`lightRosterOf`: authored lights, then emissive analytic objects, then emissive
   meshes); desugars hittable authored lights to `__light_n` lambert regions; stamps
   `powerCtx.worldRadius`. `planProgram`: emission cones, two-sided shading, dispersion,
   spectrum kinds, env sampler chart.
4. Generator:
   - materials.ts → `MaterialProperties` union struct, resolver, model files, dispatch,
     guards, uniforms.
   - lighting.ts → light structs, kind files, accessors or table loaders, selection,
     `lighting_sample(LightQuery q, vec2 xi, Wavelengths wl)`, `light_of(region, element)`,
     `lighting_pdf(q, wi, light_id, Hit light_hit)`, shadow walker choice.
   - environment.ts → `environment_radiance`, and if samplable `environment_sample/pdf`.
   - color → typedefs first, lifts, film projection.
5. Transport (not my area) calls these seams; the light technique reconstructs the light
   point with `ambient_geodesic(hit.p, ls.wi, ls.distance)` and aims the shadow ray with
   `ambient_direction_to` — this part is curved-space ready.

## 3. Key types

- `MaterialModelDescriptor`, `PropertySchema`, `MaterialDerivedSpec`
  (src/components/descriptors.ts:58-170).
- `LightKindDescriptor`, `LightParamSpec`, `AuthoredParamSpec`, `DerivedFieldSpec`,
  `LightPowerContext` (descriptors.ts:172-297).
- `SpectrumKind`, `EmitContext`, `MintContext` (color/spectra/spectrumKind.ts).
- `ColorModelDescriptor` (color/index.ts), `EnvChartDescriptor` (env/index.ts),
  `AovDescriptor` (aov/index.ts).
- GLSL: `Hit`, `Frame`, `LightSample`, `LightQuery` (glsl/core/structs.glsl),
  `InteractionSample` (glsl/core/interaction.glsl).
- `SpectrumRole = 'reflectance' | 'coefficient' | 'emission' | 'index'`.

## 4. Findings (details; the structured result repeats them with evidence)

### Doc–code mismatches (checked)
- lights/README.md:4,71,95 describe "hoisted `const <Kind>Light light_<id>`"; the code
  emits accessor functions `light_get_<id>(wl)` (lighting.ts:430-437).
- descriptors.ts:200-201 says the light GLSL "declares `struct <Kind>Light`"; the README and
  code say the struct is generated (lighting.ts:108-116) and point.glsl declares none.
- lights/README.md:54 "No Planner/Validator/Analyzer branches exist per kind" — Planner.ts:321
  `if (entry.kind === 'mesh')`; lighting.ts branches on mesh at 445, 664, 848, 918 and on
  `kind === 'sphere'` at 106.
- env/index.ts:4 says the chart name-ternaries in environment.ts and EnvironmentBake.ts are
  dead; they exist (environment.ts:51,63,170,230; EnvironmentBake.ts:22), plus importance.ts
  (56,78,109), lighting.ts (505,511,528), App.ts (236,348,958).
- ambient/README.md:25 says two places are Euclidean-only beyond the seam (analytic media,
  equiangular); 14 files declare METRIC EXEMPTION (all 9 light kinds, both env charts,
  equirect_map, math.glsl) and light_tree.glsl is Euclidean without saying so.
- materials/README.md:59 occupant list omits rough_dielectric and checker; CLAUDE.md and
  color/README.md list spectrum kinds without `gaussian` (registered in spectra/index.ts:13).
- octahedral.glsl header says "LINE-FOR-LINE TWIN of src/engine/loaders/octahedral.ts";
  that file does not exist (engine/loaders has blueNoise, build-environment-sampler,
  hdr-loader); the twin is components/env/octahedral/octahedral.ts. CHANGELOG.md:2666 also
  names the old path (history, fine).

### Duplicated decisions (checked)
- Scene radius has two answers: `sceneWorldRadius` (Planner.ts:975-1008, for directional
  power; fallback 10, analytic+meshes) and `sceneRadiusEstimate` (lighting.ts:459-474, for env
  power; floor 1, |point|+Σ lengths, includes lights). Both are pbrt's worldRadius. The `10`
  fallback is also restated in directional.ts:29.
- Chart facts (size parameter path, table suffix, Jacobian weighting, blur wrap, rotation
  rail) are spread over 5 files as name tests instead of living on `EnvChartDescriptor`.
- Two env rotation mechanisms (additive `u_envRotation` for equirect, cos/sin matrix
  `u_envRotCS` for octahedral/procedural), and the `env_rotate_cs` GLSL text appears twice
  (environment.ts:33, EnvironmentBake.ts:55).
- The two-stage env wrapper GLSL is emitted by two near-identical blocks (lighting.ts:609-625
  and 880-895).
- Struct name `Kind→KindLight` computed in 4 places (lighting.ts:113,408,434,708).
- CIE Simpson quadrature loop copied in blackbody.ts:25-37 and gaussian.ts:27-41.
- Default chart 'equirect' stated in Planner.ts:578 and App.ts:958 (and importance.ts:34,
  EnvironmentBake.ts:29).
- checker = lambert + procedural albedo; lambert's sample/eval/pdf transcribed verbatim.
  Expression albedo rows (P2) already express the same thing. (Not a deletion suggestion —
  checker is a declared test occupant for the uv path.)

### Guesses / fallbacks (checked)
- `modelTwoSidedShading` returns true for unregistered models (materials/index.ts:65-70);
  `generateNondeltaGuard` treats unknown as non-delta (materials.ts:425-443); `lightPower`
  returns 1e-8 for unknown kinds (lighting.ts:355); while `materialModel()` and
  `lightKind()` throw. Inconsistent "unreachable backstop" policy; owner rule says errors.
- `materialReadsUv` assumes any GLSL expression row reads uv (dataTenants.ts:51-56).
- Selection heuristics (scene radius, pre-load L̄ = 1, RGB mean vs Rec.709 luminance) are
  variance-only and declared; flagged only because two radius estimates disagree.

### Extension friction (checked unless noted)
- Light kind sampler gets only `Point p` (`sampleCall`, lighting.ts:444-450), not the
  `LightQuery` (normal, two_sided) that the dispatcher holds. pbrt-v4's LightSampleContext
  carries n/ns, used by spherical-triangle/rectangle sampling with projected-solid-angle
  warping. The deferred "spherical-rectangle quads" item needs this.
- `<kind>_light_pdf` signature is (l, p, light_p, wi) but mesh needs `light_hit.ng`, so the
  generator special-cases mesh in four places. Passing `Hit light_hit` uniformly would remove
  the branches (and serve future textured/normal-mapped emitters).
- Emission is a per-BSDF-model function + row; only lambert can emit (`emissive: true` only
  in lambert.ts:20). OpenPBR/pbrt/Mitsuba treat emission as orthogonal to the BSDF
  (inferred from memory, not re-read). Five of six `<id>_emission` bodies return zero.
- Index role is float-only and hero-collapsed (spectrumKind.ts `emit` doc; color.ts:51-58);
  the planned `conductor` occupant (docs/claude-improvements-2026-09.md §2.5) needs
  per-lane Spectrum η and k with no collapse — no role/kind path exists for that.
- `usesMicrofacet?: boolean` is a single-purpose include gate; the next shared BSDF
  library (Kulla–Conty tables §2.4, conductor Fresnel, sheen) needs another flag.
- A layered model cannot call another model's GLSL (files included only when that model is
  present; descriptors may not reference other components).
- Environment kinds are not a registry: a new sky (physical sun-sky, Hosek) means editing
  environment.ts if-chains (procedural GLSL formulas cover many cases already).
- Instance-batch lights are hardwired to the sphere kind (lighting.ts:106, batchSphereExpr).
- Multi-material meshes (the declared priority): mesh lights are uniform-area over the whole
  mesh with one Le (mesh.glsl, Planner.ts:321-327); per-triangle materials will need per-
  triangle emission and an emission-weighted CDF (inferred).

### Euclidean assumptions (checked)
- Every light sampler: `d = q - p`, `wi = d/|d|`, `pdf = d²/(A cosθ_l)`, point `I/d²`,
  sphere cone `1/(2π(1−cosθmax))` with `sin²θmax = r²/d²`. In S³/H³ the area→solid-angle
  Jacobian is `s_κ(d)²/cosθ_l` with s_κ = sin, sinh; the visible-cone half-angle changes
  (sinh r / sinh d in H³); in H²×R the spreading is anisotropic.
- In S³ two geodesics join p to every light point (short and long arc; antipode is a
  caustic); the LightSample contract (one wi, one distance) and the shadow ray assume one.
- directional/beam (delta-direction) and the "environment at MAX_DIST" have no direct meaning
  in S³ (compact, no infinity) and in H³ the ideal boundary seen from p depends on p.
  `environment_radiance(vec3 dir, wl)` / `environment_pdf(vec3 dir)` take no point
  (environment.ts:91-94; sampler_cdf.glsl:63-84); `environment_sample` takes p but ignores it.
- light_tree.glsl: AABB, d², tangent-plane cull (Euclidean; note: in Klein/projective
  models of H³ and gnomonic S³ geodesic planes are planes, so the box cull has a projective
  analogue, the d² measure does not).
- Material GLSL uses Euclidean `normalize`, `reflect`, raw `dot` in places
  (lambert.glsl:23, dielectric.glsl:31,39, microfacet_from_local, softbeam emission gate
  `dot(wo, axis)` in materials.ts:941). With vec4 Minkowski Directions, Euclidean
  normalize changes the vector's metric length (inferred consequence).
- The material local-frame math (microfacet_to_local via ambient_dot) is curved-ready.

### In-progress (not dead; documented futures)
- Ambient family has one occupant (euclidean); METRIC EXEMPTION comments say curved spaces
  get new light/chart bodies — no per-space body selection exists yet.
- `Hit.ng` read by ray_spawn + mesh_light_pdf; normal/bump mapping planned
  (claude-improvements §1.1 "deferred to the normal-mapping design").
- `Hit.element` = instance index only; per-triangle index reserved for multi-material meshes.
- Emitter-profile axis (docs/fable-emitter-profiles.md) — softbeam is its v0.
- `LOBE_GLOSSY/DIFFUSE` deferred (interaction.glsl:11).
- Spectral compile-time coefficient folding not implemented (spectral/README "lookup.ts"
  section; benchmark: table lookup ~1.5–1.9 vs ~0.15–0.25 ms/draw polynomial-only).
- AOVs RGB only.
- Sphere-light inside fallback, two-sided quads, spherical-rectangle sampling, light-tree
  orientation cones (claude-improvements §2.7), Kulla–Conty (§2.4), conductor (§2.5),
  layered (§2.6) — all planned.

## 5. What state of the art needs vs the current BSDF interface

| need | today | gap |
|---|---|---|
| textures (image) | rows may be GLSL expressions in p/uv; no sampler2D textures for materials; uv charts per primitive + mesh uvs | image-texture rows + mip/filter footprint (no ray differentials) |
| normal/bump mapping | Hit.ng separate from frame.n; materials see whole Hit | the shading-normal-below-surface rule is undecided; dielectric clamps `cos_i ≥ 1e-6` assuming wo above n |
| layered / coated | none | no composition of models; would be a monolithic occupant or a stochastic LayeredBxDF |
| principled / OpenPBR | none | many rows fine for the union struct; emission/coat/sheen/thin-film are lobes in one model; needs shared libs beyond microfacet |
| complex-IOR conductors | Schlick f0 only | Spectrum-valued index role (η, k) |
| energy compensation | none | planned (Kulla–Conty tables) |
| multi-material meshes | one material per mesh | element → material id mapping; per-triangle emitters |
| emission on any BSDF | lambert only | emission orthogonal to model |
| light sampling context | p only | pass LightQuery (n) for projected-solid-angle sampling |
