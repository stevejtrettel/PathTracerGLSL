# Light sampling in H3 and S3: Monte Carlo twins (float64)

Folder: /private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/curved/light-sampling-twins/
Run from the repo root: `npx tsx <folder>/<script>.ts` (env `N=` sets the sample count).

| script | what it does | output |
|---|---|---|
| geom.ts | H3 (hyperboloid, <x,y> = x1y1+x2y2+x3y3−x4y4, origin (0,0,0,1)) and S3 (unit sphere in R4): flow (position and velocity), log, frames, geodesic disks and balls (hit, sample, normal), RNG, stats | — |
| sanity.ts | identities: on-model, unit tangent, log∘exp, S3 long arc, arrival velocity = −direction_to(y,x); disk-edge and cone-edge exactness | sanity.out.txt |
| irradiance.ts | estimator equality A / B / MIS / C for disks and balls, 4·10⁶ samples each | irradiance.out.txt, irradiance.recheck.out.txt |
| s3_one_arc.ts | S3 with one arc per light sample (the current LightSample shape) | s3_one_arc.out.txt |
| pointlight.ts | point light vs small-ball limit; S3 antipodal caustic | pointlight.out.txt |
| equiangular.ts | equiangular pdf normalization, inverse, and estimate vs Simpson | equiangular.out.txt |
| furnace.ts | closed furnace (pt / pt-nee / pt-mis, 6 bounces, rho 0.8), 8·10⁵ paths | furnace.out.txt |
| diag_vis.ts | S3 big-ball NEE: visibility test never rejects a valid arc | (stdout, quoted below) |

Receiver: x = origin, normal n = e3, Lambertian albedo 1, Le = 1. "expected" means a closed form.
z = (mean − expected)/se. All results below are [checked-num] by the script named.

## 1. What was verified

**Area → solid angle uses A(r) = S(r)²** (sinh² in H3, sin² in S3): dω_x = |cos_y| dA_y / A(r),
with cos_y taken against the geodesic's arrival velocity at y. [checked-num irradiance.ts]
In H3 and S3, for on-axis disks (closed form Le·π·sin²β, tan β = T(ρ)/S(D), T = tanh/tan),
tilted off-axis disks, disks crossing the horizon, on-axis and off-axis balls (closed form
Le·π·sin²α·cos θ_c when the cap is fully above the horizon) and balls crossing the horizon,
A (cosine/BSDF), B (area sampling), MIS (power heuristic, one sample each) and C (cone) agree.
75 comparisons, |z| ≤ 2.54. The three cases with |z| > 2.3 were rerun with new seeds at 8·10⁶
and gave |z| ≤ 1.01 (irradiance.recheck.out.txt).

Selected rows (N = 4·10⁶):

| case | A | B | MIS | C | expected |
|---|---|---|---|---|---|
| H3 disk on axis D=1 ρ=0.7 | 0.65720 ± 0.00064 | 0.65701 ± 0.00011 | 0.65704 ± 0.00010 | — | 0.657081 |
| H3 disk on axis D=4 ρ=3 | 0.004214 ± 5.7e-5 | 0.0041621 ± 5.3e-6 | 0.0041622 ± 5.3e-6 | — | 0.0041712 |
| H3 disk tilted D=1.5 ρ=1.2 | 0.29951 ± 0.00046 | 0.29964 ± 0.00017 | 0.29964 ± 0.00016 | — | (agree) |
| H3 ball on axis d=3 R=2 | 0.41128 ± 0.00053 | 0.4134 ± 0.0025 | 0.41132 ± 0.00052 | 0.4117754 ± 4.2e-6 | 0.4117753 |
| H3 ball off-axis d=2 R=0.5 θ=0.9 | 0.040314 ± 1.8e-4 | 0.040314 ± 4.7e-5 | 0.040314 ± 4.7e-5 | 0.0403126 ± 1.8e-6 | 0.0403126 |
| S3 disk on axis D=2 ρ=0.5 (past π/2) | 0.83321 ± 0.00069 | 0.833188 ± 2.7e-5 | 0.833203 ± 5.1e-5 | — | 0.833221 |
| S3 disk BELOW x, one-sided facing x | 0 | 0 | 0 | — | 0 |
| S3 disk BELOW x, one-sided facing away | 1.24995 ± 0.00077 | 1.250253 ± 7.9e-5 | 1.25020 ± 0.00012 | — | 1.250217 |
| S3 ball BELOW x d=1 R=0.5 | 1.02000 ± 0.00074 | 1.01986 ± 0.00048 | 1.01995 ± 0.00039 | 1.02074 ± 0.00051 | 1.019797 |
| S3 ball crossing horizon | 0.31673 ± 0.00047 | 0.31618 ± 0.00028 | 0.31618 ± 0.00023 | 0.31625 ± 0.00021 | (agree) |

