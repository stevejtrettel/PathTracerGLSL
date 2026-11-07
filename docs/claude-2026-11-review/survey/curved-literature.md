# Curved-space light transport: literature survey and per-geometry reference

Read-only survey, 2026-11-06. Area: physically based path tracing in non-Euclidean spaces
(E³, S³, H³, H²×R, S²×R), mapped onto this repo's `ambient_*` seam.

Confidence labels used throughout:
- **[V-src]** verified in the fetched source text (quote or close paraphrase of fetched text).
- **[V-num]** verified by my own numeric check (scripts in
  /private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/scripts/
  `check.py`, `pt.py`, `eq.py`; numpy, float64 unless stated).
- **[V-code]** verified by reading code (this repo or ~/Code/thurston-rebuild).
- **[mem]** from memory / standard differential geometry, not re-verified here.
- **[TT]** my own reasoning, thought through, not checked against a source or code.

---

## 0. Two-minute summary

1. The only source that does the radiometry correctly is Coulon–Matsumoto–Segerman–Trettel
   (the owner's own paper). Its §5.7 states the one fact a curved-space NEE needs: point-light
   intensity is `I_light / A(t,u)`, where `A` is the **area density of geodesic spheres**
   (= ‖J_v(t) ∧ J_w(t)‖, Jacobi fields with J(0)=0, J'(0)=v,w). A = r² (E³), sin² r (S³),
   sinh² r (H³), r·sinh(r sin β)/sin β (H²×R), r·sin(r sin β)/sin β (S²×R), β = angle from
   vertical. **[V-src]** and **[V-num]** (finite-difference Jacobian of exp matches all of
   E³/S³/H³/H²×R formulas to 1e-11).
2. In NEE that means: everywhere this repo writes `d2` (r²) in an area→solid-angle pdf
   conversion or a point-light falloff, the curved occupant needs `A(r,u)`. Radiance itself is
   constant along geodesics in vacuum (Liouville / étendue) **[mem]**; Coulon's `I·A independent
   of t` is the point-light corollary **[V-src]**.
3. Two-point geodesics: unique in E³, H³, H²×R; **two** in S³ (θ and 2π−θ, same sin² falloff,
   uncountably many at antipodes); **countably many** in S²×R; one per group element in
   quotients. **[V-src]** (Coulon §7–8). The repo's `ambient_direction_to` returns exactly one
   direction — fine for E³/H³/H²×R, a declared truncation (or a loop) for S³.
4. Projective charts make geodesics straight: Klein for H³, gnomonic (hemisphere) for S³. Then
   geodesic triangles are flat triangles, AABB-BVHs and Möller–Trumbore work unchanged in chart
   coordinates, and the ray parameter maps by `tanh t` (H³) / `tan t` (S³). **[V-num]** for
   straightness and for the `tanh t = −⟨n,p⟩/⟨n,v⟩` plane hit. **Not** true for H²×R in Klein×R
   (geodesics are curved there) **[TT, derivation in §6]**.
5. New results found while checking (not in the literature I read): equiangular medium
   sampling carries over to H³ and S³ in closed form (`tan θ = tanh τ / sinh h`, resp.
   `tan τ / sin h`) **[V-num]**; solid-angle sampling of polygonal/spherical lights in H³/S³ can
   reuse the Euclidean samplers in the Klein/gnomonic chart **centered at the shading point**
   (chart is direction-preserving at its center) **[TT, half V-num]**; the H³ environment lookup
   is the ideal point `(p+v).xyz/(p+v).w`, already a unit vector **[TT, derivation]**.
6. Precision (float32): Klein coordinates collapse at hyperbolic distance ≈ 9 (1−tanh d below
   float ulp); hyperboloid coordinates resolve 1e-3 separations only to ~6 % at d=5 and not at
   all at d=10; `acosh(−⟨p,q⟩)` is unusable for small distances anywhere — use
   `2·asinh(√⟨p−q,p−q⟩ / 2)`. **[V-num]** Celińska-Kopczyńska & Kopczyński (ICCS 2024) is the
   systematic study (double precision only) **[V-src]**.
7. Kopczyński: in exponentially expanding spaces "a single light will illuminate only a small
   volume", so realistic H³ scenes need very many lights **[V-src]** — the light tree matters
   more in H³ than in E³, and its bounds use Euclidean r² today **[TT]**.
8. Novello–da Silva–Velho (C&G 2020) extend the rendering equation only by swapping the dot
   product for the metric (their Eq. 2.4); no Jacobian/geometry term, point-light shadow rays
   only **[V-src]**. Not a reference for the radiometry.
9. GR renderers (Mandal–Ayush–Chaudhuri 2021) do pure BSDF-sampled MC with RK4 and step-halving
   intersection; no NEE, no radiance invariance discussion **[V-src]**. This repo's GRIN walker
   (symplectic Verlet, L/n² invariant) is already more careful **[V-code]**.

---

## 1. Sources read

| Source | URL | What I read | Status |
|---|---|---|---|
| Coulon, Matsumoto, Segerman, Trettel, *Ray-marching Thurston geometries*, Exp. Math. 31(4) 2022, arXiv 2010.15801 | https://arxiv.org/abs/2010.15801 ; HTML https://ar5iv.labs.arxiv.org/html/2010.15801 | chars 0–200 000 of the ar5iv HTML via WebFetch (§1–8 incl. §2 SDF/underestimators, §4 teleport/creeping, §5.7 intensity, §7 S³/H³, §8 S²×E, H²×E). Last 28k chars (Nil/SL2/appendix) not read. | [V-src] for the items marked |
| Kopczyński & Celińska-Kopczyńska, *Real-time visualization in non-isotropic geometries* (Exp. Math. 2022 as "…Anisotropic…"), arXiv 2002.09533 | https://arxiv.org/abs/2002.09533 | full PDF text via pdftotext; read §3.3.1 (H²×R, S²×R), §4.2 (ray-based validation), §5 (discussion, lighting, precision) | [V-src] |
| Celińska-Kopczyńska & Kopczyński, *Numerical Aspects of Hyperbolic Geometry*, ICCS 2024, arXiv 2404.09039 | https://arxiv.org/html/2404.09039v1 | WebFetch summary of HTML | [V-src] (summary level) |
| Novello, da Silva, Velho, *Global illumination of non-Euclidean spaces*, Computers & Graphics 93 (2020) 61–70; SIBGRAPI 2020; arXiv 2003.11133 | https://arxiv.org/abs/2003.11133 ; https://ar5iv.arxiv.org/html/2003.11133 | full ar5iv HTML via WebFetch | [V-src] |
| Novello, da Silva, Velho, *Visualizing Thurston's geometries* (book, 2021; Poincaré sphere, Seifert–Weber, RTX) | https://coloquio33.impa.br/pdf/33CBM19-eBook-preview.pdf | search-result summary only | not read |
| Mandal, Ayush, Chaudhuri, *Non-linear Monte Carlo Ray Tracing for Visualizing Warped Spacetime*, VISIGRAPP 2021 (expands SIGGRAPH 2017 poster "Rendering Curved Spacetime in Everyday Scenes") | https://www.scitepress.org/Papers/2021/102176/pdf/index.html | full HTML via WebFetch | [V-src] |
| 3-dimensional.space (project site; PT mode "not real time", soft shadows/refraction) | https://3-dimensional.space/ | home page | [V-src] |
| Weeks, *Real-time rendering in curved spaces*, IEEE CG&A 22(6) 2002 | (no URL fetched) | — | [mem]: projective 4×4 pipeline, Klein/gnomonic, fog as depth cue |
| Gunn, PhD thesis (Cayley–Klein / PGA, metric-neutral) | https://www.doi.org/10.14279/DEPOSITONCE-3058 ; https://arxiv.org/pdf/1307.2917 | search summary only | not read |
| clay-hyper (Rust/OpenCL hyperbolic path tracer) | https://lib.rs/crates/clay-hyper | search summary only | not read |
| Satoh, *Symplectic Ray Tracing* (SIGGRAPH 2001 sketch) | https://history.siggraph.org/?p=146301 | search summary only | not read |

Not found: any paper doing **NEE/MIS with area lights in H³ or S³**, any **BVH over triangle
meshes in H³**, any paper on **light trees in curved space**. Two targeted searches came up empty
(not an exhaustive literature review — say "I did not find", not "does not exist").

---

## 2. What each source contributes

### 2.1 Coulon–Matsumoto–Segerman–Trettel (the owner's paper) [V-src]
- **SDFs** (Def. 2.1): σ(p) = radius of the largest ball centered at p disjoint from S.
  **Distance underestimator** (Def. 2.4): same sign as σ, |σ′| ≤ |σ|, zero only where σ is;
  Lemma 2.5: marching with σ′ limits to the same point. This is the Riemannian sphere-tracing
  contract and it is metric-agnostic.
- **Quotients**: teleport across Dirichlet-domain faces (§4.1.1) or projective half-space tests
  "v ∈ H iff φ(v) ≥ 1" (§4.1.2); **creeping** (§4.2.1): step by min(σ, distance to ∂D) + ε; or
  σ_A = min over {id} ∪ {γᵢ^±} of σ∘a (§4.2.2).
- **Models**: S³, H³, S²×R, H²×R handled in "projective models where you divide by the fourth
  coordinate"; geodesics are straight lines in the projective models of the *isotropic*
  geometries (§2.3.1, §4.1.2).
- **Precision** (§2.4.1): coordinates grow exponentially in H³, H²×E, Sol, SL2; rewrite
  unstable formulas (e.g. (1−cos t)/t² by its series). Remark 4.1: in a quotient the base point
  stays in D so coordinates stay bounded.
- **Lighting** (§5.7, eqs 5.7–5.13): I(t,u) = I_light/A(t,u); A = Jacobian of f_t(u)=exp(tu) on
  the unit sphere = ‖J_v ∧ J_w‖. Fog: I = e^{−K d} I_light / A.
- **Lighting pairs** ℒ_s(q): all (direction, length) of geodesics from s to q; in a quotient
  ⋃_γ ℒ(γ q). "May be a singleton, finite, countably infinite, or uncountably infinite"; in
  practice only short ones or only the shortest are kept.
- **S³** (§7.2): unit sphere in R⁴, cos d = ⟨p,q⟩, γ(t) = cos t p + sin t v. SDFs: ball
  arccos(w) − r; cylinder about cos t o + sin t e_z: arccos(√(w²+z²)) − r; half-space z ≤ 0:
  arcsin(z). Two geodesics to a light: lengths θ and 2π−θ. Antipodal: GPU "just gives up".
- **H³** (§7.3): hyperboloid ⟨p,p⟩ = −1, cosh d = −⟨p,q⟩, γ(t) = cosh t p + sinh t v. SDFs: ball
  arccosh(w) − r; cylinder arccosh(√(w²−z²)) − r; half-space arcsinh(z). Unique geodesics.
- **S²×E / H²×E** (§8): product distance d² = d_Y² + Δw²; γ(t) = (γ_Y(|v_Y| t), w + t v_E);
  vertical objects have σ = d_Y(π(p), U); A = r·sin(r sin β)/sin β, resp. r·sinh(r sin β)/sin β
  (curvature of the plane at angle β is ±sin²β). S²×E has countably many geodesics; intensity
  periodically blows up (refocusing). H²×E: unique, "falls off exponentially away from the E
  direction".
- Normals: central finite differences (§5.5.4).

### 2.2 Kopczyński & Celińska-Kopczyńska [V-src, pdftotext lines cited]
- Primitive-based (rasterize via inverse exp per vertex) and ray-based (cell-by-cell through a
  honeycomb, closed-form plane hits in isotropic/product spaces; RK4 + bisection in Solv,
  u = 0.05, ε = 0.001) renderers agree "modulo multiple geodesics" (lines 2236–2256).
- S²×R: "The light ray goes around the sphere k times before hitting our prism"; triangles near
  the camera's poles/antipode become rings and must be subdivided (lines 1441–1444).
- Lighting deliberately skipped: "in exponentially expanding geometries such as H3, a single
  light will illuminate only a small volume … we cannot assume that the light comes from a
  infinitely far away sun" (lines 2281–2285).
- Precision: "representations based on floating point coordinates are very prone to precision
  errors"; they store positions as tessellation cell + local coordinates (lines 313–314,
  2322–2323).
- Isotropic ray-based VR perceives "stretched Klein/gnomonic projection" (line 2308).

### 2.3 Celińska-Kopczyńska & Kopczyński, ICCS 2024 [V-src summary]
- Double precision only; failure criterion error > 0.1. Klein: gap from 1 ~ e^{−2d} —
  "Floating point numbers cannot express such a slight difference from 1." Poincaré ~ e^{−d}
  (≈ twice the usable range). Hyperboloid ("invariant linear") recovers large distances "as long
  as cosh(x) fits". Polar and half-space representations are best. Tile + local coordinates
  avoids loss for far points. Renormalize linear representations.

### 2.4 Novello, da Silva, Velho [V-src]
- Riemannian rendering equation (Eq. 2.4) = Kajiya with ⟨·,·⟩ → g_p. dω never redefined; no
  Jacobian, no geometry term, no solid-angle/area conversion. Direct light = point lights with
  binary shadow rays. Rendered: flat 3-torus, mirrored right-angled dodecahedron in H³. RTX,
  miss shader teleports rays. Radiance constancy along geodesics *assumed*.
- Use it for the RTX/teleport architecture, not for radiometry.

### 2.5 Mandal, Ayush, Chaudhuri (GR) [V-src]
- RK4 geodesics; intersection by stepping until a sign change, then step-halving to 1e-10.
  No NEE / two-point BVP; "very few ray samples make it through the wormhole back to the light".
  Conserved quantities monitored; 80–250 min per 1024×768 frame. No redshift/I/ν³ for their
  own renderer.

### 2.6 The owner's old repo ~/Code/thurston-rebuild [V-code]
- `src/geometries/{hyp,sph,h2e,s2e,euc,nil,sol,sl2}/` with `geometry/shaders/part1.glsl`
  (Isometry as mat4, Point as vec4, Vector = (Point, vec4 dir), `flow(Vector, t)` returning
  **both position and velocity**, `reduceError` renormalization), `imports/distance.glsl`,
  `imports/direction.glsl` (log map), `imports/lightIntensity.glsl`.
- hyp `flow`: `coords = cosh(t)·pos + sinh(t)·dir; dir = sinh(t)·pos + cosh(t)·dir;` then
  reduceError + geomNormalize (hyp part1.glsl ~L240–248).
- hyp `direction(p,q)`: `(q + c p)/sqrt(c²−1)` with c = ⟨p,q⟩_M (= −cosh d) — the unit log map.
- **Light falloff in the old repo is artistic, not physical**: hyp `lightIntensity` returns
  `1/(len*len)` (the sinh² line commented out); `trueLightIntensity` (separate file) returns
  `1/sinh²`; sph returns `1/len`; h2e returns `1/len`. The PT renderer
  (`core/renderers/shaders/pathTracer/`) has **no light sampling at all** — BSDF-sampled paths
  that hit emitters, with a "hack to make sure that lights are not too bright"
  (vectorDataUpdate.glsl.mustache:97). So porting geometry from thurston-rebuild is fine; porting
  its lighting is not.
- Reusable for a port: exp/log/distance/isometry/frame code for H³, S³, H²×R, S²×R; the quotient
  (teleportation) machinery; SDF solid library per geometry (`solids/` Ball, Cylinder, HalfSpace,
  Horoball, CliffordTorus…).

---

## 3. Radiometry on a Riemannian manifold (what an unbiased NEE needs)

1. **Radiance invariance**: in vacuum, L is constant along geodesics. Reason: the geodesic flow
   on the unit tangent bundle preserves the Liouville measure (symplectic volume), which is the
   étendue measure dA⊥ dω **[mem]**. With an index field it is L/n² (the repo's GRIN walker uses
   exactly this, `(n_in/n_out)²` **[V-code grin.md]**).
2. **Measure conversion** (area ↔ solid angle) at a receiver x for a surface point y at
   geodesic distance r reached with initial unit direction u:
   `dω_x = |cos θ_y| dA_y / A(r, u)` where A is the area density of the exponential map at x.
   [Coulon eq. 5.9 for A; the conversion is the standard derivation with r² → A **[TT]**.]
   Geometry term: `G(x,y) = |cos θ_x| |cos θ_y| / A(r,u)`.
3. **Reciprocity**: A(x→y) and A(y→x) agree in E³, S³, H³ (A depends on r only) and in H²×R /
   S²×R (β is preserved along product geodesics and r is symmetric) **[TT]**. In general
   manifolds the symmetric quantity is the van Vleck–Morette determinant **[mem]**. MIS weights
   need both pdfs in the same measure, so this matters for pt-mis.
4. **Point lights**: radiance/irradiance from a point light of intensity I is `I / A(r,u)`
   (Coulon eq. 5.7). Spot/beam profiles are functions of the emission direction at the light,
   which is the reversed velocity of the geodesic at the light (needs the velocity output).
5. **Directional light ("sun")**: no analog in S³ (compact). In H³ an ideal point light is the
   natural analog; its flux is conserved through horospheres, whose area scales e^{−2t} moving
   toward the ideal point, so irradiance is ∝ e^{2t}·const along that direction **[TT]**.
   Kopczyński's warning applies.
6. **Media**: Beer–Lambert is in arc length, so homogeneous transmittance is unchanged
   (`exp(−σ t)`, t = geodesic arc length) **[TT]**; delta tracking is unchanged given the
   exp map. The free-flight sampling is metric-independent once t is arc length.
7. **Equiangular sampling** (new; **[V-num]** eq.py): light at geodesic distance h from the
   ray, foot at τ = 0.
   - H³: cosh d(τ) = cosh h cosh τ; ∫ dτ / sinh² d = (1/sinh h)·[atan(tanh τ / sinh h)];
     the angle at the light is exactly atan(tanh τ / sinh h) (checked geometrically).
   - S³: cos d = cos h cos τ; ∫ dτ / sin² d = (1/sin h)·[atan(tan τ / sin h)] (|τ| < π/2 per
     piece).
   - So equiangular sampling is "uniform in the angle at the light" in all three isotropic
     spaces; the curved body is a 2-line change (tanh/sinh). The ambient README's claim that
     equiangular placement needs a new body is correct, but the body is tiny.
8. **Solid-angle samplers** (sphere/cone, spherical triangle/rectangle): after moving the
   shading point x to the origin by an isometry, the Klein (H³) or gnomonic (S³) chart centered
   at x preserves directions at x (log at origin of q is q.xyz normalized = Klein point
   normalized — trivially checked), and geodesic polygons are flat polygons there. So the
   solid angle subtended by a geodesic triangle equals that of the Euclidean chart triangle and
   the existing Euclidean spherical-triangle / cone samplers apply verbatim in the chart
   **[TT; the two ingredients are V-num / trivial]**. Cone half-angle of a geodesic ball of
   radius R at distance d: sin α = sinh R / sinh d (H³), sin R / sin d (S³) (right-triangle
   trig sin A = sinh a / sinh c) **[mem]**.
   H²×R/S²×R are not isotropic: no such chart; area sampling with the A(r,u) above.

---

## 4. Per-geometry reference

Notation: ⟨·,·⟩_M = x₁y₁+x₂y₂+x₃y₃−x₄y₄ (Minkowski), ⟨·,·⟩ Euclidean in R⁴.

### E³
- exp: p + t v. log/direction: (q−p)/|q−p|. distance |q−p|. PT: identity. A = r².
- Two-point geodesic: unique. Charts: identity. Meshes/BVH: as today.

### S³ (unit sphere in R⁴)
- exp: γ(t) = cos t p + sin t v (v ⊥ p, |v|=1); velocity −sin t p + cos t v. Period 2π. [V-src, V-num]
- distance: d = arccos⟨p,q⟩ ∈ [0,π]; stable: d = 2·atan2(|p−q|, |p+q|) [TT].
- log (both geodesics): u = (q − cos d·p)/sin d with length d, and −u with length 2π−d [V-src].
  At q = −p: every direction (uncountable; focus). [V-src]
- PT along the minimizing geodesic p→q: P(w) = w − ⟨q,w⟩/(1+⟨p,q⟩)·(p+q) [V-num: equals the
  transvection formula, tangent at q].
- A(r) = sin² r — vanishes at r = π (antipodal refocusing: a point light is infinitely bright at
  its antipode; both geodesics carry the same sin² falloff) [V-src, V-num].
- Chart: gnomonic x = p.xyz / p.w on the hemisphere w > 0; geodesics → lines, great 2-spheres →
  planes [mem; standard]. Two charts (w>0, w<0), or the chart centered at an instance. A ray
  crosses w = 0 at closed-form t; ray–plane: tan t = −⟨n,p⟩/⟨n,v⟩ has solutions t and t+π [TT].
- Far clip: rays repeat exactly after 2π, so the repo's MAX_DIST = 1000 means ~159 loops; the
  natural far limit is 2π (opaque scenes) and there is no "sky" in S³ [TT, from the formula].
- Pitfalls: antipodal focus (variance, division by zero), two geodesics per NEE connection (sum
  both for an unbiased estimate, or declare the truncation), elliptic quotient RP³ (identify ±p).

### H³ (hyperboloid ⟨p,p⟩_M = −1, w > 0)
- exp: cosh t p + sinh t v; velocity sinh t p + cosh t v [V-src, V-code thurston].
- distance: cosh d = −⟨p,q⟩_M [V-src]. **Stable**: d = 2 asinh(√⟨p−q,p−q⟩_M / 2)
  (since ⟨p−q,p−q⟩_M = 4 sinh²(d/2)) [V-num].
- log: u = (q − cosh d·p)/sinh d [V-src, V-code].
- PT p→q: P(w) = w + ⟨q,w⟩_M/(1−⟨p,q⟩_M)·(p+q) [V-num vs transvection].
- A(r) = sinh² r [V-src, V-num]. Point-light falloff 1/sinh² r ≈ 4e^{−2r}.
- Two-point geodesic: unique.
- Chart: Klein x = p.xyz/p.w in the unit ball; geodesics → segments, totally geodesic planes →
  affine planes, so geodesic triangles are flat [V-num straightness]. Ray–plane in R⁴:
  tanh t = −⟨n,p⟩/⟨n,v⟩ (|·| < 1 or no hit) [V-num].
- Ideal boundary / environment: γ(t) ~ (e^t/2)(p+v), and p+v is null, so the ideal point in
  Klein is (p+v).xyz/(p+v).w, a unit 3-vector — feed it to the existing direction-indexed env
  lookup [TT, derivation]. At the camera at the origin it equals the view direction.
- Isometries: SO⁺(3,1) as mat4; the Euclidean "uniform scale" does not exist (sizes are
  parameters of primitives) — the repo's transforms doc already says this
  (docs/fable-transforms.md:34–43) [V-code].
- SDF marching: σ(p) as true hyperbolic distance (ball arccosh(w)−r etc.); same sphere-tracing
  contract [V-src].
- Precision [V-num, float32]: Klein 1−tanh d rounds to 0 at d = 10 (ulp-sized at 8–9).
  Hyperboloid: a 1e-3 separation at distance D from the origin: asinh form gives 1.06e-3 at
  D=5, 0.147 at D=10, 0 at D=15; acosh form already fails at D=5 and gives 9.77e-4 even at D=0.
  ⇒ practical float32 working radius ~5 around the chart origin; keep the camera at the origin
  (move the scene by isometries), and/or instance-local charts, and/or quotients.

### H²×R (H² hyperboloid in R^{2,1}, × R)
- exp: (cosh(s t) p_H + sinh(s t) v̂_H, w + c t), s = |v_H| = sin β, c = v_w = cos β [V-src].
- distance: √(d_H² + Δw²) [V-src, V-code h2e/distance.glsl].
- log: unit((d_H·log_H(p_H,q_H)) ⊕ Δw) — unique [V-src, V-code h2e/direction.glsl].
- PT: H-part by the H² transvection formula, vertical part fixed; β is constant along the
  geodesic [TT].
- A(r,u) = r·sinh(r sin β)/sin β [V-src, V-num] — anisotropic: falloff is 1/r² looking up/down,
  exponential looking sideways.
- Charts: Klein(H²)×R makes vertical planes and horizontal slices flat, but a general geodesic
  is (x = tanh(s·t)-like along a Klein segment, w linear in t) — **not straight** [TT,
  derivation]. Totally geodesic surfaces are only vertical planes and horizontal slices [mem].
  ⇒ general triangle meshes need either (a) a definition of a "triangle" (e.g. ruled surface /
  flat in Klein×R) plus a numeric root find for ray hits, or (b) restricting fast paths to
  vertical/horizontal faces. Open design question.
- BVH: boxes Klein-rect × [w0,w1] still bound things, but the ray is curved there, so slab tests
  need a bound on the curved ray (it is planar: it lies in the vertical plane over its Klein
  segment, and w is monotone) [TT].

### S²×R (briefly)
- exp like H²×R with cos/sin; countably many geodesics ((2πn ± d_Y) rings) [V-src]. A(r,u) =
  r·sin(r sin β)/sin β, zero whenever r sin β = kπ (refocusing rings) [V-src]. Kopczyński must
  subdivide triangles near the poles/antipode [V-src]. NEE needs a truncated sum over n.

---

## 5. Meshes, BVHs, acceleration

- **H³**: Klein chart → geodesic triangles are flat triangles; an AABB in Klein coordinates is a
  convex Klein region; a ray is a straight Klein segment. So the existing BVH builder, slab
  test and Möller–Trumbore run unchanged *in the chart*, and only the hit parameter changes
  (chart parameter → arc length via the tanh relation) [TT on top of V-num facts]. Klein
  precision limits (d ≲ 8 in float32) argue for per-instance local charts (each instance's BLAS
  in a Klein chart centered on the instance; the TLAS placement is an SO(3,1) mat4) — which
  matches this repo's TLAS/BLAS + placement-as-structure-group design [TT].
- **S³**: gnomonic charts per hemisphere, or per-instance charts (an instance smaller than a
  hemisphere fits one chart). Ray must be split at chart boundaries; t+π antipodal hits [TT].
- **Quotients**: teleport rays across Dirichlet faces (Coulon §4, Novello miss shader) or treat
  the fundamental domain as one cell and re-enter [V-src].
- **Light tree**: importance bounds (distance and orientation cones) currently use Euclidean
  quantities; H³ needs sinh² bounds and the cone bound from sin α = sinh R / sinh d [TT].
  Kopczyński's many-lights remark makes this the most important curved-space sampling structure.

---

## 6. Mapping onto this repo (for the owner's planning, not a recommendation to build)

What exists [V-code]:
- `src/components/ambient/euclidean/euclidean.glsl` (33 lines): `ambient_geodesic`,
  `ambient_frame`, `ambient_dot`, `ambient_parallel_transport`, `ambient_direction_to`.
  `src/components/ambient/README.md` lists the seam; H³ and Schwarzschild are "known next
  occupants". `src/glsl/core/structs.glsl:4–5` `#define Point vec3`, `#define Direction vec3`.
- docs/fable-reference-implementations.md §10 (L662–702) sketches the H³ occupant
  (hyperboloid, renormalize) and names the open item: "the ray's *direction at a far hit* …
  needed for `wo` in curved space".
- Light samplers carry a "METRIC EXEMPTION" note (point, spot, beam, softbeam, quad, sphere,
  disk, mesh, directional, env equirect/octahedral): they are declared Euclidean closed forms.
  The r² sites: `point.glsl:12–17` (`ls.radiance = l.intensity / d2`), `quad.glsl:17,30`
  (`ls.pdf = d2 / (l.area * cos_l)`), `mesh.glsl:45,61` (same).
- docs/trace-loop-contract.md:148: "length() is Euclidean; a geodesic ambient-distance helper is
  the curved-space follow-up".
- docs/fable-transforms.md:34–43: placement = element of the ambient structure group; H³ → SO(3,1),
  `distance_scale ≡ 1`.
- GRIN walker `src/components/transport/volume/grin/` (grin.glsl 411, grin.md 130): numeric
  geodesics of n²δ with symplectic Verlet, L/n² invariant, roulette for long traversals; its
  comments already mention black-hole photon spheres. Static spacetimes have a Fermat optical
  metric; Schwarzschild in isotropic coordinates is conformally flat, n(r) = (1+M/2r)³/(1−M/2r)
  [mem] — i.e. a Schwarzschild *spatial* lens can already be expressed as a GRIN index field
  (ignoring redshift/time).

What the literature implies the seam is missing [TT unless marked]:
1. A distance (`ambient_distance`, stable form) — acknowledged in trace-loop-contract:148.
2. Velocity at t (the "direction at a far hit") — acknowledged open in ref-impl §10; the old
   repo's `flow(Vector,t)` returns (point, velocity) together [V-code].
3. An area density A(r,u) (or a geometry term) — the one quantity every NEE/MIS pdf and every
   point-light falloff needs. Not in the seam today; each light sampler hard-codes r² under
   its METRIC EXEMPTION note.
4. A multi-valued two-point connection for S³/S²×R/quotients — `ambient_direction_to` is
   single-valued.
5. A far-limit / sky policy per space: MAX_DIST (Euclidean far clip, where env and the
   directional light are "found") has no meaning in S³ (period 2π) and should be the ideal
   boundary in H³.
6. A chart for meshes/BVH (Klein/gnomonic), with chart-parameter → arc-length conversion.

---

## 7. Pitfalls checklist
- acosh(−⟨p,q⟩) for small distances (float32) — use the asinh / atan2 forms. [V-num]
- Renormalize hyperboloid points/directions after isometries (old repo `reduceError`). [V-code]
- Klein/gnomonic float32 range (Klein ≈ d 8–9). [V-num]
- S³ antipodal focusing; two geodesics; rays periodic. [V-src]
- S²×R refocusing rings; countable geodesics; triangle subdivision. [V-src]
- No similarities in curved spaces (scale belongs to primitive parameters). [V-code doc]
- H³ needs many lights (exponential volume growth). [V-src]
- Orthographic camera has no curved-space meaning (no parallel geodesic families that stay
  parallel); pinhole/fisheye/equirect are tangent-space maps and carry over given a frame [TT].
- Thin lens needs the two-point log map to focus [TT].
- Finite-difference SDF normals must be taken in a tangent frame and projected to T_p
  (old repo `frame`/`orthoFrame`) [V-code].
