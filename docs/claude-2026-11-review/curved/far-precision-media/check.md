# Check of far-precision-media

How I checked: I re-ran all four of the agent's scripts (s3.ts, h3_precision.ts, h3_sky.ts, h2xr_key.ts) from the repo root, re-read every cited file:line, and wrote an independent script, check/indep.ts, in this folder.

## What holds up
- S3 2π is exact in vacuum. float32 TWO_PI = 2π + 1.75e-7, and the return error is 2.3e-7 [checked-num, s3.ts re-run].
- In S3, the lap-survival probability is e^{-2πσ} (0.94 at σ=0.01), and the exact answer is 1/(1-q), which is 16.4× the one-lap value [checked-num, s3.ts].
- float32 cosh overflows at t = 89.42. The flowed target stays finite to T = 40 [checked-num, h3_precision [1],[3]].
- The clipped band is about 2 sinh h e^{-2T}. The magnitude matches, but the script prints the widths with a negative sign [checked-num].
- The sky key is normalize((p+v).xyz), and dirToIdeal is correct [checked-num, h3_sky [1],[2]].
- The Jacobian is dΩ_o/dΩ_x = 1/((x+v).w)² = <x,ξ̂>². Independently, (x+v).w·(−<x,ξ̂>) = 1 to 1e-14, which is the reciprocal of the H3 Poisson kernel [checked-num, indep [C]; math]. pdf_x = p_o/((x+v).w)² is right.
- x(t)+v(t) = e^t(x+v) [math, re-derived].
- Radial renormalization error is about 2^-23·w², and it fails at D≥8. Recomputing w gives about 2^-23·w [checked-num, h3_precision [2b] re-run; indep [A]].
- A two-branch H3 distance is needed [checked-num, indep [B]]. From D=4, acosh is off by 1.0e-2 at d=0.01, more than SHADOW_BACKOFF. asinh is off by 2.4e-2 at d=5, and by 10 when the target is the clip point at T=10.
- Citations confirmed:
  - math.glsl:11 and :54-56
  - intersection.ts:1682, 1693, 1701
  - pt.ts:327, 331, 410
  - sampler_cdf.glsl:78, environment.ts:81, directional.glsl:22
  - light.glsl:20, light_medium.glsl:14
  - opaque.glsl:17, media.glsl:39, 58, 59
  - analytic.glsl:16, 31, 32, 36
  - kernel.glsl:13, combiner.ts:60-61
  - march.glsl:20, ray.glsl:30-31
  - hg.glsl:13,30 and rayleigh.glsl:11,25
  - equiangular.glsl:25-47
  - lighting.ts:553/617/890
  - geometry/index.ts:296
  - thurston Point.js:15-20
- The MAX_DIST code-site list is complete. The other grep hits are comments only: pinhole.glsl:17, structs.glsl:91, analytic.glsl:48.

## Corrections
1. **Wrong citations and overstated "working radius".** geometry/index.ts:218 is about the SDF *refinement* residual of conservative fields. Validator.ts:1684 warns about an extreme *transform.scale*. Neither says anything about |coord| > 33. The |p|≈33 crossover is in docs/impl-plan-epsilon-discipline.md:47, and that doc calls it acceptable ("Grazing hits on distant infinite planes get larger offsets — correctly"). It is where the conservative offset exceeds 1e-3, not where classification breaks.
   - The true float32 arc error with the w-recompute reaches EPS_INTERFACE only near D≈10: 1.2–1.5e-3 at D=10 [checked-num, [2b], indep [A]].
   - Restate it as: spawn offsets REL·cosh D are 1e-3 at D=4.2, 6e-3 at D=6 and 4.5e-2 at D=8.
   - "Must stay within D≈4.2" is a judgment, not a measured limit. The proposed H3 placement check is added machinery; drop it or leave it to the owner.
