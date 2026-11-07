# Black-hole spacetimes in a WebGL2 unidirectional path tracer: literature and feasibility

Date: 2026-11-06. Scope: Schwarzschild and Majumdar–Papapetrou (MP), surfaces that scatter, NEE + MIS,
unbiasedness first. No repository was edited.

Labels used on every claim:
- **[read]**: read in a source (URL, or file:line) during this session.
- **[measured]**: computed by a script in this session (script path given).
- **[reasoning]**: my own derivation or from memory. Thought through but not checked by anyone else.
  Treat these claims as hypotheses.

---

## 0. Bottom line

1. **Emission-only black-hole pictures are feasible now.** Examples are a glowing disk, a sky seen
   through the lens, and emissive gas. The astrophysics codes (DNGR, GRay, Odyssey, RAPTOR, ipole) trace
   rays from the camera to the source and need no light sampling. This tracer already renders an MP
   binary as a GRIN region with `directLighting: 'none'` [read: demos/blackholeScene.ts:1-80].
2. **Scattering surfaces lit by small lights near a hole are the hard case.** NEE needs the
   point-to-point ("two-geodesic") connection, and it also needs the exact area-to-solid-angle Jacobian of
   that connection. An approximate connection or an approximate Jacobian makes NEE biased, unless MIS is
   built so that NEE covers *only* the paths it provably handles exactly (§4).
3. **Schwarzschild exact NEE looks feasible, but nobody has built it.** I found no paper that does it.
   Spherical symmetry reduces the connection to a 1D root find in a plane. Perlick (2004) gives the exact
   Jacobian in closed form: radial and tangential angular-diameter distances [read]. With an MIS
   "partition" (NEE covers the two lowest-order images, and BSDF sampling gets weight 1 on all other
   images) the estimator is unbiased [reasoning]. Float32 resolves the k = 0 images well and k = 1
   marginally. k ≥ 2 cannot be resolved if the root find is parameterized by impact parameter b
   [measured]. That costs no bias under the partition; those images go to BSDF sampling.
4. **Unbiased MP NEE is not feasible reliably in WebGL2. Note it and skip it.** The dynamics are chaotic,
   the shadows are fractal, and connections come in infinite families with fractal basins [read:
   Shipley & Dolan 2016]. The only published unbiased scheme for multiple curved connections is Booth's
   reciprocal-probability trick [read: Pediredla 2020, Zeltner 2020]. It needs an unbounded number of
   Newton solves, each a full curved trace with Jacobi fields. Its variance is (1−p)/p² [read: Zeltner
   2020], and it gives no pdf for MIS. For MP, use BSDF sampling only (what the demo does), or
   optionally "deterministic-solver NEE + MIS partition" (§6.3). That optional scheme is unbiased up to
   a declared matching tolerance, and it is untested.
5. **A blocker outside light sampling.** The GRIN walker has a geometry-free interior [read:
   src/components/transport/volume/grin/grin.glsl:26]. Inside a curved region nothing can be hit.
   Scattering surfaces *near* a hole therefore need either per-step scene intersection inside the
   walker, or a curved ambient space (docs/trace-loop-contract.md:62,126,158). This comes before any
   NEE question, and it is the dominant cost: steps × scene intersection.

---

## 1. Facts in this repository and the owner's other repositories [read]

- **The MP binary already renders as a GRIN region.** It is a "glass block" with `ior = U²` and
  `U = 1 + Σ M/|x − p_i|`, using pt with `directLighting: 'none'` and maxBounces 24
  (demos/blackholeScene.ts:1-80). The header explains this as Fermat's principle: null rays of the MP
  metric are geodesics of the optical metric U⁴δ, so n = U².
- **The GRIN walker:**
  - It uses velocity Verlet on (r, T), with T = n·tangent (grin.glsl:8-12).
  - Strong-field step limiters GRIN_DS_MAX 0.05 and GRIN_DTOL 0.05 (grin.glsl:78-90).
  - Capture at n > GRIN_CAPTURE = 50, commented as "exact for the image" for a single MP hole
    (grin.glsl:91-95).
  - Russian roulette in rounds of 512 steps, with a hard stop at 200 rounds that is declared to "decide
    the picture" with tiny probability (grin.glsl:36-57).
  - The interior is geometry-free (grin.glsl:26).
