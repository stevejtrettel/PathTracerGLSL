# Check of bypass-inventory

Reviewer's script: check/recheck.ts (next to this file), run with `npx tsx` from the repo.

## What I re-ran or re-read

- checks.ts, bitident.ts and count.sh re-run. Every number reproduces: cosh overflow at 89.416,
  residuals 9.9e-4 / 1.60 / 21.9 at t = 5 / 9 / 10, acosh errors 100% and 2.3%, Klein 0 of 200k
  violations, gnomonic 200k of 200k, cone angles to 5 digits, solid-angle ratio 1.000000, 49.1%,
  5.2257. The row counts are 220 total (146 S, 61 X, 13 U), and the per-category figures match.
  One small difference: the Klein minimum ratio is a sample statistic. I got 1.0070, they got
  1.0016, and the true infimum is 1.
- Repo state: HEAD is 0120472, not the 818d433 the notes say. `git diff 818d433 0120472 -- src` is
  empty, so every line number still holds [checked-code].
- About 45 citations re-read. All are correct: structs.glsl:4-5 and :91, math.glsl:11, :54-56
  and :63-67, euclidean.glsl (all five functions), intersection.ts:382/389/418-420/509/514/559/
  707/753/763/765/1123/1682/1694, pt.ts:137/327/331/410/420, kernel.ts:35, analytic.glsl:31-32,
  delta_tracking.glsl:111, light.glsl:20-22, opaque.glsl:17, point/quad/sphere light bodies,
  lambert:23, checker:14/34, mirror:27, dielectric:31/39, hg:13/33, rayleigh:11/28,
  geometry/index.ts:234/337-348, schema.ts:28-29, Validator.ts:56-57 and :846, ambient/index.ts:13-23,
  environment.ts:80-81/95/101/251, sampler_cdf.glsl:73/78, directional.glsl:21-22,
  equirect.glsl:9-27, cylindrical.glsl:12-27, strategy.ts:13-18, combiner.ts:39/60-61,
  lighting.ts:410-424, materials.ts:253/280/286/378/554/665/941.
- `ambient_parallel_transport` has no caller outside components/ambient/ [checked-code: grep].
- pt-nee returns weight 0 for BSDF-found samplable emitters (combiner.ts, `return 0.0; // NEE
  already counted it`) [checked-code]. The F7 premise holds.

## Corrections

1. **A missed FLOW site: media.glsl:58.** `seg_ray = ray_spawn(h, seg_ray.direction)` in the
   media shadow walker passes the segment's ORIGIN direction into ray_spawn's side test
   (`ambient_dot(wi, hit.ng, hit.p)`, ray.glsl:30). That is the same defect as N5 (pt.ts:410),
   and it is in the subset (homogeneous media with null interfaces). The notes list
   media.glsl:58-59 as OK. Line 59 re-aims afterward, but the side of the offset was already
   chosen with the wrong vector [checked-code].
2. **The FLOW count is inconsistent.** The summary says "five transport sites", the item says
   "four", and M1 says five by counting the sky lookup T1. With item 1 included, the count is
   five velocity sites (I29, N5, N6, T7, media.glsl:58) plus the sky lookup T1.
3. **The bit-identity argument (F8, summary point 4) is a strawman.** bitident.ts shows only
   that a seam spelled in r = sqrt(d2) changes bits. A seam whose E³ body is today's expressions
   (`d = q-p; d2 = dot(d,d); wi = d*inversesqrt(d2); density = d2`) is the same arithmetic, up to
   the inlining and FMA caveat F9 already states [math]. Per-space light bodies may still be the
   simplest choice, and the light files already say "curved spaces get new bodies"
   (quad.glsl:10-11). But bits do not force that choice. The recommendation should rest on
   simplicity.
4. **H³ precision is stronger and broader than F3 and open question 3 say.** The error of a
   single f32-stored hyperboloid point grows like e^{2t}, not cosh t. Projected back to the
   hyperboloid, the position error is 5e-4 at t = 5, 2.7e-2 at t = 7 and 0.18 at t = 8. At
   t = 9, 217 of 2000 stored points are not even timelike [checked-num recheck.ts D]. The
   separation of two points 0.5 apart, computed in f32 as acosh(−⟨p,q⟩), is off by 3e-3 at
   distance 5 from the world origin, 0.15 at 7 and 1.6 at 9 [checked-num recheck.ts C]. This
   limits where the camera, the objects and the hit points can be (light sampling computes
   ⟨p,q⟩ in world coordinates), not only the far limit of an ambient medium. The notes compare
   it with the Klein "~9" figure; the agreement is a coincidence, because the mechanism is
   different (1 − |x|² cancellation). The survey already names the two ways out
   (thurston-port.md:335-337): keep the scene within a few units of the origin as a declared
   limit, or re-center per bounce. The owner has to choose. Re-centering adds machinery.
