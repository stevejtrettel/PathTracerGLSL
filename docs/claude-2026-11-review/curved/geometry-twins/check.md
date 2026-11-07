# Check of "geometry-twins"

Checker's scripts: `check/spawn-by-hit-radius.ts` (independent, does not import the twin modules), plus re-runs of all nine
`test-*.ts` into `rerun/`. Labels: [checked-code] file:line read, [checked-num] script run, [math], [mem].

## Reproduction
- [checked-num] All nine test scripts re-run from the repo with `npx tsx`; every output is byte-identical to the saved
  `out-*.txt` (seeded RNGs). The numbers quoted in NOTES.md match the outputs, with the exceptions below.
- [checked-num] `N=200000 test-ce-connections.ts`: step-projection transport vs closed form is 2.0e-6 (H3) and
  1.7e-6 (S3), not "4e-6" as the summary says. Harmless: O(1/n) convergence holds.

## Citations
- [checked-code] microfacet.glsl:22-27 (to_local / from_local), :26 normalize(): correct.
- [checked-code] quad.glsl:10-11 METRIC EXEMPTION, :17 d2: correct. point.glsl:13, disk.glsl:22, mesh.glsl:45, spot.glsl:17,
  softbeam.glsl:32 are all `float d2 = dot(d, d);`: correct.
