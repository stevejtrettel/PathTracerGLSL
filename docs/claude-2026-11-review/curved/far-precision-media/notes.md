# Far limits, sky, epsilons, precision, homogeneous media in H3 / S3

Labels: [checked-code] file:line read; [checked-num] script in this folder; [math] my derivation;
[mem] memory only. Scripts (run from the repo root with `npx tsx <path>`):
`lib.ts` (helpers), `h3_sky.ts`, `h3_precision.ts`, `s3.ts`, `h2xr_key.ts`.

Conventions: H3 form <a,b> = a1b1+a2b2+a3b3-a4b4, origin o = (0,0,0,1). "w" below is the 4th
coordinate. A ray is (p, v): base point and unit tangent at p.

## 0. Where the code uses MAX_DIST or Euclidean distance today [checked-code]

- math.glsl:11 `#define MAX_DIST 1000.0`.
- intersection.ts:1682 `hit.t = MAX_DIST` (the search starts at the far clip).
- pt.ts:327, 331: on a miss inside a medium, the segment length is MAX_DIST (equiangular, medium_sample).
- sampler_cdf.glsl:78 and environment.ts:81 (env samplers), directional.glsl:22: `ls.distance = MAX_DIST`.
  These become a geodesic parameter for a point "at infinity": light.glsl:20 and
  light_medium.glsl:14 form `light_p = ambient_geodesic(p, ls.wi, ls.distance)`.
- Shadow walkers measure the remaining length with Euclidean `length(light_p - origin)`:
  opaque.glsl:17, media.glsl:39.
- The sky is looked up with the ray's INITIAL direction: kernel.glsl:13
  `environment_radiance(s.ray.direction, ...)`; the MIS weight likewise: combiner.ts:60–61
  `environment_pdf(s.ray.direction)`. env_sample already receives the shading point
  (`environment_sample(Point p, ...)`, lighting.ts:553/617/890) but environment_pdf does not.
- Analytic medium: analytic.glsl:16 (free flight in t), :31 event point via ambient_geodesic,
  :32 `ms.exit_dir = ray.direction` (the event's incident direction = the ray's initial direction).
- Equiangular: Euclidean throughout (equiangular.glsl:25–47: dot, length, 1/d²).

## 1. What replaces MAX_DIST per space

### E3: unchanged (1000.0).

### S3: 2π is an exact search limit, not a truncation
- Every geodesic is closed with period 2π [math]; float32 return error after TWO_PI is 2.3e-7
  (s3.ts [1]); float32 TWO_PI = 2π + 1.75e-7.
- A ray that hits nothing on [0, 2π) never hits anything. A camera ray that misses returns
  through the camera, which has no geometry. In vacuum, radiance along a closed source-free
  geodesic is 0, so **black is the exact answer, not a declared truncation** [math].
- Rays from a CLOSED surface always hit something within one lap (at least the entry point of
  the chord through the object they left) [math]. Rays from an OPEN surface (quad, disk) that miss
  everything else come back and hit their own surface from behind at t ≈ 2π − eps. That is correct
  physics and needs no special case [math].
- **Ambient medium + 2π is a large truncation.** If a ray misses inside a medium, cutting the
  free flight at 2π drops everything scattered after the first lap. P(survive one lap)
  = e^{−2πσ}: 0.94 at σ = 0.01, 0.53 at σ = 0.1 (s3.ts [4]). Since every lap retraces the same
  geodesic, the exact in-scatter is (one-lap value)/(1 − e^{−2πσ}), 16× the truncated value at σ = 0.01.
  **Exact and simple:** keep 2π as the geometry search limit; on a miss give medium_sample an
  unbounded segment (a huge finite t_max). The event point cos t·p + sin t·v is exact for any t.
  medium_sample_analytic then needs no change: with t_max finite, σ = 0 channels give exp(0) = 1, not NaN
  (analytic.glsl:16, 36). Float32 cost: the error is set by the representation of t itself
  (2e-6 at t ≈ 100, 1.7e-5 at t ≈ 1000; s3.ts [3]). GPU sin/cos accuracy for large arguments is
  not specified by GLSL ES [mem]; `mod(t, TWO_PI)` first is harmless (same error) but is
  hardening against unmeasured behavior. Measure it on SwiftShader before adding it.
