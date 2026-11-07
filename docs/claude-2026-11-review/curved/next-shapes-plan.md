# Curved spaces, next tier: box, quad, cylinder (and the quad light) in H³ and S³

Status: model-written plan (2026-11-07), for the coordinator's lean process; revised after one
independent review (no math errors found; its verification and wiring findings are applied). Choices the owner has
not made are marked *provisional* with their undo. Evidence: [facts.md](facts.md) §primitive-bodies
(formulas checked in float64 against brute force by `primitive-bodies/shapes.ts`), and the
derivations below, each re-checked by a twin written before the GLSL (§5).

## 1. Problem

The curved spaces have sphere, plane and disk shapes and point and disk lights (support.md). Design
§2.5 lists box, cylinder, torus and "quad as a centered (a, b) rectangle" next. A scene that uses one
of them in H³ or S³ is a Validator error today ("primitive 'box' has no hyperbolic implementation").

## 2. Definitions

Every shape sits canonically at the origin o = (0,0,0,1) of its own frame; its placement isometry
carries it (README "Curved spaces"). T(x) below is tanh x in H³ and tan x in S³; ⟨·,·⟩ is the
space's form (Minkowski in H³, the dot product in S³). A half-space is {x : ⟨x, N⟩ ≤ 0} for a unit
N ⊥ o-side convention as in the plane bodies; its signed distance is asinh⟨x, N⟩ (H³) or
asin(x·N) (S³), positive outside.

- **Box** (rows: `center` point, `halfSize` vec3 of lengths h = (h₁, h₂, h₃)). The region bounded
  by three pairs of totally geodesic planes, the pair i perpendicular to the axis eᵢ at geodesic
  distance hᵢ from o on either side: ∩ᵢ {|xᵢ| ≤ T(hᵢ)·x_w}. Face normals
  N_{i±} = (±cosh hᵢ·eᵢ, sinh hᵢ) (H³), (±cos hᵢ·eᵢ, −sin hᵢ) (S³). In the Klein (H³) or gnomonic
  (S³) chart it is the Euclidean box |kᵢ| ≤ T(hᵢ). Dihedral angles are not right angles
  (cos = sinh hᵢ sinh hⱼ in H³).
  - H³: always a convex region; it is bounded (its corners exist) iff Σ tanh² hᵢ < 1. *Provisional:*
    the Validator requires that (a box is bounded). Undo: drop the rule; the bodies work unbounded.
  - S³: well defined and bounded for every hᵢ ∈ (0, π/2): if x_w ≤ 0 the two faces of each pair
    force xᵢ = 0 for every i, so x = (0, 0, 0, −1), which violates |xᵢ| ≤ tan hᵢ·x_w; so the box lies
    in the open hemisphere x_w > 0, where the gnomonic chart is a diffeomorphism. At hᵢ = π/2 a pair degenerates (both
    faces become x_w = 0). Domain: `constraintIn: { spherical: interval (0, π/2) }` on `halfSize`
    (per component, the existing mechanism).
- **Cylinder** (rows: `center`, `radius` r, `halfHeight` h). The tube of geodesic radius r about the
  y-axis geodesic {(0, S(s), 0, C(s))} capped by the two planes perpendicular to the axis at axial
  distance ±h. The distance from x to the axis is asinh|x_xz| (H³) / atan(|x_xz|, |x_yw|) (S³), so
  the tube is |x_xz|² ≤ sinh² r (H³) / sin² r (S³) — in S³ a Clifford-type solid torus. Caps:
  |x_y| ≤ T(h)·x_w, normals (0, ±cosh h, 0, sinh h) / (0, ±cos h, 0, −sin h).
  - H³: convex (sublevel set of the distance to a geodesic), bounded, no constraint.
  - S³: needs r, h ∈ (0, π/2) (at r ≥ π/2 the "tube" swallows the dual circle; at h = π/2 the caps
    coincide). Then it lies in x_w > 0 (same argument as the box). It is **not convex**: in the
    gnomonic chart the tube is the one-sheet hyperboloid region k_x² + k_z² ≤ tan² r (1 + k_y²), so a
    geodesic can meet the capped cylinder in two arcs. `constraintIn: { spherical: (0, π/2) }` on
    both rows.
