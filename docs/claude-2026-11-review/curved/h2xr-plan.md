# H²×R: plan (first subset)

Status: model-written plan, 2026-11-07, reviewed once by a fresh agent (findings and fixes in §10).
The owner asked for H²×R as the first product geometry and for it to be built today with lean
testing; his undecided choices are in §9 as provisional, each with its undo. Labels: **[math]**
derived here, **[checked-num]** measured by a script (named), **[checked-code]** read in the code,
**[expected]** not yet measured.

## 1. The model

H²×R is the Riemannian product of the hyperbolic plane (curvature −1) and the line. It is
homogeneous but not isotropic: the vertical direction is distinguished, and the isometries fixing a
point are O(2) × {±1}, not O(3).

**Coordinates.** A point is a vec4 p = (x, y, z, w): the **height is y** (the authored up axis, as in
every scene today) and (x, z, w) lies on the hyperboloid x² + z² − w² = −1, w > 0. The origin is
o = (0, 0, 0, 1). Write p_H = (x, 0, z, w) for the H² part and
⟨a, b⟩_H = a.x·b.x + a.z·b.z − a.w·b.w for the form of R^{2,1} on it.

**Tangent vectors.** v is tangent at p when ⟨p_H, v⟩_H = 0; v.y is free. The metric on T_p is
⟨a, b⟩ = a.x·b.x + a.y·b.y + a.z·b.z − a.w·b.w — **the same Minkowski form as H³** (on T_p the H²
part is positive definite and y is Euclidean) [math]. So `ambient_dot` and `ambient_normalize` are
H³'s, and a tangent vector at o is (v.x, v.y, v.z, 0) exactly as in H³ and S³: `tangentAtOrigin`
and `ORIGIN` are shared. What differs from H³ is the projection onto T_p, which uses p_H, not p:
proj(v) = v + ⟨v, p_H⟩_H·p_H.

