# Spherical space S³ — what it computes and why

The unit-sphere model: a point is p ∈ R⁴ with |p| = 1; a tangent vector at p is v with p·v = 0, and
the metric on T_p is the dot product of R⁴. Curvature is +1, so lengths are in units of the
curvature radius (a great circle has length 2π). The origin is o = (0,0,0,1); an authored Vec3 v
names exp_o(v) = (sin|v|·v̂, cos|v|). The measurements quoted below are in
docs/claude-2026-11-review/curved/ (geometry-twins, primitive-bodies, far-precision-media,
light-sampling-twins, review-mc).

## The occupant (spherical.glsl)

- **Trigonometry.** Every S³ position and every S³ body evaluates cos and sin with the occupant's
  `spherical_cos_sin` (range reduction by π/2 in three parts, Taylor polynomials on |r| ≤ π/4):
  |error| ≤ 7e-8 on [−4, 12] on SwiftShader. GLSL ES 3.00 leaves sin and cos precision
  unspecified, and SwiftShader's are off by up to 1.9e-4 on [−0.1, 6.4] (its atan by 2e-7, its asin
  by 7e-5; measured with tools/render-glsl-probes.mjs). With the built-in functions a hit point
  computed along the geodesic sat up to 1e-4 from the root's surface, beyond the 3e-5 spawn offset:
  in the s3-medium witness about a quarter of the paths through the ball re-spawned on the wrong side
  of its boundary, kept the ball's medium outside it, and NEE differed from pt by 17%.
  `spherical_asin` is asin through atan for the same reason.

- **Geodesics.** γ(t) = cos t·p + sin t·v, velocity γ′(t) = −sin t·p + cos t·v; t is arc length
  in every frame. `ambient_geodesic` rescales the point onto the sphere (in S³ the float32 error
  stays near 1e-7 at every distance, and rescaling is enough; no coordinate grows).
- **`farClip: 2π`** (descriptor field, emitted as `MAX_DIST` unless the measurement authors
  `farClip`), exact rather than a clip: every geodesic closes after 2π, so the first hit in
  (0, 2π) is the first hit, and a ray that meets nothing within one period meets nothing. A ray
  leaving an open disk returns to the disk's back face just before 2π, which is the physics of a
  closed space. In float32 a ray flowed by 2π returns within 2.3e-7 of its start.
- **No sky.** An environment is an error in S³ (SPACE_LIMITATIONS); a ray that meets nothing
  reads 0 exactly (along a closed source-free geodesic in vacuum the radiance is 0), and
  `ambient_sky_key` is a constant the empty environment never reads.
- **`fp_uncertainty(p) = max(ABS, REL·max|p_i|)`** over all four coordinates (each at most 1).
- **`ambient_distance(a, b) = 2·atan(|a − b|, |a + b|)`** (|a − b| = 2 sin(d/2), |a + b| = 2 cos(d/2)):
  full relative precision near 0 and near π, where acos(a·b) loses it.
- **`ambient_direction_to(a, b)`**: the chord projected onto T_a, (b − a) − (a·(b − a))·a,
  normalized — the short arc's initial direction.
- **Two arcs.** Any two points that are not antipodal are joined by the short arc (length d,
  leaving along u = direction_to(a, b)) and the long arc (length 2π − d, leaving along −u). The long
  arc arrives with velocity opposite to the short arc's, and both have the area density sin² d
  (A(2π − d) = A(d)). Measured: the long arc reaches the same point with arrival velocity −(the
  short arc's) to 3e-13.
- **`ambient_aim(from, along, to)`** keeps a shadow ray on its arc: the short arc when `along`
  leaves into it (along·u > 0), with remaining length d; otherwise −u with 2π − d. A walker that
  re-aims after a null crossing on a long arc gets the short arc once less than π is left, which
  is the same geodesic.
- **`ambient_frame(p, n)`**: n projected onto T_p and normalized, then t and b by Gram–Schmidt from
  the coordinate axis whose component orthogonal to p and the vectors already chosen is longest
  (one of length ≥ 1/2 always exists).
- **`ambient_parallel_transport(v, a, b) = v − (b·v)/(1 + a·b)·(a + b)`** along the short arc.
- **`isometry_direction(G⁻¹, v) = v·G⁻¹`**: isometries of S³ are orthogonal, G = (G⁻¹)ᵀ, and GLSL's
  v·M is the row-vector product Mᵀv.
- **`spherical_plane_root(ray, N)`**: along γ(t), γ(t)·N = P cos t + W sin t (P = p·N, W = v·N),
  zero at t₀ = atan(−P, W) mod π and t₀ + π; the first in (0, π] is returned. Every geodesic meets
  every great sphere.
- **The arc rule for light samples (`spherical_light_arc`).** A one-sided surface receiver
  (`!q.two_sided`, `q.n ≠ 0`; n is the hit's frame.n, which faces the side the ray arrived from)
  scatters only into its upper hemisphere, and exactly one arc leaves into it: that arc is taken
  with probability 1, which per sample equals summing both arcs. A two-sided receiver or a medium event (n = 0) takes each
  arc with probability ½. Measured in review-mc/arc_rule.ts: every surface case |z| ≤ 1.55 against
  cosine sampling; the medium case loses half the light (z −197) if the one-sided rule is applied
  without the `n ≠ 0` condition.

## Placements and the camera (spherical.ts, ../isometry.ts)

- The transvection by v (|v| = d, u = v̂) is the rotation by d in the plane of e₄ and u:
  [[I + (cos d − 1)·u uᵀ, sin d·u], [−sin d·uᵀ, cos d]], built from v (the endpoint form divides by
  1 + p₄, singular at the antipode −o).
- g⁻¹ = gᵀ exactly.
- The camera frame is curvedCameraBasis's target-centered frame (camera/basis.ts), the same
  construction as in H³ under the dot product.

## The shapes and lights with S³ bodies

- **Sphere** (geodesic ball about o, 0 < R < π): distance atan(|p.xyz|, p.w) − R (float32 error
  1.9e-9 near the surface at R = 0.01, against 3.3e-6 for acos(p.w) − R). Along γ the 4th coordinate
  is A cos(t − φ), A² = 1 − k with k = |p.xyz × v.xyz|², φ = atan(v.w, p.w); the ball is where it
  exceeds cos R, so the crossings are φ ∓ α with α = atan(√(sin²R − k), cos R), taken mod 2π —
  entry when outside, exit when inside (fp64 against brute force: 600 rays, no mismatch, |Δt| ≤
  9e-16). Outward normal (p.w·p̂.xyz, −|p.xyz|).
- **Plane** (a great sphere x·N = 0, N = (cos(offset)·n, sin(offset))): signed distance asin(p·N),
  intersection the first plane root; the solid is the hemisphere below.
- **Disk** (radius ρ in the great sphere through o ⊥ n): the plane roots t₀ and t₀ + π meet the
  great sphere at antipodal points h and −h; the hit is the first of them in the disk
  (h.w ≥ cos ρ).
- **Point light**: each arc delivers I/sin²d; on a surface, I·|cos θ|/sin²d summed over the arc
  leaving into each side (the long arc lights the side facing away from the light).
- **Disk light**: area 2π(1 − cos ρ) = 4π sin²(ρ/2); uniform-area radius sin(r/2) = √u·sin(ρ/2)
  (cos r = 1 − u(1 − cos ρ)); area → solid angle dω = cos_l·dA/sin²d, cos_l against the chosen
  arc's reversed arrival direction, times the arc probability. An on-axis disk at distance D seen
  through either arc gives Le·π·sin²β with tan β = tan ρ/sin D.