5. **"SDFs in S³ need new machinery" (F6, M6) is overstated.** The gnomonic chart is indeed
   unsafe, and it covers only an open hemisphere anyway. But the stereographic chart centered on
   the object, x = X/(1+w), is conservative on |x| < 1 (that is, the hemisphere): 0 of 200,000
   pairs had d_S3 < |x−y|, minimum ratio 1.0034 [checked-num recheck.ts B]. The reason
   [math]: the conformal factor 2/(1+|x|²) is ≥ 1 there, and the hemisphere is geodesically
   convex. A chart for SDF stepping does not need straight geodesics, because the march runs on
   the true geodesic and only evaluates the field at points. So S³ is the same mechanism as H³
   with a different chart formula, provided the object's march bound stays inside the
   hemisphere (radius < π/2). The Poincaré ball would also be conservative in H³ (factor
   2/(1−|x|²) ≥ 2) [math, not checked].
6. **A missed degenerate case: the S³ sphere light near its antipode.** When p is within R of
   the antipode of the light's center (d > π − R), every direction meets the ball by t = π,
   because every geodesic from p passes through −p, which lies inside the ball. Then
   sin R / sin d > 1, and the cone formula is invalid [checked-num recheck.ts A: d = 2.9 and 3.0
   hit in all directions; d = 2.7 does not]. The Euclidean "inside" punt (`dc2 <= r*r`,
   sphere.glsl:35) does not catch this case. An S³ sphere-light body needs this second branch.
7. **The S³ two-arc issue (F7, M7) is incomplete, and cheaper than it suggests** [math, not
   checked numerically].
   - For point lights, the option "pt-nee counts BSDF hits beyond π" does not exist, because
     point lights cannot be hit. The long-arc light from a point light belongs to the
     measurement, so NEE must take that arc too, or it becomes a declared truncation. A point
     light also refocuses at its antipode, where the 1/sin² d density diverges, so expect a
     caustic and fireflies there.
   - The long arc from p reaches q with the negated velocity. The short arc
     γ(t) = cos t·p + sin t·v arrives with −sin d·p + cos d·v; the long arc arrives with
     sin d·p − cos d·v. So for a one-sided area light (quad or disk) exactly one of the two arcs
     lands on the emitting side. NEE can sample q as today and use whichever arc arrives on the
     front, with density 1/sin² d either way, at no extra sample cost.
   - A sphere light is seen as two equal caps, one around w and one around −w, because
     γ(π+s) is the geodesic from −p with direction −v. A 50/50 choice between the caps
     (or between the arcs, for a point light) is a few lines.
   - The real new parts are on the visibility side. T3 (`ambient_direction_to`), T5 and T6
     (`length(light_p - origin)`) and media.glsl:59 all re-derive a short arc from the endpoint
     light_p. For an arc longer than π the shadow test must receive a direction and a length
     instead.
8. **A simpler option for the 10 H³-only FRAME rows** (C6, M1, M2, M4-M7, M9, M10, M12)
   [thought-through, not checked]. If the hit is moved to the origin for shading ("shading in
   T_o", thurston-port.md:328), the tangent space there is R³ with the Euclidean metric in both
   H³ and S³. These rows would then need no change. Alternatively, a linear combination of a
   Minkowski-orthonormal frame with unit coefficients is already unit, so the fix is to drop or
   seam the `normalize`, not to add a basis. The inventory should say which shading location
   it assumes, because the FRAME count depends on it.
9. **Labels.** The "FRAME: H³ and S³ differ" item is labeled checked-num, but only the 5.2257
   figure is checked. "Raw dot is right in S³" is [math], which is correct but not checked. The
   point light's `ls.distance = sqrt(d2)` (point.glsl:17) is not in L1's 12-13 range (trivial).
   The disk area law is honestly labeled not checked; it is standard [math].

## Over-engineering check

The inventory recommends little machinery and flags what it would add. The one choice I would
tighten is M1. Rather than a second seam function next to ambient_geodesic, or a Hit field plus
a seam, one flow function that returns the point and the velocity
(`Ray ambient_flow(Ray, t)`; E³: `make_ray(o + d*t, d, wl)`) covers every velocity site,
including MediumSample.exit_dir, which a Hit field would not reach [thought-through, not
checked]. M8 (equirect and cylindrical cost the same as fisheye) is correct from the code. It
widens the owner's stated camera subset, though, so it needs the owner's choice. It is not a
default.

## Verdict

The inventory is sound and the citations are accurate (about 45 re-read, none wrong). All
numeric claims reproduce. Fix four substantive items before it feeds the design: the missed
media.glsl:58 site, the strawman bit-identity argument, the S³ sphere-light antipode branch, and
the incomplete S³ two-arc analysis (point lights have no BSDF alternative, and one-sided area
lights need only one arc). Also strengthen the H³ precision statement: error ∝ e^{2t}, which
limits the whole scene's extent. Soften "S³ SDFs need new machinery": the stereographic chart
is conservative.
