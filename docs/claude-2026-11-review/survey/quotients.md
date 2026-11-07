# Light transport in closed quotient manifolds M = X/Γ: research notes

Scope: can this WebGL2 unidirectional path tracer (NEE + MIS) render quotient manifolds of
X ∈ {E³, S³, H³, H²×R} reliably and efficiently? This is research for a plan. No repository
was edited.

Labels used on every claim:
- **[read]**: read in source (file:line, or a URL fetched in this session).
- **[reasoned]**: from memory or my own reasoning, not checked. A recommendation that rests
  on one is "thought through, not checked".

---

## 0. Summary and verdict

**Verdict: feasible in WebGL2 for compact (closed) quotients of E³, S³, H³ and H²×R, but only
with three restrictions.** Emitters must be area or volume emitters (no delta lights). There
can be no environment or directional light. And NEE samples only a fixed, computable set of
light images, while BSDF sampling covers every other image under MIS. Nothing needs compute
shaders, recursion or WebGPU. Per-ray cost is bounded by (far clip ÷ cell size) cell crossings,
and each crossing is a closed-form face test plus a scene intersection clipped to the cell.
Every piece except E³ quotients depends on building the curved ambient spaces first.

**What I would note and skip for now:**
- **Point, spot and other delta lights summed over images in H³ quotients.** The number of
  images grows like e^{2R}, and BSDF sampling cannot pick up the images that NEE leaves out.
- **Cusped (finite-volume, non-compact) hyperbolic manifolds without a truncating surface.**
  Cells shrink exponentially up the cusp, so per-ray cost is unbounded.
- **Non-orientable quotients** (glide reflections, such as "Klein bottle × S¹"). The project's
  placements and frames assume orientation is preserved.

**Minimal first milestone:** the cubical 3-torus E³/Z³. It needs no curved-space work. See §8.

The key correctness idea, the **"partition MIS" rule** of §2.3, is thought through, not checked.
In a quotient, a light at y is reached from x along countably many geodesics, one for each
group element γ (two for each γ in S³). NEE needs to sample only a subset S(x) of those
geodesics that is a deterministic, computable function of x. A BSDF ray that hits a light
image γ·L can tell whether γ ∈ S(x). If it is not, NEE's pdf for that image is 0, so the MIS
weight of the BSDF sample is 1. That keeps the estimator unbiased for any non-delta light,
whatever subset is chosen. The same rule applies to the two arcs in S³, and possibly to
multiple images around black holes (§2.5).

---

## 1. What the existing renderer (thurston-rebuild) does

### 1.1 Teleportation [read]

- A `TeleportationSet` is a list of (test, group element, inverse) triples. It is "implicitly a
  set of generators of a discrete subgroup and a fundamental domain"
  (`/Users/stevetrettel/Code/thurston-rebuild/src/core/teleportations/TeleportationSet.js:30-37`).
  The order matters.
- In the GLSL, `teleport()` runs every face test. At the first face whose test says the point
  is outside D, it rewrites the vector with that face's element and returns. So **one teleport
  per call** (`src/core/teleportations/shaders/teleport.glsl.mustache:8-18`).
- `RelVector = (local, cellBoost, invCellBoost)`: a point and direction in D, plus the
  accumulated group element. `rewrite` applies `elt` to the local vector and multiplies
  `cellBoost` by `inv` (`src/core/teleportations/shaders/relative.glsl:14-37, 195-202`).
- The path tracer's march loop does one thing per iteration: teleport if needed, otherwise
  march by the SDF distance. After each teleport it restarts the march from the new local
  vector (`localV0 = localV`), and it stops at `camera.maxDist`
  (`src/core/renderers/shaders/pathTracer/raymarch.glsl:145-209`). The teleports share the
  `camera.maxSteps` budget with the march steps (lines 162-209).
- **Creeping:** the march step is shortened so the ray stops just past the boundary
  (`creepingDist`, `teleport.glsl.mustache:31-50`). Without a closed form this is a binary
  search of up to 100 iterations (`creeping.glsl.mustache:7-26`). The 3-torus has closed-form
  creep functions, `aux0/aux1 + offset`
  (`src/geometries/euc/groups/freeAbelian/set.js:16-25`).
- Seifert–Weber face tests are linear in hyperboloid coordinates, `dot(p.coords, normal) > 0`,
  where each normal comes from a face center in the Klein model. The pairing is a translation
  of length 2·halfWidth composed with a 3π/5 rotation
  (`src/geometries/hyp/groups/seifert-weber/set.js:25-91`).
- **"Nearest neighbors":** the local SDF is also evaluated on the vector rewritten by each
  listed neighbor element, so objects that straddle a face are found
  (`src/core/renderers/shaders/pathTracer/scenes.glsl.mustache:46-74`).
- **Precision:** H³ `flow` renormalizes point and direction after each step
  (`src/geometries/hyp/geometry/shaders/part2.glsl:78-85`). `Isometry reduceError` is
  disabled, and a comment says Gram–Schmidt "makes everything worse" when boost entries are
  large (`src/geometries/hyp/geometry/shaders/part1.glsl:43-73`).

### 1.2 Lights in quotients [read]

- A material loops over `maxDirs` directions per light
  (`src/commons/materials/phong/shaders/render.glsl.mustache:10-18`).
