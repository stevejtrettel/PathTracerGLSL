# Suggested improvements (September 2026)

Written after the Sep 24–25 review, bug-fix and audit sessions. What was already fixed is in
`CHANGELOG.md` (Sep 24 and Sep 25 entries). This document is what remains: things we could
do next, most valuable first, with a worked-out plan wherever I could research one fully.
Nothing here is built. Items marked **Your call** need a decision from you before any code
(1.1 has since been decided).

Each item says: what it is, why it matters (with the evidence), and the plan.

---

## Part 1 — Correctness items found but not fixed

These are real defects or estimator-dependent truncations. I left them unfixed because each
one changes an interface or a declared semantic, which you prefer to decide yourself.

### 1.1 Mesh lights under MIS use the wrong normal for smooth meshes — **Decided: add `Hit.ng`**

**What.** For a mesh light with interpolated (smooth) normals, the NEE sampler converts
area to solid angle with the triangle's *geometric* normal, but the MIS pdf query at a
BSDF-found emitter hit uses the hit's *shading* normal (`light_hit.frame.n`, which for a
smooth mesh is the interpolated vertex normal). The two pdfs then disagree, so the MIS
weights for that light no longer sum to 1, and pt-mis converges to a slightly different
image than pt-nee: a bias patterned by facet, largest on big nearby emitters.
`src/compiler/generate/features/lighting.ts` (two call sites of `mesh_light_pdf`) and
`src/components/lights/mesh/mesh.glsl`. Reached by the `cacti` demo's glowing cactus
(`smoothNormals: true`) under key 2 (mis).

**Plan.** The pdf needs the geometric normal at the hit, which `Hit` does not carry.

1. Add `Direction ng` to `Hit` (the contract doc and `structs.glsl`): the geometric normal,
   oriented like `frame.n` (toward `region_from`).
2. Every arm that fills a Hit fills it. For analytic and marched hits it equals `frame.n`.
   The mesh arms already compute `gnorm` in `mesh_test_range`; they transform it to world
   space like the shading normal.
3. `mesh_light_pdf` takes `light_hit.ng`.
4. Witness: an emissive smooth-normal mesh near a diffuse floor, nee ≡ mis equality (the
   cactus scene reduced to one lamp). It should fail today.

**Decision (Sep 25).** Add `ng`. Today the two normals would differ only on smooth meshes,
but normal and bump mapping are planned, and those make the shading normal differ from the
geometric one on every surface. Smooth meshes already work around the missing field in three
places: this pdf; `mesh_test_range` flipping the interpolated normal onto the triangle's side
of the ray so the dispatcher's front/back test holds; and the fixed `MESH_T_MIN` spawn
clearance, needed because `ray_spawn` pushes along the shading normal, which can dip under the
surface. `ng` lets the latter two go too. Considered and not chosen: recovering the normal
from a triangle index in `Hit.element` (fixes only the pdf, costs vertex fetches per emitter
hit), and a Validator rule against smooth normals on sampled mesh lights (smallest, but the
limitation returns with normal mapping).

### 1.2 Three budgets that make the image depend on the estimator — **Your call** (semantics)

The taxonomy says estimators must not change the converged image, and truncations must be
declared. Three safety budgets break that quietly. None is reached by a registry scene today.

- **`MAX_SHADOW_SEGMENTS = 8`** (the media shadow walker). A shadow ray crossing more than 8
  null boundaries (e.g. several `'none'`-walled fog boxes, or instanced fog spheres) returns
  zero light. Camera paths have a separate budget of 32 null crossings per *path*. With 8+
  boundaries between a surface and a light, pt-nee loses that light entirely (the BSDF side
  gives samplable emitters weight 0), pt-mis loses the NEE share, and pt counts it.
- **`MAX_NULL_CROSSINGS = 32`** is per path and never reset: an undeclared truncation, and
  estimator-dependent, since BSDF-found light spends crossings and NEE shadow rays do not.
