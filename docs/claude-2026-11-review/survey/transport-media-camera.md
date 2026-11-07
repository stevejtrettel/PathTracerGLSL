# Transport, media and the image pipeline: a map

Read-only survey, 2026-11-06, branch `claudeapp`. All paths are relative to
/Users/stevetrettel/Code/PathTracerGLSL. "checked" means I read the code that proves it.

## 1. The image pipeline, end to end (one fragment, one sample)

Generated `main()` (src/compiler/generate/features/accumulation.ts:14-26, 33-51):

```
pixel = gl_FragCoord.xy + u_pixelOffset
rng_init(pixel, u_sampleCount, u_resetSalt)        sampler/pcg4d
film  = pixel_sample(pixel, random2())             pixel/box
xiLens = random2()
camera_sample = wavelengths_sample()               color model
ray = camera_generateRay(film, xiLens, wl)         camera/<model>
L   = transport_trace(ray [, out aov_*])           transport/integrators/pt (generated walk)
color = color_to_pixel(film, ray.direction, L, camera_sample)   color model + sensor/<id>
<picture>_new = <mode>_update(previous, color, n)  accumulator/<mode> (+ statistic)
```

The display pass is separate: exposure, the tonemap curve (tonemap/<id>), the sRGB OETF
(glsl/shared/display.glsl), assembled by ShaderBuilder.buildDisplayBlocks.

Taxonomy (docs/fable-strategy-taxonomy.md): camera, pixel, sensor, ambient = measurement /
scene; sampler, accumulator, transport techniques = estimator; tonemap = view.

## 2. Line counts (all files incl. .md and tests)

| Family | Lines | Files of note |
|---|---|---|
| transport | 2422 | integrators/pt/pt.ts 475, volume/grin/grin.glsl 411, volume/delta_tracking 178, combiner.ts 109, flags.ts 47, techniques/{kernel,light,equiangular} ~250 GLSL+TS, shadow/{opaque,media} 81 GLSL, volume/analytic 64 GLSL |
| volume_scattering | 202 | hg (glsl 42), rayleigh (glsl 37), index.ts 19 |
| camera | 767 | 6 occupants, index.ts 127, basis.ts 56 |
| pixel | 81 | box only |
| sensor | 543 | ideal, cie1931 (curves.ts 478 is data) |
| sampler | 124 | pcg4d only |
| accumulator | 250 | average, oneshot, variance statistic |
| tonemap | 395 | none, reinhard, aces, agx, khronos, hable, gt |
| ambient | 117 | euclidean only |

