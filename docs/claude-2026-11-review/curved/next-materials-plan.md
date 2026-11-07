# Curved spaces, next tier: the other materials and the sphere light (H³ and S³)

Status: model-written plan, 2026-11-07. Reviewed once by an independent agent (§5 lists the findings
and how they were applied). The owner has not seen it; choices he has not made are
marked *provisional* with how to undo them. Design authority: [../curved-spaces-design.md](../curved-spaces-design.md)
§2.5 and §7.

## 1. Problem, with evidence

The support table (src/components/ambient/support.md) lists only `lambert` among the materials in
`hyperbolic` and `spherical`, and the sphere light only in `euclidean`. Read in the source:

- **mirror, dielectric, ggx, rough_dielectric** already write every world-direction operation
  through the seam: `ambient_dot` for cosines and `ambient_normalize` for the reflected and
  refracted directions (mirror.glsl:26-30, dielectric.glsl:25-41); the microfacet models work in
  the local frame through `microfacet_to_local` / `microfacet_from_local` (core/microfacet.glsl:24-29,
  ambient_dot against the frame vectors and ambient_normalize at `f.p`), and their raw `dot`,
  `normalize`, `reflect` act on local vec3 coordinates, where the metric is the Euclidean one by
  construction (the frame is orthonormal in the metric — `ambient_frame`). IORs come from the
  hit's regions (`ior_of(region, p, wl)`), which do not depend on the space. Their descriptors
  list only a `euclidean` body (e.g. ggx.ts:9), so the gate rejects them.