- **`MAX_NULL_COLLISIONS = 64`** (delta and ratio tracking). On exhaustion, delta tracking
  passes through with the partial weight and ratio tracking returns the partial
  transmittance. Both drop the rest of the attenuation, so the result is biased *bright*,
  although the comment calls it "conservative". Long segments hit it: an ambient
  expression medium toward `MAX_DIST` has 1000·σ̄ ≫ 64 expected collisions.

**Plan (recommended).**

1. Make the null-crossing budget a declared measurement truncation that every technique
   applies to the *same set of paths*: count crossings along the whole path, including the
   crossings a shadow ray adds, and let a shadow ray from a vertex that has used k
   crossings cross at most 32 − k more. Then "paths with at most 32 null crossings" is one
   set, whichever technique finds the light.
2. Replace the tracking hard stops with Russian roulette on the running weight (unbiased).
   Keep a very large hard cap only as a GPU-watchdog guard, and declare it.
3. Correct the "conservative" comments.

### 1.3 Two smaller GRIN items

- The straight micro-segment handoff (the `t_max` guard) is not recorded as a delta event,
  while shadow rays see GRIN regions as opaque. Light reaching an eye path through the thin
  rim of a lens is counted by pt but by neither technique under nee/mis. The rim band is
  about 1e-4 wide, so the effect is tiny. Fix: record the guard's transmit like the
  deflected outcome.
- `MediumSample.eta_scale` is folded into the path's roulette metric only on the deflected
  outcome. The guard and scatter outcomes' values are ignored, which affects only Russian
  roulette's survival choice (never bias). Fold it on every outcome.

### 1.4 Thin surfaces are one-sided — see Part 2.1 (thin dielectric)

---

## Part 2 — Rendering features, with plans

### 2.1 Thin dielectric (a window pane) — to design together

**Where things stand.** A zero-thickness surface (quad, disk, plane, open mesh) with a
`dielectric` material behaves differently from its two sides. On a front-face hit the
intersection dispatcher reports `region_to` = the surface's own region, which carries the
glass index, so the ray refracts as if entering solid glass and never leaves it. From the
back both sides are air, so η = 1 and the sheet is invisible. The Validator's warning ("will
refract as η = 1") is only true from the back.

**The standard model** (pbrt-v4 `ThinDielectricBxDF`): an infinitely thin slab. A ray is
either reflected (mirror direction) or transmitted *straight through* (wi = −wo: the two
refractions cancel and the lateral shift vanishes as thickness → 0). With single-interface
Fresnel reflectance R = F(|cos θ|, η), summing the internal bounces gives

  R_total = R + T²R/(1 − R²) = 2R/(1 + R),  T_total = 1 − R_total = (1 − R)/(1 + R),

with T = 1 − R. Both lobes are specular. The sampler picks reflection with probability
R_total and returns weight 1 for either choice. The medium on the two sides is the same, so
crossing does not change the current medium and there is no η² factor.

**Questions for our session** (plain choices, each with my suggestion):

1. *Material or geometry?* Should "thin" be a material model (`thin_dielectric`, as in
   pbrt), or a property of the object ("this dielectric surface has no inside")?
   Suggestion: a material model; zero thickness is already a fact of the geometry, and the
   material decides the optics.
2. *What happens to `dielectric` on zero-thickness geometry?* Today it is inconsistent
   between the two sides. Suggestion: make it a Validator error that points to
   `thin_dielectric`.
3. *Medium tracking.* Transmission through a thin sheet should not change the current
   medium (fog on both sides stays fog). Suggestion: a descriptor fact saying "transmission
   keeps the medium", so the walk skips its `current_medium = region_to` line.
4. *Tinted glass.* pbrt's model has no absorption. With a thickness d and absorption σ_a,
   one pass transmits τ = exp(−σ_a·d/cos θ_t), and the series becomes
   R_total = R + T²Rτ²/(1 − R²τ²), T_total = T²τ/(1 − R²τ²). Do we want that now, or later?
