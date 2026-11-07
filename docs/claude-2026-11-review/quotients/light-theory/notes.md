# Light in closed quotient manifolds M = X/Γ: theory note

Key: light-theory. Written 2026-11-07 for the owner. No repository file was edited. Scripts and
their outputs are in this folder, which is
`/private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/quotients/light-theory/`.

Labels: [checked-code file:line] read in source; [checked-num script] measured by a script here;
[checked-src URL] read at that URL; [math] my derivation, not checked by anyone else; [mem] from
memory, not checked. The two prior notes (survey/quotients.md and the skeptic's section
quotient-light in survey/blackhole-quotient-challenges.md) are cited as "survey" and "skeptic".
The skeptic's corrections are adopted throughout.

## 0. Summary

1. **The measurement.** The scene in M is the same as the Γ-periodic scene in X with the camera in D
   [math]. M has no sky and nothing escapes, so light leaves only by absorption. Two declared
   truncations make the measurement finite and computable:
   - `maxBounces` N, which is always finite in this project.
   - A per-segment far clip R_seg, which must become a measurement field.

   The clip is exact when every geodesic segment meets a surface within R_seg (a finite horizon).
   With fog, the clip's error has a closed-form bound. No validation rule of the form "albedo < 1"
   is needed (§1).
2. **NEE.** NEE samples **one** image from a set S(x), using a probability p(γ|x). BSDF rays see
   every image. At a BSDF hit on image γ, the NEE pdf is p(γ|x)·(area-to-solid-angle factor) if
   γ ∈ S(x), and 0 otherwise. A Python twin confirms this is unbiased for three choices of S and p,
   and shows that two plausible mistakes are biased by −9.9% (about 27σ) and −3.4% (about 6σ).
   The second mistake is NEE and MIS using two different image sets (§2.5).
3. **Identifying the image hit.** The BSDF ray identifies the image it hit from its starting vertex
   x, its starting direction ω₀ and the total arc length t [math]:
   - In the cube torus: n = round(x + tω₀ − c_L), an exact integer vector.
   - In H³: the table entry whose light center is nearest to the closed-form point
     cosh t·x + sinh t·ω₀.

   This needs no group element on `Hit` and no per-cell bookkeeping. It works unchanged for lights
   that straddle a face (§2.3).
4. **Delta lights.** Forbid point and spot lights when Γ is infinite. With 27 images summed, the
   lost fraction is 1–47% in simple corridor scenes. At a medium point in a slab-shaped torus,
   the vacuum fluence of a point light is infinite: its partial sums grow like 2π ln R
   [checked-num point_light_loss.py]. A small sphere light gives the same look with none of these
   problems (§2.6).
5. **Defaults.**
   - **E³ torus:** the 27 images of each light in the fixed patch {−1,0,1}³ around D become
     ordinary roster lights. Selection uses the existing light tree. The existing `lighting_pdf`
     already returns 0 for an id it does not know, and that 0 is the partition-MIS rule (§3.1).
   - **Seifert–Weber:** a light-centered table of about 70–190 images, with weights
     Φ/sinh²(max(d, r_L)). sinh² d = ⟨x, γc⟩² − 1, so no transcendental function is needed. A fixed
     table centered on D's center misses the nearest image 5% of the time even with 73 entries
     [checked-num sw_tables.py] (§3.2).
6. **Witnesses that catch a wrong pairing:**
   - An unrolled crystal in E³, using the same clip and maxBounces. It gives the same measurement
     and needs only existing instancing.
   - For SW, a float64 TypeScript first-hit twin over the unrolled patch.
   - pt = pt-nee = pt-mis.
   - A chiral (asymmetric) scene.
   - A CPU tiling check of the group data. I ran it on the owner's SW construction: every one of
     3000 sampled points of a ball of radius 2.5 lies in exactly one cell, and vol(D) = 11.203 ±
     0.012 [checked-num sw_tiling.py] (§5).

## 1. The measurement in M

**1.1 Phase space.** Radiance is a function L on the unit tangent bundle T¹M (times wavelength).
In vacuum it is constant along the geodesic flow φ_t. The projection X → M is a local isometry,
so a geodesic of M lifts to a geodesic of X. Rendering M with the camera at x₀ ∈ D is therefore
the same as rendering the Γ-periodic scene π⁻¹(S) in X from x̃₀ [math]. Two things follow:

