# Review: normal-mapping plan (bump maps and normal maps)

Reviewer: independent agent. Verdict: **approve with changes**. Stage A is sound, small and
fits the codebase. Two of its witness checks cannot fail the way the plan says they will,
and the world-unit default `step` conflicts with the owner's no-guesses rule.

Labels: [checked-code], [checked-src], [reasoning].

## What I checked and found correct

- Cited code exists and says what the plan claims: `ambient_frame` call sites
  (intersection.ts:709, :906, :1025, :1707), the arbitrary tangent (euclidean.glsl:13-19),
  `Hit.ng` and its comment (structs.glsl), `ray_spawn` offsets along ng (ray.glsl), the
  dielectric clamp (dielectric.glsl:24), the mesh-leaf comment (mesh.glsl:100-108),
  `RESERVED_KEYS` (materialsContract.test.ts:13), the `materialsReadUv` gate (Planner.ts:649),
  the emission-cone arms (materials.ts:937-943), survey lines [checked-code].
- **The full set of `hit.frame` readers after the hit** is light.glsl:26 (NEE cosine),
  pt.ts:134 (light query), normal.glsl:9 (guide) and the material occupants. The combiner,
  kernel and light-pdf code read no frame. The light pdfs read the light's own geometry or
  `light_hit.ng` (lighting.ts:665, :922). Emission (`<model>_emission`) reads no frame
  [checked-code grep]. So one swap in the walk before AOV/NEE/sampling makes every consumer
  see the same frame, and the emitter-hit MIS weight is unaffected. The light query is built
  from the swapped hit both at NEE and in `kernel_record` (kernel.glsl:31), so light-tree
  pmfs agree between techniques [checked-code].
- **Mask in eval, pdf and sample** is the correct estimator: rejected samples are killed,
  not redrawn, so the sampler's density on surviving directions is the nested pdf, which is
  what the masked pdf returns [reasoning]. The twin's χ² and triple identity confirm it
  (twin-output §4).
