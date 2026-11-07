# Primitive bodies in H³ and S³ — research notes (key: primitive-bodies)

Conventions. H³: hyperboloid, ⟨x,y⟩ = x₁y₁+x₂y₂+x₃y₃−x₄y₄, origin O=(0,0,0,1). S³: unit sphere in R⁴,
Euclidean dot, O=(0,0,0,1). Each body works in the object's local frame (object at O) on a ray
(p, v), ⟨p,v⟩=0, ⟨v,v⟩=1, γ(t) = cosh t·p + sinh t·v (H³), cos t·p + sin t·v (S³). Returned t is arc
length; an isometry does not change it, so curved wrappers never rescale t, unlike the Euclidean
wrapper with a scale s [math].

Labels: [checked-code] file:line, [checked-num] script in this folder, [math] derived here, [mem].

Scripts (run from the repo root with `npx tsx <path>`):
- `lib.ts`: shared helpers (flow, distance, frames, brute-force root finder, f32 emulation).
- `ball.ts`: ball SDF and closed form vs brute force; f32 robust vs naive forms; SDF forms near the surface.
- `frame_precision.ts`: object-frame vs ray-frame float32 precision for an H³ ball.
- `shapes.ts`: plane, disk, quad, capped tube, box and torus: SDFs and intersections vs brute force.
- `torus_bound.ts`: the torus march bound in each space.
- `lipschitz.ts`: chart Lipschitz bounds, and Euclidean fields evaluated in a chart.
- `march.ts`: sphere tracing along the flow (E³/H³/S³ step counts); FD normals vs analytic normals.
- `tetra_e3.ts`: order of accuracy of the existing Euclidean 4-tap normal.
- `asinh_neg.ts`: float32 behavior of GLSL's asinh for negative arguments.

## Summary table

| Euclidean primitive | H³ / S³ meaning | SDF | Intersection | First subset? |
|---|---|---|---|---|
| sphere | geodesic ball | exact, closed form | closed form (quadratic in e^t / one atan2) | yes |
| plane | totally geodesic plane (a linear hyperplane in R⁴). In S³ it is a compact great sphere. | exact | closed form | yes |
| disk | geodesic disk in such a plane | thin (none) | plane hit + one compare | yes |
| quad | geodesic "rectangle": the plane cut by two slabs (a Klein/gnomonic rectangle) | thin | plane hit + two compares | yes (needed for quad lights) |
| box | three slabs (a Klein/gnomonic box); dihedral angles ≠ π/2 | exact inside, conservative outside | H³: slab method in τ=tanh t; S³: candidate roots | cheap option (tier 2) |
| cylinder | capped tube about a geodesic segment | exact inside, conservative outside | candidate roots (tube: quadratic in e^{2t} / double angle; caps: plane roots) | cheap option (tier 2) |
| torus | tube about a circle (equidistant surface) | exact | marched (as in E³), with an analytic normal | cheap option (tier 2); its bound differs per space |
| menger, apollonian, bottle, knob, defineSDF fields | no intrinsic meaning | — | — | compile error. Chart embedding is a recorded option (§5). |

## 1. Ball (sphere)

