# Monte Carlo twins for lighting in quotient manifolds (key: twin)

Written 2026-11-07. Nothing in the repo was edited. Everything here is a float64 CPU twin in
TypeScript. It tests the estimator design, not GLSL.

Folder: `/private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/quotients/twin/`

Labels: [checked-num script] measured here; [math] my argument, not checked by anyone else;
[mem] from memory. Prior notes are cited as light-theory, torus-code, seifert-weber (the three
sibling folders), survey and skeptic.

## 0. Verdict

The partition-MIS scheme is unbiased in both spaces, on both test scenes, for every image set I
tried [checked-num]. pt, pt-nee and pt-mis agree within 2.2σ in 46 comparisons, and the
negative controls fail by 19–160σ. The E³ crystal check agrees **path by path**, not only in the
mean.

Five findings change the plan:

1. **The far clip is the dominant error, not the estimator.** At the radii the earlier notes
   proposed, R_seg removes 25–40% of the light in both test scenes.
   - In E³ the tail is polynomial: R = 4 cells loses ~40% of what R = 32 gives.
   - In SW it is exponential, but R_seg = 8 still loses about 26% relative to R_seg = 16.
   - Neither scene has a finite horizon. The mean cost per segment is set by the mean free path,
     not by R_seg, so a large R_seg is cheap on average and costs only in the worst case (§3, §4.4).
2. **In SW, NEE helps only a little.** The best image set (all images within distance 3, weighted
   by solid angle) halves the variance. The 13-image set (own cell plus 12 neighbors) cuts it by
   about 15%, and the in-cell image alone does nothing.
   - Direct light really does come from many far images. Only 40% of the direct light at a
     surface point comes from images within distance 3 [checked-num].
   - "Realistic lighting" in SW therefore needs fog or bigger lights, not a cleverer image table.
3. **For SW's 13-image set, membership by "at most one face crossing" is exact** [math, consistent
   with checked-num]. SW's dihedral angle is 72° < 90°, which makes the union of D with any
   neighbor cell convex. So a geodesic from D reaches a neighbor cell by crossing exactly one face.
   The skeptic's warning about word-length membership is right in general, but it does not apply
   to this set (§4.3).
4. **The crystal radius must be (N+1)·R_seg from the camera**: one camera segment plus N bounce
   segments. The task's N·R_seg + diam(D) is not a bound in general. In this scene it happened to
   give identical paths too, so a passing crystal check does not validate the radius rule (§2.3).
5. **Two errors cannot be caught by the equality witness in these scenes,** so they must be
   prevented by code structure:
   - NEE that ignores the far clip: the bias was 0.3% here, below the noise.
   - Word-length membership with a set where it matters: here it had no effect.

## 1. Files and how to run

All runs are from the repo root with `npx tsx`. Each job prints one JSON line.

| file | what |
|---|---|
| `common.ts` | sfc32 RNG (one independent stream per estimator), Welford statistics |
| `torus.ts` | E³ twin: teleporting tracer, crystal tracer (generic BVH, no lattice code), selectors, integrator. `job`, `paired`, `check`, `debug` |
| `sw_twin.ts` | SW twin: hyperboloid walk with the verified pairings copied from `../seifert-weber/sw.ts`, selectors, integrator. `job`, `firsthit`, `check` |
| `run_torus.sh`, `run_sw.sh` | all jobs, 8 at a time |
| `summarize.ts`, `efficiency.ts` | the tables below |
| `results_torus.jsonl`, `results_torus_extra.jsonl`, `results_sw.jsonl`, `results_direct.jsonl` | raw results |

The scripts were edited after the main batches to add diagnostics. These are the env flags
`NB`, `CRYSTAL_R` and `NEE_NOCLIP`, and the `DHIST`/`s13HitsByCross` counters. Defaults are
unchanged, so a rerun reproduces the results files.

**Common to both twins:**
- **Scene.** An opaque Lambert ball (albedo 0.7) and a black spherical emitter (Le = 10). Both are
  off-center and strictly inside D, with no ghost copies.
- **Camera.** Inside D.
- **Measurement I_{N,R}.** At most N = 4 scattering events. Every segment (camera, BSDF, shadow)
  is cut at R_seg, and the cut part carries 0.