- **checker** reads `hit.uv`; no curved shape has a uv chart (`curvedObjectArm` throws on a
  uv-reading program, intersection.ts:834; the limitation row "materials that read uv or hold GLSL
  expressions" rejects it first). *Measured by reading, not built.*
- **the sphere light** has only the Euclidean cone sampler (lights/sphere/sphere.glsl), which uses
  `vec3` arithmetic and `build_basis`.

What the transport does around a material in a curved program (to be confirmed by reading the
generated GLSL of one H³ and one S³ scene that contains every material, before any witness is
written): the generated interaction seams, the eta-scale bookkeeping, `material_has_nondelta_lobes`,
the region classification in `scene_intersect` (probe along `ambient_geodesic(hit.p, hit.ng,
EPS_INTERFACE)`, arrival direction by `ambient_flow`), and `ray_spawn` (offset along the geodesic
in the direction `hit.ng·side`, so transmission spawns on the far side).

## 2. The change and its boundaries

1. **Materials.** List the existing file of mirror, dielectric, ggx and rough_dielectric under
   `hyperbolic` and `spherical` (one body, one origin, as lambert does). No GLSL change is
   expected; if reading the generated GLSL finds a Euclidean operation on the material path, it is
   fixed through the seam and recorded here.
2. **checker stays unsupported** in curved spaces (no uv chart). Unchanged limitation row.
3. **The sphere light** gets `sphere_hyperbolic.glsl` and `sphere_spherical.glsl` (curved bodies
   take the `LightQuery` and, for the pdf, `wo`, as the disk's do). The light's `center` row becomes
   g·o and its backing sphere region is placed by the same isometry (compiler/plan/curved.ts —
   already generic over the kind's point row; nothing new on the CPU side).
   - **H³.** From q.p at distance d > R from the center, the ball subtends a cone about
     u = direction_to(q.p, c) with sin α = sinh R / sinh d. Sample it uniformly (the Euclidean
     construction: w = 1 − cos θ = ξ₁(1 − cos α), 1 − cos α = sin²α/(1 + cos α), in
     `ambient_frame(q.p, u)`); pdf 1/(2π(1 − cos α)). Distance to the near side along the sampled
     direction: cosh dist(γ(t), c) = cosh d cosh t − sinh d cos θ sinh t = cosh R gives the near
     root e^t = (cosh d + sinh d cos θ)/(cosh R + √(sinh²R − sinh²d sin²θ)) (cancellation-free:
     both terms positive). This is the sphere body's root with a = cosh d, b = −sinh d cos θ,
     k = sinh²d sin²θ, so the body's root moves into one function `sphere_root(a, b, k, R, inside)`
     in sphere_hyperbolic.glsl (and its S³ counterpart) that both call: the light's distance is the
     root rays find (one answer). The sphere body file is always linked with the light (its backing
     region is a sphere). `sphere_light_pdf` returns the same density (it depends on q.p only).
     q.p inside the ball: pdf 0 in both, as in E³ (the backing region is opaque, so no surface
     point is inside it).
   - **S³.** Every great circle through q.p also passes −q.p. With d the short distance to c:
     - R < d < π − R: the ball is seen in two disjoint cones, the forward one about u (half-angle
       α, sin α = sin R/ sin d < 1) and its negation (geodesics that leave away from c and reach
       the ball's far side after passing −q.p).
     - d ≥ π − R: −q.p lies in the ball, every geodesic from q.p meets it: the forward cone is the
       hemisphere about u (sin²α clamped to 1).
     - d ≤ R: inside, pdf 0 (as in H³ and E³).
     Sample ω in the forward cone as in H³; choose the route with `spherical_light_arc(q, ω, p_arc)`
     (one-sided receiver: take −ω exactly when ω is below n; otherwise ½); wi = ω or −ω; pdf =
     p_arc/(2π(1 − cos α)). Along ω the ball's crossings are φ ∓ β with φ = atan(sin d cos θ,
     cos d), β = atan(√(sin²R − sin²d sin²θ), cos R) (the sphere body's construction): the
     distance is φ − β along ω and 2π − (φ + β) along −ω (the far root's point reached the other
     way round) — both are `sphere_root`'s entry root on the chosen route, with b = ± sin d cos θ
     (atan(−b, a) = −φ). The forward and backward cones are disjoint (α ≤ π/2), so each upper-hemisphere
     direction of a one-sided receiver is produced by exactly one ω; the density is the same on
     both, and `sphere_light_pdf` = `spherical_light_arc_probability(q)`/(2π(1 − cos α)).
   - **Selection power** keeps the Euclidean formula π·4πR²·Le (*provisional*, as the disk light
     does: any positive selection weight is unbiased, and selection and pdf read the same
     number; undo: a per-space power function).
4. **Emissive spheres sampled as lights** stay off in curved spaces (design choice 5): an emissive
   object's light values come from its folded parameters, and a curved object keeps its center in
   its isometry, which can be {param}-driven — the sampler would need the placement (or a driven
   light row). Not "falling out cleanly"; unchanged.
5. **Not changed:** any Euclidean GLSL or Euclidean code path (verified by digest), the light tree
   (Euclidean only), quads, other lights.

## 3. Verification, written first

### Twins (fp64, vitest: tests/witnesses/scenes/curvedMaterialTwins.ts, checked by tests/witnesses/curvedMaterialTwins.test.ts)

- **Specular tracer** (shared by both spaces through a small per-space
  geometry: form, flow, ball and plane roots): a camera ray in a closed box of six planes, a mirror
  ball and a glass ball; the expected value of a path is computed exactly by recursion over the
  delta choices (mirror: Schlick F·trace(reflected); glass: F·trace(reflected) + (1 − F)·η²·
  trace(refracted), η = n_i/n_t, exact dielectric Fresnel), to the scene's maxBounces. The
  formulas are those of mirror.glsl, dielectric.glsl and math.glsl. Checks: the box is closed
  (every ray hits a wall), with every wall emitting 1 the mirror reads its Schlick F and the glass
  ball 1 − P(truncation) (energy), the ball root against marching the ray.
- **GGX receiver** (both spaces): L = ∫ Le f_ggx(wi, wo) cos_x cos_y / A(r) dA over the disk
  light (the existing quadrature in geodesic polar coordinates, with f from ggx.test.ts's twin
  formulas evaluated on metric invariants: n·wi, n·wo, n·h, wo·h); S³ sums both arcs. Checked
  against an independent estimate: cosine-sampled rays from x intersected with the light's plane
  and disk (no area density), weighted by f·π.
- **Sphere light** (both spaces): E = Le·∫ over the forward cap of g(n·ω) dω, g = max(0,·) in H³ and
  |·| in S³ (the backward cone adds max(0, −n·ω)); where the cap is above the horizon this is the
  projected cap Le·π sin²α·|cos θ_c|, which the test checks. Also checked against an independent
  Monte Carlo: cosine-sampled rays from x tested against the ball (hit or miss, either arc in S³).

### Witnesses (tests/witnesses/scenes/curvedMaterialWitness.ts, one construction per space)

Window means are the twin's numbers; tolerances are set after the first measured run, at most
about 3× the measured noise.

| witness | scene | estimators | checks | what it catches |
|---|---|---|---|---|
| `h3-specular`, `s3-specular` | a closed box of six walls emitting six colors (albedo 0), a mirror ball (f0 per channel 0.9, 0.5, 0.05 — in blue the angle-dependent Schlick term is about half the signal) and a glass ball (ior 1.5), maxBounces 6 | pt | RGB window mean over each ball = twin | reflected/refracted directions, Schlick and exact Fresnel at metric cosines, the region classification (n_i/n_t), spawn on the far side, the walk inside the glass |
| `h3-ggx`, `s3-ggx` | the h3-disk-light / s3-long-arc receiver, ggx (f0 0.5, roughness 0.5), under a disk light of radius 0.5 at distance 1 in the receiver's mirror direction (S³: the other way, facing away, so only the long arc along the mirror direction reaches it), maxBounces 1 | pt-nee, pt-mis, pt | window mean = twin under each | microfacet frame maps in the metric, the lobe's direction, eval/sample/pdf consistency, the S³ arc rule with a non-lambert receiver |
| `h3-rough-glass`, `s3-rough-glass` | a rough glass ball (roughness 0.6, ior 1.5; see §6): H³ in the h3-medium layout; S³ with a disk light facing the ball and a **sphere light** (radius 0.3 at exp_o(0, 1.1, 0)), maxBounces 8 | pt-nee, pt-mis, pt | nee ≡ mis, pt tripwire | two-lobe eval/pdf/sample in curved frames; the two-sided query (½ arc rule in S³, for the disk and the sphere light) |
| `h3-sphere-light` | lambert receiver under a sphere light (R 0.4 at exp_o(0,1,0)) | pt-nee, pt-mis, pt | window mean = twin | the cone sin α = sinh R/ sinh d, its pdf, the backing region's placement |
| `s3-sphere-light` | lambert receiver above a sphere light that only the backward cone reaches (R 0.4 at exp_o(0,−1,0)) | pt-nee, pt-mis, pt | window mean = twin | the flip rule and the far-side distance (too long: the shadow ray hits the light's own ball) |
| `s3-sphere-light-blocker` | the same plus an opaque ball of radius 0.8 about −o | pt-nee, pt-mis, pt | 0 | a distance that stops short of the ball's far side |
| `s3-sphere-light-antipodal` | the receiver with −x inside a large ball (R 1.3 at exp_o(0, −2.3, 0)) | pt-nee, pt-mis, pt | window = albedo·Le exactly | the clamped cone (hemisphere), flip coverage |

The sphere-light twin integrates Le·g(n·ω) over the forward cap (g = max(0,·) in H³, |·| in S³, which
adds the backward cone), checked against the projected-cap closed form where the cap is above the
horizon and against cosine-sampled hit-or-miss tests on the ball. The twin test also checks that no
camera ray meets a ball before the receiver, that every antipodal-witness window point has d ≥ π − R,
and that every backward-cone geodesic from the window meets the blocker first.

**Mutations** (one per witness, reverted; each one's predicted shift is computed in the twin first
where it can be):
- specular, both spaces: the transport's wo taken as the departure direction (`-s.ray.direction`)
  instead of the arrival direction — curved-specific, meaningful in both spaces; H³ also: Euclidean
  `dot` in mirror.glsl;
- ggx: H³ `dot` in place of `ambient_dot` in microfacet_to_local; S³ a dropped 1/cos_o in ggx_eval;
- rough glass: (1 − F) dropped in rough_dielectric_pdf only (one copy: dropping it in the sample's
  pdf too would keep the MIS weights summing to 1 and prove nothing);
- sphere lights: H³ a Euclidean-style cone (sin α = sinh R/d); S³ no flip; blocker: the distance
  taken as the near root along −ω; antipodal: no clamp.

### Euclidean unchanged

`npm run digest` before and after, `--compare`: no Euclidean scene may differ (the change adds
body keys and new curved files only). If one does, `npm run frames` record/compare.

### Suites

Targeted test files while working; the full `npx vitest run` once at the end (the support table
snapshot regenerates with `-u` and is reviewed). Witnesses: only the new ones plus the existing
curved ones whose code paths changed (none expected).

## 4. Provisional choices (not seen by the owner)

| # | choice | why | undo |
|---|---|---|---|
| P1 | sphere-light selection power stays π·4πR²·Le in curved spaces | selection weights only need to be positive and consistent; the disk light does the same | a per-space power |
| P2 | emissive objects stay unsampled in curved spaces (design choice 5) | a curved emitter's center lives in its (possibly driven) isometry | add a curved emitter path |
| P3 | checker stays Euclidean only | no curved uv chart exists | define charts per curved shape |
| P4 | S³ sphere light: one forward-cone sample plus the arc choice, no second shadow ray | same rule as the disk (design choice 4), unbiased | sample both cones |

## 5. Review (one independent agent) and what changed

The reviewer checked the math by calculation (the H³ near root against bisection, the S³ crossings
against marching, the S³ cases and the flip density by Monte Carlo in seven configurations, the cap
formula) and found no error; it confirmed by reading that the material path in a curved program has
no Euclidean operation. Applied:

1. *A distance that is too short is invisible* (NEE only shadow-tests up to the light point): added
   `s3-sphere-light-blocker` (0). In H³ a too-short distance matters only for an occluder hugging the
   light; not covered (minor, recorded).
2. *The ½ arc rule of the sphere light was untested*: s3-rough-glass now has a sphere light.
3. *f0 0.9 cannot test Schlick*: f0 per channel (0.9, 0.5, 0.05).
4. *Dropping (1 − F) in both pdf copies proves nothing*: the mutation edits rough_dielectric_pdf only.
5. *The S³ specular mutation did not test direction*: added the departure-for-arrival `wo` mutation.
6. *Simpler H³ specular under the procedural sky*: not taken — one twin and one scene serve both
   spaces (S³ has no sky); the twin checks its own 4×4 vs 8×8 convergence instead.
7. *The S³ ggx light (radius 1.2) mostly measured directional albedo*: lights of radius 0.5 in the
   mirror direction, in both spaces; the H³ mutation is the curved one (`dot` in microfacet_to_local).
8. *Share the root with the sphere body*: done (`sphere_root`).
9. *A closed form for every S³ case*: the twin integrates |n·ω| over the forward cap, which covers
   the hemisphere case and straddling caps.
10. *Antipodal placement unstated*: stated, and the twin test checks d ≥ π − R at every window point.
11. *Missing review section*: this section.
12. *Spectral programs* (`color: 'spectral'`) are not gated by space: a curved spectral program with
    these materials compiles, as lambert already does, and no witness covers it. Out of scope here;
    recorded as deferred.
13. *Tangency drift in long specular chains* (wo from ambient_flow is not re-projected; expected
    ~1e-6 per bounce): not measured separately; the specular witnesses (6 events) bound its effect.

## 6. What the build found (deviation, provisional)

**ray_spawn transports the direction.** The first witness run passed the mirror, ggx and sphere-light
checks but found the glass ball 0.1–0.6% dark in H³ and S³ (not in E³: an `e3-specular` control, the
same scene and twin in Euclidean space, passed). Bounce-budget renders of a white-walled variant
(GPU against the twin at maxBounces 1–6) located it: in H³ paths with two internal reflections never
arrived (mb 4 = mb 3 = 0.9982, twin 0.9999), in E³ they did. An fp64 emulation of the generated curved
path showed why: `ray_spawn` moved the origin by hit.eps and kept wi, which is tangent at hit.p and not
at the new origin (off by about eps·cos, 3e-5); a reflected direction inherits the arriving one's error,
so it grows bounce by bounce (6.7e-5, 1.1e-4 after two internal reflections), the curved sphere root —
which assumes a unit tangent ray — then puts the hit more than eps from the surface, and the next spawn
lands outside the ball. A 16× larger eps did not help (measured). Fix: `ray_spawn` returns wi parallel-
transported to the spawned origin (`ambient_parallel_transport`, already in every occupant; the identity
in E³, so Euclidean programs are unchanged — checked by frames compare). In the emulation the tangency
error stays below 1e-16 and the chain T R R R R T exits correctly. *Provisional*; undo: revert ray.glsl
(the glass witnesses then fail).

**Rough glass at roughness 0.6, 1024 spp.** At roughness 0.3 (256 and 1024 spp) the rough-glass
equality failed in both curved spaces (H³ Δmean 2.5%, S³ χ²ᵣ 4.7), and the same H³ layout in E³ failed
it too (χ²ᵣ 3.6 at 1024 spp): firefly-dominated, not curved. At roughness 0.6 all three pass (H³
Δmean 0.18%, χ²ᵣ 0.51; S³ 0.23%, 0.96; E³ 0.10%, 0.86). The S³ χ²ᵣ fell from 6.2 to 4.7 when the
samples quadrupled, which a bias would not do.

**Mutations.** The planned rough-glass mutation, (1 − F) dropped in rough_dielectric_pdf only, moved
nee against mis by 0.2% (H³) and 1.1% (S³), inside the 2% tolerance: it changes only MIS weights of the
transmission lobe, where F is 4–10%. It was replaced by the η² factor dropped in rough_dielectric_eval
(an eval/sample mismatch on the transmission lobe). The planned S³ ggx mutation did not apply on the
first run (a regex miss) and was rerun.

## 7. Review of the finished commits (one independent agent)

The reviewer checked by algebra and fp64 scripts: `sphere_root` is arithmetic-identical to the old
bodies; the sampler inputs (H³ a = cosh d, b = −sinh d cos θ, k = sinh²d sin²θ; S³ a = cos d,
b = ±sin d cos θ) satisfy the root identities; `sphere_root` (outside) against a brute-force march in
1020 cases (H³, S³ both routes, d > π/2, the hemisphere case) agrees to the march step; directions just
outside the cone never meet the ball; both parallel-transport formulas are exact; the twins have no
bug that would let a witness pass for the wrong reason. Applied:

1. *A light distance that is too short was caught only on the S³ flip route* (its mutation
   `0.5 * sphere_root` in the H³ body passes h3-sphere-light): added `h3-sphere-light-blocker`, an
   opaque ball of radius 0.5 about the H³ light's center (0), and showed it fails under that mutation.
   The S³ forward route has no such witness (its forward cone is below the receiver's horizon in
   s3-sphere-light); s3-rough-glass constrains it only partly. Recorded, not built.
2. *The S³ density comment overstated* ("the same at every one of its directions"; below a one-sided
   receiver's horizon the sampler's density is 0): rewritten.
3. *"sin α < 1, so α < π/2"* is not the reason: rewritten (R < π/2 there, and tan α > 0).
4. *A test name* said "above the horizon" for an S³ cap below it: renamed.