SDF. H³: `asinh(length(p.xyz)) − R`; S³: `atan(length(p.xyz), p.w) − R`. Both are exact [math].
They are stable near the surface. Near-surface error in f32, R=0.01: acosh(w)−R is off by 6.7e-6,
asinh(|P|)−R by 1.5e-7. For S³, acos(w)−R is off by 3.3e-6 and atan(|P|,w)−R by 1.9e-9.
[checked-num ball.ts §3, which emulates GLSL's asinh/acosh formulas]

Closed form, H³. Let a=p.w, b=v.w, x=eᵗ. Then w(t)=cosh R becomes (a+b)x² − 2cosh R·x + (a−b) = 0.
Two identities [math] make it cancellation-free:
- Discriminant: (cosh R)² − (a²−b²) = sinh²R − |P×V|², where P = p.xyz, V = v.xyz.
  Here |P×V|² = |P|² − b² = sinh²(dist(O, ray geodesic)), the H³ version of Haines' perpendicular
  form.
- (a+b)(a−b) = 1 + |P×V|². So a+b and a−b can each be formed from a + |b| without cancellation.

Results:
- f64 against brute force: 600 rays, 0 hit/miss mismatches, max |Δt| 1e-11. [checked-num ball.ts §1]

S3 closed form: w(t) = A cos(t−φ), φ = atan2(v.w, p.w). Entry is at φ−α and exit at φ+α (mod 2π), where
α = atan2(√(sin²R − |P×V|²), cos R). [math]
- f64 against brute force: 600 rays, 0 mismatches, max |Δt| 9e-16. [checked-num ball.ts §1]

Sketches. These are not compiled GLSL; their TS twins were tested.
```glsl
// H³
bool ball_intersect(vec4 p, vec4 v, float R, out float t) {
    vec3 c = cross(p.xyz, v.xyz); float k = dot(c, c);          // sinh²(dist(O, line))
    float sr = sinh(R), D = sr * sr - k;  if (D < 0.0) return false;
    float s = p.w + abs(v.w), o = (1.0 + k) / s;                 // (p.w+v.w)(p.w−v.w) = 1+k
    float apb = v.w >= 0.0 ? s : o, amb = v.w >= 0.0 ? o : s;
    float q = cosh(R) + sqrt(D);
    t = log(dot(p.xyz, p.xyz) < sr * sr ? q / apb : amb / q);   // inside → exit root
    return t > 0.0;
}
// S³
bool ball_intersect(vec4 p, vec4 v, float R, out float t) {
    vec3 c = cross(p.xyz, v.xyz); float D = sin(R) * sin(R) - dot(c, c);
    if (D < 0.0) return false;
    float phi = atan(v.w, p.w), al = atan(sqrt(D), cos(R));
    t = mod(atan(length(p.xyz), p.w) < R ? phi + al : phi - al, TWO_PI);
    return t > 0.0;
}
```

Float32, H³, grazing rays at 0.9–1.1× the silhouette angle (the worst case). The robust form is at the
input-rounding floor: f64 evaluation on the same f32-rounded inputs gives the same errors. The
naive form is far worse for small balls. For example, at R=0.01 and camera distance Dc=3 the naive
form gets 24.7% of rays wrong and the robust form 0.13%. [checked-num ball.ts §2]

Floor of the 4-vector ray in the object frame. At ray-origin-to-object distance d, the wrong-
classification rate among grazing rays was:

| R | d | wrong |
|---|---|---|
| 0.1 | 3 | 0% |
| 0.1 | 6 | 3.4% |
| 0.1 | 9 | 50% |
| 0.01 | 3 | 0.13% |
| 0.01 | 6 | 25% |

Rough model [math]: v's components are about cosh d in size, so the line's distance to O is resolved
only to about ε·e^{2d}/4 (in sinh units). S³ has no such growth, because it is compact. [checked-num ball.ts §2]

MEASUREMENT RELEVANT TO DECISION 9(1). This is one case only, not a recommendation.
`frame_precision.ts` compares two placements for an H³ ball, with the ray origin exactly at the frame
origin:
- (B) the owner's object-frame body: the ray is transformed by the object's inverse boost in f32.
- (C) the same robust formula with the ball center folded into the ray-origin frame.

| R | d | object frame wrong / err/R | ray-origin frame wrong / err/R |
|---|---|---|---|
| 0.1 | 4 | 0.05% / 1.2e-2 | 0.03% / 3.8e-4 |
| 0.1 | 6 | 3.4% / 0.16 | 0% / 6.6e-3 |
| 0.1 | 8 | 46% | 0.23% |
| 0.01 | 6 | 29% | 0.15% |

Not tested:
- secondary rays whose origin is far from the frame origin (where (C) would also degrade);
- oriented shapes.

The decision's stated rationale ("object frame keeps float32 best") should be re-examined with
this in hand. The local-frame bodies above are the same formulas in either frame.

## 2. Plane

In the local frame the plane passes through O with normal e_y. ⟨p,N⟩ = p.y in both spaces.
A general plane is one spacelike unit 4-vector N. For the plane at signed distance s along n:
N = (cosh s·n, sinh s) in H³ and (cos s·n, −sin s) in S³ [math]. So normal+offset can be folded
into N, or into the isometry.

- SDF. H³: `asinh(p.y)`; S³: `asin(p.y)`. Both exact. Compared with brute-force distance:
  max diff 2.6e-4 in H³ (limited by the brute-force sampling) and 6e-8 in S³. [checked-num shapes.ts]
- In GLSL write `sign(x)*asinh(abs(x))`. GLSL ES 3.00 precision for asinh is "inherited from" the
  formula log(x+√(x²+1)) [mem]. In f32 that formula gives −7.6246 at x=−1000 (exact −7.6009) and
  −Inf at x=−1e4. The symmetric form is exact. [checked-num asinh_neg.ts]
- Intersect, H³. Let P=⟨p,N⟩ and W=⟨v,N⟩. Then e^{2t} = (W−P)/(W+P); there is a hit iff that is > 1.
  This is one log, with no atanh needed [math].
- Intersect, S³: t = mod(atan(−P, W), π), with 2 roots per 2π. Every ray hits every S³ plane within
  π [math].
- Brute force: H³ 165 hits and S³ 400 hits, 0 mismatches, max |Δt| 9e-15. [checked-num shapes.ts]
- Normal: the projection of N onto T_q. H³: N + ⟨N,q⟩q; S³: N − ⟨N,q⟩q [math].
- In S³ the "unbounded" plane is compact. It still needs no bound, because the far limit 2π ends
  the ray [math].

## 3. Disk and quad

Disk of geodesic radius ρ: hit the plane, then test `dot(h.xyz,h.xyz) <= sinh²ρ` (H³) or
`atan(length(h.xyz), h.w) <= ρ` (S³).
- Area: 2π(cosh ρ−1) (H³) and 2π(1−cos ρ) (S³). Monte Carlo with the chart density matches:
  4.1951 vs 4.2004 in H³ and 3.4330 vs 3.4332 in S³. [checked-num shapes.ts]
- Uniform-area radius sampling (for disk lights): cosh r = 1+u(cosh ρ−1) in H³, cos r = 1−u(1−cos ρ)
  in S³ [math; inverse CDF of the area above, not sampled].

Quad. A Euclidean parallelogram (corner, edge1, edge2) has no curved counterpart that keeps its
meaning.

The natural piece is the plane cut by two slabs, with half-widths a and b equal to the distances from
the center to the sides. In the Klein/gnomonic chart of the plane this is exactly the rectangle
|k_x| ≤ tanh a, |k_z| ≤ tanh b (tan in S³). Its edges are geodesic segments: the residual on a
geodesic between corners is 1e-16 [checked-num shapes.ts].
- Membership: `abs(h.x) <= tanh(a)*h.w && abs(h.z) <= tanh(b)*h.w`.
- Corner angle: cos α = sinh a·sinh b in H³ (acute), −sin a·sin b in S³ (obtuse).
  Measured 0.969859 = 0.969859 (H³) and 1.987830 = 1.987830 (S³).
- Area by Gauss–Bonnet: 2π−4α (H³) and 4α−2π (S³). Monte Carlo agrees to 2e-3. [checked-num shapes.ts]
- Validation fact: H³ needs sinh a·sinh b < 1, otherwise the corners are ideal or beyond and the
  piece is not compact [math].
- So "quad" in curved spaces = this rectangle, with the struct holding (a, b). That differs from the
  E³ parameter rows. This is a design point for the owner.

Light sampling (lights topic, flagged): uniform sampling in the chart rectangle has an exact pdf with
respect to area: (1−|k|²)^{3/2} / (4 tanh a tanh b) in H³ and (1+|k|²)^{3/2}/(4 tan a tan b) in S³.
- The area density was checked through the MC areas above. [checked-num]
- The sampling is not uniform in area, so it adds variance.

## 4. Box, cylinder, torus (cheap natural meanings)

Box = three slabs |k_i| ≤ tanh h_i (Klein) or tan h_i (gnomonic). Face normals:
N = (±cosh h·e_i, sinh h) in H³ and (±cos h·e_i, −sin h) in S³. The dihedral angle has
cos = sinh h_i sinh h_j in H³ [math]. So this is a "box" only in its combinatorics.
- Validation, H³: Σ tanh²h_i < 1, otherwise the corners leave H³ [math].
- SDF = max over the 6 faces of asinh/asin(⟨p,N⟩). Exact inside, and never overestimates outside:
  max overestimate 0 over 40 points with brute-force face distances. [checked-num shapes.ts]
- H³ intersect: the slab method in τ = tanh t, which is monotone in t. Each face gives a linear
  inequality in τ, and t = atanh(τ) at the end. 0 mismatches, max |Δt| 2e-15. [checked-num]
- S³: τ = tan t is monotone only within half a period. The tested route is candidate roots:
  2 roots per face per 2π, kept if the point is inside the other 4 faces; the smallest wins.
  0 mismatches, 9e-16 vs brute force. [checked-num]

Cylinder = capped tube about the y-axis geodesic.
- Radial distance: H³ `asinh(length(p.xz))`; S³ `atan(length(p.xz), length(p.yw))`. Both exact.
  This is the same as thurston-rebuild's `acosh(√(w²−y²))` (identity sinh²ρ = p_x²+p_z²) but stable.
  Brute-force check: diff 2e-4, limited by the scan. [math; checked-num shapes.ts]
- Cap term: `asinh(|p.y| cosh h − p.w sinh h)` in H³; `asin(|p.y| cos h − p.w sin h)` in S³.
- SDF = max(radial − r, cap). It never overestimates (max 0) and is exact inside (1e-9).
  [checked-num shapes.ts]
- The E³ "exact everywhere" corner term `length(max(d,0))` does not carry over: Fermi coordinates are
  not a product metric. |∇s| = 1/cosh ρ in H³ and 1/cos ρ in S³ [math].
- Intersect by candidate roots: the boundary of A∩B is (∂A∩B) ∪ (∂B∩A).
  - Tube, H³: with y = e^{2t}, αy² + (2β−sinh²r)y + γ = 0, where
    α=|P+V|²/4, β=(|P|²−|V|²)/4, γ=|P−V|²/4 over the xz components.
  - Tube, S³: M + A·cos(2t−ψ) = sin²r, so 4 roots per 2π.
  - Caps: plane roots.
  - Results: H³ 225 hits and S³ 348 hits, 0 mismatches, |Δt| ≤ 2e-15. [checked-num shapes.ts]
  - f32 robustness of the tube quadratic was NOT tested.
- S³ needs r, h < π/2 [math].

Torus = tube of radius r about the circle of radius R in the xz plane.
- The nearest circle point to p is c = (sinh R·ê, 0, cosh R) with ê = p.xz/|p.xz| (sin/cos in S³), so
  the SDF is exact:
  - H³: `2*asinh(sqrt(<p−c,p−c>_M)/2) − r`. Algebraically the same as acosh(p.w cosh R − sinh R|p.xz|) − r.
  - S³: `2*asin(length(p−c)/2) − r`.
  - Against brute force: 3e-7 (H³) and 1e-7 (S³). [checked-num shapes.ts]
- Use the chord form. At r=0.01 in f32, the acosh form is off by 4.6e-3·r and the chord form by
  6.8e-5·r (H³); in S³, 1.7e-3·r vs 7.8e-6·r. [checked-num shapes.ts]
- Analytic normal: the unit tangent at q pointing away from c, which is exact. Use it instead of the
  FD normal. [math; used as ground truth in march.ts]
- MARCH BOUND DIFFERS PER SPACE. The E³ bound is a cylinder of radius R+r and half-height r
  [checked-code src/components/geometry/torus/torus.ts:24-30].
  - In H³ it is valid but loose. The tight half-height is asinh(sinh r / cosh R): 0 points outside.
  - In S³ it is INVALID: 13655 of 40000 solid-torus points fall outside at R=1, r=0.3.
    The correct half-height is asin(sin r / cos R): 0 points outside. It exists only if R + r < π/2.
  - [checked-num torus_bound.ts]
  - Cause: the axial coordinate expands in S³ (|∇s| = 1/cos ρ) [math].

## 5. Menger, apollonian, bottle, knob (and defineSDF fields)

These have no intrinsic curved meaning. One option exists: evaluate the Euclidean field on chart
coordinates, f_E(φ(p))/L.
- Theorem [math]: if |dφ| ≤ L on a geodesically convex region containing the point, the surface and
  the march, then f_E(φ(p)) ≤ dist_E(φ(p), φ(Surf)) ≤ L·dist(p, Surf).
- Measured operator-norm ranges of |dφ| within radius ρ [checked-num lipschitz.ts]:

| Chart | Range of \|dφ\| | Max checked |
|---|---|---|
| H³ Klein | [1/cosh²ρ, 1] | L = 1 globally |
| H³ exp map | [ρ/sinh ρ, 1] | L = 1 |
| H³ 2×Poincaré (conformal) | [1/cosh²(ρ/2), 1] | L = 1 |
| S³ gnomonic | [1, sec²ρ] | ρ < π/2 only (blows up past π/2) |
| S³ exp map | [1, ρ/sin ρ] | — |
| S³ 2×stereographic (conformal) | [1, sec²(ρ/2)] | — |

- Direct check: a Euclidean box field in the chart, divided by L, never exceeded the true distance to
  its preimage (ρ=1.2).
- The worst-case step efficiency (|f|/dist) was:

| Chart | Step efficiency |
|---|---|
| Klein | 0.39 |
| 2×Poincaré | 0.79 |
| gnomonic | 0.14 |
| 2×stereographic | 0.21 |

- Cost and meaning [math]:
  - The shape is "the preimage of the Euclidean shape under a declared chart", so the chart becomes a
    declared modeling choice. Klein keeps flat faces totally geodesic; Poincaré keeps angles.
  - Accepting at f < ε means a true residual up to ε/(min ratio).
  - The marching gets slower as objects grow.
  - It needs a declared chart and a region radius.
- Recommendation: compile errors in the first subset; record this as the cheapest later route.
  It is one generic wrapper with no per-shape work.
- `defineSDF` scene-local fields are vec3 GLSL [checked-code src/components/geometry/custom.ts:75].
  They are a compile error in curved spaces unless authored per space.

## 6. Marching and normals

Sphere tracing re-flowed from the seed (p(t) = flow(p₀,v₀,t)) with exact fields, eps 1e-4, 3000 rays
filling the bound cone. Mean steps for hits / misses [checked-num march.ts]:

| Shape | E³ | H³ | S³ |
|---|---|---|---|
| ball R=0.5 at d=2.5 | 10.3 / 16.6 | 10.2 / 16.1 | 11.6 / 17.9 |
| torus R=0.8, r=0.25 | 11.3 / 9.6 | 9.9 / 7.8 | 12.4 / 20.1 |

- No ray hit the 2048 cap.
- S³ misses marched to 2π: mean 15 steps, max 254 (under MAX_MARCH_STEPS = 512).
  [checked-code src/glsl/core/march.glsl:12]
- Marched hits are within 7e-3 of the closed form. That is grazing-ray behavior at eps 1e-4
  (≈ √(2R·eps)), as in E³ [math; E³ not measured].
- Flag [math]: `march_epsilon(t)` grows like 1+t, a Euclidean pixel-footprint model
  [checked-code src/glsl/core/march.glsl:20]. The footprint grows like sinh t in H³ and like |sin t|
  in S³, where it shrinks near the antipode. The cap of 5e-4 limits the effect.

FD normal: 4 taps along an orthonormal tangent frame at q, compared with the analytic torus normal.
- Exp-map taps and plain linear taps q + h·k (off the manifold, chord-form field) give the same error.
  The error is 1.5e-3 rad at h = 1e-3 and 1.5e-4 at h = 1e-4. f32 at h = 1e-3 gives 1.6e-3.
  [checked-num march.ts]
- So no cosh/sinh per tap is needed, but a tangent frame at q is.
- The error is first order in h in E³ too. The tetrahedral stencil's third moments Σk_xk_yk_z ≠ 0.
  In E³ the central 6-tap gives 2.2e-6 at h = 1e-3, against 1.5e-3 for the 4-tap.
  [checked-num tetra_e3.ts]
- Side finding: the comment "same order of accuracy" at src/components/geometry/index.ts:336 is false.
  [checked-code + checked-num]
- All the native primitives above have closed-form normals, so the FD normal is needed only for
  marched fields.

## 7. Machinery this adds (flagged; the owner wants few moving parts)

1. Per-space GLSL per primitive. Today `PrimitiveDescriptor` has one `glsl: string`
   [checked-code src/components/descriptors.ts:108]. The simplest scheme: a per-space body map whose
   presence declares support, and absence is a compile error naming the shape and space. This doubles
   as the "who implements what" table.
2. Per-space parameter rows. Curved structs hold only intrinsic sizes (R; a,b; r,h; R,r) and
   position/orientation go into the isometry.
   - E³ `center` and plane `offset` become part of the placement.
   - quad changes from (corner, edge1, edge2) to (a, b): a different row set.
3. Per-space march bound parameters (the torus). A descriptor's `marchBound.values` is E³-only today.
4. Per-space validation facts:

| Space | Fact |
|---|---|
| H³ | box Σtanh² < 1 |
| H³ | quad sinh a sinh b < 1 |
| S³ | radius/height < π/2 (cylinder, box via tan) |
| S³ | torus bound needs R + r < π/2 |

5. The candidate-roots intersection (∂A∩B ∪ ∂B∩A) works the same in all three spaces. It replaces
   per-space interval logic for the cylinder and the S³ box: one pattern, fewer special cases.
6. March and normal generation must go through the seam (flow and tangent frame). Today the generated
   march uses `ray.origin + t * ray.direction` [checked-code src/components/geometry/index.ts:234].

## 8. H²×R (brief, all [math], nothing checked)

| Shape | H²×R |
|---|---|
| Ball | Exact SDF √(d_H²² + Δz²) − R. The intersection is transcendental (acosh² + linear²), so it is marched. |
| Plane | Only horizontal (H²×{z}: linear in t) and vertical (geodesic × R: e^{2at} form) planes are totally geodesic. Tilted planes do not exist. |
| Disk, quad | Horizontal ones are H² pieces at fixed z, hit linearly in t. |
| Cylinder | The vertical cylinder (H² circle × interval) is closed form: a quadratic in e^{2at} plus linear caps. A tube about a horizontal geodesic is not. |
| Box | Klein rectangle × interval; closed form by per-face roots. |
| Torus about a horizontal circle | SDF = length(vec2(d_H²(p,o) − R, z)) − r, exact and the E³ form. |
| Chart embedding | (H² Klein) × id has L = 1. |