- **Light sampling.** Pick one image γ ∈ S(x) with probability p(γ|x), then sample a direction
  uniformly in the cone toward that image.
  - E³: sin α = r/d.
  - H³: sin α = sinh R / sinh d.
  - pdf = p(γ|x) / (2π(1 − cos α)).
  - The shadow ray is traced through the quotient. It counts only if its first hit is the light
    at the analytically predicted distance, which identifies the image.
- **pt-nee.** A BSDF hit on an image in S(x) gets weight 0. A hit on an image outside S(x) gets
  weight 1. The camera ray's light hits get weight 1.
- **pt-mis.** Power heuristic, with NEE pdf 0 for images outside S(x).
- **Two quantities.**
  - Q0 is the radiance averaged over uniform directions at the camera.
  - Q1 is the radiance along one fixed camera ray that hits the ball, so its variance is all
    lighting.
- **Variance.** "var" is the per-path sample variance.

## 2. E³ cubic 3-torus (L = 1)

**Scene:**
- ball c = (0.12, −0.17, 0.08), r = 0.3
- light c = (−0.31, 0.29, −0.27), r = 0.1
- camera (0.3, 0.35, 0.3)
- R_seg = 4 (≥ 2·diam D = 3.46)

**Tracer.** The ray stays in D. At a face exit it teleports by ∓L, and an integer vector k
accumulates. The light image hit is c_L + k·L in the chart of the ray's origin, an exact integer
identity.

**Image sets S(x)** (all NEE-side and BSDF-side tests share one function):