2. **"Measured error/fp_uncertainty ≤ 0.6" is mislabeled.** That number comes from h3_precision [2], which uses radial renormalization at D≤5. No script measured the w-recompute ratio. Independently it is about 4e-3, a 250× margin at every D from 2 to 10 [checked-num, indep [A]]. Also, under radial renormalization the 4-coordinate ratio exceeds 1 at D=6 as well (1.57), not only the xyz-only one.
3. **Missed S3 short-arc site.** light.glsl:22 re-aims the surface NEE shadow ray with ambient_direction_to, as media.glsl:59 does. Both re-aims, not only the distances, must be arc-aware: on the long arc the re-aim must return −u_short. opaque.glsl:17 needs the arc-aware distance too.
4. **The S3 "huge finite t_max" fix is narrower than stated.** "Huge" means a value like the 1e30 the agent's analysis implied; no agent measured one.
   - It is exact only for the analytic scattering arm.
   - Tracking arms (medium_sample_ratio_absorb and delta tracking; materials.ts:703-705) and the GRIN walker step through the segment, so a huge t_max means about σ̄·t_max iterations, or a hang.
   - The emissive absorbing arm (materials.ts:716-717) multiplies by medium_absorption_integral, which returns exactly `len` when σ_a=0 (emission.glsl:7-10). In S3 a non-absorbing ambient emitter has *infinite* exact radiance, so the result is about t_max·emission, or inf/NaN near FLT_MAX. That combination must be a compile error. This answers the agent's open question.
   - The simpler option, with no second constant, is a compile error for any S3 ambient medium in the first version. Offer both and say which is simpler.
5. **A tangent basis is not new machinery.** ambient_frame(p, n) (euclidean.glsl:13) is already the metric-seam frame builder. Phase sampling uses build_basis (math.glsl), the declared-Euclidean helper. The fix is to route phase sampling and constant-sky sampling through ambient_frame, whose curved bodies are unbuilt. "There is no vec4 basis" should read "the seam exists; the curved bodies don't".
6. **Missed citation.** pt.ts:420 `Direction wo = -s.ray.direction;` at surface hits also needs the flowed velocity. The notes list "wo at hits" in §6 but cite no line.
7. **Numbers.**
   - At t=3, march_epsilon = 1e-4·(1+3) = 4e-4, not 5e-4. The angular error is 2.8e-3 rad, not 3.5e-3 [indep [E]].
   - On re-run, h3_sky [5] gives 2.45e-5 (random) and 1.00e-4 (toward the origin) at D=4, and 4.71e-3 at D=6. The notes give 1.6e-5, 1.2e-4 and 3.5e-3. Same order, but the notes' numbers don't reproduce.
   - h3_precision [1]'s "90.1 - ln(2)" is garbled: 90.1 is already the overflow threshold for t+D.
8. **Thurston wording.** hypNormalize is called from JS float64 (Point.js:15-20 → Utils.js:32-35) and in local-frame shaders near the origin. The float32 failure at D≥8 comes from using it far from the origin in float32. It is not a defect seen in thurston.
9. **H3 ambient emitting medium.** With σ_a=0 the exact answer is infinite and the clip makes it T·emission. It belongs in the same compile-error class as ambient medium + sky.

## Optional refinement [math + checked-num, indep [D]]
The S3 long arc reaches y with velocity −(short-arc arrival velocity), and it leaves x along −u. So for a one-sided emitter (quad, disk), exactly one arc sees the emitting face. For a reflecting receiver, exactly one arc leaves into the upper hemisphere. "½ each" is exact but wastes half the samples on one-sided lights. Point and sphere lights need both arcs. This is optional and not needed for correctness.

## Verdict
The core math and the numerics reproduce: 2π exactness, the lap bias, overflow, the clip band, the sky key, the Poisson-kernel Jacobian, w-recompute vs radial, and the two-branch distance. The main recommendations are sound and mostly simple.

Before use, fix these:
- the wrong "33" citations and the overstated D≈4.2 limit;
- the mislabeled 0.6 ratio;
- the missed light.glsl:22 re-aim site (and arc-aware re-aim, not only distance);
- the S3 huge-t_max scope: analytic arm only, and a compile error for zero-absorption ambient emitters. Present a plain "S3 ambient medium = compile error" as the simpler alternative.
