# Hyperbolic space H³ — what it computes and why

The hyperboloid model: a point is p ∈ R^{3,1} with ⟨p,p⟩ = −1, p.w > 0, where
⟨a,b⟩ = a.x·b.x + a.y·b.y + a.z·b.z − a.w·b.w; a tangent vector at p is v with ⟨p,v⟩ = 0, and the
metric on T_p is ⟨·,·⟩ (positive definite there). Curvature is −1, so lengths are in units of the
curvature radius. The origin is o = (0,0,0,1); an authored Vec3 v names exp_o(v) =
(sinh|v|·v̂, cosh|v|). The measurements quoted below are in
docs/claude-2026-11-review/curved/ (geometry-twins, primitive-bodies, far-precision-media,
light-sampling-twins, camera-placement-authoring).

## The occupant (hyperbolic.glsl)

- **Geodesics.** γ(t) = cosh t·p + sinh t·v, velocity γ′(t) = sinh t·p + cosh t·v; t is arc length
  in every frame. `ambient_geodesic` puts the point back on the hyperboloid by recomputing
  w = √(1 + |xyz|²) from xyz: float32 arc error ≈ 2⁻²³·w, against ≈ 2⁻²³·w² for rescaling all
  four coordinates, which cannot renormalize at all 8 from o.
- **`farClip: 10`** (descriptor field, emitted as `MAX_DIST` unless the measurement authors
  `farClip`), an arc length. float32 cosh overflows near t = 89; with the scene inside the
  working radius the clip removes only the grazing band of each plane near its ideal circle,
  ≈ 2 sinh h·e^{−2T} rad (5·10⁻⁹ rad at h = 1).
- **`fp_uncertainty(p) = max(ABS, REL·p.w)`**: 256 ulps of the largest coordinate (w ≥ |x|,|y|,|z|
  on the hyperboloid). The smallest spawn offset with no self-hit failures was measured at
  1e-5 (D = 1), 3e-5 (D = 2), 1e-4 (D = 3), 1e-3 (D = 4) from o; REL·cosh D exceeds each.
- **`ambient_distance(a, b) = 2·asinh(√⟨a−b,a−b⟩ / 2)`** (⟨a−b,a−b⟩ = 4 sinh²(d/2)): relative
  error ≤ 4e-7 in float32 near o at every separation, where acosh(−⟨a,b⟩) is wholly wrong at
  separation 1e-4. It fails for separations near 20 and beyond, far outside a scene.
- **`ambient_direction_to(a, b)`**: the chord b − a projected onto T_a, (b − a) + ⟨a, b − a⟩·a,
  normalized (direction error 1e-7 at separation 1e-3, against 3.7e-4 for the form b + ⟨a,b⟩a).
  The arrival direction of the geodesic a → b at b is −ambient_direction_to(b, a).
- **`ambient_frame(p, n)`**: n projected onto T_p and normalized, then t and b by Gram–Schmidt from
  the coordinate axis whose component orthogonal to p (and the vectors already chosen) is longest.
  A fixed seed with a length threshold fails about 4 from o, where every axis is nearly parallel
  to p in R⁴.
- **`ambient_parallel_transport(v, a, b) = v + ⟨b,v⟩/(1 − ⟨a,b⟩)·(a + b)`** along the geodesic.
- **`ambient_sky_key(p, v) = normalize((p + v).xyz)`**: γ(t) → (eᵗ/2)(p + v) with p + v null, so the
  ray ends at that ideal point whatever t; at o it is the view direction. The sky is the picture on
  the sphere at infinity as seen from o.
- **`isometry_direction(G⁻¹, v) = J·((J·v)·G⁻¹)`**: an isometry satisfies Gᵀ·J·G = J, so
  G = J·(G⁻¹)ᵀ·J; GLSL's v·M is the row-vector product, and no second matrix is needed.

## Placements and the camera (hyperbolic.ts, ../isometry.ts)

- The transvection by v (|v| = d, u = v̂) is T = I + sinh d·M + (cosh d − 1)·M² with M the boost
  generator along u: [[I + (cosh d − 1)·u uᵀ, sinh d·u], [sinh d·uᵀ, cosh d]]. It is built from v,
  never from its endpoint (the endpoint form divides by 1 + w, singular at the S³ antipode).
- g⁻¹ = J·gᵀ·J exactly.
- The camera frame (components/camera/basis.ts, `curvedCameraBasis`) is target-centered: an orbit
  at fixed elevation is an exact rotation about the target's vertical geodesic, where the
  origin-centered rule rolls the horizon by up to 54°. Far from o the composed product loses
  orthonormality (1e-8 at camera distance 6), so it is Gram–Schmidt-ed at exp_o(position).
- Precision: a float32 camera ray's point at t = 1 is off by 3e-7 at camera distance 0, 2e-4 at 4
  and 8e-3 at 6 from o. Keep the camera and the scene within about 3 of o.

## The shapes and lights with H³ bodies

- **Sphere** (geodesic ball about o): distance asinh(|p.xyz|) − R; the intersection solves
  (a+b)x² − 2 cosh R·x + (a−b) = 0 for x = eᵗ (a = p.w, b = v.w), cancellation-free through
  cosh²R − (a² − b²) = sinh²R − |p.xyz × v.xyz|² and (a+b)(a−b) = 1 + |p.xyz × v.xyz|². Outward
  normal (p.w·p̂.xyz, |p.xyz|). Against brute force in fp64: 600 rays, no hit/miss mismatch, |Δt|
  ≤ 1e-11; in float32 the naive form misclassifies 25% of grazing rays at R = 0.01, D = 3, this
  form 0.13%.
- **Plane** (totally geodesic, ⟨x, N⟩ = 0 with N = (cosh(offset)·n, −sinh(offset))): distance
  asinh(⟨p, N⟩) (with the sign restored around asinh, which GLSL evaluates badly for large
  negative arguments); intersection e^{2t} = (W − P)/(W + P) with P = ⟨p,N⟩, W = ⟨v,N⟩ (the
  occupant's `hyperbolic_plane_root`, shared with the disk); the normal is N on the plane.
- **Disk** (radius ρ in the plane through o ⊥ n): the same plane root, then |h.xyz|² ≤ sinh²ρ.
- **Point light**: irradiance I·cos θ/sinh²d (flux 4πI through every geodesic sphere).
- **Disk light**: area 2π(cosh ρ − 1) = 4π sinh²(ρ/2); uniform-area radius sinh(r/2) = √u·sinh(ρ/2)
  (cosh r = 1 + u(cosh ρ − 1)); area → solid angle dω = cos_l·dA/sinh²d with cos_l against the
  arrival direction at the light point. Cosine sampling, area sampling and MIS agree with each
  other and with Le·π·sin²β (tan β = tanh ρ/sinh D) in the fp64 twins.
