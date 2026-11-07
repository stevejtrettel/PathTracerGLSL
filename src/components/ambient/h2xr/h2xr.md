# H²×R — what it computes and why

The product of the hyperbolic plane (curvature −1) and the line. A point is p = (x, y, z, w): the
height is y, and (x, z, w) lies on the hyperboloid x² + z² − w² = −1, w > 0. Write
p_H = (x, 0, z, w) and ⟨a, b⟩_H = a.x·b.x + a.z·b.z − a.w·b.w. A tangent vector at p is v with
⟨p_H, v⟩_H = 0 (v.y free); the metric on it is ⟨v, v⟩_H + v.y², the Minkowski form of R^{3,1} as in
H³. The origin is o = (0,0,0,1); an authored Vec3 v names exp_o(v) = (sinhc(s)·v.x, v.y,
sinhc(s)·v.z, cosh s), s = |(v.x, v.z)|. The space is homogeneous but not isotropic: the vertical is
distinguished, and the isometries fixing a point are O(2) × {±1}. The plan with the derivations and
the review is docs/claude-2026-11-review/curved/h2xr-plan.md; the fp64 twins are
tests/witnesses/scenes/h2xrTwins.ts, checked by tests/components/h2xr.test.ts.

## The occupant (h2xr.glsl)

- **Geodesics.** With u the H² part of the unit velocity and s = |u| its speed, the H² part runs
  along an H² geodesic at speed s and the height at speed v.y:
  γ(t) = cosh(st)·p_H + t·sinhc(st)·u + (p.y + v.y·t)·e_y, γ′(t) = s·sinh(st)·p_H + cosh(st)·u + v.y·e_y.
  No division by s, so a vertical ray is exact. Checked against RK4 of h″ = ⟨h′, h′⟩_H·h, y″ = 0 to
  1e-9 (vertical, near-vertical, horizontal and generic rays).