- The **local** point lights in E³ and H³ return **one** direction: toward the light's
  coordinates in the *current cell*, which need not be the nearest image
  (`src/geometries/hyp/lights/localPointLight/shaders/struct.glsl:14-24`;
  `src/geometries/euc/lights/localPointLight/shaders/struct.glsl:14-25`, `super(1)`).
- The S³ local point light returns **two** directions: the minor arc, and the negated
  direction with intensity at distance 2π − d (the major arc)
  (`src/geometries/sph/lights/localPointLight/shaders/struct.glsl:28-45`, `super(2)`).
- **The thurston-rebuild path tracer has no NEE.** Its march does brute-force random
  scattering (`raymarch.glsl:112-141, 257-268`). I found no shadow code in `core/`,
  `commons/`, `geometries/hyp` or `geometries/euc` (grep for "shadow" returned nothing). So
  there is no prior art for NEE in quotients in the owner's own code.

### 1.3 The paper (Coulon, Matsumoto, Segerman, Trettel, "Ray-marching Thurston geometries", arXiv:2010.15801) [read, via https://arxiv.org/html/2010.15801]

- §4.1: quotients are handled through a fundamental domain. Teleporting moves the ray back
  into D with face-pairing isometries. Remark 4.1: working in D keeps coordinates bounded,
  and they see "less noise in images".
- §2.4.1: in H³, H²×E, Sol and SL̃₂, "coordinates of points grow exponentially with distance…
  floating point numbers quickly lose precision".
- §4.2.1: creeping "produces the correct pictures as long as all objects in the scene are
  contained within the domain D". §4.2.2: nearest-neighbor SDFs (A = {id} ∪ {γᵢ^±}) fix most
  artifacts, but "even the combination of both strategies can produce errors in some
  circumstances."
- §5.8, lighting in quotients: a light in X/Γ is the Γ-equivariant union of lights in X,
  ℒ^{X/Γ}_p(q) = ⋃_γ ℒ^X_p(γq). "For all but spherical manifolds and orbifolds, we must
  approximate the lighting by computing only for those paths with significant intensity."
  Figure 5.9 compares lighting "from within D and its eight neighbors" with lighting "from
  all 24 cells" for the binary tetrahedral quotient of S³. They say "considering only the
  directions from lights within D" is not enough. In positive curvature, which translates to
  include "depends on both the geometry and the scene", and they have only "a heuristic
  understanding" of it.

**Consequence for this project [reasoned].** The earlier work *truncates the set of light
images* as a visual approximation. That is a bias, and this project would have to declare it.
Section 2 shows how to avoid that bias for non-delta lights.

---

## 2. Question 1: NEE when a light has infinitely many images

### 2.1 Setting [reasoned]

The scene lives in M = X/Γ. Lift a shading point x into D. A light L in M lifts to the images
γ·L̃ in X, for γ ∈ Γ. For E³, H³ and H²×R, any two points of X are joined by exactly one
geodesic, so the geodesics from x to a point of L in M correspond one-to-one with Γ. In S³,
each image gives two geodesics shorter than 2π: the minor arc of length d and the major arc
of length 2π − d.

Longer geodesics in S³ wrap around and pass through x itself. A ray leaving a surface at x
comes back to x after length 2π, arriving from behind the surface, so an opaque surface at x
blocks it. On the light side, the ray meets the emitter at y first. Both arcs are what
thurston-rebuild uses (§1.2).

The direct-lighting integral is a sum over images:

  L_direct(x, ω_o) = Σ_γ ∫_{γL} f · Le · V(x, y) · G_X(x, y) dA(y),

where G_X is the curved-space geometric term. In H³ its denominator is sinh² r, in S³ it is
sin² r, and in E³ it is r². This is a generic curved-space fact, not specific to quotients.

### 2.2 The three unbiased options [reasoned]

**(a) Sum over all images in a ball of radius R.** Unbiased for the R-truncated measurement
(§3.4). The cost is one shadow ray per image, N(R) ≈ vol(B_R)/vol(M):
- E³: (4π/3)R³/V.
- H³: π(sinh 2R − 2R)/V, roughly (π/2)e^{2R}/V.
- H²×R: exponential in the horizontal radius.
- S³/Γ: |Γ| images × 2 arcs, with no truncation.

Most of these images are occluded, so almost all the work is wasted. This is not feasible
beyond a handful of images.

**(b) Sample one image γ with a discrete pdf p(γ | x).** This is a second light-selection
stage after choosing the light. The weight is f·Le·V·G / (p(γ|x) · p_area(y)). It is unbiased
if p(γ|x) > 0 for every image that can contribute.

For MIS, a BSDF ray that hits image γ must be able to recompute p(γ|x). If p depends on x
through a normalization over all images, that normalization costs N(R) distance evaluations
(no shadow rays), which is cheaper than (a) but still N(R). Two pdfs are cheap:
- a fixed table of K group elements, with weights that do not depend on x;
- weights from a closed form over a fixed candidate list.

**(c) Partition MIS. Recommended, thought through, not checked.** Choose a deterministic
finite set S(x) of geodesics, meaning pairs (γ, arc). NEE samples only within S(x), by
method (b). BSDF sampling covers everything. At a BSDF hit on light image γ (and arc), the
NEE pdf is p_sel(γ|x) · p_solidangle(y) if (γ, arc) ∈ S(x), and **0 otherwise**. With the
balance or power heuristic, the BSDF sample's weight is then 1.