| name | S(x) | p(γ\|x) |
|---|---|---|
| U27 | fixed patch {−1,0,1}³ around D (torus-code's default) | 1/27 |
| W27 | same patch | ∝ unoccluded solid angle, with an exact horizon cull |
| NEAR | nearest image of c_L | 1 |
| BALL2 / BALL2w / BALL3w | images with ‖x − c_L − kL‖ ≤ 2 (or 3), not wholly below the horizon | uniform, or ∝ solid angle (w) |
| REACH (crystal only) | every light copy within R_seg + r of x, found by a BVH range query | uniform |

### 2.1 Agreement [checked-num torus.ts, results_torus.jsonl]

Q1 is the fixed ray. Each estimator uses its own seed. N = 300 000 paths for Q1 and 600 000 for
Q0.

| estimator | Q1 mean ± se | z vs pt | var/var(pt) | Q0 mean ± se | z vs pt | var/var(pt) |
|---|---|---|---|---|---|---|
| pt | 1.02908 ± 0.00399 | | 1.000 | 1.45766 ± 0.00393 | | 1.000 |
| U27 pt-nee | 1.03399 ± 0.00334 | 0.94 | 0.700 | 1.45834 ± 0.00373 | 0.13 | 0.903 |
| U27 pt-mis | 1.03133 ± 0.00321 | 0.44 | 0.645 | 1.45223 ± 0.00365 | −1.01 | 0.866 |
| W27 pt-nee | 1.02494 ± 0.00293 | −0.84 | 0.538 | 1.45628 ± 0.00357 | −0.26 | 0.828 |
| W27 pt-mis | 1.03141 ± 0.00294 | 0.47 | 0.543 | 1.46215 ± 0.00358 | 0.85 | 0.832 |
| NEAR pt-mis | 1.03543 ± 0.00363 | 1.18 | 0.825 | 1.45587 ± 0.00378 | −0.33 | 0.927 |
| BALL2 pt-nee | 1.02898 ± 0.00280 | −0.02 | 0.492 | 1.45581 ± 0.00354 | −0.35 | 0.815 |
| BALL2 pt-mis | 1.02687 ± 0.00272 | −0.46 | 0.463 | 1.45755 ± 0.00352 | −0.02 | 0.802 |
| BALL2w pt-mis | 1.02778 ± 0.00256 | −0.27 | 0.410 | 1.46089 ± 0.00347 | 0.62 | 0.780 |
| BALL3w pt-mis | 1.02866 ± 0.00177 | −0.10 | **0.197** | 1.45350 ± 0.00328 | −0.81 | 0.698 |
| crystal pt | 1.03219 ± 0.00400 | 0.55 | 1.004 | 1.45811 ± 0.00393 | 0.08 | 1.001 |
| crystal REACH pt-mis | 1.03318 ± 0.00295 | 0.83 | 0.545 | 1.45938 ± 0.00359 | 0.32 | 0.834 |
| crystal REACH pt-nee | 1.02719 ± 0.00424 (rerun, 600k) | −0.32 | 2.26 | 1.45764 ± 0.00506 | 0.00 | 1.662 |
| crystal BALL2 / BALL2w / BALL2-nee | 1.03698 / 1.03184 / 1.03324 | 1.63 / 0.58 / 0.85 | ≈ torus | 1.45928 / 1.45353 / 1.45784 | 0.31 / −0.79 / 0.03 | ≈ torus |
| **WRONG W1**: pt-nee drops BSDF hits outside S too | 0.52771 ± 0.00169 | **−115.6** | | 1.10153 ± 0.00340 | **−68.6** | |
| **WRONG W2**: NEE fixed patch, BSDF tests x-centered block | 0.89973 ± 0.00289 | **−26.2** | | 1.35530 ± 0.00358 | **−19.3** | |

- The first crystal-nee run read z = 2.10 (1.04449 ± 0.00615). It has heavy-tailed variance, so I
  reran it with a new seed and 600k paths and got z = −0.32. With about 30 independent E³ z-values,
  one near 2 is expected.
- Crystal pt-nee over all ~292 reachable light copies is *worse* than pt: var/var(pt) = 2.3. Only
  44% of its uniform picks are visible, and every BSDF hit on a light gets weight 0. pt-nee is a
  poor estimator once the light set is large and mostly occluded. pt-mis does not have this
  problem.

### 2.2 The crystal check, path by path [checked-num torus.ts paired]

**Setup:**
- The crystal holds every copy with |center − camera| − radius ≤ (N+1)·R_seg = 20: 69 058 spheres,
  of which 34 012 are lights.
- It uses a median-split BVH, so its code is independent of the lattice.
- Both tracers consume the same random stream. The crystal's BALL selectors find lights by a BVH
  range query and sort them lexicographically, so the same random number picks the same image.

| paired run | paths | paths differing (> 1e-9 rel.) | mean difference |
|---|---|---|---|
| torus pt vs crystal pt, Q0 | 200 000 | **0** | 0 (bit-identical) |
| torus BALL2 pt-mis vs crystal, Q1 | 100 000 | **0** | 6e-14 |
| torus BALL2 pt-nee vs crystal, Q1 | 100 000 | **0** | 1e-13 |
| torus BALL2w pt-mis vs crystal, Q0 | 200 000 | 129 at ~2e-9 rel. | 5e-9 |

- In the BALL2w pairing the selection weights depend continuously on x. Crystal coordinates
  reach about 20, so x is rounded at about 1e-15, and the ball lattice amplifies that by about
  20× per bounce. These are rounding differences, not path differences.
- So teleporting, the image identity k, shadow rays across faces, the clip and MIS reproduce an
  ordinary E³ scene exactly. That is a much stronger check than the statistical one, and it is
  cheap. A GPU witness can do the same with a fixed salt.

**One real failure, found on the crystal side.** With a spawn offset of 1e-9, 5 of 20 000 crystal
paths re-hit their own ball. The crystal has absolute coordinates around 3–20, so its hit points
are rounded at about 1e-15 × 20, and the offset was too small to clear that. The torus uses
local coordinates in D and was right. With an offset of 1e-6 both agree exactly. This is one
concrete precision argument for teleporting over unrolling [checked-num].

### 2.3 Crystal radius [checked-num results_torus_extra.jsonl]

| crystal radius | spheres | paths differing from the torus, 200k pt paths |
|---|---|---|
| 20 = (N+1)·R_seg | 69 058 | 0 |
| 17.73 = N·R_seg + diam(D) (the task's formula) | 48 313 | 0 |
| 12 | 15 236 | 0 |
| 8 | 4 626 | 70 446 |

- [math] A counted path has N + 1 segments, the camera segment plus N bounces, each ≤ R_seg, and
  NEE's last shadow segment also ends within (N+1)·R_seg. So (N+1)·R_seg from the camera is the
  radius that is guaranteed. N·R_seg + diam(D) is smaller whenever diam(D) < R_seg.
- That it also matched here only says that no sampled path reached that far; paths that do are
  rare. The radius-8 run shows that the check does detect a crystal that is too small.

### 2.4 Far clip, horizon and teleports [checked-num]

**The scene has no finite horizon.** The line x = y = 0.45 along z never meets any image: it was
traced to 1000 with 1000 crossings and no hit (`torus.ts check`). The same holds for every
lattice-of-small-spheres scene, as light-theory §1.3 explains. **No R_seg makes this scene exact.**
R_seg is a declared truncation, and every comparison above is of I_{N,R}.

pt and U27 pt-mis as a function of R_seg:

| R_seg | Q0 pt | U27 pt-mis | clipped segments | crossings / segment (max) |
|---|---|---|---|---|
| 2 | 0.73115 ± 0.0038 | 0.73463 ± 0.0041 | 48.1% | 2.59 (5) |
| 4 | 1.45766 ± 0.0039 | 1.45223 ± 0.0037 | 22.0% | 3.74 (9) |
| 8 | 2.15119 ± 0.0053 | 2.14842 ± 0.0057 | 4.5% | 4.45 (15) |
| 16 | 2.38590 ± 0.0054 | | 0.74% | 4.67 (29) |
| 32 | 2.45027 ± 0.0054 | | 0.13% | 4.74 (57) |

- **Size of the truncation.** R_seg = 4 (four cells) shows only 59% of the R = 32 value. Even
  R = 16 is 2.6% low.
- **Shape of the tail.** The clipped fraction falls about 5–6× per doubling of R, roughly R^−2.5,
  so the tail is polynomial, as light-theory and the skeptic predicted for corridors.
- **Cost.** The mean crossings per segment saturate at the mean free path. Lorentz-gas
  λ = V/(π Σ r²) = 3.18, and λ·Σ|d_i|/L averages 1.5 crossings per unit length, which predicts
  4.8 crossings per segment against 4.74 measured. Only the maximum grows with R.
- **Shadow rays** cross 1.1–2.4 faces on average (max 3–6), depending on the set.
- **Ties.** No edge or corner ties occurred in float64.

**NEE that ignores the clip** (WRONG W3, U27 pt-mis at R_seg = 2, with NEE allowed past R_seg):
- 0.54236 ± 0.0025, against 0.54444 ± 0.0025 for the correct estimator.
- The measured excess contribution is 0.0016 per path, 0.3% of the answer. That is real but below
  the noise.
- So the shared-clip condition (C4) cannot be left to the witness. It needs one clip constant read
  by both techniques.

### 2.5 Variance and cost of the image set (E³)

"Work" counts cell visits per path, over camera, BSDF and shadow segments: a GPU cost proxy, not a
timing. It leaves out the per-vertex selection scan, which is 27 entries for U27/W27, about 18 for
BALL2 and about 61 for BALL3.

| estimator | maxBounces 4, Q1: var/var(pt) | work | var·work vs pt | maxBounces 1, Q1: var/var(pt) | var·work vs pt |
|---|---|---|---|---|---|
| U27 pt-mis | 0.645 | 16.3 | 0.79 | 0.604 | 0.74 |
| W27 pt-mis | 0.543 | 19.4 | 0.79 | 0.518 | 0.73 |
| NEAR pt-mis | 0.825 | 18.4 | 1.14 | 0.817 | 1.10 |
| BALL2w pt-mis | 0.410 | 20.0 | 0.62 | 0.393 | 0.57 |
| BALL3w pt-mis | **0.197** | 21.2 | **0.31** | **0.167** | **0.26** |

- **NEAR is worse than pt per unit work.** The nearest image is often below the horizon or behind
  the ball, as torus-code also found.
- **Uniform 27 gains about 1.3×.** An x-centered ball of radius 3 with solid-angle weights gains
  3–4×. Within this scene, the larger and better-weighted set wins.
- **Why.** Within R_seg = 9, 70% of the direct light at the Q1 point comes from images within
  distance 3 and 51% from within 2 (distance histogram, pt maxBounces 1 [checked-num DHIST]).
- This is one scene and one point. light-theory and torus-code each measured one point too, and
  all three agree in direction.

## 3. Seifert–Weber

**Geometry.**
- D, its normals and the 12 pairings are copied from `../seifert-weber/sw.ts`, which was verified
  there by face matching, edge cycles, Dirichlet and ball tiling.
- The walk is that note's §2: the exit in tanh form, then renormalize, then apply g_f.
- **Scene:**
  - ball at distance 0.12 from o, R = 0.72
  - light at distance 1.12 toward the vertex direction (−1, 1, −1), R = 0.2
  - camera at distance 0.88
- **Clearances:** ball to ∂D 0.163, light to ∂D 0.104, ball to light 0.313.
- **Mean free path:** Santaló's λ = 4V/A = 5.44.
- R_seg = 8.

### 3.1 The walk against the unrolled cover [checked-num sw_twin.ts firsthit]

- 20 000 uniform camera rays with a clip of 3. The teleporting walk was compared with brute force
  over every image γ·ball and γ·light, for the 5 505 elements γ from a BFS over Γ.
- Hit kind mismatches: **0**. Max |Δt| = 3e-11. 459 rays hit a light.
- The hyperbolic law-of-cosines distance d(x, image center) from local hit data matched the true
  table distance on every light hit.
- In the full runs, the law-of-cosines distance matched the position-identified table entry to
  1.5e-12.
- The walk itself: largest defect from the hyperboloid constraints 2.7e-14, and 0 zero-length
  crossings.

### 3.2 Image sets

| name | S(x) | p | BSDF-side membership |
|---|---|---|---|
| S1 | the in-cell image c_L | 1 | the ray made 0 face crossings (D is convex) |
| S13 | c_L and its 12 neighbor-cell images g_i⁻¹c_L (the task's set) | 1/13 | the unteleported hit point cosh t·x + sinh t·v₀ lies in one of the 13 image balls |
| S13w | same | ∝ solid angle, with horizon cull | same, then the weight of that entry |
| BALL2/3, BALL2w/3w | images whose center is within 2 (3) of x, not wholly below the horizon, from a const candidate table of 2 447 centers sorted by d(o,·) | uniform or ∝ solid angle | **d from local data only**: cosh d = cosh t·cosh R − sinh t·sinh R·⟨v_hit, n_hit⟩. No group element and no table lookup, because the hit image is never horizon-culled [math] |

### 3.3 Agreement [checked-num sw_twin.ts, results_sw.jsonl]

N = 300 000 paths (150 000 for BALL3*).

| estimator | Q1 mean ± se | z vs pt | var/var(pt) | Q0 mean ± se | z vs pt | var/var(pt) |
|---|---|---|---|---|---|---|
| pt | 0.68494 ± 0.00326 | | 1.000 | 1.00394 ± 0.00457 | | 1.000 |
| pt (second seed, 200k) | 0.68284 ± 0.00399 | −0.41 | 1.000 | | | |
| S1 pt-nee | 0.68395 ± 0.00320 | −0.22 | 0.965 | 0.99342 ± 0.00448 | −1.64 | 0.959 |
| S1 pt-mis | 0.68811 ± 0.00320 | 0.69 | 0.968 | 1.00461 ± 0.00451 | 0.10 | 0.972 |
| S13 pt-nee | 0.68534 ± 0.00306 | 0.09 | 0.886 | 0.99907 ± 0.00446 | −0.76 | 0.951 |
| S13 pt-mis | 0.67984 ± 0.00300 | −1.15 | 0.849 | 0.99418 ± 0.00437 | −1.54 | 0.916 |
| S13w pt-mis | 0.68164 ± 0.00293 | −0.75 | 0.812 | 0.99999 ± 0.00432 | −0.63 | 0.894 |
| BALL2 pt-mis | 0.68034 ± 0.00272 | −1.09 | 0.700 | 1.00336 ± 0.00419 | −0.09 | 0.842 |
| BALL2w pt-mis | 0.68093 ± 0.00272 | −0.95 | 0.697 | 0.99033 ± 0.00414 | −2.20 | 0.822 |
| BALL3 pt-mis | 0.68497 ± 0.00354 | 0.01 | 0.592 | 1.00187 ± 0.00583 | −0.28 | 0.814 |
| BALL3w pt-mis | 0.67757 ± 0.00329 | −1.59 | **0.510** | 0.99782 ± 0.00561 | −0.85 | 0.753 |
| BALL3w pt-nee | 0.68291 ± 0.00331 | −0.44 | 0.517 | 1.00305 ± 0.00564 | −0.12 | 0.760 |
| **WRONG W1**: drop all BSDF light hits in pt-nee | 0.14260 ± 0.00088 | **−160.8** | | 0.53173 ± 0.00364 | **−80.8** | |
| WRONG? W2: S13 with membership "≤ 1 face crossing" | 0.68039 ± 0.00300 | −1.03 | 0.851 | 1.00039 ± 0.00439 | −0.56 | 0.923 |

- **The largest |z| among correct estimators is 2.20** (BALL2w, Q0), one of 22 SW comparisons.
- **Direct only** (maxBounces 1, Q1, results_direct.jsonl) [checked-num]:
  - pt 0.2885 ± 0.0036
  - S1 0.2988 ± 0.0037 (+2.0σ)
  - S13 0.2958 ± 0.0034 (+1.5σ)
  - S13w 0.2915 ± 0.0033 (+0.6σ)
  - BALL2w 0.2919 ± 0.0031 (+0.7σ)
  - BALL3w 0.2887 ± 0.0026 (+0.04σ)

  The two values near 2σ are both positive. A rerun of S1 and S13 at direct-only with more samples
  would settle that; I did not do it. S1's membership rule is the simplest one in the table, and
  the maxBounces 4 runs show no offset.

### 3.4 Word-length membership is exact for S13 [math; checked-num s13HitsByCross]

- **Measured.** Over 100 000 Q0 paths with S13, 3 052 BSDF hits landed on S13 images. Every one
  had 0 or 1 face crossings (903 and 2 149). None had 2 or more. Shadow rays to S13 images crossed
  at most 1 face in every run.
- **Reason** [math]: the union U = D ∪ g_i⁻¹D is convex.
  - Along the edges of the shared face, U's dihedral angle is 72° + 72° = 144° < 180°.
  - At the shared face's vertices, U's corner is two adjacent spherical triangles with 72° angles.
    That is a quadrilateral with angles 72°, 144°, 72°, 144°, which is convex.
  - Everywhere else U's boundary is D's or the neighbor's, which are convex.
  - A connected closed set that is locally convex is convex in H³ [mem: Tietze–Nakajima].
  - So the geodesic from x ∈ D to a point of g_i⁻¹D stays in U and crosses exactly face i.
- **What follows.**
  - In SW, "the BSDF ray crossed ≤ 1 face" is exactly "the image hit is in S13", and the face
    crossed names the image.
  - That is simpler than position identification, and W2 is not a mistake.
  - It holds for any polyhedral D whose dihedral angles are all ≤ 90°. That includes the E³ cube,
    where D ∪ (face neighbor) is a box.
  - It does **not** extend to radius-2 word sets. There the skeptic's point stands, and it is
    untested here.

### 3.5 Far clip and teleports (SW)

| R_seg | pt Q1 | S13 pt-mis Q1 | clipped segments | crossings / segment (max) |
|---|---|---|---|---|
| 4 | 0.35613 ± 0.0031 | 0.34868 ± 0.0031 | 27.8% | 2.37 (10) |
| 8 | 0.68494 ± 0.0033 | 0.67984 ± 0.0030 | 11.8% | 3.61 (17) |
| 12 | 0.85202 ± 0.0043 | 0.85079 ± 0.0046 | 4.6% | 4.12 (22) |
| 16 | 0.92523 ± 0.0044 | | 1.8% | 4.31 (29) |

- **The tail.** The clipped fraction falls about 2.5× per 4 units, an exponential tail, unlike E³'s
  polynomial one. Yet R_seg = 8 still shows only 74% of the R = 16 value. The R = 16 value itself is
  about 2% low, extrapolating the geometric decay; that extrapolation is not checked.
- **Crossings.** Mean crossings per camera/BSDF segment are 3.6 at R = 8 and 4.3 at R = 16. Santaló
  predicts about 5.7 for an unclipped segment (λ/0.96 = 5.44/0.96). The maximum grows with R:
  16–18 at R = 8 and 29 at R = 16.
- **Shadow crossings,** mean (max): S13 0.95 (1), BALL2 1.8 (6), BALL3w 1.85 (6).
- **No finite horizon.** In a compact hyperbolic manifold some geodesics avoid the ball forever, for
  example closed geodesics that miss it [math]. The tail is exponential, not zero.

### 3.6 Why NEE helps little in SW [checked-num DHIST]

At the Q1 point, with maxBounces 1 and R_seg = 16, this is the contribution of BSDF light hits by
distance d to the image center:

| d | 1–2 | 2–3 | 3–4 | 4–5 | 5–6 | 6–7 | 7–8 | 8–17 |
|---|---|---|---|---|---|---|---|---|
| radiance share | 0.078 | 0.063 | 0.044 | 0.038 | 0.030 | 0.021 | 0.018 | 0.057 |

(The total is 0.349.)

- **40% comes from within distance 3** and 53% from within 4.
- This is the seifert-weber note's shell argument made concrete: each unit shell holds images of
  roughly constant total solid angle, and only occlusion cuts the far ones down.
- So any finite NEE table leaves most of the direct light to BSDF sampling.
- Cost-adjusted gains (var·work against pt, Q1, maxBounces 4 / maxBounces 1):

  | estimator | maxBounces 4 | maxBounces 1 |
  |---|---|---|
  | S1 | 0.98 | 1.03 |
  | S13 | 0.90 | 0.92 |
  | S13w | 1.01 | 1.01 |
  | BALL2w | 0.92 | 0.92 |
  | BALL3w | **0.71** | **0.70** |

- The SW table also leaves out the per-vertex table scan, about 28 hits out of about 350 candidates
  checked for BALL3.

## 4. What this means for the plan (thought through, not checked unless labeled)

1. **Keep partition MIS as designed.** It is unbiased for every set tried, under both combiners,
   in both spaces [checked-num]. The conditions that matter:
   - **One membership function on both sides.** W2 in E³ is −19 to −26σ [checked-num].
   - **Keep BSDF hits outside S.** W1 is −69 to −161σ [checked-num].
   - **One shared far clip.** W3 is undetectable, so it must hold by construction [checked-num].
2. **Make R_seg large and treat it as a scene-level truncation, or add fog.** At the radii proposed
   so far (4 cells in E³, 8 in SW) it removes a quarter to two-fifths of the light in these scenes
   [checked-num].
   - Mean cost per segment does not grow with R_seg [checked-num], but the worst case does (57
     crossings at R = 32 in E³). That matters for warp divergence on the GPU, which is unmeasured.
   - Fog with a closed-form bound (light-theory §1.3) is the honest way to make the truncation
     small and declared.
3. **E³ default image set.** Uniform 27 is correct but gains only about 1.3×. A ball of images
   around x with solid-angle weights (BALL2w or BALL3w) gains 1.6–3.8× per unit work on this scene.
   - On the GPU it needs a per-vertex loop over a k-box, and the BSDF side needs the same weight
     function plus the sum W stored from the vertex.
   - The light tree over the 27-patch (light-theory's proposal) was not tested here.
4. **SW default image set.** Do not expect much from NEE.
   - BALL3w (images within 3 of x, solid-angle weights, membership and weight from the law of
     cosines) is the best tested, at about 1.4× per unit work. S13 is about 1.1×. S1 gives nothing.
   - If the plan wants the simplest correct start: S13 with "≤ 1 crossing" membership needs
     neither a table scan nor position identification on the BSDF side (§3.4).
   - The look in SW will be set mostly by BSDF-sampled light from far images. Bigger lights, more
     lights, or fog are what reduce noise.
5. **Witnesses.**
   - **The paired crystal check** (same salt, path by path) is exact and cheap in E³. It caught a
     precision bug within minutes.
   - **The crystal radius** must be (N+1)·R_seg from the camera.
   - **The SW first-hit check** against the unrolled cover passed with 0 mismatches and is
     cheap [checked-num].
   - **Witness scenes must be designed to give each rule power.** W3 and the word-length rule had
     no effect in these scenes. A witness for word-length membership needs a set larger than S13.

## 5. Limits and not done

- These are CPU float64 twins. Nothing tests GLSL, float32, GPU builtins, warp cost or the
  project's own sphere/quad light samplers. The cone sampler here is not the project's code.
- Each space has one scene and two measurement points. The variance rankings are for these
  scenes.
- Not covered:
  - objects crossing faces (ghost copies)
  - media and fog
  - Russian roulette
  - quad, mesh and emissive-object lights
  - the light tree
  - lights straddling faces
  - a scene where word-length membership is wrong
- **The crystal check covers E³ only.** For H³ I ran only the first-hit check (maxBounces 0,
  clip 3), as the seifert-weber note recommends.
- **Multiple comparisons.** About 50 correct-estimator z-values were computed. The largest |z| was
  2.20 (2.10 for crystal-nee before its rerun), which fits chance. Within one space the estimators
  share no random numbers but do share the scene, so the z-values are independent tests of the
  same expectation.
- **Twins edited after the main batches.** The diagnostics (`NB`, `CRYSTAL_R`, `NEE_NOCLIP`,
  `DHIST`, `s13HitsByCross`) were added after the main runs. With defaults, those code paths
  only add counters. I did not rerun the full batches after the edits.