- A geodesic "wraps": it crosses into γD, and teleporting re-expresses it in D.
- The same light reaches x along countably many geodesics, one for each γ ∈ Γ in E³ and H³, which
  have unique geodesics.

**1.2 No escape.** The equation is L = Lₑ + TL with T = (scattering) ∘ (propagation to the next
surface or medium event). In an open scene, part of each ray leaves to the sky. In a closed M
nothing does, so energy leaves only by absorption.

- The Neumann series Σ Tⁿ Lₑ converges in sup norm whenever the spectral radius r(T) < 1, where
  r(T) = lim ‖Tᵏ‖^{1/k} [math, standard]. ‖Tᵏ‖_∞ is the worst-case k-event albedo: the supremum
  over starting states of the expected path throughput after k events.
- **A checkable sufficient condition** is that every surface and medium has albedo ≤ ρ̄ < 1. Then
  ‖T‖ ≤ ρ̄, and the tail after N events is at most ρ̄^{N+1}/(1−ρ̄) · max Lₑ.
- This is **not** necessary. Mirrors and lossless glass have albedo 1, and a glass object beside a
  black emitter is still finite. It is also not checkable in general, so it should not be a
  validation rule (the skeptic made the same point).

**What the renderer declares:**

- **`maxBounces` N.** It is already a non-negative integer, at most 2³¹ − 2
  [checked-code src/compiler/analyze/Validator.ts:444-451]. So the measurement Σ_{n≤N} TⁿLₑ is
  always finite, whatever the albedos.
- In a closed scene this truncation is larger than in an open one. It removes the fraction ρ^{N+1}
  of the uniform-albedo limit Lₑ/(1−ρ). For ρ = 0.8 that is 13% at N = 8 and 0.1% at N = 30
  [math].
- Russian roulette (survival cap 0.95 by default) [checked-code
  src/components/transport/integrators/pt/pt.ts:71] stays unbiased for the N-truncated
  measurement. So closed quotient scenes should use a large N with roulette.
- If ρ̄ = 1 is reachable, for example in a mirror box, the measurement grows like N and roulette
  ends paths only through the cap. That is legal, but it is noise and GPU time, not a bias.

**1.3 The per-segment far clip R_seg.** Every segment (camera, BSDF, shadow, or a free flight in a
medium) longer than R_seg is cut, and the cut part contributes 0, because there is no sky. Call the
result I_{N,R}.

- I_{N,R} increases monotonically to I_N as R grows, since every term is non-negative [math].
- **It is exact (I_{N,R} = I_N) when the scene has a finite horizon R_h ≤ R_seg**: every geodesic
  from every point of M meets a surface within R_h. This holds with or without media, because each
  segment, and any free flight on it, ends by R_h [math].
- **With an ambient medium of extinction ≥ σ_min** (fog), the cut part of each segment is at most
  e^{−σ_min R}·L_max [math]. Choosing R = ln(1/ε)/σ_min gives a quantified truncation; for example,
  σ_min = 0.5/L and ε = 10⁻³ give R ≈ 14L. **Fog is the clean way to make R_seg harmless in a scene
  with corridors.**
- **Corridor tails without fog** [math, exact for this geometry]. In a slab-shaped torus (one wall
  plane, layer height h):
  - From a wall point with cosine-distributed directions, the free path is τ = h/cos θ, so
    P(τ > R) = (h/R)². R = 10h clips 1% of bounce rays.
  - From an interior point with uniform directions, P(τ > R) = h/(2R). This is the heavy tail that
    medium vertices see.
  - The skeptic's point stands: tube-shaped (1-D) corridors have lighter tails than slab-shaped
    (2-D) ones.
- **R_h cannot be verified statically.** A witness should count clipped segments, which are
  segments that reached R_seg without a hit, and report their fraction. A count of zero over many
  samples is evidence, not proof.
- **A pitfall in finite-horizon scene design** [checked-num point_light_loss.py, balls]: a cubic
  lattice of spheres has a finite horizon only when r > L/√2. At that size the spheres close every
  face window and the void becomes sealed pockets, so the "quotient" is invisible. A finite horizon
  with visible neighbors needs designed occluders. For example, a room per cell with a window in
  each wall and an interior pillar that blocks every window-to-window segment gives R_h of about
  two cells [math, not measured]. Fog is simpler.