**exp and log at o.** For v = (v.x, v.y, v.z) with horizontal length s = |(v.x, v.z)|:
exp_o(v) = (sinhc(s)·v.x, v.y, sinhc(s)·v.z, cosh s), sinhc(s) = sinh s/s;
log_o(p) = (asinhc(r)·p.x, p.y, asinhc(r)·p.z), r = |(p.x, p.z)|, asinhc(r) = asinh r/r. The
distance of exp_o(v) from o is |v| [math]. An authored point (camera position and target,
placement position, light position, a shape's center) means exp_o(v), as in H³ and S³.

## 2. The occupant (components/ambient/h2xr/)

Every formula below with its stable float32 form. SwiftShader accuracy of the transcendental
functions [checked-num, scratchpad cv-h2r/probe.mjs, 4096 points per range]:

| function | range | max abs error | max rel error |
|---|---|---|---|
| sinh | [−6, 6] | 7.3e-5 | 3.3e-6 |
| sinh | [−0.01, 0.01] | 8.4e-8 | **1.1e-3** (near 0) |
| cosh | [−6, 6] | 7.2e-5 | 4.5e-7 |
| exp | [−8, 8] | 1.2e-3 | 5.8e-7 |
| log | [1e-3, 50] | 3.1e-7 | 2.4e-6 |
| asinh | [−50, 50] | 2.9e-4 | 6.4e-5 (large negative) |
| asinh | [−0.01, 0.01] | 2.1e-7 | **2.4e-2** (near 0) |
| atanh | [−0.01, 0.01] | 8.8e-8 | **1.7e-3** (near 0) |

So sinh, asinh and atanh have an absolute, not relative, error near 0 (they are evaluated through
exp and log). Wherever a ratio sinh(x)/x, asinh(x)/x or atanh(x)/x is needed at small x it is a
Taylor polynomial below a threshold (`h2xr_sinhc`, `h2xr_asinhc`, `h2xr_atanhc`), all at
|x| < 0.05: sinhc = 1 + x²/6 + x⁴/120 (truncation x⁶/5040 < 4e-12), asinhc = 1 − x²/6 + 3x⁴/40
(5x⁶/112 < 7e-10), atanhc = 1 + x²/3 + x⁴/5 (x⁶/7 < 3e-9). Above the threshold the quotient's
relative error is the function's absolute error near 0 divided by x: about 2e-6 for sinh and atanh
and 4e-6 for asinh at x = 0.05, falling as x grows. This matters most for the area density
(§3), where sinhc(D_H) multiplies radiance directly and D_H → 0 under a light straight above.

- **`MAX_DIST = 10.0`**: the far clip, an arc length, as in H³ (float32 hyperboloid coordinates at
  arc 10 are about e¹⁰/2 = 1.1e4, still finite; the scene stays within about 3 of o).
- **`fp_uncertainty(p) = max(ABS, REL·max(p.w, |p.y|))`**: w bounds |x| and |z| on the hyperboloid;
  the height is Euclidean.
- **On the model**: `h2xr_on_model(p) = (p.x, p.y, p.z, √(1 + p.x² + p.z²))` (H³'s rule: recompute
  w from the spatial H² coordinates, measured better than rescaling in H³; the height needs nothing).
- **Geodesic flow** [math]. Unit v at p; horizontal part u = (v.x, 0, v.z, v.w) with speed
  s = √max(⟨u, u⟩_H, 0). Its relative error is about ε·w²/s² (cancellation in the form far from o);
  √(1 − v.y²) has ε/s², no better. u's own form is used because it keeps (u, s) consistent inside
  the flow: the H² step is t·sinhc(st)·u, so an error in s changes only the speed along u. The H² part runs along an H² geodesic at speed s,
  the height at speed v.y:
  γ(t) = cosh(st)·p_H + t·sinhc(st)·u + (p.y + v.y·t)·e_y,
  γ′(t) = s·sinh(st)·p_H + cosh(st)·u + v.y·e_y.
  Written with t·sinhc(st) it has no division by s, so a vertical ray (s = 0) is exact (thurston's
  version divides by s and gives NaN there). γ is put back on the model by `h2xr_on_model`.
- **Distance** [math]: d = √(D_H² + Δy²) with D_H = 2·asinh(√⟨c, c⟩_H / 2), c = a_H − b_H (H³'s chord
  form, relative error ≤ 4e-7 near o in H³).
- **Direction to b** [math]: the H² log direction w = c + ⟨a_H, c⟩_H·a_H, c = b_H − a_H, has length
  sinh D_H (as in H³: |b + ⟨a,b⟩a|² = ⟨a,b⟩² − 1). The unit initial velocity of the unique
  geodesic is (D_H·ŵ + Δy·e_y)/d = normalize(asinhc(|w|)·w + Δy·e_y) — no division by |w|, so a
  point straight above is exact.
- **Aim**: one geodesic joins two points (H²×R is a Hadamard manifold), so `along` selects nothing;
  remaining = d.
- **Frame**: ~~H³'s longest-axis Gram–Schmidt with the H² projection above~~. *Changed during the
  build*: the metric and the frame go through the orthonormal basis (E1, e_y, E2) of T_p (the axes
  at o carried along the H² geodesic; no cancellation): `ambient_dot` is the dot product of the
  components, `ambient_frame` an orthonormal completion of n's components. The Minkowski form
  cancels far from o, and on SwiftShader it came out negative (NaN directions under NEE, 2–14% of
  the demo's pixels) at floor hits beyond about 4 from o, near the floor's horizon [checked-num:
  lab captures counting NaN pixels, before and after]. Undo: the form, which is exact only near o.
- **Parallel transport** [math]: the height component is parallel; the H² part uses H³'s formula
  v_H + ⟨b_H, v⟩_H/(1 − ⟨a_H, b_H⟩_H)·(a_H + b_H). No caller (in-progress seam, as in H³/S³).
- **Sky key** [checked-num, curved/far-precision-media/h2xr_key.ts]: a geodesic's endpoint class is
  (the ideal point ξ of its H² part, its angle β from the vertical); key = (sin β·ξ.x, cos β,
  sin β·ξ.z) with ξ = Klein(p_H + û) = (p_H + û).xz/(p_H + û).w, a unit 2-vector (p_H + û is null).
  Stable: m = s·p_H + u (null, = s·(p_H + û)), key = normalize(s·m.x/m.w, v.y, s·m.z/m.w), and
  (0, sign v.y, 0) when s = 0. At o it is the view direction. Exact for every t.
- **Area density** `h2xr_area_density(a, b)` (§3): d²·sinhc(D_H).

### Placement isometries

Isom⁺(H²×R) ⊃ Isom⁺(H²) × translations of R. A placement here is (B, c): B ∈ SO⁺(2,1) acting on
(x, z, w), c a height shift. It is **not linear on the vec4** (a translation of R is affine), so the
mat4 the program holds is an encoding [math]: **G⁻¹'s entry m[3][1] (column 3, row 1) holds the
height shift; the rest of m is the H² isometry on (x, z, w) and the identity on y.** The identity
mat4 is the identity isometry, and a rotation about the vertical axis at o (`rotationAtOrigin`) is
already in this form. Decoding (GLSL and CPU, one formula each):
- a point: q = m·(p.x, 0, p.z, p.w); q.y = p.y + m[3][1];
- a tangent vector: q = m·(v.x, 0, v.z, v.w); q.y = v.y;
- composition (a, b) ↦ strip both shifts, multiply, shift = c_a + c_b; inverse: strip, J·mᵀ·J
  (J = diag(1,1,1,−1)), shift −c.

**The generated arms must stop multiplying by the mat4.** Today's curved arm emits
`make_ray(inv * ray.origin, inv * ray.direction, ray.wl)` and the region query `inv * p`
[checked-code: intersection.ts:838, :1204]. Two new occupant functions, defined by H³ and S³ as the
product they replace (same arithmetic):
`Point isometry_point(mat4 m, Point p)` and `Direction isometry_tangent(mat4 m, Direction v)`.
H³/S³ shader text changes at those lines and by the two new definitions in their occupants; Euclidean text does not change (no isometry there).
`isometry_direction(G⁻¹, v)` (normal back to world) is H³'s J·((J·v)·L) with L = G⁻¹ minus its
shift entry.

**CPU** (`CurvedGeometry`, components/ambient/isometry.ts): placements, light rows and the camera
compose and apply isometries with `mat4Multiply`/`mat4Apply` and project with ⟨·, P⟩ [checked-code:
isometry.ts placementIsometry, plan/curved.ts curvedLightValues, camera/basis.ts]. The interface gains
`compose(a, b)`, `apply(g, p)`, `applyTangent(g, v)`, `rotation(q)` and `tangent(p, v)` (projection
onto T_p); H³ and S³ supply the linear ones (`mat4Multiply`, `mat4Apply`, `rotationAtOrigin`,
v − p·(⟨v,p⟩/⟨p,p⟩) with ⟨p,p⟩ computed once, today's operation order in basis.ts) — the same
arithmetic, so their compiled closures do not change (digest).
transvection(v) = (the H² boost by (v.x, v.z), shift v.y); `rotation(q)` throws unless q fixes the
vertical (the Validator rejects it first, §5).

**Authored rotations.** The isometries fixing o that preserve orientation are the rotations about
the vertical and the π-rotations about a horizontal axis (an H² reflection with y ↦ −y). This
subset accepts **rotations about the y axis only** (axis (0, a, 0), or a constant quaternion with
q.x = q.z = 0); anything else is a limitation row (§5). Provisional (§9).

## 3. Light falloff: the area density [math, then checked-num by the twins of §7]

**Statement.** For a geodesic from p leaving in unit direction v and reaching q = exp_p(r·v), the
solid angle at p and the area at q are related by dω = |cos θ_q|·dA / J(p, q), where θ_q is the
angle at q between the surface normal and the geodesic's arrival velocity γ′(r), and J is the
area density of the geodesic sphere of radius r about p per unit solid angle:
**J(p, q) = r²·sinh(D_H)/D_H = d²·sinhc(D_H)**, with D_H = d_{H²}(p_H, q_H) = r·sin β and β the angle
of v from the vertical.

**Derivation.** In polar coordinates about p the volume form is J(r, v) dr dω, J = |Y₁(r) ∧ Y₂(r)|
for the Jacobi fields along γ with Y_i(0) = 0, Y_i′(0) = e_i, (e₁, e₂) orthonormal ⊥ v. By the
Gauss lemma both Y_i(r) are ⊥ γ′(r), so a surface element dA at q whose normal makes angle θ_q
with γ′(r) projects to |cos θ_q|·dA on the sphere: dω = |cos θ_q| dA / J. Write
v = sin β·û + cos β·e_y (û a unit horizontal vector). The curvature of a product acts on the H²
components only, with K = −1 there. Choose e₁ = n̂, the horizontal unit vector ⊥ û, and
e₂ = cos β·û − sin β·e_y (in the vertical plane of v, ⊥ v); both parallel along γ.
- The plane (e₁, γ′) has sectional curvature K(n̂, γ′_H)·|γ′_H|² = −sin²β, so
  Y₁″ − sin²β·Y₁ = 0: Y₁(t) = sinh(t sin β)/sin β · e₁(t).
- The plane (e₂, γ′) is spanned by û and e_y: the vertical plane (H² geodesic) × R, totally
  geodesic and flat, and R(e₂, γ′)γ′ = 0 (its H² part is parallel to γ′_H). So Y₂(t) = t·e₂(t), and
  no coupling between Y₁ and Y₂ (R(·, γ′)γ′ is diagonal in (e₁, e₂)).
So J = r·sinh(r sin β)/sin β = r²·sinhc(r sin β), and r sin β is the H² distance travelled: D_H. ∎
Limits: a vertical geodesic (D_H = 0) gives r² (the flat vertical plane through it is all there is);
a horizontal one gives r·sinh r (H² polar area × 1).

**Reciprocity.** J(p, q) depends only on d and D_H, both symmetric in p and q, so the density seen
from the light equals the density seen from the receiver (Etherington reciprocity, here by
inspection). Hence:
- **Point light** of radiant intensity I at q: E(p) = I·cos θ_p / J(p, q) (flux 4πI through every
  geodesic sphere about q: ∫ dω = 4π). Body: `radiance = intensity / h2xr_area_density(q.p, l.position)`.
- **Disk light** (horizontal, §4): uniform area sample y; solid-angle pdf =
  J(p, y)/(A·cos_l), cos_l = ⟨n_l, −γ′(d)⟩ = ⟨n_l, direction_to(y, p)⟩ at y. For a horizontal disk
  cos_l = |Δy|/d (γ′ has constant vertical component Δy/d).

**Why an isotropic formula fails** [math, one point]: at D_H = 1, Δy = 1 (d = √2, β = 45°):
J = 2·sinh 1 = 2.3504; Euclidean d² = 2 (+17.5% irradiance), horizontal-only r·sinh r = 2.7366
(−14.1%), H³-like sinh²d = 3.7445 (−37.2%). The witnesses (§7) state the window mean each would give.

**The disk area and sampler.** A horizontal disk of radius ρ is a geodesic disk in the totally
geodesic H² × {c}: area 2π(cosh ρ − 1) = 4π sinh²(ρ/2), uniform-area radius
sinh(r/2) = √u·sinh(ρ/2) — H³'s formulas, because H² × {c} is H² [math].

## 4. Shapes

Totally geodesic surfaces of H²×R are the horizontal planes H²×{c} and the vertical planes γ×R
(γ an H² geodesic) [math, the standard classification]; there is no tilted one. All bodies work in
the object's frame (the arm moves the ray in by G⁻¹; the center row is folded into the placement).

- **plane** (normal row `normal`, offset row `offset`; dot(p, n) + offset = 0 in E³ terms). In H²×R
  the normal must be **vertical (n.x = n.z = 0) or horizontal (n.y = 0)** — a space constraint on the
  row (§5).
  - vertical normal: the plane y·n.y + offset = 0; signed distance y·n.y + offset; root
    t = −(p.y·n.y + offset)/(v.y·n.y) when positive (v.y = 0: miss, stated, not left to NaN);
    normal n.
  - horizontal normal: the vertical plane ⟨x, N⟩_H = 0 with N = (cosh(off)·n.x, 0, cosh(off)·n.z,
    −sinh(off)) (H³'s plane in the H² factor); signed distance asinh(⟨p, N⟩) with the sign restored.
    Along γ, ⟨γ(t), N⟩ = cosh(st)·P + t·sinhc(st)·W, P = ⟨p, N⟩, W = ⟨u, N⟩ (= ⟨v, N⟩, N.y = 0): zero
    where tanh(st) = −s·P/W, so t = (−P/W)·atanhc(−s·P/W), a root at t > 0 iff P·W < 0 and
    s·|P| < |W|. The atanhc form has no 1/s (a near-vertical ray loses nothing; H³'s
    ½·log((W−P)/(W+P)) divided by s would have absolute error 3e-7/s). Normal N.
- **disk** (radius ρ, normal row): **horizontal disks only** (normal vertical, §5). In its frame the
  plane y = 0: t = −p.y/v.y (v.y = 0: miss), then x² + z² ≤ sinh²ρ at γ(t). Normal: the normal
  row. Distance (for the twins only; a thin shape claims no region): √(y² + max(D_H − ρ, 0)²).
- **cylinder** (radius R, halfHeight h, center row; canonical axis y as in E³): the capped vertical
  cylinder D_R × [−h, h] (D_R the H² disk of radius R about o).
  - Tube (*changed during the build*, §9 row 10: now |x(τ)|² = sinh²R on the flow's x, z, a quadratic
    in e^{2τ} valid for non-tangent directions; the first form below assumed tangency): w(γ(t)) =
    a·cosh τ + b·sinh τ, τ = st, a = p.w, b = û.w. Setting w = cosh R and X = e^τ is
    H³'s ball quadratic, with H³'s cancellation-free identities in 2D:
    disc = sinh²R − k, k = (p.x·û.z − p.z·û.x)² (Lagrange's identity holds in R^{2,1} with the
    scalar cross product), (a + b)(a − b) = 1 + k. Entry/exit τ_in = log((a−b)/q),
    τ_out = log(q/(a+b)), q = cosh R + √disc; t = τ/s. s = 0: the tube interval is everything or
    nothing.
  - Slab: [(−h − p.y)/v.y, (h − p.y)/v.y] sorted; v.y = 0: everything or nothing.
  - The hit: the interval intersection; root selection by the inside test (inside → its far end).
  - Normal: wall (p.w·p.x/r, 0, p.w·p.z/r, r) (H³ sphere normal in the H² factor) if
    asinh(r) − R > |p.y| − h, else (0, sign p.y, 0, 0).
  - Signed distance (exact, the product of two convex sets): with a = asinh(r) − R, b = |y| − h:
    length(max((a, b), 0)) + min(max(a, b), 0).
- **sphere** (the metric ball of radius R; center row): signed distance √(D_H² + y²) − R,
  D_H = asinh(|p.xz|). **No closed-form root**: along γ, f(t) = D_H(t)² + (p.y + v.y·t)² − R² with
  D_H(t) = acosh(a·cosh(st) + b·sinh(st)) mixes exponentials of st with a polynomial in t. But f is
  **convex** in t: H²×R is CAT(0) (a product of CAT(0) spaces), where the distance to a point is
  convex along geodesics, and so is its square [math]. Newton's method on a convex function started
  where f > 0 converges monotonically toward the nearest root on that side and never jumps over it
  [math]. The body:
  - outside (f(0) ≥ 0): start at t = 0; if f′(t) ≥ 0 at any iterate, the minimum is at or behind t
    with f > 0: miss. Else t ← t − f/f′.
  - inside (f(0) < 0): start at t = 2R (d(γ(2R), c) ≥ 2R − d(p, c) > R, so f > 0 there and the exit
    root lies between), iterate down to the exit root.
  - stop at an iterate with f ≤ 0 (the root within float32 rounding of f: the iterates approach it
    from f > 0) or when |step| ≤ 1e-5·(1 + t) (hit), or after 24 iterations (miss: only rays grazing
    within rounding of the silhouette); a hit requires t > 0 (floor 0, escape is ray_spawn's
    offset). *Changed during the build*: the first rule, |step| ≤ 1e-6·(1 + t) alone, left 8 holes in
    4096 near-silhouette rays on SwiftShader (rounding of f keeps the steps near 1e-5); with this rule
    0 hit/miss disagreements with fp64, hit points within 1.3 spawn offsets of the surface
    [checked-num, scratchpad cv-h2r/newton-probe.mjs].
  - f′(t) = 2·asinhc(r(t))·γ′(t).w + 2·(p.y + v.y·t)·v.y, with r(t) = |γ(t).xz| = sinh D_H(t) (from
    d(D_H²)/dt = 2·D_H·γ′.w/sinh D_H) — stable through the axis D_H = 0.
  - normal: (asinhc(r)·p.w·p.x, p.y, asinhc(r)·p.w·p.z, asinhc(r)·r²)/d (the unit velocity at p of
    the geodesic from the center; its H² part is D_H times H³'s radial direction).
  This is an iterated root, not the SDF march: no march epsilon, no finite-difference normal.

Not in this subset: quad and box (their E³ form needs tilted faces or a chart), torus, marched
shapes, tilted planes (none exist), vertical disks (a flat disk in γ×R; easy, deferred).

## 5. Who implements what

- New key `'h2xr'` in AMBIENT_SPACES and in `AmbientSpaceDescription.type`.
- Bodies listed under h2xr: geometry sphere, plane, disk, cylinder (new files `*_h2xr.glsl`); lights
  point, disk (`*_h2xr.glsl`); lambert, pinhole, fisheye (shared files, listed). Estimator
  occupants: power and uniform selection, unrolled dispatch.
- Row constraints (`constraintIn: { h2xr: … }`, two new RowConstraint kinds, exact zero tests on
  the authored numbers — no tolerance): plane `normal` vertical-or-horizontal; disk `normal` and
  disk-light `normal` vertical.
- New limitation row "object rotations about a non-vertical axis": spaces euclidean, hyperbolic,
  spherical; present when a primitive object's rotation has an axis with x or z ≠ 0, or is a
  quaternion (constant with q.x or q.z ≠ 0, or driven).
- The "an environment" row lists h2xr (BSDF rays read the sky at the key); "an environment sampled
  as a light" does not; env charts have no h2xr entry, so image skies are rejected by the chart
  gate; constant and procedural skies render.
- Everything else stays '—' in support.md: hg/rayleigh and every medium (no h2xr witness of the
  medium walker yet), other materials, box/quad/torus/marched/mesh shapes, sphere/quad/spot/…
  lights, other cameras, the light tree, table dispatch, emissive objects sampled as lights.

## 6. What changes outside the new files

- `isometry.ts`: CurvedGeometry gains compose/apply/applyTangent/rotation/tangent; `placementIsometry`
  composes with geom.compose and geom.rotation. `plan/curved.ts` (`curvedLightValues`) and
  `camera/basis.ts` (`curvedCameraBasis`) call the geometry's apply/applyTangent/tangent.
- `intersection.ts`: the curved arm and the curved region query call `isometry_point` /
  `isometry_tangent`; H³ and S³ occupants define them as the matrix product.
- Validator: the two RowConstraint kinds (propertyValidation.ts), the limitation row (curved.ts).
- READMEs (ambient, geometry, lights), support.md (regenerated), witnesses README, CHANGELOG,
  trace-loop-contract if it lists the occupant functions.

## 7. Verification (written before the code)

### Twins (vitest, fp64)

`tests/components/h2xr.test.ts` (the occupant's math and CPU geometry), with a TS mirror of every
GLSL formula in `tests/witnesses/scenes/h2xrTwins.ts`:
1. **Flow vs ODE.** RK4 of the geodesic equations in the model (h″ = ⟨h′, h′⟩_H·h, y″ = 0) from 20
   random (p, v) including v vertical, near-vertical (s = 1e-6) and horizontal: closed-form flow
   agrees to 1e-9 at t ∈ {0.3, 1, 3}; |γ′| = 1 and γ′ tangent.
2. **Distance vs flow.** distance(p, flow(p, v, t)) = t and directionTo(p, flow(p, v, t)) = v, to
   1e-10, at the same samples (catches a wrong D_H/Δy split).
3. **Area density vs finite differences of exp.** J by the Gram determinant (under the metric) of
   the central differences of exp_p(r·ω) over two orthonormal directions ⊥ v, against
   d²·sinhc(D_H), at 20 random (p, v, r), relative 1e-6; and against the two isotropic candidates to
   show they differ.
4. **Irradiance, independent of J.** At a receiver point, the disk-light E by quadrature with J
   equals π·Le·P(a cosine-distributed geodesic meets the disk's front face) by Monte Carlo (ray hits
   only, no density), |z| < 4; the point-light E = I·cos/J equals I·4π·P(an isotropic geodesic from
   the light crosses a small receiver disk)/area, |z| < 4.
5. **Roots vs a marched ray.** For plane (both kinds), disk, cylinder, ball: 300 random rays each
   from points in a box around the shape, the closed-form/Newton root against sphere-tracing the
   geodesic with the exact signed distance (step = |sdf|, stop at 1e-10) to 1e-7, and hit/miss
   agreement except for rays whose marched minimum distance is within 1e-6 of the surface.
6. **CPU geometry.** exp/log inverse; compose/inverse/apply/applyTangent against each other;
   transvection(v)·o = exp_o(v); isometries preserve the metric; the GLSL decode (mirrored in TS)
   equals `apply`; `rotation` of a non-vertical quaternion throws.

### GPU witnesses (tests/witnesses/scenes/h2xrWitness.ts), SwiftShader

1. **h2xr-furnace** — a closed box of four vertical planes and two horizontal planes at distance 0.5
   (2·tanh²0.5 = 0.43 < 1, so the H² square closes) holding an emissive ball and an emissive capped
   cylinder, all lambert ρ = 0.8, Le = 1, maxBounces 6, pt: every pixel Σ_{k≤6} 0.8^k = 3.951424
   through a pinhole at o and a fisheye away from o (at nonzero height). What it catches is
   bookkeeping: rays escaping the box (a broken vertical-plane root), NaNs, a spawn that leaves the
   box. It is insensitive to where a surface is hit and to its normal (every surface has the same Le
   and ρ, and a self-hit only adds a bounce of the same kind); those are the next witnesses' job.
2. **h2xr-disk-light** — a horizontal lambert disk receiver (radius 0.5 at o, ρ 0.5) under a
   horizontal disk light of **radius 1.2** facing down whose center is off to the side (generic
   D_H), maxBounces 1: pt, pt-nee and pt-mis against the twin's window mean (tolerance as H³:
   0.002/0.003). The twin states the window mean an isotropic density would give and the mean the
   Euclidean radius map r = ρ√u with the curved pdf would give (at radius 1.2 H³ measured +4.8%).
3. **h2xr-point-light** — direct light (maxBounces 1) from two point lights at generic directions
   (β near 45°) on lambert receivers, each read through its own window: the horizontal disk at o;
   a **vertical lambert wall** (a plane with a horizontal normal; shades the vertical-plane root and
   its normal N); a **ball** whose placement has a height and a horizontal center row (shades the
   Newton root, the ball normal, the m[3][1] decode and isometry_direction's stripped shift); a
   **cylinder** read on its wall and on its top cap (wall and cap normals, the tube root's τ/s). The
   twin asserts each window is covered by its object and unshadowed. Under power nee, mis and
   uniform nee. The twin states each window's value under an isotropic density.
4. **h2xr-sky** — black (albedo 0) ball, cylinder, vertical plane, horizontal floor plane and
   horizontal disk under the procedural sky 1 + key, maxBounces 1, pt, pinhole and fisheye. The
   camera is **horizontally displaced from o** (about 1.2, as H3_SKY_CAMERA), so the key differs from
   the view direction; the ball's placement is {param}-driven with a **position of nonzero height, an
   angle about y and a horizontally offset center row with nonzero height** (so the m[3][1] decode,
   the composition of shifts and the rotation all move the ball). The frame mean against the twin
   (every ray's first hit by the fp64 roots, the sky at the key otherwise); the twin states the mean
   with the view direction in place of the key and with the ball placed by a plain mat4 product.

Planned mutations (step 3; each must fail its witness, then revert):

| mutation | witness expected to fail |
|---|---|
| point light J := d² | h2xr-point-light (all windows) |
| disk light J := sinh² d | h2xr-disk-light |
| disk light sampler radius r = ρ√u (pdf unchanged) | h2xr-disk-light (pt-nee) |
| disk light cos_l from the departure direction at p instead of the arrival at y | h2xr-disk-light (nee/mis) |
| vertical-plane root without the 1/s (t = atanh(−sP/W)) | h2xr-point-light wall window |
| cylinder τ not divided by s | h2xr-point-light cylinder window, h2xr-sky |
| sky key := view direction | h2xr-sky |
| isometry_point ignoring the shift | h2xr-sky, h2xr-point-light ball window |
| isometry_direction without stripping the shift | h2xr-point-light ball window |

An exactly vertical ray is measure zero under jitter and cosine sampling (float32 s rounds to 0 only
for s ≲ 3e-4), so the flow's s = 0 case is established by twin 1, not by a GPU mutation.

**Float32 Newton** (finding 6 of §10): before the witnesses, a SwiftShader probe runs the GLSL ball
body on grazing rays and reports the iteration counts and the root's error against fp64, compared
with hit.eps = spawn_eps_fp.

### Twins added after review

7. **Camera frame** (h2xr.test.ts): curvedCameraBasis in H²×R gives an orthonormal tangent frame at
   exp_o(position) with the camera at nonzero height, forward reaches the target, up lies in the
   plane of forward and e_y (no roll), and an orbit about the target is a rotation.
8. **Sky key**: invariant along the flow, equal to the view direction at o, unit, and (0, ±1, 0) in
   the s → 0 limit.

### Unchanged output

Euclidean shader text must not change: `npm run digest` before and after, `--compare`. H³ and S³
text changes only at the arm's and region query's isometry lines (expected, reviewed by kind);
their uniform closures and scene data must be identical (the CPU refactor). If the digest shows any
Euclidean shader change, `npm run frames` record/compare. Targeted witnesses: the four above, plus
h3-sky-ball and s3-furnace (driven and constant isometries through the new seam).

## 8. Demo

A gallery scene in "Curved spaces": a horizontal floor, a ring of columns (capped cylinders) whose
spacing shows H²'s exponential growth, balls resting between them, a disk light overhead and a
dim constant sky; checked on a lab render.

## 9. Provisional choices (model's, unconfirmed)

| # | choice | why | undo |
|---|---|---|---|
| 1 | key `'h2xr'`, height = y, hyperboloid on (x, z, w) | the authored up axis; the tangent metric and o equal H³'s | rename the key / permute in the occupant and h2xr.ts |
| 2 | mat4 encoding with the height shift in m[3][1]; `isometry_point`/`isometry_tangent` seams (H³/S³ text changes) | a translation of R is affine; 16 floats keep the uniform machinery | a 5×5 (two uniforms) per object |
| 3 | rotations about y only | the π-flips (H² reflection × y ↦ −y) need a sign entry | add the sign in m[1][1] and compose with it |
| 4 | horizontal disks only | vertical disks need their own sampler (a flat disk in γ×R) | add the vertical-disk branch |
| 5 | ball by convex Newton (24 iterations max) | no closed form; monotone convergence is sound | a bracketed solver |
| 6 | no media in H²×R | no witness of the medium walker there yet | list hg and add an h2xr-medium witness |
| 7 | sky: constant and procedural, BSDF rays only | the key is exact; sampling it needs its Jacobian | add the sky-as-light row with a witness |
| 8 | MAX_DIST = 10 | as H³; a floor's horizon band (rays within about h/10 of it) is clipped to sky — visible, unlike H³'s grazing bands | one constant |
| 9 | the metric and frame through the transported basis (E1, e_y, E2) | the form cancels far from o (measured NaN) | the form |
| 10 | the cylinder's tube root solved on the flow's x and z (a quadratic in e^{2st}), valid for non-tangent directions | a spawned ray's direction is off the offset origin's tangent space by the spawn offset; H³'s ball identities then put the root inside the surface (furnace −0.3%, measured); projecting every direction was measured worse (NaN far from o) | H³'s identities with a projected direction |

## 10. Review

One fresh general-purpose agent reviewed the first draft (scripts in the scratchpad,
cv-h2r/review-plan/). It re-derived or measured every formula of §§1–4 and found them correct:
flow vs RK4 7.7e-10, distance vs flow 1.7e-13, direction 6.7e-14, J vs finite differences of exp
4.3e-9, cylinder identity and roots 1e-13, plane atanhc root 2.5e-14, ball f′ 3.4e-9, ball normal
1.2e-13, the Newton scheme on 3000 rays against bisection (0 disagreements, at most 9 iterations),
the sky key's invariance 3.5e-12, the isometry encoding 4e-14. Its findings and what changed:

1. Nothing on the GPU saw the vertical plane's root value or normal, the cylinder caps or the ball
   placement's shift (furnace and black-object frames see only hit/miss) — the point-light witness
   now reads a vertical wall, the ball (with a height placement) and the cylinder wall and cap; the
   plane mutation that was the same root in other arithmetic is replaced by "1/s omitted".
2. h2xr-sky's catches depended on unstated parameters (a camera at o has key = view direction; a
   shift or rotation without offsets moves nothing) — the parameters are now required.
3. The disk-light radius decides whether a wrong sampler radius is visible — radius 1.2, with
   the sampler-radius and emitter-cosine mutations added.
4. A 1/s mutation on vertical rays would not fail on the GPU — dropped; twin 1 covers s = 0.
5. isometry_direction must strip the shift — added to the point-light ball and to the mutations.
6. Float32 Newton unmeasured — a SwiftShader probe before the witnesses.
7. No camera-frame twin; 8. no sky-key twin — added.
9. Numeric slips (Taylor truncations, the isotropic comparisons, the precision of s) — corrected.
10. Explicit v.y = 0 misses, the disk distance for the twins, the operation order of tangent() for
    H³/S³ bit-identity, and the H³/S³ occupant text change — stated.