5. *Shadow rays through windows.* The transmitted direction is unchanged, so a shadow ray
   *can* pass through a thin sheet exactly, attenuated by T_total(θ). Today shadow rays treat
   dielectrics as opaque (the declared `opaque-dielectrics` truncation). Letting thin glass
   transmit shadow rays removes that truncation for windows, a large variance win for
   interiors lit through glass. pbrt-v4 does not do this. It affects MIS bookkeeping, since
   the light connection now passes a delta interaction. This is the question I would most
   like to think through with you.
6. *Witnesses.* A lossless furnace (R_total + T_total = 1, so a closed thin-glass box in the
   furnace stays at 0.4); a sheet between a lambert wall and a quad light, viewed from both
   sides (front ≡ back); the transmitted irradiance against T_total(θ) at two angles.

### 2.2 Solid-angle sampling for quads and triangles (variance)

**Why.** Quad and mesh-triangle lights are sampled uniformly by area. Converting to solid
angle divides by cos θ_l/d², which blows up for large emitters close to the shading point:
the Cornell ceiling light, the cactus lamp. Sampling the solid angle directly has constant
pdf over the emitter's projection, so the NEE estimate varies only with the BSDF and the
receiver cosine.

**Plan.**
- Quads: Ureña, Fajardo & King 2013, "An Area-Preserving Parametrization for Spherical
  Rectangles" (EGSR). pbrt-v4 implements it as `SampleSphericalRectangle` /
  `InvertSphericalRectangleSample` (`util/sampling.h`, used by its bilinear patches). pdf = 1/Ω.
- Mesh triangles: Arvo 1995, "Stratified Sampling of Spherical Triangles"; pbrt-v4
  `SampleSphericalTriangle` in `Triangle::Sample`. pbrt switches to area sampling when the
  solid angle is tiny or nearly a hemisphere (its `MinSphericalSampleArea` /
  `MaxSphericalSampleArea` constants), and optionally warps the sample for the receiver
  cosine (a bilinear warp).
- House shape: the sampler and its pdf mirror stay adjacent in the light's `.glsl` (the §6.1
  byte-match rule). The pdf now depends on the shading point, not on the light point, as
  the sphere light's already does.
- Witnesses: the existing nee ≡ mis / pt-anchor equalities (cornell-area, veach-mis,
  mesh-light-twin) gate correctness. The measurement bench's `noise` check can report the
  variance gain; I expect it to be large on cornell-area.

### 2.3 Soft beam: sample the emission cone (variance)

**Why.** The soft-beam witness showed it: NEE samples the whole aperture, but a receiver in
the beam core sees light only from a sub-disk of radius d·tan δ. At the witness's numbers,
4% of samples carry all the signal, a per-sample relative standard deviation of 4.9.

**Plan.** From the receiver, pick a direction uniformly inside the cone of half-angle δ
around the reversed beam axis, intersect it with the aperture plane, and return zero if it
lands outside the disk. The pdf is the uniform-cone density 1/(2π(1 − cos δ)), and the pdf
mirror must match. In the core every sample is valid (about 25× less variance there). A
cheap independent win: skip the shadow ray when the sample's radiance is zero.

### 2.4 Microfacet energy compensation

**Why.** GGX with Smith masking models one bounce between microfacets and drops the rest,
so rough materials render too dark, increasingly with roughness. The rough dielectric's
notes (`rough_dielectric.md`, "Energy") record the measured loss for glass: under 0.3%
below roughness 0.1, ≤ 2.4% at 0.2, 8–23% at 0.5 and up to 39% at 0.7 (grazing exit). Rough
metals lose energy the same way.

**Plan.** Kulla & Conty 2017, "Revisiting Physically Based Shading at Imageworks" (SIGGRAPH
course). Tabulate the single-scattering directional albedo E(μ, α) (32×32) and its average
E_avg(α) once offline (a TS script; the tables ship as constants). Add the lobe

  f_ms(μ_o, μ_i) = (1 − E(μ_o))(1 − E(μ_i)) / (π·(1 − E_avg)),

