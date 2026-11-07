# Changelog

What was built, fixed, and measured, newest first. This is the project's history; for how the
code works now, read [CLAUDE.md](CLAUDE.md), the docs it points to, and the code itself. When
you finish a batch of work, add a dated entry here — not to CLAUDE.md.

## 2026-11-07 — Seifert–Weber GPU witnesses, a walk counter and a demo (quotients plan Q2.6)

[Plan](docs/claude-2026-11-review/quotients-plan.md), Q2.6 witnesses 1–3. The first renders of a
Seifert–Weber program.

**What was built:**
- `seifert-weber-windows` (tests/witnesses/scenes/seifertWeberWitness.ts): three emissive spheres
  of different colors at generic positions in D, pt, maxBounces 0, farClip 6, fov 0.5. Eleven pixel
  windows are certified by a float64 twin (tests/helpers/seifertWeberTwin.ts) with a one-pixel
  margin as seeing one sphere through 0, 1, 2 or 3 face crossings, or nothing within the far clip.
  The twin builds Γ from the closed forms itself, lists the cells that can meet each window's view
  cone by a breadth-first search over face-adjacent cells, and intersects every pixel ray with every
  sphere image in them (brute force over the cover, not the walk); it also walks each certified ray
  in float64 and requires the walk's cell to be the image's. tests/witnesses/seifertWeberWindows.test.ts
  re-derives every window from the scene as authored.
- `seifert-weber-lights`: a disk light 0.62 along face 0's direction facing the face (so D is lit
  mostly by its copies across the faces; the copy across face 1 shines in through face 1) and three
  lambert balls; pt = pt-nee = pt-mis, maxBounces 3, farClip 8, 256 spp.
- The runner's `walk-counter` check (tools/witness.mjs `renderWalkCounter`, report only): the
  strategy's own program with counters added at fixed anchors of the generated Seifert–Weber walk
  (the render fails if an anchor is missing): capped segments, the most faces one segment crossed,
  the largest constraint drift after a crossing.
- Demo `seifert-weber-room` in the gallery's "Curved spaces" section: beads in D's 20 corners and at
  its 30 edge midpoints, set as close to the faces as the Validator allows, so around every vertex of
  the tiling 20 corner beads meet in a node and around every edge 5 beads close into a ring; a
  two-sided lamp at the center (two disk lights back to back) and two small balls; pt-mis and pt,
  farClip 6.
- `pixelWindowRegion` (tests/witnesses/types.ts): the runner region of a pixel window, now shared by
  the torus fog windows and these.

**Measured (SwiftShader, WITNESS_PORT 3208):**
- `seifert-weber-windows`: 11 of 11 windows exact (each reads its sphere's emission to 4 digits, or
  0). With TWIST = π/5 in place of 3π/5, 6 of 11 fail: the five crossing windows the twin predicts
  and one miss window. The two crossing windows that still pass both cross faces 1, 8, 10: the two
  twists differ by a 1/5 turn, a symmetry of D, and along that face path the inserted symmetries
  compose to the identity (the wrong walk meets the same sphere at the same arc length to 1e-14 in
  the twin). The plan's sentence "moves every image beyond 2r_in" was corrected accordingly.
- `seifert-weber-lights`: pt-nee ≡ pt-mis Δmean 0.00%, χ²ᵣ 0.01; pt tripwire Δmean 0.00%, rmse
  20.6% (gate 25%); σ/µ pt-mis 18.1%, pt 19.7%. With the image index off by one (`first_face` for
  `1 + first_face` in quotient_image_index) the frame means differ by 2.58% and both
  equality checks fail. Under the pinned salt pt-nee and pt-mis draw the same numbers, so their χ²
  stays near 0 (0.03) even under that bug: the 1% mean gate is what catches it. An earlier light
  (radius 0.22, normal mostly along the face) let the same bug through (Δmean 0.08%) and failed the
  pt tripwire on noise (rmse 33%); that is why the light faces the face.
- Walk counter: windows (160×120×16 camera rays, cap 56): 0 capped segments, at most 11 faces in a
  segment, drift ≤ 9.5e-6; lights (160×120×256 pt-mis paths with bounce and shadow segments, cap 64):
  0 capped, at most 17 faces, drift ≤ 1.14e-5. With the cap set to 6 it counted 24,880 capped camera
  segments (at most 7 faces), so it counts.
- Non-quotient output: no program source changed (the only file under src/ touched is the
  seifert-weber.md note). `npm run digest` on HEAD (exported tree) against this tree: 295 of 295
  existing scenes identical in every part; the three new scenes are the only additions. Frames were
  not recorded: no code a frame case compiles changed.
- Vitest (full suite, load average 22–30): 4,714 passed, 5 timed out (5 s limit; no assertion
  failed) in 4 files, which pass with --testTimeout=300000 (1,188 of 1,188); 9 snapshots written,
  all additions for the three new scenes. tsc clean. The new seifertWeberWindows.test.ts: 19 of 19.

**Open:** neither scene has been in a full sweep. The M2 GPU's builtins and FMA contraction are
still not measured (the counter runs only on SwiftShader here). The demo was composed on
SwiftShader renders at 320×240 and up to 96 spp only.

## 2026-11-07 — The Seifert–Weber space: group data, walk, image-aware NEE (quotients plan Q2 core)

[Plan](docs/claude-2026-11-review/quotients-plan.md), Milestone Q2: Q2.1–Q2.3, Q2.5 and vitest
1–3 of Q2.6. The GPU witnesses (Q2.6 witnesses 1–3) are not built yet.

**What was built:**
- **The locked `Hit` gains `int image` and `Direction arrival`** (decision 1, at the plan's
  recommendation, provisionally). The dispatcher sets `image = 0` and `arrival =
  ambient_flow(ray, t).direction` (its side test reads it there); a quotient walk sets `image`
  once more. The transport's `wo` is `−hit.arrival`. In the 3-torus the walk reports
  `quotient_image_index(k)` of the cell it reached, and the rounding formula `quotient_image`
  is gone, so the field has one meaning in every program; image-aware NEE/MIS are written over
  two occupant maps (`quotient_image_query`, `quotient_image_direction`), the identity on
  directions in the torus. docs/trace-loop-contract.md describes both fields and the quotient
  walk.
- **`components/quotient/seifert-weber/`**: the group in float64 from closed forms (inradius
  0.99638, circumradius 1.90285, 12 face normals, pairings T(−2r_in·u)·R(u, 3π/5) and their
  inverses), emitted once as float32 const arrays `FACE_N[12]`, `PAIRING[12]`; the exit face
  and the renormalized crossing (static GLSL); the 13-image table (0: the light in D, 1 + f: its
  copy across face f, seen from `PAIRING[f]·x`, directions carried back by `PAIRING[f xor 1]`)
  and the crossing-count image index; the camera pose reduced into D on the CPU (`swReduce`).
  Image-aware MIS moves only the query, not the departure direction the plan's Q2.3 first
  listed (`PAIRING[f]·wi`): the cover's pdf reads the light point and `wo` at the emitter (the
  reversed `hit.arrival`), both already in D's chart. The plan line now says so.
- **The generated walk** (intersection.ts): the cell query clipped at the exit face, then the
  crossing; `hit.t` summed, `hit.image` from the crossings (0, 1 + first face, or −1);
  `QUOTIENT_MAX_CROSSINGS = ⌈4·farClip⌉ + 32`, a miss for `scene_intersect` and occluded for
  `scene_intersect_any`, so the cap only removes light.
- **Validator** (Q2.5): every object's and light's bounding ball inside D by `EPS_INTERFACE`
  (a new `ballBound` fact on the sphere and disk descriptors; the placement isometry is one
  function shared with the Planner, `curvedConstantPlacement`), no unbounded or driven objects,
  no media (`ambientFog: false`), no sky or delta lights, `farClip ≥ 2R_c + 2r_in = 5.80`.

**Measured:**
- Vitest (tests first; each new check shown failing): the group data (SO⁺(3,1) to 1e-12,
  face i → face i xor 1, 6 edge cycles of 5 with product I, one vertex class, a free action, each
  of 20,000 points of the ball of radius 3 in exactly one cell; a twist of 1/10 turn fails the
  edge cycles and the free action), Kac's mean 0.9571 against 0.9599 over 198,000 segments; the
  float32 walk (drift ≤ 1.4e-5, zero-length runs ≤ 6, at most 15/18/28 crossings in windows of
  6/8/16 against caps 56/64/96; without renormalizing, all 2,000 rays stick); the partition-MIS
  twin at 120,000 paths per estimator: pt 0.5422 ± 0.0047, pt-nee 0.5326 ± 0.0043, pt-mis 0.5412
  ± 0.0043, W1 −93σ, the membership control (MIS counting only 0-crossing hits) +13.8σ (60,000
  paths gave only +9.9σ, so the budget was doubled), and a wrong direction map fails pt-nee and
  pt-mis by 17σ and 14σ.
- SwiftShader runs the step over the emitted tables (4,096 rays × 100 crossings, 4,096 aimed at
  vertices and edges × 30) with drift ≤ 1.4e-5, no stuck ray, zero-length runs ≤ 6; its `atanh`
  is within 2.4e-7 on [0, tanh 2R_c] and `inversesqrt` within 9e-8 relative, so they need no
  replacement (unlike S³'s sin and cos).
- Gates for the `Hit` change: `npm run digest` (295 scenes) differs only by the lines named
  above — the two Hit fields with their comments, `hit.image = 0;`, the stored arrival and its
  side test, and `wo = −hit.arrival` in all 554 main programs; in the 13 torus programs also the
  occupant's maps, the walk's image line and the wrappers; source-map line numbers otherwise.
  `npm run frames -- compare`: 30 of 30 pictures bit-identical. The five torus witnesses, before and
  after: 15 of 15 checks pass with identical numbers, and the 27 rendered pictures they cache (frames, means and variances) are bit-identical, compared by hash (pinned salt). `h3-disk-light` passes (4 of 4). The
  Seifert–Weber parts add nothing to any existing program (digest: 295 of 295 scenes identical
  between the two commits).

**Open:** the plan's GPU witnesses for Seifert–Weber (patch-unrolling first-hit windows,
estimator equality, the cap counter) are the next step; no SW program has been rendered yet.
The M2 GPU's builtins and FMA contraction are not measured.

## 2026-11-07 — Curved spaces and the cube 3-torus in one tree

The H³/S³ work and the 3-torus work, built side by side from the same commit, merged. Where
they met:

- **The far clip is one descriptor field in every space.** Each ambient descriptor declares
  `farClip` (Euclidean 1000, H³ 10, S³ 2π), and core.ts emits it as the one `#define MAX_DIST`
  before the occupant's block, or the authored `measurement.farClip`. The H³ and S³ occupants no
  longer define MAX_DIST themselves (tests/compiler/farClip.test.ts checks one define per program
  in each space). In S³ the emitted literal is 6.283185307179586 instead of `TWO_PI`; both round
  to the same float32.
- **Image-aware MIS takes the curved `lighting_pdf(q, wo, …)` signature.** In a quotient program
  `lighting_pdf` passes `-wo` (the departure direction at q.p, which in E³ is the ray's
  direction bit for bit) to `quotient_image` and `wo` to the cover's pdf; the cover's
  sampler and pdf keep their private names and take the curved branch's `curved` flag.
- The Validator runs the space gate and the curved checks, then the quotient rules; a
  quotient on H³ or S³ is still an error (the only kind, `torus`, acts on Euclidean space).
- The gallery has both sections, "Curved spaces" and "Closed manifolds".

Checked: every compiled part of every suite scene that both parents compile equals the 3-way
merge of the two parents' outputs (2,337 parts: shader text, uniforms and closures, parameters,
source-map origins, scene data, warnings). The H³/S³ programs differ from the curved branch only
in where MAX_DIST is defined, and the torus programs differ from the quotient branch only by the
curved branch's changes to Euclidean programs (the `wo` signatures, `ambient_distance`, the
phase functions' event point). The 14 frame cases are bit-identical to the curved branch's.
Witnesses: the 11 h3-*/s3-* scenes (29 checks, no cache) and the 5 torus-* scenes (15 checks)
pass.

## 2026-11-07 — Fog in the cube 3-torus (quotients plan Q1b)

[Plan](docs/claude-2026-11-review/quotients-plan.md), Milestone Q1b.

**What was built:**
- A homogeneous `ambientMedium` is allowed in a quotient (absorbing, scattering, emitting;
  constant or `{param}` coefficients). Heterogeneous or GRIN ambient media, and media inside
  objects, remain Validator errors.
- In quotient programs with media, the transport loop reduces each medium event point into the
  fundamental domain (`quotient_reduce`) before NEE, the phase sample and the next segment, and
  looks up the camera's starting region at its reduced point. Nothing else changed: the medium
  arms read constants, and the media shadow walker runs through the walk unchanged.
- The declared bound (quotient README, `measurement.farClip`): with fog of extinction σ the far
  clip changes a pixel by at most (N+1)²·e^{−σR}·Le_max per channel, Le_max including the fog's
  glow ε/σ. The plan derives the bound for a fog that does not glow; the glow term is derived in
  the quotient README (thought through, not checked numerically).
- Equiangular medium light sampling is a Validator error in a quotient: it places the vertex by
  the light's position in D and samples none of its images. (It also needs delta lights, which a
  quotient rejects; the rule states its own reason so that relaxing either cannot bias silently.)
- Witnesses: `torus-fog` (an emitting absorbing fog with a black sphere; eight windows certified
  by a float64 twin as seeing one sphere image through 0–5 face crossings, or nothing within R),
  `torus-crystal-fog` (≡ its unrolled crystal in the same fog) and `torus-lights-fog` (pt ≡ pt-nee ≡
  pt-mis ≡ pt-mis with the light tree, in fog), registered at 1,024 spp.