- MAX_DIST = 1000 is today's E³ clip, and the environment is found there
  [checked-code src/glsl/core/math.glsl:8-11]. In a quotient, R_seg must be a per-program
  measurement value, and an environment or directional light must be a compile error, as the survey
  proposed.

## 2. NEE with light images

**2.1 Path-space statement** [math]. Lift x into D. For an emitter L ⊂ M with lift L̃ ⊂ D (a light
that straddles a face is lifted whole, around its center c_L ∈ D), the geodesic segments of M from
x to L correspond one-to-one with pairs (γ, y), y ∈ L̃, through the segment x → γy in X. Direct
lighting is

  L_dir(x, ω_o) = Σ_γ ∫_{L̃} f · Lₑ · V_R(x, γy) · cos_x cos_y / A_X(t) dA(y),  t = d_X(x, γy),

where A_X(t) is t² in E³ and sinh² t in H³. V_R also requires t ≤ R_seg and respects
maxNullCrossings. Each (γ, y) is a separate path. Two images in the same direction are two paths,
and the farther one is occluded by the nearer one. This is the same bookkeeping as two lights in a
line in E³.

**2.2 The two techniques.**

- **NEE** picks γ ∈ S(x) with probability p(γ|x), then samples y on L̃ with the light's own density
  p_A. In solid angle at x, the density is

    p_NEE(γ, y) = p(γ|x) · p_A(y) · A_X(t) / cos_y.

- **BSDF sampling** has density p_σ(ω₀) on the first hit of the geodesic it traces.

The power-heuristic weights are:

- On the NEE sample: p_NEE² / (p_NEE² + p_σ²).
- On a BSDF hit of image γ: p_σ² / (p_σ² + p_NEE²) if γ ∈ S(x), and **1** if γ ∉ S(x), because
  NEE's density there is 0.

These weights sum to 1 over the techniques with positive density, on every path with nonzero
contribution, provided BSDF sampling covers f's support. So the estimator is unbiased for every
choice of S and p [math; the standard MIS condition]. The skeptic notes that pbrt handles lights
that only BSDF sampling can reach the same way [mem].

**The project already has this rule for unknown lights.** The generated `lighting_pdf` returns 0
for an id it does not list, which gives weight 1 on the BSDF side
[checked-code src/compiler/generate/features/lighting.ts:636,670].

**2.3 Conditions, each one necessary** [math]:

- (C1) S(x) and p(·|x) are deterministic functions of the vertex data (x and its normal; the
  `LightQuery`). They are evaluated by the **same code** on both sides.
- (C2) A BSDF hit yields the γ of the light image it actually hit.
- (C3) The pdf at a BSDF hit uses the traced geodesic's length t and the emitter cosine at the hit.
  In E³ these agree with the NEE side's chart computation. In H³, computing them from t (as the
  skeptic suggested) avoids converting between charts.
- (C4) Both sides use the same R_seg and the same null-crossing budget. An NEE image with
  d > R_seg contributes 0.

**Identifying the image from position (proposed; [math], not built).** The traced segment starts
at (x, ω₀) and hits the light after total arc length t, summed over teleports. In x's chart, the
unteleported closed-form point y_u = flow_X(x, ω₀, t) lies on the image actually hit, up to
rounding. The images' bounding balls B(γc_L, r_L) are disjoint. So:

- **E³, cube lattice of side L:** n = round((x + tω₀ − c_L)/L), componentwise. This is exact when
  the light's bounding box has half-extent < L/2 on each axis. The image is in the 27-patch iff
  ‖n‖_∞ ≤ 1.
- **H³:** γ = the table entry with −⟨y_u, γc_L⟩ ≤ cosh(r_L + tol). If no entry matches, γ ∉ S and
  the pdf is 0.
  - The scan is the same one that normalizes p (§3.2), so it is free. A hit with
    t > R_T + ρ_D + r_L cannot be in a table of radius R_T, so the scan is skipped there.
  - Precision estimate [math]: at t ≤ 6, coordinates are ≤ cosh 6 ≈ 200, and the error in d near r_L
    is about 0.02. So require 2r_L + 0.1 < (the systole at c_L).
  - In SW, the sampled minimum over c ∈ D of min_γ d(c, γc) is 1.746 [checked-num sw_group.py;
    sampled, so the true minimum may be slightly lower]. So r_L ≤ 0.8.