- **The "glass rule".** A GRIN traversal is a deterministic delta event, and NEE shadow rays see GRIN
  regions as opaque, so an emitter reached through a GRIN region scores at full weight
  (src/components/transport/integrators/pt/pt.ts:342-357;
  src/compiler/generate/features/materials.ts:835). Light that arrives through a bent region is
  counted by BSDF sampling only. This is the MIS-partition idea of §4, already used here in its
  simplest form (the NEE set is empty for bent connections).
- **Open defect in the glass rule.** The near-wall straight micro-segment is not recorded as a delta
  event, so a ~1e-4 rim band is counted by pt but by neither technique under nee/mis
  (docs/claude-improvements-2026-09.md:131-137). The partition must be exactly complementary, and a
  small leak is already a known bug.
- **Curved spaces in the contract.** Schwarzschild is a planned occupant of the ambient seam:
  `ambient_geodesic` with an internal RK4 (docs/fable-reference-implementations.md:690;
  docs/trace-loop-contract.md:62,126,158).
- **charged-blackholes repository:**
  - The MP optical metric h = U⁴δ, with ODE ẍ = (2/U)(|ẋ|²∇U − 2(∇U·ẋ)ẋ) and U⁴|ẋ|² = 1. Horizons are
    points at infinite optical distance (src/physics/majumdar-papapetrou.ts:1-12).
  - A second, independent Maupertuis formulation exists for trust checks (src/physics/maupertuis.ts:1-20).
  - A proposal exists for carrying Jacobi fields along rays (docs/plans/variational.md, 2026-11-02),
    with analytic A_x and A_v and exact invariants (Gauss lemma, symplectic form). This is exactly the
    Jacobian an MP NEE would need.
  - docs/plans/basin-maps.md (proposal) covers fractal shadows "with trust".
  - The horizontracer and pathtracer GLSL use RK4 with no light sampling (a grep for
    nee/shadow/sampleLight in code/pathtracer/glsl found none). They stop at stopRadius 0.03 and return
    the horizon color (code/horizontracer/glsl/tracer/3Trace/pathTrace.glsl).
- **~/Code/PathTracer/docs/curved-light-blackhole.md** is the physics reference for the MP demo. It says
  nothing about light sampling (grep).

---

## 2. Physics: static spacetimes are GRIN media, plus a redshift

### 2.1 Fermat reduction
- **[read]** For MP, the projection of null geodesics onto the optical metric is stated in
  charged-blackholes (above) and in Shipley & Dolan (arXiv:1603.04469).
- **[read, secondary]** The Schwarzschild isotropic-coordinate index is
  n(r) = (1 + M/2r)³ / (1 − M/2r) (arXiv:2104.14055, arXiv:1805.03781). Both give the large-r limit
  1 + 2M/r.
- **[reasoning]** For any static metric −V²dt² + ψ⁴|dx|², light rays are geodesics of ψ⁴/V² |dx|², so
  n = ψ²/V:
  - MP: V = 1/U and ψ² = U, so n = U².
  - Schwarzschild isotropic: ψ = 1 + M/2r and V = (1 − M/2r)/(1 + M/2r).
  - The spatial metric is conformally flat, so local angles equal coordinate angles. BSDFs, frames and
    `ambient_dot` can stay Euclidean. Only step lengths, radiance factors and wavelengths change.
- **[reasoning]** Fermat needs a static spacetime and static emitters, receivers and scatterers. Both
  Schwarzschild and MP are static. Kerr is only stationary: the projected rays are not geodesics of a
  Riemannian metric (a Randers/Finsler term appears), so this reduction does not extend to Kerr. Kerr is
  out of scope.

### 2.2 Radiance and redshift
- **[read, secondary]** Lindquist (1966): I_ν/ν³ is invariant along rays in vacuum (arXiv:2206.06429,
  astro-ph/0406401 summarize it). DNGR applies the same Liouville ν³ scaling [read: ar5iv 1502.03808 §4.1].
- **[reasoning]** For static observers, ν_loc(x) ∝ 1/V(x), so λ_loc(x) = λ_∞·V(x).
  - Spectral: L_λ·λ⁵ is invariant. A camera sample at λ_cam must evaluate each vertex x at
    λ_cam·V(x)/V(cam) and carry the factor (V(x)/V(cam))⁵. This tracer's spectral mode (four
    wavelengths) could do this per vertex.
  - RGB: only the bolometric part, (V(x)/V(cam))⁴, can be correct, because colors also shift. RGB is
    already a declared truncation.