**Measured:** non-quotient programs unchanged: digest 278 of 278 existing scenes identical in
every part, and `npm run frames -- compare` (the plan's gate, Q1.6 vitest 5) bit-exact, 30 of
30 pictures, between 0c6a425 and 2f88c4d (recorded by the reviewer with WITNESS_PORT=3205;
the comparison rerun here) and again after the review fixes. `torus-fog` 8/8 windows equal to
the twin to 4 digits; with the walk's distance sum broken, the five windows seen across faces
fail (e.g. 0.1746 against 0.4768). Crystal twin in fog: Δmean 0.00%, rmse 0.63%.
`torus-lights-fog`: Δmean 0.94%, χ²ᵣ 1.27 at 256 spp, and 0.33%, χ²ᵣ 1.45 at 1,024 spp. The
mean gap shrinks with samples; the slight χ² rise is recorded and its cause is untested.

**Open:** no check catches a missing `quotient_reduce` at medium event points. With that line
removed, `torus-lights-fog` still passed (Δmean 0.28%, χ²ᵣ 1.37). `torus-crystal-fog` (pt only)
and `torus-fog` (no scattering) cannot catch it by construction.

## 2026-11-07 — The cube 3-torus: a first closed manifold (quotients plan Q1a)

[Plan](docs/claude-2026-11-review/quotients-plan.md), Milestone Q1a (vacuum); its evidence and
twins are in docs/claude-2026-11-review/quotients/ (both committed on this branch). Fog in the
quotient (Q1b) is not built.

**What was built:**
- `measurement.farClip` (a truncation field) over the ambient descriptor's default `farClip`;
  `MAX_DIST` is emitted from it. Non-quotient programs are unchanged (digest: only the define
  moved; frames: 30 of 30 pictures identical).
- `ambientSpace.quotient: { kind: 'torus', size }` and the new component family
  `components/quotient/` (torus occupant: static lattice math; no locked-type change, no `Hit`
  field — the MIS side recovers the hit image by rounding).
- In quotient programs only: the generated cell walk (`scene_intersect` / `scene_intersect_any`
  over `scene_intersect_cell`), image-aware NEE and MIS (27 images, partition MIS: an image
  outside the table has NEE density 0, so its BSDF hit keeps weight 1), the pt-nee emitter rule.
- Validator rules (compiler/analyze/quotient.ts): far clip ≥ 2·diam(D), no delta lights, no sky,
  no media, no unbounded or driven geometry, everything inside D by EPS_INTERFACE except
  unrotated boxes spanning whole periods; emitters strictly inside.
- Witnesses `torus-crystal` (≡ the unrolled crystal `torus-crystal-ref`: Δmean 0.01%, rmse
  1.8%) and `torus-lights` (pt ≡ pt-nee ≡ pt-mis ≡ pt-mis with the light tree: Δmean 0.38%,
  χ²ᵣ 1.19); the latter fails as required with a W1-like (Δ 10.2%) and a W2-like (Δ 7.5%) error.
- vitest twins: the float32 walk (tests/components/quotient/torusWalk.test.ts) and the float64
  partition-MIS twin with its W1/W2 controls (torusMis.test.ts).
- Demo `torus-room`: a jungle-gym room repeating in every direction.
- Review fixes: the plan and its evidence committed beside the code; the plan's float32-twin
  sentence corrected (the cell sequence matched float64 on 3,993 of 4,000 rays; the 7 others
  are edge or vertex passages); the far clip computed once in core.ts; the quotient family's
  taxonomy is `scene` in both its README and registry; the demo text says farClip 16.

**Measured along the way, cause untested:** with the glossy ball at GGX roughness 0.15,
`torus-lights` pt-nee read 2.8% low against pt ≡ pt-mis ≡ pt-mis with the light tree (256 spp,
χ²ᵣ 145). A matte-ball variant and a roughness-0.45 variant agree (0.06%, 0.52%). In a variant
without beams the deficit shrank with samples (7.6% at 128 spp, 4.7% at 1,024), and the
per-block pt-nee/pt-mis map was mostly negative with rare +46% and +84% blocks. That fits
heavy-tailed NEE samples (27 images × a sharp lobe), but it is not shown: pt-mis cannot confirm
the NEE side, because MIS gives NEE samples little weight exactly where the BSDF pdf is high,
and an estimator bias in pt-nee at sharp lobes is not ruled out. The witness was moved to
roughness 0.45, so it does not test that regime. **Decisive check (not run):** the
roughness-0.15 scene, pt-nee against pt (which has no NEE), at 16× and 64× the samples
(4,096 and 16,384 spp) under independent salts: heavy tails predict a deficit that keeps
shrinking into the noise band of a median-of-means estimate over blocks; a bias predicts a
deficit that stays near 2.8%.
## 2026-11-07 — S³ review fixes: the light query's normal, radius domains

Review of the S³ step (curved-space design §2.4).

- **`light_query_surface(int mat, Hit hit)` again, in every space.** The face-forwarding the S³
  step added (n turned toward `wo` in curved programs) never ran: `scene_intersect` already turns
  `hit.frame` and `hit.ng` toward `region_from` when the arrival direction leaves along the normal,
  and the walk's `wo` is the same expression negated, so `ambient_dot(wo, hit.frame.n) ≥ 0` on
  every hit (in a curved program every object is a primitive, where ng = frame.n). The `wo`
  argument, the turn and the `curved` transport flag are gone; the arc rule reads `q.n =
  hit.frame.n` directly. Generated programs differ only in that signature, its two calls and
  comments; the 34 H³/S³ programs also lose the dead turn (digest: 539 programs, 23 line kinds,
  nothing else).
- **S³ radius domains are checked.** A row may declare `constraintIn`, a further domain its body
  in one space requires (`SpaceConstraints`, components/descriptors.ts). The sphere, disk and
  disk-light radius rows declare `SPHERICAL_RADIUS` = (0, π) for S³ (π is the diameter of the
  space; the disk light's radius map and area assume ρ < π), so a radius ≥ π is a Validator
  error there and still accepted in H³ and E³.

## 2026-11-07 — Spherical space S³ (curved-space step 3)

[Design](docs/claude-2026-11-review/curved-spaces-design.md) §2.4 and Part 1.

- **The occupant** `components/ambient/spherical/`: the unit sphere in R⁴ (Point and Direction are
  vec4), MAX_DIST = 2π (exact: every geodesic closes), no sky, the chord-form distance
  2·atan(|a − b|, |a + b|), the longest-axis tangent frame, `isometry_direction` = v·G⁻¹, and an
  arc-aware `ambient_aim`: a shadow ray on the long arc leaves along −u with 2π − d left, so an
  occluder on the far part of a long arc is tested. CPU geometry (exp_o, log_o, the rotation
  transvection, g⁻¹ = gᵀ); `mat4Transpose` is now shared with H³.
- **Bodies:** sphere (one atan pair, entry/exit by the inside test, mod 2π), plane (great sphere,
  first of two roots per period), disk (the first of the two antipodal crossings inside it); point
  light (I/sin²d per arc) and disk light (area 4π sin²(ρ/2), sin(r/2) = √u·sin(ρ/2)). lambert,
  pinhole, fisheye and hg are listed under spherical (same files); power and uniform selection and
  unrolled dispatch list spherical.
- **Two arcs.** The S³ light bodies choose the arc before the emitter's back-face test
  (`spherical_light_arc`): a one-sided surface receiver takes the arc leaving into its upper
  hemisphere with probability 1; a two-sided receiver or a medium event takes each with
  probability ½ (one extra `random()`). The pdf carries that probability.
- **Curved light-body signatures:** `<kind>_light_sample(l, LightQuery q, xi)` and
  `<kind>_light_pdf(l, q, light_p, wo)`, in H³ too. The MIS seam is now
  `lighting_pdf(q, wo, light_id, light_hit)` with `wo` the arrival direction reversed at the
  emitter hit, passed by `combiner_w_emitter(s, hit, wo)`; Euclidean arms pass `-wo`, which in E³
  is the old `s.ray.direction` bit for bit. `light_query_surface(mat, hit, wo)`: in a curved
  program n faces the side the receiver is seen from.
- **Trigonometry on the GPU.** SwiftShader's sin and cos are off by up to 1.9e-4 (atan 2e-7, asin
  7e-5; measured). With them, S³ hit points sat up to 1e-4 off the surface their root names, past
  the 3e-5 spawn offset, and in `s3-medium` a quarter of the paths through the ball re-spawned on the
  wrong side and carried the medium outside it (NEE 17% above pt). Every S³ position and body now
  uses the occupant's `spherical_cos_sin` (|error| ≤ 7e-8) and `spherical_asin` (through atan).
- **Witnesses** `s3-furnace`, `s3-long-arc`, `s3-long-arc-blocker`, `s3-point-light`,
  `s3-medium` (tests/witnesses/scenes/s3Witness.ts) with the fp64 twin s3Twins.ts; the
  space-free twin parts moved to curvedTwins.ts. Demo `spherical` (gallery section "Curved
  spaces").

## 2026-11-07 — H³ review fixes: witnesses that can fail, groups, procedural skies

Review of the H³ step (curved-space design §2.3).

- **h3-medium** now keeps its light out of frame: a disk light of radius 1.5 above and behind
  the camera. Before, the light's 598 visible pixels carried 91.5% of the frame mean, so the
  whole-frame gates could not see a bias of about 20% in the ball or floor. A phase sample from
  the ball now reaches the light with probability 0.12 to 0.26, so MIS differs from NEE: the
  largest per-pixel difference is 0.074 at the same salt (0.0016 before).
- **h3-disk-light** uses a light of geodesic radius 1.2, up from 0.6. A Euclidean inverse-CDF
  radius now raises E by 4.8% on axis (0.44% at radius 0.6), about 7× the 0.002 tolerance.
- **New witnesses:** `h3-sky` (the sky 1 + key read at each camera ray's ideal endpoint, through
  a pinhole and a fisheye placed away from o) and `h3-sky-ball` (a lambert ball under a constant
  sky reads ρ·L; its placement is the {param}-driven mat4 uniform). `h3-furnace` also renders
  through a fisheye. `h3-point-light` has two lights, under power and uniform selection. Every
  key listed under hyperbolic is now rendered (support.md), the sky through constant and
  procedural skies.
- **Procedural skies in H³ crashed the App.** It baked the sampling table of every procedural
  sky, but no chart has a hyperbolic body. `compileEnvironmentBake` now returns null for a sky
  that is not sampled as a light, since no program reads its table.
  `environmentSampledAsLight` (Analyzer.ts) is the one rule, shared with the Analyzer.
- **`flattenGroups(nodes, space)`** takes the ambient space. In a curved space a group with a
  transform is an error, because the function composes Euclidean similarities.
- The H³ plane and disk bodies share the occupant's `hyperbolic_plane_root` and call
  `hyperbolic_form` directly. Before, they called `ambient_dot` on a point.

## 2026-11-07 — Hyperbolic space H³ (curved-space step 2)

[Design](docs/claude-2026-11-review/curved-spaces-design.md) §2.3 and Part 1, after three reviews.

- **The occupant** `components/ambient/hyperbolic/`: the hyperboloid model (Point and Direction
  are vec4), MAX_DIST = 10 arc length, fp_uncertainty = REL·w, the chord-form distance, the
  longest-axis tangent frame, the ideal-point sky key, and `isometry_direction` for normals; its
  CPU geometry (exp_o, log_o, transvection, exact inverse) behind `CurvedGeometry`
  (components/ambient/isometry.ts). `ambient_distance` joins the contract in every space.
- **Bodies in H³:** sphere, plane and disk shapes; point and disk lights (sinh² r area density,
  the uniform-area geodesic disk sampler); lambert, pinhole, fisheye and hg as the same files
  listed under both spaces (hg now builds its basis with `ambient_frame`, which changes the
  sampled directions of Euclidean HG media but not their distribution).
- **Placement:** every curved object has one inverse isometry (a baked `const mat4`, or a mat4
  uniform when {param}-driven); point rows fold in as a pre-translation; lights read the isometry
  of their backing region (compiler/plan/curved.ts). The camera ships four vec4 uniforms from
  the target-centered frame (`curvedCameraBasis`).
- **Validator:** curvature parameter and a missing camera pose are errors in curved spaces; new
  limitation rows for marched objects and uv-reading or GLSL-expression materials; skies are
  supported in H³ as lookups by BSDF rays.
- **Witnesses** `h3-furnace`, `h3-disk-light`, `h3-point-light`, `h3-medium`, with fp64 twins
  (tests/witnesses/scenes/h3Twins.ts); demo `hyperbolic` in the gallery's new "Curved spaces"
  section.

## 2026-10-01 — GRIN programs no longer offset every ray by 0.001

[Plan](docs/claude-grin-spawn-floor-plan.md), reviewed by a fresh agent before code.

**The defect** (found by the step-6 guides witness):
- **What happened:** in any program containing a GRIN medium, every ray leaving a
  floating-point-accurate surface started 0.001 off it (`spawn_eps_fp` floored at
  `GRIN_GRAD_EPS`).
- **The effect:** every medium segment after a crossing skipped its first 0.001/|cos θ|, and
  every bounce started 0.001 off its surface. A 0.015 slab read 0.01400 thick whenever any GRIN
  object was in the scene, GRIN or not.
- **Why the floor existed:** it was a guard keeping the walker's entry-point ∇n stencil inside
  the region. It protected only that point: interior steps near the exit already sample
  outside, segments up to one step never sample ∇n, and no entry inside-test exists.

**What changed:**
- the floor is removed; GRIN programs use the fp-scale spawn margin like every other program;
- `GRIN_GRAD_EPS` is grin.glsl's own `#define`; the TS constant, its header define and the
  coupling-test case are deleted;
- the real requirement is now written where authors read it (grin.glsl `grin_grad_n`, grin.md,
  the `ior` doc, whose stale v1 text was corrected): an index formula must be finite and smooth
  within about 0.001 outside its region;
- the epsilon plan and the witness README record the removal;
- new witness `guides-grin-elsewhere`: a plain thin slab with a GRIN box elsewhere in the
  scene.

**Measured:**
- `tsc` clean; vitest 114 files, 4229 tests, all pass.
- **Digest:** exactly the 26 GRIN scenes differ, by only the predicted lines (a script over
  every changed line in all 28 GRIN programs); the other 247 scenes are identical.
- **Frames:** 16 of 18 pictures identical; the `grin-furnace` case differs, as predicted.
- **Bent paths:** the sky seen through the lossless Luneburg lens in `grin` must equal the sky
  exactly. Over 1704 deterministic pixel-channels the error went from +0.293% to −0.096%.
  - Frame means of `glassball` and `grin` moved by less than 2 standard errors.
  - A per-pixel χ² predicted at about 1 came out 190 and 252,167. That statistic was the wrong
    test: it is dominated by noiseless pixels that moved by a fixed fraction.
- **GRIN witnesses** (21 scenes plus the new one): 28 of 28 exact checks pass, including the
  two thin-GRIN checks that failed before the fix and `guides-grin-elsewhere`.

**Still open:** the remaining −0.1% through the Luneburg lens. The expected but unmeasured
cause is the exit-side index in the interior (n_in/n_out)² factor, read from |T| inside the
wall. Also still open: several GRIN materials under NEE being extremely slow on SwiftShader.

## 2026-10-01 — Step 6 of the outputs plan: albedo and normal pictures

[Step 6 plan](docs/claude-outputs-step6-plan.md), reviewed twice before code (a fresh agent and
the owner's external reviewer).

**What changed:**
- **`measurement.aovs: ['albedo', 'normal']`** (RGB only; the Validator rejects unknown names,
  duplicates and spectral). The resolved measurement and stamps omit it when there are none.
- **The `aov` component family** (`components/aov/`): one folder per AOV, one shared signature
  `vec3 <name>_aov(int mat, Hit hit, Direction wo, MaterialProperties props, Spectrum weight)`,
  a README contract, and picture facts (albedo: view `'unit'`, formats hdr and png; normal:
  view `'signed'`, png only). The compiler feature `features/aov.ts` links them.
- **The guide definition (C, the owner's choice):** at the first non-null surface reached at
  `bounce == 0`, the sample is the surface value × the path throughput, so the averaged
  guide is value × camera-ray transmittance in every medium arm; a path a medium ended
  arrives with weight 0. One capture in the walk, before the budget break; no random numbers.
  `transport_trace` gains `out` parameters only in AOV programs.
- **Albedo facts** on every material descriptor (`{ row }` or `{ fn }`, required), and a
  generated `material_albedo` dispatch, only where an AOV calls it. The normal is faced
  toward the arriving ray with `ambient_dot`.
- **Pictures:** each AOV is a picture after the statistic, updated by the mode's own rule.
  The display gains `'unit'` (clamp, sRGB) and `'signed'` (0.5n + 0.5) views in
  `glsl/shared/views.glsl`. A mixed list's display computes each picture's color in its own
  branch; tonemap-only displays are unchanged.
- **Witness runner:** `mean` checks take a `picture`; every picture of a render is read and
  cached under its own key; new `kind: 'identical'` (one picture, two strategies, bit for bit).
- **Docs:** the aov and accumulator READMEs, the materials README (the albedo fact), the
  contract's view values, the witness README.

**Measured:**
- `tsc` clean. vitest: 4221 passed and 5 failed, the 5 being the program-description
  snapshots of the new `guides` scene written from an earlier version of its fixture.
  Regenerated: additions only (0 deleted lines, entries for exactly the 5 new scenes); that
  file then passed (778 of 778).
- New tests:
  - the table test over {average, oneshot, average + variance} × AOVs, including all four
    attachments;
  - the walk capture's placement;
  - every material's albedo fact names a real row or function;
  - the dispatch only where needed;
  - the Validator rules;
  - a glslang compile of an AOV program per material model, which caught one bug before any
    GPU run (`ambient_dot` takes the point).
- **Digest** against the before-baseline: the 268 existing scenes identical; the only
  differences are the 5 new scenes.
- **Frames:** 18 of 18 identical.
- **Witnesses** (`guides` and the four `guides-grin-*`): 28 of 32 exact checks pass.
  - Every medium arm reads albedo × transmittance: constant absorbing, analytic, ratio and
    delta tracking. So do the two null slabs; the glass reads its own transmittance, and the
    sky and the null-crossing budget read 0. GRIN traversal and capture read 0.
  - Bit for bit: the guides under pt ≡ pt-nee and maxBounces 1 ≡ 0, and radiance and
    variance with AOVs ≡ without (76800 components each).
  - The 4 failures are the two thin-GRIN scenes, a pre-existing defect (below), recorded as
    standing failures.
- **Browser check** (`guides`):
  - `m` cycles radiance → variance → albedo → normal;
  - `save('normal','png')` saves;
  - `save('normal','hdr')` and a production list naming it are refused before rendering
    (samples stay 4);
  - salt and screen are unchanged; no page errors.

**Found, not fixed (open items, tests/witnesses/README.md):**
- A GRIN segment is attenuated over 0.001 less length than it travels: a 0.015 slab reads
  an effective 0.01400 in every channel and both GRIN arms, while the same slab as a plain
  medium reads 0.01498. Radiance is affected the same way. Cause not found.
- A scene with four GRIN materials under NEE took over 9 minutes for one sample on
  SwiftShader (each alone: 4–14 s); no suite scene had more than one.
- NEE in `guides` costs about 3 s per sample with or without the guides, which is far above
  a Cornell box. Unexplained.

## 2026-10-01 — Outputs review: small cleanup before AOVs

[Cleanup plan](docs/claude-outputs-review-cleanup-plan.md), approved by the owner after
the independent review of steps 1–5. The review found four correctness gaps: tiled
stamps built between asynchronous encodes, caller-owned save declarations retained
across awaits, m/M rejected by the production keyboard lock, and fractional/NaN
attachments accepted by the new validator. It also found separate MRT storage naming
and final file-writing dispatch, and a statistic comment describing removed mains.

All are addressed: save requests are copied at startup, ordinary filenames are fixed
with their captures, tiled stamps are read in the final tile callback while parameters
are locked, m/M remains available during production, and attachment indices must be
integers within bounds. MRT outputs use pictureBuffer. One saveImageFile writer accepts
top-first RGBE/RGBA rows from ordinary captures and stitched tiles; the old save wrappers
are removed. The statistic comment explains the present. No transport, accumulation
math, AOV implementation or compatibility layer changed.

Measured:
- `npx tsc --noEmit`: exit 0.
- Initial focused Vitest run: 69 passed, 1 failed because the new tiled test extracted
  the timestamp rather than the picture from the filename. Corrected the test's index.
- `npx vitest run`: 113 files, **4140 tests passed** (62.07 s).
- `npm run digest -- /tmp/pathtracer-cleanup-digest.json`, compared with
  `.digest/step5c.json`: **268 of 268 scenes identical**, 7 async scenes skipped.
- `npm run frames -- record /tmp/pathtracer-cleanup-frames`: 8 cases in 28.0 s;
  compared with `.digest/step5-commit-frames`: **18 of 18 pictures identical**, including
  the tiled HDR and PNG payloads. Git/date stamps differ as expected.
- Regression coverage: mutation of production, ordinary and tiled save declarations;
  all tiled stamps captured before unlock/encoding; production m/M; invalid attachment
  numbers; shared HDR/PNG writer's exact payloads and row order.
- `git diff --check`: clean. No witness sweep; sampling and transport are unchanged.
- Re-checked independently before commit: `tsc` clean; the affected tests (17 files, 423
  tests) pass; frames 18 of 18 and digest 268 of 268 identical against step 5; and
  `npm run witness -- cornell-area` passes 3 of 3, including tiled ≡ one piece with both
  saved through the shared writer (HDR 0 of 76800 bytes differ, PNG 0 of 57720).

Step 6 still needs its own approved plan satisfying the media/GRIN expectation gate.

## 2026-10-01 — Outputs plan: build record for review

[The outputs plan](docs/claude-outputs-accumulation.md) now ends with "The build so far": each
step's commit, measurements, witness runs and review status; what exists now; five places the
built code differs from the plan text; small loose ends; the order of what comes next (review
of steps 1–5, step 6 AOVs behind its gate, step 7 OIDN, the parameter revamp); and a guide for
a reviewer. It records that steps 1–5 have had no independent code review. Docs only.

## 2026-09-30 — Step 5b of the outputs plan: one save operation, declared lists

[Step 5 plan](docs/claude-outputs-step5-plan.md), second commit (saving).

**What changed:**
- **One operation:** `app.save(picture, format, filename?)`, with `app.saveAll(list)` for
  several. `'hdr'` writes the picture's float values; `'png'` draws the picture through its
  view mapping into `ldr` (a one-draw override, so the screen and the displayed picture are
  unchanged). A format must be one the picture declares; an unknown picture or an undeclared
  format is an error naming what the renderer keeps.
- **Capture is shared** (`app/capture.ts`, `App.capture`): `save` and the tiled renderer read
  pixels the same way. `saveAll` reads every picture and its stamp before awaiting any
  encode.
- **The stamp records the picture** (`picture=` in the `.hdr` header, `pathtracer:picture` in
  the PNG).
- **Declared lists:**
  - `renderProduction(N, { save: [{ picture, format }, …] })` replaces `autoExportPNG`,
    `autoExportHDR` and `autoExportAllAOVs`;
  - `renderTiled({ …, save: [...] })` replaces `format: 'hdr' | 'png' | 'both'`; files are
    named `render_<date>_<picture>_<W>x<H>_<spp>spp.<format>`;
  - both validate the whole list before rendering, and the production check runs before
    anything is locked or resized.
- **Deleted:** `exportPNG`, `exportHDR`, `exportAOV`, `exportAllAOVs` (with its "every export
  except radiance and ldr" rule), `App.renderLdr`, and the `a` "export all AOVs" key.
- **Callers:**
  - the panel's Export PNG and the `x` key save the picture on screen; Export HDR and `X`
    save the raw radiance;
  - the production dialog saves the radiance PNG (the same files as before), and the tiled
    job saves the radiance HDR and PNG;
  - the witness tiled check and the frames tool go through `save` lists and `capture`.
- **Docs:** production-rendering.md has a Saving section; architecture.md's production flow
  and the witness README now name `save`.

**Measured:**
- **Typecheck and tests:** `tsc` clean; vitest 111 files and 4130 tests. New: `validateSaves`
  rejects an unknown picture and an undeclared format; `App.saveAll` validates before reading
  and reads every picture before awaiting an encode; the production orchestrator rejects a
  bad list before rendering or locking; both file formats carry `picture`.
- **Digest** against 5a: 268 of 268 scenes identical (saving is App code only).
- **Frames** against 5a: 18 of 18 identical, including the tiled payloads, which now go
  through the shared capture.
- **Witness** `cornell-area`: all 3 exact checks pass, including tiled ≡ one piece (HDR 0 of
  76800 bytes differ, PNG 0 of 57720), with both sides saved through `save`.
- **Browser check** (furnace variance renderer, after a finished 8-sample render showing
  radiance): `save('variance', 'png')` downloads a file whose stamp says `variance` and whose
  pixels equal the variance capture. Afterwards the displayed picture is still radiance, the
  render canvas is pixel-identical to before, the sample count stays 8 and the salt 1234, and
  there are no page errors.

## 2026-09-30 — Step 5a of the outputs plan: any picture on screen, switched live

[Step 5 plan](docs/claude-outputs-step5-plan.md), first commit (viewing).

**What changed:**
- **Picture facts** now also state how each picture is shown (`view: 'tonemap'` for radiance
  and variance) and which formats it can be saved in.
- **The contract** carries them on the export targets (`ExportTarget.picture`, an
  owner-approved extension recorded in `compiler-engine-contract.md`). The export targets
  that carry it are the pictures, in order.
- **The display program:**
  - with one picture it is unchanged;
  - with more it binds every picture and chooses one by `u_picture`, on the reserved
    no-reset channel `renderer.picture`;
  - the view recipe re-aims every picture input after the frame.
- **The engine:** `Engine.renderLdr` becomes `renderView(target?, parameters?)`. It re-runs
  the view recipe into `'ldr'` or onto `'screen'`, with one-draw overrides, and traces
  nothing.
- **The App** holds the displayed picture by name, as display state outside the parameter
  store:
  - `getPictures()`, `getDisplayedPicture()` and `showPicture(name)` (which redraws at once);
  - after a renderer switch it re-resolves by name, falling back to the main picture.
- **The `m` key** cycles the displayed picture.

**Measured:**
- **Typecheck and tests:** `tsc` clean; vitest 110 files and 4124 tests, including new
  table-test checks (display bindings, the selector only for more than one picture, recipe
  inputs, compiled-renderer validity).
- **Snapshot:** the GLSL snapshot changed only by the picture facts (48 entries) and the
  variance case's display selector.
- **Digest** against step 4's commit:
  - every structure differs only by its picture facts;
  - the only shader change is the variance renderer's display;
  - the only new uniform is its `u_picture`.
- **Frames:** 18 of 18 bit-identical.
- **Browser check** (furnace variance renderer, after a finished 8-sample render):
  - switching to variance changes the screen (black, as the variance is zero);
  - the sample count stays at 8 and the salt at 1234;
  - switching back restores the exact original pixels;
  - no WebGL errors.

## 2026-09-30 — Step 4 of the outputs plan: a generated accumulation `main()`

[Step 4 plan](docs/claude-outputs-step4-plan.md). The three hand-written mains (`average`,
`variance`, `oneshot`) repeated the same camera setup. They are replaced by one generated
`main()`, built from the planned picture list. It does four things in order:
1. traces one camera sample (the setup, verbatim);
2. fetches each picture's previous value when the mode reads history;
3. calls each picture's update rule in list order;
4. writes every picture.

The arithmetic is static GLSL, one rule per folder, operation for operation as before:
- `average_update`, the running mean;
- `variance_update`, Welford, normalized;
- `oneshot_update`, the latest sample.

The descriptors name these rules (`update`), and each planned picture carries its role (main
or statistic) and its rule. The accumulator README states the three signatures.

**Measured:**
- **Frames (the gate):** 18 of 18 pictures bit-identical against step 3's commit.
- **Digest:**
  - closures, scene data, data reads and warnings are identical everywhere;
  - the 495 `shaders` parts differ only from the accumulation blocks on, and every display
    shader is unchanged;
  - the 495 `rest` parts differ only in their source maps.
- **Tests:** vitest 110 files and 4118 tests. That includes the glslang compile of every
  program, and the test pinning the camera lines and the two draws. The table test now also
  checks that each configuration's `main()` calls exactly its rules and writes each output
  once.
- **Snapshot:** the GLSL snapshot (47 cases) changed only in accumulation blocks and
  source-map structure, classified line by line.
- **Witness:** `furnace` and `two-light` pass 5 of 5.
- **Leftovers:** `git grep "void main" -- src/components/accumulator` finds 0 hits.

**One run stalled:** the first full vitest run stalled with idle processes for over 10
minutes. It was stopped, and an immediate rerun finished normally. The cause is unknown (the
run was not under `caffeinate`), and nothing points at the code.

## 2026-09-30 — Step 3 of the outputs plan: one planned picture list

[Step 3 plan](docs/claude-outputs-step3-plan.md). The Planner builds one ordered list of the
pictures a program keeps (`PlannedPipeline.pictures`: the main picture, then the requested
statistic). Everything that names a picture's storage is generated from it:
- the accumulation buffer's formats;
- the path-tracer outputs, and its previous-frame inputs;
- the sampler declarations;
- the fragment outputs;
- the exports;
- the display input and the LDR recipe.

**The facts behind the list:**
- **Picture names are data:** the main picture's names (export, fragment output, previous
  sampler) live in a table keyed by `measurement.response` (`compiler/plan/pictures.ts`),
  and the variance statistic's live in its accumulator descriptor (replacing
  `readsMoment`).
- **One function, `pictureBuffer`,** answers where a picture's newest value is, during the
  frame or after the swap.

**Removed:**
- the variance booleans in the Generator, ShaderBuilder and PipelineBuilder;
- `oneshot`'s dead `u_previous` input;
- the hard-coded `'display-pass'` in the LDR recipe.

**New checks:**
- **The Generator** rejects more than 4 pictures, the WebGL2 draw-buffer floor.
- **`validateCompiledRenderer`** checks every buffer reference the same way (in pass
  outputs, pass inputs, exports and the LDR recipe):
  - attachments must exist, replacing the old 0–7 warning;
  - `_current`/`_previous` only on a double buffer;
  - the recipe's pass and buffers must exist.

**Measured:**
- **Typecheck and tests:** `tsc` clean; vitest 110 files and 4115 tests. New: a table test
  of the generated pipeline over `average`, `average + variance` and `oneshot`, the
  draw-buffer floor, and the validator cases.
- **Digest** against step 2's commit:
  - every shader is identical in all 268 scenes;
  - exactly 2 renderer structures differ, as predicted: `cornell-oneshot` loses its dead
    input, and `furnace-var` lists its exports as radiance, variance, ldr. With those two
    changes applied, both are byte-identical to the old ones.
- **Snapshots:** both unchanged.
- **Frames:** 18 of 18 bit-identical, including `oneshot`.
- **Witness:** `furnace` passes 3 of 3.

## 2026-09-30 — Step 2 of the outputs plan: variance is an option of `average`

[Step 2 plan](docs/claude-outputs-step2-plan.md). Variance is declared as
`accumulation: { type: 'average', variance: true }`, a statistic recorded alongside the
mean, instead of a separate averaging mode.

- **The registry:** each accumulator descriptor lists the statistics it supports. `average`
  lists `variance`, whose GLSL stays in `variance/`; `oneshot` lists none.
  `requestedStatistic` is the one function that says which statistic a strategy switches on.
- **The Validator:**
  - rejects `type: 'variance'`, with a hint saying what to write instead;
  - rejects a non-boolean `variance`;
  - rejects variance on a mode that doesn't support it.
- **Migrated:**
  - the furnace fixture;
  - the witness runner's forced variance, the frame tool's noisy case, and the lab
    page's cache digest (each now adds `variance: true` to the strategy's own mode);
  - two tests;
  - comments and witness labels;
  - the accumulator README and the variance note;
  - CLAUDE.md's Status line.

The machinery behind it (the five places that test for variance, the hand-written mains)
is unchanged until steps 3 and 4.

**Measured:**
- **Typecheck and tests:** `tsc` clean; vitest 109 files and 4096 tests (one new Validator
  test).
- **Digest** against step 1's commit: **268 of 268 scenes identical.**
- **Snapshots:** the GLSL snapshot is unchanged. The program-description snapshot changes
  only in `furnace-var`'s accumulation (`type: 'variance'` → `type: 'average',
  variance: true`).
- **Frames:** 18 of 18 bit-identical.
- **Witness:** `furnace` and `two-light` pass 5 of 5. `two-light`'s χ² checks go through
  the rewritten forced-variance path.
- **Leftovers:** `git grep "type: 'variance'"` finds only the Validator test that asserts
  it is rejected.

## 2026-09-30 — Step 1 of the outputs plan: the `hdr` export is now `radiance`

[Step 1 plan](docs/claude-outputs-step1-plan.md). The color picture's export is named for
its content, not a file format. The rename covers export identity only:
- the definition in `PipelineBuilder.ts`;
- `App.exportHDR` and `exportAllAOVs`;
- `TiledRenderer`;
- two comments;
- three tests and the GLSL snapshot;
- the witness tools and the frame tool's case list;
- five docs describing the current API.

Kept as `'hdr'`, because they mean something else:
- the `.hdr` file extension;
- the tiled renderer's `format` option (replaced in step 5);
- `ParameterMetadata.hdr`;
- the frame tool's encoded-file kinds;
- an environment witness case.

**Measured:**
- **Typecheck and tests:** `tsc` clean; vitest 109 files and 4095 tests.
- **Snapshot:** the GLSL snapshot diff is only the 47 export-key blocks (moved by key
  order, contents unchanged).
- **Digest** against step 0's baseline: 1794 parts identical (shaders, closures, scene data,
  data reads, warnings). All 495 differing `rest` parts are structurally equal once the
  export key is renamed.
- **Frames:** 18 of 18 pictures bit-identical (`--rename hdr=radiance`). Without the rename,
  the old record is refused.
- **Witness:** `furnace` passes 3 of 3 (9 s).
- **Leftovers:** a repo-wide `git grep` finds only the kept uses.

**Review:** no reviewer findings were reported before this commit.

## 2026-09-30 — Step 0 of the outputs plan: exact comparison tools

[Step 0 plan](docs/claude-outputs-step0-plan.md) of
[the outputs plan](docs/claude-outputs-accumulation.md). No renderer code changed: `git diff`
for `src`, `tests`, `demos` and `pages` is empty.

**What was added:**
- **`npm run frames -- record <dir>`** (a mode of `tools/witness.mjs`). It renders 8 fixed
  cases fresh on SwiftShader at the pinned salt, bypassing the witness caches:
  - average;
  - variance, zero by design (the furnace);
  - variance, noisy (Cornell);
  - oneshot;
  - spectral;
  - fog;
  - GRIN;
  - a 150×100 render in 3×2 tiles.

  For each case it keeps every float export, the LDR bytes, and what the App reports after
  the render. For the tiled case it keeps the encoded `.hdr` and `.png` payloads, with
  their headers.
- **`npm run frames -- compare <a> <b> [--rename old=new]`.** It reads files only. It
  requires both records to be complete and valid against the case list, with no
  non-finite values. Then every picture must be bit-for-bit equal.
- **`npm run digest -- <out> --keep <dir>`.** It keeps the exact text behind every hash.
  `--compare` prints a `git diff --no-index` line for each part that differs.
- **Smaller additions:** `.digest/` in `.gitignore`, and the commands in CLAUDE.md.

**Measured:**
- **Typecheck:** `tsc` clean.
- **Tests:** vitest 109 files and 4095 tests, the same before and after.
- **Repeatability:** two fresh records are bit-identical (18 of 18 pictures), both before
  and after the review fixes.
- **The variance cases:** the furnace's variance is exactly 0 (12288 of 12288 channels),
  which is why the noisy Cornell case exists. Its variance is nonzero in 12066 of 12288
  channels.
- **Each negative check fails as it should:**
  - one changed float is reported as 1 pixel, difference 1e-3;
  - metadata-only changes pass;
  - a NaN fails;
  - a missing file, a wrong salt, missing cases and a truncated encoded file are each
    refused;
  - `--rename` works, and a rename collision is caught.
- **The digest:** the new script's hashes equal the original script's on 268 of 268
  scenes. A kept run takes about 4 s and about 82 MB.
- **Timing:** a fresh record took 23–37 s. One run took 338 s for unexplained reasons
  (images identical; timing only).

**The review** was by an independent agent (ChatGPT). It found four ways the tool could
pass when it shouldn't, all fixed and measured:
1. **Records were checked only against each other,** not against the required cases. The
   reviewer showed matching broken records passing: empty manifests, the same case removed
   from both, the main picture removed from both, and both salts set to 999.
2. **The tiled capture dropped its file headers,** and the PNG had no length check. Both
   PNG payloads truncated to zero bytes passed.
3. **A failed GPU readback could look valid,** because WebGL errors weren't checked (1286
   left finite zeros). A mutant tool now fails on exactly this.
4. **`--keep` could overwrite an earlier digest's evidence.**

All the reviewer's constructions are now refused, and the unchanged control still passes.

## 2026-09-29 — Outputs and accumulation: design and plan (documentation only)

The OIDN work was paused for a redesign of the renderer's output side, because the
current system hard-codes its one extra output (variance) in five places.

The design went through a facts-only map of today's system, an owner discussion, three
independent reviews (facts and feasibility, architecture and rules, adversarial) and a
further review draft. It is merged into one plan,
[claude-outputs-accumulation.md](docs/claude-outputs-accumulation.md).

The plan:
- **One ordered list of per-pixel pictures** (radiance; variance as an option of
  `average`; first-hit AOVs albedo and normal), from which the layout, a generated
  accumulation `main()`, the exports and the display are all generated.
- **Display** of any picture, switched as display state outside the parameter store.
- **One small engine call** to redraw the view, or write a PNG, without tracing.
- **One save operation,** with saves declared as lists in code.
- **The `hdr` export renamed to `radiance`.**
- **A gate on AOV capture in media:** the walk falls through to surfaces after
  termination.
- **Build steps 0–7,** each with its own plan, prediction, checks and reviews.

Recorded alongside it:
- **The pinned taxonomy wording** changes, with the owner's approval: view acts on "the
  converged pictures" (`fable-strategy-taxonomy.md` §2, §10).
- **Deferred:** the parameter-system revamp (one "changes the render / display only" fact
  per parameter, read by both the reset and the production lock).
- **Proposed:** step 0 (comparison tools),
  [claude-outputs-step0-plan.md](docs/claude-outputs-step0-plan.md).
- **Kept as a record:** the discussion, in `claude-outputs-accumulation-discussion.md`.
  The review draft `claude-outputs-accumulation-revised.md` is marked superseded.

## 2026-09-29 — OIDN plan: guided denoising, guides as separate renderers

Wrote [the OIDN plan](docs/claude-oidn-test-plan.md). Documentation only; nothing is
implemented yet.

**How the plan got here.**
- **First draft** (one-sample MRT guides built into the compiler, WebGPU display). Two
  reviews found:
  - one-sample guides contradict the OIDN README (guides must be filtered like the color);
  - input scale 1 is not OIDN's default;
  - the switch was in `view`;
  - the draft gave no way to get first-hit data out of the walk;
  - the draft was too invasive.
- **Color-only page.** It was reviewed and trimmed (the owner dropped the quality
  experiment: OIDN's quality is established).
- **Guides.** The owner then required them. Three research agents compared producing them
  as separate renderers versus extra render targets, and per-material albedo facts versus
  pbrt-v4's generic estimate. The owner chose separate renderers.

**The plan now has two parts.**
- **Part 1.** `measurement.response` gains `'albedo'` and `'normal'`, served by a new
  `first_hit` integrator. This is the deferred "probe integrators" design of
  `fable-measurement-bench.md` §2.3. It also adds per-model albedo facts as structured
  descriptor data, and a `guides` witness with exact region values. The radiance programs
  do not change.
- **Part 2.** A dev page renders radiance, albedo and normal with one pinned salt (same
  camera rays), and denoises them with oidn-web 0.4.0's guided model through its
  float-array path.

**Recorded in the plan:**
- Facts read in oidn-web's source, several also measured by a reviewer:
  - negative values and Inf poison its exposure;
  - only square multiple-of-16 sizes work on the float-array path;
  - it has no error callback;
  - it passes normals through without encoding them.
- The measured model checksum.
- A known gap: guide programs carry 4–7 `seam-unused` warnings.

## 2026-09-29 — each value is checked once (spectra-in-every-slot, step 4)

Step 4 of the [spectra-in-every-slot plan](docs/claude-spectrum-fields.md) ("Step 4 in full").
Only diagnostics change; every scene's compiled output is unchanged.

**The rule.** One function (`valueProblems`, analyze/propertyValidation.ts) checks a value in
its setting: material rows, a material's fallback emission, light emission, the constant sky,
the fog's settings and phase rows. It asks four things:
- **Keys:** a value has only its form's keys. A named kind is `{ <id>: … }`; a slider has
  `param`, `default`, `min` and `max`; a formula has `kind`, `source` and `params`. This
  replaces the "keys of more than one kind of value" check.
- **Slider:** a path, a default, min at most max, and a default between them. This holds for a
  setting's own slider, a blackbody's kelvin and scale, and a formula's parameters.
- **Domain:** every number the value can take lies in the setting's domain.
- **Kind:** a named kind sits in a setting of one of its roles. Its numbers are declared as data
  (`fields`: each one's domain, and whether it may be a slider, may be omitted or is a triple),
  and pass the same checks. `validate` keeps only the rules `fields` cannot state.

**What this replaced:**
- blackbody's own slider check (`checkDial`) and its `validate`;
- Gaussian's `validate`, and Sellmeier's triple test;
- the per-instance entry checks, which now use the same constant test;
- the RGB preview warning's own validity test;
- `namedKindsClaiming`, which lost its only caller.

The constraint vocabulary gains a closed interval.

**Newly rejected** (all passed silently before, in both color models):
- a key beside a named kind: `{ blackbody: { kelvin: 3000 }, scale: 5 }` rendered at scale 1;
- an unknown key inside a Gaussian or a Sellmeier;
- a misspelled key on a slider, on blackbody's kelvin, on a formula or on a formula's parameter;
- a slider default outside its own min and max, on a setting, on blackbody's kelvin, or on a
  formula's parameter;
- a formula whose `params` is not a list. As a string, it used to be reported per character;
  as an object or a number, it made the Validator throw.

No suite scene is affected.

**Messages that changed:**
- kelvin and scale out of range: "…blackbody kelvin must be in [1000, 40000]";
- Gaussian and Sellmeier numbers: one message per number;
- the three "keys together" cases: an unknown-key message;
- a formula parameter's structure: the slider messages;
- a packed per-instance array: it names the bad entry.

**Unchanged by the owner's choice:** a reflectance above 1 stays allowed in RGB renders, and
analyze/spectral.ts keeps the spectral lift's limits (reflectance ≤ 1, the fog's ceilings).
The spec records that choice, and the research-gain proposal R-6 depends on it.

**Verification:**
- **Tests written first.** tests/compiler/valueChecks.test.ts failed on all 20 cases, and a
  contract test (every named kind has an example; its value is `{ <id>: … }`; its `fields` name
  its keys) failed too.
- **Diagnostics snapshot.** Exactly the 12 predicted cases changed, and 9 were added.
- **Digest.** 268 of 268 scenes identical.
- **Test suite.** The full run passes: 109 files, 4,095 tests.
- **Independent review.** It found two bugs in the new code, both fixed with tests:
  - a string `params` made the Validator throw;
  - a wrong-shape slider default also got a bounds message.

  It also found deviations from the plan, which are recorded in the design note, and stale text,
  which is fixed.

## 2026-09-29 — the color model owns the wavelength bookkeeping; a false validator warning

**Wavelength bookkeeping** (plan: [spectra in every slot](docs/claude-spectrum-fields.md), "After
step 3").
- **The spectral color model defines two functions:** `wavelengths_hero(wl)` (lane 0) and
  `spectrum_collapse_to_hero(s)` (lane 0 times N). The transport's one-time collapse and the
  Cauchy and Sellmeier index formulas call them, instead of spelling `vec4(4.0, 0.0, 0.0, 0.0)`
  and `wl.lambda.x`.
- **The comment states the precise condition.** The lanes' joint law is unchanged by a cyclic
  relabeling, and the path before the collapse treats them alike.
- **Checks.**
  - A scan test that no TypeScript source spells a lane failed first, on the three sites.
  - Shader text changes only in dispersive-glass scenes, plus the two definitions in every
    spectral program. Values are identical.
  - `witness:dispersion` passes. Its "missing compensation" mutation now targets the factor in
    the color model.

**The false "envSelectWeight controls nothing" warning.** "Does this renderer sample instanced
lamps" is now one function, `samplesBatchLights` (plan/dataTenants.ts). The Planner and both
Validator checks that asked it call this function. The warning no longer fires when a scene's
only lamps are instanced under the light tree, and it still fires under 'power', where they are
only found by paths. Two tests cover the cases; the first failed before the change.

**Not done: deleting `MaterialProperties.wl` and `MediumProperties.wl`.** Nothing else reads
them, but they are the one member every properties struct is guaranteed to have. Without them,
scenes whose materials are all `none` get an empty struct, which GLSL rejects; the static compile
caught it. The change was reverted, and the review and design note that called them dead are
corrected.

Full test run: 108 files, 4,062 tests. An independent review found no bug; its points (the
comment's precision, a second spelling of the batch-lamp rule in the Validator, a missing
test for the warning's other direction, three stale doc passages) are fixed.

## 2026-09-28 — a spectrum kind never asks whether the render is RGB (spectra-in-every-slot, step 3)

This is step 3 of the [spectra-in-every-slot plan](docs/claude-spectrum-fields.md). The owner
allowed shader-text changes that improve the system.

- **A kind only evaluates itself at wavelengths.** Blackbody, Cauchy, Sellmeier and Gaussian no
  longer branch on the render mode, and `EmitContext.spectral` and `MintContext.spectral` are
  gone.
- **The compiler decides what an RGB program shows for each value: `rgbStandIn`** (beside
  `projectRGB`, which is its emission case).
  - It is the kind's `toRGB`, with a reflectance clipped to [0, 1]. That is the rule the
    preview warning states, and it now fires exactly when the clip changes a value.
  - A constant stand-in is a literal. A slider-driven one is one uniform the CPU recomputes from
    `toRGB` when a slider moves. The kind's sliders stay, and the uniforms only its wavelength
    evaluation reads are not declared.
  - Gaussian's private clipped copy and blackbody's `emitRGB` are gone.
- **The sky's intensity multiplies the finished spectrum** (L = k·K) in all three sky forms,
  through one helper. `EmitContext.factor`, used only by the sky and applied differently by
  different kinds, is gone.

**What the output shows:**
- **Every sky's shader text changes.** The intensity is now outside the RGB lift. RGB values are
  identical; spectral ones agree to rounding, since the lift is exactly 1-homogeneous for k ≥ 0.
- **Blackbody spectral skies are byte-identical.**
- **`hearth`, the one suite scene with an RGB slider-driven blackbody,** reads one stand-in
  uniform instead of `scale × u_<kelvin>_blackbody`.
- **Slider metadata is unchanged** in every scene.

**Verification:**
- A line-level diff of all 495 renderers against step 2 shows only those differences.
- The full test run passes (108 files, 4,059 tests). The GLSL snapshot was updated, sky lines
  only, and two tests that pinned the old RGB blackbody uniform now check the stand-in.
- **GPU:** the spectral, procedural, image-constant, compensated and missed-cap skies, the
  blackbody twin and the RGB sky pass 16 of 16 checks, and `witness:blackbody` passes 48 Planck
  probes. That run preceded a final removal of redundant parentheses around one call in the
  sky text; the values are unaffected.
- **Independent review.** It confirmed the claims, including the homogeneity argument and that
  stand-in uniforms are declared wherever they are read. It found one regression, now fixed with
  a test that fails on the old code: in RGB programs a shared temperature slider lost the range
  its first declaration gave.

## 2026-09-28 — every spectrum setting goes through one path (spectra-in-every-slot, step 2)

Step 2 of the [spectra-in-every-slot plan](docs/claude-spectrum-fields.md) is a refactor in
three parts. Every scene's compiled output is unchanged.

**The rule.** Every spectrum setting reaches the shader through one function,
`emitSpectrum(value, role, site)`:
- the value's kind writes its GLSL;
- its numbers come from one binding function (`emitValue`: constant, slider, GLSL expression or
  per-instance value);
- its role comes from the setting's declaration.

Only the RGB kind converts RGB to a spectrum.

**The parts:**
- **Roles for settings without a descriptor row.** One table, `SETTING_ROLES` (compiler/types.ts),
  holds the roles of the fog's absorption, scattering, glow and index, the sky's radiance, and a
  material's emission when its model has no emission row. A light's emission and a batch lamp's
  emission read their own rows.
- **A per-instance value is a binding.**
  - The record address is written once, beside the packer: `attributeTexel`, and its GLSL twin
    `attributeFetch`. The packer, the App and `emitValue` all use them.
  - The material fill and the batch light arm emit per-instance values through the value's kind,
    and `emitAttributeValue` is gone.
  - `emitSpectrum` takes its site (wavelengths, color model, factor, instance index) as one
    object.
- **Every spectrum goes through its kind.**
  - The last eleven direct RGB conversions now go through `emitSpectrum`: row defaults, the image
    and procedural skies, fog absorption, scattering and glow, fog phase rows, derived fields and
    the light-table payload. The GRIN index goes through `emitIndex`.
  - A number the shader computes (an image lookup, a formula, the fog's clamped field) is the
    expression binding (`glslValue`). The fog keeps its clamp on the numbers, before the kind
    evaluates them.
  - The RGB kind formats constants with `formatSpectrum` (a gray as `vec3(g)`), so that function
    now has a caller and a correct comment.
  - The raw lift is internal to generate/color.ts.

**Verification:**
- **Tests written first.** A scan test failed on the 11 direct conversions; it now finds none
  outside generate/color.ts. A contract test requires every non-RGB emission kind to state its
  light-table row, with unique nonzero codes.
- **Unchanged output.** After each part, the digest is identical for all 268 synchronous scenes,
  and the App's packing fingerprints (tests/app/sceneData.test.ts) are unchanged.
- **Test suite.** The full run passes: 108 files, 4,058 tests.
- **GPU.** `witness:spectral-bindings` passes with 69 probes, as before. It runs the generated
  per-instance, light-row, fog and sky readers on packed data.
- **Independent review.** It compiled 216 more renderers outside the suite in both trees:
  - RGB and spectral;
  - power, tree and uniform selection;
  - per-instance float rows;
  - a 500-instance cloud under the light tree;
  - every sky form and every kind of fog.

  All were identical, apart from one bug that is now fixed and tested: a medium key named like a
  built-in object property (`toString`) was read as a coefficient. The review also found the
  duplicated light and lamp roles, the GRIN index bypass and a misplaced section in the design
  note. All are fixed.

## 2026-09-28 — spectrum settings state their role in one field (spectra-in-every-slot, step 1)

This is the first step of the [spectra-in-every-slot plan](docs/claude-spectrum-fields.md) (Part
2). It is a refactor, and every scene's compiled output is unchanged.

**The rule.** A material, light or phase row that holds a spectrum now has one field, `role`
(emission, reflectance, coefficient or index). A row holding an ordinary number has none.

**What changed:**
- **One field instead of two.** Rows used to spell the role across two fields
  (`semantic: 'radiometric', role: …`, `semantic: 'index'` or `semantic: 'geometric'`). The
  45 descriptor rows and the derived-field rows are respelled.
- **Where the types live.** `SpectrumRole` and the predicate `isRadiometric` ("light or a
  multiplier of light, as opposed to an index") now live in components/descriptors.ts.
- **The reads.** The 18 places that read the old fields now read `role`, and the rebuilt
  ternaries are gone.
- **No role from the value any more.** Six places compared a value's kind against a role written
  out as a literal. They now read the setting's role:
  - the backstop `isIndexFormula` in plan/values.ts is gone;
  - `resolveLightValues` walks the light kind's rows;
  - the list of kinds a spectral program evaluates asks each setting's role.
- **Updated to match:** the probe script `witness-spectral-bindings`, which the type checker
  does not cover, and the documents that pin the row shape (fable-module-anatomy.md, the
  materials and Cauchy READMEs).

**Verification:**
- A scan test forbidding `roles.includes('…')` outside the kinds' folder failed first, on the six
  sites.
- The digest is identical for all 268 synchronous scenes. First, a deliberately wrong role was
  shown to change 260 of them.
- The independent reviewer also found the seven async scenes, and the App's packing of them,
  identical, as well as 23 edge-case scenes, valid and invalid, in three color and estimator
  setups.
- The full test run passes (108 files, 4,055 tests).
- `witness:spectral-bindings` passes with 69 probes, the same count as before the change.
- Older dated documents that quote the old spelling (the spectral design and implementation
  plan, fable-component-system.md, fable-geometry-materials-target.md) are left as history.

## 2026-09-28 — the sky's share of light samples under the light tree

Under light-tree selection, next-event estimation now gives the sky a fixed half of the light
samples and the tree the other half. This is the rule of pbrt-v4's light-tree sampler
(lightsamplers.h:267) ([plan](docs/claude-lamp-power-plan.md), review item A3).

Before, the share was a power estimate that left out instanced lamps, and the scene-size guess
it used left out instanced objects. `instance-lights-sky` sent 0.99 of its light samples to the
sky, and the twin scenes `spectral-packed` and `spectral-packed-ref` disagreed (0.405 and
0.220). A fixed half bounds the cost of a mismatch at about twice the noise. The 'uniform' and
'power' rules are unchanged. The share affects noise only; sampler and MIS weights read the
same number.

**The change:** one line in `envSelectionProbability`. The comments that described the share as
always a power partition now defer to that function (lighting.ts, compiler/types.ts,
plan/types.ts, Planner.ts, Validator.ts).

**Verification:**
- Tests written first:
  - the two twins agree (failed at 0.405 against 0.220);
  - `instance-lights-sky` is 1/2 (failed at 0.99);
  - 'power' is unchanged (0.220).
- The digest differs only in the sky-share values of the 10 light-tree renderers with a sky, in
  5 scenes; shaders and everything else are identical. The values:

  | Scene | Before | After |
  |---|---|---|
  | `spectral-packed` | 0.405 | 0.5 |
  | `spectral-packed-ref` | 0.220 | 0.5 |
  | `spectral-blackbody-tree` | 0.342 | 0.5 |
  | `spectral-materials` | 0.397 | 0.5 |
  | `instance-lights-sky` | 0.99 | 0.5 |

  The same scenes' 'power' renderers are unchanged.
- Full test run: 108 files, 4,054 tests.
- GPU: `npm run witness -- spectral-packed spectral-packed-ref spectral-blackbody-tree
  spectral-materials instance-lights-sky`, 7 of 7 checks. The twin scenes now render identical
  images: they draw the same samples.
- An independent review of the diff found no bug.

**Known, not changed.** The Validator's "envSelectWeight controls nothing here" warning counts
only ordinary lights. So it fires falsely when a scene's only lamps are instanced (Validator.ts,
envSelectWeight check). Instanced lamps' power is still computed by the App while it builds the
tree (review B6).

## 2026-09-28 — spectral review and five bug fixes

A code review of the spectral work ([review](docs/claude-spectral-review-2026-09-28.md): how the
system works, then findings), and fixes for five of its six bugs
([plan](docs/claude-spectral-bugfix-plan.md)):

- **Surface Russian roulette ends a zero-throughput path before dividing.** A path absorbed by
  delta tracking, or zeroed by the wavelength collapse, still reached roulette. When
  `random()` returned exactly 0 (probability 2⁻²⁴), the result was 0/0, and the pixel's mean
  stayed NaN. The interior rule already had this guard.
- **Malformed blackbody values are reported instead of crashing.**
  - Before: `{blackbody: null}` or `{blackbody: undefined}` threw inside the census or the
    Validator, a numeric slider path crashed the compile, and a misspelled `scale` was
    ignored.
  - Now: the census tolerates malformed values; `validate` checks that the entry is an object
    and rejects unknown keys.
  - The slider-structure check (path, min ≤ max) is one function in `components/param.ts`,
    shared by blackbody and `validatePropertyValue`.
- **The reflectance lift no longer overflows for a tiny largest channel.** It divides before
  scaling (`other / z * 63.0`); `63/z` overflowed float32 below about 1.85·10⁻³⁷ and gave NaN.
- **The kelvin slider's default range reaches its default** (it ended at 12000 K even for a
  20000 K default).
- **Per-instance attribute values are checked against the row's own constraint**, through one
  `slotDomain` function shared with `validatePropertyValue`. A per-instance checker `uv_scale`
  of −1 used to pass.

The sixth, the sky-versus-lights split ignoring instanced lights under the light tree (variance
only), waits for an owner decision.

**Verification**

- **Tests first.** Each fix has a test that failed first: vitest for the roulette guard,
  blackbody validation, the slider range and the attribute check; a GPU probe in
  `witness:spectral` for the lookup, which read NaN before the fix.
- **Unchanged output.**
  - A line-level diff of every suite renderer's shaders against f720e64 shows exactly two
    changed lines: the roulette guard (246 shaders) and the lookup line (122 shaders).
  - Everything else is identical, source maps aside: uniforms, their computed values,
    parameters, scene data and warnings, over 495 renderers.
  - One diagnostics-snapshot entry changed deliberately: "kelvin slider min above max" now
    gets the shared "parameter min must be <= max".
- **Test suite.** 4,050 of 4,051 tests pass. The one failure was a glslang timeout while the
  Mac slept on battery; it passes when run alone.
- **GPU** (SwiftShader):
  - `witness:spectral` passes, including the new probe.
  - `npm run witness -- spectral-colored-furnace spectral-plane spectral-materials haze` passes
    11 of 11 checks: the furnace and plane agree with their quadrature targets, and NEE ≡ MIS.
- **Independent review.** A fresh agent reviewed the diff and found no bug. It reported two
  further gaps, recorded in the plan for later: a key beside a named kind is ignored, and no
  check keeps a slider's default within its authored bounds.

## 2026-09-28 — Gaussian reflectance, N-SF11 glass and a spectral showcase scene

Built the [showcase plan](docs/claude-spectral-showcase-plan.md): the first spectrum kind added
since the one-spectrum-type work, and a scene made to be rendered spectrally.

- **`gaussian`**, a reflectance band `{ gaussian: { center, width, peak, floor? } }` in nm
  (`width` the standard deviation; `floor` above `peak` is a notch). Spectral programs evaluate
  it exactly; RGB programs use its RGB stand-in, daylight reflected by the band and divided by
  the same projection of a perfect white, clipped to [0, 1] with a compile warning when a
  saturated band falls outside the RGB gamut. Adding it took one folder, one registry line and
  the new `NamedSpectrumValue` union (which also replaces three places that said
  `BlackbodyValue` for "a named kind").
- **Daylight on the CPU:** `spectral/d65.ts`, the same float32 D65 samples as `curves.bin`,
  with a test that they agree exactly.
- **N-SF11**, a dense flint glass, beside N-BK7 (SCHOTT catalog coefficients, cited; the test
  reproduces n_d = 1.78472 and V_d = 25.68).
- **`spectral-showcase`** (demos/spectralShowcaseScene.ts): an N-SF11 prism throwing a 5800 K
  beam's rainbow on a card; a white (D65) spot and a 2700 K blackbody spot, each lighting a
  Gaussian-band sphere beside its RGB twin (they match under the white light and differ under
  the warm one, in spectral renders only); a red, a cyan and a notch-magenta band; an 1800 K
  ember. Key 1 is the spectral render, key 2 the RGB preview.

Verification: the Gaussian's stand-in agrees with an independent 0.25 nm quadrature of the
shipped curves to 1e-6, and a white reflector gives (1, 1, 1) to 1e-12; seven diagnostics cases
(out-of-domain numbers, the band in emission, medium and index slots, the gamut warning); the
digest leaves all 265 existing scenes identical and adds the three new ones; the full test run,
106 files and 4,033 tests. GPU (`npm run witness -- spectral-gaussian-plane
spectral-blackbody-softbeam`): the Gaussian plane matches its stand-in within 0.0006 in spectral
(PT and MIS) and RGB renders. The blackbody softbeam's NEE/MIS check passes but is weak: in its
setup both estimators take nearly the same samples, so it shows the beam compiles and renders
cleanly, not that its brightness is right (the Planck evaluation itself is checked by the
blackbody witnesses). The showcase itself has not been rendered here.

## 2026-09-28 — one spectrum type, step 4 parked (plan only)

Wrote and reviewed a design for step 4 ([bindings](docs/claude-spectrum-bindings.md)): one
owner for the four ways a number reaches the GPU, and per-instance numbers inside a spectrum
kind (a temperature per star). The owner decided that temperature and brightness stay
decoupled (no `thermal` kind), and parked step 4 until a scene needs per-instance
temperatures. No code changed.

## 2026-09-28 — one spectrum type, step 3: the kinds' folder and one plan field

The spectrum kinds now live in `components/color/spectra/`
([contract README](src/components/color/spectra/README.md)): `spectrumKind.ts`, the registry
`index.ts`, and one folder per kind, with the plain `rgb` kind in its own folder beside
`blackbody/`, `cauchy/` and `sellmeier/`. The registry lists the index formulas, then blackbody,
then `rgb`.

`ProgramDescription.blackbody` and `dispersion.forms` are replaced by one list,
`spectrumKinds`: the kinds a program evaluates at wavelengths, in registry order. The program
links each kind's GLSL helpers from the kind itself (no longer by name in core.ts), and the
packed-row reader takes its header readers from the listed kinds. The `IndexForm` type is gone.
Outside the spectra folder, no code tests for a particular kind at run time: the scan test's
allow-list is empty. (The authored value types in compiler/types.ts still name each kind's
spelling.) Reordering the registry changes one diagnostic: a value carrying both blackbody and
Cauchy keys now lists them as "(Cauchy, blackbody)".

Verification: shader text is unchanged in all 265 digest scenes; the source maps of the 13
scenes that link a moved GLSL file differ only in the new path (a digest with the old paths
rewritten compares 265 of 265 identical). The program-description snapshot changes in all 488
programs by exactly the field swap: 466 empty lists, 18 lists holding `blackbody`, and 4 holding
the index kinds formerly in `dispersion.forms`. Typecheck; the full test run, 104 files and
3,982 tests. Documentation links into the moved folders were updated in the component READMEs
and the spectral docs; CHANGELOG entries keep the paths they had when written.

An independent review compiled 42 further edge scenes (RGB and spectral; zero-dispersion
Cauchy; blackbody only in a light, the sky or a material; open meshes and interior-less batches;
all three kinds together) at both commits: `spectrumKinds` equals the old flag plus forms in
every program, and all 384 generated shaders are byte-identical. Its fixes: the scan test now
excludes only `color/spectra/` and also catches kind objects and authored-key checks; each kind
folder must have a README (the `rgb` kind gained one); `core.ts` skips a listed kind without
helpers instead of assuming it has some; a diagnostics case pins the two-named-kinds message;
stale references to the old paths and the removed field were corrected. Final run: 104 files,
3,983 tests; digest unchanged by these fixes.

## 2026-09-28 — one spectrum type, step 2: fixes from the independent review

A fresh reviewer re-ran the digest (identical before and after both steps), compiled unusual
valid scenes and malformed values against all three versions, and found these problems in
step 2, now fixed. It also found the step-2 entry below incomplete and overclaiming in three
places; that entry has been corrected (the list of newly rejected inputs; "suite scenes" rather
than "valid scenes"; the "can this emit" rules).

- **A crash in validation:** a slider bound that is not a number (`max: 'x'`) made the
  validator throw a raw TypeError, breaking "validation never throws". Bounds must now be finite
  numbers, with a diagnostic.
- **An expression carrying a kind's keys** (`{ kind: 'glsl', …, blackbody: … }`) still passed
  validation, and readers disagreed on it. Expressions now count in the two-kinds check.
- **"Constant and nonzero" now means positive**, like "may be nonzero", so the two answers
  agree; a negative blackbody scale on glass reports only its real error. An index formula is
  never emission for either question.
- **Per-instance colors** use the role's domain function, not a copy of it.
- Smaller: the kinds are listed in lookup order with the plain `rgb` kind last; the role-form
  message picks "a" or "an"; the planner's media backstop names the kind it found; `emitIndex`
  moved beside `emitSpectrum`, removing an import cycle; the medium predicates call the shared
  rule directly; two comments that cited plan steps were rewritten.

The diagnostics snapshot gains eight cases (negative constant albedo and glass tint, slider
bounds below zero or not a number, a light slider with `min > max`, a negative slider on a
non-emitting model, an expression with blackbody keys); one existing case changes (the
negative-scale case above). Verification: digest 265 of 265 identical; typecheck; the full test
run, 104 files and 3,980 tests. Not verifiable here: the seven async data scenes, built from
untracked `.inst` files; the new per-instance sign check would reject a file whose colors have a
negative channel.

## 2026-09-28 — one spectrum type, step 2: one set of checks per role

Every spectrum slot is now checked against its role's domain by one shared checker, the same in
RGB and spectral renders: reflectance, coefficients and emission are nonnegative, an index is
positive, for constants, slider defaults and both slider bounds. The spectral model adds only
what its lift or tracking bound needs: reflectance at most 1, and the media ceilings
([spec](docs/claude-spectrum-spec.md) §8, step 2). Every suite scene compiles exactly as before.

Now rejected with a message, in both colour models (each was accepted in RGB, or crashed):
- negative reflectance (albedo, checker colors, f0, glass tint), negative emission from a
  material or light slider, a negative medium emission, and negative per-instance colors (RGB
  never sign-checked these);
- a slider bound outside its slot's domain (a `min` or `max` below zero on a color or emission
  slider; `max` was never checked before), and a light emission slider with `min > max`;
- an expression as a constant sky's color (RGB would have computed a NaN light-selection
  weight);
- a value carrying two kinds' keys, such as `blackbody` with `param`;
- a zero-area quad light with blackbody emission: the blackbody branch skipped the light kind's
  shape checks, and the compile then crashed on a NaN;
- a Cauchy formula as medium emission, which passed RGB validation and then threw an internal
  error.

Clearer: media take plain values only, with one message for any named kind ("medium.ior cannot
be a Cauchy value — media take a constant, a {param} or an expression", replacing a misleading
"Cauchy is an index form"). Eleven spectral cases that reported the same problem twice now
report it once. Blackbody errors on lights name the field ("Light 0 (point): emission: …").
The Validator's private "can this emit" copy and the medium predicate now use the shared rule
(the light census's "constant and nonzero" still disagreed with it on negative values until the
review fixes below). analyze/spectral.ts keeps only the spectral narrowing; the scan test's
allow-list is down to the Planner's `blackbody` flag.

Unchanged by choice: RGB reflectance above 1 stays allowed, as before. `formatSpectrum`
(unused, with a wrong comment) is left for the owner to decide.

Verification: the digest, 265 of 265 scenes identical (no suite scene newly rejected); the
diagnostics snapshot changes in 23 of 33 cases, each reviewed and summarized above; eight older
tests asserted the old wording or that RGB accepted a negative per-instance color, and were
updated; typecheck; the full test run, 104 files and 3,972 tests.

## 2026-09-28 — one spectrum type, step 1: kinds behind one interface

Blackbody, Cauchy, Sellmeier and plain RGB values are now **spectrum kinds**, each described
once ([spec](docs/claude-spectrum-spec.md) §7; `components/color/spectrumKind.ts` is the
contract, `spectrumKinds.ts` the registry). A kind answers every question the compiler asks
about its values: which slots may hold it, its live sliders, its own domain checks, its RGB
stand-in, whether it can emit, whether it disperses as an index, its GLSL, the sliders it
derives, and how a light-table row keeps it. The compiler asks the kind instead of testing for
a particular one: 28 such tests outside the color folder became 9, each kept on purpose until
a later step (listed in `tests/components/spectrumKinds.test.ts`). A refactor: no compiled
output changed.

- Moved into the kinds: blackbody emission and its temperature slider (from
  generate/values.ts), the index emission and Cauchy/Sellmeier evaluation, the named-kind
  validation blocks (propertyValidation.ts, same messages), the light-table header, the
  packed-row reader, the constant sky (its intensity now passes to the kind as a factor), batch
  light arms, light-row resolution, index-row resolution and the dispersion plan.
- `isValueParam` moved to `components/param.ts`; `color/values.ts` keeps its helpers, now
  answered by the kinds.
- `emitValue` now throws if a named kind reaches it; every such value is emitted by its kind.
  No compile path reached that branch after the move (the full test run and the digest).
- Known difference, malformed input only: a value carrying two kinds' keys (for example
  `blackbody` and `param`) is classified by one registry order everywhere, instead of by each
  reader's own order. No suite scene has one; the diagnostics snapshot is unchanged.

Verification: the step-0 digest compare, 265 of 265 scenes identical (shaders, uniforms,
compute-closure results, parameters, source maps, packed data, warnings), with a one-character
edit to `blackbody.glsl` shown to be caught (9 scenes flagged); the step-0 diagnostics snapshot
unchanged; the new scan test fails on the previous commit and passes now; typecheck; the full
test run (104 files, one structure-test failure for the two new shared files, fixed by listing
them; 3,971 other tests passed).

## 2026-09-28 — one spectrum type, step 0: make the refactor checkable

Preparation for moving blackbody, Cauchy and Sellmeier behind one spectrum interface
([spec](docs/claude-spectrum-spec.md), §8). Tests, fixtures and the digest tool only; no
production code changed.

- **Two compile-only fixtures**, `blackbody-lamp-batch` and `blackbody-equiangular`, bring three
  blackbody routes into the digest and the static GLSL compile: instanced sphere lights under the
  light tree (with packed blackbody rows), a blackbody sky in an RGB render, and a blackbody
  point light under equiangular sampling. No suite scene compiled them before.
- **`npm run digest` now records what every uniform's compute closure returns**, at the parameter
  defaults and at one moved parameter set (part `<renderer>.closures`). Before, closures were
  written as `[fn]`, so live sliders were invisible to it. Two runs agree on all 265 scenes;
  changing only the kelvin slider's closure is reported as "closures differ" in exactly the
  three scenes with a live kelvin, and nowhere else.
- **`tests/compiler/spectrumDiagnostics.test.ts`** snapshots, in RGB and spectral renders, the
  validator's messages and the compile outcome for 33 invalid spectrum values. It pins today's
  behavior, including gaps step 2 will fix: a zero-area quad light with blackbody emission
  passes validation and then crashes the compile on a NaN; Cauchy as medium emission passes RGB
  validation and then throws an internal error; a value with both blackbody and `param` keys
  compiles; negative material or medium emission and an expression sky color compile in RGB and
  are rejected in spectral.

Verification: typecheck (including the digest script under the strict settings); the full test
run, 103 files and 3,965 tests; the existing snapshots change by additions only (441 lines for
the two fixtures); the fixtures' 8 shader programs pass glslang.

Found in passing, not addressed: 221 of the 265 synchronous suite scenes warn that the
transport feature provides `light_query_medium` with nothing requiring it, a pre-existing
exact-linkage gap.

## 2026-09-28 — spectrum-authoring design checkpoint

Paused further authoring implementation for the owner's architecture review. Audited
the shape/strength plan against its existing value, binding, asset and packed-light
owners. Recorded the sequencing deviation: the verified blackbody normalization landed
before the shared representation was settled. Listed the unresolved public API, RGB-mode
projection, CPU resource lifecycle, supported-reader matrix and sampled-storage decisions,
with a concrete design deliverable required before resuming code. Relabelled the plan's
original baseline inventory so it is not presented as today's implementation. No production
code changed and no numerical tests were rerun for this documentation update.

## 2026-09-28 — reference-Y blackbody strength

Blackbody scale now means fixed reference CIE Y in renderer-relative units. The existing
CPU projection supplies the normalizer; every RGB/spectral, constant/live, sky and packed
emitter reader receives it through its existing path. Temperature at fixed scale changes
spectral shape while holding reference Y constant. The active sensor still owns the
measurement response. No GLSL evaluator, transport interface or runtime fallback was added.

Converted the seven blackbody gallery scenes' authored strengths and the live witness
overrides explicitly, preserving their source spectra at the specified settings. The
direct-emission and selective-receiver numerical targets are unchanged. The component
README records the scale conversion and the new meaning of temperature sweeps. The
historical formula-comparison report is explicitly labelled with its former normalization.

Verification: independent SI/serialized-observer integration checks unit Y, scale linearity
and signed RGB. All 48 generated-reader GPU probes pass, including integrated reference Y
at 1000, 3200, 6500 and 40000 K; discarded-form and old-normalization mutations fail.
The full Vitest run passed 3,896 tests and identified 15 expected authored-scale snapshot
changes; after review/update, all 484 structural snapshot tests pass. Typecheck and build
pass. Compiled digests leave all 256 non-blackbody scenes identical.
All nine targeted rendered checks pass: both direct-emission modes retain their numeric
target, the selective receiver agrees under PT/NEE/MIS, live/constant pairs agree, and
power/tree sampling agrees. This is the blackbody slice, not the full historical GPU sweep.

This implements the blackbody normalization step only. Shared normalized RGB controls
need CPU access to the reconstruction atlas, currently loaded by the App after compilation.
The common authored shape/amount form, sampled spectra and lamp presets remain planned.

## 2026-09-28 — shape and strength direction (accepted; not implemented)

Expanded the spectral implementation plan with a common evaluated-curve-times-amount
operation, independent of light geometry and camera response. Distinguished raw measured
values from explicitly normalized authoring shapes, retained the physical meanings of
light and reflectance properties, and compared photometric, band-energy and peak
normalization. The owner accepted fixed-reference CIE Y for ordinary light colour
controls; raw spectra preserve supplied values and material reflectance retains its
fractional meaning. Pinned the relative-Y formula, the Planck strength conversion and
its deliberate change to fixed-strength temperature sweeps. Implementation starts with
consistent RGB/Planck controls before sampled curves and lamp presets. Exact authoring
syntax and storage remain design work. No renderer behaviour changed.

## 2026-09-28 — production spectral-authoring research

Surveyed primary documentation for Indigo, Octane, Maxwell and Wētā's published
pipeline, plus Mitsuba/PBRT spectrum interfaces and source. Recorded evidence and
limitations in `docs/claude-spectral-authoring-survey.md`, with recommendations for
a shared sampled value, explicit role-specific interpretation, unnormalized raw curves
and source-backed lamp presets. CIE fluorescent metadata provides a concrete linear-
interpolation/zero-extrapolation example. Updated the active plan and removed the old
blanket 5 nm resampling prediction. Authoring syntax, strength conventions and storage
remain proposed; production code is unchanged by this research.

## 2026-09-27 — emission authoring priorities (plan only)

Recorded the owner's usage order in the spectral implementation plan: blackbody,
artist-coloured sources (RGB or HSV authoring), then specific lamp spectra and outdoor
illuminants. The proposed next slice uses one sampled-emission form with source-backed
presets, independently of light geometry. Normalization, interpolation, wavelength
coverage and narrow-band energy preservation remain contracts to pin before coding.
No new emission forms or presets are implemented by this planning update.

## 2026-09-27 — Sellmeier indices and an N-BK7 example

Added constant three-term Sellmeier surface indices, with dimensionless B and C in
micrometres squared. The normal-dispersion domain requires finite nonnegative triples,
no poles in 360–830 nm, and positive finite index throughout. The all-wavelength
validation uses monotonicity and endpoint values, not a sampled grid. RGB evaluates
the same formula at the helium d line; constant-index forms fold to scalars.

Shared authored-index helpers live in the existing colour values module. The planner
records the used formula kinds, and generated index access includes only those helpers.
The transport loop, BSDFs and one-time collapse are unchanged. Added an authoring
constant for nominal SCHOTT N-BK7 with vendor provenance and a thin-stripe prism scene;
the constant supplies index only, not absorption or temperature dependence. Component,
design and status docs describe the supported form and remaining scope.

Verification: CPU indices agree with eight vendor-tabulated spectral lines. All 21 fixed
GPU probes pass, including Sellmeier index and oblique refraction in both region layouts;
a missing-square-root mutation fails. The integrated N-BK7 slab agrees with independent
Fresnel quadrature within measured sampling error. The complete targeted dispersion GPU
script passes, including its existing analytic/tracked/GRIN medium comparisons and
collapse-order mutation. This does not replace the historical full-scene GPU sweep.

The full Vitest run passed 3,910 checks and found one shared-file location violation;
after moving the helpers into the existing values module, all 661 affected structure,
purity, dispersion and program-snapshot checks pass. Final typecheck and build pass.
All 262 pre-existing scene digests remain identical; only the N-BK7 fixture is added.
The helper relocation also preserves every compiled output, checked by all 263 digests.
The N-BK7 prism was rendered at 160×128 and 256 spp; its oblique view shows a chromatic
stripe through the glass. Final scene compiler/snapshot checks and typecheck pass.

## 2026-09-27 — Cauchy surface dispersion

Smooth and rough glass accept constant `ior: { cauchy: [A, B, C?] }` with finite
A > 0 and B, C >= 0. Spectral rendering evaluates the original function at the hero
wavelength; RGB uses the helium d-line index. Descriptor-declared index rows govern
validation and both region-table layouts. Scalar indices and zero-dispersion Cauchy
need no collapse. Other index forms and spatially dispersive GRIN remain deferred.

At the first index-consuming dispersive boundary, transport multiplies future
throughput by `(4,0,0,0)` once, before NEE and BSDF sampling. Earlier radiance, ray
wavelengths and camera PDFs are untouched. Index-independent boundaries retain all
lanes. No BSDF body, engine interface or texture layout changes were needed.
The component README documents ownership, the prehistory symmetry argument and scope.

Verification: all 3,865 tests passed before the additional beam demo; typecheck and
build passed. Thirteen fixed generated-GLSL probes cover Snell entry/exit, internal
reflection, coefficient/hero reads, collapse and preceding volume emission. Missing
and repeated compensation mutations fail. Integrated GPU comparisons cover the
independent normal-slab quadrature and monochromatic reference paths through analytic,
tracked and wavelength-independent GRIN media, including rough glass and an inside
camera. A surviving-lane probe rejects collapse after rough NEE. Comparisons use
measured standard errors; rough-glass NEE remains noisy. The registered slab image
also passes its independent mean check. These are targeted GPU gates, not a full sweep.
With the beam demo added, 1,755 targeted compiler, static GLSL and scene-data checks
pass, as does typechecking. All 259 pre-dispersion scene digests remain identical;
only the three new dispersion fixtures are added.

Gallery scenes include a refracted white stripe and a separate finite-cone softbeam,
prism and receiving screen with a visible floor. The latter uses existing hittable
aperture paths to form a slowly converging caustic; straight shadow sampling cannot
follow the refracted chain. No new caustic sampler or artificial visible beam was added.

## 2026-09-27 — one normalized Planck emission definition

Replaced the production Kim RGB approximation with normalized Planck in both colour modes.
Spectral readers evaluate the original spectrum at the ray wavelengths; RGB uses its signed
fixed-reference CIE projection. The active camera sensor does not define emitter normalization.
The largest reference RGB channel equals `scale`, with a supported domain of 1000–40000 K.
Blackbody is now explicitly emission-only; invalid authored dials are diagnosed, with no
runtime temperature clamp or fallback colour. True 1000 K replaces the old 1667 K clamp.

Temperature-derived chroma/normalization is separate from scale. This fixes shared-temperature
emitters accidentally sharing their intensity, and shared-intensity emitters sharing their
colour. Constants, live surfaces/lights, constant skies, mesh emitters and batch emitters use
the same definition. Light-table headers retain a Planck tag, temperature and gain beside the
RGB payload; no new texture, registry, stride, transport interface or engine capability.
Original-form packing is independent of renderer order. The old fit remains only as a
historical audit helper. Component and design docs describe the implemented contract.

Verification: independent SI quadrature; 44 generated Planck GPU probes with a rejected
original-form-loss mutation; all 69 existing spectral binding probes and their mutations;
full Vitest suite (3,831 tests), followed by 66 targeted checks including two added scalar
instance-attribute regressions that failed before their fix; typecheck and production build.
The final scalar-attribute correction leaves all 259 compiled scene digests identical to the
first implementation. Against the pre-migration baseline, all 251 existing scenes other than
Hearth are byte-identical; Hearth changes intentionally, and seven Planck fixtures are new.
Snapshot additions are the explicit Planck feature flag and the new fixture records.

All nine new rendered checks pass across the targeted runs: true 1000 K RGB/spectral
emission, the selective receiver under PT/NEE/MIS, live/constant equality at default and
changed settings, and power/tree NEE/MIS equality. The receiver's initial 24×24 run narrowly
missed the blue-channel tolerance under NEE; increasing to 48×48 at the same 1024 spp
passed all three estimators without changing the 0.002 tolerance. PT/MIS blue errors fell
to 0.0003/0.0001. These are targeted gates; the full historical GPU sweep was not rerun.

## 2026-09-27 — blackbody migration comparison (audit only)

Added `scripts/audit-blackbody.ts` and its measured comparison report. The audit integrates
Planck through the shipped CIE sensor, compares the existing RGB approximation at every
integer temperature from 1667 to 25000 K, and checks 0.5/0.25 nm quadrature refinement.
Maximum signed channel change is 1.392% of the unit peak at 1667 K (negative blue formerly
clipped); after display-only clipping the maximum is 0.189% at 2759 K. At Hearth's 2900 K
default it is 0.180%. True 1000 K is measured separately from the old 1667 K clamp.

The script writes JSON and a standalone HTML swatch comparison; the page was rendered and
visually checked in Chromium. A selective receiver distinguishes the Planck spectrum from
an RGB reconstruction with nearly equal direct colour. Quadrature refinement discrepancy
is at most 3.913e-12 in the existing range; the ratio formula matches direct SI evaluation
within 7.106e-15 at the checked temperatures/wavelengths. Production code and rendered
scenes are unchanged. D5 migration and its temperature-domain contract remain proposed.

## 2026-09-27 — spectral GRIN with wavelength-independent index

Enabled four-wavelength transport through the existing GRIN walker: spatial absorption
and emission fields, constant/live scattering coefficients, and constant/live/spatial
scalar index fields. All wavelengths share the trajectory; raw index GLSL is authored
wavelength-independent. Dispersion and packet collapse remain planned. The existing
index accessors already receive the carrier, and no loop, interface or sensor change
was needed. Deflecting fields remain exempt from straight tracking's ceiling and clamp.
Emissive scattering and expression coefficients with scattering in one GRIN region
remain rejected; opaque shadows and geometric/step/budget limits are unchanged.

Reused the analytic source-integral helper for full GRIN steps, exit partials and the
near-wall segment. Absorption now uses the actual coefficient, with exact vacuum and
stable small-optical-depth emission in both colour modes. A selected zero-extinction
channel has no finite scattering event, including an exact zero random draw; the sampler
no longer invents a small collision rate.

Added eight spectral GRIN fixtures (seven witnesses and a reference), including a
Luneburg gallery scene. Generated GPU probes check four unequal absorption/source lanes,
zero-absorption emission, a known curved trajectory, and zero-rate sampling in both the
full walk and the near-wall segment. All 69 binding/BSDF/media probes pass and reject
six intentional defects, including the old GRIN source floor and artificial collision
rate. The first mutation run exposed an incorrectly targeted test mutation (it altered
the straight analytic sampler); restricting it to the GRIN function makes the check
reject the intended defect.

Static checks: 3,712 of 3,714 tests passed in the full run; two shader tests timed out
under concurrent load. The complete 950-test static shader file passes on its separate
rerun, as do all 11 new GRIN compiler tests. Typecheck and production build pass.
Snapshot additions are only the eight scene-data records and nine program descriptions.
Compiled-output digests leave 229 existing scenes identical. The 15 existing GRIN scenes
change shader/source-map output; scene data, read contracts and warnings are unchanged.
Eight spectral scenes are added, and the same seven asynchronous scenes are skipped.

Rendered validation: all 12 checks pass across 16 renders (seven spectral checks and five
RGB regressions). The spectral slab reads (0.7256, 0.4958, 0.2963) against independent
quadrature (0.7252, 0.4955, 0.2959); luminous vacuum reads about 1.4997 against 1.5.
Hard-interface, emitting and scattering spectral furnaces retain 0.4/channel within the
specified tolerances. Spectral scattering agrees with the straight analytic reference
(0.11% mean difference, 2.35% display RMSE), and Luneburg NEE/MIS agree (0.15% mean
difference, reduced chi-square 0.17). RGB source/scattering twins and all three RGB
furnaces pass. These are targeted checks, not a new full witness sweep.

## 2026-09-27 — spectral volume emission

Enabled RGB constant, live and expression volume emission through the existing absorbing
and scattering routes. Emission uses the D65 emission lift; extinction uses coefficient
lifts. Expression fields scale all three RGB densities together before lifting. The
existing delta/ratio loops collect the source before the collision lottery/weight update;
those loops and the transport contract are unchanged. Emission remains path-found.

Homogeneous emissive scattering now applies the colour model's bound to the live RGB
extinction ceiling. Both coefficient dependencies update the existing derived uniform.
The spectral component README proves that the existing outward-rounded envelope also
covers this unclamped route. Each authored coefficient component is limited to 2^17 for
this route, keeping the derived ceiling within the certified range; live writes carry
the same contract. RGB derived rates remain unchanged. The positive sampling-rate floor
does not change the physical extinction, including luminous vacuum.

Corrected the inherited analytic emission integral in both colour modes: attenuation uses
actual absorption, and a small static GLSL helper evaluates the source integral stably.
Its vacuum limit is exactly the segment length. A fourth-degree polynomial at optical
depth below 0.1 avoids cancellation; the omitted term is bounded by 1.4e-8. The helper
is linked only for analytic emitting arms. No artificial absorption floor remains there.
GRIN still uses the older per-step/boundary formula; that follow-up is recorded in
CLAUDE.md and must precede spectral GRIN enablement.

Static validation: all 3,659 tests in 99 files, typecheck and production build pass.
The generated GPU binding suite passes 62 probes and rejects four deliberate defects,
including the old artificial-absorption expression in luminous vacuum. The majorant suite
passes 81,920 lane margins before null clamping and rejects both an RGB rate and a stale
live spectral rate. Independent 0.25 nm wavelength quadrature supplies slab and finite-
scattering-order targets; halving the step changes them by less than 3e-11.

Compiled-output digests preserve 234 existing scenes exactly. Only `emit` and
`grin-emit-ref` change for the analytic integral correction; shared data, read contracts
and warnings are unchanged. Eight spectral emission fixtures are added, and seven async
scenes remain outside the digest. GRIN and non-RGB forms remain gated in spectral mode;
tracking still supports PT/NEE, not MIS.

All 18 targeted render checks pass across the eight spectral fixtures and the existing
RGB `emit`, `emit-swap`, `emit-driven` and `emit-sat-budget` scenes. Spectral slab errors
stay below 0.0034 per channel; analytic and tracked luminous vacuum both return the
1.5 target within 0.0024. Scattering orders 0–2 and the live-rate fixture agree with
their independent targets within 0.0025. Glowing fog PT/NEE differs by 0.21% in mean
and 5.64% display RMSE. Command: `npm run witness -- spectral-emit spectral-emit-tracking
spectral-emit-clamp spectral-emit-vacuum spectral-emit-vacuum-tracking spectral-emit-budget
spectral-emit-driven spectral-emit-scatter emit emit-swap emit-sat-budget emit-driven`.
The additional `npm run witness -- grin-emit` regression also passes against its corrected
analytic reference: mean difference 0.06%, display RMSE 2.13%. This checks the existing
moderate-absorption fixture, not GRIN's unresolved near-vacuum formula.

## 2026-09-27 — spectral surface RGB expressions

Enabled RGB-valued expressions on each surface model's radiometric rows: albedo,
checker colours, f0, interface transmittance and Lambert emission. The existing resolver
already evaluates the RGB formula before the role-specific lift at the hit wavelengths;
the production behavior change is only removal of the spectral validation gate.
World position, surface UVs and declared live float controls retain their existing bindings.
No transport, BSDF, storage, light-selection or runtime-clamp machinery was added.

The [spectral README](src/components/color/spectral/README.md#surface-rgb-expressions)
documents the author contract: finite RGB results, reflectance components in [0,1],
nonnegative emission, at every evaluated point and live control value. Parameter bounds
are not colour bounds; negative phase controls may produce valid colours. Expression
emission remains path-found. Emissive/GRIN media, non-RGB forms and reflectance gain
above one remain outside the supported set.

Validation: the full run passed 3,595 tests and exposed one obsolete foundation test
requiring expressions to be rejected. Removed that case, now covered by positive
per-property GLSL compilation checks; all 12 remaining foundation tests pass on rerun.
Typecheck and production build pass. All 49 generated GPU binding/BSDF/media probes pass,
including 16 surface-expression cases covering every radiometric row, distinct p/uv
samples and two live control values. The new lift-before-RGB-blend mutation fails as
intended, alongside the existing instance-index and absorption-illuminant mutations.

All seven rendered checks pass: constant-expression and spatial-expression twins against
four constant patches under PT/NEE/MIS (mean and display RMSE below 0.001%), plus the
existing RGB expression twin. Command: `npm run witness -- spectral-expressions-constant
spectral-expressions expr-const`. All 233 existing synchronous scene digests remain
identical; three fixtures are added and seven async scenes remain outside the digest.

## 2026-09-27 — spectral bounds and nonemissive heterogeneous media

Enabled RGB-expression absorption/scattering under the existing delta/ratio trackers for
PT and NEE. The colour descriptor supplies separate field and sampling ceilings: the
field still uses the common RGB scale before either coefficient is lifted; the sampling
rate bounds their reconstructed sum over wavelength. Main and shadow dispatch share that
rate. There are no changes to the tracking loops, PathState, engine contract or scene-data
layout. Volume emission, GRIN, MIS with tracking, equiangular heterogeneous lighting and
non-RGB forms remain outside this stage.

The [spectral README's Tracking bound](src/components/color/spectral/README.md#tracking-bound)
derives `4*A*(1+delta)^5/(1-delta)^2`, delta=2^-20, for the documented numerical domain.
It accounts for field-clamp arithmetic, separate coefficient amplitudes, their sum, and
both field/rate literal conversions. The CPU evaluates a finite chain of binary64
products/division and steps above round-to-nearest float32; that step also covers host
arithmetic error. The nominal ceiling range [2^-60, 2^18], finite evaluated components
at most 2^60, and zero-or-at-least-2^-120 effective vector maxima are explicit conditions,
not a claim to support infinities or arbitrary subnormal normalization. Compilation checks
the ceiling and authored constants/declared controls; expressions and live writes carry
the stated numerical contract. The sampler bound does not repair undefined expressions.

The sigmoid now enforces its mathematical [0,1] range after finite evaluation. Asset-wide
coefficient/node checks bound the intermediate polynomial and rule out overflow in that
calculation. Both spectral table samplers explicitly request highp through a compiler-owned
texture precision fact: the default float qualifier does not control texture-fetch return
precision (GLSL ES 3.00 §8). The independent lookup probe and benchmark use the same
qualifier. Other float samplers retain their declarations; their portability audit is
recorded as a follow-up in CLAUDE.md, not claimed complete here.

Final static checks: 3,554 tests in 98 files, typecheck and production build pass. GPU checks:
61,440 lane margins are finite and nonnegative before the null-coefficient guard; substituting
the RGB ceiling for the spectral rate fails. All 52 four-wavelength lookup cases and both
wavelength proposal/PDF/white integrations pass (worst lookup error 9.64e-7); the three
compiled spectral defects remain rejected. All 33 generated binding/BSDF/media probes and
their two mutation checks pass. `npm run witness:spectral-majorant` joins the manual GPU CI
job. The rounding unit check includes field-up/rate-down neighboring float32 values.

The final compiled-output digest preserves 203 existing scenes exactly, changes the spectral
programs in 26 scenes for the bounded lift/highp declarations, and adds four tracking scenes.
Existing shared scene data, data-read contracts and warnings are unchanged; RGB programs,
including the RGB strategies in the two mixed-colour sky fixtures, are unchanged. Seven
async scenes remain outside this digest.

All nine targeted rendered checks pass. The varying-density slab and live ceiling-clamp
fixture agree with independent wavelength quadrature within 0.0011 per channel; camera
and shadow extinction agree within 0.0002. Delta-tracked fog differs from its analytic
homogeneous twin by 0.92% in frame mean with NEE (display RMSE 23.38%) and 1.11% with
PT (RMSE 21.40%). Both spectral white checks and the existing RGB heterogeneous slab
pass. Command: `npm run witness -- spectral-tracking-slab spectral-tracking-clamp
spectral-tracking-shadow spectral-tracking-fog spectral-direct het-slab`.

## 2026-09-27 — spectral homogeneous absorption and scattering

Enabled nonemissive homogeneous media with RGB constants or live RGB coefficients,
inside bounded regions or as the ambient medium. The existing resolver lifts absorption
and scattering separately with the coefficient role, without D65. The existing four-lane
analytic distance mixture, HG/Rayleigh phase models, PT/NEE/MIS, shadow transmittance,
interior roulette and delta-light equiangular placement use the ray wavelengths. The
production changes are the validation gate and the analytic sampler's zero-rate case;
there is no transport-loop, engine-contract, data-layout or parameter-system change.

Zero selected extinction now goes directly to boundary survival, even for an exact zero
random draw. The previous `max(sigma_t[c], 1e-9)` invented a finite collision rate whose
sampling density did not match the reported mixture. This correction also applies to RGB.
The existing small-PDF normalization floors are unchanged; extreme optical-depth behavior
is not certified by this stage. Spectral expression coefficients, volume emission, GRIN,
non-RGB forms and reflectance gain above one remain gated. The all-wavelength numerical
majorant certificate is still required before enabling tracking; the analytic stage needs
no such majorant. The plan's §5.3 records the mixture argument and staged scope.

Validation: 3,512 tests in 97 files, typecheck and production build pass. All 33 generated
GPU binding/BSDF/media probes pass, including live absorption updates, distinct coefficient
roles, shadow attenuation, all four selected collision/survival lanes, distances and vacuum
endpoints. Both the lost-instance-index and absorption-with-an-illuminant mutations fail
as intended. Independent 0.25 nm wavelength quadrature gives the coloured unit slab target
`(0.725201886, 0.495462039, 0.295891864)` and its camera-plus-shadow target
`(0.509533833, 0.244752846, 0.081877565)`; halving the step changes either by less than
7e-12. `npx vite-node scripts/audit-spectral-media.ts` reproduces these references.

All 12 rendered checks pass across the six new fixtures and the existing RGB `slab` and
`furnace-scatter` regressions. Spectral fog NEE/MIS differs by 0.24% in frame mean
(reduced chi-squared 0.48); the PT tripwire differs by 0.37% (display RMSE 22.48%).
Equiangular versus collision placement differs by 1.52% (reduced chi-squared 0.95).
The worst slab channel error is about 0.0011, against a 0.005 tolerance. HG and Rayleigh
furnaces pass their 0.4 equilibrium targets. Command: `npm run witness -- spectral-slab
spectral-shadow-slab spectral-scatter-furnace spectral-rayleigh-furnace spectral-fog
spectral-fog-placement slab furnace-scatter`.

The compiled-scene digest preserves 160 existing scenes exactly. The other 63 existing
scenes include the analytic volume source and change with its zero-rate correction and
source-map lines; six spectral fixtures are added. Seven async scenes remain outside the
digest. The new fixtures cover coloured slabs, both wavelength proposals, scattering ignored
on camera and shadow paths, HG/Rayleigh equilibrium, fog estimator equality and medium
light placement. See the colour component README for commands and remaining gates.

## 2026-09-27 — correct HDR mantissa scaling

RGBE import now uses `byte * 2^(exponent - 136)` and decodes exponent zero as black.
This matches the exporter's 256 mantissa scale, removing the 256/255 brightness
multiplier. The lower-edge decoding convention matches
[stb_image's HDR decoder](https://github.com/nothings/stb/blob/master/stb_image.h);
Radiance's own decoder uses the same scale but reconstructs at the bin midpoint.
The spectral image fixture now encodes exactly `(0.25, 0.5, 1)` and uses that reference.

Validation: known decoded values, zero-exponent black, exact representable export/import
round trips and a one-mantissa-step quantization bound; 700 tests across the loader,
exporter and three snapshot suites pass, as does typecheck. All three image witnesses
pass: image/constant Δmean 0.07%, sampler comparison 0.15%, RGB mean
`(0.2502, 0.5005, 1.0009)`. Only the constant-image reference's three planning snapshots
change. Removed the resolved decoder defect from current-status documentation.

## 2026-09-27 — spectral image and procedural skies

Enabled image and procedural environments in spectral mode. The existing radiance
paths already filter/evaluate authored RGB, apply intensity, and lift at the supplied
wavelengths. Procedural radiance still comes from the formula; its bake only guides
sampling. Formulas carry a finite/nonnegative RGB author contract between bake samples.
Table construction rejects invalid samples, and intensity validation now covers all
environment kinds. No runtime radiance clamp or transport-loop changes were added.

Corrected two inherited environment estimator issues in both RGB and spectral modes.
Uncompensated tables mix 1/16 uniform-sphere sampling with their CDF proposal, becoming
entirely uniform when empty; both branches return the full mixture density. This covers
features missed by the bake and HDR masses lost in float32 CDFs. Compensated tables
remain MIS-only and may intentionally have zero density. Equirectangular cells now use
uniform azimuth/cos(theta) sampling and exact solid angles, with stable polar coordinates
and an explicit azimuth convention at the poles. CDF normalization uses float64 row
sums before float32 storage and no longer floors positive row mass at 1e-20.

`witness:environment` passes ten GPU cases across both charts: independent sphere
quadrature, directional histograms, HDR support, empty/compensated tables and RNG
endpoints. The largest quadrature discrepancy was 0.32% on the discontinuous octahedral
table density. Four deliberately wrong implementations fail: missing uniform support,
component-only density, midpoint cell area and uniform-UV equirect placement. The
spectral binding probe now has 23 passing cases, including filtered image RGB and rotated
procedural radiance at four unequal wavelengths.

Twelve rendered checks pass. Image/procedural showcases with a finite light agree across
NEE/MIS and charts within 0.37%/0.12%. A cap missed by both bakes returns its analytic
0.095 target in RGB and spectral modes; empty compensated skies return 0.5. A loaded
RGBE image matches an equivalent decoded-RGB constant sky within 0.07%, chart/estimator
agreement is 0.15%, and the existing rotated RGB sky regression differs by 0.02%.
The initial 4×2 image fixture was rejected by the loader's existing 16×16 minimum;
the corrected fixture passes through the real load path. The first eight render checks
preceded the final explicit-pole convention, which was separately checked by the GPU
endpoint/histogram probes and static shader tests.

All 96 files / 3,430 tests pass; final fixture/pole edits additionally pass 701 targeted
tests, typecheck and production build. Of 217 existing synchronous scenes, 212 compile
identically. Only the five tabulated-sky scenes (sky, sky-lamp, proc-sky, proc-sky-rotated,
tonemap) have intentional shader/source-map changes; existing scene data and planning
snapshots are unchanged. Six sky fixtures were added. This is a targeted GPU run, not
a full witness sweep or native-GPU performance measurement.

Separate finding: HDR import divides mantissas by 255 while the exporter scales by
256 (`engine/loaders/hdr-loader.ts` versus `app/utils/file-export.ts`), a 256/255 scale
mismatch before quantization. This stage preserves the decoder; the image reference
uses its actual decoded RGB and does not certify RGBE format accuracy. Correcting that
decoder and its existing tests needs its own before/after record.

## 2026-09-27 — spectral surface materials

Enabled the existing mirror, GGX, checker, dielectric and rough-dielectric models in
spectral mode alongside Lambert. Material colour validation now reads each descriptor's
radiometric roles: both checker colours, conductor f0 and interface tint use the bounded
reflectance domain; emission remains nonnegative. Constants and live colour parameters
use the existing lift. Glass keeps its scalar, wavelength-independent IOR. This changes
validation only: no BSDF, transport, runtime fallback or interface changes. Media,
expressions, non-RGB forms, reflectance gain and dispersion remain gated or undecided.

Extended the generated-binding GPU probe to 21 cases, including four-lane normal-incidence
BSDF weights/evaluation against closed forms for the newly admitted models. Added four
rendered witnesses, all passing at 512 spp: the coloured mixed-material scene's NEE/MIS
means differ by 0.54% (reduced chi-squared 0.59); the grey mirror returns approximately
0.5; the air/water radiance-compression witness returns approximately 0.554; and first-event
rough-glass light-tree selection agrees with power selection within 1.25% (chi-squared
0.25). The latter keeps the original 2.5% mean tolerance. An exploratory eight-bounce,
roughness-0.2 inclusion comparison was too noisy for that gate: 4.32% at 512 spp and
5.02% at 2048 spp, both within about one combined standard error. The committed witness
isolates the first surface event and uses roughness 0.5; it does not establish a precise
multi-bounce power/tree comparison. The mixed-material witness separately covers multiple
bounces and roulette. The new gallery scene is `spectral-materials`.

All 213 pre-existing synchronous scene digests and snapshots are unchanged; four scenes
are additions. Typecheck and production build pass. The full 95-file / 3,327-test run had
one five-second timeout in an unchanged spectral-direct static-compile case; its focused
rerun passed without changing the timeout or implementation. All other tests passed,
including the new schema-domain and isolated/mixed-model compilation checks. Updated
fixture snapshots pass. These are targeted GPU checks, not a full witness sweep.

## 2026-09-27 — live spectral colour controls

Enabled RGB `{param}` values for spectral Lambert albedo/emission, authored lights and
constant-type skies. The existing uniforms and wavelength-aware lift handle live values;
the production change is in spectral input validation. Defaults are required and checked
against the role's domain, as are declared slider bounds. Live writes carry that same
author contract; slider ranges are UI metadata, with no new runtime clamp or validation
layer. Reflectance remains in [0,1]. Expressions, non-RGB forms and media remain gated;
existing light-tree and material-emitter eligibility restrictions still apply.

Added `spectral-live` with surface, lamp and sky controls, plus constant references at
default and changed values. Three GPU scene checks pass at 48×36, 256 spp: live defaults
and changed colours agree with constants, and NEE agrees with MIS (0.08% mean difference,
reduced chi-squared 0.56). `witness:spectral-live` exercises repeated edits in one running
renderer at 32×24, 32 spp: defaults, changed RGB, zero lamp/albedo, scalar colours with
unit albedo, restored session, and a sky changed to zero. The live renderer is not
recompiled. The largest pixel-channel discrepancy from a constant render was 5.97e-8;
defaults, zero lamp/albedo and restored defaults matched exactly. A zero live sky returned
zero radiance. Unit checks additionally cover scalar broadcasts, default/range diagnostics,
selection-weight updates, and mixed RGB/spectral compilation order.

All 209 pre-existing synchronous scene digests remain exactly unchanged; four live-colour
fixtures are additions. Seven async scenes are outside the digest check. All 94 files /
3,279 tests, typecheck and production build pass. These are targeted GPU checks, not a
full witness sweep or a native-GPU performance measurement.

## 2026-09-27 — spectral packed lights and instance colours

Enabled the packed-data subset of S1b: ordinary light-tree rows, instanced Lambert
surfaces and per-instance RGB albedo/emission arrays. The generated readers already
lift authored RGB at their supplied wavelengths; this change admits those routes after
verification and checks attribute values against their descriptor's radiometric role.
Shared scene data remains authored RGB. Reflectance is still restricted to [0,1]; the
proposed research-gain extension remains undecided. Live colours/expressions, non-RGB
forms, other material models and media remain gated.

Added `spectral-packed` and `spectral-packed-ref`, viewable in the lab. Four numeric
scene checks pass at 48×36, 256 spp: packed attributes versus individual materials
(0.14% mean difference), packed light rows versus inline lights (0.05%), and NEE versus
MIS for instance and ordinary lights (0.04% and <0.01%). Reduced chi-squared values
are 0.22–0.65 with the same pinned random salt. Direct GPU probes execute 13 generated
readers against the actual scene-data packer and serialized spectral model: nested/flat
attributes, params/frame placements, seven table-supported light kinds, and sampled
instance emission versus hit-side emission. All four lanes pass at 2e-5 absolute
tolerance; a deliberate lost-instance-index mutation is rejected.

All 207 pre-existing synchronous scene digests are exactly unchanged, including the
four spectral foundation scenes; the two new scenes are additions. Seven async scenes
remain outside that digest check. Mixed RGB/spectral ordering preserves renderer output,
scene-data plans and packed bytes. All 93 files / 3,224 tests, typecheck and production
build pass. No full GPU
witness sweep or native-GPU performance run was performed for this subset.

## 2026-09-27 — restricted spectral foundation

Implemented S1a: four wavelengths on rays, uniform/visible wavelength proposals, the
Jakob–Hanika RGB lift and a CIE 1931 sensor. The sensor owns the signed linear-sRGB
response; the colour model integrates four lanes using their individual camera PDFs.
Resolved sensor, proposal and model version appear in export metadata. RGB shader output
and authored shared data retain their existing meaning.

The initial capability set is constant-RGB Lambert albedo in [0,1], constant RGB emitters
and skies, PT/NEE/MIS, without media, instancing or light-tree reads. Validation rejects
other spectral inputs. Runtime binding coverage, physical blackbody, media bounds, gain
above one and dispersion are not implemented. Constants still perform the shader lookup;
CPU coefficient folding is not claimed as built.

Added a pinned, licensed offline generator and two versioned RGBA32F assets (12,587,008
bytes total). Repeated generation produced identical bytes and metadata. The serialized
lift's 1,367-colour quadrature audit measured RMS channel error 0.0005581, maximum error
0.013779 and quadrature refinement discrepancy 2.30e-9. App provisioning follows declared
texture references, reports missing/corrupt assets by name, and reuses cached bytes after
context loss. Production builds now include the lab entry point as well as the gallery.

Validation: typecheck/build and 92 test files / 3,192 tests pass. A yield between synchronous
static shader checks prevents worker message-queue starvation; no production timeout was
added. All 203 existing synchronous RGB scene digests are exactly unchanged (seven async
scenes excluded). Mixed RGB/spectral compilation preserves renderer output and shared data
under reordering. GPU lookup/sampling/signed-film probes pass and reject shared-PDF,
omitted-lane and early-clamp mutations. Twelve transport checks cover direct emission,
grey/coloured furnaces and a coloured plane under PT/NEE/MIS; 30 additional renders across
three salts pass their predeclared channel tolerance. Dev and production context
restoration reproduce identical pixels and do not refetch immutable assets. This is targeted
coverage, not a complete witness sweep. Lookup microbenchmarks report SwiftShader draw/readback
wall time; native GPU and heavy-scene ray-carriage costs remain unmeasured.

## 2026-09-27 — authored blackbody preservation and two-channel enforcement

Implemented S0c / scene-once step 4. Blackbody temperature and scale survive material, light
and environment planning. The colour family owns authored-form predicates and `projectRGB`;
the unchanged RGB approximation lives in `color/rgb/blackbody.ts`. Shader constants, live
bindings, power selection and RGB packing share that projection. Planner and Validator share
the driven predicate. Instanced light arms accept retained forms; their packed power data no
longer falls back to black for a non-array emission.

Fixed an existing zero-scale blackbody sky census inconsistency: it is now nonsamplable like
an RGB black sky. Emission gates also recognize fixed zero scale, including driven temperature;
a driven scale remains potentially emissive. No stricter authoring validation was introduced.
Shared RGB rows and light headers stay unchanged. The form registry, form-code readers and
physical spectral evaluation remain S1 work, as recorded in the spectral plan.

Added 26 compiler tests for retained forms, exact RGB compiled/packed equivalence at six sites
(surface, mesh, point, quad, batch, sky), zero scale, renderer order, and live colour/selection
updates. Eleven equivalence cases passed before the refactor; zero-scale sky tests the census
correction. The complete static shader suite now runs under both RGB and a test-only RG model:
lifts take `.rg`, and film projection yields `(r,g,0)` after sensor response. The canary is not
a public strategy. Its numerical GPU probes also reject wrong-channel and bypassed-sensor
mutations.

Validation: typecheck and build passed; all 90 files / 3113 tests passed, including 377 static
shader cases in each representation. All 203 synchronous scene digests are exactly identical
(seven async scenes excluded), including shader text, uniforms and packed scene data. Nineteen
fixed-salt SwiftShader frames match the S0b baseline exactly at 32×24, 16 spp (oneshot: one
sample): Cornell with all six cameras, furnace variance/oneshot, slab, GRIN scattering furnace,
instanced tree lights with sky, medium shadows, procedural sky, and the six blackbody sites.
The variance attachment also matches. All six cameras produce identical tiled/whole HDR and
PNG pixel bytes at 96×80, four spp, four tiles. Colour probes pass 17 cases and reject five
compiled mutations; carrier probes pass 30 cases and reject ten mutations. This is targeted
GPU coverage, not a full high-sample witness sweep or a spectral performance measurement.

## 2026-09-26 — wavelength carriage and RGB conversion boundaries

Implemented S0b: current wavelengths live on `Ray`, arrival wavelengths on `Hit`, and resolved
material/medium records retain their evaluation carrier. All six cameras take the already
sampled carrier. Continuations, shadows, local-frame rays, index queries, GRIN, light accessors,
packed light rows and environments pass it explicitly. The original camera sample remains
with the accumulator for sensor integration; throughput and radiance remain path state.

Radiometric rows declare reflectance/coefficient/emission roles. The colour model evaluates
constants, live bindings, expressions, attributes and texture reads at the supplied wavelengths;
RGB conversions are identities. Authored RGB medium clamps and sky filtering/formulas run
before conversion. Blackbody keeps its existing RGB calculation; authored-form preservation
and physical spectral rendering are still later stages.

Added `npm run witness:wavelengths`, sharing a small float-framebuffer runner with the colour
probes. Thirty numerical cases use a visible four-value carrier and nonidentity test lifts.
Ten mutations must compile and fail numerically: lost arrival/spawn/property/local carriers,
substitution or overwrite of camera wavelengths, discarded packed RGB, bypassed coefficient
conversion and the wrong clamp order. Camera and current-ray test wavelengths differ;
placement/camera bindings use valid defaults, skies use nonzero intensities, and the light
row test uploads the actual scene-data pack. The shared property-struct builder owns `wl`;
the obsolete empty-struct placeholder is removed.
The probes run in the existing opt-in GPU CI job. Updated camera/trace/colour contracts.

Validation: typecheck and build passed; all 89 test files / 2707 tests passed, including 377
static shader cases. All 47 shader snapshots were reviewed by change category; non-shader /
source-map metadata is identical. The digest retains identical packed data, resource reads
and warnings across 203 synchronous scenes (seven async scenes excluded). Five fixed-salt
SwiftShader renders match the committed foundation exactly: Cornell/average, furnace/variance,
furnace/oneshot, slab and GRIN scattering furnace, including the variance attachment.
The 14 colour probes and three mutations pass; the 30 carrier probes and ten mutations pass.
Targeted furnace, scattering furnace, slab, heterogeneous slab, clamp and GRIN scattering
witnesses pass all nine checks. This is targeted GPU coverage, not a full scene sweep or a
measurement of the future four-wavelength model's performance.

## 2026-09-26 — review and close the RGB foundation gaps

Added `npm run witness:color`: a standalone SwiftShader check of the shipped colour GLSL,
with 14 numerical cases and three deliberately broken shaders that must fail numerically.
It covers N=2,3,4 reductions/channel selection, signed/HDR RGB values and a nonidentity sensor.
The check is documented and runs in the existing opt-in GPU CI job; it replaces the temporary
primitive probe as the repeatable gate. Added the colour family to the structural tests and
reconciled the stale film signature and camera wavelength guidance. No executable renderer
behavior changed in this cleanup; wavelength carriage and value conversion remain outside
this foundation's scope.

Validation: typecheck/build passed; all 89 test files / 2707 tests passed, including the
updated shader snapshots. The 14 GPU cases passed and all three defects were rejected.
The previously recorded before/after image comparison remains a one-time measurement on
SwiftShader, not a claim of complete S0 coverage or a permanent cross-device identity test.

## 2026-09-26 — RGB colour and film foundation

Added the colour family with an RGB occupant, explicit camera-sample/film projection boundary,
and shared spectrum reductions/channel selection. The three accumulators now call
`color_to_pixel`; its RGB implementation calls the existing `sensor_response`. The sensor
owns the measurement response, including future spectral response curves. Analytic and GRIN
media share the channel selector. No spectral renderer or wavelength-carrying ray is enabled.
Value-conversion plumbing is scheduled with the real carrier in S0b rather than a temporary
API; authored-form preservation stays in S0c.

Validation: typecheck and production build passed; 89 test files / 2705 tests passed (including
377 shader compile cases). Reviewed and updated 47 shader snapshots: their fields outside
shaders/source maps are unchanged. All 203 synchronous scene digests retain their scene data,
reader sets and warnings (7 async scenes excluded by the existing digest tool). Five fixed-
seed before/after SwiftShader renders matched every float, covering all accumulators, an area
light, absorbing media and scattering GRIN; variance output matched too. Targeted witness run
(`furnace furnace-scatter slab grin-furnace-scatter`) passed all 6 checks. Separate GPU probes
executed the shipped reductions and channel selector at N=2,3,4, and verified signed/HDR film
values plus a nonidentity sensor response. The full witness sweep was not run.

## 2026-09-26 — follow-up spectral correctness audit

Extended the spectral implementation plan with explicit form-ID/header ownership, bounded
float32 proof obligations, environment support and density corrections, and tests that detect
metameric blackbody substitution. CPU probes of the current importance builder demonstrated
empty-bake support loss and erased HDR probabilities; source analysis also found the equirect
subcell sampling/PDF mismatch. Recorded reproducible inputs and remaining GPU gates in §12.
These are proposed fixes and documentation changes; no renderer implementation changed.

## 2026-09-26 — incorporate spectral plan review

Revised the spectral plan after the review in §11: cameras receive sampled wavelengths;
procedural sky radiance stays a direct formula evaluation; surface collapse requires a
material that consumes region index; built-in assets are allowed external texture sources;
carrier overhead gets an explicit benchmark. Proposed a scaled bounded lift for nonnegative
research reflectances above one, with threshold and binding-site tests. Preserved the review
record and its unchecked correctness gates. Updated related design/camera/resource contract
documentation. Documentation checks only; no shader, TypeScript or runtime behavior changed.

## 2026-09-26 — spectral implementation plan for adversarial review

Added docs/claude-spectral-implementation-plan.md: accepted and proposed decisions, explicit
ray/camera-sample contracts, authored forms and asset ownership, conservative medium bounds,
collapse ordering, staged S0–S2 work, analytic/GPU gates and a reviewer brief. The plan records
proposed departures from the design, including a typed camera geometry intermediate, initial
binary-search table lookup and deferred arbitrary wavelength GLSL. Indexed and linked the
plan; no renderer implementation. Checked documentation links, structure and whitespace.

## 2026-09-26 — spectral wavelength ownership and design review

Recorded the owner's decision: current wavelengths travel on `Ray` and the arrival record;
original camera wavelengths and sampling PDFs stay with the estimator. Updated the spectral
proposal and noted the approved, unimplemented extension in the trace-loop contract.
The proposal records review requirements for one-time collapse, fully specified dispersion
witnesses, the unverified pbrt bias claim, the two-channel canary, RGB rounding and GPU lookup
precision. No renderer code changed; verification was a documentation diff and consistency review.

## 2026-09-26 — plan the scene once, then each renderer (steps 0–3)

As planned in docs/claude-scene-once-plan.md (owner-approved). Decided with the owner first: keep
N renderers per scene (a real renderer plus a fast preview; strategies compared side by side),
plan the scene once, and let nothing the renderers share depend on any renderer's settings.
Spectral is being built next, so the colour step is designed for it.

| Commit | Step |
|---|---|
| 54e576c | `npm run digest`: a digest of every suite scene's compiled output (shader text, uniforms, parameters, source maps, the scene-data plan's packed contents, warnings); `--compare` names the scenes and parts that differ. It refuses to write a digest without shader text. |
| fed4950 | Test: compiling a scene's strategies in reverse order changes no renderer's output and not the scene-data plan (91 suite scenes with two or more strategies). |
| 97cb768 | `planRenderers`: `planScene` (no strategy, no layout) → `planProgram` per renderer → the union of reads → `placeScene` (addresses, once). The scene-data plan comes from the placed scene, not `plans[0]`. The trial runs against every optional structure (`programDecisions`, `READS_EVERYTHING`) are gone. |
| eb06bae | An emissive object's light is built from its planned surface and material; `lightRosterOf` keeps only identity (batch 4 item 2, option b). |

- **No change to the compiled output:** the digest is identical for all 203 non-async suite
  scenes after steps 2 and 3. The 7 async data scenes fetch `.inst` files and are not compiled
  by it; their code paths (instance clouds, instanced lights, the light tree) are in 5 other
  suite scenes.
- **The `plans[0]` premise held:** before step 2, all 91 multi-strategy scenes already compiled
  identically in either order.
- **The tests can fail.** The order test fails with a light's radiance doubled only under
  light-tree selection (3 scenes), with a generator counter kept between compiles (91), and with
  a generator appending to the shared materials after step 2 (91). The rewritten census test
  fails with lights built from the unplaced authored parameters, and with the mesh light's area
  missing the scale. The digest tool refuses when Maps are not expanded, and reports a changed
  GLSL comment (196 scenes) and one changed packed float (6 scenes).
- **Tests:** "decisions do not depend on the data layout" is deleted (owner), since the
  decisions function has no layout input any more: 362 cases, one per scene and strategy pair,
  so vitest went from 3058 to 2696. The census test's comparison of object lights with their
  surfaces became true by construction. It now checks authored area lights against their
  regions, and the object lights against values it computes with its own rotation.
- **Compile time:** no measurable change (the whole suite takes 240–400 ms either way; repeat
  runs vary more than any difference).
- **Open:** step 4 (colour conversion becomes a renderer step) waits for the spectral design,
  which another instance is writing. Step 5 (split Planner.ts) is the owner's call. The docs
  describing the Plan stage are updated: CLAUDE.md, docs/compiler-system.md (its Plan section,
  stale before this, now rewritten) and docs/claude-data-exact-linkage.md.
- tsc clean; vitest 2696 passing.

## 2026-09-26 — review batch 5: tests that can fail

Review Part 3, test-only work as planned in docs/claude-review-batch5-plan.md (owner: "if this is
test stuff do it"). Every item was re-checked first. Every new or changed test was run against a
deliberately broken version of the code it guards: it failed there, and passed once the code was
restored. The breakages were never committed.

| Commit | Test | Broken code it was run against |
|---|---|---|
| 2269993 | The CWBVH over four identical boxes keeps every item once (the old check was `order.length`, always n) | the builder writing item 0 twice |
| 827c32f | The procedural-sky params rule, with the real `params` shape (no `as any`), and an empty list accepted | the rule inverted |
| b4b7d3d | RGBE export clamps a negative channel to 0 | the clamp removed (the byte came out 230) |
| 535af02 | PNG export round-trips a 1000×800 image, which spans three write batches | the filter's previous row reset at each batch (the small-image test still passed) |
| a018f4b | Each emitter's light values equal `valuesFromRegion` of its **planned** surface and material emission, across 6 lights (2 self-comparing assertions replaced) | emission without the blackbody fold (3 tests fail); placement ignoring the transform (the new test fails; the old assertions passed) |
| 1d4b287 | `mesh-light-smooth`'s text: it guards the spawn rule, not the MIS pdf normal (worth ~0.05% here) | — |
| 67a95d1 | `null-budget`'s pt tripwires at 1.5× the measured rmse (97%, 112%) | — (a black arm reads ≥ 200%) |
| 18a6051 | New witness `emit-sat-budget`: the fog budget at `maxBounces` 0, 1, 2 against the exact truncated sums | the fog branch's budget off by one: N = 1 read N = 0's value, N = 2 read N = 1's |

- **`emit-sat-budget` numbers:** channel means over salts 11/22/33 (160×120, 96 spp): N = 0 exactly
  0.77778 (no noise); N = 1 1.0372 ± 0.0004 against the exact 1.0370; N = 2 1.1236 ± 0.0004 against
  1.1235. So the renderer honours "at most N events" inside media.
- **Paused (plan §"Paused"):** 5.5, rough glass at η = 1. Its premise was wrong. Measured with the
  twin at η = 1 ± 10⁻⁴: the samples converge on −wo, but the weight is 0.999, 0.612 and 0.219 for
  (cos θ, roughness) = (0.9, 0.3), (0.3, 0.8) and (0.1, 0.9), while the η = 1 shortcut transmits
  everything. The rough dielectric is therefore discontinuous at η = 1 (microfacet masking loss),
  and the shortcut is the physical answer, not the model's limit.
- **Owner-approved, done (d10152a):** a `{param}` camera row's slider bounds must satisfy the
  row's constraint, as its default does. For `fov` that is (0, π). A missing bound warns, because
  the panel then shows a free number box. The test was written first and failed before the rule.
  All 20 slider-driven fovs in the suite already comply.
- **Owner-approved, done (4635a64):** a witness check kind, `tiled`. On `cornell-area` the runner
  renders with `app.renderTiled` (160×120 in 64px tiles: a 3×2 grid with partial edge tiles),
  then in one piece at the same size, spp and pinned salt, and compares the saved files: the HDR
  pixel bytes and the PNG image data must be identical. It passes. With `renderTiles` not
  setting the tile's pixel offset, it fails (54291 of 76800 HDR bytes and 41637 of 57720 PNG bytes
  differ). CLAUDE.md and docs/production-rendering.md no longer call this untested.
- **For the owner (not done):** a witness for the mesh light's pdf normal (research).
- vitest 2967 passing; tsc clean.

## 2026-09-26 — review batch 4: one answer per fact

Review Part 2, as planned in docs/claude-review-batch4-plan.md: twelve commits (d61e76a …
db0c163), each a fact that was decided in more than one place, now decided once by the layer that
owns it. No step was meant to change a picture.
- **The approved plan was re-checked mid-batch.** Its "nothing reads `CompiledScene.dataReads`"
  was false: a search cut off at ten lines hid a test reader. The re-check, with complete searches,
  corrected seven claims before any further code. `dataReads` is kept.

- **Removed:** the materials feature's always-empty `defines`.
- **App:** `RenderCoordinator.fail` calls the one stop sequence. A test pins the event order
  (error, then stop).
- **Validator:**
  - one rule for emission on a model that cannot emit (it gave two diagnostics);
  - camera rows shape-checked once;
  - the similarity scale and rotation rules are stated once, in similarity.ts
    (`scaleProblem`, `quaternionProblem`, `AXIS_DEGENERATE_LENGTH`). Object transforms, instance
    placements and the Planner's runtime quaternion guard all use them.
- **Witness constants:** fixtures read `MAX_DIST` and `SHADOW_BACKOFF` from math.glsl (sun-haze;
  fog-sky's e^{−σ·1000}). A test pins the three expected values, and they are unchanged.
- **Lighting generator:** reads the Planner's `environmentSelectionLive` in its four functions.
- **Which objects are lights:** the light registry answers "shape T can be sampled"
  (`regionLightKind`); the geometry descriptor flag `samplableAsLight` is removed. The census's
  shape leg is its own predicate (`isSamplableEmitterShape`), used by the census, the mesh
  predicate and the Validator.
- **One spectrum resolver:** `resolveColorProperty`, moved to compiler/plan/values.ts, also
  resolves emissive objects' and authored lights' emission. Two redundant blackbody pre-folds are
  gone.
- **Scattering media:** the Planner records which media scatter
  (`ProgramDescription.media.scatteringMedia`, via `mediumScatters`), and the generators read the
  record.
- **Instanced sphere lights:** the App computes their tree boxes and powers with the sphere light
  descriptor's `treeBounds`/`power`, from a plan entry that now carries the kind and the emission
  colour.
- **One equirect mapping:** `equirect_uv` (components/env/equirect/equirect_map.glsl) is used by
  the chart and by the image sky's lookup. The chart registry's `needs` includes it wherever the
  chart is, the bake shader included.

**How "no change" was shown:**
- The generated GLSL changed only at step 4.12, and only as planned: the `equirect_uv` function
  and its comments, in 19 renderers of 5 scenes (proc-sky, proc-sky-rotated, sky, sky-lamp,
  tonemap).
- The compiled output of all 202 suite scenes (shaders, uniforms, defaults, parameters, the
  scene-data plan) is identical before and after steps 4.9–4.11. The only intended differences
  were the new `scatteringMedia` record, which is not shipped, and the batch-light plan entries
  of the five scenes with instanced lights.
- *Corrected Sep 26:* the digest first used for this recorded no shader text (it wrote the
  shader Map as `{}`) and packed arrays only by length, and the "6 programs" count came from the
  GLSL snapshot test, which covers about 40 cases. Both claims were re-checked with a digest that
  includes shader text and array contents, at bb80148, d35859b and db0c163: the results above.
- The scene-data byte fingerprints are unchanged, light tree included. That includes a new case
  with per-instance emission colours, which no suite scene covered; it was recorded before the
  change.
- `sky`, `sky-lamp` and `proc-sky` give identical results on their 7 checks (160×120, spp as in
  the registry, salt 1234, fresh renders). The `sky` scene rotated by 2.0 gives identical frame
  means to 10 digits on its four estimators.
- tsc clean; vitest 2950 passing.

**Left open:**
- A `{param}` emission on a model that cannot emit still gets two warnings (this rule's, and the
  general "knob the model doesn't read" rule). This predates the batch.
- The scene/program restructure: plan the scene once, then each renderer against it. Item 2's
  option (b) waits for it.

## 2026-09-26 — review batch 3: shadow rays aimed at the light point

Review item 1.2, as planned in docs/claude-review-batch3-plan.md, in two commits. The three
witnesses below were written first and failed on the old code.

- **The fault.** A shadow ray starts `hit.eps` off the surface (`ray_spawn`) but kept the
  direction computed from the unmoved hit point, so it ran parallel to the segment it should
  test and passed beside the light point. Seen at a slant, a light that is scene geometry then
  blocked its own light — whenever ε·[(−n_g·n_l)/cos θ_l − cos θ] > `SHADOW_BACKOFF` — and
  pt-nee and pt-mis read darker than pt.
  - Receivers affected: marched surfaces (ε = 10⁻³); every surface in a program with a GRIN
    medium (the spawn margin is floored at 10⁻³ there); surfaces far from the origin (the
    fp-relative margin is 3·10⁻³ at 100 units).
  - Lights affected: every light that is scene geometry — emissive objects, mesh lights, and
    authored quad, disk, sphere and softbeam lights, which become scene objects. The review had
    said authored lights were safe.
  - The media shadow walker added one more offset at every null-interface crossing, where it
    re-spawns the ray.
- **The fix.** The ray keeps `ray_spawn`'s origin and is re-aimed at the light point with a new
  ambient function, `ambient_direction_to(from, to)` (Euclidean: `normalize(to − from)`). The
  walker re-aims after every re-spawn. Only visibility changes: the BSDF, the cosine and the
  pdfs keep the sampled direction. Every light is aimed the same way, the sky and the sun
  included (their light point is on the far clip).
- **Witnesses** `shadow-aim-march`, `shadow-aim-far`, `shadow-aim-fog`: a floor under a disk
  light, with an exact value. The first two use the coaxial-disk view factor; the fog slab uses
  a Simpson quadrature, checked in shadowAim.test.ts. pt, which casts no shadow ray, is the
  control. Measured at 160×120, 256 spp, the runner's salt 1234:

  | witness | exact | before: pt-nee / pt-mis / pt | after: pt-nee / pt-mis / pt |
  |---|---|---|---|
  | march (marched floor, authored light) | 0.9846 | 0.827 / 0.876 / 0.985 | 0.983 / 0.985 / 0.985 |
  | far (floor at x = 100, emissive object) | 0.9846 | 0.473 / 0.863 / 0.985 | 0.983 / 0.986 / 0.985 |
  | fog (two marched null crossings) | 0.9504 | 0.598 / 0.839 / 0.951 | 0.950 / 0.952 / 0.951 |

  - The "before" values match the plan's geometric predictions (0.828 / 0.876, 0.475 / 0.862,
    0.603 / 0.838).
  - With only the surface fix, fog still read 0.600 / 0.839; it passed after the walker fix.
  - Tolerances come from a three-salt spread (salts 11, 22, 33) measured before the fix: pt-nee
    sd ≈ 0.0037, so its tolerance is 0.015; pt-mis and pt have tolerance 0.005.
- **Measured, not fixed.** Both effects below come from the spawn offset itself, not from the
  aim. They belong to the open fp-spawn-margin item.
  - pt reads 0.98474 and 0.98498 in the open scenes. That is exactly the disk's view factor from
    the raised origin, 4/(4 + (0.25 − ε)²).
  - After the fix, pt-mis reads +0.05% (march) and +0.14% (far), growing with ε. A hypothesis,
    not checked: the MIS weight converts the BSDF sample's density from the hit point while its
    ray starts at the raised origin.
- **Also.**
  - The epsilonCoupling check that `SHADOW_BACKOFF` ≥ 2·`MARCH_CLEARANCE` is removed; its
    premise was this fault.
  - `SHADOW_BACKOFF`'s comment now states its one remaining job (the light's own rounding
    error). It also says the back-off is a fixed length: NEE ignores an occluder within 0.002 of
    the light point, which a BSDF ray sees.
  - Corrected the texts that described the old premise: light.md, lights/README.md,
    trace-loop-contract.md, and the reference-implementations §4/§5 notes.
  - Deviation from the plan: the witnesses also had to be filed in a gallery section
    (pages/sections.ts).
- **Targeted witnesses** (21 existing scenes, 42 checks): all pass — cornell-area,
  cornell-disk, orb, mesh-light-twin, mesh-light-smooth, softbeam-wall, tiny-sphere-light,
  veach-mis, hundred-spheres, instance-lights, field-glass, shadow-medium, emit-scatter,
  fog-area, null-budget, region-overlap, instance-fog, sun-haze, sky, beam-slab, spot.
  region-overlap needed a re-run. Its first attempts ran while the Mac was in idle sleep, which
  made them look like a 170× slowdown (a timeout and a page reload). Awake, the same code renders
  8 samples in 3.9 s, against 6.0 s before the fix, and the check passes.

Not in this batch: deriving `SHADOW_BACKOFF` (it needs the light's normal in `LightSample`),
and the curved-space distance in the walker (`length()`).

## 2026-09-25 — review batch 2: contained correctness fixes

The fixes planned in docs/claude-review-batch2-plan.md, one commit each. Where a unit test
was possible it was written first and failed before the fix; fixes inside `App` (which has no
test harness) were checked by a headless probe of the live app, run on the old and the new
code.

- **Session restore** (1.4): the environment values the App measures from the loaded map go
  to the engine directly and are dropped from restored sessions, so a session can neither
  remove them (the engine then sampled a 1×1 table) nor overwrite them with another map's.
  Probe: removed / overwritten before, unchanged after.
- **Tiled rendering** (1.5): leaving production clears the tile offset and image size (unit
  test); `renderTiled` refuses a second job instead of silently killing the first (probe: 0
  files saved before, 1 after), rejects with `RenderStoppedError` when stopped (it resolved),
  and restarts interactive rendering only when nothing else is running. The case that last
  rule guards — a production started while the PNG is being written — could not be reproduced
  in headless Chromium even at 7680×4320.
- **Exports** (1.6): auto-export starts every export (each reads its buffer when called) before
  awaiting any encode, and `exportAllAOVs` reads every AOV before encoding one (unit test).
- **Context restore** (1.7): start/resume/production requests are refused while textures are
  re-registered; any error is shown (frame errors never were, although the overnight runtime
  entry below says they are); a failed environment load is not recorded for later restores; a
  finished production returns to interactive. Probe: all four cases failed before, pass after.
- **A second `initialize()`** (1.8): for the same scene, all strategies are recompiled together
  on one scene-data layout; for another scene, the old renderers are unloaded (unit tests; the
  witness runner's variance path re-rendered mesh-light-twin and fog-area with identical
  numbers).
- **Environment colour** (1.10): validated with the shared spectrum checker (unit test).
- **Small items** (1.11): the rough dielectric compares the two indices rather than their
  quotient against 1; mesh-light sampling rejects a NaN normal (both unreproducible on
  SwiftShader: 18 checks of the rough and mesh-light witnesses identical before and after);
  cancelling OBJ faces get a face normal instead of (0,0,0); `compileScene([])` reports a
  diagnostic; `maxBounces`/`maxNullCrossings` above 2³¹ − 2 are rejected (the `<=` loops need
  one more increment); CI's push runs no longer cancel a dispatched witness sweep (checked by
  reading; no YAML parser here); the glslang harness reports a crashed validator as a crash.

Not in this batch: the fp spawn margin (needs a measurement plan), and review items 1.1–1.3.

## 2026-09-25 — review of the Sep 24–25 work; the documents corrected

- **Review.** Five read-only reviewers read the 33 commits 8d04f34 … cdccd81 against CLAUDE.md's
  standards, and their findings were checked against the code:
  docs/claude-review-2026-09-25.md (correctness items, duplicated decisions, tests that cannot
  fail, wrong documents, history in comments), each marked by how it is known, with a proposed
  fix and a batch order. The review itself changed no code.
- **Batch 1 (documents).** The normative transport documents (fable-reference-implementations
  §4/§5, fable-compiler-contracts §6.1/§7.2) now say what is superseded — the separate shadow-
  segment limit, the old bounce loop, a 1e20 light distance, fixed-EPSILON spawning, the old RR
  rule — and where the implemented form lives. The GRIN hard-stop claim is corrected everywhere
  (GRIN entry below). CLAUDE.md's status claims and the design documents are corrected (the
  sweep's scope, the data textures, the App's remaining derivation, pixel- not byte-identical
  tiling, built work listed as deferred, "always uploaded" structures). The same-day entries
  below are consolidated; corrections are marked *Correction (review)*.

## 2026-09-25 — the tracking collision cap, derived per segment

The delta and ratio tracking loops stopped at a fixed `MAX_NULL_COLLISIONS` = 64 tentative
collisions. A walk that reached it dropped the rest of its segment — the attenuation still owed
and the emission not yet collected — although the comments called that conservative. Whether it
binds depends on the scene's majorant, so it cannot be a measurement field; it is a step limit
(taxonomy §4.1), which must not decide the picture.

- **Now** each loop is bounded by `tracking_cap(σ̄·t) = ⌈λ + 6.5√λ + 12⌉` (delta_tracking.glsl),
  where λ = σ̄·t is the mean number of tentative collisions over the segment it walks. A walk
  runs out only if N ≥ cap for N ~ Poisson(λ), which has probability below 1e-10 for every λ:
  checked exactly at 16 values of λ from 1e-3 to 1e6 in tests/compiler/nullBudget.test.ts
  (constants read from the GLSL); the supremum is the λ → ∞ normal limit, 4e-11. The tracking
  weights are bounded, so this probability bounds the bias. The bound adapts to slider-driven
  majorants, moving regions and closed rooms without any analysis.
- **Tried the same day and dropped:** a fixed cap of 1024 with a Planner warning
  (compiler/plan/trackingBudget.ts, deleted; `derivedMajorant` is back in materials.ts), and a
  fixed-size box around groundfog's fog (reverted: a fixed box is an arbitrary cut of the world
  that someone editing the formula has to know about).
- **Measured on groundfog**, the one demo whose fog is open to the sky. (fogblobs and glowblobs
  sit in a closed Cornell room — front wall at z = 5 — so their longest segment is ≈ 7.9 units,
  ≈ 65 collisions at σ̄ = 8.2.) Witness-runner renders at 160×120, 128 spp, the pinned witness
  salt, strategy pt-nee-het. The old cap of 64 changed the image by at most 0.09% (the horizon
  band; whole frame 0.05%): the attenuation it dropped multiplied a black sky. With the derived
  bound the image matches the cap-1024 render to five digits (whole frame, top and bottom
  quarters). SwiftShader frame times, which include shader compilation and so are rough: 6.5 s
  at cap 64, 13.6 s at cap 1024, 14.5 s with the derived bound (a variance-mode render).
- **Correction (review):** the budgets entry below said constant media never have null
  collisions because σ̄ = σ_t. That holds only for grey media; for a chromatic constant medium σ̄
  is the largest channel's σ_t, so the other channels have null collisions. The derived bound
  covers them like every other medium.
- **Tested:** het-const, het-slab, clamp, het-driven, emit-swap, emit-sat, emit-driven and
  emit-scatter, 11 checks, all pass with numbers identical to the earlier runs. Not run:
  het-driven-theta2 (a slider set after load). Open fogs still pay σ̄ × 1000 steps per escaping
  ray; improvements §3.3 (local majorants) is the plan.

## 2026-09-25 — GRIN: one event per traversal, unbiased roulette for long ones

A GRIN traversal charged one bounce per 512 integration steps (`MAX_ODE_STEPS`), so which paths
the measurement kept depended on the integrator's step size — a step limit charged against a
budget, which taxonomy §4.1 forbids. Now:

- **A traversal is one event** of `measurement.maxBounces`, however long it is.
- **Long and trapped traversals end by Russian roulette inside the walker**: every
  `GRIN_ROUND_STEPS` (512) steps the ray survives with probability `GRIN_ROUND_SURVIVAL` (0.9)
  and a survivor's weight is divided by it. Unbiased; only those rays get noisier. Radiance
  collected before a kill is kept (it belongs to the prefix). The walker owns the roulette, so it
  works with the strategy's roulette off (ratio tracking's precedent). Both arms (absorbing and
  scattering) do this; capture, roulette kill and the hard stop share one exit, `grin_no_return`
  (first committed as `grin_killed`). A readability pass moved the round check into one helper,
  `grin_round_survives`, and gave both arms an explicit `round_comp` (the absorbing arm had
  divided its transmittance `absorb` by the survival probability, which read like absorption).
- **Hard stop**: `GRIN_MAX_ROUNDS` (200) rounds. `MAX_ODE_STEPS` is gone.
  *Correction (review):* this entry called the stop harmless because a traversal reaches it with
  probability 0.9¹⁹⁹ ≈ 8·10⁻¹⁰. A survivor carries weight 0.9⁻¹⁹⁹, so the stop drops the full
  contribution of traversals longer than 102,400 steps: a fixed step limit that can decide the
  picture (taxonomy §4.1). Giving up without it is part of the GRIN design note.

Lenses that leave within 512 steps (every registry GRIN witness) never draw and are unchanged.
New witness `grin-long`: an orthographic view through a 30-unit and a 60-unit `ior: 1` region at
a unit sky with maxBounces 1. The old walker read 0.0000 on both halves (the bounce budget cut
every ray); now 1.0000 (2 rounds) and 1.0009 (5 rounds). Targeted run: grin-long and the eight
`grin-*` witnesses, 10 checks, all pass (furnaces 0.3989–0.4002 against 0.4); `rough-grin`, which
also runs the walker, was not run. Full sweep not run.

## 2026-09-25 — budgets vs step limits (taxonomy §4.1), and a survey of the step limits

The taxonomy now separates **budgets** (truncations: predicates on paths, counted the same way
by every technique) from **step limits** (loop bounds inside the machinery: estimator side,
must be shown unreachable, never charged against a budget). A survey of every loop bound:

- checked and unreachable: the light tree's 48 levels (the builder caps depth).
- warned at build only (fixed sizes that still drop subtrees past them): the binary BVH stack
  (64), and now the wide BVH stack (24): `buildCWBVH` warns when its depth reaches
  `CWBVH_STACK_DEPTH`; the random 50,000-sphere cloud in cwbvh.test.ts measures under half.
- diagnosed: the tracking collision cap (then by a Planner warning; derived since, entry above).
- still able to decide the picture: GRIN's `MAX_ODE_STEPS` (charged against `maxBounces`
  until an unbiased give-up rule is designed), and the SDF marcher's step budget when a ray
  runs out of steps farther than 16× the acceptance tolerance from a surface (reported as a
  miss, rest of the interval unexplored).
- not limits: fixed-count loops that set accuracy or define a shape (GRIN exit bisection, SDF
  refinement, fractal iterations).
- *Correction (review):* the survey said it covered every loop bound but missed the wide-BVH
  walk's fixed 65,536-iteration guard; GRIN's later hard stop belongs on the same list.

The bias ledger gains a row for numerical tolerances (the marcher's acceptance and its grazing
rule, the ODE step, refinement counts, spawn margins), with the limit tolerances → 0.

## 2026-09-25 — declared budgets in media: `maxNullCrossings`, the collision cap

Three fixed budgets could make the image depend on the estimator or drop energy silently
(docs/claude-improvements-2026-09.md §1.2).

- **`measurement.maxNullCrossings`** (default 32) replaces the walk's fixed `MAX_NULL_CROSSINGS`
  and the shadow walker's separate `MAX_SHADOW_SEGMENTS = 8`. It is a declared truncation: paths
  with at most K null-interface crossings, counted along the whole path. A shadow ray gets what
  its path has left: `shadow_transmittance` takes a third argument, `crossings_left`, which the
  NEE sites fill from the generated `shadow_crossings_left(s)`. With the old limits, a shadow ray
  needing more than 7 crossings returned zero while pt counted the light. The Planner resolves
  the field (`compiler/plan/measurement.ts`, `resolveMeasurement`), the Validator requires a
  non-negative integer, and the taxonomy's bias ledger lists it.
- **The tracking collision cap** went from 64 to 1024 with a Planner warning; both were replaced
  the same day by a bound derived per segment (the collision-cap entry above, which also records
  the corrections to what this entry first said about constant media and the three fog demos).
- **GRIN's `MAX_ODE_STEPS`** was left at 512 here: reaching it dropped nothing (the walker handed
  back its state and the walk continued, spending one more event). Replaced the same day by the
  GRIN roulette (entry above).
- **Export stamps** carry the resolved measurement (`measurement=` in HDR headers and PNG text),
  so defaulted truncations are recorded.

New witnesses: `null-budget-view` (exact: a quad light through 5 null-walled absorbing slabs reads
1.5578 against the derived 1.5576 at budgets 32 and 10, and 0 at 9) and `null-budget` (a floor
lit through the slabs, half of it under a null-walled carpet; at budget 11 the carpet half loses
its direct light through the stack: carpet-half mean nee/pt 0.0248/0.0244, against 0.0445/0.0440
at the default). With the walker capped at the old 7 crossings, null-budget's pt comparison read
180% apart. Targeted run: 22 checks across the two new witnesses and haze, fog-area, het-const,
het-slab, clamp, emit-swap, emit-sat, emit-scatter, shadow-medium and instance-fog, all pass after
the new pt tripwire's rmse bound was calibrated (measured 64.5% and 74.4%; set to 90%). The full
sweep was not run.

## 2026-09-25 — mesh self-intersection: fp-relative margin, side test by `ng`

- **`MESH_T_MIN` removed.** Triangle hits ignored anything closer than a fixed 1e-3 world
  units, and a spawned ray was pushed off by the same amount. Triangle hits now search
  strictly ahead (`t > 0`) like analytic primitives and fill `Hit.eps` with the fp-relative
  margin, so the only escape mechanism is `ray_spawn`'s offset along `Hit.ng`.
  `spawn_eps_analytic` is renamed `spawn_eps_fp`, since it now serves triangle hits too.
- **The dispatcher's front/back test and region probes use `ng`** instead of the shading
  normal: which side of a surface a ray is on is a geometric fact. `mesh_test_range` still
  flips a smooth mesh's interpolated normal onto the ray's side of the triangle; the general
  rule for that belongs with the normal-mapping design.

Measured before the change with two new witnesses. `mesh-slab-albedo` is the slab-albedo
scene (exact Chandrasekhar plane albedo, σ_t = 20) with the slab as a closed mesh: with the
fixed floor it read µ=1 (0.2420, 0.4293, 0.6395) and µ=0.3 (0.3627, 0.5704, 0.7561) against
exact (0.2488, 0.4375, 0.6466) and (0.3741, 0.5824, 0.7654), the same 1–3% loss the analytic
slab had in August; now (0.2487, 0.4375, 0.6465) and (0.3739, 0.5824, 0.7654).
`mesh-scale-twin` renders a mesh floor and block under a uniform sky and the same scene shrunk
100×: Δmean 0.28%, rmse 1.04% before; 0.00%, 0.03% after, and its tolerances are now tight
enough (0.1%, 0.4%) to catch a world-space margin. Targeted run: the 19 checks of the mesh
witnesses (accel-triple, mesh-furnace, mesh-quad-twin, mesh-light-smooth, mesh-light-twin,
mesh-glass-box, mesh-fog, mesh-submerged, mesh-instance-twin, instance-glass-mesh and the two
new ones) all pass. The full sweep was not run.

## 2026-09-25 — `Hit` carries the geometric normal (`ng`)

`Hit` gained `Direction ng`: the true normal of the surface hit, oriented like `frame.n`. It
equals `frame.n` everywhere the shading normal is the true normal (analytic and marched
surfaces, flat meshes) and differs on smooth meshes (and, later, under normal and bump maps,
which is why it is a field and not a special case). Filled by the shared primitive hit fill,
by both mesh arms (from the triangle's winding normal, which `mesh_test_range` now returns as
`gLocal`), and flipped with the frame on exit in the dispatcher. Two readers:

- **`mesh_light_pdf`** now takes `light_hit.ng`, matching the sampler's area → solid-angle
  conversion. With the interpolated shading normal the two pdfs disagreed and the MIS weights
  of a smooth-shaded mesh light did not sum to 1.
- **`ray_spawn`** offsets along `ng`, on the side of the true surface the new direction goes
  into. With the shading normal, a direction sampled below a smooth mesh's true plane started
  on the outside and crossed back through its own triangle; on an emitter that spurious hit
  counted the emission under MIS (weight ≈ 1, since the light pdf at a hit millimetres away is
  ≈ 0) but not under NEE. For every non-mesh surface and every flat mesh, `ng = frame.n`, so
  those renders are unchanged.

New witness `mesh-light-smooth`: an octahedron lamp with radial vertex normals (up to 54.7°
from the face normals) over the mesh-light floor, nee ≡ mis. Before: nee 0.14572 vs mis
0.15312 over four seeds (mis 5% bright); the pdf fix alone moved it only to 4.95%; with the
spawn fix too, nee 0.14573 vs mis 0.14574. The same octahedron with flat normals agreed before
the change. Still open then (docs/claude-improvements-2026-09.md §1.1): whether the mesh tier's
1e-3 self-intersection floor (`MESH_T_MIN`) could shrink — it was removed in the next entry — and
the shading-normal re-orientation in `mesh_test_range`, left for the normal-mapping design.
*Correction (review):* by these numbers the witness guards the spawn rule, not the pdf: the pdf
fix alone moved the error from 5% to 4.95%, far below the witness's 2% tolerance.

## 2026-09-25 — full witness sweep after the overnight fixes

At commit c5f3543: **181 exact checks — 180 pass, 1 fails; 1 cross-check agrees.** The failure
is `cube-cloud`, whose reference render does not finish within the runner's time under
SwiftShader (tests/witnesses/README.md §D). The four GRIN furnaces and `softbeam-wall`, failing
before the overnight fixes, pass. Everything committed after this sweep had targeted witness
runs only.

## 2026-09-25 — accel and data: CWBVH on coincident centroids, mesh-light NaN, workers

- **CWBVH threw on coincident centroids** (duplicate rows in a `.inst` file, concentric
  shells: four or more coincident items). Its collapse assumes one item per binary leaf, but
  the leaf-size-1 input tree left such ranges as multi-item leaves. The input is now built
  with `alwaysSplit` (only degenerate ranges differ; every suite scene's packed data is
  unchanged). That path exposed a second bug: a fallback split has no SAH axis, and the flat
  node format encoded axis −1 as `A = 0`, i.e. an empty leaf. Test in cwbvh.test.ts.
- **Worker task failures no longer rerun on the main thread.** A build that throws inside a
  worker was treated as "worker unavailable", so the same failing build ran again on the main
  thread (freezing the page for a large cloud) before failing. Worker entries now post
  `{ workerError }` and `runInWorker` rejects with it.
- **Mesh-light sampling** picked the first triangle with `cdf ≥ ξ`, so at ξ = 0 it took
  triangle 0 whatever its area; a degenerate triangle there gave a NaN sample that stuck in
  the pixel. The search is strictly greater, which never selects a zero-area triangle.
- The light-tree importance comment claimed its box cull is hereditary ("a descent can never
  die mid-tree"); it is not (a parent's far corner can lie in neither child). Variance only;
  the comment now says so, with the audit's measurement and the fix (child-box lookahead).
- `.inst` provenance padding no longer uses 32-bit arithmetic that wraps for huge lengths.

## 2026-09-25 — OBJ loader: relative indices and mixed normals

- Face corners were cached by their raw token, so a relative index (`f -3 -2 -1`) meant the
  same vertex every time it appeared: a second vertex block's faces reused the first block's
  vertices. The cache now keys on the resolved indices.
- In a file mixing `v//vn` and bare `v` faces, the bare corners got a (0,0,0) normal, NaN once
  interpolated and normalized. They now get the area-weighted vertex normal.

Tests in tests/authoring/loadOBJ.test.ts (both fail on the old loader); every suite scene's
packed data is byte-identical.

## 2026-09-25 — validation: inputs that used to pass and then break or mislead

From the Sep 25 compiler audit (its compile fuzzer and probes). Each case below passed
validation and then crashed the generator, emitted GLSL that cannot compile, or silently
rendered something other than what was written; each is now a named error.

- `measurement.scattering`/`shadows`/`color`/`response` accept only their documented values
  (`scattering: 'none'` used to switch the scattering arms off, i.e. change the integral).
- `estimator.russianRoulette.startDepth` must be a non-negative integer (it is spliced into
  the walk; 2.5 or NaN produced broken GLSL), like `maxBounces` since Sep 24.
- `view.tonemap.exposure` must be finite and > 0 (NaN became `#define DISPLAY_EXPOSURE NaN`).
- Pinhole/thin-lens `fov` must be radians in (0, π) (a degree value like 45 was accepted and
  gave a nonsense field of view); a new `interval` row constraint states it in the camera
  descriptors. Fisheye `fov` is checked per projection (orthographic ≤ π, stereographic < 2π,
  the others ≤ 2π) through a new `validateAuthored` camera hook; its slider range follows.
- A procedural environment cannot declare formula params (the bake has no uniforms; they
  reached GLSL undeclared), and its `tableSize` must be two positive integers.
- Parameter paths must map to valid GLSL identifiers (`key-light.tint` emitted
  `u_key-light_tint`; `a._b` produced a reserved `__`).
- A material `{param}` needs a default (without one the uniform stayed at GL's 0 — an ior of 0).
- `Transform[]` instance placements are checked like object transforms (s > 0, one scale,
  a nonzero rotation axis or a real quaternion, finite position), reported at the first bad
  placement; the packed form was already checked.
- Mesh vertices must be finite (a NaN vertex died later in the GLSL formatter, naming no object).
- `sampleAsLight: true` on a driven, or rotated uv-reading, quad/sphere/disk is an error: the
  rule re-derived the light census without its placement exclusions, so the flag was accepted
  and then silently dropped.
- An object-free scene is an error up front (it can never link; it used to warn "nothing will
  be rendered" and then fail on internal seam errors). Supporting a light in fog with no
  surfaces needs stub intersection functions: open.
- `compileScene` rejects two strategies with the same id (they would overwrite each other's
  programs in the engine), and now RETURNS the warnings of a successful compile
  (`CompiledScene.warnings`, deduplicated across strategies); the App logs them. Every
  "field is ignored" / "knob does nothing" warning used to be discarded unless the compile
  also failed.
- The unknown-primitive error names the object.

Tests: tests/compiler/validator.test.ts (12 new cases, all failing on the old code),
tests/compiler/compileScene.test.ts. All 192 suite scenes still compile.

## 2026-09-25 — runtime: production sessions, pause, dialogs, restore, uniforms, runner

From the Sep 25 runtime audit, each confirmed by a unit test or by reading the call sequence:

- **A stopped render's late `finally` unlocked the next session.** A production promise
  settles a microtask after `stop()`, by which time a new session (e.g. a tiled render) may
  be active; its `finally` then unlocked that session's parameters mid-render. Each run now
  holds a token and settles only its own session.
- **A throw while applying the production view** (a 4K/8K resize can fail to allocate) left
  the parameters locked forever. `beginProduction` now unwinds itself.
- **A new production was refused after a finished one** that was still on display (modal
  dismissed with × or the backdrop). The finished view is now exited first.
- **Extend Render opened two completion dialogs** (the RENDER_COMPLETE listener and the
  extend promise both did); extending from the second one while the first extension ran
  cancelled it. Only the event opens it now, and extending while a render runs is refused
  before anything is touched.
- **A paused production could not be resumed from the UI**: the panel only updated on progress
  events, which stop while paused, and the `\` shortcut was swallowed by the production lock.
  The panel follows RENDER_PAUSED/RESUMED; `\` works while locked.
- **Dismissing the production dialog with × or the backdrop** left rendering paused and the
  canvas unclickable. The cleanup now runs on every close.
- **Switching renderer after a production finished** cleared the image while the panel kept
  offering Export (a 0-sample frame). The panel closes on a renderer switch.
- **Loading a session left stale values in the engine**: keys set after the session was
  saved stayed live on the GPU while the store, the panel and the stamp said "default". The
  restore now reports removed keys, which return to their compiled defaults.
- **Uniform uploads skipped changes smaller than 1e-5** (an absolute tolerance), so small
  parameters (a σ in m⁻¹) never reached the GPU. Comparison is now exact.
- **`app.loadEnvironmentHDR(path)`** swapped the texture but left the old map's size and
  weight (read by the env sampler) and its table variants. It now runs the full loader and
  records the path for context restore.
- **Witness runner**: a page reloaded mid-render (Vite reloads the lab when a watched file is
  saved) was read as "render finished" and its empty frame accepted. A reload is now an
  error, and readbacks are checked for the configured size.

Tests: tests/app/productionOrchestrator.test.ts (four session tests, each failing on the old
code), tests/app/parameterStore.test.ts, tests/engine/shaderUniformUtils.test.ts.

## 2026-09-25 — a sky plus batch lights only (under `'bvh'`) failed to link

With a samplable environment the NEE samplers draw env-vs-finite with `u_envSelectProb`, but
the Planner declared that uniform only when REGISTRY lights existed; batch instance lights
(finite lights under `lightSelection: 'bvh'`) did not count, so such a program read an
undeclared uniform. Now they count. Test in tests/compiler/lightCensus.test.ts (reproduced
first); witness `instance-lights-sky` (the instance-lights twin under a samplable sky) passes
nee ≡ mis. Still open (variance only): the derived selection probability ignores batch-light
power, so with no registry lights it clamps to 0.99 and the batch gets 1% of NEE samples.
Found by the Sep 25 audit's compile fuzzer.

## 2026-09-25 — table dispatch: a scaled scene-local SDF drew at the wrong size

`classifyPlacement` keeps the whole similarity (scale included) as the residual for a
`defineSDF` field with a direction or vector row, and the unrolled marcher applies it; the
scene table's SDF record carries only a rigid tail, so a tabled copy of such an object was
drawn at 1/s of its size (its TLAS box was still scaled). Table dispatch is the default from 9
marched objects, so this changed the image without the author asking for it. Such objects now
stay on the global marcher. Test: tests/compiler/sdfTable.test.ts (fails without the fix). No
registry scene was affected (snapshots unchanged). Found by the Sep 25 audit.

## 2026-09-25 — `scattering: 'ignored'`: shadow rays see the same medium as camera paths

Under `measurement.scattering: 'ignored'` a scattering medium is absorbing-only (σ_t = σ_a),
and camera segments were attenuated that way, but the shadow-ray transmittance was generated
separately and kept σ_a + σ_s. So NEE and MIS darkened light through such a medium that pt
carried: an estimator changed the image. The transmittance generator now drops σ_s exactly
when the dispatch does (closed form on σ_a, or the σ_a ratio tracker for expression media);
media that do not scatter emit the same code as before. New witness `fog-area-ignored` (the
X-FOG scene under 'ignored'): nee vs pt differed by 31.8% in frame mean before, 0.03% now;
nee ≡ mis holds in both. Found by the Sep 25 audit; no registry scene reached it before.

## 2026-09-25 — the sun sits at the far clip

The directional light placed its sample at distance 1e20, so any ambient medium extinguished
the sun completely (and ratio tracking in a heterogeneous ambient medium exhausted its budget
and returned a partial, biased transmittance), while the sky beside it has been attenuated
over `MAX_DIST` since the Sep 24 fix; occluders beyond the far clip could also shadow it. It
now uses `MAX_DIST`, the declared scene-scale truncation ("geometry or an ambient medium
extending past 1000 units is cut"), like the environment. New witness `sun-haze` (a wall
facing the sun through σ_a = 0.001 haze: (ρ/π)·E·e^{−σ_a(MAX_DIST − backoff)}·e^{−σ_a·1} =
0.1838) read exactly 0 before and 0.1838 now; `sun` still passes. No existing registry scene
combines a directional light with an ambient medium.

## 2026-09-25 — precision: small, distant spheres (intersection and sphere lights)

Found by the Sep 25 audit (f32 emulation), confirmed on the GPU with two new exact witnesses.

- **Sphere and cylinder intersection** computed the discriminant as b² − c, subtracting two
  numbers of size |oc|² to find one of size r². For a sphere small against its distance (an
  instance-cloud sphere seen from across the cloud, r/D ~ 1e-3) hit/miss near the silhouette
  was decided largely by rounding and hit points moved by a large fraction of r. Both now use
  the perpendicular-offset form of Haines et al. (Ray Tracing Gems ch. 7), r² − |oc − b·d|²,
  with the near root as c/q; the cylinder's tube uses the 2D version (Lagrange's identity).
- **Sphere lights** computed 1 − cosθmax as 1 − sqrt(1 − sin²θmax), which keeps almost no
  bits for small or distant spheres, and that number is the pdf: at r/d ≲ 1.5e-4 it rounded to
  0 and the 1e-8 floor made the light exactly twice as bright; at r/d = 1e-3 (the embers
  demo) the error is up to ±12% per shading point. Now sin²θmax/(1 + cosθmax); the polar angle
  is sampled as w = u·(1 − cosθmax), sin²θ = w(2 − w) (the old form quantized small cones onto a
  few rings); the distance to the sampled point uses the robust near root. The pdf mirror uses
  the same function, so the sampler/pdf byte match holds.
- New witnesses (tests/witnesses/scenes/precisionWitness.ts): `tiny-sphere` (an emissive
  sphere at r/D = 2.5e-4; frame mean = disk area / frame area) read 0.2195 on the old code
  against 0.0767 and reads 0.0768 now; `tiny-sphere-light` (a wall under a sphere light at
  r/d = 1e-4; L = ρ·Le·r²/d²·(1 + x²/d²)^(−3/2)) read 0.9998 against 0.4997 and reads 0.4997.

Generated-GLSL snapshots changed by exactly these three formulas (plus source-map offsets).

## 2026-09-25 — the GRIN "energy loss" was black lenses; the softbeam "bias" was noise

**GRIN regions rendered black whenever their region id differed from their material id.**
The four GRIN furnaces read ~0.30 against 0.4 (open since August, listed as "a ~25% energy
loss, cause not established"). Rendering `grin-furnace-hard` showed the lens itself nearly
black (mean 0.07) with the rest of the frame near 0.4, and the lens covers about a quarter of
the view. The walker's exit test compared `scene_region_at(p)`, a region id, with `med`, which
the dispatcher passes as a material id. In the furnaces the lens is region 6 (after six wall
planes) but material 1 or 2, so the walker "left" on its first step, rewound to just outside,
re-entered, and repeated until the bounce budget ran out. Every GRIN demo and every GRIN twin
had the lens as region 1 and material 1, so only the furnaces saw it. The walker now asks
whether the MATERIAL at the point has changed (`grin_inside`, grin.glsl), which is also the
right exit physically: a wall between two regions of the same material has the same n on
both sides. After: `grin-furnace` (0.3989, 0.3994, 0.3996), `-emit` 0.3997, `-scatter`
(0.3997, 0.4001, 0.4002), `-hard` 0.4000; the GRIN twins are unchanged.

Tried and rejected: evaluating n exactly at the walker's exit/event points (plus an (n/n_wall)²
factor on the final straight micro-segment), which telescopes on paper, biased
`grin-furnace-scatter` to 0.40101 ± 0.00002 over salts. Velocity Verlet conserves a nearby
"shadow" Hamiltonian whose index along the computed ray is |T|, so the walker's |T|-ratio
factor is the consistent one; the reasoning is now in the `grin_finish` comment.

**`softbeam-wall` +3.3% was noise, not a normalization bias.** NEE samples the whole aperture
but only the 4% of it inside the emission cone contributes, so each sample has a relative sd of
≈4.9; the check averaged 80 pixels at 96 spp (a 7% standard error, against a 1.2% tolerance),
and the runner's pinned salt reproduced the same draw every sweep. Six salts on the old crop:
0.9985 ± 0.030 (expected 0.99917). The check now averages a 3600-pixel crop inside the core
at 384 spp (0.9963 on the runner's salt; 0.9989 ± 0.0028 over three salts).

Verified: `npm run witness` on all nine GRIN witnesses and `softbeam-wall` — all pass.
tests/witnesses/README.md sections A and B record the analysis.

## 2026-09-25 — large images: tiled rendering saves one stitched file

The old `TiledRenderer` was never reachable from the app, and would have failed on its second
tile: it started a fresh production render per tile, and the first one leaves the production
session "settled", which refuses a new one. It also downloaded one file per tile for the user
to stitch.

- **`app.renderTiled({ width, height, spp, format, tileSize })`** renders any size in tiles
  and saves ONE HDR and/or PNG with the full image's stamp. The production dialog offers it
  ("Render in tiles"; on by default for the new 8K size, and a Custom size).
- **Tiling is invisible in the output.** The RNG already seeds with the global pixel, cameras
  map through `engine.imageSize`, tile offsets are multiples of 64 (the display dither's
  blue-noise period), and the job pins one RNG salt, recorded in the stamp. Verified in
  headless Chromium: a 200×150 render in 64-px tiles (edge tiles 8 and 22 px) is
  byte-identical to the one-piece render, HDR and PNG, for each of the six cornell cameras
  (pinhole, thin lens, orthographic, equirect, fisheye, cylindrical); with the salt unpinned
  the files differ, and the stamp records the salt actually used.
- One parameter lock spans the whole job (`ProductionOrchestrator.renderTiles`); the canvas
  and layout are restored and interactive rendering resumes afterwards, including after a stop.
- The stitched image is held at 4 bytes/pixel per format (RGBE or RGBA) and allocated before
  the first tile, so a size the browser cannot hold fails immediately.
- **PNG export no longer goes through a canvas.** `encodePNG` writes the file directly (Paeth
  filter, the browser's zlib via `CompressionStream`, stamp as tEXt chunks). `canvas.toBlob`
  is capped by the browser's canvas-area limit (Safari: 16.7M pixels, below one 8K frame) and
  its failure was silently ignored. All PNG exports use the new encoder, so `exportPNG` /
  `exportAOV` / `exportAllAOVs` are now async (the pixels are still read synchronously).
- `floatToRGBE` clamps negative channels at 0 (a Uint8Array stored −26 as 230).
- The production dialog's stop check compared `err.name` with `'RenderStopped'`; the name is
  `'RenderStoppedError'`, so every cancel was logged as a failure.
- Removed: per-tile downloads, the never-wired session resume (`SessionData.tileJob`), and
  the unused `TILE_START`/`TILE_COMPLETE` events.

Not changed: the production loop draws one sample per animation frame, which caps small
tiles' throughput (a 512² tile at 60 fps is 16M samples/s however fast the GPU); that is the
reason the default tile is 1024. Tests: tests/app/tiling.test.ts, the PNG round trip in
tests/app/fileExport.test.ts, the session in tests/app/productionOrchestrator.test.ts.

## 2026-09-25 — runtime fixes: context loss, render-loop errors, export stamps, workers

- **WebGL context loss was unrecoverable.** On restore the engine rebuilt the renderers but
  not its blue-noise texture, and nobody re-supplied the scene-data or environment textures or
  re-sent parameter values: every later frame threw "Extern texture 'data_nodes' is not
  registered" (and the camera and sliders would have reverted to defaults). Now the engine
  re-registers what it owns and calls `onContextRestored`; the App re-executes the scene-data
  plan, re-bakes / reloads the environment, re-selects the active renderer, re-sends every
  parameter and restarts accumulation. Checked in headless Chromium with WEBGL_lose_context:
  instance-lights, sky and proc-sky render a bit-identical image (pinned salt) after
  loss + restore; the previous code never finished a frame after restore.
- **A frame that threw killed the render loop silently**, leaving the state at 'rendering', a
  production render's promise unsettled (parameters locked for good) and nothing reported. The
  loop now stops cleanly, rejects the pending production render, and emits `RENDER_ERROR`,
  which the App shows in its error overlay.
- **Export stamps could describe different parameters than the pixels**: a change made while
  rendering is stopped defers the accumulation reset, but the stamp read the current values.
  The App now snapshots the parameters at each accumulation restart and stamps that.
- **Worker fallback on detached inputs**: when a worker failed after receiving TRANSFERRED
  inputs (a module worker's load failure arrives after postMessage), the main-thread fallback
  ran on zero-length arrays. It now rejects in that case; cloned inputs still fall back.

Tests: tests/app/renderCoordinator.test.ts (a throwing frame), tests/app/worker.test.ts.

## 2026-09-25 — the App packs scene data from a compiler plan (stage 2)

The App no longer derives anything from the scene to build the data textures. The compiler
returns a scene-data plan (`CompiledScene.sceneData`, built by `compiler/sceneData.ts` from
the Planner's own results): mesh geometry per slot, mesh-light bakes, instance-batch pack
specs, the object table's packed records and leaf-box sources, the light table rows with each
light's box and power, and region→material ids. `app/sceneData.ts` executes it, doing only the
data-sized work (packing vertices, building BVHs, writing bytes).

- The Planner builds its lights FROM the light roster instead of mirroring it, and region ids
  come from its own assignment — the "light roster drift" and "region-material drift" runtime
  checks are gone (the agreement they checked now holds by construction), and so is
  `regionMaterialsOf` (a count remains, `regionCountOf`). tests/compiler/lightRoster.test.ts
  (roster ≡ plan) became a tautology and was removed.
- Proof: tests/app/sceneData.test.ts fingerprints every data texture for every suite scene;
  the fingerprints were recorded from the old App code (moved verbatim first) and the
  plan-driven packer reproduces them exactly (187 scenes). Compiled shaders unchanged.
  GPU smoke test (bazaar, instance-lights, mesh-light-twin): identical numbers.

## 2026-09-25 — build only the scene data the renderers read (stage 1)

Design: docs/claude-data-exact-linkage.md. The optional data structures — the CWBVH, the
light tree, the object table (with its region→material ids) — were built for every scene
whether or not any renderer read them; for large instance clouds the unused CWBVH took more
time at load than the TLAS actually used (+2.6 s at 724k instances, +5.3 s at 1.4M).

- `Compiler.compileScene(scene, strategies)` compiles a scene's renderers together: validate
  all, take each strategy's decisions (`programDecisions`), lay out the union of what they
  read (`dataReadsOf`, `unionDataReads` → `DataReads`), then plan and generate every program
  against that one layout. `compile(scene, strategy)` is the one-strategy case.
- `dataTenantsOf(scene, reads)` allocates optional structures only when read; the App packs
  with the same reads and builds the CWBVH only where the layout gave it a region.
- The ledger puts every always-built region before every optional one, so a renderer that
  reads no optional structure compiles to the same text whatever its siblings read (tested).
- The App now compiles (and validates) BEFORE packing: a bad scene fails in milliseconds
  with its diagnostics. `App.recompile` rebuilds the scene data for the new layout, with
  rendering paused across the swap (it previously kept the old scene's data).
- Tests: tests/compiler/dataReads.test.ts — decisions are identical whichever layout they
  are planned against (every suite pair), and each optional structure appears only when a
  renderer reads it. Snapshot change: two single-strategy programs' light-tree /
  region-material offsets moved down (the other optional structure is no longer allocated).
- GPU check (witness runner): every scene covering an optional structure or the new
  start-up order passes — instance-params-twin (cwbvh ≡ tlas), hundred-spheres,
  instance-lights, accel-triple, bazaar, sdf-table-twin, mesh-light-twin, instance-twin,
  cornell-area.
- Witness harness: the lab page no longer starts its own render loop when opened by the
  runner (`?witness`). At full window size, sdf-table-twin's first frames (a ~110 s shader
  compile under SwiftShader) kept the page busy for ~111 s against the runner's 120 s wait,
  so it passed or failed by a few seconds. cube-cloud now fails later and more precisely:
  the runner takes control at once, but the render itself does not finish within 8 minutes.

## 2026-09-24 — architecture review; estimator and crash fixes; CI

A full review (compiler, component library, emitted GLSL, engine/app, tests, docs) found the
per-component math correct and the bugs concentrated at the seams between components. Fixed:

- **`maxBounces` meant something different under each estimator.** The walk did N
  intersections with NEE at every one, so pt computed Σ_{n≤N−1} TⁿE, pt-nee Σ_{n≤N} for
  samplable lights, and pt-mis only the NEE share of the n = N term. The walk now does N + 1
  intersections; the last one only scores emission (surface, sky, medium emission), and NEE,
  the continuation and medium scattering stop at the budget (pbrt-v4's structure). Every
  estimator now computes Σ_{n≤N} TⁿE, matching the taxonomy. `maxBounces` is now
  Validator-checked to be a non-negative integer. pt renders at a given N gain the
  previously missing last term, so pt images move slightly.
- **Environment pdf under rotation.** The equirect chart's u coordinate was not wrapped, so
  `environment_pdf` clamped it to the edge table column across a band of longitudes as wide
  as the rotation, and pt-mis weights no longer summed to 1. u is now wrapped into [0, 1).
- **Equiangular medium NEE + a samplable environment** silently dropped the sky's
  single-scattered light (the combiner gives the sky weight 0 after a scatter, but
  equiangular only samples delta lights). Now a Validator error.
- **Rough dielectric at η = 1** (thin sheets, index-matched glass) sampled the pass-through
  direction with an infinite pdf, NaN under MIS. It is now the delta pass-through, as in
  pbrt-v4, and `power_heuristic` has pbrt's overflow guard.
- **Environment NEE placed the sky at 1e20**, while missed BSDF rays find it at the far clip
  `MAX_DIST` (1000): planes beyond the clip blocked NEE only, and an ambient medium
  extinguished NEE's sky completely. Environment NEE now uses `MAX_DIST`, which is documented
  as a scene-scale truncation.
- **Blackbody material emission** crashed the Validator, and the Analyzer did not count such
  emitters as lights although the Planner did. **An emissive object whose material omits
  `sampleAsLight`** slipped past the equiangular "delta lights only" rule and crashed the
  generator. Root cause: four modules each re-derived "which objects are lights" from the raw
  scene. There is now one answer, `samplableEmitterObjects` (compiler/plan/dataTenants.ts),
  used by the Analyzer, the Validator and `lightRosterOf`; `hasConstantNonzeroEmission`
  understands the blackbody spelling.
- **A scalar constant-environment color** crashed the GLSL formatter, and **a driven
  blackbody sky** made the NEE selection probability NaN. The environment color now goes
  through the same spectrum normalization as material spectra.

New tests: `tests/compiler/lightCensus.test.ts` (the crash classes above), the η = 1 case in
the rough-dielectric twin tests, and four exact GPU witnesses in
`tests/witnesses/scenes/estimatorAgreementWitness.ts` (bounce-budget, proc-sky-rotated,
fog-sky, rough-sheet).

Verification (full GPU sweeps, SwiftShader):
- Pre-fix code: 156 exact checks, 149 passed. Failures: the four GRIN furnaces (~25% low,
  uninvestigated), softbeam-wall (+3.3%), cube-cloud (the hang) and one runner flake. Every
  other witness the August notes list as "awaiting sweep" passed.
- Fixed code: every check passes except the same four GRIN furnaces, softbeam-wall and
  cube-cloud; no existing check changed status. (Two runner flakes on the first pass passed
  on re-run.)
- The four new witnesses pass on the fixed code and FAIL on the pre-fix code: bounce-budget
  (sky 0 at N = 0; sphere 0.07 under mis and 0 under pt at N = 1, vs 0.4), proc-sky-rotated
  (mis 61% brighter than nee: the sun counted twice), fog-sky (sphere 0 under nee, 0.12 under
  mis, vs 0.147), rough-sheet (1305 NaN pixel components).

Found while building the witnesses, NOT fixed (design question): thin dielectrics are
one-sided — on a front-face hit the dispatcher reports region_to = the surface's own region,
so a thin glass sheet refracts as if entering glass and never exits; from the back, η = 1.
That asymmetry is also what makes quad lights one-sided. The Validator's thin-surface warning
("will refract as η = 1") is only true from the back. See tests/witnesses/README.md.

Added CI (`.github/workflows/ci.yml`: typecheck + vitest incl. glslang on every push; the GPU
sweep on demand) and removed the Pages workflow: its build script is a template from a
three.js demos repo, and here it built 35 pages that load only scene-definition modules (no
renderer), while Pages itself is unavailable on this private repo. The build script
(`scripts/build-all.mjs`, `npm run build:all`) and `PAGES-TODO.md` were removed with it.

## Through 2026-08-13 — the build record formerly kept in CLAUDE.md

Moved here verbatim from CLAUDE.md's "Current state" section (oldest first). It uses the
project's internal batch codes and doc-section references; the docs it cites explain them.


**Done** (see `docs/trace-loop-contract.md` + the impl-plan-*.md docs + memory): the top-level loop conforms to the trace-loop contract (`Ray` pure geodesic seed, generated `scene_intersect` dispatcher, `ambient_dot` metric discipline, no `GeodesicState`); §10.1 items 1–6 & 8; **two geometry backends** (SDF marching + closed-form analytic, combined by the dispatcher); **two-sided hits** (`Hit.region_owner`, generated `scene_region_at` innermost-wins, epsilon classification, owner-shades vs emission-on-`region_to`, `ray_spawn`, interior marching, per-owner normals); the **smooth dielectric** (η² factor, generated `ior_of`/NEE-guard tables, `etaScale` RR metric) with its witnesses (F-ETA 0.5540 GPU-verified, R-SUBMERGED, cornell/analytic-glass twins); RR post-weight per §7.2; **homogeneous media** behind the volumetric component (`docs/fable-volumetric-component.md`): null interfaces (`model: 'none'`), `current_medium` + §4.4 self-heal, `ambientMedium`/`material_of(-1)`, the generated `medium_sample`/`medium_transmittance` seams (absorbing arms deterministic; scattering arms = pbrt-v3 channel-MIS), HG phase (forward convention), spectral `shadow_media` segment walker, the emission gate (`material_is_emissive`) — witnesses GPU-verified (slab exact numbers, F-BOX-M 0.4/channel, haze g-flip, fogcube rim; F-ETA re-verified 0.554); **area lights + MIS** (`docs/impl-plan-area-lights.md`, owner-verified): quad analytic primitive, explicit-light desugar to `__light_n` emissive regions + the `sampleAsLight` route, `light_of`, area-aware power CDF with `cdf_rescale`, ONE-SIDED quads (pinned deviation from the §6.2 two-sided aside), §6.2 emission w-bookkeeping, full MIS (generated `lighting_pdf`, power heuristic, `prev_bsdf_pdf`/`prev_p` at surface AND medium events) — **pt/pt-nee/pt-mis converge on cornell-area, cornell-area-glass (X-GLASS), and fog-area (X-FOG)**; the marcher's grazing-stall fix (stall-aware exhaustion both directions + adaptive `march_epsilon`); the **suite gallery** at the dev-server root (`expected` pass criteria per scene).

**Environment-as-light is BUILT** (July 2026, `docs/impl-plan-env-as-light.md` T1–T5, all GPU-verified): the §2.10 `extern:` chain end-to-end (executor = sole texture-unit authority; legacy engine env binding deleted), `image` + `procedural` environments (procedural = one-shot GPU bake via a fixed-size headless renderer — the `FramebufferConfig.size` contract extension — app-orchestrated), samplable env in NEE/MIS (two-stage selection with `u_envSelectProb` wrapping the baked CDF; miss-branch w-bookkeeping per reference §5/§8 line 3; pdf-from-CDF-differences), the D11 chart axis (`transport.envSampler: 'equirect' | 'octahedral'` — equal-area octahedral is pbrt-v4's mapping; TS twin in `src/engine/loaders/octahedral.ts` is the tested ground truth) and `transport.envCompensation` (MIS-gated). Witnesses in the suite: sky (X-ENV + X-CHART), furnace-sky (convex ρ·L — NOT the closed-furnace L/(1−ρ)), sky-lamp (two-stage), proc-sky (bake + W9 compensation).

**Decision-hoist batch is BUILT** (July 2026, `docs/impl-plan-decision-hoist.md` T1–T4, all gates green): `RenderStrategy` restructured into **measurement / estimator / view** sections per the pinned taxonomy (`docs/fable-strategy-taxonomy.md` — the `volumeIntegrator` split: `measurement.scattering` truncation + `estimator.volumeSampling` axis; `shadows`/`color` declared truncations, `'spectral'` reserved-rejected); **`ProgramDescription` is the complete link map** — Generate reads `plan.program` + data tables ONLY, `RenderPlan.features` deleted (feature generators cannot re-derive decisions), with its own structural snapshot per registry pair; **glslang static compile check** for every pair's shaders in vitest (`tests/compiler/glsl-compile.test.ts` — NOTE: glslang accepts what ANGLE rejects, e.g. struct ternaries; GPU witnesses still own dialect quirks); **provides/requires + the generated interface header** (`generated:interfaces` block = each program's contract surface as its table of contents; seam-conflict/seam-missing diagnostics; cross-feature declaration order no longer load-bearing).

**The transport split is BUILT** (July 2026, `docs/impl-plan-transport-split.md` commits A–D; §10.1 is COMPLETE): the loop is GENERATED — source of truth now lives in `src/components/transport/` per the §7 anatomy (`integrators/pt.ts` walk + `techniques/{kernel,light}.ts` + `combiner.ts`, re-carved from the original segment emitters) with per-part provenance (`generated:transport/<part>`); `path_trace.glsl` deleted; proof was token-equivalence across all 47 registry pairs (test deleted with the template, per plan); ZERO structural defines remain anywhere (library media/MIS sections are conditionally-included blocks — `structs_media/math_media/math_mis.glsl`; only numeric knobs like `MAX_MARCH_STEPS` stay defines). Shared-invariant emitters: `rr()` at both sites, `prevBookkeeping()` at medium+surface. The GPU witness sweep is now covered by `npm run witness` (35/35 green, July 13 2026); dumps for loop reading are regenerable via `npm run dump:shaders` — each program contains exactly its own estimator.

**The descriptor/schema reorg is BUILT** (July 2026, `docs/impl-plan-descriptor-reorg.md` R1–R3): mix-many families are descriptor pairs in family folders (`glsl/materials/lambert.{glsl,ts}`, `glsl/lights/point.{glsl,ts}`, `glsl/phase/hg.{glsl,ts}`, registries at each `index.ts`); `MaterialProperties`/`MediumProperties` are schema-generated per scene (§3.4 literal — **no roughness field exists until GGX's schema declares it**; a driven param with no reader is a Validator warning); primitive parameters are schema-checked (C7). **Adding a material model = one GLSL file + one descriptor + one registry line.**

**The components library is BUILT** (July 2026, `docs/fable-components.md` §§1–6): everything swappable moved to the top-level `src/components/` leaf layer — byte-identical emitted GLSL across all 47 registry pairs (hash-verified), snapshot churn = provenance renames only, GPU spot-checked. The sampler slot is carved (`components/sampler/pcg4d.glsl` + registry — Owen–Sobol is the known second occupant); `descriptors.ts`/`glsl-format.ts`/`quadNormal`/the octahedral TS twin resolved into components; the transport family has the **§7 technique-centric anatomy (owner-decided + BUILT July 12 2026)**: `transport/techniques/{kernel,light}.ts` (T1 = kernel sampling with its deferred scoring sites + carried record; T2 = light sampling, local scoring), `transport/combiner.ts` (every weighting line — pt/pt-nee/pt-mis are combiner configs), `transport/integrators/pt.ts` (the walk skeleton composing them; new integrators = new walks here). **A new sampling technique = one file + one registry line** (the axis the owner chose to make cheap) — **proven by equiangular medium NEE** (`docs/impl-plan-equiangular.md`, BUILT July 13 2026: `techniques/equiangular.glsl` + glue; `estimator.mediumLightSampling: 'vertex' | 'equiangular'`; haze pt-nee/pt-nee-eq equality pair GPU-checked 0.5% @ ~20spp, halo-core noise −19%; v1 = delta lights + nee only — area arms and placement-MIS on that plan's ledger). **The emitted GLSL matches this anatomy too** (`docs/fable-transport-glsl-target.md`, owner-approved + BUILT July 13 2026): the loop emits function-shaped — generated `PathState` (§3.4-style union) + `combiner_w_*`/`kernel_record`/`roulette` generated bodies + STATIC technique files (`techniques/{kernel,kernel_phase,light,light_medium}.glsl`, conditionally included) + a ~40-line generated walk. The rules: **math is static; policy/plumbing are generated**; static files touch ONLY PathState's pinned core (ray/throughput/radiance) — every program-dependent field is behind a generated function. Proof regime for that batch: witness sweep + glslang + re-goldened snapshots + perf wash (byte-identity impossible by design); identity-weight elision is a deferred Generate-stage fold.

**GGX is BUILT** (July 2026, the first occupant through the new front door): `components/materials/ggx/{ggx.glsl, ggx.ts, ggx.test.ts}` — reference §7 transcribed to the (uc,u)/`ambient_dot` contract (VNDF sampling, separable Smith, Schlick; alpha = roughness² clamped ≥ 1e-3), fields `f0` + `roughness` via the §3.4 schema. The §11.3 pdf-histogram harness exists in its TS-twin form (ggx.test.ts: χ² over the spec grid with adaptive per-bin integration, the weight·pdf ≈ eval·|cos| triple, sample/query pdf agreement, reciprocity — the GPU debug-strategy form stays deferred, HG's instance unbuilt). Witness: **veach-mis** in the suite (4 roughness steps × 3 sphere-light sizes at ~equal power; pt/pt-nee/pt-mis; headless GPU check shows means agreeing ~6% at ~20spp and pt-mis visibly firefly-free — converged §11.2 equality is the owner's check, PENDING). Bring-up also fixed a Planner altitude bug: `brdfModels` was a hardcoded hasLambert/hasDisney/hasDielectric if-chain that silently dropped ggx from the generated structs — now registry-driven (registry order = dispatch order; zero churn in existing snapshots proved it).

**The measurement bench is BUILT** (July 13 2026, `docs/fable-measurement-bench.md` — the owner's cut of that proposal: runner + variance + stamps; compare mode CUT, probes DEFERRED): **`npm run witness`** (`tools/witness.mjs`, playwright devDep, SwiftShader headless) renders every entry of **`tests/witnesses/` — the durable GPU test system** (the executable form of fable-validation-scenes.md: fixtures owned in `witnesses/scenes/`, registry + checks in `witnesses/index.ts`, gate policy in its README; `demos/` is the REPLACEABLE demo layer, merged into the gallery view by `pages/registry.ts` — demos may import witness fixtures, never the reverse) and asserts the numbers (check kinds `mean`/`equality`/`twin`/`noise`) — all known witnesses reproduce (furnace 0.4000, F-ETA 0.5541, slab, F-BOX-M, furnace-sky ρ·L & L=1.0). Equality gates: Δ frame-mean in LINEAR HDR (bias) + noise-normalized **χ²** against the measured per-pixel variance (structure; ≈1 for same-integrand arms at any spp, fireflies self-normalize) — χ² requires shared event coverage, so chance-hit **pt arms get calibrated display-space RMSE tripwires** instead (converged pt equality stays the owner's GPU check). The **variance accumulation occupant** (`components/film/accumulate_variance/` — Welford δ·δ′, one MRT double_buffer so mean+moment swap in lockstep, `variance` export at attachment 1; Validator/Planner/ShaderBuilder/PipelineBuilder seams) is GPU-verified mean-untouched (Δ 0.00% vs `average`, same RNG stream) and powers `noise` checks: equiangular's halo win reproduces as σ/µ 18.05% vs 21.24% @192spp; veach asserts pt-mis lowest (4.43% < pt 9.99% < pt-nee 11.64%). **Reproducibility stamps**: every HDR/PNG export embeds scene + strategy JSON + parameters + spp + resolution + resetSalt + git hash (HDR `# key=value` header lines; PNG tEXt chunks, CRC-tested); `app.pinResetSalt(n)` = the §2.11 reproducible mode. Known gaps: `exportPNG` needs an `ldr` export target that `buildExportTargets` never defines (dead for standard renderers, pre-existing); equiangular's "long segment" χ² vitest is flaky under parallel load.

**The camera family + `pixel/` are BUILT** (July 13 2026, `docs/impl-plan-cameras.md`): the camera axis is carved into a registry (`components/camera/index.ts`, minimal `CameraModelDescriptor`) — adding a camera is one folder + one line. Sub-pixel jitter was hoisted OUT of the camera into a new **`pixel/`** family (the reconstruction kernel `h_j(u)`; `box` occupant; `pixel_sample(coord,xi)`), so the camera is a pure map **`camera_generateRay(vec2 film, vec2 xiLens)`** (film point → ray, no RNG). **Six occupants**: pinhole, thin-lens (defocus, `aperture=0 ≡ pinhole` witness `thinlens-zero`), orthographic, equirect (360×180), fisheye (one occupant, four `θ(ρ)` sub-projections behind a `projection` sub-parameter, selected by a value `#define FISHEYE_THETA` — the TAN_FOV mechanism, NOT a generated block; the "no defines" rule is about STRUCTURAL gating only), cylindrical panorama (single `hfov` Width° dial + one focal length → square pixels, vertical follows the window). All switch live on the `cornell` demo card (keys 1-6). Bring-up fixed an unrelated shadow-ray bug (`sdf_intersect_any` accepted occluders past `maxDist` — floor self-shadow under a near-ceiling lamp). Deferred: realistic multi-element lens, tilt-shift, anamorphic, `pixel/` tent/gaussian, fisheye circular mask, motion-blur/spectral (Category-B seed fields). **Camera POSE is authored measurement data** (July 16 2026): `CameraPose` (`position`/`target`, plain Vec3) on every `measurement.camera` variant — the DEFAULTS of the always-live `camera.position`/`camera.target` params (OrbitControls contract; deliberately NOT `Value<>` — pose never bakes, orbiting never recompiles). `(scene, strategy)` alone now determines the converged image; suite registries stamp poses via `withPose` (`src/authoring/strategy.ts`), and `initialParameters` is back to parameter POINTS only (e.g. the driven witness θ′). `App.getParameter` resolves store → compiled metadata default.

**Exact linkage is BUILT** (July 15 2026, `docs/impl-plan-exact-linkage.md`; policy pinned as contracts §2.12): self-authored component files are included WHOLESALE (declared cost — never carve inside an occupant); everything GENERATED is exactly linked — seam existence is a ProgramDescription decision (`materials.surfaceEval`/`surfacePdf`, `media.mediumEval`/`mediumPdf`, `intersection.anyQuery`, `environmentSamplable` now a real decision ∧ NEE, `environmentPdf`, `environmentSelectionLive`), features gate emission + `provides` on those fields, and merge's **`seam-unused` warning** (dual of seam-missing; `componentScoped` provides exempt) enforces it structurally. Killed the audit's dead-code classes (worst was 27% of a `pt`+samplable-env program); env-only programs now fold the selection constant on BOTH sides (no dead `u_envSelectProb`); `MediumProperties` phase fields are strictly schema-driven; `u_resolution`/`u_time` left the main program (display's binding rides the Generator). Bring-up also fixed a latent combiner bug (`hg_pdf` hardcoded where the `interaction_medium_pdf` dispatch belongs — any non-hg medium under `pt-mis` couldn't link) and the glsl-rehome's broken `EnvironmentBake` import (lab.html 500).

**The transform system (stages 1–2) is BUILT** (July 15 2026, `docs/fable-transforms.md` — the placement design authority, owner-approved; supersedes `design-scene-graph-transforms.md`): object placement is a **Euclidean similarity** (`components/geometry/similarity.ts` — s>0 strictly, reflections rejected, nonuniform scale unrepresentable; closed-form compose/inverse, normals by R alone), authored as `transform: {position, rotation: axis-angle|quat, scale}` on any object. Constant transforms compile away: the analytic primitive set is **similarity-closed**, so they fold entirely into canonical parameters at plan time (`foldAnalyticParameters` — light desugar/power CDF/sampler/pdf/signed-distance all read the folded params; the flatten→fold→desugar ordering pin); SDF objects get classified wrapper tiers (identity/translation/rigid mat3/similarity with the `s·d` world-space distance correction that keeps the epsilon discipline valid). Byte gate held (one accepted deviation: explicit zero-center no-op subtraction now elided). Witnesses: **transform-bake** (transform-authored ≡ hand-folded twin), **conjugation** (one global g on every object AND the camera ≡ untransformed — the whole chain in one number), **regions-transformed** (nesting under Ry90·1.25+T). **SceneDescription stays FLAT forever** (owner-decided July 16 2026, doc §3): groups/trees belong to the AUTHORING layer only (seeded by a pure `flattenGroups` utility; the future DSL grows around it) — similarities are closed, so any composed chain re-expresses as one TRS and the compiler never needs to see a tree; the ParameterStore is the only runtime channel. **Stage 3 is BUILT** (July 16 2026): `src/authoring/flatten.ts` — the AUTHORING layer's first file (full stack now Authoring → App → Engine → Compiler → Components); `flattenGroups(SceneNode[]) → ObjectDescription[]` composes constant trees at definition time (TS object literals are the interim authoring syntax), stamps `name` provenance paths, rejects driven-under-transform per the §4 static-composition rule; TRS lowering shared as `similarityFromTransform` in components (Planner's `placementOf` aliases it); witness `flatten-tree` bit-exact vs the hand-folded twin. **Stage 4 is BUILT** (July 16 2026): uniform-DRIVEN placement — any `Transform` field takes `Value<>` (`{param}` → live per-object uniforms; the §6.1 rigid-frame Placement contract in `glsl/core/placement.glsl`: q_inv + (t_rigid, s), primitives' params absorb s in-shader so distances/t/epsilons stay world-exact, zero rcp); multi-path `PlannedUniform` (engine untouched); driven tiers across SDF wrapper + analytic nearest/any/region arms; pins enforced (driven excludes samplable emitters until the `Value<T>` light-params batch — RIGID-only there; transforms never accept GlslExpression). Witnesses `driven`/`driven-theta2` ≡ baked twins at two parameter points (0.00%). Sliders move objects with zero recompiles; the future graph runtime drives these same params.

**The July 17 2026 batch set is BUILT & GPU-SWEPT (vitest 824 + glslang incl. a registry kitchen-sink scene; owner's witness sweep 42/42 green Jul 17 after one fix — the reserved-`__` identifier bug in N5's sanitizer, see memory `reserved-underscore-bug.md`; detailed records: memory `batches-2026-07-17.md`, docs `fable-component-system.md` + `fable-geometry-materials-target.md`):** descriptor **kinds** (`point|vector|direction|length` — folds AND driven ×s scaling derive from one declaration; plane keeps the one coupled fold override); **type-first GLSL symbols** (`sphere_sdf`/`sphere_intersect`/`sphere_normal`, matching `lambert_eval`); **cylinder** (door test passed: math + rows + registry line, NOTHING else — no axis param, orientation is placement); **materials-§7 reorg** (schema rows own the property vocabulary end-to-end: numeric row defaults are the ONE truth, `PlannedMaterial = {id,name,model,values,medium}`, ior found structurally via the region-table row, `EMISSION_KEY` the sole policy-read name); **naming N1–N5** (material ids = INSERTION order — renames are free, integer-like names rejected; declared reserved param prefixes `engine./env./debug./renderer.` + `camera.position/target/frame` with paramToUniform-collision checks; symbol-contract tests for all families; suite/registry clobber guards; authored object names flow into emitted symbols — `sdf_pillar`, hoisted `shape_<name>` consts); **lights struct-alignment + door** (generated `PointLight/QuadLight/SphereLight`, sampler + MIS-pdf as ADJACENT functions in one file — the §6.1 mirror is no longer TS strings; descriptor desugar facts replace every Planner light branch; hoisted `light_<id>` consts); **structs GENERATED from rows** (occupant `.glsl` files declare FUNCTIONS ONLY — typedef-disciplined structs emit from the schema; the field-drift class is structurally dead); **every registry-shadow type union is dead** (primitive/phase/light-kind ids are `string`, registries + Validator gatekeep); **shape-not-backend** (`{ type, parameters, material, transform?, name?, backend? }` — the compiler resolves analytic-if-provided-else-sdf; all-analytic scenes carry NO marcher; `backend:` pins kept on `minimal` + `submerged` as deliberate marcher coverage); **one radiometric authoring word** (`emission` on lights AND materials — Le for area, radiant intensity for delta; `intensity×color` is dead; the ENV's `intensity` survives as the live slider; power-in-watts is authoring-layer sugar). Tooling: `npm run dump:shaders` covers the whole suite or `-- --scene <module>`.

**The doors-close batch is BUILT** (July 17 2026, post-review follow-up; detailed record: the target doc's ledger + memory `doors-close-batch.md`): the **lights door finished for real** — the review found three kind-name branches surviving outside the registry (Analyzer census switch, Planner's `present.add('lambert')` on a hardcoded quad|sphere list, the equiangular pin) — all now registry-derived; `brdfModels` derives from PLANNED materials so the desugared backing model flows alone; **unknown light kinds are rejected** (never silently skipped; 'directional' keeps its reserved-word message); **authored-light input schemas** (`authoredParams` on every kind descriptor + a generic Validator loop with C7 parity — required/shape/unknown-key, `validateAuthored` only on well-shaped input — plus a desugar-totality contract test enforcing both drift directions) ; the **door test** (`tests/compiler/lightsDoor.test.ts`) proves a synthetic registry-only kind compiles + glslang-links end to end. **`MaterialModel` union → string** (the B1 treatment — materials were the last unioned family; 'disney' died; 'emissive' keeps its migration rejection; per-model Analyzer feature flags deleted); **ior/region-table Validator rules structural** (capability + row source, no model names); **`emission_strength` merged away** (fixed-struct fossil — strength was 1 exactly when emission was assigned nonzero, so the product was identically `emission`; lambert_emission now `return mp.emission`; snapshots re-goldened, diff verified to be exactly the rider); **required XOR default** pinned on geometry rows (contract-test-enforced; defaults dropped from required rows). vitest 850; owner's Jul 17 sweep 42/42 green (the strength merge held on GPU). Same day, through the finished doors: **mirror** (Schlick delta conductor, f0 row shared with ggx — first §3.4 union dedupe; F-MIRROR 0.5 GPU-verified) + **disk primitive/light pair** (thin second tenant, normal = real param for similarity closure, kind-derived direction fold, concentric sampling, `canonicalize` descriptor fact replacing the Planner's plane name-branches) — witnesses cornell-disk + disk-bake GPU-verified; `chrome` demo card; memory `occupants-mirror-disk.md`.

**Medium emission is BUILT — GPU-UNSWEPT** (July 17 2026 evening, `docs/impl-plan-medium-emission.md`): `emission` on a medium = **ε, the volume emission coefficient** (W·sr⁻¹·m⁻³, dL/ds = ε — B2's dimensional ladder: intensity/radiance/ε; saturation = ε/σ_t; Kirchhoff coupling is authoring sugar); the D1 scale applies to ε (source-function preservation, owner-pinned); collection is **per-tentative-collision** in both null-collision loops (pbrt's shape, scalar-σ̄ collapse `w ⊙ ε/σ̄`, derivations in the plan) via the generated `medium_emission` accessor — the absorption branch stays a pure terminator; constant absorbing media get the exact closed form `ε(1−e^{−σ_a t})/σ_a`; emissive SCATTERING media route to the tracking arms with an **auto-derived majorant**; glow is path-found only (volume light sampling deferred). Witnesses AWAITING sweep: emit (closed form + equilibrium channel), emit-swap (estimator twin), emit-sat (ε/σ_a through the delta arm), emit-scatter (nee≡pt). Demo: glowblobs. **The mis/tally batch is DEFERRED** (owner, after a planning read — near-zero win for current scenes; re-triggers: nee-only fireflies or the spectral axis).

**Heterogeneous media are BUILT — GPU-UNSWEPT** (July 17 2026, `docs/impl-plan-heterogeneous-media.md`; design authority `docs/fable-heterogeneous-media.md` as amended at kickoff: clamp-in-the-lookup, the absorbing-only ratio arm, **transcribe-with-lottery** — Kutz 2017 Alg. 4 + history-aware avg probabilities transcribed from the fetched papers, deviations declared-and-inert only): `GlslExpression.params` (sliders in formulas → live uniforms), `MediumDescription.majorant`, the D1 clamp emitted INSIDE `scene_medium_properties`, the `delta_tracking` occupant (delta / ratio-absorb / ratio-shadow arms behind the unchanged seams), per-medium 2×2 dispatch (constant media byte-identical — gate held), `volumeSampling: 'delta-tracking'` live under pt/pt-nee (mis Validator-rejected until the tally batch; equiangular × heterogeneous rejected), `MAX_NULL_COLLISIONS` 64. Witnesses in the registry AWAITING the owner's sweep: **het-const** (F-HET-CONST estimator-swap twin — the sharpest gate), **het-slab** (linear chromatic σ(z) → the F-SLAB triple exactly), **clamp** (D1 as a twin equality + e⁻¹), **het-driven** ×2 (formula slider ≡ baked at two points). Gates are pre-calibration estimates. **The mis/tally batch is DEFERRED (see the emission paragraph above).**

**Meshes + instancing + TLAS are BUILT (Jul 19) & AUDIT-HARDENED (Jul 20 2026)** — third geometry class (OBJ triangle meshes, thin/single-material v0, ray-into-local, binned-SAH BLAS per mesh) + instancing (one prototype × N placements — mesh BLAS or s-scaled analytic — the driven wrapper looped over a placement texture) + per-batch TLAS (`buildBVHNodes` over instance world boxes; spheres 500 ~7×). Estimator axes `meshTraversal: brute|bvh`, `instanceAccel: linear|tlas` (registry ids, Validator-gatekept, defaults bvh/tlas). The Jul 20 audit batch set: **validation** (unbounded-prototype rejection — instance prototypes must declare `bounds()`; ONE `validateGeometryObject` for top-level objects AND instanced prototypes; the transmissive-on-thin warning as ONE structural rule over the thin set — dies per-kind as containment lands; traversal-enum + C5 inert rules), **witnesses** (mesh-instance-twin — the ÷s scale≠1 guard; bvh≡brute + tlas≡linear near-exact equality arms — identical-stream gates), **structure** (`components/accel/` carved as the substrate family; the data rail extracted; `sceneMeshes`/`sceneInstanceBatches` = the ONE ordinal truth for Planner + App, pack-dedup for shared prototypes), **doors** (the intersection registry opened; authored names flow into `mesh_<name>`/`instance_<name>` symbols). Numeric sweep owner-gated: mesh-furnace 0.4, mesh-quad-twin (+brute arm), instance-twin (+linear arm), mesh-instance-twin. Deferred: multi-material meshes (THE priority), dielectric/interior-media meshes (winding-number containment), mesh NEE lights, Stage B data-driven distinct objects, Stage C boxed-SDF leaves, SDF instancing.

**Instance clouds (`.inst` data files) are BUILT** (Aug 7 2026, `docs/fable-instance-clouds.md` — design + build same day; format spec/writer's guide for collaborators: `docs/fable-inst-format.md`): large external instance datasets (proven at 194k/289k spheres) enter as **render-ready binary columnar `.inst` files** (positions + optional sizes/LINEAR-colors/quat-orientations + 0–K NAMED f32 scalar columns + positions-only AABB + provenance; ~6× smaller than JSON, zero-parse) — science (radius laws, sRGB→linear) lives OFFLINE in UNTRACKED user-local converters (owner-pinned: the renderer knows ONE data format — external schemas never appear in tracked code; the repo ships only the encoder `tools/inst-format.mjs`, the ONE write-side layout truth, round-trip-gated against `src/authoring/loadInstances.ts`). `InstancedObject.placements` accepts a **packed struct-of-arrays form** (byte-equality-gated vs the Transform[] arm; Validator: s>0, unit quats, finite, per-batch nodes ceiling (DATA_TEX_WIDTH 4096 since Aug 7 — the 1.4M octic tripped the declared trigger; ceiling now ~4M/batch)); `instanceCloud(table, {shape, material, colorDrives, sizeScale, size/color hooks})` is the authoring sugar — **hooks are CPU-only at pack time (laws NEVER on the GPU: TLAS boxes are CPU-built from radii) and retune = repack + re-upload, never recompile**. Data scenes are ASYNC registry entries (`demos/dataScenes.ts`, thunk + entry-level name; registry-iterating tests skip them — coverage = the committed 500-pt fixture `tests/fixtures/cloud-500.inst` through glslang); exports stamp the file's provenance (`SceneDescription.provenance`). Gallery: `clebsch`/`croissant`/`steiner` (724k, no-colors arm)/`crixxi` (744k)/`octic` (1.4M) — `test-data/*.inst`, untracked; converter presets in the untracked `test-data/convert-pointset.mjs` (incl. coordinate scaling + the steiner log law over 9 height decades). SAH builder: typed-array flat core (Aug 8 — byte-identical to the old builder via the reference-twin gate, 2.8×; octic pack ~4s) + the pack in a Web Worker (App-side `utils/packWorker.ts`, sync fallback) — load no longer freezes the page. Deferred (§8): **'cube' shape** (box is DELIBERATELY SDF-only — params not closed under rotation; needs a per-context backend fact, owner discussion), drag-drop, in-app retune.

**The placement-fold batch is BUILT — GPU-UNSWEPT** (Aug 9 2026, `docs/impl-plan-placement-fold.md` stages 1–3; amends `fable-transforms` §5.2/§6.1): the fact conflation is dissolved — **`similarityClosed`** is a declared descriptor fact (a full similarity folds into the param rows; sphere/plane/quad/disk true, box/cylinder false — NOT derivable from kinds, equivariance-contract-tested BOTH directions), independent of `provides.analytic` (intersection method) and `bounds()` (instanceability). `foldAnalyticParameters` → **`foldPlacementIntoParameters`** (backend-neutral; throws on rotated non-closed). **Maximal constant folds on both backends** (`classifyPlacement` — ONE truth): closed shapes emit NO wrapper (bare `<type>_sdf`/params-folded analytic — every centered SDF object lost its `p = p − center` line); non-closed fold T,s and keep a pure-rotation residual on the rigid tier (the constant `s·d` similarity tier is dead); `keepsLocalFrame` gates the fold on BOTH backends (its third reader — the oriented SDF uv chart needs the frame). **The instancing params tier** (the §6.1 stride amendment): per-batch record layout decided at plan time in `dataTenantsOf` (never from data — retune can't change stride): analytic ∧ closed ∧ rows ≤ 4 floats ∧ ¬materialReadsUv → **1-texel folded-params records** (`Sphere(rec.xyz, rec.w)`, WORLD-space intersect, no conjugation/`placement_normal` — half the placement bandwidth for every sphere cloud, orientations absorbed exactly by the fold); else the 2-texel §6.1 frame record. `InstancedObject.placementRecord: 'frame'` is the coverage pin. Witnesses AWAITING sweep: **instance-params-twin ≡ instance-params-frame** (rotated scale-varied OFF-CENTER sphere batch, identical-stream) + the existing transform/instance twins re-gating the fold. **Stage 4 is BUILT — GPU-UNSWEPT** (Aug 10 2026, see the stage-4 paragraph below): box slab/cylinder interval analytic occupants; cube clouds open. Still deferred: disk 2-texel params arm, driven-placement CPU folds via the values rail, exact params-tier TLAS boxes. **The perf witness is BUILT** (same day): `npm run witness -- --perf` — REAL-GPU (never SwiftShader; renderer string printed, `--headed` fallback) report-only ms/frame rows (median of 3 `extendProduction` batches + readback barrier, never cached); fixture `perf-cloud`/`perf-cloud-frame` (tracked procedural 200k-sphere cloud, params vs frame arms). First numbers (M1 Pro @512²): params 30.5 vs frame 35.8 ms/frame (~15% — node fetches now dominate, the wide/compressed-BVH-node thesis). Future accel occupants add arms + gate here. **The accel research batch is BUILT & MEASURED** (Aug 9 2026, `docs/fable-accel-cwbvh.md` — three research agents: the Ylitie 2017 paper transcribed, Meister 2021 survey, WebGL2 spec/practice verified): batch A hygiene shipped (per-ray `1/rd` hoist through all 7 walks, Ize 2013 2-ulp `tf` guard in the slab test, `TLAS_LEAF_SIZE` knob — the leaf sweep REFUTED bigger sphere leaves: 2/4/8 → 31.3/32.9/38.1 ms, leaf 2 stays); **CWBVH (compressed 8-wide quantized BVH) fully built as the `instanceAccel: 'cwbvh'` occupant** — collapse DP (Eq. 5–8), conservative f64→quantized pack (floor/ceil, power-of-two scales, f32-decode-verified), the 7th INTEGER rail channel (`data_nodesq` RGBA32UI/usampler2D — bit-packed data never rides float textures), scalar octant-ordered walk (SWAR popc + float-exponent find-MSB — no ES 3.10 intrinsics), TS reference traversal ≡ brute force + round-trip/containment vitest gates, cwbvh-order records twin region (v1 pins: params-tier, no attrs/mesh protos — Validator-enforced). **GPU equality: cwbvh ≡ tlas Δmean 0.00%/rmse 0.00%. Perf VERDICT: NO-GO — 38.9 vs 32.9 ms/frame (0.85×) on M1 Pro/ANGLE Metal**: the scalar per-slot byte-decode ALU (what the paper's PRMT/SWAR made free) swamps the fetch savings; Meister §9's GPU skepticism vindicated for scalar WebGL2. The occupant stays maintained-but-non-default (equality witness + glslang keep it honest); the first WebGL2 CWBVH datum published either way. Re-open triggers in the doc. Two future accel sessions have STARTER BRIEFS (read at session top; briefs, not designs): `docs/fable-sdf-accel-starter.md` (boxed-SDF leaves — the only unindexed geometry class; interval-restricted marching) and `docs/fable-light-bvh-starter.md` (SAOH light tree for hundreds of small lights; bit-trail pmf).

**The light tree (many-lights selection) stage 1 is BUILT — GPU-UNSWEPT** (Aug 9 2026, design authority `docs/fable-light-bvh.md` — supersedes the starter; owner decisions: NO orientation cones in v1, TWO stages): NEE light selection is a carved registry axis **`estimator.lightSelection: 'power' | 'uniform' | 'bvh'`** (`LIGHT_SELECTIONS`, membership-only per the OBJECT_DISPATCHES precedent; power default byte-identical — snapshots held). The `bvh` occupant: **lights go TABLE-resident** (`components/lights/table.ts` = the row-layout truth: header kind-code texel + schema-row floats in ctor order; generated per-kind loaders `<kind>_light_row`) and selection is a **stochastic light-tree descent** with a **bit-trail pmf walk born adjacent** (same fetches, same importance call, same `p_l`/`1−p_l` expressions — the selectionExprs discipline transported); v1 importance is **NORMAL-FREE** `Φ/max(d², (diag/2)², ε)` (cones provably vacuous for sphere/point emitters; the horizon term needs a seam+PathState change — witness-gated follow-up; pbrt's d²-vs-length clamp transcribed in the SQUARED form), fresh RNG draw per level (pcg4d ⇒ no stratification argument; RTG's fp32-rescale warning voided). Builder `components/accel/light_tree/` (energy-weighted binned SAH = the no-cones SAOH degenerate; leaf = exactly 1 light, 2n−1 nodes, 2-texel `{min,Φ}{max,link}` nodes; 48-level trail cap via balanced-split fallback; coincident lights → power-proportional chains) + TS twins powering the vitest Σpmf=1/trail-replay gates. Rail: `lightTree` tenant (**`lightRosterOf(scene)` census = the ONE scene-side mirror of the Planner's three desugar routes**, Planner-asserted kind-for-kind + vitest-pinned values across all 131 registry scenes; new descriptor fact `treeBounds` — point/spot/sphere/quad/disk/softbeam have it), ledger stanza appended LAST (existing bases byte-stable), App packs table+tree+trails (rail upload now also runs for mesh-free light scenes). v1 pins (Validator, itemized): constant emission only, no equiangular, no directional/beam kinds (MESH kinds joined Aug 10 — the mesh-treeBounds batch below). Witnesses GPU-VERIFIED (owner sweep Aug 9, 5/5): **hundred-spheres** (100 sampleAsLight emitters under objectDispatch table) — nee power≡bvh Δ0.03% χ²0.78, **mis power≡bvh Δ0.04% χ²0.71 — THE trail-pmf gate**, and the win metric **σ/µ @192spp: bvh 2.89% vs power 4.31%** (~2.2× variance, and the bvh arms rendered ~1.8× faster under SwiftShader — the table-resident storage killing the 100-arm chains); two-light bvh arm ≡ power Δ0.01% χ²0.72 (n=2 delta). **Stage 2 (per-instance light identity) is BUILT — GPU-UNSWEPT** (same day): a light-eligible instanced batch (ONE predicate `batchLightEligible`: params-tier SPHERE prototype ∧ constant emission ∧ ¬sampleAsLight:false) contributes its instances as INDIVIDUAL tree lights — the GLOBAL light-index space `[0,R)` registry ∪ per-batch windows in RECORD order (= `Hit.element`); **the params placement record IS the sphere-light row** (no second table; batch Le baked in the arm; per-instance Φ = π4πr²L̄e from packed radii); **`light_of(int region, int element)`** globally (the one seam churn — snapshots re-goldened, audited to exactly that + the new entries); batch lights samplable ONLY under 'bvh' (path-found under 'power' — estimator-only, §11.2); tree builds after batch packs from the same records the arms read. **§7.1 per-instance emission is BUILT** (Aug 10): the old `attributes.emission` hard error is lifted for params-tier sphere batches — the tree's per-instance Φ IS the structure the deferral awaited; ONE storage truth: the minted AttributeValue row feeds the hit-side fill + the sampler arm + the pdf arm (same records texels, element-indexed) + pack-time Φ; `material_is_emissive` treats attr rows as may-emit; `.inst` LINEAR colors columns drive it directly — gallery **clebsch-glow** (own card: 194k individually-colored lights, white rationals + orange quadratics; `glowScale` dial in dataScenes.ts) + demo **embers**. Witnesses AWAITING sweep: **instance-lights ≡ instance-lights-ref** (batch ≡ 64 individual objects, + nee≡mis = the ELEMENT-trail gate), **glow-shell** (camera inside a 100-emitter shell — the near-field-clamp gate nee≡mis + σ/µ report vs pt); the light_of churn touches every samplable-emitter program, so the full sweep re-gates. Stage 3+ ledger (doc §7): cone texel, mesh rows, directional/beam outside stage, medium-vertex entry (mis/tally batch), refit for driven emission. Worker offload BUILT (Aug 10 — clebsch-glow fired the trigger): app/utils/lightTreePack.ts, packWorker pattern, inputs transferred, sync < 4096 leaves. **v1.5 (LightQuery + the horizon term) is BUILT — GPU-UNSWEPT** (Aug 10, doc §3.2): a CPU probe over the real trees measured **54–59% of selection mass wasted on below-horizon lights** (p90 86% on ember-rock surfaces) → witness-justified same-day build. **`LightQuery { p, n }`** (core structs; n=0 = no orientation) is pbrt's LightSampleContext transcribed as DESIGN: static techniques pass (mat, hit) through GENERATED constructors `light_query_surface/medium` (transport-emitted policy; `mat` in the signature ahead of need), seams are `lighting_sample(LightQuery, vec2)`/`lighting_pdf(LightQuery, …)` TOTAL across all programs, and **PathState.prev_query replaces prev_p** (mis-gated; the single-writer `kernel_record(s, pdf, LightQuery, delta)` stores the SAME constructor value the NEE site used — **stored-query replay**: the pmf sees byte-identical context forever, and future context growth churns nothing). Importance v1.5: **EXACT box-below-horizon cull** (sign-selected far corner vs the tangent plane — a declared improvement over pbrt's sphere cone, found by the half-space vitest: sphere culls left 52% dead-descent mass; the box cull is HEREDITARY ⇒ zero dead descents while any light is above) + the composed corner/center shaping min(1, max(cos_center, h/dmax)) — v1.5.1, no sphere anywhere: the sphere shaper saturated on straddling boxes and left diagonal-facing receivers unimproved (the owner-observed "diamond", probe-confirmed 4-fold anisotropy, now second-order; limb noise proxy 0.36–0.87 vs 1.45–1.96 normal-free). Bias-safe one-sided: transmissive models are pure-delta (never run NEE; prev_was_delta short-circuits mis) — **pinned by the lightQuery policy contract test** (`transmission ⇒ ¬nonDeltaLobes`; a future GGX-T fails it pointing at the constructor policy). vitest 1686 green; snapshot churn audited = the migration classes only.

**The accel review + consolidation batches are BUILT & GPU-SWEPT** (Aug 10 2026, the full-review session; vitest 1706 + glslang green; owner sweep Aug 10: accel-triple nee≡mis Δ0.01% χ²0.02 + pt anchor Δ0.11%/rmse 52.4% calibrated, mesh-light-twin power≡bvh Δ0.03% χ²0.53 + bvh nee≡mis Δ0.01%; stage-2/v1.5 witnesses verified same sweep — instance-lights twin Δ0.00% χ²0.00 both gates, glow-shell nee≡mis Δ0.00% + σ/µ 3.10% vs pt 18.01%, hundred-spheres σ/µ 2.22% vs power 4.31%; the 5 sweep failures are PRE-EXISTING — the 4 grin furnaces [the Jul 22 open walker decision] + softbeam-wall core [the Aug 9 beam batch, +3.3% shared by nee AND mis ⇒ a normalization bias in the sin²δ Le, not an estimator bug]): **correctness** — cwbvh × lightSelection 'bvh' × light-eligible batch Validator-rejected (the cwbvh leaf permutation breaks Hit.element→light_of identity — found by cross-referencing the review's reports), the 'bvh' inert warning now counts batch lights (clebsch-glow's shape warned falsely), witness **accel-triple** (mesh BLAS × instance TLAS × light tree in ONE program, mixed-kind tree leaves, nee≡mis χ² + pt RMSE tripwire pre-calibration). **Walk consolidation** — `bvhWalkLines` in accel/bvh/bvh.ts is THE one generated binary-walk skeleton (instance TLAS occupant + both scene-table walks — previously byte-identical copies), `BVH_TFAR_PAD` define single-sources the Ize pad (bvh.glsl + cwbvh walk + TS ref), mesh.glsl's leaf prologue is ONE `mesh_tri_fetch` + `mesh_side_range` (the containment walk's inline leaf absorbed; `mesh_any_bvh`'s unordered push declared deliberate). **Builder consolidation** — `buildBVHCore` (bvh.ts) is THE one binned-SAH recursion, parameterized by per-item weights (Σ1 exact ⇒ ray cost bit-identical — the bvhFlat byte gate held) + stop policy (alwaysSplit/depthCap/sorted-median fallback) + emit callbacks + threaded trail bits; **the light tree is now a feeder** (~30 lines of policy; inherits the O(bins) prefix/suffix sweep — its fork was accidentally O(bins²)); `runInWorker` (app/utils/worker.ts) is the one off-thread skeleton (instancePack gained the 4096 sync gate); `bvhNodeBound` single-sources 2N−1; AABB is ONE exported type (10 structural respellings replaced); pack.ts write/alloc twins unified. **Mesh lights under the tree (mesh treeBounds)** — `treeBounds` gained the `'data'` form (rail-resident geometry, box supplied by the App packer: BLAS root box under the constant placement); the roster's mesh entries carry REAL values (radiance + s²-folded area, vitest-pinned vs the Planner — exception deleted); the tree-regime mesh arms are the table row + per-light baked rail-base dispatch (sampler) and the identity-free area pdf + hit normal (pdf); **one mesh emitter no longer vetoes 'bvh' for the whole scene** (L3 passes via the fact; directional/beam stay ineligible). Witnesses AWAITING sweep: accel-triple (nee≡mis + pt anchor), mesh-light-twin keys 4/5 (power≡bvh + bvh nee≡mis — the one-leaf table-row gate).

**Placement-fold stage 4 + the SDF-accel design are DONE — stage 4 GPU-UNSWEPT** (Aug 10 2026, same session as the review batches): **`docs/fable-sdf-accel.md`** is the owner-approved boxed-SDF-leaves DESIGN (supersedes the starter; BUILD DEFERRED to the trigger — custom distance fields / many-SDF scenes; pinned: LEAF_SDF fourth leaf kind, per-TYPE interval-restricted leaf marchers, scene-TLAS leaf size 1 so the interval IS the node box, containment point-in-box early-out in-batch, the interval-end epsilon rule named, the declared-bounds/blends-share-a-leaf contract for custom fields; stage 4 ordered FIRST because it drains box/cylinder out of the SDF class). **Stage 4 (box/cylinder analytic occupants)**: `box_intersect` (slab, inside-test root selection — the sphere review-finding discipline) + `box_normal`, `cylinder_intersect` (slab ∩ tube INTERVAL form) + `cylinder_normal`, `provides.analytic: true` + `bounds()` on both descriptors — so box/cylinder objects now resolve ANALYTIC by default (backend pins keep marcher coverage), are instanceable (frame tier), and `instanceCloud` gained the **'cube' shape** (fable-instance-clouds §8 CLOSED; fixture-gated through glslang). Two new seams for the FIRST non-closed constant analytic shapes: the Planner's constant analytic route now goes through `classifyPlacement` (rotated box/cylinder = T,s folded + constant-quat rigid arm, the P1b emission shape; identity residual = bare folded arm), and the scene TABLE excludes rotated non-closed analytic (their folded record cannot exist — `foldPlacementIntoParameters` throws; the tabled form is fable-sdf-accel §2.1's deferred quat record). Snapshot churn audited = the backend-flip class (marcher blocks deleted from every all-analytic scene — cornell lost 163 lines). Witnesses AWAITING sweep: **solids-analytic ≡ solids-sdf** (rotated box/cylinder closed forms ≡ marcher, cross-backend rmse) + **cube-cloud ≡ cube-cloud-ref** (48-box frame-tier batch ≡ individual rigid-arm boxes) — plus conjugation/regions-transformed/driven-baked/cylinders re-gate the rotated arms. vitest 1723.

**Boxed-SDF leaves (Stage C) are BUILT — GPU-UNSWEPT** (Aug 10 2026, `docs/impl-plan-sdf-accel.md` T1–T5; design authority `docs/fable-sdf-accel.md`, owner-approved and built the same session): the SDF class joined the scene table as **`LEAF_SDF`** — interval-restricted per-leaf marching under `objectDispatch: 'table'`, the global min-march untouched as the `'unrolled'` reference (and genuinely the right regime below ~10 objects — the shared step loop is the small-N economy). T1: `bvh_aabb_hit_range` (the reserved entry/exit form) + the scene TLAS at **leaf size 1 unconditionally** ("node box = object box" is an invariant — the march interval IS the node box, zero record growth). T2: eligibility = SDF backend ∧ constant ∧ `bounds()` ∧ ¬keepsLocalFrame (ROTATION allowed, unlike the analytic arm) ∧ the record budget; records ride the analytic region/stride with per-(type,arm) header codes + a TEXEL-ALIGNED §6.1 rigid tail (`sdfRecordPack`/`sdfTailTexel` = the one layout truth); packed via `classifyPlacement`. T3: generated per-TYPE `march_leaf_<type>`/`_any` (conjugate ONCE by the tail, march `|<type>_sdf|` in `[lt0, lt1]` dilated by `march_epsilon(lt1)`, commit through `raymarch_commit` — the ONE hit body; per-leaf exhaustion inside = the grazing stall-commit, outside = miss-and-resume), the `bvhWalkLines` range form, `scene_march_bound` shrunk to the RESIDUAL subset (all-tabled scenes carry an empty bound). T4: region-keyed queries (normals/containment/interior/uv) route tabled owners through per-TYPE record fields `sdf_leaf_field_<type>` (prototyped in the dispatch, defined with the table; the conjugated field's gradient IS the world gradient) + the SDF-solids containment record loop (no box early-out — declared: primitive evals cost a box test; expression fields re-open it). Witnesses AWAITING sweep: **sdf-table-twin** (30 rotated pinned SDFs + a grazing ground slab, table ≡ unrolled identical-stream 0.002/0.01 — THE §3 epsilon-rule gate) + **perf-sdf-{8,32,128}** (`--perf` report-only: the crossover referee; no default change until measured). SDF instancing = the follow-up door (the frame wrapper + `march_leaf` as leaf body). vitest 1755.

**The SDF object contract is DESIGNED + BUILT — GPU-UNSWEPT** (Aug 10 2026 evening, `docs/fable-sdf-contract.md` — the design authority for how SDFs work; sits on the sdf-as-shape rebuild + the five-shape library, see memory): **an SDF object = ONE authored CANONICAL field + a declared-facts sheet; everything derivable is generated, every declaration is gated by sampling.** Occupants author `<type>_sdf` (origin-centred — the five marched shapes LOST their `center` rows; position/rotation/scale are placement's alone, via `classifyPlacement`'s new canonical arm: s folds through length rows, R+T ride ONE rigid residual) plus optional uv chart; **`<type>_sdf_intersect` + `<type>_sdf_normal` are GENERATED per marched type** (`emitSdfIntersect`/`emitSdfNormal` in geometry/index.ts — the 18 hand copies deleted, the epsilon/stall rules single-truth, the normal now the 4-tap tetrahedral gradient), exactly linked (analytic-only programs carry zero march code; the presentTypes bound-closure trimmed to interval callers). New descriptor facts: `stepBudget` (per-shape loop bound, default MAX_MARCH_STEPS) + `refine` (hit-refinement conservatism factor — see the hygiene note below; `lipschitz` was carved then DELETED Aug 11, zero occupants — safety factors live IN-FIELD where they can read params); `thickness` stays IN the field (pinned: `<type>_sdf` is the exact field of the object as declared). Cross-type `bounds()` DERIVED from `marchBound` (menger/apollonian/bottle/knob/torus restatements deleted). **B1 fixed a real silent-clipping bug**: `canonicalizePrimitiveParameters` is now THE resolve site, so `marchBound.values`/`bounds` receive RESOLVED values on the driven/retained paths too (previously a driven bottle with defaulted rows got NaN extents and vanished; `marchBound.test.ts` now feeds minimally-authored input so the class stays dead). vitest + glslang green; snapshot churn = the named classes; witness sweep OWNER-GATED (numbers move at epsilon scale: 6→4 tap). **The scene-local door (§5.2) is BUILT** (Aug 11 2026): **`defineSDF`** (`components/geometry/custom.ts`) — a bespoke field defined IN its scene file, one call (GLSL field + REQUIRED TS twin + declaration sheet), `local: true` descriptor, zero registry ceremony; definition-time gates (name/rows/symbols/bound; point rows rejected — canonical) + the **Validator twin-samples the declared bound over each authored object's RESOLVED values** (`geometry/boundCheck.ts` = the shared checker core with marchBound.test; a clipping bound = a compile error naming the object — proven by the shrunk-bound test). Same pass fixed a second resolve-contract violation: `validateValues` now receives resolved values (omitted optional rows no longer produce spurious 'undefined' errors). Demo **custom-fields** (gyroid lattice — conservative √6·k gradient-bound divisor, ball-clip = exact bound by construction; solid glass quartic tangle — f<0 genuine interior, Chebyshev-cell clip owns the bound so the `shape` dial roams): compiled, kitchen-sink + glslang covered (local fields ride automatically, constant+driven arms), link-map snapshot, headless-GPU render-verified. vitest 2013.

**The region→material decomposition is BUILT** (Aug 11 2026, `docs/impl-plan-region-materials.md` — plan + build same session): the last O(object-count) generated construct is dead — under TABLE dispatch `material_of` is ONE rail fetch (the `regionMaterials` tenant: ids 4/texel in `records`, ledger-appended LAST; scene-side mirror **`regionMaterialsOf(scene)`** in dataTenants.ts covering desugared hittable-light regions, Planner-ASSERTED id-for-id — the light-roster pattern) and `ior_of` decomposes to `ior_of_material(material_of(r), p)` (the material half STAYS generated — GRIN formulas/driven uniforms; sized by materials). `materials.regionLookup: 'baked' | 'data'` is the ProgramDescription decision, set with objectDispatch (hoisted to one truth); UNROLLED programs keep baked arms BYTE-FOR-BYTE (snapshot gate held — churn = the regionLookup field only). Pins preserved exactly: region −1 answers before any fetch; open-transmissive-mesh exclusions ride as explicit per-mesh arms. Bonus fix: the App rail-upload early-return now includes `sceneTable` (a tabled scene with no meshes/batches/tree previously skipped upload — latent). **Measured: knot 4515 → 1470 lines (material_of 3002 → 9)**, headless-GPU verified (tabled knot renders per-object materials through the rail). vitest 2017; witness sweep OWNER-GATED (sdf-table-twin/bazaar/accel-triple re-gate the twins).

**The SDF hygiene batch is BUILT** (Aug 11 2026, owner-ordered six-pack; record: memory `sdf-hygiene-batch`): (1) **`lipschitz` fact DELETED** (zero occupants; in-field safety factors + value/gradient authoring made it dead); (2) **`primitiveHitFill`** = THE one hit-fill for all SEVEN primitive-object arms (unrolled marched/analytic ×3, instanced params/frame tiers, both table leaves — audit D4 closed; the normalize rule settled ONCE: primitive normals are unit by contract + world maps are rotations ⇒ never re-normalize; mesh arms keep theirs, interpolated normals are genuinely non-unit); (3) **witness `field-glass`** (defineSDF tangle in real glass, X-GLASS pattern nee≡mis + pt tripwire — the door's numeric gate; the tangle definition MOVED to the witness fixture, demo imports it) + **`sdf-table + table` joined the generated-glsl byte snapshot** (first byte coverage of the table regime incl. the DATA-form material_of); (4) **epsilon-coupling test** (`epsilonCoupling.test.ts` — EPS_INTERFACE = 10× MARCH_EPSILON ∧ ≥ 2× the cap, parsed from the .glsl files: the derived-coupling rule enforceable); (5) **defineSDF twin OPTIONAL** (owner-decided: omit ⇒ the declared bound is TRUSTED, gate skipped — tested); (6) the **intersection refinement is the `refine: C` declared fact** (built same day: sign-only doubling-bracket sized by C + 8 bisections in the ONE generated loop — fixed the glass tangle's ring banding [accepted TRUE residual ≫ EPS_INTERFACE for conservative estimates], then scoped to declaration after always-on taxed the fractals; tangle re-authored VALUE/GRADIENT — the variety-port form, ~2× faster, `refine: 4`). vitest 2032.

**Still Euclidean-only** (equiangular NEE is delta-lights + nee only — area arms and placement-MIS in `impl-plan-equiangular.md`), no spherical-rectangle quad sampling / two-sided quads / `Value<T>` light params (deferred table in `impl-plan-area-lights.md`), no curved spaces (the `ambient_*` seam is ready but H³/Schwarzschild are unbuilt). Glass *shadow rays* remain opaque — a DECLARED truncation (`measurement.shadows: 'opaque-dielectrics'`). Don't describe deferred items as built. **Discuss loop/interface structure before implementing** (owner preference); don't mix refactors with feature work.