- Position error is uniform in S3 (≈ 1e-7 everywhere, radial renormalization is fine;
  s3.ts [2]).
- Two geodesics join any two points (short arc d, long arc 2π − d), both with falloff 1/sin²d
  [math; s3.ts [5]]. NEE that uses only the short arc misses real direct light, so pt-nee would
  disagree with pt. Every positional light sampler must pick an arc (e.g. ½ each) or sum both. The
  shadow walker then needs "distance along THIS ray to the target": short arc d if
  <dir, u_short> > 0, else 2π − d. Today it re-aims with ambient_direction_to (media.glsl:59), which
  always picks the short arc. That is one small S3-only helper (extra machinery, but required).

### H3: a declared finite clip T in arc length plus the ideal-point sky
- float32 cosh overflows at t = 89.42; the point's coordinates are about cosh(t + D)
  (h3_precision.ts [1]).
- Float32 points are meaningful only near the world origin. See §2: arc error ≈ 2⁻²³·w with
  w = cosh D, so 1e-4 at D ≈ 8 and 1e-3 at D ≈ 10.
- What a clip T removes: near a plane's ideal circle, a band of width ≈ 2 sinh(h)·e^{−2T}
  (h3_precision.ts [4]). For T = 10 that is 5e-9 rad at h = 1, about 10⁻⁵ of a pixel. A whole object
  beyond T subtends ≲ sinh R·e^{−T}.
- Shadow target at the clip: light_p = flow(x, v, T) is finite in float32 for T ≤ 40 (overflows at
  60). The walker distance must use the acosh form there: the stable asinh form, right for
  short distances, fails completely for far points (error = T at T ≥ 20). acosh error is 2.5e-4
  at D = 4, and the re-aim angle error ≤ 1.6e-4 rad (h3_precision.ts [3]). So the H3
  ambient_distance needs two branches: asinh for small d, acosh for large.