- **[reasoning, important]** The GRIN invariant L/n² (basic radiance; Ament 2014, Pediredla 2020 §3.2
  [read]) holds for the *coordinate* radiance L_c = L_loc·V²ψ⁴: energy at infinity, per coordinate time,
  per coordinate area.
  - Then L_c/n² = L_loc·V⁴, which is the GR invariant. So the two agree.
  - For MP, V²ψ⁴ = U⁻²·U² = 1, so the GRIN radiance *is* the locally measured radiance.
  - For Schwarzschild, V²ψ⁴ = (1 − M/2r)²(1 + M/2r)² ≠ 1. Emission and BSDF evaluation in local units
    then need this per-vertex conversion factor.
  - This derivation needs a check before it is used.
- **[reasoning] Witness idea (Tolman / "GR furnace").** A static camera at x with a uniform environment
  of bolometric radiance L_∞ must read L_∞/V(x)⁴ in every pixel that escapes. Spectrally, a blackbody sky
  at T must read as a blackbody at T/V(x). This is an exact derived value, in the spirit of furnace 0.4.

### 2.3 Image structure in Schwarzschild
- **[read]** Gralla & Lupsasca (ar5iv 1910.12873, Eq. 72): γ₀ = π for a = 0. Each successive image of
  an equatorial disk seen face-on is demagnified by e^{−γ} per half orbit. Non-equatorial sources form
  two families, each demagnified by e^{−2γ} per full orbit.
- **[measured]** Ratio of (b − b_c) between successive windings at r₁ = r₂ = 6M:
  9.245e-4 / 1.726e-6 = 535.6, against e^{2π} = 535.5 (script in §5.3).

---

## 3. Literature: who does what