**Cone half-angle is exact**: sin α = S(R)/S(d). Over 200 azimuths each, directions at α(1−10⁻⁷)
hit the ball and directions at α(1+10⁻⁷) miss it, in 6 configurations (H3 up to d=4, R=2.5).
Cone sampling never missed in 4·10⁶ samples per case. [checked-num sanity.ts, irradiance.ts]
The disk-edge formula tan β = T(ρ)/S(D) has the same exactness. [checked-num sanity.ts]

**S3 has a second, backward cone.** A ball at distance d is also seen around −(direction to its
center), with the same half-angle α, through the antipode (long arcs). This was checked at the edges
in sanity.ts, and by "S3 ball BELOW x", which lies entirely below the horizon and is lit only
through that cone. A cone sampler in S3 must cover both cones. The twin picks each with
probability ½, so each pdf is halved. [checked-num]

**S3 arcs.** Every point y is reached by the short arc (u, d) and the long arc (−u, 2π−d). The long
arc arrives with velocity −(short arc's arrival velocity), so it sees the other face of a surface.
A(2π−d) = A(d). [checked-num sanity.ts] One-sided emitters: a disk below x that faces x is
invisible from above, and one facing away gives the full cap irradiance (table above). For a point
y and a receiver normal n, exactly one of the two arcs leaves into n's hemisphere (u·n and (−u)·n
have opposite signs). Summing both arcs with cos_x clamped therefore partitions the hemisphere
correctly. [math; consistent with every S3 row]

**MIS**: the BSDF-hit weight uses p_B(ω) = (1/area)·A(t)/|cos_y|, where t is the arc length
actually travelled (the long arc in S3). Means agree in every case. [checked-num]

**cos_y needs no new seam**: the arrival velocity at y equals −direction_to(y, x) (worst error
2.7e-12 in H3 up to t=5, 3.3e-13 in S3). [checked-num sanity.ts]

**Point lights**: E = I·max(cos θ,0)/sinh² d in H3. In S3, E = I·|cos θ|/sin² d, because the long
arc lights a receiver from below its horizon too. The matching ball has I = π·Le·S(R)². Exact
for every R while the cap is fully above the horizon (ratio 1.00000000). The limit R → 0 holds when
the finite cap crosses the horizon: H3 θ=1.5 ratio 1.0028 / 1.00000000 / 1.00000000 for R = 0.3 /
0.03 / 0.003, S3 θ=1.5 ratio 2.097 / 1.0000 / 1.0000. In S3 with θ = 2.0 or 2.8 (light below the
horizon) the ratio is 1.00000000. [checked-num pointlight.ts, deterministic cone quadrature]
Flux 4πI is conserved through every geodesic sphere (I/S(r)² × 4πS(r)²). [math]

**Equiangular sampling** (σ_t 0.6, σ_s 0.4, HG g 0.5, I = 3; S3 sums both arcs with their own
transmittance and phase angle) [checked-num equiangular.ts, N = 10⁶]:
- H3: θ(τ) = atan(tanh τ / sinh h), τ = atanh(sinh h·tan θ), with τ measured from the foot t0,
  tanh t0 = −b/a, cosh h = √(a²−b²), a = −⟨p,q⟩, b = −⟨v,q⟩.
- S3: θ(τ) = atan2(sin τ, sin h·cos τ), unwrapped to stay within π/2 of τ (it is continuous and
  gains 2π per period); inverse τ = atan2(sin h·sin θ, cos θ), unwrapped the same way. t0 =
  atan2(b,a), cos h = √(a²+b²), a = ⟨p,q⟩, b = ⟨v,q⟩. This form handles segments up to 2π,
  including the far point and the light's antipode, where 1/sin² d is singular again.
- pdf(t) = S(h)/((θ_b−θ_a)·A(d(t))). It integrates to 1.000000000 over [0,T] in all 9 cases.
  The round trip t → θ → t is within 2e-11, and the pdf matches dθ/dt/(range) to 2e-7.
- Estimates vs Simpson (2·10⁵ and 4·10⁵ intervals agree to 10 digits):