- [checked-code] survey/thurston-port.md:149 is the `reduceError(Isometry)` "makes everything worse" row: correct.
- [checked-code] Grep counts (normalize( 36, length( 31, cross( 12, " dot(" 104) are occurrence counts and reproduce
  (cross( is on 11 lines, dot( on 91 lines).
- MISCITE (minor): "E3 rule src/glsl/core/math.glsl:50-53". The constants are at :52-53 and `fp_uncertainty` is :54-56.
- MISLABEL: "[checked-code] H2xR isometries are (SO+(2,1), z shift)". There is no H2xR code in the repo; the only code is the
  agent's own h2r.ts. This is [math]. It is also incomplete: Isom(H²×R) = Isom(H²)×Isom(R), and the orientation-preserving
  part contains (H² reflection, z flip) pairs too (survey/compiler-front.md:135 notes the point stabilizer is not SO(3)).

## Number reporting errors
- [checked-num] (f) says "relative error ≤2e-13" for makeTranslation. That holds for H3 only. S3 f64 shows 1.34e-10
  (form) and 6.7e-11 (PT column) because the radii include 3.14 (near the antipode, the 1/(1+p4) amplification). H3 f64
  |det-1| = 2.5e-7 (absolute, cofactor expansion at R=8 with entries ~1500), unreported. Neither changes a conclusion.
- [checked-num] (b) "H3 float32 relative error 1e-6 at R=2, 7e-5 at R=4, 0.19 at R=6 for separation 1e-2" is the formula's
  error on already-rounded inputs. The end-to-end error including the input rounding (column 5 of out-b-distance.txt) is
  1.45e-4, 7.0e-3 and 0.49. The end-to-end figure is the one that matters for a renderer and is ~100x worse.
- (f) "In float32, p4 rounds to -1 near the antipode" is [math], not exercised by the script (it ran float64 there,
  |TᵀT-I| = 5.45e-8 at distance 1e-4 from the antipode). True, but the GPU never builds placements under the
  "compose on the CPU in float64" design, so the float32 case does not arise; the real issue is the exact 0/0 at p = -o.

## Main claim (H3 precision): confirmed, with a framing correction
- [math] e^{2R}: a coordinate rounding δ_i ≈ ε·cosh R at p has a tangential component whose Minkowski length is up to
  cosh R·δ (e.g. e1 = cosh R·v_r − sinh R·p), so the hyperbolic error is ~ε·cosh²R. Agrees with the reported quantum
  1.5e-8·e^{2R}.
- [checked-num check/spawn-by-hit-radius.ts] Independent spawn check, binned by the HIT POINT's distance r from the world
  origin (not the sphere centre): the largest eps needed over ~18k samples is ≈ 1e-7·cosh²(r) at every r from 0 to 6
  (ratio 3e-8…1.5e-7), under both the float64 judge and the float32 local-frame judge. Local frame helps ≈3x only
  beyond r≈4. This confirms the agent's trend and the "local frame gains ~3x".
- FRAMING CORRECTION: the agent's table and the "2.5e-6·cosh²R" fit use R = centre of a unit sphere, so the hit points are at
  R±1. Stated per point, the rule is eps ∝ p.w² (p.w = cosh r of the hit point itself), constant ≈1e-7 measured. That is the
  direct analogue of today's `fp_uncertainty` (coordinate-relative, math.glsl:52-56) and is computed from the point alone;
  no distance-from-origin bookkeeping is needed. With the E3 margin style it is one new H3 `fp_uncertainty` body, not machinery.
- "Declared scene radius about 2–3": consistent once the radius means GEOMETRY extent (hit points), not object centres:
  with a 16x margin over 1e-7·w², eps stays ≤1e-4 up to w≈8, r≈2.8. Under the agent's centre-based table the same scene
  would be described as "R≤2" plus object size. The notes should say which.

## Missed sites
1. [checked-code] MAX_DIST = 1000 (math.glsl:11) is the far clip, and env NEE sets `ls.distance = MAX_DIST`
   (env/sampler_cdf.glsl:78; directional.glsl:22 too). In H3, float32 cosh overflows at t≈89.4 [checked-num out-a-flow.txt:
   NaN at t=90] and coordinates are meaningless from t≈6–9. So H3 cannot use MAX_DIST: its far clip must be the scene bound
   (and sky lookup must use the ideal endpoint from (p,v) at the last segment, not a flowed point). The notes report the
   overflow but do not connect it to MAX_DIST or to the SDF march's exit. A declared H3 scene radius would also serve as this
   far clip, which is a second reason for it [math].
2. [checked-code] `ambient_direction_to(from,to)` (euclidean.glsl:31-33) returns ONE direction and is called to re-aim
   shadow rays at the light point: transport/techniques/light/light.glsl:22 and transport/shadow/media/media.glsl:59.
   In S3 the long-arc connection needs −u (and re-aiming from a spawned origin with this seam would aim along the short arc).
   The notes' "connections returns a list" flag never names these callers. (survey/blackhole-quotient-challenges.md:48 already
   records that this seam's uniqueness fails in S3.)
3. [checked-code] `ambient_parallel_transport(v, from_p, to_p)` (euclidean.glsl:25-27) is the existing seam, and it has the
   (p,q) signature that the notes show is singular at q=−p and short-arc-only in S3. It has no GLSL callers (grep over src:
   only euclidean.glsl, index.ts, md files). The notes recommend the (p,u,L) form without saying the existing seam's signature
   is the problem; since nothing calls it, changing its signature is free.
4. [checked-code] The media shadow walk measures `length(light_p − seg_ray.origin) − SHADOW_BACKOFF`
   (docs/trace-loop-contract.md:146-148, which already flags it as Euclidean). A concrete Direction/Point length site the grep
   count did not classify.
5. [math] S3, one-sided emitters (quad lights are one-sided, quad.glsl:4): the short and long arcs arrive at q with opposite
   velocities (γ'_long(2π−d) = −γ'_short(d)) and leave p in opposite directions. For an opaque one-sided receiver and a
   one-sided emitter at most one of the two arcs has both cosines positive, so per sample at most one contributes. Both are
   still needed (each covers different configurations), and both contribute for point lights and transmission. Refines the
   "sum both" item; not checked numerically.
6. [math, not checked] "Exact far limit 2π in S3" is exact only for vacuum: in an S3 filled by a medium, a ray that survives
   2π re-enters the same loop and may scatter on the next lap. Not a geometry-twins claim, but the twins' "connections
   = exactly two" relies on the 2π clip.

## Over-engineering / recommendation review
- "Two code paths per light" is presented as a new owner question. It is already the documented design: quad.glsl:10-11
  "curved spaces get new bodies (§5.3)" [checked-code]. The "sqrt(d2)² ≠ d2" argument [math] is correct but only rules out
  routing E3 through an r² formula; it does not by itself force separate E3 bodies (an E3 seam could return d2 directly).
  Present it as "matches the existing contract", not as a new decision.
- "A(r, direction)" seam: correct for H2xR and harmless for H3/S3 (they ignore the direction). Not extra machinery.
- "Compose isometries in float64 on the CPU": correct and the simplest option; it is what placement upload already implies,
  so it is not a new decision. The reduceIso experiment only shows behaviour at R≈5.9, i.e. outside the usable region anyway.
- "S3 makeTranslation from (direction, distance)": fine and simple (the natural S3 authoring form), justified by the exact
  0/0 at p = −o, not by float32.
- "Declared, compile-time-checked scene radius": one moving part (needs a per-object bound in H3). It is justified by two
  jobs (precision region and the H3 far clip, item 1 above). Flag that the precision half alone could also be left to a
  per-point spawn rule (eps ∝ p.w²) with degradation being the author's problem; the far-clip half cannot.

## Math checked on paper
- [math] H2xR area density r·sinh(r sin b)/sin b: Jacobi fields along a unit geodesic with horizontal speed sin b; the
  horizontal normal direction has sectional curvature −sin²b (J = sinh(r sin b)/sin b), the normal direction in the
  (horizontal, vertical) plane has curvature 0 (J = r); H²×R is locally symmetric so the eigenframe is parallel. Product
  matches. Also agrees with survey/blackhole-quotient-challenges.md:154 (written there with elevation φ = π/2 − b).
- [math] S3 makeTranslation and H3 makeTranslation formulas, J Mᵀ J inverse, transport formula v + <v,u>(γ'(L) − u): correct
  (the component of v orthogonal to span(p,u) is constant in the ambient space; the u-component rides the velocity).
- [math] RK4 check for H2xR is valid: the conformal geodesic ODE holds at any constant speed, so integrating the H² part at
  speed |v_h| in the disk plus linear z is a real independent check.

## Verdict
Sound. The closed forms, the e^{2R} H3 precision finding, the "local frame gains ~3x", the S3 two-arc structure and the
microfacet_from_local normalize() bug all hold up on re-run and an independent check. Corrections are: the spawn rule
should be stated per hit point (eps ≈ 1e-7·p.w², fp_uncertainty-style) and "scene radius" defined as geometry extent;
end-to-end distance errors are ~100x the quoted formula-only ones; two number misreports (S3 2e-13, transport 4e-6);
one miscite (math.glsl:50-53 → 52-56); one mislabel (H2xR isometries [checked-code] → [math], and incomplete); and four
missed code sites (MAX_DIST far clip in H3, ambient_direction_to callers for S3, the unused (p,q) ambient_parallel_transport
signature, the media-walk length()). The "two code paths per light" item is the existing contract, not a new question.