scaled for colored conductors by F_avg²·E_avg / (1 − F_avg·(1 − E_avg)) (the sum over
second and later bounces, each attenuated by the average Fresnel F_avg). Sample it with a
cosine-weighted lobe mixed into the existing VNDF sampler. Witness: a white furnace for the
BSDF (a GGX sphere with f0 = 1 under a uniform white sky and no other light), which today
reads the directional albedo E(μ) < 1, darkest toward the silhouette, and should read 1
everywhere. For glass, the table above says compensation matters only above roughness ~0.3.

### 2.5 Metals with measured optical constants

**Why.** The metals today are Schlick with an `f0` color. Real metals have a complex index
η + iκ, and the conductor Fresnel gives the correct color shift at grazing angles.

**Plan.** A `conductor` occupant with rows `eta` and `k` (Spectrum) plus `roughness`. The
Fresnel term is pbrt-v4's `FrComplex`, per RGB channel, with complex arithmetic in `vec2`:

  sin²θ_t = sin²θ_i / η², cos θ_t = √(1 − sin²θ_t) (complex),
  r_∥ = (η cos θ_i − cos θ_t)/(η cos θ_i + cos θ_t), r_⊥ = (cos θ_i − η cos θ_t)/(cos θ_i + η cos θ_t),
  F = (|r_∥|² + |r_⊥|²)/2.

GGX supplies D and G unchanged. A few named presets (gold, copper, aluminium) can live in the
authoring layer. RGB values of η, κ are a simplification until the spectral axis exists.

### 2.6 Layered materials (clear coat) — later