- **Quad** (rows unchanged: `corner` point, `edge1`, `edge2` vectors). *Provisional:* in a curved
  space the quad is the rectangle **centered** at exp_o(corner + (edge1 + edge2)/2) — the center of
  the Euclidean quad — in the totally geodesic plane through it spanned by edge1 and edge2, bounded by
  the two pairs of geodesics perpendicular to ê1 and ê2 at distances a = |edge1|/2 and
  b = |edge2|/2 from the center (in the plane's Klein / gnomonic chart, |k·ê1| ≤ T(a),
  |k·ê2| ≤ T(b)). In E³ that is exactly the Euclidean quad when edge1 ⊥ edge2, so one authored quad
  means the same panel in every space. The rows keep their E³ names, so `corner` is the Euclidean
  corner, not a vertex of the curved rectangle (the curved corners lie at distance
  atanh√(T(a)² + T(b)²) / atan√(…) from the center, not |edge1 + edge2|/2). Undo: per-space rows
  (a, b), which needs per-space row machinery that does not exist.
  - Curved-only Validator rules (`validateValuesIn`, §4): edge1 ⊥ edge2 (|ê1·ê2| ≤ 1e-9 —
    the rectangle needs orthogonal axes); H³ bounded: sinh a·sinh b < 1 (corner angle
    cos α = sinh a sinh b); S³: a, b < π/2 (|edgeᵢ| < π). The emitting side is +ê1×ê2 as in E³.
- **Torus: not built.** Its distance is exact and stable (facts.md), but a geodesic meets it where a
  quartic in eᵗ (H³) or a degree-4 trigonometric polynomial (S³) vanishes; there is no closed-form
  intersection to transcribe, and the marched form needs the curved march, which does not exist (the
  generated march steps along straight lines; it needs the flow seam, a curved march epsilon and a
  per-space bound — the E³ cylinder bound is invalid in S³). It stays a Validator error ("primitive
  'torus' has no hyperbolic implementation"); the march is its own plan.

## 3. Root formulas (numerically stable forms)

The ray (p, v) is in the object's frame. P_N = ⟨p, N⟩, W_N = ⟨v, N⟩ for a face normal N.

**H³ — the interval method in X = e^{2t}.** Along γ(t) = cosh t·p + sinh t·v,
⟨γ, N⟩ = (e^{-t}/2)·((P+W)·X + (P−W)), so each half-space is a LINEAR condition in X ∈ (0, ∞):
(P+W)X + (P−W) ≤ 0 — an upper bound (W−P)/(P+W) if P+W > 0, a lower bound if P+W < 0, all or nothing
if P+W = 0 (sign of P−W). Same arithmetic as `hyperbolic_plane_root` (e^{2t} = (W−P)/(W+P)).
The tube: with P = (p_x, p_z), V = (v_x, v_z), S = sinh r,
4X·(|γ_xz|² − S²) = α X² + 2β X + γ̂ with α = |P+V|², β = |P|² − |V|² − 2S², γ̂ = |P−V|². Both
α, γ̂ ≥ 0, so the tube set in X is [X₁, X₂] (one interval: the tube is convex). Discriminant
β² − α γ̂ = 4D, D = S²(S² − (|P|² − |V|²)) − (P×V)² (P×V the 2D cross), an invariant of the geodesic
(both |P|² − |V|² and P×V are unchanged by the flow). Roots by the stable quadratic formula:
q = −β − sign(β)·2√D, X₁,₂ = {q/α, γ̂/q}. α = 0 (the ray's endpoint on the axis' ideal points):
linear. The region's interval [Xn, Xf] is the intersection of the face intervals (box: six faces;
cylinder: two caps and the tube); the hit is t = ½ log Xn if Xn > 1, else ½ log Xf if Xf > 1 (the
first boundary crossing ahead: Xn ≤ 1 ⟺ the origin is inside, the box.glsl rule). Float32
(measured, primitive-bodies/f32_tube.ts): with the D form, sign errors are ≤ 0.03% of a ±2% grazing
band at r = 0.01 and distance 3, against 2.1% for β² − αγ evaluated directly.