- **Flip**: re-fetched Mitsuba `perturbed_bsdf.h` (master). Lines 159-164: flip when
  `cos_theta(wi)·dot(wi, n) ≤ 0`, `n ← (−n.x, −n.y, n.z)` in the base frame, which is the
  plan's n'' = 2(n'·n)n − n'. The guarantee is also exact algebra: if wo·n' ≤ 0 then
  wo·n'' = 2(n'·n)(wo·n) − wo·n' ≥ 2(n'·n)(wo·n) > 0 [checked-src + reasoning].
- **Mitsuba's mask** is against the base shading frame (lines ~57 and 211-218), as the
  plan says [checked-src].
- **pbrt BumpMap** (materials.h:109-139, re-fetched): dpdu' = dpdu + (Δh/du)·n + h·dndu.
  With orthonormal t, b and n = t×b, dropping h·dndu gives n' = n − h_t t − h_b b, which
  matches the plan [checked-src + reasoning].
- **σ = (region_to == region_owner)**: `region_to` has exactly two writers, both in the
  dispatcher: intersection.ts:1696 (entering, sets owner) and :1706 (exiting, sets
  `outside`) [checked-code `grep -E "region_to\s*=[^=]"`]. No GRIN, instance or containment
  arm writes it. The plan's "Risk: σ" can be closed with this fact. The only way σ is wrong
  is the outside probe misclassifying as the owner, which would already break emission and
  medium tracking. So σ adds no new failure mode.
- The lune value ρ(1+cos θ)/2 = 0.341421 for θ = 45°, ρ = 0.4 is right: it is the
  projected area of the intersection of two hemispheres [reasoning; twin §2 agrees].

## Must fix

1. **`bump-tilt` cannot detect a missing flip.** The fixture is a thin infinite plane under
   a full-sphere constant sky, and nothing lies below the plane. Without the flip, wo·n'' < 0
   in the far region. Lambert then samples around −n'', the ng mask keeps the directions
   with wi·ng < 0 and wi·n'' < 0, and `ray_spawn` sends them below the plane into the same
   sky. That set is the antipode of the correct lune and the cosine is symmetric, so the
   estimate is again ρ(1+cos θ)/2. NEE gives the same: eval needs wi·n'' < 0, the mask then
   needs wi·ng < 0, and the shadow ray goes down unoccluded. The plan's "0 means the flip is
   missing" is false for this fixture [reasoning, exact by symmetry]. The twin hides this
   because it assumes "below ng is plane-occluded" (twin.ts:103), which the fixture does not
   build. Fix: put an opaque black occluder just below the plane (a ρ = 0 plane at y = −δ,
   or make the floor a solid box). The correct value is unchanged, and a missing flip then
   reads 0 in the flipped region. Also state the camera direction that makes the far region
   flipped: wo must have a +x component, so the camera sits at +x looking toward −x.
2. **`bump-sides` checks an exact zero for B's back.** A missing light, a wrong light
   direction, self-shadowing or a broken σ all read 0, so the check cannot tell them apart.
   Choose light 2 so that the correct value is nonzero. Point the direction toward the light
   along wi = (1,−1,0)/√2, so the light propagates along (−1,1,0)/√2. With
   n'_back = (1,−1,0)/√2, the values are:
   - correct: **ρ**;
   - wrong σ (n' = (−1,−1,0)/√2): **0**;
   - no bump: **ρ/√2**.

   All three are distinct, and the correct one is the nonzero value. Re-check that the two
   quads still do not shadow each other.
3. **Q1: make `step` required.** A world-unit default of 1e-3 is a guess about scene scale,
   which the owner's no-guesses rule forbids. A scene authored in millimetres or kilometres
   gets the wrong gradient silently. The cited precedent does not support it either: pbrt's
   `du = .0005` is in uv-parameter units and is used only when ray differentials are absent
   (materials.h:117-120), not a world-unit default. Make it a Validator error when `step` is
   missing, and keep the README's error law so the author can choose.

## Simplifications and smaller points

- **Split Stage B out of this plan.** It cannot be approved before the image-texture plan
  exists, and it carries a `Hit` contract edit, a new seam function, per-shape tangent
  charts and mesh-leaf changes. Keep only one paragraph saying how Stage A's frame swap,
  flip, mask and σ would be reused. That halves the document the owner has to approve, and
  Stage A loses nothing.
- **Strengthen the ng-mask justification.** The ng mask is required here, not just
  preferable. The walk updates `current_medium` from `bs.flags` (pt.ts, after sampling), and
  `ray_spawn` picks the side from ng. A "reflection" sample with wi·ng < 0 would cross the
  true surface without updating the medium, which corrupts medium bookkeeping. Mitsuba's
  base-frame mask does not prevent that on smooth meshes; the ng mask does [reasoning from
  checked code].
- **Finite differences.** pbrt uses one-sided differences with 3 evaluations. The plan uses
  central differences with 4. That is justified (the error is O(ε²) rather than O(ε)), but
  say that it departs from pbrt rather than implying it matches.
- **Gradient sign** is checked only by `bump-sides`. `bump-tilt`'s Lambert integral is
  symmetric under n' ↔ mirror, so a sign error passes there. Say this, so that nobody drops
  `bump-sides` as redundant.
- **Optional:** add a GGX key (roughness ~0.3) to `bump-tilt` or `bump-sides` under pt-nee
  and pt-mis. This exercises the masked pdf in the MIS weight on a non-Lambert lobe on the
  GPU, since the χ² checks run only in the TS twin. It is an estimator-equality check, not
  an exact value.
- The four GLSL helpers could be two: `shading_frame_perturbed` (σ, gradient, flip) and
  `shading_side_consistent`. `shading_masked` is one line at its single call site.

## Verdict

Approve with changes. Must-fix items 1-3 are local to the witness fixtures and the
Validator rule. The model, the mask and flip, the walk insertion point and the gating
(byte-identical digests for unbumped scenes) are sound as written.
