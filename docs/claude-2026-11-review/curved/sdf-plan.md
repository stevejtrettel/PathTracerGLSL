# Marched SDFs in H³ and S³ — plan

Branch `cv-sdf` (from `curved` 6b6cd5e). Owner brief, Nov 7: sphere tracing along geodesics in H³
and S³ with fields that are true geodesic distances or 1-Lipschitz lower bounds of them; curved
SDF primitives and combinators so a scene authors a curved field like a Euclidean one; a demo per
space. Lean testing: fp64 twins first, a few GPU witnesses, one mutation per witness.

Labels: [read] code or doc read; [measured] by a script or a render; [math] derived here;
[expected] not yet checked.

## 0. What exists

- The generated march (`emitSdfIntersect`, `emitSdfNormal`, components/geometry/index.ts) evaluates
  `<type>_sdf(ray.origin + t * ray.direction, s)` and takes a vec3 4-tap gradient [read]. Marched
  objects are a `SPACE_LIMITATIONS` row (Euclidean only) and the Planner plans every curved object
  as `closed-form` [read, compiler/plan/Planner.ts].
- The curved sphere and plane bodies already define exact `sphere_sdf`/`plane_sdf` over a `Point`
  (vec4) in the object's frame [read]. The sphere has `provides: { sdf: true, analytic: true }`, so
  `backend: 'sdf'` marches it; its march bound is `'self'` (`sphere_interval`), which no curved body
  defines yet [read].
- `defineSDF` takes one Euclidean body `float <name>_sdf(vec3 p, S s)` and registers it under the
  `euclidean` key only [read, components/geometry/custom.ts].
- Research already done (docs/claude-2026-11-review/curved/primitive-bodies/notes.md §1, §5, §6)
  [measured there]: exact curved ball/plane/tube distances and their f32 forms; sphere tracing along
  the flow takes 10–20 steps in H³/S³ like E³; a 4-tap FD normal along an orthonormal tangent frame
  is accurate to 1.5e-3 rad at h = 1e-3 (first order, as in E³); the Klein chart of H³ has
  |dφ| ≤ 1 everywhere.
- thurston-rebuild [read]: SDFs are written against model points (`hypDot` of the point with a
  center or a (point, direction) pair), the march re-flows from the seed each step, normals are
  analytic gradients per shape. Its tube is `acosh(√(⟨p,a⟩² − ⟨p,u⟩²)) − r`.

## 1. Verification, written first

### 1.1 fp64 twins (vitest, tests/components/curvedSdf.test.ts; twin code in
tests/witnesses/scenes/curvedSdfTwins.ts so the witness values share it)

The twin module transcribes, per space: the flow, the distance, exp_o, the SDF helpers of §2.2 and
the combinators, the generated march loop of §2.3 line for line (clearance floor, dilated far end,
sign-tracked bisection, stall rule, march_epsilon(t)), and the tangent-frame 4-tap normal.

1. **Ball** (H³ R = 0.6, S³ R = 0.5; centers off o; 2000 rays from random origins within 1.5 of o,
   some inside the ball). Against the closed form transcribed from sphere_hyperbolic.glsl /
   sphere_spherical.glsl: hit/miss agree except rays whose closest approach is within 16·ε of the
   surface (the stall band); on agreeing hits t ≤ t_root + 1e-6 and the exact distance at the marched
   point is < march_epsilon(t). (No window below t_root: the review measured a correct march stopping
   up to 2.9e-3 short of the root just outside the stall band at ε = 5e-4.)
2. **Plane** (both spaces, offsets 0 and 0.4): the same against the plane roots
   (hyperbolic_plane_root / spherical_plane_root transcribed).
3. **Tube** about a geodesic through a point off o, radius 0.15, capped by two planes: against a
   brute-force root of the field (scan at 1e-4 over the whole search interval, then bisection). Same
   criteria with the FIELD value in place of the exact distance (the capped field is a lower bound).
