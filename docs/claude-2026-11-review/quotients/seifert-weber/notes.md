# Seifert–Weber dodecahedral space: exact geometry and what rendering it needs

Key: `seifert-weber`. Nothing in the repo was edited.

Files (all in this folder):
- `sw.ts` is the verification script (float64, with float32 simulated by `Math.fround` after every
  operation). Run `node --max-old-space-size=12000 sw.ts geom|tile|teleport|diam|count`.
- `extra.ts` computes the face angle, the area of ∂D and the Kac/Santaló check.
- Outputs: `out-geom.txt`, `out-tile.txt`, `out-teleport.txt`, `out-diam.txt`, `out-count.txt`.

Labels: [checked-code file:line], [checked-num script/section], [math] (derived here, not
machine-checked unless a num label is also given), [mem] (from memory, not checked).

Conventions: points are `[x,y,z,w]` with w timelike, and ⟨a,b⟩ = a_x b_x + a_y b_y + a_z b_z − a_w b_w.
H³ = {⟨p,p⟩ = −1, w > 0} and o = (0,0,0,1). Face i has an outward unit normal N_i with ⟨N_i,N_i⟩ = 1.
A point p is in D iff ⟨N_i,p⟩ ≤ 0 for every i, and ⟨N_i,p⟩ = sinh(signed distance of p beyond face i).

---

## 1. Geometry of D, the regular dodecahedron with dihedral angle 2π/5

### Radii and other measures

| quantity | closed form | value | label |
|---|---|---|---|
| inradius r_in (o to a face center) | cosh² r_in = (5+2√5)/4, so sinh² r_in = (1+2√5)/4 | 0.9963844978473164 | [math] [checked-num geom] |
| midradius r_mid (o to an edge midpoint) | cosh² r_mid = (25+11√5)/10 | 1.4391063994535864 | [math] [checked-num geom] |
| circumradius R_c (o to a vertex) | cosh R_c = (7+3√5)/4 = φ⁴/2 | 1.9028473444057536 | [math] [checked-num geom] |
| edge length | = 2 r_in, cosh = (3+2√5)/2 | 1.9927689956946 | [math] [checked-num geom, extra.ts] |
| face angle (pentagon corner) | arccos(1/√5) | 63.4349488° | [checked-num extra.ts] |
| pentagon area | 3π − 5·angle | 3.88903437 | [checked-num extra.ts] |
| area(∂D) | 12 pentagons | 46.6684125 | [checked-num extra.ts] |
| vertex solid angle | 3·(2π/5) − π = π/5; 20 corners give 4π | 0.6283185 | [math] [checked-num geom] |
| vol(D) = vol(M) | 11.1990647 | Monte Carlo 11.173 ± 0.036 | [mem] for the value, [checked-num tile] for the agreement |

Derivation [math]: in the Klein model centered at o, D is a Euclidean regular dodecahedron. Its
face planes n̂·x = tanh r_in give Minkowski normals N = (n̂ cosh r, sinh r). Adjacent faces have
n̂_i·n̂_j = 1/√5, so cos(dihedral) = −⟨N_i,N_j⟩ = sinh² r − cosh² r/√5. Setting this equal to
cos 72° gives cosh² r = (5+2√5)/4. The midradius and circumradius follow from
tanh r_mid = tanh r_in / cos β and tanh R_c = tanh r_in / cos γ, where cos²β = (5+√5)/10 and
cos²γ = (5+2√5)/15 are the Euclidean dodecahedron's angles at its center. Both routes agree to
2e-15 [checked-num geom].

**thurston-rebuild check.** `halfWidth = 0.996384497847316` equals r_in to 4e-16
[checked-code seifert-weber/set.js:25] [checked-num geom]. The comment above it (set.js:19-23),
sinh h = √(1 − sin²α − sin²β)/sin β with α = 2π/5, has a **negative radicand (−0.1809)**. With
α = π/5 (half the dihedral angle) it gives r_in exactly. The comment is wrong and the constant is
right [checked-num geom].

### Face normals [checked-num geom]