This needs only two values for the segment from the last vertex: its starting direction ω₀ and its
total length t. `Hit` needs no group element or ivec3. Ghost copies of a straddling light need no
special handling. A wrong identification gives a wrong MIS weight, not a missing image.

The alternative is to accumulate the group element across teleports (the survey's ivec3 or mat4
`cellBoost`) and compose it with the ghost copy's element (the skeptic's per-image point). That is
also correct. It needs a new `Hit` field and matrix comparisons with a tolerance in H³.

**2.4 Shadow rays keep their destination.** The trace-loop contract defines a shadow ray by its
destination, not by a distance, for a measured reason
[checked-code docs/trace-loop-contract.md:128-140]:

- With a remaining distance, each null-crossing re-spawn drifted by one offset.
- After two crossings, the drift let the area light block its own shadow ray.

So in a quotient the destination point γy must be carried through each teleport by applying the
same pairing to it, as the survey proposed. Each cell segment then re-derives its back-off from
that point. In E³ that is subtracting the accumulated lattice vector.

I first considered testing the shadow ray by length. That is the form the contract rejected, so it
is withdrawn.

The total length t used for identification in §2.3 can drift by about one spawn offset per
crossing. That is harmless there, because rounding has a margin of L/2 − h_L (and r_L in H³), but
it should be accumulated from cell exit lengths, not from re-spawned rays.

In H³, the traced shadow geodesic ends about ε·e^{d} from γy. For d ≤ 4, that is
6·10⁻⁸ · 55 ≈ 3·10⁻⁶ [math]. This is one reason to keep NEE tables at radius ≤ about 4.

**2.5 The twin** [checked-num torus_mis_twin.py, output torus_mis_twin.out]. Setup:

- Cube torus with L = 1: a full floor slab, a pillar, a floating block, and a one-sided quad light
  placed near the x = 1 face so that a second image is close.
- Direct irradiance at a floor point, R_seg = 3, traced in the universal cover.

Estimators compared:

- A: BSDF only.
- B: partition MIS with S = the 27-block around the nearest image and p ∝ 1/max(d², r²).
- B1: S = {nearest image}.
- B27u: the 27-block with uniform p.
- C: a brute-force sum over all images within R_seg.
- W1 (wrong): drop BSDF hits outside S.
- W2 (wrong): NEE uses the fixed patch while the BSDF side tests the x-centered block.

Results with 200 000 samples each and seed 3. The value "sd" is the per-sample standard deviation
of the NEE + BSDF pair.

| estimator | E | ± 1σ | sd per sample |
|---|---|---|---|
| C brute force (9.6% of E comes from images outside the 27-block) | 0.08641 | (error not computed) | |
| A BSDF only | 0.08509 | 0.00114 | 0.510 |
| B 27-block, p ∝ 1/d² | 0.08646 | 0.00048 | 0.216 |
| B1 nearest image only | 0.08677 | 0.00115 | 0.515 |
| B27u 27-block, uniform p | 0.08709 | 0.00053 | 0.237 |
| **W1** drop BSDF hits outside S | 0.07790 | 0.00032 | wrong: −9.9%, about 27σ |
| **W2** NEE and BSDF use different S | 0.08351 | 0.00046 | wrong: −3.4%, about 6σ |

**Reading the table.**

- The correct estimators agree with C within 1.3σ.
- Both mistakes are detected. W2 is the important one: it is exactly the error of keying the NEE
  side and the MIS side on two different notions of "nearby".
- "Nearest image" is not the same as "visible image". At this point, the nearest image of the
  light, n₀ = (−1, 0, −1), is below the floor and occluded. So B1 is no better than BSDF-only, while
  the 27-block cuts the standard deviation by 2.4×.
- Uniform p over 27 cost only about 10% more sd here. This is one point in one scene, so it is not
  a general ranking.
- This twin traces in the universal cover. It checks the image bookkeeping, not a teleport tracer.

**2.6 One image or the whole set.** Summing all of S costs |S| shadow rays, each crossing cells. In
a room-like scene most of them are occluded. Sampling one image by p has the same expectation at
the cost of one ray [math]. The project already draws one light per NEE, so keep drawing one image.

**2.7 Delta lights.** BSDF rays never hit a point light, so every image outside S(x) is **lost**:
a truncation with no fallback. Lost fraction with S = the 27-block around the nearest image (I = 1,
L = 1) [checked-num point_light_loss.py]:

| corridor geometry | receiver | lost fraction |
|---|---|---|
| slab (one wall plane; all in-plane images visible) | floor point, light height h = 0.05 / 0.25 / 0.5 / 0.9 | 11.9% / 17.1% / 28.8% / 47.2% |
| slab | medium point | **infinite**: partial sums 26.5, 40.7, 49.4 at image radius 10, 100, 400 (≈ 2π ln R) |
| three orthogonal square tubes, half-width a = 0.1 / 0.2 / 0.3 | tube floor | 1.2% / 1.8% / 10.8% |
| same | medium point on the tube axis | 7.8% / 7.8% / 16.2%. The image ball of radius 12 undercounts: the exact 1-D series gives 8.9% |
| finite horizon R_h ≤ 1.5L | any | 0. The x-centered block contains every image within 1.5L [math] |

So in E³, a point light is either exact, if the scene has a finite horizon of at most 1.5 cells
(which is hard to design and not checkable), or a large undeclared bias. In a 2-D corridor its
measurement can even be infinite. In H³ the image count grows like e^{2R}.

**Recommendation:** make delta lights (point, spot, beam, softbeam) a compile error when Γ is
infinite. A sphere light of small radius looks the same and its radiance is bounded: the direct
term is at most Lₑ times the projected solid angle. This agrees with the survey and with the
skeptic, whose objection concerned spherical quotients only. Spherical quotients are out of scope
here.

## 3. Efficiency: which S(x) and which p(γ|x)

Unbiasedness does not depend on S or p (§2.2). They only move variance between NEE and BSDF
sampling. So **the table radius is an efficiency knob, not a truncation**, and it should be chosen
by measurement.

**3.1 E³ tori.**

- **Default (proposed):** the image roster is the 27 translated copies of each light in the fixed
  patch {−1,0,1}³ around D.
  - The patch always contains the nearest image of every light, and every image within distance L
    of any x ∈ D [math: |x − c|_∞ < L for x, c ∈ D, so ‖x − c − n‖_∞ < L implies ‖n‖_∞ ≤ 1].
  - The x-centered 27-block, n₀ = round(x − c) + {−1,0,1}³, covers 1.5L. That is better, but it
    cannot be a static roster.
- **Selection:** use the existing light tree (`lightSelection: 'bvh'`) over the roster. Its
  importance Φ·cos/max(d², (diag/2)²), with the exact horizon cull
  [checked-code src/components/accel/light_tree/light_tree.glsl:1-60], is x-adaptive and
  deterministic, and `light_tree_pmf(q, id)` already replays it at a BSDF hit
  [checked-code src/compiler/generate/features/lighting.ts:911-937].
  - With power or uniform selection, every image of a light gets 1/27 of its share. B27u in the
    twin shows the cost of that.
- **BSDF side:** id = base·27 + index(n) when ‖n‖_∞ ≤ 1; otherwise the id is unknown and the pdf
  is 0.
- The existing `quad_light_pdf(l_image, x, x + tω₀, ω₀)` is unchanged, because the image light is
  a translated struct and the unrolled point is in x's chart
  [checked-code src/components/lights/quad/quad.glsl:36-41].
- New GLSL is limited to the teleport loop (which carries the shadow destination along), and the
  round() id map.

**3.2 Seifert–Weber** (data from thurston-rebuild/src/geometries/hyp/groups/seifert-weber/set.js:25-91
[checked-code]).

Group facts [checked-num sw_group.py, sw_tiling.py, sw_tables.py]:

- Inradius 0.99638, circumradius 1.9028, dihedral angle 72° exactly.
- Every generator maps its face's 5 vertices onto the opposite face's vertices.
- Shortest d(o, γo) = 1.9928 = 2 × inradius.
- vol(D) = 11.203 ± 0.012 by Monte Carlo, against the known 11.199 [mem].
- Each sampled point of a ball lies in exactly one cell.
- The mean number of images of c within s of x is 0.45 / 6.52 / 54.89 for s = 1 / 2 / 3, against
  vol(B_s)/vol(M) = 0.46 / 6.53 / 54.90.
- The orbit's covering radius: d(x, nearest image) has mean 0.997 and maximum 1.635 over 3000
  sampled pairs.