**S³ — the interval method in T = tan s.** Every S³ box and cylinder lies in x_w > 0. With
a = p_w, b = v_w, A = √(a² + b²): γ_w(t) = A cos(t − φ), φ = atan(b, a). The geodesic's arc in x_w > 0
is s = t − φ ∈ (−π/2, π/2), and dividing by cos s turns P cos t + W sin t ≤ 0 into a LINEAR condition
in T = tan s: (aP + bW) + (aW − bP)·T ≤ 0 (times 1/A > 0; this is the gnomonic chart along the
geodesic). The tube condition |γ_xz|² ≤ sin² r·|γ|² becomes, with P̃ = aP + bV, Ṽ = aV − bP over the
xz components (A²-scaled rotated frame), (|Ṽ|² − A²S²)T² + 2(P̃·Ṽ)T + (|P̃|² − A²S²) ≤ 0, S = sin r — a
quadratic whose leading coefficient may be negative (the tube is not convex), so its set is an
interval or the complement of one. The box's set is one interval [Tn, Tf]; the cylinder's is at most
two (caps ∩ tube). Each endpoint T_c is a boundary crossing at
t_c = mod(atan(b + a·T_c, a − b·T_c), 2π) (cos(φ + s), sin(φ + s) up to the factor A·cos s > 0); the
hit is the smallest t_c > 0 (the first crossing ahead; a geodesic closes after 2π, so an entry behind
the origin comes round again — the sphere body's mod rule). A ≤ the shape's minimum x_w is a miss
(this also guards A = 0): 1/√(1 + Σ tan² hᵢ) for the box (its corners), cos r·cos h for the cylinder
(its rim). No sin/cos is evaluated except through `spherical_cos_sin` for tan h, tan r.

**Quad.** The plane root (`hyperbolic_plane_root` / `spherical_plane_root`) on N = (ê1×ê2, 0), then
the chart test |h·ê1| ≤ T(a)·h_w and |h·ê2| ≤ T(b)·h_w. In S³ the great sphere is crossed at t₀ and
t₀ + π at antipodal points h, −h; the hit is the first that passes (the disk body's rule; the test
implies h_w > 0).

**Normals** (the gradient of the defining function projected to T_p, unit in the metric, outward):
- box: N_{face} of the face with the largest ⟨p, N⟩ (the face p lies on; ties at edges pick one);
- cylinder: the cap normal when the cap's signed distance exceeds the tube's, else the tube normal
  H³ (C·p_x/s, (s/C)·p_y, C·p_z/s, (s/C)·p_w), s = |p_xz|, C = √(1 + s²);
  S³ (c·p_x/s, −(s/c)·p_y, c·p_z/s, −(s/c)·p_w), s = |p_xz|, c = |p_yw|
  (the velocity at p of the geodesic leaving the axis perpendicularly);
- quad: N = (ê1×ê2, 0) everywhere on its plane (as the disk).
Inside/outside: box and cylinder are solids (sdf = max of the face/tube/cap distances: exact inside,
never an overestimate outside — facts.md); the quad is thin (one-sided, no sdf), like the disk.

## 4. The quad light

Exact sampling is available, uniform in the chart (not uniform in area): k = (T(a)(2ξ₁−1),
T(b)(2ξ₂−1)), y = (c + k₁û₁ + k₂û₂)/√(1 ∓ |k|²) (− in H³, + in S³), where c is the center and û₁,
û₂ the unit edge directions at c (isometries are linear on R⁴, so the chart point maps by the same
coefficients). The chart's area element is w³·dk₁dk₂ with w = 1/√(1 ∓ |k|²) = −⟨y, c⟩ (H³) or y·c
(S³) — the 4th coordinate of y in the light's frame — so the area pdf is exactly
1/(4·T(a)·T(b)·w³), evaluated at any point of the quad from w alone. Solid angle: pdf =
S(d)²/(4 T(a) T(b) w³ cos_l), with the S³ arc rule and arc probability of the disk light. Uniform-area
sampling also has a closed form (marginal CDF ∝ atan(Bx/√(1 ∓ B² ∓ x²))) — not used: more trig,
same exactness. *Provisional* (chart-uniform). Undo: swap the sampler and pdf for the area-uniform
inverse CDF.

Wiring (all curved-only; E³ output unchanged):
- **Anchor.** A new optional descriptor fact `curvedAnchor(values)` on PrimitiveDescriptor: the
  authored point a curved placement carries o's image to, when it is not the point row (the quad:
  corner + (edge1 + edge2)/2). `curvedShape` uses it; the light reads the anchor its region was
  placed by (one call).