| case | equiangular mean ± se (std/sample) | uniform-t mean ± se (std/sample) | Simpson |
|---|---|---|---|
| H3 q at 1.0, θ 1.2, T 3 | 0.0151140 ± 1.1e-5 (0.0107) | 0.0151097 ± 2.6e-5 (0.0256) | 0.01511278 |
| H3 q at 0.3, θ 1.5, T 6 | 0.0955691 ± 4.9e-5 (0.049) | 0.095890 ± 3.7e-4 (0.37) | 0.09557403 |
| H3 q at 3, θ 0.3, T 2 | 0.0023327 ± 2.0e-6 (0.0020) | 0.0023353 ± 6.4e-7 (0.00064) | 0.002335223 |
| H3 q at 0.05, θ 1.0, T 4 | 1.99168 ± 0.0013 (1.27) | 1.99158 ± 0.014 (14.3) | 1.991212 |
| S3 q at 1.0, θ 1.2, T 3 | 0.0551584 ± 4.5e-5 (0.045) | 0.0551363 ± 5.4e-5 (0.054) | 0.05515509 |
| S3 q at 0.3, θ 1.5, T 6 (past the far point) | 0.215880 ± 1.9e-4 (0.19) | 0.216374 ± 4.1e-4 (0.41) | 0.2159582 |
| S3 q at 2.5, θ 0.8, T 5.5 | 0.237453 ± 2.7e-4 (0.27) | 0.237187 ± 2.2e-4 (0.22) | 0.2372346 |
| S3 q at 0.05, θ 1.0, T 2π−10⁻³ (through −q) | 2.86163 ± 0.0033 (3.33) | 2.86772 ± 0.018 (18.5) | 2.860521 |
| S3 q behind the ray origin (θ 2.6, t0 = −1.49), T 1 | 0.0236140 ± 4.8e-6 (0.0048) | 0.0236095 ± 7.8e-7 (0.00078) | 0.02360988 |

All |z| ≤ 1.25. (The equiangular.out.txt file has every row.) As in E3, equiangular sampling is worse than
uniform sampling when transmittance dominates (H3 light at 3, θ 0.3).

**Closed furnace** (wall Le = 1, ρ = 0.8, at most 6 bounces, expected Σ_{k≤6} ρ^k = 3.951424;
8·10⁵ paths) [checked-num furnace.ts]:

| space, R | pt | pt-nee | pt-mis |
|---|---|---|---|
| H3 0.5 | 3.951424 (zero variance) | 3.95141 ± 0.00020 | 3.95141 ± 0.00010 |
| H3 2 | exact | 3.9518 ± 0.0029 | 3.95073 ± 0.00051 |
| H3 4 | exact | 3.952 ± 0.023 | 3.95095 ± 0.00027 |
| S3 0.5 | exact | 3.95162 ± 0.00022 | 3.95157 ± 0.00011 |
| S3 1.4 | exact | 3.9554 ± 0.0047 | 3.95132 ± 0.00048 |
| S3 2.2 (non-convex), camera at center | exact | 3.95189 ± 0.00092 | 3.95151 ± 0.00037 |
| S3 3.0 (non-convex), camera at center | exact | 3.951449 ± 1.7e-5 | 3.951432 ± 8.4e-6 |
| S3 2.2, camera off-center (d0 = 1.1) | 2.2866 ± 0.0022 | 2.2880 ± 0.0023 | 2.2913 ± 0.0022 |

The last row's expected value is 0.579284 × 3.951424 = 2.288995. In S3 a ball with R > π/2 contains
whole great circles. The camera geodesic in direction θ (measured from the camera→center axis)
stays at distance ≥ h from the center, with sin h = sin d0·sin θ. It never reaches the wall iff
sin θ > sin R / sin d0, which leaves a fraction 1 − cos θ* of rays that reach the wall
[math]. The measured count of rays that never reach the wall is 337050/800000 = 0.4213, against
the predicted 0.4207 [checked-num]. Those rays score 0, because S3 has no sky. All three
estimators agree.

In a non-convex S3 ball, NEE checks visibility on each arc. In 2·10⁶ wall-to-wall samples
(R = 2.2 and R = 3) exactly one arc left inward and was visible, and the test |t_hit − r| < 1e-7
never rejected a valid arc (largest accepted error 1.3e-12). [checked-num diag_vis.ts]

## 2. Findings that affect the design

1. **The sampler change is small.** In the existing samplers, replace d² with A(r) = S(r)², and
   replace sin²θmax = r²/d² with S(R)²/S(d)². The repo's cancellation-free 1 − cos θmax form
   (sphere.glsl:21-24 [checked-code]) applies unchanged. Point light: I/S(d)². cos at the light
   uses direction_to(y, x), which already exists. The new ambient facts are distance(p,q) and
   A(r) (for H2xR, A(p,q); see §3).