Compiler code that is really part of this area (not inside components/):
- compiler/generate/features/materials.ts (954 lines): medium_sample / medium_transmittance /
  medium_survival / interaction_medium_* dispatch generators, includes the volume/*.glsl bodies.
- compiler/generate/features/lighting.ts (940): picks shadow/opaque vs shadow/media,
  generates lighting_sample, lighting_pdf, lighting_query_delta.
- compiler/generate/features/accumulation.ts (90), pixel.ts (21), camera.ts (161), core.ts (132:
  ambient block, MediumProperties struct, sampler include).
- glsl/core/ray.glsl (make_ray, ray_spawn), structs.glsl (Point/Direction #defines, Ray, Hit,
  LightSample, LightQuery), structs_media.glsl (MediumSample), math.glsl (MAX_DIST,
  SHADOW_BACKOFF, build_basis).

## 3. transport/ — the estimator's anatomy

Four kinds of parts (transport/README.md):

1. **flags.ts** — reads ~20 booleans ONCE from ProgramDescription (nee, mis, media,
   scattering, weightedAbsorption, mediumEmission, nulls, deflecting, dispersion,
   transmission, twoSided, envSamplable, envSelectLive, emitters, emittersPdf, rr,
   equiangular). Every other transport TS file reads only these.
2. **combiner.ts** — generates the MIS/NEE weight functions: `combiner_w_emitter`,
   `combiner_w_env` (T1 side) and `combiner_w_light`, `combiner_w_light_medium` (T2 side).
   pt / pt-nee / pt-mis are three sets of bodies of these functions (table at combiner.ts:9-12).
   `math_mis.glsl` = power heuristic (beta 2), included only under mis.
3. **techniques/** — static GLSL math + small TS glue (blocks + requires lists):
   - `kernel/` (T1, "BSDF/phase sampling"): kernel_score_miss, kernel_score_emitter_hit,
     kernel_sample_continuation (surface), kernel_sample_phase (medium). T1 scores its sample
     one vertex late, so its state (prev_was_delta, prev_bsdf_pdf, prev_query) lives in
     PathState and is written only by generated `kernel_record` (kernel.ts:42-55).
   - `light/` (T2, NEE): light_sample_direct (surface), light_sample_direct_medium (medium
     event). Samples lighting_sample(light_query_*), builds the shadow ray, calls
     shadow_transmittance, scores with combiner_w_light*.
   - `equiangular/` (T2 placement variant): per segment, delta lights only, nee only,
     homogeneous only (Validator-pinned, Validator.ts:507-580).
4. **integrators/pt/pt.ts** — generates the walk `transport_trace` plus PathState,
   path_state_init, light_query_surface/medium constructors, roulette, roulette_interior,
   shadow_crossings_left, collapse_wavelengths. Registry `integrators/index.ts` has one entry.
5. **volume/** and **shadow/** — static GLSL bodies with NO descriptors or registry; the
   compiler imports them directly (materials.ts:23-26, lighting.ts:24-25).

### The generated walk (pt.ts:299-464), in order per iteration `bounce = 0..N`

```
hit = scene_intersect(s.ray)
if media:
  med_mat = material_of(s.current_medium)
  if material_has_medium(med_mat):
     [equiangular] if bounce<N: equiangular_sample_direct(segment)
     ms = medium_sample(med_mat, s.ray, boundary ? hit.t : MAX_DIST, random2())
     [emission] s.radiance += s.throughput * ms.radiance
     s.throughput *= ms.weight
     [deflecting] if ms.deflected: if bounce==N break; kernel_record(delta);
                  s.eta_scale *= ms.eta_scale; s.ray = make_ray(exit_p, exit_dir); continue
     [scattering] if ms.scattered: if bounce==N break;
                  [nee && !equiangular] light_sample_direct_medium
                  kernel_sample_phase; [rr && weighted] roulette_interior; continue
  if !boundary: kernel_score_miss; break
  self-heal: current_medium = hit.region_from
else if !scene_intersect: kernel_score_miss; break
mat = material_of(hit.region_owner)
[nulls] if is_null_interface(mat): current_medium = region_to; ray_spawn straight on;
        null_crossings++ (> MAX_NULL_CROSSINGS ends path); bounce--; continue
props = scene_material_properties(...); wo = -s.ray.direction
[aovs] if bounce==0: capture
kernel_score_emitter_hit; if bounce==N break
[dispersion] collapse_wavelengths
[nee] light_sample_direct
kernel_sample_continuation (break on black)
[media] LOBE_TRANSMISSION -> current_medium = region_to
[transmission] eta_scale *= (n_to/n_from)^2
[rr] roulette
s.ray = ray_spawn(hit, bs.wi)
```

### maxBounces semantics (pt.ts:289-298)
`maxBounces = N` = paths with at most N scattering events (surface events, medium scatter
events, and each GRIN traversal). Loop runs N+1 intersections; the last only scores emission.
NEE and continuation run only while bounce < N, so pt / pt-nee / pt-mis count the same set.
Null crossings do not count (bounce--), they have their own budget MAX_NULL_CROSSINGS shared
with shadow rays via shadow_crossings_left (pt.ts:187-197; shadow/media/media.glsl:37).

### Russian roulette
- `roulette()` (pt.ts:204-222): surface site only, after the continuation weight, metric
  max-channel throughput times eta_scale when transmission exists, capped at RR_MAX_SURVIVAL.
- `roulette_interior()` (pt.ts:230-283): medium site only, probability = max channel of
  medium_survival (sigma_s/sigma_t), emitted only when a weighted-absorption arm exists
  (analytic or GRIN-scatter). Tracking arms already terminate by lottery, so no RR there.
- GRIN has its own long-traversal roulette inside the walker (grin.glsl:36-58, 156-161).

### NEE / MIS
- Surface: light_sample_direct (light.glsl:8-28). light point = ambient_geodesic(hit.p, ls.wi,
  ls.distance); shadow ray origin = ray_spawn, direction re-aimed with ambient_direction_to;
  cosine via ambient_dot.
- Medium vertex: light_sample_direct_medium (light_medium.glsl), no cosine.
- MIS weights: combiner_w_light uses interaction_surface_pdf; combiner_w_emitter replays the
  stored LightQuery (prev_query) in lighting_pdf; combiner_w_env uses environment_pdf and
  u_envSelectProb.
- Delta events (specular, GRIN traversal) set prev_was_delta, so the next emitter hit is
  counted at full weight.

### Media tracking (docs/fable-transport-verification.md)
- No medium stack: one `current_medium` region id, set at LOBE_TRANSMISSION and null
  crossings, self-healed from hit.region_from at every hit (pt.ts:396-397), initialized with
  scene_region_at(camera origin).
- Classification inside scene_intersect (intersection.ts:1690-1710): an outside probe
  along hit.ng, the sign of ambient_dot(ray.direction, hit.ng, hit.p).
- Boundary owner's BSDF shades (material_of(region_owner)); emission keyed on region_to.

### Volume arms (seam 1: medium_sample; seam 2: medium_transmittance)
Routing generated in materials.ts:675-726 per medium, by predicates in compiler/types.ts
(mediumIsDeflecting, mediumRoutesToTracking, mediumWeightsAbsorption):

| Medium | medium_sample arm | medium_transmittance arm |
|---|---|---|
| constant, absorbing | inline Beer-Lambert (+ emission integral) | analytic |
| constant, scattering | medium_sample_analytic (channel-MIS, pbrt-v3) | analytic |
| expression, absorbing | medium_sample_ratio_absorb | ratio_absorb weight |
| expression or emissive, scattering | medium_sample_delta (Kutz Alg. 4) | medium_transmittance_ratio |
| deflecting (GRIN), absorbing/emitting | medium_sample_grin (Verlet ODE) | ZERO (opaque, declared) |
| deflecting, scattering | medium_sample_grin_scatter | ZERO |

`estimator.volumeSampling` does NOT select any arm (no generator reads it; see finding F3).

### GRIN (grin.glsl)
Velocity-Verlet integration of the optical-metric ray ODE (r' = T, T' = n grad n), central
differences for grad n, adaptive step (GRIN_DS_MAX, GRIN_DTOL), bisection exit with a pull-back
inside the wall, interior (n0/n)^2 radiance factor mirrored into eta_scale, black-hole capture
at n > 50. The wall's material decides the interface on the next iteration. Two arms
(deterministic absorbing, arc-length channel-MIS scattering) each carry their own copy of the
step/limiter/bisection loop.

### Shadow bodies
- shadow/opaque/opaque.glsl: maxDist = length(light_p - origin) - SHADOW_BACKOFF; any-hit.
- shadow/media/media.glsl: segment walk by re-spawn; null interfaces pass; everything else
  blocks; per-segment medium_transmittance; re-aim at light_p with ambient_direction_to.

## 4. volume_scattering/ (phase functions)
Mix-many family, descriptor = {id, glsl, properties} (hg has phase_g; rayleigh none). The
compiler generates interaction_medium_{sample,eval,pdf} dispatch over mp.model
(materials.ts:620-645). Both use raw dot and build_basis; hg.glsl:8-9 says so.

## 5. camera/, pixel/, sensor/, sampler/, accumulator/, tonemap/
- camera: descriptor {type, glsl, authoredParams, validateAuthored, controls, derived, defines};
  shared look-at basis computed on CPU (basis.ts) and shipped as u_cameraForward/Right/Up.
  GLSL contract `Ray camera_generateRay(vec2 film, vec2 xiLens, Wavelengths wl)`. All six
  occupants build Euclidean vec3 directions (and thin lens / orthographic shift origins by
  linear combinations).
- pixel: `vec2 pixel_sample(vec2 coord, vec2 xi)`, box only, included unconditionally
  (pixel.ts hardcodes PIXEL_MODELS.box).
- sensor: `sensor_response` (two different signatures by color model, declared in README).
- sampler: counter-based pcg4d, `rng_init/random/random2`; components draw ONLY through it.
- accumulator: static `vec3 <mode>_update(...)` rules; generated main folds each picture;
  variance statistic via Welford in normalized form.
- tonemap: `vec3 <id>_curve(vec3)` + encodesToDisplay flag.
These six are small, uniform and clean. Only doc staleness found (see findings).

## 6. ambient/ — the curved-space seam

Occupant contract (euclidean.glsl): ambient_geodesic(o, d, t) -> Point, ambient_frame(p, n),
ambient_dot(a, b, p), ambient_parallel_transport(v, from, to), ambient_direction_to(from, to).
Point/Direction are `#define`d vec3 in glsl/core/structs.glsl:4-5, NOT by the ambient occupant.
The descriptor is {type, glsl} only (ambient/index.ts:14-19).

### Who routes through the seam (checked, full grep)
- ray.glsl:30-31 ray_spawn (ambient_dot, ambient_geodesic).
- light.glsl:20-26 (light point via ambient_geodesic, aim via ambient_direction_to, cosine
  via ambient_dot); light_medium.glsl:14.
- shadow/media/media.glsl:59 (re-aim).
- analytic.glsl:31, delta_tracking.glsl:75,110,143,168, grin.glsl:324, equiangular.glsl:37
  (points along a ray via ambient_geodesic).
- intersection.ts:707-709, 904-906, 1023-1025, 1693-1707 (hit.p, hit.frame, classification).
- materials (lambert, checker, mirror, dielectric, microfacet_to_local), aov/normal.
- ambient_parallel_transport: provided, never called (in-progress scaffolding).

### Who bypasses it (checked)
- Arrival direction: no seam returns the tangent at t. pt.ts:420 `wo = -s.ray.direction`
  (direction at the ray ORIGIN used at the hit); intersection.ts:1694 dots origin direction
  with the normal at hit.p; kernel.glsl:13 and combiner_w_env use s.ray.direction for the
  environment; analytic.glsl:32, delta_tracking.glsl:111, grin.glsl:325 set
  `exit_dir = ray.direction` at a point t along the ray. Documented open item:
  fable-reference-implementations.md §10 ("the ray's direction at a far hit ... Open").
- Distance: shadow/opaque/opaque.glsl:17 and shadow/media/media.glsl:39 use length() (comment
  acknowledges).
- Equiangular: dot/length/vector differences (equiangular.glsl:25-47), declared Euclidean.
- GRIN: all positions vec3, drift r + h*T (grin.glsl:97-411).
- Phase functions: raw dot + build_basis (hg.glsl:13,30; rayleigh.glsl:11,25).
- Cameras: Euclidean vec3 construction; CPU basis in basis.ts.
- Light samplers: declared "METRIC EXEMPTION" (lights/*/…glsl); 1/d^2 and d^2/(A cos) are
  Euclidean Jacobians (quad.glsl:30,40; point.glsl:18).