- **Vector rows** are tangent vectors at the anchor: a curved primitive struct types them
  `Direction` and emits `Direction(x, y, z, 0.0)`; a curved light maps them by g like direction
  rows. Curved structs (primitive and light) carry no derived fields (Euclidean precomputations);
  the quad body computes its normal from cross(edge1, edge2) in its frame, the quad light computes
  N = J·X/|J·X| with X·d = det[E₁; E₂; d; c] (rows in that order: = +(ê1×ê2, 0) at o, where
  det[c; E₁; E₂; d] would give the opposite sign), equivariant under orientation-preserving
  isometries (N' = det g·g·N); J = diag(1,1,1,−1) in H³, the identity in S³. The struct generator
  and `rowGlslType` change only behind the curved branch. The light's `corner` field holds the
  center c in a curved space (said in the body).
- **Selection power** reads the authored rows: PlannedLight keeps `values` as authored and gains
  `world` (the rows naming a point or tangent vector, mapped by g) for the curved ctor. Today's
  curved disk light maps its rows in `values`; this moves them to `world` (same GLSL). Power stays
  the Euclidean formula (π·|e1×e2|·Le; the disk's πr² precedent): a selection weight, variance only.
- **Per-space coupled rules**: `validateValuesIn` (primitive) and `validateAuthoredIn` (light kind),
  keyed by space like `constraintIn`; one function `curvedQuadProblems` serves both.

## 5. Verification (written first)

### 5.1 vitest twins (float64 TS transcriptions; tests/components/{hyperbolic,spherical}.test.ts)
For each space and each of box, cylinder, quad, on ≥ 300 random rays (origins inside and outside,
grazing ones included; H³ origins up to distance 3 from o, sizes 0.1–1.2; S³ sizes up to 1.5):
1. the closed-form first hit equals the first sign change of the shape's signed distance along the
   marched geodesic (step 2π/4000 or 10/4000, bisection) — hit/miss agreement and |Δt| < 1e-8; the
   S³ cylinder cases include two-arc geodesics (counted, > 0);
2. the normal is unit, tangent (⟨n, p⟩ = 0) and equals the normalized metric gradient of the signed
   distance at the hit (finite differences, 1e-5);
3. the sdf has the membership's sign, vanishes on the surface, and is never above the length of a
   geodesic from the point to the shape (box, cylinder);
4. quad light: the chart-uniform pdf integrates to 1 over the quad (MC with an independent
   area-uniform estimate of the area: 1/pdf mean = area by Gauss–Bonnet, 2π − 4α / 4α − 2π), and the
   4D-cross normal equals g·(ê1×ê2, 0) for random placements;
5. float32 emulation (Math.fround) of the H³ tube discriminant on thin tubes (r = 0.01–0.3) at
   distances 1–3: a script, primitive-bodies/f32_tube.ts (not a vitest test); the twin computes the
   discriminants in the bodies' forms and a vitest test checks the identities β² − αγ = 4D,
   qb² − qa·qc = A⁴D.
6. Validator: the domains reject what they should and accept the edge (S³ h = π/2 − 1e-3 accepted,
   π/2 rejected; H³ box Σtanh² ≥ 1, quad sinh a sinh b ≥ 1, non-orthogonal curved quad rejected;
   the same scenes accepted in E³).

Independence: items 1–3 decide membership and distance WITHOUT the face normals the bodies use —
chart coordinates |xᵢ/x_w| ≤ T(hᵢ) for the box, the axis distance asinh|x_xz| / atan2(|x_xz|, |x_yw|)
and the axial coordinate atan2(x_y, x_w) (S³) / atanh(x_y/x_w) (H³) for the cylinder, the chart test
for the quad; normals are checked for outwardness against that membership (a step along n leaves the
region, along −n enters it) and for direction against finite differences of the brute-force distance.
The march refines near every closed-form root and decides hit/miss of each marched chord by
membership at its midpoint, so short grazing chords are not lost. Sizes are drawn inside the bounded
domains (H³ box Σ tanh² < 1, quad sinh a sinh b < 1; S³ below π/2); one unbounded H³ box is a separate
case (the body works; the Validator rejects it).

### 5.2 GPU witnesses (SwiftShader, targeted)
- **`h3-shapes`, `s3-shapes`**: a lambert (ρ = 0.5) box, cylinder and quad under one point light,
  pt-nee, maxBounces 1. Four readout windows, each inside one face: a box face, the cylinder tube, a
  cylinder cap, the quad. Expected: each window's mean of (ρ/π)·I·Σ_arcs max(0, cos θ_arc)·vis_arc/S(d)²
  at the first hit, with cos θ against the normal turned to the camera's side (an opaque lambert
  point is lit only on that side; in S³ the two arcs leave in opposite directions, so at most one
  counts — the s3Twins rule), computed by a TS twin that traces the witness's camera rays with the
  twin intersectors of 5.1 (2×2 points per pixel; the 4×4 change is recorded). Catches the roots
  (position, coverage), the normals' directions (cos θ), the placement of each shape and its struct.
  It does NOT catch a normal's sign (scene_intersect turns the normal toward the arriving ray):
  outwardness is the vitest check's job. Tolerance from noise (point light: one sample per path,
  low noise; tol 0.5%).
