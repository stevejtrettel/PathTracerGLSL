# Geometry twins: E3, H3, S3, H2xR (numeric checks)

Scripts live in this folder. Run them from the repo with `npx tsx <path>`. Their outputs are saved as `out-*.txt`.
Modules: `e3.ts h3.ts s3.ts h2r.ts`, each implementing exactly the operations a GLSL ambient occupant would provide.
Shared helpers are in `common.ts`; it supports float64 and float32 (one Math.fround per operation, no fma).

Labels: [checked-code] file:line, [checked-num] script, [math], [mem].

## Operations each occupant provides (as tested)
flow(p,v,t) -> (p,v); distance(p,q); connections(p,q) -> [(u,len)...]; transport(p,u,L,v);
areaDensity(r[,u]); makeTranslation(p); inverse(M); reducePoint/reduceVec; frame(p,n).
E3 keeps vec3. H3 and S3 use vec4. H2xR uses a vec4 (x1,x2,x3,z) whose tangent form is diag(1,1,-1,1).

## (a) Flow  [checked-num test-a-flow.ts]
- Closed forms. H3: p cosh t + v sinh t, with velocity p sinh t + v cosh t. S3: p cos t + v sin t, with velocity -p sin t + v cos t.
  H2xR: the horizontal part moves at speed |v_h| on H2, and z moves linearly.
- Float64: all spaces stay on the model to <= 4e-14. They match RK4 in a conformal chart (Poincare ball, stereographic, disk x R).
  The position and velocity differences are 4e-15 for H3 and H2xR, and 1.7e-9 for S3, which is the RK4 truncation error near the chart's infinity.
- Float32, with p within 0.5 of the origin and t <= 2.5: the model error |<p,p>+1| is 2e-5 in H3 and H2xR, and 4e-7 in S3.
- Float32 H3 from the origin, measuring the form itself: at t=6 the error |<p,p>+1| is 4e-3. At t=9 it is 1.0, so the Minkowski form is meaningless there.
  cosh overflows between t=89 and t=90 (NaN at 90).

## (b) Distance  [checked-num test-b-distance.ts]
- The stable forms H3 `2 asinh(sqrt<p-q,p-q>/2)` and S3 `2 atan2(|p-q|,|p+q|)` have relative error <= 4e-7 in float32 near the origin at every separation.
  The naive acosh/acos forms are 100% wrong at separation 1e-4 and 5e-4 wrong at separation 1e-2.
- S3: the stable form stays near 1e-7 everywhere, because all coordinates are <= 1. S3 has no precision decay.
- H3 position quantum: the distance between p and its float32 rounding is
  R=1: 1.5e-7, R=2: 1e-6, R=4: 4.7e-5, R=6: 2.1e-3, R=8: 0.17, R=10: 1.5. This is about 1.5e-8 * e^{2R}, not e^R.
  [math] Near the light cone, p and the radial tangent are nearly parallel in R^4, which amplifies the rounding error by e^R.
- H3 float32 distance from p at radius R to a nearby q at separation sep:
  - sep=1e-2: relative error 1e-6 at R=2, 7e-5 at R=4 and 0.19 at R=6.
  - sep=1e-4: the result is useless (relative error 1) at R=4.

## (c) Connections  [checked-num test-ce-connections.ts]
- H3 and H2xR have one geodesic. S3 has two, (u, d) and (-u, 2pi-d), and flow(p,u,len) = q for both.
- Log map: w = (q-p) + <p,q-p>p in H3, and w = (q-p) - <p,q-p>p in S3. The direction error is 1e-7 at sep 1e-3.
  The naive form q + <p,q>p gives 3.7e-4 in H3 (2.5e-4 in S3) in float32.
- Float32 with p near the origin: relative length error is 4e-7 at sep 0.5 and 2e-6 at sep 2. At sep 5 it is 4.4e-4 in H3 and 9e-4 in H2xR, because q is far out.