- Recommendation: **MAX_DIST = 10 in H3** as a declared measurement truncation (the bias ledger entry,
  the same role as E3's 1000). It is far from overflow, all cut content is sub-pixel, and the
  sky key does not depend on T at all.
- Ambient medium + sky in H3: exact physics says the sky is invisible (transmittance to infinity
  is 0). With the clip the sky leaks e^{−σT} (0.90 at σ = 0.01, T = 10), a large error. A truly
  unbounded segment puts event points beyond float32's range. **Recommend a compile error for
  "ambient medium + any sky" in H3, first version.** With no sky, the clip is effectively exact: events
  beyond T see only lights at distance ≥ T − R_scene, a relative weight of about 4e^{−2(T−R)} [math].

### Where the clip lives
Simplest: each ambient occupant defines MAX_DIST (E3: 1000.0, the same text; S3: TWO_PI for
the search; H3: 10.0). S3 also needs a separate "miss segment length" for media (see above), so
the walk's `boundary ? hit.t : MAX_DIST` (pt.ts:327, 331) reads a second constant in S3. Check
the include order: MAX_DIST must be defined before the intersection code.

## 2. Epsilons and fp_uncertainty

- EPS_INTERFACE, MARCH_CLEARANCE and hit.eps are already used as arc lengths through
  ambient_geodesic (intersection.ts:1693, 1701; ray.glsl:31; geometry/index.ts:296 `t = max(t0,
  MARCH_CLEARANCE)`) [checked-code]. In curved spaces they are lengths in units of the curvature
  radius; no change.
- SHADOW_BACKOFF is subtracted from a Euclidean length() (opaque.glsl:17, media.glsl:39). It must
  become an ambient geodesic distance (E3 body: `length(to - from)`, the same arithmetic).
- march_epsilon(t) = min(5e-4, 1e-4·(1+t)) (march.glsl:20) assumes the pixel footprint grows like
  t. In H3 the footprint grows like sinh t ≥ t, so the rule is conservative and needs no change [math].
  In S3 the footprint is |sin t|, which shrinks to 0 at the antipode (t = π, focusing). There the
  capped 5e-4 residual is an angular error of 5e-4/|sin t|: 3.5e-3 rad, about 3–4 px, at t = 3.0 [math].
  The S3 march should use 1e-4·(1 + |sin t|), or no growth.
- **fp_uncertainty reads only p.x, p.y, p.z** (math.glsl:54–56). For vec4 points:
  - H3 measurement (h3_precision.ts [2], [2b]): a float32 point flowed to distance D has arc error
    that depends on how it is put back on the hyperboloid:
    - radial renormalization p/√(−<p,p>) (thurston's hypNormalize; thurston-rebuild
      src/geometries/hyp/geometry/Point.js:15–20) gives ≈ 2⁻²³·w²: 2.5e-4 at D = 4, 1.2e-2 at
      D = 6. It CANNOT renormalize at D ≥ 8 (<p,p> changes sign: 10/2000 cases at D = 8, 993/2000
      at D = 12).
    - keeping xyz and recomputing w = √(1 + |xyz|²) gives ≈ 2⁻²³·w: 3.1e-6 at D = 4, 1.6e-4 at
      D = 8, the same order as merely rounding the exact point.
    - **Rule: renormalize H3 points by recomputing w, and fp_uncertainty = max(ABS, REL·max|p_i|
      over all four coordinates)** (= REL·w in H3). Measured error/fp_uncertainty ≤ 0.6 at every D
      tested; with xyz only and radial renormalization the ratio exceeds 1 at D = 6.
  - S3: coordinates ≤ 1, so fp_uncertainty ≈ 3e-5 everywhere (measured error ~1e-7, s3.ts [2]).
  - E3: unchanged (vec3).
- Consequence for H3 (the analogue of E3's "coordinates > 33"): REL·w exceeds EPS_INTERFACE =
  MARCH_CLEARANCE = 1e-3 at w > 33, i.e. **D > 4.2 from the world origin**. Beyond that the §4.2
  classification band can fail, exactly as at |coord| > 33 in E3 (geometry/index.ts:218,
  Validator.ts:1684 warns in E3). H3 scenes must sit within about D = 4 of the world origin, with the
  camera near the origin. An H3 placement check analogous to the E3 scale warning is a candidate.
- Ideal-point key accuracy in float32 (h3_sky.ts [5]): ≤ 2.3e-6 rad for ray origins at D ≤ 2.
  At D = 4 it is 1.6e-5 for random rays and 1.2e-4 for rays pointing back toward the origin (the
  cancelling case); at D = 6 it is 3.5e-3. For comparison a 4k equirect texel is ≈ 1.5e-3 rad.

## 3. The H3 sky

- Key [checked-num, h3_sky.ts [1]]: γ(t) = cosh t·p + sinh t·v → (e^t/2)(p+v); p+v is null; its Klein
  point (p+v).xyz/(p+v).w is a unit 3-vector (|·|−1 ~ 3e-14), and Klein(γ(t)) converges to it
  (2e-2 rad at t = 5, 9e-7 at t = 10). **key(p,v) = normalize((p+v).xyz)**, in WORLD
  coordinates. The sky image is the visual sphere of the world origin; at the origin, key = view
  direction exactly. env rotation applies to the key.
- Direction at x toward an ideal point ξ (unit 3-vector), with ξ̂ = (ξ, 1):
  v = (ξ̂ + <x,ξ̂>x)/(−<x,ξ̂>). This is unit, tangent, and key(x, v) = ξ (h3_sky.ts [2], errors ~1e-13). No
  frame is needed.
- Jacobian [checked-num, h3_sky.ts [3], [4], [6]]: dΩ_origin/dΩ_x = 1/((x+v).w)² = <x,ξ̂>²
  (finite differences 9e-5; quadrature ∫ J dΩ_x/4π = 1.000000 for D = 0…4). So a table pdf p_o
  over ideal points becomes a solid-angle pdf at x:
  **pdf_x(v) = p_o(key(x,v)) / ((x+v).w)²**, identity at the origin. This is the Poisson kernel of
  the ball, exponent n−1 = 2. ENV_COMPENSATED tables stay valid (only exact evaluation matters), but
  they are tuned for the origin.
- Variance: with p_o ∝ L, the NEE weight at x is ∝ ((x+v).w)², which spans [e^{−2D}, e^{2D}]
  (×55 each way at D = 2).
- Trap [math]: along a geodesic, x(t)+v(t) = e^t (x+v), so the key is invariant but the Jacobian
  is not. The MIS weight on a miss must use the scattering vertex's (x, v). Today s.ray is
  re-spawned at null-interface crossings (pt.ts:410), so after a crossing s.ray.origin is the
  crossing point, not the vertex. In E3 that is harmless; in H3 it would be wrong. A fix needs either
  one PathState float recorded by kernel_record, or no NEE/MIS for image skies.
- **Simplest correct first version:**
  1. Constant sky: NEE + MIS work unchanged in meaning. Sample a uniform direction at x with a tangent
     basis at p; the pdf is 1/(4π) and does not depend on x, so null crossings are harmless and no key
     is needed for a constant radiance. It does need a tangent basis at p, which phase sampling
     and light sampling need anyway.
  2. Image and procedural sky: a BSDF-only lookup by key (environment not samplable in H3; this is an
     estimator choice, so the converged image is unchanged). One new seam:
     `vec3 ambient_sky_key(Point p, Direction v)` (E3: `return v;`, which keeps E3 bit-identical).
  3. Later: image-sky NEE/MIS through the origin table plus the Jacobian above (pdf takes p;
     one PathState field for the vertex).
- Directional lights: E3 only (Validator).

## 4. Homogeneous media [checked-code unless marked]

- Beer–Lambert and free-flight sampling depend only on arc length t: analytic.glsl:9–43 and
  emission.glsl are curved-correct given arc-length t and ambient_geodesic [math + code].
- **analytic.glsl:32 `ms.exit_dir = ray.direction` is wrong off E3.** The incident direction at the
  event is the velocity at t (H3: sinh t·p + cosh t·v; S3: −sin t·p + cos t·v). The ambient
  must expose the flowed velocity, not only the point. The same problem appears at null crossings:
  `ray_spawn(hit, s.ray.direction)` (pt.ts:410; media.glsl:58) passes a tangent vector from the
  old origin to a function that dots it with hit.ng at hit.p (ray.glsl:30).
- medium_transmittance_analytic(len): len comes from the shadow walker's Euclidean length
  (media.glsl:39) → ambient distance.
- Phase functions: raw dot + build_basis(vec3) (hg.glsl:13,30; rayleigh.glsl:11,25). In S3, the R⁴
  dot of two tangent vectors at the same point IS the metric [math]; in H3 it is not (Minkowski).
  build_basis has no vec4 form → phase sampling needs a tangent basis at the event point.
- Equiangular (equiangular.glsl:18–56): Euclidean closest approach (t_c = dot(D,d), h² = |D|²−t_c²),
  falloff 1/d², straight to_light. The survey has the curved forms (H3: tan θ = tanh τ / sinh h;
  S3: tan τ / sin h, piecewise) [from survey/curved-literature.md:197–205, not rechecked]. S3
  additionally has two arcs and segments up to 2π. **First version: compile error for
  mediumLightSampling 'equiangular' off E3.**

## 5. H2×R (brief)
- No compact directions, unique geodesics. The far clip is like H3 (coordinates grow like
  cosh(t sin β) horizontally and linearly vertically).
- Sky key = endpoint class (ideal point ξ_H of the H2 part, angle β to vertical):
  K = (sin β·ξ_H, cos β), ξ_H = Klein(p_H + û). At the origin K is the view direction [math];
  the H2 limit was checked (h2xr_key.ts).
- Jacobian: β is invariant; dφ_o/dφ_x = 1/(p_H + û).z [checked-num, h2xr_key.ts, FD agrees to 6
  digits], so dΩ_o/dΩ_x = 1/(p_H + û).z (exponent 1 in H2) [math for the product step].
- fp_uncertainty over all coordinates; the w-recompute renormalization applies to the H2 part.

## 6. Machinery added, by item
- None for E3 (text changes only; check bit-identity with `npm run frames -- compare`, since
  digest compares text).
- Per-space MAX_DIST constant (all spaces): trivial.
- `ambient_distance(p, q)` (needed for shadow walkers in every curved space; H3 two-branch).
- `ambient_sky_key(p, v)` (H3; E3 identity).
- Flowed velocity from the ambient (needed by media events, null crossings, wo at hits).
- Tangent basis at p (constant-sky NEE, phase sampling).
- S3 only: the miss-segment length for media; the arc-aware shadow distance; arc choice in light
  samplers.
- Deferred: H3 image-sky NEE/MIS (Jacobian + one PathState float).