- **`h3-quad-light`, `s3-quad-light`**: the existing lambert disk receiver under a quad light (S³:
  facing away, lit through the long arc, as s3-long-arc). pt-nee, pt-mis, pt against the window mean
  of the irradiance quadrature over the quad (Gauss–Legendre over the chart rectangle with the w³
  area element, both arcs in S³), checked in vitest against an independent cosine-sampled estimate
  (rays from x, TS quad intersector, π·Le·P(hit)). Catches the sampler, the pdf (pt-nee, and pt-mis
  through the MIS weights), the hit side (pt), the one-sided normal and the arc rule.
- Each new witness is shown to fail with one deliberate mutation (reverted): shapes — the tube normal
  with the sign of its y-part flipped (a wrong direction; dropping the C/s factors, as first planned,
  is NOT one: every vector in the plane of the radial direction and the axis foot point projects in
  ambient_frame onto the same tangent line, so that mutation renders identically — measured); quad light — w³ → w² in the pdf, with half-widths
  ≥ 0.5 so that the predicted change of the NEE mean (computed by the twin) is ≥ 5× the tolerance.
- Existing output unchanged: `npm run digest` before and after; `--compare` shows no existing scene
  changed, Euclidean or curved (the `world` move must leave the h3/s3 shaders identical; frames only
  if a Euclidean scene changes). The readers of point/direction rows in PlannedLight.values
  (sceneRadiusEstimate, lighting_query_delta, emissionCone, the light-tree bounds and the packed
  power) are checked to be unreachable in curved programs before the move, by reading their gates.
- support.md regenerated; the targeted vitest files, then the full suite once.

## 6. Boundaries

In: the bodies above, their rows/constraints, the anchor and vector-row plumbing, the quad light,
four witnesses, twins, docs (support table, ambient/geometry/lights READMEs, CHANGELOG).
Out: torus (above), the curved march, emissive box/cylinder/quad sampled as lights (limitation row
stays), uv charts, area-uniform quad sampling, per-space parameter rows.

## 7. Provisional choices

| # | choice | why | undo |
|---|---|---|---|
| 1 | curved quad = rectangle centered at the Euclidean quad's center, half-widths \|edge\|/2, edges ⊥ | keeps one authoring language; E³ meaning exactly when edges ⊥ | per-space rows (a, b) |
| 2 | H³ box and quad must be bounded (Σ tanh² h < 1; sinh a sinh b < 1) | a box/panel is bounded; the quad light needs finite area | drop the box rule |
| 3 | chart-uniform quad-light sampling with the exact w³ pdf | simplest exact sampler | area-uniform inverse CDF |
| 4 | quad-light selection power from the Euclidean area | selection weight only (disk precedent) | curved area in `power` with a space argument |
| 5 | PlannedLight.world for mapped rows; values stay authored | power and validation read authored rows | map in values and give power a space |
| 6 | torus deferred | no closed form; the curved march is a new mechanism | its own plan |