- **Distance** √(D_H² + Δy²), D_H = 2·asinh(√⟨c, c⟩_H / 2) with c = a_H − b_H (H³'s chord form).
- **Direction to b**: normalize(asinhc(|w|)·w + Δy·e_y), w = (b_H − a_H) + ⟨a_H, b_H − a_H⟩_H·a_H the H²
  log direction (|w| = sinh D_H), exact for a point straight above.
- **Small-argument quotients.** SwiftShader evaluates sinh, asinh and atanh with an absolute error
  near 0 (measured 8e-8, 2e-7, 9e-8; so 1e-3 to 2e-2 relative at tiny x). sinhc, asinhc and atanhc
  are Taylor polynomials below 0.05 (truncation below 3e-9).
- **Sky key**: the endpoint class of a ray is (the ideal point ξ of its H² part, its angle β from the
  vertical); key = (sin β·ξ.x, cos β, sin β·ξ.z), ξ in Klein coordinates. It is invariant along the
  flow, is the view direction at o, and reads (0, ±1, 0) for vertical rays.
- **The metric and the frame** go through the orthonormal basis (E1, e_y, E2) of T_p, the x and z
  axes at o carried to p along the H² geodesic: E1 = (1 + k·x², 0, k·x·z, x), E2 = (k·x·z, 0,
  1 + k·z², z), k = 1/(1 + w), every term a product with no cancellation. `ambient_dot` is the dot
  product of the components in it (equal to the Minkowski form on tangent vectors), and
  `ambient_frame` completes n's components to an orthonormal triple. The form itself cancels far
  from o — a unit tangent vector's coordinates grow like w — and in the demo's floor near its
  horizon (hit points beyond about 4 from o) SwiftShader's form of a unit vector came out negative:
  NaN directions under next-event estimation in 2–14% of the pixels after 20 s (pt hid them: a NaN
  ray misses everything and reads the constant sky). The sum of squares cannot be negative; with it
  the same renders have no NaN. It keeps those directions finite, not accurate: either form's
  relative error grows like ε·w² (measured in emulated float32 by the review: 2e-6 at 2 from o,
  2e-4 at 4, 1e-2 at 6, order 1 at 8). The working radius for accurate shading is about 3 from o,
  as in H³; the witnesses stay within 1.5.
- **Directions are made tangent at the ray's origin** (`h2xr_tangent_at`) in the flow, the
  vertical-plane root and the cylinder. A spawned ray keeps the direction sampled at its hit
  point, off the spawned origin's tangent space by about the spawn offset, and the closed forms
  assume tangency: without the projection a cylinder root landed up to 4e-5 inside the surface,
  the next ray met the cylinder from inside (a back face, no emission), and the furnace read
  3.9398 against 3.9514; with it, 3.95142.
- **`MAX_DIST = 10`**, as H³; **`fp_uncertainty(p) = max(ABS, REL·max(p.w, |p.y|))`**. A horizontal
  floor seen from height h is hit beyond the clip by rays within about h/10 of the horizon, so a
  thin band of sky shows there (the declared far-clip truncation); unlike H³'s grazing bands
  (≈ 2 sinh h·e^{−2T}) it is visible, because heights grow only linearly.

## Light falloff: the area density

dω = |cos θ_q|·dA/J with **J(p, q) = d²·sinh(D_H)/D_H**. Along a geodesic at angle β from the
vertical the Jacobi field normal to its vertical plane solves Y″ = sin²β·Y (sectional curvature
−sin²β), so it grows as sinh(t sin β)/sin β, and the one in that (flat, totally geodesic) vertical
plane grows as t; J is their product and t·sin β = D_H. J depends on both d and D_H (on the
direction), is symmetric in p and q, and equals d² straight up and d·sinh d horizontally. Checked:
the Gram determinant of finite differences of exp_p to 1e-6; a disk light's quadrature with J against
Monte Carlo ray hits (no density); a point light's I·cos/J against the flux of isotropic geodesics
from the light through a small receiver disk. At D_H = Δy = 1, J = 2.3504 against d² = 2,
d·sinh d = 2.7366 and sinh² d = 3.7445.

- **Point light**: E = I·cos θ/J (`h2xr_area_density`).
- **Disk light** (horizontal disks only): a horizontal plane is a totally geodesic copy of H², so
  the disk is H³'s disk in a plane — area 4π sinh²(ρ/2), uniform-area radius sinh(r/2) = √u·sinh(ρ/2);
  pdf J/(A·cos_l), cos_l = |Δy|/d against the arrival direction.

## Placements (h2xr.ts)

An isometry (B, c): B ∈ SO⁺(2,1) on (x, z, w), c a height shift. It is affine on the 4-vector, so
the mat4 holding it is an encoding: m[3][1] (GLSL; `m[13]` column-major) holds c, the rest is B and
the identity on y. `isometry_point`, `isometry_tangent` and `isometry_direction` (G⁻¹'s linear part,
shift stripped) decode it on the GPU; `compose`, `inverse`, `apply`, `applyTangent` on the CPU.
Rotations are about the vertical axis only (the π-turns about a horizontal axis, an H² reflection
with y ↦ −y, are isometries but are not built); the Validator rejects any other.

## Shapes

The totally geodesic surfaces are the horizontal planes H²×{c} and the vertical planes γ×R:
- **plane**: normal vertical (y·n.y + offset = 0, linear root) or horizontal (H³'s plane in the H²
  factor; root t = (−P/W)·atanhc(−s·P/W), no 1/s).
- **disk**: horizontal; t = −y/v.y, then x² + z² ≤ sinh²ρ.
- **cylinder**: capped vertical, D_R × [−h, h]; the tube is H³'s ball quadratic in e^{st} on the H²
  part, met with the slab interval.
- **sphere** (the metric ball): no closed form; f(t) = D_H² + y² − R² is convex along geodesics
  (H²×R is CAT(0)), so Newton from where f > 0 moves monotonically to the nearest root. It stops
  at f ≤ 0 (the root within rounding) or at a step ≤ 1e-5·(1 + t). Measured on SwiftShader on 4096
  rays aimed within 3% of the silhouette, from 1 to 2.5 away: no hit/miss disagreement with fp64
  (a step threshold of 1e-6 left 8 holes: the float32 rounding of f keeps the steps near 1e-5),
  hit points within 1.3 spawn offsets of the surface (the float32 flow from a far origin cancels, as
  in H³), at most 9 iterations except at the silhouette.

All roots agree with sphere tracing by the exact distances to 1e-7 in fp64 (h2xr.test.ts).