D is large compared with the distances that matter. ρ_D = 1.90, while the nearest image is on
average 1.0 away. So **a fixed table centered on D's center is poor**:

| table T_R = {γ : d(o, γo) ≤ R} | entries | nearest image in T | nearest image outside T (min / 5th pct / median) |
|---|---|---|---|
| R = 0 (in-cell image only; what thurston-rebuild does) | 1 | 36.3% | 0.115 / 0.681 / 1.213 |
| R = 2 (identity + 12 face neighbors) | 13 | 72.4% | 0.260 / 0.920 / 1.481 |
| R = 3 | 73 | 94.9% | 0.647 / 1.282 / 1.882 |
| R = 3.5 | 193 | 99.4% | 0.647 / 1.571 / 2.172 |

- **Default (proposed):** per light, the table T_L = {γ : d(o, γc_L) ≤ R_T}, with G_γ, γc_L and
  (for meshes or quads) γ applied to the light's frame. These are computed in float64 on the CPU
  and emitted as const arrays.
- **Weights** w_γ(x) = Φ / max(⟨x, γc_L⟩² − 1, sinh² r_L). Since ⟨x, γc⟩ = −cosh d, the first term
  is sinh² d, with no acosh.
- **Horizon cull:** w = 0 when ⟨γc_L, n_x⟩ < −sinh r_L. The signed distance to the tangent plane at
  x is asinh⟨y, n_x⟩ for a unit tangent normal n_x [math]. The cull applies only to one-sided
  receivers, as in the existing tree.
- **Cost:** about 10 flops per entry on each side.
- **R_T ≈ 3.5** keeps the nearest image of every pair in the table 99.4% of the time (measured for
  the o-centered table; the light-centered version has not been measured).
- **Many lights:** the cost is linear in (lights × table size). A tree in the Klein chart, where
  the bounds would be Euclidean, is future work.
- **Do not trust the per-shell argument for choosing R_T.** Unoccluded images subtend 4πA dr/V per
  shell in every geometry, so occlusion, not distance, is what makes far images negligible.
  Measure the variance on the real scene.

## 4. What makes it look real

- **Indirect light through the pairings** needs nothing extra. A BSDF ray that teleports carries
  the neighbor cell's radiance. A wall lit by a light "two rooms over" shows as color bleeding and
  soft fill. This is the main visual difference from the earlier visual-approximation renders,
  which kept only the in-cell image [checked-code thurston-rebuild
  src/geometries/euc/lights/localPointLight/shaders/struct.glsl:14-25, cited by survey].
- **The repetition looks like an infinite mirror without loss.** Radiance does not fall with
  distance, so a far copy of a lit wall is exactly as bright as the near one. Far copies shrink
  below a pixel and alias into high-frequency texture. In H³ this happens after about 3 units,
  because angular size falls like e^{−d}.
- **Fog is the most useful realism tool.** An ambient homogeneous medium (`ambientMedium` already
  exists [checked-code src/compiler/types.ts:32-34]) does three things:
  - It gives depth cues.
  - It fades the aliasing.
  - It bounds the clip error (§1.3).

  In E³, transmittance depends only on the length traveled, so teleports change nothing. A
  heterogeneous density is a function on M, meaning a function on D read at the reduced point
  (the skeptic):
  - **E³:** evaluate it at fract(p/L). Delta tracking can run on the unrolled segment.
  - **H³:** tracking runs cell by cell between face crossings. Splitting is exact because
    free-flight sampling is memoryless. The majorant must bound the density on all of D.
  - Continuity across paired faces is a matter of looks (seams), not correctness.
- **Lights.** Use small bright sphere or quad lights, or emissive objects. Images that NEE does not
  take arrive by BSDF sampling with weight 1. A tiny, very bright light with long open corridors
  will produce fireflies from those images, so fog or a larger S(x) is the remedy (§3).
- **Exposure.** A closed world with albedo ρ sits near Lₑ/(1−ρ), so it is 5× brighter than direct
  light at ρ = 0.8. Expose for that level, and raise maxBounces until ρ^{N+1} is negligible (N ≈ 30
  at ρ = 0.8).
- **Leaks break realism immediately.** An object that crosses a face without its ghost copies shows
  a hole, and light passes through it. The compile-time ghost-copy list (survey §4.1) is part of
  correct lighting, not an option.