n̂_i runs over the normalized vectors (0,±1,±φ), (±1,±φ,0), (±φ,0,±1). Faces are ordered as in
set.js: face 2k is +dir_k and face 2k+1 is −dir_k. For example, N_0 = (0, 0.809016994375,
1.309016994375, 1.169629851171).

Gram matrix ⟨N_i,N_j⟩:

| pairs | count | value | meaning |
|---|---|---|---|
| adjacent | 30 | −0.309017 = −cos 72° | the dihedral angle is exactly 72° |
| non-adjacent, non-opposite | 30 | −2.427051 = −3φ/2 | ultraparallel |
| opposite | 6 | −3.736068 = −(3+2√5)/2 = −cosh 2r_in | ultraparallel at distance 2r_in |

thurston writes each normal for a Euclidean dot product as (k, −|k|²), with k = tanh(r_in)·n̂.
That vector is a positive multiple of J·N_i, so its test `dot(p.coords, normal) > 0` is
⟨N_i,p⟩ > 0 [checked-code set.js:50-60] [math].

The 20 vertices, dual to these normals, are (±1,±1,±1), (±1/φ,0,±φ), (0,±φ,±1/φ) and
(±φ,±1/φ,0), rescaled to Klein radius tanh R_c. Each lies on exactly 3 faces [checked-num geom].

### The 6 face pairings [checked-code set.js:76-85] [checked-num geom]

g_{2k} = T(−2 r_in u_k) · R(u_k, 3π/5), and g_{2k+1} = g_{2k}⁻¹, where u_k = n̂_{2k}.
- T(t·u) = I + sinh t·m + (cosh t − 1)·m², with m = [[0,0,0,u],[uᵀ,0]].
- R is the Rodrigues rotation, the same as three.js `makeRotationAxis`.
- g_i is applied when a ray **exits through face i**, and maps face i onto face opp(i) = i xor 1.

Checks, for all 12 faces:
- Each g_i is in SO⁺(3,1) to 3.6e-15, with det = 1 and g_ww = 3.736 > 0.
- g_i maps face i's 5 vertices onto face opp(i)'s 5 vertices.
- g_i N_i = −N_opp(i) to 1.8e-15, so the hyperplane is carried over with D's side flipped.
- g_i maps the center of face i to the center of face opp(i).
- g_i o lies beyond face opp(i), at distance 2r_in = 1.992768996.
- The twist: opposite pentagons are offset by 36° (vertex azimuths 18°+72°k against −18°+72°k).
  A vertex at 18° goes to 126° = 18° + 108°, a 3/10 turn.
- Each g_i has complex length 2r_in + i·108°, as it must for a rotation about its own
  translation axis [checked-num count].

**Edge cycles:** the 30 edges fall into **6 classes of 5**, each with angle sum 5·72° = 360°. The
cycle transformation (the product of pairings around each class) is the identity to 4e-14.
**Vertex classes: 1.** χ = 1 − 6 + 6 − 1 = 0 [checked-num geom]. By Poincaré's polyhedron
theorem this certifies a closed manifold. The theorem is [mem]; its hypotheses (side pairing,
edge-cycle sums of 2π, cycle products I) are [checked-num].

**Tiling** [checked-num tile]:
- The 12 neighbors g_i⁻¹D, sampled at 20000 hyperbolic-uniform points of D: no image falls in D,
  every image lies beyond face i, and none lies in another neighbor. 0 violations.
- D is the **Dirichlet domain at o**: for 3000 points p ∈ D, d(p,o) ≤ d(p,γo) for all 2565
  elements with d(o,γo) ≤ 4.90. 0 violations.
- **Full ball tiling:** each of 20000 points within distance 3 of o lies in exactly one cell γD,
  out of the 2565 elements.

### Number field and exact arithmetic [checked-num geom]

In this frame every generator has its 3×3 block and its ww entry in Q(√5), with denominators at
most 4. The off-diagonal (xyz,w) and (w,xyz) entries are κ times elements of Q(√5), where
κ = √((13+7√5)/2) ≈ 3.785. All 12 generators were checked. For example:

```
g_0 = [ (1−√5)/4   (−1−√5)/4   1/2          0
        (1+√5)/4   (1+√5)/4    (5+√5)/4     −κ/2
        −1/2       (5+√5)/4    (3+√5)/2     −κ(1+√5)/4
        0          −κ/2        −κ(1+√5)/4   (3+2√5)/2 ]
```

So conjugating by diag(1,1,1,κ) puts the whole group in GL₄(Q(√5)), preserving the form
x²+y²+z² − w²/κ². Traces of 200 random words of length 1–6 were all (a+b√5)/2 with integers a, b,
for example 3572.000280 = (3573+1597√5)/2.

The test was a small-integer search to tolerance 1e-9, not a proof. That Γ is arithmetic over
Q(√5) is [mem]. An exact "QuadRing(5)" arithmetic, like thurston's QuadRing(3) for the
hyperbolic cube [checked-code hyp/groups/cube/Group.js:7], is therefore available. Section 3
explains why the renderer does not need it.

---

## 2. The teleport walk (exact exit, no march, no creeping)

The ray is at p ∈ D with unit tangent v. For each face with b_i = ⟨N_i,v⟩ > 0, compute
a_i = ⟨N_i,p⟩ ≤ 0 and τ_i = −a_i/b_i = tanh(t_i). The exit face is the argmin, with τ clamped
to ≥ 0. Then:

```
q = p + τ v,   w = v + τ p                      (q lies on the face plane: ⟨N,q⟩ = 0 linearly)
p ← q / √(−⟨q,q⟩)                              (= cosh t·p + sinh t·v)
v ← w + ⟨w,p⟩p,  v ← v/√⟨v,v⟩                  (= sinh t·p + cosh t·v, re-orthogonalized)
t_acc += atanh τ
(p, v) ← (g_f p, g_f v)
```

- This is the task's formula t = atanh(−⟨n,p⟩/⟨n,v⟩) with n the **outward** normal (⟨n,p⟩ < 0
  inside). It is also thurston's creep formula `atanh(-dot(pos,normal)/dot(dir,normal))`
  [checked-code hyp/groups/cube/set.js:27-33].
- No cosh or sinh is needed, and atanh is used only for the bookkeeping of t.
- τ < 1 always holds, since the longest chord in D is 2R_c, giving τ ≤ tanh 3.806 = 0.9990
  [math].
- thurston's `teleport()` takes the first failing test in a fixed order
  [checked-code core/teleportations/shaders/teleport.glsl.mustache:8-18]. With exact exits the
  face is the min τ, so the order does not matter.

**Renormalization is mandatory, even in float64.** [math] With e = ⟨p,v⟩, the exact update gives
⟨p',v'⟩ = e·cosh 2t. The constraint is an unstable fixed point, and the defect is multiplied by
cosh 2t on every crossing. [checked-num teleport] Without renormalization, 851 of 2000 float64
rays failed within 100 teleports, and every float32 ray failed.

**Measured drift with renormalization** (float32 matrices and normals rounded once, float32
arithmetic; 2000 rays × 100 teleports and 300 rays × 1000 teleports) [checked-num teleport]:

| | float64 | float32, 100 | float32, 1000 |
|---|---|---|---|
| max \|⟨p,p⟩+1\| | 3.2e-14 | 1.2e-5 | 1.4e-5 |
| max \|⟨v,v⟩−1\| | 1.6e-14 | 8.1e-6 | 5.9e-6 |
| max \|⟨p,v⟩\| | 1.6e-14 | 7.1e-6 | 6.3e-6 |
| max sinh(distance outside D) | 1.7e-14 | 1.1e-5 | 1.1e-5 |
| failures / stuck rays | 0 | 0 | 0 |

The errors are bounded, with no growth from 100 to 1000 teleports, because each teleport applies
one fixed matrix from D and renormalizes.

**Edges and vertices** [checked-num teleport]: 4000 float32 rays were aimed exactly at vertices
or edge midpoints, for 30 crossings each. 5.5% of crossings had zero length, which is the ray
passing through several cells at a point. The longest zero-length run was 6, with no stuck rays
and no failures, and the largest excursion outside D was 2.2e-5 (sinh). A crossing cap is still
needed as a declared guard; its hit rate must be measured in GLSL.