4. **Smooth union** of two balls and a capped tube (the witness sculpture of §1.2(c)), marched
   through its declared sphere bound: against the brute-force root of the field over the whole
   search interval, ignoring the bound (so a clipping bound fails). The rays include origins inside
   the bound but outside the sculpture (every spawned BSDF ray is one); in S³ these meet the
   sculpture again only after going around (the review's blocker: 1798 of 2000 such rays did).
5. **Normals**: the twin FD normal (taps along the orthonormal frame of the arrival direction) vs the
   analytic normal for ball, plane and tube at 500 surface points per space: angle < 3e-3 rad.
6. **Lipschitz**: for every helper and the sculpture field, |f(p) − f(q)| ≤ d(p, q)·(1 + 1e-9) over
   10⁴ random pairs per space (d the exact geodesic distance; the S³ pairs include near-antipodal
   ones). A field that overestimates fails here.
7. **Klein chart (H³)**: |k(p) − k(q)| ≤ d_H(p, q) over 10⁴ random pairs within distance 4 of o
   (k(p) = p.xyz/p.w), and the Klein-chart field `|k(p)| − tanh R` has the same zero set as the
   ball of radius R (|zero-crossing − R| < 1e-12 along 100 radial geodesics).

Each test is checked to fail under one deliberate twin mutation before it is trusted (e.g. the S³
inside-origin interval cut at the exit for 4, taps in model coordinates for 5, `asinh` → identity in
the plane distance for 6). Test 7's inequality is a theorem (it can fail only through a test bug);
its zero-set half is the part that checks the door.

### 1.2 GPU witnesses (tests/witnesses/scenes/curvedSdfWitness.ts)

All direct-lighting checks: lambert albedo 0.5, one point light, maxBounces 1, pt-nee (a point
light cannot be hit, so pt-mis = pt-nee and pt reads 0). The only noise is the pixel jitter, so the
window mean converges fast. Readout window: the central quarter used by the existing H³/S³
witnesses, entirely inside the object's image (the twin reports misses; it must be 0).

(a) **Marched ball = analytic ball.** `h3-sdf-ball` / `s3-sdf-ball`: one ball, `backend: 'sdf'`,
    center off o (exercises the isometry, the bound `sphere_interval`, `isometry_direction` of the
    FD normal). Partner scenes `h3-sdf-ball-ref` / `s3-sdf-ball-ref`: the same ball, closed form.
    Checks: window mean of each = the closed-form value (twin: closed-form hit, analytic normal,
    E = I·cos θ / sinh² d in H³; in S³ the arc rule: the arc leaving into the upper hemisphere,
    I·|cos θ| / sin² d); plus a cross-scene `twin` check (frame mean and per-pixel rmse) between
    marched and analytic, which adds the silhouette pixels. In S³ the light sits to the side and
    behind the ball, so the window holds points lit through the short arc and points lit through the
    long arc (the twin counts both kinds; each must be nonzero).
    In H³ also **`h3-klein-ball`**: a `defineSDF` Euclidean sphere `length(p) − tanh R` marched in the
    Klein chart (§2.6): the same expected window value (it is the same ball).
(b) **Furnace from a marched enclosure.** `h3-sdf-furnace` / `s3-sdf-furnace`: a `defineSDF`
    cavity f = −smin(ball₁, ball₂) (the solid is the complement of a smooth union of two balls about
    o), lambert ρ = 0.8, emission 1, maxBounces 6, pt, pinhole at o: every pixel = Σ_{k≤6} 0.8^k =
    3.951424 exactly. Tolerance 0.004 as in h3-furnace/s3-furnace. This is a no-leak test (every
    ray from inside the cavity must find the wall, and every spawn must stay inside): it cannot see
    hit positions, normal tilts or flipped normals (the review), which (a) and (c) cover.
(c) **Smooth-union sculpture vs its twin.** `h3-sdf-blend` / `s3-sdf-blend`: two balls and a
    capped tube, smooth-unioned, placed by a rotation and a translation; window mean against the fp64
    twin (twin march with ε = 1e-10 and bisection, analytic gradient of the smooth-union field,
    point-light irradiance with a shadow ray marched in fp64 along the arc NEE uses).
    Tolerance: 0.002 absolute on values ≈ 0.1–0.3, chosen from the FD-normal error (≤ 3e-3 rad →
    ≤ 0.3% of a cosine at 45°) [expected; recorded after the first run].

Expected values are constants in the fixture, recomputed by the vitest twin test (a stale constant
fails vitest), as h3Twins/s3Twins do.

### 1.3 Regression gates

- `npm run digest` before and after: every Euclidean scene identical (shader text, uniforms,
  parameters, source maps, scene-data plan). `npm run frames` only if a Euclidean scene's shader
  text changes. Curved scenes may change (new helpers in the occupant files, `sphere_interval`).
- Targeted witnesses: the new ones, plus `h3-furnace` and `s3-furnace` (their plane bodies are
  respelled through the occupant helpers, §2.2) and `s3-long-arc-blocker` (its sphere body gains
  `sphere_interval`).
- Full `npx vitest run` once at the end; `npx tsc --noEmit`.

### 1.4 Mutations (step 3 of the brief), one per witness, reverted

(a) the curved normal without `isometry_direction` (the object-frame normal used as world normal);
(b) the curved march's step budget cut to 4 (rays exhaust far from the wall and miss: the furnace
    leaks; `t1·0.5` would not, since t1 = MAX_DIST exceeds the cavity — the review);