The two techniques together give every contributing geodesic a positive total pdf, and the
MIS weights sum to 1 for each geodesic. That is the standard unbiasedness condition for MIS
(Veach's thesis §9.2, from memory). The condition fails exactly when BSDF sampling cannot
hit the light, that is, for **delta lights**. In that case S(x) must contain every
contributing image, which brings back (a) or (b) with a declared truncation.

Candidate choices of S(x), all computable:
- **S₀ = {id}:** the image in the same copy of D as x. This is what thurston-rebuild does
  (§1.2). Membership test: no teleports since the last vertex. It is discontinuous, because
  the in-cell image is not always the nearest, but it is still unbiased under partition MIS.
- **S₁ = {id} ∪ {face-pairing generators and inverses}:** the paper's "translates through
  the faces of D" (§1.3), 2F+1 images. The membership test compares the accumulated group
  element with a K-entry table. In E³ lattices, compare integer vectors exactly. In H³,
  compare matrices with a tolerance; this is safe because distinct elements of a discrete
  group are O(1) apart for short words. Shortcut: if more than (maximum word length in S)
  teleports have happened since the vertex, γ ∉ S.
- **S³ (both arcs):** every S(x) must include **both** arcs of each chosen image. The major
  arc's Jacobian sin²(2π − d) = sin² d equals the minor arc's, so the major arc subtends the
  same solid angle (unless occluded). Leaving it to BSDF sampling would put half the direct
  light on the high-variance technique. The BSDF hit identifies the arc by its length: t < π
  is the minor arc, t > π the major arc.

**Efficiency argument [reasoned].** Images outside S₁ are at distance at least about twice the
inradius. Their solid angle falls off like A/r² in E³ and like 4A·e^{−2r} in H³. In a compact
manifold with obstacles they are mostly occluded (§3). So the variance left to BSDF sampling
is small for E³ and H³. S³ is the exception: |Γ| is finite, the light can be large relative to
the space, and focusing near the antipode is strong. There, S(x) could be all |Γ| images (each
with 2 arcs), chosen by a cheap per-image weight such as a bounding-sphere solid-angle bound.
Selection then costs O(|Γ|) arithmetic, not O(|Γ|) shadow rays.

### 2.3 What MIS needs from the tracer [reasoned]

- The BSDF ray must report **which image it hit**: the accumulated group element since the
  last scattering vertex, and in S³ the arc. thurston-rebuild already keeps this as
  `cellBoost` (`relative.glsl:33-37`). In E³ lattices it is an `ivec3`; otherwise it is a
  mat4, or an index into a small table.
- The light's pdf functions must accept the **image point**. The project's
  `quad_light_pdf(QuadLight l, Point p, Point light_p, Direction wi)` takes `light_p`
  (`src/components/lights/quad/quad.glsl:36`) and converts with
  `pdf = d2 / (l.area * cos_l)` (`quad.glsl:29-30`) [read]. In a quotient, `light_p` would
  be γ·y expressed in x's chart. In curved X, d² becomes the space's Jacobian (sinh², sin²).
  That conversion is the curved-space seam, not specific to quotients.
- A shadow ray is "defined by its DESTINATION, not a distance" (`docs/trace-loop-contract.md:129`)
  [read]. In a quotient the destination is γ·y. On each teleport, apply the same group element
  to the destination, so it stays expressed in the ray's current chart. This fits the
  contract with one change: the destination becomes a relative point.

### 2.4 Estimator equality [reasoned]

pt (BSDF only) sees every image up to the far clip. pt-nee and pt-mis under partition MIS
estimate the same integral **only if NEE and BSDF rays share the same far clip R**. NEE must
never use an image beyond R that a BSDF ray could not reach. If S(x) contains only near
images, this holds automatically. If NEE ever sums distant images (option (a) for delta
lights), the image set must be cut at the same R that clips BSDF segments, or the estimators
converge to different pictures. That would break the measurement/estimator invariant
(CLAUDE.md "Invariants").

### 2.5 Cross-link to black holes [reasoned]

The partition-MIS rule does not depend on why there are several geodesics from x to y. In
Schwarzschild there are primary, secondary and higher-order images. NEE could take the
primary image with a numerically solved two-point geodesic, and BSDF sampling would carry
the rest with weight 1. This works only if a BSDF hit can tell which image it reached, for
example by counting winding about the hole or turning points. It is untested; the black-hole
note should evaluate it separately.

---

## 3. Question 2: convergence, and which truncation is honest

### 3.1 Area emitters: the sum over images converges, bounded by solid angle [reasoned]

From any x, the first-hit directions toward distinct visible light images are disjoint
subsets of the hemisphere. So the direct irradiance is at most π · max Le, however many
images there are.

The "per-shell" count makes this concrete. The images at distance [r, r+dr] number about
4π J(r) dr / V, where J is r², sinh² r or sin² r. Each subtends about A cos θ / J(r). Their
total solid angle is **4π A dr / V in every geometry**, because the Jacobian cancels. Without
occlusion this grows linearly in R and overcounts. With occlusion, only visible images count,
and the solid-angle bound caps the total. So for area lights the "infinite sum" is not a
divergence.

**Error from truncating at R** ≤ max Le × (the solid-angle fraction of directions whose free
flight exceeds R). That is a property of the scene's free-path distribution:

- **Compact H³ quotients (also H²×R horizontally):** [reasoned; from memory, not checked] the
  geodesic flow is Anosov and exponentially mixing, so the measure of geodesics that avoid an
  open obstacle for time t should decay exponentially (the "escape rate" of open systems). The
  error is about e^{−cR}, and R ≈ 10 is plenty. Separately, NEE images beyond about 10 are
  numerically meaningless (§4.2).
- **E³ tori with corridors ("infinite horizon"):** free paths are heavy-tailed. For the
  periodic Lorentz gas, the free path from a uniformly random phase point has infinite mean.
  The Golse survey says "since the expected free path is infinite"; I saw this only in a
  search snippet (https://www.cmls.polytechnique.fr/perso/golse/Surveys/FGIcmp03.pdf). From
  memory, the tails are about C/R from interior points and about C/R² for collision-to-collision
  segments (density R^{−3}). Neither was checked; see Bourgain–Golse–Wennberg 1998,
  https://www.cmls.polytechnique.fr/perso/golse/Articles/BourgainFGWennberg1998.pdf.
  So in an E³ torus with open corridors, far-clip misses decay only polynomially. A ray along
  a corridor crosses about R/L cells before it is clipped. Two fixes exist:
  - **Scene design:** block all corridors ("finite horizon"). One slab still leaves grazing
    directions with P(τ > t) ~ 1/t; three orthogonal slabs give about 1/t³ [reasoned].
  - **An ambient absorbing medium:** a factor e^{−σR}. The project documents an ambient
    medium (`docs/fable-compiler-contracts.md` §2.4) [read in docs; code not checked].
- **S³/Γ:** every geodesic is closed, with length at most 2π. A ray that hits nothing within
  length 2π retraces its path and never hits anything. **A far clip of 2π (or the
  closed-geodesic length) is exact, not a truncation.** Such rays carry zero radiance, because
  a closed manifold has no environment.

### 3.2 A closed manifold has no escape, so it behaves like a closed furnace [reasoned]

With no environment, energy leaves only by absorption. If max albedo ρ_max < 1 (or a medium
absorbs), the Neumann series L = Σ Tⁿ Le converges geometrically, because ‖T‖_∞ ≤ ρ_max. With
ρ = 1 everywhere and an emitter, radiance is infinite, as in an ideal integrating sphere.

Consequences:
- Validation should require albedo < 1 or absorption somewhere on a.e. path. The simplest
  rule is a declared albedo ceiling below 1. For one uniform albedo the condition is exact.
- **`maxBounces` costs more here than in open scenes.** In an open scene many paths escape to
  the environment. In a closed one every path bounces until it is absorbed. The truncation
  removes Σ_{n>N} ρⁿ Le of uniform radiance; for ρ = 0.8 and N = 8 that is 0.8⁹ ≈ 13% of the
  converged value. It is still an honest, declared truncation (CLAUDE.md: "maxBounces: N is
  Σ_{n≤N} TⁿE"). But quotient scenes will want high maxBounces with Russian roulette, which
  is unbiased.
- **This gives an exact witness:** uniform emission Le and uniform albedo ρ on every surface
  of a closed M, every ray hits a surface, so L = Le/(1−ρ), or Σ_{n≤N} ρⁿ Le at maxBounces N.
  The value does not depend on the geometry, so it tests teleport completeness: a leak, a gap
  at a face or a teleport cap that binds all read dark. The scene needs a finite horizon
  (§3.1), or the deficit at the far clip must be bounded.

### 3.3 Delta lights in quotients are ill-posed or expensive [reasoned]

A point light of intensity I contributes I·cos/J(r) per visible image. The image count per
shell is about 4π J(r) dr / V, so the expected contribution per shell is about (4π I / V) ·
P(segment of length r is unoccluded) dr. **Whether this converges depends on the free-path
tail.**
- E³ with corridors and an interior receiver (a medium scattering point): the tail is about
  1/r, so the sum diverges logarithmically.
- E³ surface receiver: a tail of about 1/r², so it converges.
- H³: an exponential tail, so it converges, but enumerating images costs about e^{2R}.

BSDF sampling cannot hit delta lights, so partition MIS does not apply. The only options are:
- **Prohibit delta lights** in quotients. This is the simplest and honest choice, and my
  recommendation.
- Or declare a measurement field "point-light images within radius R_δ" and sum or sample
  that finite set. This is a new entry in the bias ledger.

thurston-rebuild's one-image point light is the second option with R_δ "one cell", and it is
undeclared.

### 3.4 What an honest truncation is [reasoned]

- **The far clip R per geodesic segment** is one measurement field and applies to every ray:
  camera, BSDF, shadow and in-medium segments. It is the same meaning as the project's
  `MAX_DIST` ("the far clip: nothing beyond it is geometry",
  `src/glsl/core/math.glsl:8-11`, value 1000 [read]).

  For quotients the value must be per space. 1000 is meaningless in H³, because coordinates
  overflow (§4.2). It is also wasteful in E³ tori: at 1000/L cells per corridor ray, every
  warp waits on its slowest ray. In S³/Γ, set R = 2π and the clip is exact.
- **The environment and directional lights must be validation errors** in compact quotients
  [reasoned]. There is no infinity. An a.e. ray hits something, so the sky would contribute
  only on a measure-zero set, and in S³ a ray retraces before reaching any "far" region.
  CLAUDE.md says the environment and directional light "are found" at MAX_DIST. In a compact
  quotient that would make the clip an emitter, which would be a false reading of the scene.
- **Non-compact quotients** (T²×R, cusped H³ manifolds): rays can escape to an open end. An
  environment at infinity is meaningful at an open Euclidean end. A cusp is different:
  measure-zero escape, but unbounded cost (§4.3).
- **maxBounces** stays as it is, but the defaults should be revisited for closed scenes
  (§3.2).
- **The teleport cap** (§4.4) must **never** act as a truncation. It is a safety bound, and
  it binds only on a defect. A cap hit must be reported, for example by a debug picture or
  witness counter, and never silently turned into zero radiance. This follows the owner's
  "no guesses" rule.

---

## 4. Question 3: teleportation, precision, and cost per ray in WebGL2

### 4.1 Use exact face crossing, not "march, then test outside" [reasoned]

All four X have **closed-form exit distances** through totally geodesic faces in a projective
model:
- **E³:** t = (c − n·o)/(n·d). thurston-rebuild's torus creep is exactly this
  (`freeAbelian/set.js:16-25`) [read].
- **H³ (hyperboloid):** p(t) = cosh t·o + sinh t·d, and a face is ⟨p, N⟩ = 0 for a spacelike
  N. That gives a cosh t + b sinh t = 0, so tanh t = −a/b (a solution exists only if
  |a/b| < 1). Seifert–Weber faces are already linear functionals of this form
  (`seifert-weber/set.js:62-75`) [read].
- **S³:** p(t) = cos t·o + sin t·d, and a face is a hyperplane through 0 in R⁴, so
  tan t = −a/b.
- **H²×R:** vertical faces use the H² formula with horizontal speed cos φ. Horizontal faces
  (Σ×S¹) are linear in z.

So a ray in D computes t_exit = min over faces of the positive roots, intersects the cell's
objects with t_max = t_exit, and if nothing is hit, applies the face pairing to (point,
direction, destination) and continues. This is analytic, with no creeping and no binary
search. It also fits a BVH, because each cell's query is just a segment query with a bounded
t_max.

Points to handle:
- **Re-entry:** after a teleport the point lies on the paired face (up to rounding). Leave the
  entry face out of the next exit test, or require t > τ_min measured against that face.
- **Edges and vertices:** a ray near an edge passes through all k cells of the edge cycle (5
  for Seifert–Weber, 4 for the cube) within a tiny distance. The entry-face rule prevents
  ping-pong, and the cap catches anything else.
- **Objects that straddle faces:** each cell's object list must include **every copy γ·O that
  intersects D** ("ghost copies"). The CPU computes the list at compile time from bounding
  spheres, by breadth-first search over words up to radius r_O + circumradius(D). This is
  the exact version of the paper's nearest-neighbor SDF trick (§1.3). With complete per-cell
  lists and t_max = t_exit, each hit is found in exactly one cell.
- **Restriction to embedded objects:** an object's bounding radius must stay below the
  injectivity radius at its position. Otherwise it overlaps its own images, and the project's
  "innermost wins" region bookkeeping for interiors (media, dielectrics) breaks. The compiler
  can check this.

### 4.2 Precision [reasoned unless marked]

- **E³:** points stay in D, and each teleport adds a lattice vector. Errors grow linearly
  with the number of teleports, so thousands of teleports are fine.
- **S³:** coordinates are bounded, and the geodesic flow has zero Lyapunov exponent (all
  geodesics are closed), so errors grow linearly. A ray crosses at most about 2π/(2·inradius)
  cells; for the Poincaré dodecahedral space (inradius π/10, from memory) that is about 10.
- **H³ and H²×R:**
  - In D, hyperboloid coordinates are bounded by cosh(circumradius(D)), so they are well
    conditioned (paper Remark 4.1 [read]).
  - The geodesic flow is **chaotic** (Lyapunov exponent 1 in H³). An error ε made after one
    teleport grows to about ε·e^{t} along the ray. With float32 (ε ≈ 6·10⁻⁸) it reaches 10⁻³
    at t ≈ 10 and O(1) at t ≈ 16.6.
  - **Shadowing** (Anosov closing/shadowing lemma, from memory): the computed pseudo-orbit is
    close to a true geodesic with a slightly different start. So camera and BSDF rays look
    right; the error acts like a tiny perturbation of the sampled direction. Thought through,
    not checked numerically.
  - The **real risk is NEE aiming:** a shadow ray to a far image arrives about ε·e^{d} from
    its target, so visibility near the light is wrong. Partition MIS removes the problem,
    because NEE uses only near images (d ≲ 2·circumradius) and BSDF rays never need to reach
    a particular point.
  - Hyperbolic coordinate error grows like ε·exp(d(x, O)) in the hyperboloid and Poincaré
    models, per Yu & De Sa, NeurIPS 2019
    (https://proceedings.neurips.cc/paper/2019/hash/82c2559140b95ccda9c6ca4a8b981f1e-Abstract.html)
    [read: search summary of abstract and slides]. Teleportation is the remedy, the same idea
    as their tiling model.
  - Renormalize point and direction after each teleport: project onto the hyperboloid, then
    make the direction Lorentz-orthogonal and unit length. thurston-rebuild does the point
    and direction part (`part2.glsl:78-85`) [read].
  - Store the pairing matrices exactly once: compute them in float64 on the CPU, upload them
    as float32, and **never** form long products of them on the GPU. An accumulated
    `cellBoost` with large entries is used only for identification (§2.3), and only for
    short words.
- **"Unrolling" instead of teleporting (§5):** H³ points at distance r have coordinates of
  about e^r/2. At r = 7, ε·e^r ≈ 7·10⁻⁵, which is borderline but usable. In the Klein model
  (where geodesics are straight, so a Euclidean BVH works), 1 − |k| ≈ 2e^{−2r} ≈ 1.7·10⁻⁶ at
  r = 7, close to float32 resolution. Unrolling in H³ is limited to R ≲ 6–7.

### 4.3 Cost per ray, and why cusps must be truncated [reasoned]

- Cost per segment ≈ (cells crossed) × (F face tests + one BVH or object query clipped to
  the cell). F is 6 for the cube torus and 12 for the Seifert–Weber and Poincaré dodecahedra.
- **Cells crossed:** in a compact M with obstacles and a finite horizon, a segment crosses
  about (mean free path)/(cell size) cells, typically a few. The worst case is
  R/(2·inradius) plus edge or vertex passages. Warps run at the speed of their slowest ray,
  so the **tail** matters: corridors in E³ tori are expensive, while S³ is bounded by
  2π/(2·inradius).
- **Cusps:** cross-sections shrink like e^{−h} with depth h up a cusp, so the number of
  teleports per unit length grows without bound. thurston-rebuild has cusped examples
  (`src/geometries/hyp/groups/whitehead/set.js`, `m125/set.js` exist [read: file list]; I did
  not check how they bound this). **Required:** an authored truncating surface, such as a
  horospherical wall, which changes nothing in the measurement because it is part of the
  scene.
- **Shadow rays** cross cells the same way. With partition MIS they are short.
- **Restarting the BVH** in each cell costs a root-to-leaf descent per cell. That is cheap
  when the cell's t-range is short and the cell is mostly empty.

### 4.4 How to bound it in WebGL2 [reasoned]

- GLSL ES 3.00 allows loops with non-constant bounds. A compile-time `MAX_TELEPORTS` (one
  `#define` per program, derived from R/inradius and the edge-cycle bound) gives a static
  bound for drivers and for SwiftShader's watchdog.
- When the cap is hit, write a sentinel and count it (§3.4). A witness asserts zero cap hits.
- **Uniform budget:** F face planes (vec4) plus F pairing matrices (mat4) is 5F vec4. For
  F ≤ 30 that is at most 150, below WebGL2's guaranteed minimum `MAX_FRAGMENT_UNIFORM_VECTORS`
  of 224 (from memory). The S-set table (≤ 2F+1 matrices) could go in a data texture.
  Ghost-copy lists go in the existing data textures (instancing).
- **Register pressure:** the ray state gains a mat4 cellBoost in H³, S³ and H²×R, or an ivec3
  in E³ lattices. Alternatively, store a word or index of at most 2 letters, which is enough
  for S-membership, plus a counter.
- **None of this needs compute shaders, atomics or recursion.** There is no feature that
  WebGPU makes "easy" and WebGL2 makes "ridiculously hard". The costs are the same per-ray
  costs a WebGPU tracer would pay. WebGPU's advantage would be wavefront scheduling, which
  avoids paying for the worst ray in each warp. That is an efficiency difference, not a
  feasibility one.

### 4.5 Where teleporting goes in the trace-loop contract [reasoned]

The contract says `Ray` "encodes a geodesic by its initial conditions", and the geodesic flows
via `ambient_geodesic` (`docs/trace-loop-contract.md:60-62`) [read]. A teleport re-expresses
the same geodesic in another chart, so the contract's meaning survives.

Two places to put the teleport loop:
- **(i) Inside `scene_intersect`:** the loop is hidden. The returned `Hit` gains the
  accumulated group element (or index), and `shadow_transmittance` teleports its destination
  point. Transport changes only in NEE image selection and MIS image identification.
- **(ii) As a transport event:** a "face crossing" event like a null-interface crossing. This
  touches the generated walk and the budgets (`maxNullCrossings`), and is more invasive.

I favor (i) as simpler [thought through, not checked]. It changes the locked
compiler↔engine/trace-loop types (`Hit` gains a field), which needs owner discussion
(CLAUDE.md: "Discuss loop and interface structure with the owner before implementing").

Media: homogeneous media are fine, because distances add across faces. Heterogeneous density
fields must be Γ-invariant, which means continuous across paired faces. That is an authoring
check.

---

## 5. An alternative for finite groups: "unrolling" into the cover

**[reasoned; thought through, not checked]**

For **S³/Γ (Γ finite)**, M can be rendered *exactly* as S³ with a Γ-invariant scene: |Γ|
copies of every object and light, and no teleporting at all. Lens space L(p,q) has p copies,
the quaternionic space 8, the binary tetrahedral 24, and the Poincaré dodecahedral space 120.

- The project's instancing (10⁵–10⁶ instances, per-batch TLAS; CLAUDE.md "Built") easily
  covers 120 copies, *provided the placements can be S³ isometries rather than Euclidean
  similarities.* That is needed for S³ anyway.
- Light selection over the |Γ| image lights would be the ordinary roster: power or uniform
  selection. The light tree's Euclidean bounds would not apply in S³.
- The two-arc NEE issue (§2.2) remains. It belongs to S³ itself, not to the quotient, and
  partition MIS handles it.
- The far clip is 2π, which is exact.

This could be the cheapest exact path to spherical quotients **after** S³ exists.

For **E³ and H³** (Γ infinite), unrolling means "the copies within radius R of the origin
cell". That changes the scene: rays starting near the edge of the patch see nothing beyond
it. It is *not* the same as a far clip per segment, so it is not an honest truncation of M.
It is an honest rendering of a *different* scene, a finite crystal of copies. Weeks' Curved
Spaces is described as a "flight simulator for multiconnected universes" (search result
summary, https://geometrygames.org) [read: summary only]. I recall that it draws tiled copies
with fog hiding the cutoff [memory, not verified]. A crystal in E³ can be built **today** with
the existing instance clouds and no new code. It is useful as a visual cross-check of a
teleport tracer for short paths, but it cannot serve as an exact witness.

---

## 6. Question 4: what the scene description and authoring need

**[reasoned unless marked]**

1. **The space:** an ambient X (an existing or future `ambient/` occupant), the group Γ, and a
   **fundamental domain D**. D is a convex polyhedron with totally geodesic faces, given as
   linear functionals on model coordinates (vec4 for H³, S³ and H²×R; plane plus offset in
   E³). Each face i has a pairing generator g_i ∈ Isom(X) (4×4 matrix) with D ∩ g_i D = face i.
2. **Sources of the data:**
   - **H³:** SnapPy's `DirichletDomain` gives `face_list()`, `pairing_matrices()` (O(3,1)),
     `vertex_list()` (Klein model), `in_radius()`, `out_radius()` and `spine_radius()`
     (https://www.math.uic.edu/t3m/SnapPy/additional_classes.html) [read]. An offline
     exporter to JSON is natural, and it keeps the project from computing Dirichlet domains
     in TS.
   - **E³:** the ten closed flat 3-manifolds have known generators. The first milestone
     should cover only the six orientable ones, starting with the cube torus.
   - **S³:** lens spaces, the quaternionic space and the Poincaré dodecahedral space have
     known generators.
   - **H²×R:** genus-g surface × S¹, from a regular 4g-gon. thurston-rebuild already has
     `h2e/groups/genus2`, `quotientGenus2` and others (file list [read]).
3. **Compile-time validation** (declared facts, no guessing):
   - g_i maps face i onto its paired face (vertex sets match).
   - Edge cycles satisfy the Poincaré polyhedron condition (angle sum 2π, so a manifold and
     not an orbifold).
   - Orientability, if the first version is orientable only.
   - Every object is embedded (§4.1).
   - Albedo < 1 or an absorber (§3.2).
   - No delta lights, environment or directional light (§3.3, §3.4).
   - Heterogeneous media are Γ-invariant.
4. **Objects:** authored in D (or in X, and reduced to D by the compiler). The compiler
   computes **ghost copies** {γ : γO ∩ D ≠ ∅} and emits them as instances with
   **X-isometry placements**. The placement contract "Euclidean similarities"
   (docs/fable-transforms.md) has to be generalized for curved spaces anyway.
5. **Lights:** emitters are objects. The compiler also emits the **S-set table**: group
   elements as matrices or integer vectors, and a selection-weight rule that is a closed form
   in x. In S³ this includes arc handling.
6. **Camera and App:** the camera pose lives in D. When the user moves the camera across a
   face, the App teleports the pose (paper §4.1 [read]). That is App-layer work, outside the
   compiler.
7. **Measurement fields:** a far clip R per space (2π in spherical spaces is exact), and
   possibly default maxBounces and Russian roulette settings for closed scenes.
8. **Non-orientable groups (later):** reflections flip mesh winding and frame handedness on
   ghost copies. Defer them.

---

## 7. Comparison of approaches (summary)

| Approach | Unbiased? | WebGL2 cost | Main risk |
|---|---|---|---|
| A. Exact face-crossing teleports + ghost copies + partition-MIS NEE | Yes, for area and volume emitters, up to the declared per-segment far clip R (exact in S³ with R = 2π) | Cells crossed × (F face tests + clipped scene query). Bounded by R/inradius. Mat4 state | Heavy tails in E³ corridors. Chaos in H³ (shadowing argument not checked). Changes the `Hit` contract |
| B. Unroll finite Γ (S³ quotients) into |Γ| instances | Yes, exact | One S³ trace, |Γ| instances (≤ 120), ordinary light selection | Needs S³ ambient and S³-isometry placements first; light tree not usable |
| B'. Unroll infinite Γ (E³, H³) into a radius-R patch | Exact for a *different scene* (a finite crystal), not for M | Instancing, about R³ copies (E³) or about e^{2R} copies (H³, R ≤ 6–7 for precision) | Patch-edge artifacts; it is not a truncation of M. Cross-check only |
| C1. NEE summing all images in a ball | Yes, up to R | N(R) shadow rays per NEE; exponential in H³ | Infeasible beyond a few images |
| C2. NEE sampling one image from a fixed table + partition MIS | Yes (area emitters) | One shadow ray; O(K) arithmetic | Variance from images left to BSDF sampling; small in E³ and H³, so include both arcs in S³ |
| C3. thurston-rebuild style (one image, no MIS correction) | **No** (undeclared bias) | Cheapest | Wrong picture; do not use |
| D. Delta lights in quotients | Only with a declared image-radius truncation | C1 or C2 cost with no BSDF fallback | New bias-ledger entry; logarithmic divergence possible in E³ with corridors |

---

## 8. Minimal first milestone (proposal, thought through, not checked)

**The cubical 3-torus E³/Z³.** Of the four ambient spaces, only Euclidean exists today
(`src/components/ambient/README.md:24`) [read].

- D is the unit cube, F = 6. Face exits are closed form. The accumulated group element is an
  `ivec3`, compared exactly.
- **Objects strictly inside D**, validated to keep a margin from the faces. That means no
  ghost copies in the first step. Ghost copies come in step 2.
- **Area and emissive-object lights only.** Delta lights, the environment and directional
  lights are validation errors.
- **NEE on S₁** (the in-cell image plus the 6 face neighbors), with partition MIS.
- A **declared far clip R** per segment in units of the cube, with a `MAX_TELEPORTS` safety
  cap whose hits are counted.
- **Teleport inside `scene_intersect`**, with `Hit` carrying the `ivec3`. This needs the owner
  to agree to the contract change first.
- **Witnesses** (derived values first):
  1. pt = pt-nee = pt-mis converge to the same picture in a torus scene. This tests the
     image-pdf bookkeeping and the shared far clip.
  2. An empty torus filled with an ambient emitting, absorbing medium (σ_a, Le). The radiance
     along any ray is exactly (Le/σ_a)(1 − e^{−σ_a R}). It tests continuity of distance across
     faces and the cap.
  3. A closed furnace L = Σ_{n≤N} ρⁿ Le, using a finite-horizon geometry such as three
     orthogonal slabs that block every corridor. It tests for leaks.
  4. Zero cap hits.

**Next steps, in order:**
- Ghost copies (objects that cross faces).
- Non-cubic flat manifolds (orientable).
- H³ (Seifert–Weber from thurston-rebuild data or a SnapPy export) after H³ exists.
- S³ quotients by unrolling (approach B) after S³ exists.
- H²×R quotients.

Deferred: cusps (only with truncating surfaces), non-orientable quotients, delta lights.

This could run as a side project after the curved-space ambients, as the owner suggested
(decisions.md item 5).

---

## 9. Open questions

1. Will the owner accept the **partition-MIS rule** (NEE covers a computable subset S(x) of
   geodesics, and BSDF covers the rest with weight 1)? It is standard MIS bookkeeping, but it
   is thought through, not checked. It needs a χ² or pdf-consistency twin test and witness 1
   before anything relies on it.
2. Should **delta lights** be banned in quotients (my recommendation), or allowed with a
   declared image-radius truncation as a new bias-ledger field?
3. Should the **far clip** be one measurement field per space with a validated value (2π in
   S³/Γ is exact), replacing the fixed `MAX_DIST` = 1000 in non-Euclidean programs?
4. Should teleporting go **inside `scene_intersect`** (`Hit` gains a group-element field, a
   change to the locked types) or become a transport event?
5. The **H³ chaos and shadowing argument** (camera and BSDF rays are fine; far NEE aim is
   not) is reasoning only. It needs a numerical check: compare a float32 GLSL ray with a
   float64 TS twin over 20–30 Seifert–Weber teleports.
6. The **free-path tails in E³ tori** (≈1/R from interior points, ≈1/R² for
   collision-to-collision segments) are from memory, not verified against
   Bourgain–Golse–Wennberg or Szász–Varjú. They matter only for choosing R and designing the
   witness scene.
7. **Exponential avoidance in compact H³ quotients** is from memory (mixing / escape rates)
   and needs a source.
8. Does partition MIS carry over to **Schwarzschild image orders**? That belongs to the
   black-hole note, and needs a way for a BSDF ray to identify which image it reached.

## Sources

- thurston-rebuild source (`/Users/stevetrettel/Code/thurston-rebuild/src/...`), file:line as
  cited above.
- Coulon, Matsumoto, Segerman, Trettel, "Ray-marching Thurston geometries",
  https://arxiv.org/abs/2010.15801 (HTML: https://arxiv.org/html/2010.15801), §§2.4, 4.1,
  4.2.1, 4.2.2, 5.8.
- SnapPy `DirichletDomain` API: https://www.math.uic.edu/t3m/SnapPy/additional_classes.html
- Yu & De Sa, "Numerically Accurate Hyperbolic Embeddings Using Tiling-Based Models",
  NeurIPS 2019:
  https://proceedings.neurips.cc/paper/2019/hash/82c2559140b95ccda9c6ca4a8b981f1e-Abstract.html
- Golse survey on free-path lengths (snippet only):
  https://www.cmls.polytechnique.fr/perso/golse/Surveys/FGIcmp03.pdf ; Bourgain–Golse–Wennberg
  1998: https://www.cmls.polytechnique.fr/perso/golse/Articles/BourgainFGWennberg1998.pdf
- Weeks, "Real-time rendering in curved spaces", IEEE CG&A 22(6):90–99, 2002,
  doi:10.1109/MCG.2002.1046633 (not read; metadata only). Curved Spaces: https://geometrygames.org
- Project: `src/components/ambient/README.md`, `src/components/ambient/euclidean/euclidean.glsl`,
  `src/components/lights/quad/quad.glsl:29-36`, `src/glsl/core/math.glsl:8-11`,
  `docs/trace-loop-contract.md:60-62,129`, `docs/claude-2026-11-review/decisions.md` item 5.