**Independent check of the walk (Kac's lemma)** [math, Kac/Santaló, mem for the theorem]
[checked-num extra.ts + teleport]: the mean geodesic length between face crossings is
2·vol(M)/area(faces in M) = 4·vol/area(∂D) = **0.9599**. The measured value was 0.9570–0.9601.
The 100-teleport runs read slightly low because their first segment starts inside the cell.

---

## 3. Precision verdict: float32 and fixed matrices suffice; never accumulate products

1. **Float32 walk against the pixel footprint** [checked-num teleport]. Starting from the same
   state, the float32 ray separates from float64 like e^T (chaos), as expected. A 1e-3 rad
   pixel's footprint grows like sinh T, so the ratio stays small:

| arc length T | 2 | 4 | 6 | 8 | 10 | 12 | 14 |
|---|---|---|---|---|---|---|---|
| cross-track error, median | 3.3e-6 | 1.7e-5 | 1.2e-4 | 8.4e-4 | 6.2e-3 | 4.5e-2 | 0.21 |
| cross-track error, max | 2.5e-4 | 7.7e-4 | 7.1e-3 | 4.0e-2 | 0.24 | 0.76 | 2.0 |
| max error / pixel footprint | 0.07 | 0.03 | 0.035 | 0.027 | 0.021 | 0.009 | 0.003 |

   The float32 path is a sub-pixel perturbation of a true geodesic at every length. Face
   sequences diverge from float64 at the earliest at T = 8.6 (median 14.5). That happens when
   the two nearby geodesics pass on opposite sides of an edge, and it is harmless.

2. **Arc-length bookkeeping is self-consistent** [checked-num teleport]. Comparing each float32
   segment length against float64 from the same float32 state: median 1.9e-7, max 4.5e-5. The
   sum over 100 segments (about 96 units) has max 1.1e-4. The float32 and float64 exit faces
   agreed in 100000 of 100000 crossings. (Compared against the float64 ray, the along-track
   difference is up to 0.37 at T=10, but that is the difference between two nearby geodesics,
   not a bookkeeping error.)

3. **Products accumulated in float32 (a "cellBoost") go wrong quickly** [checked-num teleport].
   After 2 crossings the image of o is off by 1.2e-6, after 5 by 4.1e-4, after 10 by 1.1, and
   after 20 by 30. This is why thurston's cube uses QuadRing. The path tracer needs no runtime
   products at all (section 5).

4. **Float32 tables rounded once from float64** (for NEE to image γy) [checked-num teleport]:
   the aim-direction error is ≤ 1.8e-6 rad and the relative distance error ≤ 1.8e-6, for
   d(x,γy) up to 12. The remaining NEE error is the shadow ray's own drift from item 1, at most
   7e-3 at distance 6.

5. **Exact Q(√5) arithmetic is not needed in the shader.** Float64 is enough for build-time
   tables. Orbit points are at least 2r_in = 1.99 apart, so dedupe by γo is robust: the
   collision check in `enumerate` never fired over 1,026,167 elements, and the counts match the
   volume asymptotics.

Caveat [mem, unchecked]: GLSL ES 3.00 does not give IEEE precision for every builtin; atanh in
particular inherits its precision from exp/log. The walk uses only +, ×, ÷ and √ for geometry,
and atanh only for t. The Math.fround simulation does not model GPU builtins or FMA contraction,
so the cap-hit and drift numbers must be re-measured in GLSL (SwiftShader and a real GPU).

---

## 4. The sizes that set the lighting cost

Injectivity radius, systole and diameter:
- **Injectivity radius at o**: r_in = 0.99638. The closest orbit points are 12 at 1.992769,
  then 60 at 2.789001, 120 at 3.421647, 120 at 3.675826, 20 at 3.805695 and 132 at 3.985538
  [checked-num count].
- **Systole**, the shortest closed geodesic: **ℓ = 1.745779538**, with rotation part
  θ = 146.55°. It is certified complete: any γ with ℓ(γ) ≤ L has a conjugate with
  d(o,γo) ≤ L + 2R_c, and the enumeration reaches 7.903, so every length ≤ 4.097 was found
  [math] [checked-num count]. The next lengths are 1.992769 (the face pairings, at 108°),
  2.618669, 3.195680 and 3.317576. The global injectivity radius is systole/2 = **0.87289**
  [math: closed hyperbolic manifold]. So a light has exactly one image within 0.873 of any
  point, and within 0.996 of o.
- **Diameter: 1.902847 = R_c**, attained between o and the vertex [checked-num diam]. It is a
  numerical search (421 candidate points, pairs plus hill-climbing), certified for pairs with
  d_M ≤ 2.2. It is not a proof. The lower bound d_M(o, vertex) = R_c is exact because D is
  Dirichlet at o. Every point of M is within about 1.903 of every other, so the nearest image of
  any light is within 1.903 of any shading point.

**Image counts N(R) = #{γ : d(o,γo) ≤ R}** [checked-num count]. Exact, from 1,026,167 elements
enumerated to radius 7.903 by BFS:

| R | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| N(R) | 1 | 13 | 73 | 465 | 3045 | 22977 |
| π(sinh 2R − 2R)/vol(M) | 0.5 | 6.5 | 54.9 | 415.9 | 3086.7 | 22824.8 |

N(R) grows like (π/2V)·e^{2R}, about ×7.4 per unit of R. The ratio of N(R) to the volume formula
is 1.007 at R = 6. The enumeration size itself, 1,026,167 against a predicted 1.027e6 at 7.903,
also agrees.

**Why the image sum is occlusion-limited** [math, cross-checked roughly against the table]: a
sphere light of radius ρ at distance d subtends about π sinh²ρ / sinh²d, and the shell
[d, d+1] holds dN ≈ (4π sinh²d / V)·dd images. So **each unit shell contributes about the same
total solid angle, 4π² sinh²ρ / V**, about 0.33 sr for ρ = 0.3. The shell counts give 0.32 at
d ≈ 5.6.

Consequences:
- **In vacuum, the direct-light sum over images grows linearly in R and never converges**
  before the sky saturates. Every geodesic eventually hits some image ([mem]: ergodicity of the
  geodesic flow). Lighting in SW is therefore determined by occlusion and by far images in
  aggregate, not by a few near images.
- **Delta lights cannot be made correct**: a truncated image sum has no limit to converge to,
  and no BSDF fallback exists. Use small emitting spheres instead. This confirms the survey's
  ban for H³ and qualifies the skeptic's narrowing: the narrowing to finite Γ is right, and for
  H³ the ban stands.
- **Mean free path (Santaló)** [math, mem for the theorem; the face version is checked above]:
  λ = 4·vol(M)/area(all surfaces in M). Face crossings per segment are about λ/0.96.
  - One sphere of radius 0.3: λ ≈ 39, about 40 teleports per segment, and the far clip would
    truncate a lot.
  - A central sphere of radius 1 (area 17.3): λ ≈ 2.6.
  - **Scene-design rule:** keep the total surface area in M at 15 or more if a segment should
    cost about 3 crossings.
  - This sets both the cost and how small the far-clip truncation is.

---

## 5. What rendering SW needs: a simple plan (thought through, not checked unless labeled)

Prerequisite: H³ step 2 of curved-spaces-design.md (the hyperboloid model, mat4 isometries, and
the H³ ambient bodies).

1. **Space data.** 12 normals (vec4) and 12 pairings (mat4), rounded once to float32, as `const`
   arrays in the generated GLSL: 240 floats. Section 1 gives exact values. Objects start strictly
   inside D, with a margin far above the 1e-5 drift. Ghost copies come later.
2. **The walk.** The section 2 loop around the in-cell scene intersection: intersect inside D up
   to the exit t, else teleport and continue. It has a declared crossing cap and a declared far
   clip R_clip on accumulated t. Renormalization is part of the loop.
3. **NEE membership without group elements.** This is the simplest correct choice, and it
   avoids the skeptic's word-length trap.
   - **Option 1, the minimal milestone.** NEE samples only the in-cell image (S = {1}). A BSDF
     hit is in S **iff it made zero face crossings since the vertex**. This is exact [math]:
     D is convex, and a geodesic that leaves a convex set never re-enters it, so any crossing
     means γ ≠ 1. Membership is a bool, with no tables. Every other image is left to BSDF
     sampling with weight 1. That is unbiased but noisy when x is near ∂D.
   - **Option 2, ball membership.** NEE covers {(γ,y) : d(x,γy) ≤ R_S}. Because H³ geodesics
     are unique, a BSDF hit at accumulated length t is in that set **iff t ≤ R_S** [math].
     - NEE picks γ uniformly from a candidate list of images within R_S + ρ_L (plus a margin)
       of x. A sample with d > R_S contributes 0.
     - p_sel = 1/|set(x)| is computed once at the vertex and reused for the next bounce's MIS
       weight. The hit image is automatically in the set, since d(x,γc_L) ≤ t + ρ_L.
     - The candidate list is a const table of image centers sorted by d(o,γc_L), with
       break-early. Its length is about N(R_c + R_S + ρ_L + d(o,c_L)), roughly 930 for R_S = 2,
       ρ_L = 0.5 and the light at o; the per-vertex loop finds about N(2.5) in the set, somewhere between N(2) = 13 and N(3) = 73 (an interpolation, not measured).
     - Residual: NEE decides with d(x,γy) and BSDF with t. They agree to about 1e-4 (item 3.2),
       which leaves a sliver of about 1e-4 relative in the R_S shell. It is tiny, but it must be
       declared, or made exact by computing both sides from the same function.
   - **Option 3, variance (later).** p_sel ∝ w(d(x,γc_L)). At a BSDF hit, d(x,γc_L) follows
     from the hyperbolic law of cosines with local data only: t, a = d(y_loc,c_L), and the
     angle at the hit between −v_hit and the direction to c_L. γ is still not needed.
4. **MIS pdf from accumulated t:** p_ω = p_A · sinh² t / |cos θ_y| (the H³ exp-map Jacobian), with
   cos θ_y taken in the hit cell's local frame [math]. This is the skeptic's suggestion, and it
   needs no cellBoost.
5. **Lights:** area and volume emitters only. No delta lights, environment or directional light
   (section 4).
6. **Far clip** as a declared measurement field. The bias is at most L_max · P(segment > R_clip).
   Design scenes by the λ rule so the clip rarely binds, and count clipped segments in a witness.
7. **Media.** A homogeneous medium filling M uses e^{−σ t_acc}, which is trivial. A heterogeneous
   medium needs a Γ-invariant density evaluated in local coordinates, and tracking must treat
   each face crossing as a null event: the skeptic's media correction holds. Modeling the
   teleport as a null-interface crossing would reuse the declared `maxNullCrossings` budget.
   That is a design question for the owner, not checked.

**Witnesses that can detect a wrong pairing** (the furnace and uniform-medium witnesses cannot):
- **Orbit picture.** Put an asymmetric emitter (or one with object IDs) in D and render primary
  visibility only. Compare pixel by pixel with a float64 TS twin of the section 2 walk on the
  same camera rays. A wrong twist (for example 1/10 instead of 3/10) changes which image each
  pixel sees beyond distance 2r_in. The twin is `step()` in sw.ts.
- **pt = pt-nee = pt-mis** in SW detects membership and MIS errors.
- The crystal-unrolling cross-check does **not** transfer to H³ for multi-bounce paths: radius
  N·R gives about e^{2NR} cells, and N(7.9) is already 1e6. It also needs an H³ TLAS, which does
  not exist. It is usable only for direct visibility, where the TS twin is simpler.

## 6. Open questions / not done

- GLSL measurement of drift, cap hits and zero-length runs on SwiftShader and on the M2. Only the
  Math.fround simulation was done here.
- The diameter is from a search, not a proof.
- The Q(√5) structure was checked numerically (small-integer search to 1e-9), not proved.
- The vol(M) value is from memory (Monte Carlo agrees to 0.7σ).
- Ergodicity, exponential tails of free paths and Santaló's formula in H³ are [mem].
- Options 2 and 3 are thought through, not checked. They need a TS χ²/pdf twin (partition MIS
  with t-based membership) before any plan relies on them.