(c) the smooth-union blend radius doubled in the GLSL only (the twin keeps k).
The Klein witness: the chart k(p) = p.xyz instead of p.xyz/p.w.

## 2. The change

### 2.1 Scope

In: the march and the FD normal through the seam; curved `sphere_interval`; the curved SDF helpers
and combinators; `defineSDF` bodies keyed by space; the Klein-chart door for Euclidean `defineSDF`
fields in H³; the `marched objects` limitation lifted for H³ and S³; witnesses; one demo per space.

Out (unchanged, stated in the support table): menger, apollonian, bottle, knob, torus, box, cylinder
stay Euclidean-only (no curved body, so the space gate rejects them, marched or not). Tabled
dispatch and instancing stay Euclidean (their own gates). Curved twin gates for `defineSDF`
(containment and conservativeness sampling, §2.5) are deferred.

### 2.2 GLSL

- **Occupant helpers** (in hyperbolic.glsl / spherical.glsl, so plane bodies and fields share one
  formula):
  - `Direction <space>_plane_vector(Direction n, float offset)`: H³ (cosh(offset)·n.xyz, −sinh(offset)),
    S³ (cos(offset)·n.xyz, sin(offset)) by spherical_cos_sin — the 4-vector N of the plane ⊥ n at signed distance −offset
    from o (the plane rows' meaning). The plane bodies' `plane_N` calls it.
  - `float <space>_plane_distance(Point p, Direction N)`: H³ sign(s)·asinh(|s|), s = ⟨p,N⟩;
    S³ spherical_asin(clamp(p·N, −1, 1)). The plane bodies' `plane_sdf` calls it.
  - `float sdf_plane(Point p, Direction n, float offset)`: the two above.
  - `float sdf_tube(Point p, Point a, Direction u, float r)`: distance to the geodesic through a
    with unit tangent u ∈ T_a, minus r. H³: p⊥ = p + ⟨p,a⟩a − ⟨p,u⟩u (the part of p off span(a,u)),
    ⟨p⊥,p⊥⟩ = sinh²d, so d = asinh(√⟨p⊥,p⊥⟩) — precise near the axis, where thurston's acosh form
    is not. S³: p⊥ = p − (p·a)a − (p·u)u, |p⊥| = sin d, (p·a)² + (p·u)² = cos²d, d = atan(|p⊥|,
    √((p·a)² + (p·u)²)) (no acos: SwiftShader's is inaccurate).
    [math: p = cosh d(cosh s·a + sinh s·u) + sinh d·w with w ⊥ a, u, unit; likewise in S³]
- **Space-independent vocabulary over the seam** (new file components/ambient/sdf.glsl, included
  when a curved program marches):
  - `Point sdf_point(vec3 v)`: exp_o(v) = ambient_geodesic(o, (v̂, 0), |v|), o at v = 0 — the
    meaning of an authored point.
  - `float sdf_ball(Point p, Point c, float r)`: ambient_distance(p, c) − r (the chord forms).
  - `sdf_smooth_union(a, b, k)` (polynomial: min(a,b) − k·h²/4, h = max(k − |a − b|, 0)/k),
    `sdf_smooth_intersection(a, b, k) = −sdf_smooth_union(−a, −b, k)`,
    `sdf_smooth_subtraction(a, b, k) = sdf_smooth_intersection(a, −b, k)`. Union and intersection are
    the built-ins min and max.
  - Lower-bound property [math]: min and max of 1-Lipschitz functions are 1-Lipschitz; the smooth
    union's gradient is w·∇a + (1 − w)·∇b with w = (k + b − a)/(2k) ∈ [0, 1] inside the blend band, so
    it is 1-Lipschitz too; and any 1-Lipschitz f satisfies |f(p)| ≤ dist(p, {f = 0}) (for q on the
    zero set, |f(p)| = |f(p) − f(q)| ≤ d(p, q)), which is all sphere tracing needs. The exact
    distances are 1-Lipschitz in either space (S³ distances are short-arc distances ≤ π).
  - smin ≥ min − k/4, so {smin ≤ 0} ⊆ {min(pieces) ≤ k/4}: a march bound must contain that set. For
    exact pieces it is the k/4-neighborhood of the union; for lower-bound pieces (a capped tube) it
    can reach farther, and the bound must be checked against the set itself (twin test 4).
  - The Lipschitz argument without gradients: g(a, b) = smin(a, b) has partials w and 1 − w with
    w ∈ [0, 1], so |g(a,b) − g(a',b')| ≤ max(|a − a'|, |b − b'|) ≤ d(p, q) for 1-Lipschitz a, b.
- **`sphere_interval`** in sphere_hyperbolic.glsl and sphere_spherical.glsl, the interval twin of
  the existing `sphere_intersect` (same discriminant, same root formulas): H³ entry log(amb/q), exit
  log(q/apb); S³ outside: entry mod(φ − α, 2π), exit entry + 2α; inside: [0, 2π] — a geodesic
  leaving the ball comes back around and may meet the shape again before 2π, so the whole period is
  searched (the review's blocker; a camera ray from outside enters once and needs no more). False
  when the geodesic misses (or, in H³, the ball is behind).

### 2.3 Generated march and normal (components/geometry/index.ts)

- `emitSdfIntersect(d, curved)`: the loop unchanged; the field point is
  `ambient_geodesic(ray.origin, ray.direction, t)` in a curved space (each step re-flows from the
  seed). The Euclidean text stays `ray.origin + t * ray.direction` (the same point; kept so
  Euclidean output is unchanged — provisional P2).
- `emitCurvedSdfNormal(d)`: `Direction <type>_sdf_normal(Ray at, S s)` with `at` the ray at the hit
  (point and arrival direction): Frame f = ambient_frame(at.origin, at.direction) is an orthonormal
  basis of T_p; the four taps are ambient_geodesic(p, k_j, NORMAL_EPSILON) with k_j the tetrahedral
  unit combinations of (f.t, f.b, f.n); the normal is ambient_normalize(Σ f_j k_j). Tangent by
  construction; basis-independent up to O(h).
- The search interval: [b0, min(b1, hit.t)] from the bound, or [0, hit.t] for an `'unbounded'`
  field; hit.t starts at MAX_DIST (10 in H³, 2π in S³) [expected: check scene_intersect].
- Acceptance stays `march_epsilon(t)` (an arc length; its growth with t is a Euclidean footprint
  model; the 5e-4 cap bounds it — provisional P5).

### 2.4 Intersection feature and Planner

- Planner: a curved object whose backend resolves to `sdf` is planned `intersect: 'march'` with its
  isometry (today: always closed-form).
- `curvedSdfObjectArm`: ray into the object frame by G⁻¹ (as the closed-form curved arm), bound
  interval, `<type>_sdf_intersect`, hit point along the world ray, normal
  `isometry_direction(G⁻¹, <type>_sdf_normal(ambient_flow(lray, t), shape))`, `hit.eps =
  MARCH_CLEARANCE` (the marched tier's spawn offset, an arc length). A marched hit is off the surface
  by the acceptance residual plus the fp error: 5e-4 + 3.05e-5·cosh ρ < 1e-3 for ρ < 3.5 from o
  (margin 1.24× at ρ = 3; Euclidean has 2×) [math, review].
- Containment: a curved marched object answers `<type>_sdf(G⁻¹·p, shape)` like a curved closed-form
  object (no `sdf_<id>` wrapper in curved programs).
- When a curved program marches, the block list gains components/ambient/sdf.glsl after march.glsl.
- `SPACE_LIMITATIONS` 'marched objects' row: spaces euclidean, hyperbolic, spherical. The space gate
  still requires a body for the shape and for every primitive in its bound chain (so torus, menger,
  … stay errors).
- Validator: in a curved space a march bound must be centered at the object's origin (its point
  rows zero — a center would need a pre-translation of the bound, not built) and satisfy the bound
  primitive's constraints there (S³ radius < π). An error otherwise.

### 2.5 `defineSDF` in curved spaces (provisional P1)

- `glsl` is either a string (the Euclidean body, as today) or a record keyed by space,
  `{ hyperbolic?: string, spherical?: string, euclidean?: string }` — the descriptors' SpaceBodies
  form; the same source may appear under several keys (a body written against the space-independent
  vocabulary works in both curved spaces). A curved body defines `float <name>_sdf(Point p, S s)`,
  with p a point of the model (vec4) in the object's frame (the thurston-rebuild approach), and may
  call the helpers of §2.2. The definition-time regex checks the signature per key.
- The twin `field` and its Validator gates (bound containment, conservativeness) run for the
  Euclidean body only; curved bodies are not sampled at compile time (deferred: a geodesic sampler
  over the bounding ball). The vitest twins of §1.1 cover the shipped helpers.
- `marchBound` is shared; in a curved space only a sphere bound (centered, §2.4) or `'unbounded'`
  links, because only the sphere has curved bodies.

### 2.6 Klein-chart Euclidean fields in H³ (provisional P3)

Statement [math]: in the hyperboloid model the Klein chart k(p) = p.xyz/p.w maps H³ onto the open
unit ball and geodesics to chords; its metric is
ds²_H = |dk|²/(1 − |k|²) + (k·dk)²/(1 − |k|²)² ≥ |dk|², so |dk(v)|_E ≤ |v|_H for every tangent
vector, everywhere (the brief's worry — a scale factor bounded on a working radius — applies to the
S³ gnomonic and stereographic charts, whose factors exceed 1, not to Klein). Hence for any path γ,
length_E(k∘γ) ≤ length_H(γ), so |k(p) − k(q)| ≤ d_H(p, q), and for a Euclidean field f_E that is a
1-Lipschitz lower bound of the Euclidean distance to a set S_E inside the unit ball,
|f_E(k(p))| ≤ dist_E(k(p), S_E) ≤ d_H(p, k⁻¹(S_E)). So f_E∘k is a sound sphere-tracing step for the
shape k⁻¹(S_E), with no scale factor. Its cost: near the chart origin the step is the true distance;
at hyperbolic radius ρ from the object's origin it can be as small as 1/cosh²ρ of it (radial
directions), and an accepted point's true residual can reach march_epsilon·cosh²ρ (an author may
declare `refine` with that factor).

Build: `defineSDF({ …, glsl: <Euclidean body>, kleinChart: true })` registers a hyperbolic body that
is the Euclidean body plus the overload `float <name>_sdf(Point p, S s) { return <name>_sdf(p.xyz /
p.w, s); }` (GLSL overloads on vec3/vec4). The parameter rows are chart sizes (a chart radius r is a
hyperbolic radius atanh r). In H³ such a field marches `'unbounded'` (its Euclidean bound is a fact
about chart coordinates; mapping it is deferred — P4). Marching unbounded evaluates f_E over the
whole open unit ball, so the door's contract is that f_E is a 1-Lipschitz lower bound EVERYWHERE in
the ball, not only inside its Euclidean bound. An authored `<name>_sdf_normal` is rejected with
`kleinChart` (it would suppress the curved normal). Registry shapes (fractals included) do not get
this door; it is opt-in per scene-local field.

### 2.7 Docs and demo

Support table regenerated (marched objects: yes in H³/S³); ambient README (the SDF vocabulary, the
curved march), fable-sdf-contract.md (a curved section), CHANGELOG entry. Demos `hyperbolic-blend`
and `spherical-blend` in the gallery's curved section: a smooth-union sculpture on the existing
curved scenes' lighting, checked on a lab render.

## 3. Provisional choices (owner undecided; each with its undo)

| # | choice | why | undo |
|---|---|---|---|
| P1 | defineSDF curved bodies are GLSL over model points (vec4) with space helpers, keyed by space | the thurston-rebuild approach; one body can serve H³ and S³ | a chart-only door (P3) or per-space TS builders |
| P2 | Euclidean march keeps `ray.origin + t·ray.direction`; curved uses ambient_geodesic | Euclidean output provably unchanged by the digest | respell Euclidean to ambient_geodesic and prove bit-identity with `npm run frames` |
| P3 | Klein-chart door for Euclidean defineSDF fields in H³ (opt-in `kleinChart`) | exact bound with factor 1 (§2.6); lets any Euclidean field render in H³ | delete the option |
| P4 | Klein fields march unbounded in H³ | the bound is a chart fact; ray misses cost ~MAX_DIST/(1 − chart extent) steps | map a centered sphere bound by r → atanh r |
| P5 | march_epsilon(t) unchanged (Euclidean footprint growth, cap 5e-4) | the cap bounds the difference; H³ footprints grow like sinh t, S³ shrink near 2π | a per-space footprint function in the occupant |
| P6 | curved defineSDF bodies skip the compile-time twin gates | no geodesic sampler yet; the shipped helpers are twin-tested in vitest | a sampler over the bounding ball |
| P7 | helper names `sdf_*` (not `ambient_*`): they are authoring vocabulary of the curved spaces, not part of the seam Euclidean space implements | Euclidean output unchanged | Euclidean implementations of the same names |

## 4. Build order (small commits)

1. Twins + vitest (§1.1), seen failing under mutation.
2. GLSL helpers, `sphere_interval`, plane bodies through the occupant helpers.
3. March/normal emitters, Planner, arms, containment, limitation row, Validator bound rule.
4. defineSDF record bodies; Klein door.
5. Witness fixtures + twin values; targeted witness run; mutations.
6. Demos; docs; CHANGELOG; full vitest; digest compare; review.
