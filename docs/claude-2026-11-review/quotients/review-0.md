# Review 0 of `plan.md`: correctness lens

**Reviewer:** an independent agent, 2026-11-07. Nothing in the repo was edited.

**Lens:** the estimator, the group theory, MIS image identification, and truncations. I reran
the twins with fresh seeds and wrote one new check.

**My scripts and outputs** are in
`/private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/quotients/review-0/`:
- `run.sh` → `rerun.out`
- `run2.sh` → `rerun2.out`
- `sw_cross.ts`

**Labels** follow the plan: [checked-code file:line], [checked-num script], [math], [mem].

## Verdict

**Sound, with small fixes.** I found no error in the estimator or the group theory.
- Partition MIS is the standard MIS condition with a technique of zero density.
- The image bookkeeping is consistent in both spaces.
- The SW data and its convexity argument hold up.
- The bias ledger names the right truncations.

What must change before the owner approves:
- one bug in the E³ walk sketch;
- three witnesses that cannot fail in the way the plan claims;
- one truncation bound stated too weakly (a skeptic correction not fully adopted);
- one justification that is false as written, though its conclusion holds.

All of them are small text changes. None changes the design.

## 1. What I reran, and what it showed

| run | result | label |
|---|---|---|
| E³ `torus.ts check` | both objects are inside D; the axis line x = y = 0.45 is free for 1000 crossings | [checked-num rerun.out] |
| E³ paired, pt torus vs pt crystal, Q0, 30k paths, seed 4242 | 0 paths differ; the means are bit-identical | [checked-num rerun.out] |
| E³ Q1, fresh seeds 9101–9105 | pt 1.03165 ± 0.00400. U27-mis 1.03488 ± 0.00321 (z = +0.63). U27-nee 1.03104 ± 0.00334 (z = −0.12). W1 0.52761 (z ≈ −110). W2 0.89980 (z ≈ −24) | [checked-num rerun.out] |
| SW firsthit, 20k rays, clip 3, seed 9201 | kind mismatches 0; max \|Δt\| 3.0e-11; law-of-cosines mismatches 0 | [checked-num rerun.out] |
| SW direct-only Q1 (NB = 1), the open +1.5σ / +2.0σ question in twin §3.3 | pt over 10M: 0.294566 ± 0.000444. S13-mis over 10M: 0.294153 ± 0.000412. **z = −0.68: no offset.** | [checked-num rerun2.out] |
| SW direct-only Q1 at 1.2M each | pt 0.29497 / 0.29371. S1-mis 0.29419. S1-nee 0.29197. S13-nee 0.29456. Crossing-count membership ("WRONG-W2") 0.29515. All within 1.8σ | [checked-num rerun.out] |
| **New:** `sw_cross.ts`. 40,000 pairs x ∈ D, y ∈ g_f⁻¹D; half have both ends within 1e-3 (Klein) of an edge of face f | geodesics that leave D ∪ g_f⁻¹D: 0. Crossing count in float64: exactly 1 for all 40,000. In simulated float32 (`Math.fround` on every operation, tables rounded once): also exactly 1 for all 40,000 | [checked-num review-0/sw_cross.ts] |

**One finding from the rerun weakens the evidence wording** (see S5 below). At the SW point Q1
with NB = 1, **S1's NEE never fires**: `shadowRays = 0`, because the in-cell light image always
lies below that point's horizon.
- So the direct-only "S1 +2.0σ" was a comparison of two estimators that have the same
  distribution, and it was noise.
- The "in-cell image alone gives about 1.0" row is vacuous at Q1. Only the Q0 numbers (0.96–0.97)
  measure S1.

### Checked and found correct

- **Unbiasedness of partition MIS** for any fixed S under C1–C4 [math]. Twins agree, and the
  controls fail [checked-num].
- **E³ image identity.** The NEE shift `q.p − L∘c_j` and the BSDF cell index k both name the
  image c_L + L·k in the chart of the ray origin. That holds wherever x is, so the pair is
  consistent [math].