| Work | What it does | Light sampling with curved connections? | Label |
|---|---|---|---|
| James, von Tunzelmann, Franklin, Thorne 2015, DNGR (CQG 32 065001; arXiv:1502.03808) | Kerr; propagates ray *bundles* backward from camera to celestial sphere and disk via geodesic deviation (Pineault–Roeder); caustics where the minor diameter δ₋ → 0; ν³ Liouville intensity scaling; CPU cluster, no GPUs | No. Camera-to-source only. Lens flare is a post-process convolution | [read: ar5iv §2.1–2.2, 3.3.1, 4.1, 4.3.1] |
| GRay (Chan, Psaltis, Özel 2013, arXiv:1303.5057); GRay2 | GPU geodesic integrator, Kerr | No (emission/absorption camera rays) | [read: search abstracts] scattering absence [reasoning] |
| Odyssey (Pu et al. 2016, arXiv:1601.02063) | GPU GRRT, Kerr | No | [read: abstract] |
| RAPTOR (Bronzwaer et al. 2018, arXiv:1801.10452) | GRRT in arbitrary, including numerical, spacetimes | No | [read: abstract] |
| ipole (Mościbrodzka & Gammie 2018) | Polarized GRRT | No | [reasoning/memory] |
| grmonty (Dolence et al. 2009, arXiv:0909.0708) | Monte Carlo *forward* superphotons, Compton scattering in Kerr, direct geodesic integration | Not camera-based: photons are emitted at the source and tallied at large radius (a light tracer, not unidirectional from the eye) | [read: abstract] tallying [memory] |
| MONK, Pandurata, Chatterjee & Bhattacharya 2026 (arXiv:2610.26769) | GR Monte Carlo Comptonization (corona) | Not found. The search found no geodesic "peel-off" (the astrophysics name for NEE) in GR | [read: search snippets; absence = not found, not proven] |
| Mandal, Ayush, Chaudhuri, IVAPP 2021, "Non-linear Monte Carlo ray tracing for visualizing warped spacetime" | Path tracer in Schwarzschild, Kerr and Ellis wormhole; step-halving intersection; marks unstable rays as errors and *smooths* them | No NEE through curved space. Their "bidirectional" fix caches light from the source on walls in light maps (biased) | [read: PDF text §4, §5] |
| Gröller 1995, "Nonlinear ray tracing: visualizing strange worlds" (Vis. Comput. 11(5)); Weiskopf 2000 (4D non-linear ray tracing); Müller–Boblest–Weiskopf 2015 | Visualization by bent rays | No physically based light sampling | [read: bibliographic records] content [memory] |
| Ament, Bergmann, Weiskopf 2014, RRTE (TOG 33(2)) | Refractive RTE; basic radiance L/n²; *photon mapping* (biased) | Avoids connections by density estimation | [read: abstract; Pediredla's summary] |
| Pediredla et al. 2020, "Path tracing estimators for refractive radiative transfer" (TOG 39(6) 241) | Unbiased PT/BDPT in GRIN: connections by gradient descent, random restarts, Booth reciprocal estimate of 1/p(C) ("Algorithm 3"); non-convergence → null path f = 0 | Yes, for GRIN, the closest analog to black holes. **But** Table 1's geometric term is the straight-line form \|N·ω\|\|N·ω\|/‖x−y‖² on surfaces and (∫ds)⁻² in media, with no bundle Jacobian | [read: PDF p.5 Table 1, §4.1] — that this term is wrong for focusing fields is [reasoning] |
| Hanika, Droske, Fascione 2015, Manifold NEE | Newton on a specular constraint from a deterministic seed; finds one solution | Biased when several solutions exist | [read: Pediredla 2020 and Zeltner 2020 cite it so] |
| Zeltner, Georgiev, Jakob 2020, Specular Manifold Sampling (TOG 39(4)) | Random seeds plus Booth: the number of trials until the same solution recurs is an unbiased estimate of 1/p_k. Variance (1−p_k)/p_k². The biased variant caps at M samples and clusters them | Its estimator multiplies by the generalized geometric term G(x₁↔x₂↔x₃) | [read: sms.pdf Alg. 2, lines 621-686] |
| Perlick 2004, "On the exact gravitational lens equation in spherically symmetric and static spacetimes" (PRD 69 064017; arXiv:gr-qc/0307072) | Exact lens map for any (r_O, r_S); D_ang = √\|D_r·D_t\|; D_t = A(r_S)R(r_S) sinΦ / sinΘ; D_r = A(r_S)R(r_S) cosψ dΦ/dΘ; R(r_O) sinΘ = R(r_S) sinψ; D_lum = (1+z)² D_ang; Einstein ring ⇔ sinΦ = 0 | Gives *exactly* the Jacobian a Schwarzschild NEE needs | [read: PDF text Eqs. 11-14, 21-26] |
| Shipley & Dolan 2016 (CQG 33 175001; arXiv:1603.04469) | MP binary: chaotic scattering, Cantor-like 1D shadows, conjectured Wada property, stable bound null orbits for separations a₁ < a < √2·a₁, a₁ = 4M/√27 | Shows MP connections form infinite fractal families | [read: search summary of abstract] |
| Gralla & Lupsasca 2020 (arXiv:1910.12873) | Photon-ring Lyapunov exponents; γ₀ = π | Bounds high-order image contributions | [read] |
| Veach 1997 thesis, MIS | Unbiased if Σ_i w_i(x) = 1 wherever f ≠ 0, and w_i = 0 where p_i = 0 | The basis of the partition argument | [memory] |

**Absence claims [read, limited].** Two extended web searches found no physically based renderer that
does NEE with geodesic connections in Schwarzschild or MP. The IVAPP 2021 paper, the nearest, does not.
This is "not found", not "does not exist".

---

## 4. Why approximate connections bias, and the partition that keeps NEE unbiased

**[reasoning, standard]** The NEE estimator for one bounce at x samples a light point y with density
p_A(y) and scores

  f(x, ω_k) · L_e(y → x along image k) · V_k · G_k(x, y) / p_A(y),   G_k = |cosθ_x||cosθ_y| / D_k²,

where D_k is the area distance of the k-th connecting ray: the ray-bundle Jacobian, not the chord
length. Unbiasedness needs three things.
- (a) **Exact Jacobian.** The connection found and its G_k must be exact for the transport the BSDF
  rays actually perform.
- (b) **Every image counted.** Every connecting image must be summed, or explicitly assigned to another
  technique.
- (c) **Known pdf.** The connection procedure's probability of producing each image must be known.

Errors in G bias NEE directly: there is nothing to average them out. BSDF sampling needs none of
these, because its pdf is the BSDF's own.

**The MIS partition.**
- Define a set S of images (or paths) that NEE handles exactly.
- NEE scores only images in S, each with weight w_nee = p_nee²/(p_nee² + p_bsdf²).
- A BSDF-sampled path that hits an emitter is classified by the same rule:
  - If its image is in S, it gets w_bsdf = 1 − w_nee. This needs p_nee for that path in solid-angle
    measure, p_A(y)·D_k²/|cosθ_y|, which again needs D_k.
  - If its image is not in S, it gets w_bsdf = 1.
- This is unbiased for any S, provided the classification is the *same function* of the path on both
  sides and NEE finds *every* image in S for every y.
- The glass rule is this partition with S = ∅ for bent connections.
- Variance depends on S. Bias does not.

**Consequences.**
- **Image counting.** An image NEE does not attempt costs variance, not bias.
- **Solver failure.** If NEE claims an image class but its solver sometimes misses a member, that
  member is counted by neither technique. This is bias. It is the same kind of leak as the GRIN rim
  band defect in §1.
- **Russian roulette on connection attempts** is unbiased only with the attempt probability known
  (divide by q). It cannot fix an unknown solver pdf (c).
- **Booth's reciprocal trick.** It restores (c) in expectation, but its loop has no bound. A fixed GLSL
  bound truncates it. Roulette on the trial count (continue with probability q, weight 1/q) makes the
  truncation exponentially rare. The result is "unbiased up to a declared hard stop", like the GRIN
  walker's GRIN_MAX_ROUNDS.
- **MIS with Booth-type NEE.** It is not available exactly: only a noisy estimate of 1/p exists, and
  plugging an estimate into the power heuristic is biased in general. NEE must then cover every image
  (pure NEE), and BSDF hits on emitters get weight 0.
- **NEE without MIS (pt-nee) near tangential caustics.**
  - The caustic is the Einstein-ring alignment, sinΦ → 0 in Perlick. There D_t → 0, so G ~ 1/ρ near
    the point where the x–hole axis pierces the light. ∫(1/ρ)² ρ dρ diverges logarithmically, so
    pt-nee has infinite variance there.
  - Under MIS, w_nee ~ ρ² there, so the product stays finite and MIS tames it.
  - pt (BSDF only) is unaffected.
- **Consistency between techniques.** The integral being estimated is the one defined by the
  *numerical* flow the BSDF rays use (step size and integrator). For NEE to agree, the connection
  should be solved through the same numerical map, and G should be the derivative of *that map*:
  differentiate the integrator (discrete variational equations), not the continuous ODE. Otherwise the
  two techniques estimate slightly different integrals, and the MIS sum is off by O(truncation error).
  In Schwarzschild the cleaner fix is to make both techniques use the analytic planar orbit (§5).

---

## 5. Schwarzschild: exact NEE is plausible

### 5.1 Reduction
- **[read: Perlick 2004]** The geodesic from x to y lies in the plane through the hole's center O, x
  and y. The plane is undefined only when O, x and y are collinear, a measure-zero set (the Einstein
  ring). The lens equation is an integral over r: Perlick Eq. 14,
  Φ = ∫ R(r_O) sinΘ S(r) dr / (R √(R² − R(r_O)² sin²Θ)). When ṙ changes sign, the integration is done
  piecewise.
- **[reasoning]** In Schwarzschild, Φ(b) is an incomplete elliptic integral of the first kind: u = 1/r
  and (du/dφ)² = 1/b² − u² + 2Mu³. Carlson R_F (duplication, about 5-8 iterations in float32) evaluates
  it without tables, and dΦ/db adds R_D.
- **[reasoning]** Images for a given (x, y):
  - Swept angle Δφ (the short way) and 2π − Δφ (the long way).
  - Each plus 2πk windings.
  - Each of these is one root of a monotone branch. Branch bookkeeping is needed for the cases
    r_y ≶ r_x and periapsis before or after.
  - A bracketed Newton/bisection on the initial angle ψ_x is robust: about 10-20 evaluations.
  - These claims are not checked. A TS twin with exhaustive tests should come first.

### 5.2 Jacobian, closed form [read: Perlick Eqs. 21-25]
- D_t = A R(r_S) sinΦ / sinΘ.
- D_r = A R(r_S) cosψ (dΦ/dΘ).
- D² = |D_r·D_t|.
- Parity is sign(D_r·D_t). The tangential caustic is sinΦ = 0.
- **[reasoning]** For a Schwarzschild exterior with static source and observer I believe no radial
  caustics occur (D_r ≠ 0). This is unchecked, from memory.
- **Conversion to this tracer's units.** These D's are proper distances measured by static observers.
  The conformal and radiance factors of §2.2 must be applied consistently. This is the kind of detail a
  witness has to pin.

### 5.3 Float32 limits [measured]
Script: /private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/bhcalc/winding.py
(numpy, float64, factored integrand near the periapsis double root). Setup: M = 1, r₁ = r₂ = R, target
swept angle π + 2πk (source diametrically opposite).

| R | k | b − b_c | dΦ/db | angle error from 1 float32 ulp of b |
|---|---|---|---|---|
| 6M | 0 | 4.6e-1 | −2.4 | 1.2e-6 rad |
| 6M | 1 | 9.2e-4 | −1.1e3 | 5.2e-4 rad |
| 6M | 2 | 1.7e-6 | −6.0e5 | 0.29 rad (unresolvable) |
| 10M | 1 | 2.2e-3 | −4.5e2 | 2.2e-4 rad |
| 10M | 2 | 4.1e-6 | −2.4e5 | 0.12 rad |
| 30M | 1 | 4.6e-3 | −2.2e2 | 1.0e-4 rad |
| 30M | 2 | 8.6e-6 | −1.2e5 | 0.056 rad |

**Reading.**
- k = 0 is easy.
- k = 1 has angle errors of 1e-4 to 5e-4 rad. That is a point error of about 1e-3·r, which is marginal
  for small lights and an ε-sized inconsistency with the BSDF ray.
- k ≥ 2 is impossible when b is the unknown.
- **[reasoning]** Solving for δ = b − b_c directly, with a factored integrand, could recover relative
  precision. It is not needed: under the partition, k ≥ 1 can be left to BSDF sampling at zero bias.
  Their flux is about e^{−2π} ≈ 1/535 per full winding [read: γ₀ = π].
- WebGPU does not help here. **[memory]** WGSL core has no f64 (only an f16 extension).

### 5.4 Proposed scheme (thought through, not checked)
- **S.** S = {short-way image, long-way image} at winding 0, optionally k = 1 short-way.
- **NEE.**
  - Sample y on the light by area.
  - For each image in S: solve for ψ, then trace the *analytic* planar orbit as a polyline through the
    scene for occlusion.
  - Score with the Perlick G_k, MIS weight against p_bsdf.
- **BSDF.**
  - A BSDF ray is also advanced along the analytic planar orbit: its plane is spanned by O, x and ω.
    u(φ) can come from the Binet ODE u'' + u = 3Mu² integrated in φ, or from the Weierstrass ℘ closed
    form.
  - On an emitter hit, read the image class from the swept angle and compute p_nee via the same
    Perlick formula.
  - Both techniques then use one flow, and G is analytic.
- **Residual inconsistency.** Polyline chords versus the exact orbit at the emitter hit point: the
  sagitta is O(Δφ² r). It is small and should be declared, like other marching epsilons.
- **Cost [reasoning, not measured].**
  - Root find: about 10-20 elliptic evaluations at about 100-200 flops each.
  - Two occlusion marches per NEE (one per image), each about as expensive as a BSDF ray.
  - So roughly 2-3× the per-bounce cost of BSDF-only. It pays off for small lights.
- **Environment NEE (sky at infinity).** The same reduction applies, with the endpoint a direction at
  infinity: r_S → ∞ in Perlick, Φ to infinity. Also a 1D root find.
- **What is still missing in the tracer (§0.5).** Surfaces inside the curved region. Today the walker is
  geometry-free.

---

## 6. Majumdar–Papapetrou

### 6.1 Facts
- **[read]** n = U², U = 1 + Σ M_i/|x − p_i|. Horizons are points at infinite optical distance
  (charged-blackholes src/physics/majumdar-papapetrou.ts:1-12).
- **[read]** There is no symmetry plane in general. Null geodesics scatter chaotically, shadows are
  Cantor-like and possibly Wada, and some separations have stable bound null orbits (Shipley & Dolan
  2016).
- **[reasoning]** Connecting geodesics from x to y form an infinite family indexed by symbolic
  itineraries around the holes. Their Newton basins are fractal near the chaotic set, and high-order
  members need precision that grows exponentially with the itinerary length (Lyapunov). Float32 can
  resolve only the first few.

### 6.2 Options and verdicts
1. **BSDF sampling only (the current demo).** Unbiased. Noise scales with the inverse solid angle of
   the lights. Fine for big emitters: a sky, a disk, big area lights, emissive media.
   Verdict: **feasible now**. It is what the GRRT codes effectively do.
2. **Glass rule with a bounded field region.** The field is truncated or blended to n = 1 outside a
   region, which changes the scene and must be declared as a measurement choice. NEE works with
   straight shadow rays outside the region, and the region is opaque to shadow rays. Verdict:
   **feasible now** for lights and surfaces outside the field. It is what the glass-block demo is.
3. **SMS/Booth-style unbiased NEE.**
   - It needs random restarts, an unbounded trial loop, Jacobi fields (an 18-float state) along every
     Newton shot, and (1−p)/p² variance with tiny basins. No MIS is available, and float32 suffers in
     chaotic regions.
   - Verdict: **not feasible reliably or efficiently in WebGL2. Note it and skip.** WebGPU would make
     the scheduling better (a wavefront queue for solves) but not the precision or the variance.
4. **Deterministic-solver NEE plus the partition (§4)** [reasoning, untested].
   - A Newton solve from a deterministic seed (straight line, or the single-hole Schwarzschild-like
     solution), with a fixed iteration budget. Its success or failure is a deterministic function of
     (x, y).
   - The BSDF side re-runs the same solver on its emitter hits to classify itself.
   - G comes from the discrete variational equations of the same integrator.
   - It is unbiased up to the tolerance used to decide "same path". With chaotic conditioning, that
     tolerance is a real, hard-to-bound bias.
   - Cost: about one extra full solve per BSDF emitter hit as well.
   - Verdict: **research, not a plan**. It would need its own study, and it conflicts with the
     owner's "no guesses / no heuristic tolerances" rule unless the class is defined by a discrete,
     robust invariant, such as itinerary = "direct", with a *proof* that the solver always finds that
     image.

---

## 7. Alternatives that stay unbiased, summarized

| Approach | Unbiased? | Cost in WebGL2 | Notes |
|---|---|---|---|
| BSDF only (pt) | Yes | 1 curved trace per bounce | Noisy for small lights; already supported (demo) |
| Large emitters / sky / emissive media | Yes | Same as pt | The GRRT-code regime; needs redshift factors for physics (§2.2) |
| Glass rule (S = ∅ in the curved region) | Yes | NEE straight outside | Already built for GRIN; field must be compact (declared) |
| Schwarzschild planar exact NEE + partition | Yes [reasoning] | About 2-3× per bounce | Not built anywhere I found; needs a TS twin and witnesses |
| MP Booth/SMS NEE | Yes in expectation, minus the hard stop | Unbounded, divergent | Skip |
| Photon/light tracing, BDPT, light maps | Light maps and photon mapping are biased; BDPT is unbiased | — | Not unidirectional; the owner excludes it here |
| Approximate connection (straight shadow ray, or a linearized lens) with exact-looking weights | **No** | Cheap | Biased unless the pdf is the exact pdf of what was sampled |

---

## 8. WebGL2 versus WebGPU

- Precision (float32) limits high-order images and chaotic connections on both platforms.
  **[memory]** There is no f64 in WGSL core.
- WebGL2 pain points are scheduling problems, not correctness problems: per-pixel divergent Newton
  loops, fixed loop bounds, and no work queues. An MP NEE would be clearly easier to *make efficient*
  in WebGPU (wavefront: one kernel finds connections, one traces occlusion). That is a reason to leave
  MP NEE to the next tracer.
- Schwarzschild planar NEE is a bounded, fixed-iteration computation. It fits WebGL2.

---

## 9. Open questions (for the owner)

1. Is a field compactly supported or blended to n = 1 at a radius R acceptable as a *declared* scene
   choice for MP and Schwarzschild? It is needed for "glass rule" NEE and for MAX_DIST.
2. Should scattering surfaces *inside* the curved region be in scope? That is the real blocker,
   independent of light sampling: per-step scene intersection in the walker, or a curved ambient space.
3. Should spectral redshift (λ_loc = λ_∞·V) be part of the first build? RGB can only be bolometric.
4. Should Schwarzschild exact NEE get a research plan of its own? Its first step would be a TS twin:
   the branch bookkeeping, the Perlick Jacobian checked against finite differences and a χ²-style test
   of p_nee versus BSDF hits.
5. Is the §2.2 radiance conversion right (L_c = L_loc·V²ψ⁴; exactly 1 for MP)? A Tolman "GR furnace"
   witness would settle it.