A coated diffuse or coated metal (car paint, varnished wood) is pbrt-v4's `LayeredBxDF`
(Guo, Hašan & Zhao 2018, "Position-Free Monte Carlo Simulation for Arbitrary Layered
BSDFs"). It is exact but evaluates stochastically (a random walk inside the layers), which
adds variance and complicates MIS. Worth it only after 2.4 and 2.5.

### 2.7 Light-tree orientation bounds

The light tree's importance ignores which way emitters face. That is right for spheres and
points, but one-sided quads, disks, spots, soft beams and mesh lights waste selection on
lights facing away. The standard fix is the orientation cone of Conty Estevez & Kulla 2018
("Importance Sampling of Many Lights with Adaptive Tree Splitting") as implemented in
pbrt-v4's `LightBounds` (θ_o, θ_e per node). The audit also measured about 5% of selection
mass dying at "phantom corners" (a parent's far corner that lies in neither child); a
one-level child-box lookahead fixes that. Both are variance-only.

### 2.8 Pixel reconstruction filters

`fable-imagery.md` P3 (tent and Gaussian, importance-sampled so every sample has weight 1)
is designed and ready. One decision is open there: the Gaussian's σ and truncation (the doc
suggests σ = 0.5 px, truncated at 2σ). The furnace stays at 0.4 under any filter, which is
the gate.

### 2.9 Low-discrepancy sampling — worth re-measuring

Owen-scrambled Sobol was built and reverted in July: the RMSE gain on Cornell was about
1.05×. That scene is dominated by long diffuse paths, where any sampler looks like white
noise. The gains show up in the first dimensions: pixel jitter, lens, the first light
sample. The measurement bench can now measure this per scene (the `noise` check).
Suggestion: re-run the parked implementation on a direct-lighting scene (cornell-area at
low spp) and a depth-of-field scene before deciding. A related option with a visible payoff
at low spp is pbrt-v4's `ZSobolSampler` (Ahmed & Wonka 2020, "Screen-Space Blue-Noise
Diffusion of Monte Carlo Sampling Error via Hierarchical Ordering of Pixels"), which makes
the remaining noise blue.

### 2.10 Spectral rendering (the reserved `color: 'spectral'`)

The largest item here, and the trigger for two parked designs (the realistic camera, and
dispersion in dielectrics and GRIN n(λ)). The standard approach is hero-wavelength sampling
(Wilkie et al. 2014, "Hero Wavelength Spectral Sampling"), with RGB inputs upsampled to
spectra by Jakob & Hanika 2019 ("A Low-Dimensional Function Space for Efficient Spectral
Upsampling"), as pbrt-v4 does. The `Spectrum` typedef discipline is already in place for it.
This needs its own design document.

### 2.11 Smaller rendering items

- **Object-free scenes** (a light in fog with no surfaces). Now a clear Validator error. To
  support it, the intersection feature would emit stub `scene_intersect` / `scene_region_at` /
  `material_of` when there are no objects.
- **Environment selection with batch lights.** When a samplable sky shares NEE with batch
  instance lights only, the selection probability ignores the batch's power and clamps to
  0.99, so the batch gets 1% of the samples. The App computes per-instance power at pack
  time; passing the total as a parameter to the probability's closure fixes it.
- **Sphere light seen from inside** still returns pdf 0 (pbrt falls back to area sampling).

---

## Part 3 — Speed

### 3.1 More than one sample per frame in production renders (recommended first)

**Why.** The render loop draws one sample per `requestAnimationFrame`, about 60 per second
however fast the GPU is. A 512² tile tops out near 16M samples/s; the 160×120 witness
renders are almost pure waiting (a large part of why a full witness sweep takes ~45
minutes); and large tiled renders pay it on every tile.

**Plan.**
- In production mode only (interactive stays one sample per frame for responsiveness),
  render K accumulation frames per tick and present once.
- Adapt K with a GPU fence rather than guessing. After each batch, insert
  `gl.fenceSync(SYNC_GPU_COMMANDS_COMPLETE)`. On the next tick, poll it without blocking
  (`getSyncParameter(sync, SYNC_STATUS)`). If it has signalled, the GPU is idle: double K, up
  to a time budget. If not, submit nothing this tick and halve K. This keeps at most one
  batch queued, so the tab stays responsive and the GPU watchdog never sees a long queue.
- Cap one batch's GPU time (for example 50 ms) using the measured frames per signal, so a
  heavy scene never builds a multi-second submission.
- The engine needs a `renderFrame({ present: false })` variant that skips the display
  pass for the first K − 1 frames.
- Gate: every existing witness is unaffected (the accumulation is the same sequence of
  frames). Speed: `npm run witness -- --perf`.

### 3.2 Allocate framebuffers for the active renderer only

`ResourceManager.resize` reallocates every loaded renderer's float buffers on each
production resize and on each tile size change. Every renderer switch clears accumulation
anyway, so keeping all of them buys nothing. Allocating on select divides the GPU memory by
the number of renderers (up to 9) and removes the most likely cause of an allocation
failure at 8K. Also check requested sizes against `MAX_TEXTURE_SIZE` / `MAX_VIEWPORT_DIMS`.

### 3.3 Smaller speed items

- `Engine.clearAccumulation` clears the ParameterManager's caches, so every reset (every
  orbit mouse-move) re-runs all uniform closures and re-uploads every uniform. Uniform
  values do not change on a reset; drop that clear.
- The witness runner compiles and packs each scene once per strategy. With the salt pinned
  it could render all of a scene's strategies from one page (`selectRendererByStrategy`).
- `pages/scene-lab.ts` enables GPU profiling by default, which forces a readback sync after
  every pass.

---

## Part 4 — Structure: making whole classes of bugs impossible

Most bugs found this week sat at a seam where two modules decided the same fact separately.
Each suggestion below removes one such class.

1. **Separate id spaces in a debug compile.** The GRIN black-lens bug survived because in
   every GRIN scene but the furnaces, the lens's region id and material id were equal. A
   test compile mode that offsets material ids (say +100) would make every region/material
   confusion in static GLSL fail loudly on every scene. Cheap: the ids are minted in one
   place.
2. **One extinction per medium.** Camera-path sampling and shadow transmittance are
   generated by two functions that each decide how a medium attenuates. That is how the
   `'ignored'` scattering bug happened (fixed Sep 25). Derive both from one function of
   (medium, program decisions).
3. **One parameter table.** Each feature mints its own uniforms from parameter paths with
   its own `seen` set. So one path used as a vec3 in one material and as a float in another
   silently produces one wrongly-typed uniform (found by the audit, not yet fixed). A single
   Planner table from path to {GLSL type, default, range, readers, uniform name} would check
   types, defaults and name collisions (including compiler-minted names such as `u_light_cdf`)
   in one place.
4. **Declarative strategy schema.** Strategy fields are validated by hand, one `if` at a
   time (Sep 24–25 added eight). Declaring each field's enum, range or integer rule and
   interpreting that schema, as the Validator already does for descriptor rows, would close
   the class. Pair it with a rule that authored numbers reach GLSL only through typed
   formatters (`formatInt`, `formatFloat`), never through raw template strings.
5. **One placement rule for every backend.** The table-dispatch size bug (fixed Sep 25) came
   from three readers each deciding how a placement is applied. Every constant placement
   could lower to "scale folded into the parameters + a rigid residual" (the pure-scale fold
   is exact for every row kind), with one record feeding the unrolled arms, the table, the
   containment test and the light roster.
6. **Combinatorial compile fuzzing in CI.** The audit's fuzzer checked 20,000 random
   scene/strategy combinations in about 20 seconds (uniforms used but not declared,
   functions called but not defined, duplicate definitions) and found two bugs the suite
   scenes cannot reach. Worth keeping as a CI test, with glslang on the sampled output on Linux.
7. **A static check of the estimator contract.** For each program: every technique that can
   reach a samplable emitter must have a matching counterpart with the same visibility
   policy (if shadow rays treat a region as opaque, the BSDF side must record crossing it as
   a delta event). That turns 1.2 and 1.3 into compile-time errors.
8. **Show compiler warnings in the app.** They now reach the console (Sep 25). A small
   non-blocking list in the overlay would make "this field is ignored" visible where you work.

---

## Part 5 — Tooling

- **glslang tests on this Mac.** The packaged binary is x86_64. Either install Rosetta
  (`softwareupdate --install-rosetta`) or `brew install glslang` and set
  `GLSLANG_VALIDATOR=$(which glslangValidator)` (supported since Sep 25). CI runs them on Linux.
- **Witness runner robustness.** A reloaded page is now an error instead of a result (Sep 25).
  Still open: `page.evaluate` calls have no timeout, and a heavy draw from a timed-out page
  can stall later readbacks in the shared SwiftShader process. This is probably the
  `cube-cloud` "hang". Add `Promise.race` timeouts and relaunch the browser after a timeout.
- **`cube-cloud`.** Its reference arm is a 25-object unrolled program that compiles slowly
  under SwiftShader. Check first whether the runner stall above explains it.

---

## Part 6 — Toward curved spaces

The `ambient_*` seam (`ambient_geodesic`, `ambient_dot`, `ambient_frame`) is in place and the
GRIN walker is a working curved-ray integrator. A concrete first step toward H³: implement
the `ambient_*` functions for the hyperboloid model, restrict the first scenes to SDF
geometry (marching needs only the geodesic and a distance bound, while closed-form
intersections do not carry over), and make the witness a hyperbolic furnace (a closed
region with emitting walls at albedo ρ, which must read Le/(1 − ρ) exactly as in flat
space). Light sampling in curved space (the exponential map, and the Jacobian of the
geodesic flow for the solid-angle measure) is the hard part and deserves its own design
document before any code.

---

## Part 7 — Audit reports I did not verify

The Sep 25 audit ran five read-only reviews in parallel. Everything marked fixed in the
CHANGELOG was confirmed (usually with a test that fails on the old code). The reports below
were plausible but unconfirmed, or confirmed but too small to act on yet. Listed so nothing is
lost; each says what would settle it.

**Transport and media**
- The per-path null-crossing counter is never reset (see 1.2). Settle: count paths the cap
  kills in `grin-furnace` with Russian roulette off and a large `maxBounces`.
- Tracking exhaustion on long segments (see 1.2). Settle: instrument the exhaustion rate in
  `groundfog` under an environment or sun light.

**Lights, environment, cameras**
- Mesh-light CDF in f32: for meshes with 10⁵–10⁶+ triangles the realized per-triangle
  probability drifts from area/A (≈ 6e-8·T relative), and very small triangles get a zero
  CDF span. No current scene reaches it. Fix when needed: a higher-precision CDF, and a fresh
  random number for the in-triangle coordinate.
- The octahedral environment table is point-resampled (one bilinear sample per texel). A
  bright feature smaller than a texel can get pdf 0, so NEE alone would miss it. Today
  octahedral is used only with MIS (variance only). Fix: supersample or max-filter per texel.
- The equirect chart's pdf uses the row-center sin θ (a bias factor ≈ 1 + Δθ²/24 ≈ 1 + 6e-6
  at 256 rows). Negligible.