- **pt-nee rule.** `lid < 0 || prev_was_delta || hit.image < 0 → 1` matches the combiner's
  structure [checked-code src/components/transport/combiner.ts:26-41].
- **Light pdfs read q.p only through differences.** Disk, softbeam, sphere, quad and mesh all do
  [checked-code src/components/lights/{disk,softbeam,sphere,quad}/*.glsl;
  src/compiler/generate/features/lighting.ts:663-668]. So the moved query is exact.
- **LightSample carries no point** [checked-code src/glsl/core/structs.glsl:89-96]. NEE rebuilds
  `light_p` from (hit.p, wi, distance) [checked-code
  src/components/transport/techniques/light/light.glsl:20-23], so the image point lands in x's
  chart.
- **Camera rays.** `path_state_init` sets `prev_was_delta = true`
  [checked-code src/components/transport/techniques/kernel/kernel.ts:33], so nothing reads
  `hit.image` after a camera ray.
- **The SW constants.** cosh² r_in = (5+2√5)/4 gives 0.99638, and cosh R_c = (7+3√5)/4 gives
  1.90285 [math, rechecked by hand]. C3 needs d(x, g_f⁻¹y) ≤ R_c + 2r_in + R_c = 5.798, and
  that holds [math].
- **g_f⁻¹ = g_{f xor 1}**, and the NEE/MIS maps are consistent:
  - query → PAIRING[f]·q;
  - NEE direction back through PAIRING[f^1];
  - MIS at hit.image = 1+f uses PAIRING[f].

  An image-label swap (f ↔ f^1) would be harmless under uniform 1/13, because S13 is closed
  under it [math].
- **Camera `reduce` terminates.** Face i bisects o and g_i⁻¹o in a Dirichlet domain, so a point
  beyond face i has d(g_i p, o) < d(p, o). The orbit distances are discrete [math].
- **Q2 walk formulas.**
  - q = p + τv lies on the face, linearly.
  - p ← q/√(−⟨q,q⟩) = cosh t·p + sinh t·v.
  - v ← w + ⟨w,p⟩p is the tangent projection.

  All three hold [math].
- **Convexity of D ∪ g_f⁻¹D.**
  - The union's edge angles are 144° and its vertex links are convex [math].
  - In the Klein model, H³-convexity is Euclidean convexity, so Tietze–Nakajima applies
    directly [math].
  - Numerical support: `sw_cross.ts` above.
- **The crystal radius (N+1)·R** [math]. 10.95 for witness 1. A ball of radius 10.95 holds about
  5,300 unit-volume cells, so ~21k instances is right [math].
- **The E³ cell bound** 4 + R·Σ|d_i|/L_i ≤ 4 + R√(Σ1/L_i²) [math]. The float32 twin ratio is
  0.992 [checked-num torus-code/dda_bound_twin.out].
- **The skeptic's corrections** are adopted:
  - S³ −I;
  - media across cells (Q1b homogeneous only);
  - word-length membership (used only where convexity proves it);
  - the albedo rule;
  - H²×R;
  - const arrays.

  Two exceptions are listed as M2 and M4 below.

## 2. Must fix

**M1. E³ walk sketch (Q1.3): a −0.0 direction component loses the ray.**
- The sketch sets `s = d >= 0 ? 1 : −1` and divides by `ray.direction`. For d.x = −0.0:
  - −0.0 ≥ 0, so s = +1;
  - the numerator (k+½)L − o is > 0, and dividing it by −0.0 gives **−∞**;
  - so t_exit = −∞, the walk steps +x, and t_enter = −∞;
  - from then on the local origins are inf/NaN, and the ray returns a miss.
- −0.0 is ordinary IEEE arithmetic, not a hypothetical GPU behavior. Examples: a reflection off an
  axis-aligned face of an axis-aligned ray; 0 × (negative basis component) in a camera with
  axis-aligned framing.
- The twin the bound was measured on guards it: `np.where(d != 0, t, big)` [checked-code
  torus-code/dda_bound_twin.py:21-25]. torus-code §1.2 has the guard too. The plan dropped it.
- **Fix:** write the sketch as the twin did. Use `d != 0.0 ? … : BIG` (−0.0 != 0.0 is false), or
  take s from the sign of 1/d.

**M2. Q1b witness 4 (fog emission) cannot catch "errors in distance continuity across faces".**
- The scene is empty, so the walk never reports a hit and never sums `hit.t` across cells.
- The value Le(1 − e^{−σ_a R}) depends only on the clip, so a non-quotient scene passes it too.
- This is the blindness the skeptic flagged for the uniform-medium witness, and the plan says
  every skeptic correction is adopted.
- **Fix, one of:**
  - Keep the witness as a clip-and-emission check and delete the continuity claim.
  - Add one black occluder in D. Pixels then read Le(1 − e^{−σ_a·t_hit}), with t_hit summed
    across faces, which a float64 twin gives per window. That witness can fail on a wrong
    `hit.t += t_enter`.

**M3. Q1 witness 2's fourth arm (`lightSelection: 'bvh'`) is vacuous with the scene's one light.**
- With one light the tree is trivial (the selection pdf is 1). The arm does not test the tree's
  pick and pmf at moved query points, which is what Q1.3 claims ("works unchanged at the moved
  query").
- **Fix:** give the equality scene at least two lights of different power at different depths.

**M4. Ledger item 2 states the fog bound per segment only.**
- "The error on each segment is at most e^{−σR}·L_sup." The skeptic's correction is that the
  bound compounds over the path.
- For the pixel [math], with albedo ≤ ρ̄ ≤ 1 and L_sup the sup of the unclipped N-truncated
  radiance:
  - |I_N − I_{N,R}| ≤ e^{−σR}·L_sup·Σ_{k=0}^{N} ρ̄^k ≤ (N+1)·e^{−σR}·L_sup;
  - L_sup ≤ (N+1)·Le_max.
- **Fix:** state the per-pixel bound, since that is what a reader uses to choose R.

**M5. Q1.1's justification is false as written; the conclusion holds.**
- The plan says: "Objects keep a margin from ∂D, so every surface vertex is strictly inside D."
  Spanning boxes (decision 4) are the exception the plan itself allows. A hit on a wall or beam
  can lie on ∂D, or about farClip·ε outside it. The next ray's origin then has k₀ ≠ 0.
- **The actual invariant** [math]:
  - `hit.image` is the *absolute* cell index k in the chart of the ray origin.
  - NEE's shift `q.p − L∘c_j` names image c_L + L·c_j in that same chart.
  - So the two agree for any x, not only x ∈ D.
- C3 then needs only that x is within m of D. With emitters strictly inside D by m, the S images
  stay within 2|L| − m + δ < farClip.
- **Fix:** replace the sentence with this argument. Then the spanning-box exception is covered
  explicitly, not by accident.

**M6. The vitest controls need a sample count chosen for power (Q1.5 vitest 1).**
- "Controls must fail by more than 10σ" with "smaller N" is not guaranteed. W2 was −19σ (Q0) and
  −26σ (Q1) at 300k–600k paths, and z scales as √N. At 30k paths W2 reads about −6σ to −8σ.
- **Fix:** fix the seeds and choose N so that W2 ≥ 10σ, about ≥ 90k Q0 or ≥ 50k Q1 paths [math
  from the measured z]. Q1 at 200k runs in about 4 s here [checked-num rerun.out ms].

**M7. The SW MIS twin (Q2.6 vitest 2) has no membership control.**
- Only W1 is listed. The twin's "WRONG-W2" (≤ 1 crossing) is *correct* for S13, and the plan
  relies on exactly that.
- So nothing shows that the SW twin can detect a membership error.
- **Fix:** add a real negative control and require it to fail. For example: NEE samples S13,
  while MIS treats only 0-crossing hits as members. That mirrors the E³ W2.

## 3. Should fix

**S1. The NEE wrapper reuses the remainder of xi.x.**
- `xi.x = u − float(j)` is not clamped. The existing generated code clamps every remainder to
  0.9999999 [checked-code src/compiler/generate/features/lighting.ts:594, 616, 621].
- It also drops about 5 bits, on top of the power-selection remap.
- torus-code §3.1 said "one extra random number". **Use `random()`.** It is simpler, it is the
  light tree's own convention [checked-code lighting.ts:841], and it needs no clamp.

**S2. Cap semantics for `scene_intersect_any` (Q2.3).**
- The walk returns `false` on the crossing cap. For the any-hit form that means "unoccluded",
  the opposite of a miss's 0 on the BSDF side.
- It is unreachable for S13 shadow rays: ≤ 1 face crossing plus edge runs of ≤ 6, against a cap
  ≥ 32 [math; checked-num rerun.out: shadowMaxCross 1].
- **Fix:** say so in the plan, or return "occluded" on the cap.

**S3. Count cap hits on the GPU.**
- Q2.6's "no cap hit" is checked only in the TS float32 simulation, and Q2.4 item 7 says GLSL
  must be re-measured.
- Add a report-only counter (a debug picture or the witness runner) to Q2.6.

**S4. One place for `MAX_DIST`.**
- Q1.2 moves the define into an emitted `farClip`. The curved design's step 1 moves it to the
  space occupant (curved-spaces-design.md §2.2, item 2).
- Whichever lands second must edit the other's home. Say which, so the fact has one answer.
- Q1.5 vitest 5 ("the only differences allowed are `Hit.image` and its fill lines") must also
  list the moved define.

**S5. Evidence wording.**
- (a) "46 comparisons, all within 2.2σ" includes the S1 rows at Q1. Those are vacuous at
  NB = 1 (NEE never fires there; see §1).
- (b) "the in-cell image alone gives about 1.0" is true at Q1 by construction of the scene.
  Cite the Q0 values instead.
- (c) The open direct-only S13 offset is now resolved: z = −0.68 over 10M paths
  [checked-num review-0/rerun2.out]. Cite that.
- (d) "In SW, NEE helps little whatever the table" rests on one scene and two points. Label it
  so.

**S6. Q2.2 says "This is exact."** Write it as "exact in exact arithmetic". Cite
`review-0/sw_cross.ts`: 0 of 40,000 float32-simulated crossing counts differ from 1, half of
them within 1e-3 of the shared face's edges. The GLSL builtins remain unmodeled, as Q2.4 item 7
already says.

**S7. C1 is not satisfied as written in Q2.**
- C1 says "the same table S, through the same code". In Q2, NEE indexes 13 matrices, while MIS
  reads a crossing count.
- The two agree by the convexity theorem, not by sharing code.
- **Fix:** state C1 as "the same set, by one function, or by a proven identity", and cite the
  identity for SW.

**S8. Demonstrate the power of the GPU witnesses.**
- No GPU witness has been shown to fail on a seeded error.
- Once, by hand: force `hit.image = 0` (W1-like) and flip the shift sign in the MIS wrapper
  (W2-like). Check that Q1 witness 2 fails, and record the margin.
- The equality gate's χ² mode is documented as invalid for chance-hit pt arms [checked-code
  tests/witnesses/types.ts:72-83]. Name the gate (meanTol and rmse) for the pt arm.

**S9. The authoring example (Q1.4) declares `farClip: 8` without fog.**
- In the E³ twin scene R = 8 shows about 88% of the R = 32 value [checked-num
  twin/results_torus.jsonl: 2.151 vs 2.450].
- Pair the example with an `ambientMedium`, or a comment that names the truncation.

## 4. Not checked

- GLSL behavior: GPU builtins, FMA contraction, SwiftShader timing for the 21k-instance crystal.
- The light tree at moved queries: not twinned. It is [math] only.
- The H³ disk-light pdf body. It comes with curved step 2, which this plan depends on.
- Whether a `twin` witness pins the same salt on both scenes. The plan asserts it; I did not
  read the runner.