2. **S3 doubles the geometry, and the current LightSample has room for only one arc.** LightSample
   holds one wi, one distance and one pdf (src/glsl/core/structs.glsl:89-96 [checked-code]). Two
   options, both checked:
   (a) Pick one arc with probability ½ and halve the pdf (also in the BSDF-hit MIS weight). This
       is unbiased and needs no contract change [checked-num s3_one_arc.ts]. But its per-sample
       variance is about 67× that of summing both arcs for a light fully on one side of the
       surface: on-axis disk, se 0.00090 vs 0.00011 at N = 2·10⁶. The cost is 4.7× and 2.3× in
       the two horizon-crossing cases. With MIS added, se is 0.00069.
   (b) Return both arcs from the light sampler. This has low variance and is what the twin's
       estimator B does, but it **adds machinery**: the contract, the shadow-ray loop and the MIS
       combiner all change. The same applies to the S3 cone sampler (one cone per sample, or both).
   Not tested: (c) choose the arc from the receiver normal. This is unbiased only when the other
   arc's integrand is zero (reflection-only BSDFs). It is biased for transmission and phase
   functions [math].
3. **S3 antipodal caustic.** A light near −x refocuses on x, so area sampling behaves like a light
   at distance h. The S3 disk whose plane passes at distance h from −x has per-sample std
   1.58 / 10.4 / 56.5 at h = 0.2 / 0.05 / 0.01 (∝ 1/h). Cosine sampling gives 1.43 / 0.49 / 0.10,
   and MIS caps the B noise at 0.99 / 1.11 / 0.58. The irradiance is finite (closed form matched).
   [checked-num pointlight.ts] A point light near −x gives E ∝ 1/sin² d, which is unbounded as
   d → π. This is physical, like a point light near x in E3. [math]
4. **Far limit 2π in S3 is exact.** Geodesics are periodic, so the first hit in (0, 2π) is the
   first hit. A disk (ρ < π/2) is crossed at most once per period, because its antipodal points
   lie outside it. [math; consistent with all S3 rows] Rays that never hit anything score 0, as
   in the off-center furnace. Radiance on a closed geodesic that meets no surface is undetermined
   by the transport equation, and the renderer's 0 is a convention. [math]
5. **Numerical drift in H3 is real, and object-local reconstruction fixes it.** [checked-num
   furnace.ts with RENORM=none / model / wall, and a since-deleted trace] Chained wall-to-wall
   segments in a ball of R = 4 (float64), without correction, drifted |⟨y,y⟩+1| from 1e-13 to
   5e-4 to 6e-2 within 6 bounces. Frame building then failed (NaN). Rescaling y back onto the
   hyperboloid, with the normal evaluated at radius R, also failed. Re-deriving each hit point in
   the ball's own frame (spatial direction kept, spatial length S(R), 4th coordinate C(R)) left
   3.4e-10 per segment and stable results. This supports the decision to intersect each object
   in its own local frame. Two related robustness points are also [checked-num]:
   - The closed-form "other root" for a ray leaving a ball's surface, tanh(t/2) = −b/cosh R
     (H3) or tan(t/2) = b/cos R (S3), needs no spawn epsilon.
   - Gram–Schmidt of the coordinate axes with a fixed length threshold fails about 4 units from
     the origin in H3, because every candidate shrinks. Picking the longest candidate works.
   Float32 was NOT tested. Prediction: the same drift appears sooner, so per-vertex
   reconstruction is mandatory there.
6. **Media need no new math beyond A(r).** Equiangular is a two-line change of body (tanh/sinh or
   the S3 atan2 form above). The S3 medium NEE sums both arcs, each with its own transmittance
   e^{−σ r} and phase angle. [checked-num]

## 3. H2xR (brief, all [math], not checked)
- H2xR has unique geodesics, so there is no second arc. A(r,u) = r·sinh(r sin β)/sin β depends on
  the direction (survey curved-literature.md §3 item 2 [checked-code: read]). Area sampling (B)
  carries over with A(p,q) in place of S(r)². The isotropic cone formulas (sin α = S(R)/S(d),
  tan β) do not.
- Equiangular along a vertical ray: the horizontal offset h is constant and r² = h² + τ², so
  A = r²·sinh h / h. Then 1/A ∝ 1/(h²+τ²), the Euclidean equiangular shape. A horizontal ray has
  no closed form derived here.
- There is no isotropic ball furnace. Use a box or a product region instead.

## 4. Not done
- Float32 twins.
- Solid-angle sampling of disks or spherical polygons in charts.
- Two-sided lights through dielectrics.
- A GLSL comparison (these twins test the math, not repo code).