- **Camera body (optional).** In a quotient the viewer sees their own position repeated. An
  "avatar" object at the camera, as in the Thurston-geometries renders [mem], makes the scale
  readable.

## 5. Witnesses that can detect a wrong pairing

1. **CPU tiling check of the group data** (no GPU; vitest). Every sampled point of a ball lies in
   exactly one cell γD. vol(D) matches the manifold's known volume. Each generator maps its face's
   vertices onto the paired face. For SW, all three pass on the owner's data
   [checked-num sw_tiling.py, sw_group.py]. This tests the data, which nothing in the renderer can
   test.
2. **Partition-MIS twin** (TypeScript, vitest), ported from torus_mis_twin.py:
   - A = B = B1 = C within error.
   - W1 and W2 must fail.
   - A version for SW uses the table scan.
3. **pt = pt-nee = pt-mis on the GPU** in an asymmetric torus scene:
   - The light sits near a face, so S(x) membership changes across the picture.
   - A glossy surface makes BSDF rays reach images outside S.
   - Fog is optional.
4. **Crystal unrolling in E³ (exact)** [math, the skeptic's correction made precise]:
   - Under I_{N,R}, every vertex of every counted path lies within (N+1)·R_seg of the camera.
   - A crystal of all cells meeting B(x₀, (N+1)R_seg + ρ_D), with the lights as instance sphere
     lights, gives the identical measurement **if the crystal renderer uses the same R_seg**.
   - So the far clip must be a measurement field in E³ too. Otherwise the scene needs a proven
     finite horizon.
   - Size: N = 2 and R = 2L give about 1400 cells, within instancing's documented range.
   - The crystal is built from group elements (integer translations). The tracer uses face planes
     and pairings. A mismatch between the two shows.
5. **SW first-hit twin.**
   - Render with maxBounces 0 (emission seen directly). Use a chiral scene: three emissive spheres
     of different colors at generic positions plus an L-shaped block, so that no rotation of D
     preserves it.
   - A float64 TypeScript caster over the unrolled patch (the BFS elements here) gives the
     reference color at each pixel center.
   - Compare pixels whose 3×3 reference neighborhood is uniform; the expected mismatch is ~0.
   - This needs no new AOV and no H³ instancing.
   - A GPU H³ crystal is limited by the working radius of about 3 in the curved-space design (about
     55 cells, maxBounces 0 or 1). It is optional.
6. **Leak and clip counters.** In a closed furnace with uniform Lₑ and ρ, the result
   Σ_{n≤N} ρⁿ Lₑ detects leaks and teleport-cap hits only, not pairings (the skeptic). Report the
   fraction of clipped segments with it.

**Why a chiral scene matters** [math]. If the scene in D is invariant under some symmetry s of D, a
pairing that is wrong by s renders identically. SW's twist of 3π/5 differs from π/5 (the spherical
Poincaré space's twist) by 2π/5, which is a symmetry of the pentagonal face.

## 6. A plan outline (for the owner to judge; not reviewed)

The order is E³ first, because it needs no curved code.

1. Make the far clip a measurement field. Make the environment, directional and delta lights
   compile errors in quotients. Port the TypeScript twins (§5.2).
2. Build the cube torus (survey §8) with:
   - the teleport loop inside `scene_intersect`;
   - the shadow destination carried through teleports;
   - the image roster for the 27-patch;
   - position-based identification;
   - the light tree for selection.

   Witnesses: §5.3 and §5.4.
3. Add ghost copies. Witness: §5.4 with straddling objects.
4. After H³ step 2: build SW with the const tables, the table-scan selection and identification,
   and cell-by-cell tracking for media. Witnesses: §5.1, §5.2, §5.5, §5.3.

## 7. Not checked, open

- None of the GPU design is built or measured, including the cost per teleport and warp tails.
- The H³ position-identification precision (about 0.02 in d at t ≤ 6) is an estimate. It needs a
  float32 twin.
- The SW systole of 1.746 is sampled. The true global injectivity radius may be slightly smaller.
- Light-centered SW table coverage was not measured; only the o-centered table was.
- The "window rooms" finite-horizon design (§1.3) has not been measured.
- The variance ranking in §2.5 is for one point in one scene.
- The twin was run with one seed. The brute-force reference's own Monte Carlo error was not
  computed.
- Identifying the image by position (§2.3) is my own proposal. Neither the survey nor the skeptic
  reviewed it.