## (d) Area density  [checked-num test-d-area.ts]
Finite-difference Jacobian of exp vs the formula. The worst relative error is 2e-10 for r^2, sinh^2 r and sin^2 r, and 1.5e-8 for H2xR `r sinh(r sin b)/sin b`.
H2xR depends on the direction (b is the angle from vertical), so the seam must take the direction too: A(r, u), not A(r).
S3: A(pi) = 0, which is the focal point at the antipode. The geometry term 1/sin^2 L blows up there.

## (e) Transport and arrival  [checked-num test-ce-connections.ts]
- transport(p,u,L,v) = v + <v,u>(gamma'(L) - u). It agrees with step-by-step tangential projection, with O(1/n) convergence:
  1.8e-4 -> 2e-5 at n=2e4, and 4e-5 -> 4e-6 at n=2e5. It preserves norms and the angle to the velocity.
- The closed form in p and q, H3: v + <q,v>/(1-<p,q>)(p+q) and S3: v - <q,v>/(1+<p,q>)(p+q), agrees with it.
  In S3 it is singular at q = -p and covers only the short geodesic. In float32 at sep 3.1 its error is 4.5e-4, so use the (u,L) form.
- The arrival velocity equals minus the reverse geodesic's initial direction:
  - float64: 2e-6 at sep 5 (H3)
  - float32: 1e-7 to 7e-7 up to sep 2, and 1.4e-5 at sep 5 (H3)
  - float32 H2xR at sep 5: 3.6e-4

## (f) Isometries  [checked-num test-f-isometry.ts]
- H3 makeTranslation(p) = [[I + p_s p_s^T/(1+p4), p_s],[p_s^T, p4]], and S3 uses [[I - p_s p_s^T/(1+p4), p_s],[-p_s^T, p4]].
  The checks: it maps o to p, preserves the form, det = 1, J M^T J (H3) and M^T (S3) are inverses, and column i equals PT(e_i) along o->p.
  The worst error is 2e-13, relative to the coordinate size.
- S3 makeTranslation(p) divides by 1+p4 and is undefined at p = -o. In float32, p4 rounds to -1 near there.
  Building it from (direction, distance) has no division, and float32 at d=pi gives |T^T T - I| = 1.5e-7.
  Prefer that form for authoring.
- 1000 compositions in float32:
  - When the walk stays near the origin (final R about 0.55 in H3, about 1 in S3), the drift is 1e-6 to 3e-6, with or without reduction.
  - When the H3 walk reaches R = 5.9, the position error is 0.45 without reduction, 2.3 with Gram-Schmidt reduceIso and 4.3 with a polar (T(p)*R) re-orthonormalization.
  - So reduction makes it worse, which matches thurston-rebuild's "makes everything worse" note (survey/thurston-port.md:149).
  - S3 stays at 1e-6 or better.
  - Conclusion: compose in float64 on the CPU and upload once. Do not compose on the GPU.

## (g) Frames  [checked-num test-g-frame.ts]
- Frame from n: Gram-Schmidt from one seed, with b = form-raised cross4(p,t,n) to fix the handedness, det[t,b,n,p] = +1.
  [checked-code] microfacet_to_local and microfacet_from_local (src/glsl/core/microfacet.glsl:22-27) already map vec3 to the frame through ambient_dot.
  So the BSDF math (vec3 local) stays unchanged once Frame holds vec4s.
- **from_local calls GLSL normalize()** (microfacet.glsl:26). For a 4-vector that is a Euclidean normalization.
  A Minkowski-unit tangent at R has a Euclidean length up to cosh R (R=2: 5.2, R=4: 38, R=6: 285).
  After normalize(), the H3 ambient length is off by 0.48 (R=1), 0.81 (R=2) and 0.97 (R=4). S3 is unaffected, because its form is Euclidean.
  Every normalize/length/dot on a Direction in shared code is an H3 bug.
  [checked-code] grep counts in src/components and src/glsl GLSL: normalize( 36, length( 31, cross( 12, " dot(" 104 (not classified).
- float32 H3 at radius R. The frame is about 10x worse than ambient_dot.

  | R | ambient_dot error | frame orthonormality |
  |---|---|---|
  | 2 | 1e-6 | 9e-6 |
  | 4 | 6e-5 | 5e-4 |
  | 6 | 3.6e-3 | 2.9e-2 |

  S3 stays at 1e-7 everywhere.

## ray_spawn  [checked-num test-spawn.ts, test-spawn-s3.ts]
- H3 setup: a unit sphere centered at R. The hit point and normal are exact and then rounded to float32, and the spawn is the float32 flow along n by eps.
  The smallest eps with 0/2000 failures, by the true judge:

  | R | eps |
  |---|---|
  | 0 | 1e-6 |
  | 1 | 1e-5 |
  | 2 | 3e-5 |
  | 3 | 1e-4 |
  | 4 | 1e-3 |
  | 5 | 1e-2 |
  | 6 | 1e-1 |

  This is about 2.5e-6 * p4^2, i.e. relative to the square of the coordinates. The E3 rule (src/glsl/core/math.glsl:50-53) is linear.
- Intersecting in the object's local frame only gains about 3x (R=4: 3e-4; R=6: 3e-2), because the bottleneck is that the ray state lives in world coordinates.
  So the local frame does not make far scenes precise.
- reducePoint after the spawn makes it slightly worse.
- A GLSL-style float32 sinh, (e^x - e^-x)/2, has relative error 1.7e-2 at x=1e-6 and 1.7e-4 at x=1e-4 [checked-num test-sinh.ts].
  It did not change the spawn result. That the GPU computes sinh this way is [mem].
- S3: eps 3e-7 is enough everywhere. The current floor of 1.5e-5 has a large margin.
- E3 baseline: fp_uncertainty has 0 failures at R up to 400.

## H2xR (brief)
- Unique geodesics; distance = sqrt(d_H2^2 + dz^2); the area density depends on the direction.
- The isometry is (SO+(2,1) 3x3, z shift). It is not a linear mat4 on the vec4, because no linear function is 1 on the hyperboloid [math].
- Precision: the horizontal coordinates decay like H3 (e^{2R}), and z is linear.

## Design consequences (flags)
1. **Scene extent limit in H3.** In float32 world hyperboloid coordinates, a scene within R of about 2-3 of the world origin behaves like E3: the spawn eps is <= 1e-4 and the dot error is <= 1e-6.
   At R=4 the eps is about 1e-3, and at R>=5 the scene is broken. [checked-num]
   - Simplest option: a declared limit, checked at compile time, with the world origin authored at the scene center.
   - Anything beyond that (camera-relative re-centering, chart switching, a per-ray anchor isometry) is extra machinery.
2. **Spawn eps in H3** must grow like cosh^2(dist from origin). This means a new fp_uncertainty body per space, not today's linear rule.
3. **Euclidean normalize()/length()/dot() on Directions** in shared GLSL (microfacet_from_local at least) are wrong in H3 and fine in S3.
   Every site must go through an ambient seam (ambient_normalize). The E3 bodies must stay byte-identical for bit-identity.
4. **Light samplers.** Today they are Euclidean bodies carrying a "METRIC EXEMPTION" (quad.glsl:10-11), with d2 = dot(d,d) (quad.glsl:17 etc.).
   One curved body written against connections / areaDensity / arrival would serve H3, S3 and H2xR.
   Routing E3 through r*r would break bit-identity, because sqrt(d2)^2 != d2 bitwise [math].
   So E3 keeps its bodies, which means two code paths per light. Owner question.
5. **S3 connections return two geodesics.** Each one is a separate path with its own pdf, and NEE must sum both.
   This is an interface change (a count >= 1), and quotients would need it anyway.
6. makeTranslation: S3 needs the (dir, distance) form. Compose in float64 on the CPU. Do not reduce on the GPU.
