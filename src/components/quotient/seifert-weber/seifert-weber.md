# The Seifert–Weber space — what it computes and why

M = H³/Γ, the Seifert–Weber dodecahedral space: a closed hyperbolic 3-manifold of volume
11.199. Its fundamental domain D is the regular dodecahedron about o = (0,0,0,1) with all
dihedral angles 2π/5 (72°), in the hyperboloid model of components/ambient/hyperbolic.

## The domain and the pairings

- **Radii** (closed forms): the inradius r_in has cosh² r_in = (5 + 2√5)/4, r_in = 0.99638; the
  circumradius R_c has cosh R_c = (7 + 3√5)/4 = φ⁴/2, R_c = 1.90285. D's diameter is 2R_c.
- **Faces.** Face 2k has the unit direction u_k at o and face 2k + 1 the direction −u_k, with
  u_k over (0,1,φ), (0,1,−φ), (1,φ,0), (1,−φ,0), (φ,0,1), (−φ,0,1) normalized. The outward unit
  normal is N = (û·cosh r_in, sinh r_in), and ⟨N, p⟩ = sinh of p's signed distance beyond the
  face, so D = {p : ⟨N_i, p⟩ ≤ 0 for every i}.
- **Pairings.** g_{2k} = T(−2r_in·u_k)·R(u_k, 3π/5) and g_{2k+1} = g_{2k}⁻¹: the rotation by 3/10
  of a turn about the face's axis, then the transvection that carries face 2k onto face 2k + 1.
  g_i N_i = −N_{i xor 1}, so a ray leaving D through face i re-enters through face i xor 1.
  These match the owner's thurston-rebuild implementation
  (src/geometries/hyp/groups/seifert-weber/set.js); the comment above its `halfWidth` constant
  needs α = π/5 (half the dihedral angle), not 2π/5, for a nonnegative radicand. The value is
  right.
- **Why it is a manifold** (Poincaré's polyhedron theorem, checked in
  tests/components/quotient/seifertWeberGroup.test.ts): the 30 edges form 6 cycles of 5 edges,
  5 · 72° = 2π, each cycle's product is I; the 20 vertices form one class; Γ acts freely and the
  cells γD tile H³.

The data is computed in float64 and emitted once as float32 const arrays (`FACE_N[12]`,
`PAIRING[12]`, 240 floats). They are constants, not uniforms, because Γ is fixed when the
program is compiled.

## The walk

`scene_intersect` (generated, intersection.ts) queries the scene copy in D with the current ray
clipped at the exit face, and if it finds nothing, moves the ray to the exit face and through
the pairing:

- **Exit face.** Along γ(t) = cosh t·p + sinh t·v, ⟨N, γ(t)⟩ = 0 where τ = tanh t = −⟨N, p⟩/⟨N, v⟩.
  The ray leaves through the face with ⟨N, v⟩ > 0 and the least τ (`seifert_weber_exit`). τ is at
  most tanh 2R_c < 1, and the arc length is atanh τ.
- **Crossing.** The exit point and velocity divided by cosh t are p + τv and v + τp. The walk puts
  them back on the hyperboloid and its tangent space (`inversesqrt`) and applies the one fixed
  matrix PAIRING[f] (`seifert_weber_cross`). Renormalizing at every crossing is required: the
  constraint ⟨p, v⟩ = 0 is unstable, its defect growing by cosh 2t per crossing (without it, 851
  of 2,000 float64 rays failed in the review's study). No product of pairings is ever formed:
  a float32 product of 10 pairings is already off by 1.1.
- **Arc length.** `hit.t` is the sum of the cells' exit lengths plus the local hit distance. The
  walk ends a segment at the far clip MAX_DIST = `measurement.farClip`, and after
  `QUOTIENT_MAX_CROSSINGS` = ⌈4·farClip⌉ + 32 crossings (a capped camera or BSDF segment is a
  miss; a capped shadow ray is occluded, so the cap only ever removes light). The mean length
  between crossings is 0.960 (Kac's lemma, 4·vol(M)/area(∂D)); the float32 twin's rays cross
  at most 15, 18 and 28 faces in windows of length 6, 8 and 16 (caps 56, 64 and 96).
- **The arrival direction** `hit.arrival` is the cell query's, in D's chart. After a crossing,
  the flow of the original ray would be in the wrong chart (and cosh t overflows at large t).

## The images

A lamp in D is seen from x along one geodesic per element of Γ. NEE samples the table
S13 = {I} ∪ {the cells across the 12 faces} uniformly: image 0 is the lamp in D, image 1 + f its
copy g_f⁻¹·L in the cell across face f. That copy seen from x is the lamp seen from g_f·x, so the
unchanged sampler runs at the query moved by PAIRING[f] (`quotient_image_query`), and the sampled
direction is carried back by PAIRING[f]⁻¹ = PAIRING[f xor 1] (`quotient_image_direction`).

A BSDF ray names the image it hit by its crossing count (`quotient_image_index`): 0 crossings →
0, one crossing through face f → 1 + f, more → −1 (NEE density 0, so that hit keeps weight 1).
This names the same images NEE samples because D ∪ g_f⁻¹D is convex: the dihedral angle 72° is at
most 90°, so the union's edge angles are 144° and its vertex links convex, and in the Klein model
H³-convexity is Euclidean convexity (Tietze–Nakajima). A geodesic from D into the cell across
face f therefore crosses exactly one face. Word length is not membership in general; it is here
because of this convexity.

Every image in S13 lies within d(x, o) + d(o, γo) + d(γo, γy) ≤ R_c + 2r_in + R_c = 5.798 of
every point x of D, so the far clip must be at least that (the Validator's floor).

## Measured precision

- **Float32 twin** of the step (tests/components/quotient/seifertWeberWalk.test.ts): over
  2,000 rays × 100 crossings the constraints drift by at most 1.2e-5; 2,000 rays aimed at
  vertices and edges make zero-length runs of at most 6 crossings (drift 1.4e-5) and never
  stick. Without the renormalization every one of the 2,000 random rays loses its exit face.
- **SwiftShader**, the same step over the emitted tables (4,096 rays × 100 crossings, and 4,096
  aimed at vertices and edges × 30): no stuck or non-finite ray, drift at most 1.4e-5, states at
  most 1.9e-5 beyond a face (sinh of the distance), zero-length runs of at most 6, and at most
  16/19/30 crossings in a window of 6/8/16 (caps 56/64/96). The builtins on the walk's ranges:
  `atanh` on [0, tanh 2R_c] within 2.4e-7 absolute (an arc-length error only; the geometry uses τ
  directly), `inversesqrt` within 9e-8 relative. Unlike S³'s sin and cos, they need no
  replacement here.
- **Not measured:** the M2 GPU, and FMA contraction there.

## The camera

The camera pose is reduced into D on the CPU (`swReduce`): while the point lies beyond some
face, apply that face's pairing to it and its frame. Each step lowers d(p, o), because D is the
Dirichlet domain at o (face i bisects o and g_i⁻¹·o) and orbit distances are discrete, so it
ends. A point within 1e-9 of a face counts as inside, so a camera exactly on a face does not
bounce between the paired faces under rounding.