- The nee ≡ mis χ² checks share NEE random streams, so their denominators overstate the
  variance of the difference and the checks have less power than they appear to. Consider
  decorrelated streams for equality checks.

**Acceleration and data**
- `BVH_TFAR_PAD` is 1 + 4u; the three-rounding bound is 1 + 2γ(3) ≈ 1 + 6u (pbrt's choice).
  Settle: an f32-emulated search over rays through box edges, or just adopt 1 + 2γ(3).
- Slab tests compute 0·∞ = NaN when a ray with an exactly zero direction component starts on
  a slab plane; GLSL leaves min/max with NaN undefined. The CWBVH walk already clamps
  direction components; the binary walks and `box_intersect` do not. Settle: an axis-aligned
  orthographic view with no jitter over integer-coordinate boxes, on hardware that propagates NaN.
- The mesh triangle test rejects |det| < 1e-12 in local space; for finely tessellated meshes
  scaled up by 10³ or more, valid grazing hits may be rejected.
- No guard ties the CWBVH's maximum depth to `CWBVH_STACK_DEPTH` (24). Harmless for today's
  sphere-only batches.
- Data textures: no check of a channel's total height against `MAX_TEXTURE_SIZE`, and BVH
  child/leaf indices stored in f32 are exact only below 2²⁴ (meshes above ~8.4M triangles).
  A plan-time channel budget (like the sampler budget) would make both compile errors.
- Light-tree build: collinear lights (a row of point lights) have zero-area boxes, so SAH
  degenerates into chains (depth 32 at n = 100). Regularize the split measure.

**Compiler and authoring**
- `defineSDF` kind codes follow `PRIMITIVES` iteration order, which depends on module import
  order, so generated source might differ between sessions. Settle: compile one scene after
  importing the scene modules in two orders and diff.
- `flattenGroups` does not validate group transforms (a nonuniform or reflecting group scale
  is reported against the leaves, or not at all for instanced leaves).
- A scene parameter named like a camera slider (`camera.aperture`, `camera.focusDistance`)
  probably binds to that slider silently; only `camera.position/target/frame` are reserved.
- The same parameter path authored with different defaults at different sites: the first
  minted default probably wins silently. (The parameter table in Part 4.3 would settle both.)

**Runtime**
- Two overlapping `App.recompile` calls, or a recompile during a context restore: the last
  scene-data upload to finish wins, so new programs could read old data. No UI caller today.
- `App.recompile(newScene)` does not re-bake or reload the environment, or update the
  stored config used by context restore.
- The witness runner's variance path calls `App.initialize` a second time, which replaces
  the scene-data textures with a single-strategy layout while the original renderers stay
  loaded.