- vec3 literals for Direction/Point: pt.ts:137, kernel.ts:35 (`vec3(0.0)` normal), signatures
  `scene_medium_properties(int, vec3 p, ...)`, `ior_at(int, vec3 p, ...)`,
  `environment_radiance(vec3 dir, ...)`.
- MAX_DIST used as a geodesic parameter for points at infinity: light.glsl:20 with
  ls.distance = MAX_DIST for env/directional (structs.glsl:91). In H3 (hyperboloid)
  cosh(1000) overflows float32 (cosh(89) ~ 2e38).

### The interface a curved ambient would have to fill (my synthesis; thought through, not built)
1. Types: Point and Direction (vec4 in hyperboloid/S3 models; tangent vectors live at a base
   point). Today fixed in core structs.glsl, so the occupant cannot set them.
2. Geodesic flow of the full state: (p, v) -> (p(t), v(t)). Today only p(t). Needed for wo,
   classification, event directions, the environment lookup. The old thurston-rebuild repo
   has exactly this: `Vector flow(Vector v, float t)` with Vector = (Point pos, vec4 dir)
   (thurston-rebuild/src/geometries/hyp/geometry/shaders/part2.glsl:78).
3. Two-point problem: direction_to (exists), distance (missing; replaces length() in
   shadows), and the area-to-solid-angle Jacobian for NEE (missing; today folded into light
   samplers as Euclidean d^2). In H3 the falloff is sinh^2(d); in S3 sin^2(d); in H2xR it is
   direction-dependent (a horizontal geodesic has one transverse Jacobi field growing like
   sinh and one like t), so the helper must take both endpoints, not just a distance.
   Old repo: `direction(p,q)`, `dist(p,q)`, `trueLightIntensity(len) = 1/sinh^2`
   (thurston-rebuild/src/geometries/hyp/imports/*.glsl).
4. Non-uniqueness: in S3 (compact, positive curvature) a light at q reaches p along the short
   arc, the long arc, and wraps. Unidirectional NEE with one direction_to would miss what the
   BSDF path finds, so pt and pt-nee would disagree. The seam needs either an enumeration of
   connecting geodesics or a declared truncation. H3 and H2xR are uniquely geodesic.
5. Infinity: environment lookup needs the asymptotic direction (ideal boundary in H3); S3 has no
   escape at all; MAX_DIST cannot be passed to ambient_geodesic in H3.
6. Local frames: ambient_frame (exists), a metric-aware build_basis for samplers (phase,
   sphere light), and phase functions needing the base point for ambient_dot.
7. Marching: SDF marching in the metric (intersection area, out of scope here); GRIN
   integration would have to move onto n^2 g.
8. 1-D media math is already curved-correct: analytic/delta tracking speak only arc length t
   and step via ambient_geodesic, so Beer-Lambert and tracking hold if scene_intersect returns
   arc length (fable-volumetric-component.md §5 says so; ambient/README.md says the opposite).
