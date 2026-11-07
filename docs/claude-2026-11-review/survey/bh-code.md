# charged-blackholes: what it can do about the two-point problem, and what of it fits WebGL2

Written 2026-11-06 for the PathTracerGLSL curved-space research. No repository was edited.

Evidence labels used throughout:

- **[read]**: read in source, with file:line.
- **[measured]**: I ran it this session (scripts in this folder: `measure.ts`, `shoot.ts`; they
  import the repo's own `src/` and change nothing there).
- **[memory]**: from what I know of the literature, not checked here.
- **[reasoning]**: my own argument, not checked by a measurement or a review.

Paths: `CB` = /Users/stevetrettel/Code/charged-blackholes, `PTG` = /Users/stevetrettel/Code/PathTracerGLSL,
`PT` = /Users/stevetrettel/Code/PathTracer (the owner's other tracer), `ARCH` =
/Users/stevetrettel/Code/claudeslop/charged-blackholes (archived, uncommitted prototype work from CB).

---

## 0. Short answer

1. **The repo has no two-point solver.** Nothing in `CB/src` finds a null geodesic from a given point
   to another given point. [read: grep for shoot/newton/two-point/boundary-value over src, test, docs,
   examples, viz, scripts. The only hits are in the plans and in comments.] What it has instead:
   - initial-value rays (DOP853 with events);
   - light cones (fans of initial-value rays sampled at fixed t or at fixed λ);
   - a time-reversal check;
   - a second formulation (Maupertuis) for cross-checks;
   - **closed** light rays in the **plane** by curve shortening inside a free homotopy class.
     Newton multiple shooting for periodic orbits exists only in the archived prototype.
2. **Schwarzschild is not implemented in CB.** Only Majumdar–Papapetrou (MP) is. MP with one hole is
   extremal Reissner–Nordström, not Schwarzschild. [read: `CB/src/physics/majumdar-papapetrou.ts:1-17`.
   The only "Reissner" mentions are in tests and diagnostics, `CB/test/majumdar-papapetrou.test.ts:134-135,193-196`.]
3. **PathTracerGLSL already renders MP black holes (one hole and a binary).** It does this as a GRIN
   medium with n = U². NEE does not connect through the bent region (the "glass rule"): shadow rays see
   the region as opaque, and emitters reached by bent BSDF-sampled rays score full weight. The image is
   unbiased, because bent light is collected by BSDF sampling alone.
   [read: `PTG/demos/blackholeScene.ts:1-25,69-80`, `PTG/demos/accretionScene.ts:1-12`,
   `PTG/src/components/transport/volume/grin/grin.md:96-100`, `PTG/src/components/transport/volume/grin/grin.glsl:78-95`.]
4. **Verdicts**:
   - **Exact two-point NEE for multi-hole MP in a WebGL2 fragment shader: not feasible reliably. Note
     it and skip it.**
   - **For a spherically symmetric hole (Schwarzschild, or one MP hole):** an exact NEE is possible
     in principle, because the problem reduces to a 1D root find per image index. [memory+reasoning,
     not checked]
   - **Simpler, and enough for area lights in any of these spacetimes:** forward "aim at the light"
     direction sampling. This is a direction pdf that is known in closed form, so there is no
     connection, no Jacobian and no image enumeration. The owner built this in PT for flat space.
     [read: `PT/docs/light-sampling-deferred.md:3-12`]
   - **Delta lights (point, spot, directional) inside a curved region need an exact two-point
     solve.** Without one they must be declared unsupported there.

---

## 1. Map of the repository (CB)

Layout: `src/` (pure math, no DOM), `viz/`, `examples/` (one page per folder), `test/` (node --test),
`docs/plans` (exploratory), `docs/decisions` (binding), `code/` (old JS/GLSL apps, frozen).
[read: `CB/docs/plans/upgrade.md:61-76`]

### 1.1 Spacetime and formulation

- **Majumdar–Papapetrou.** The metric is g = −U⁻² dt² + U²|dx|², with U = 1 + Σ mᵢ/|x − pᵢ|, for N
  extremal charged holes in static equilibrium. [read: `CB/src/physics/majumdar-papapetrou.ts:1-2`]
- **Reduction.** g is conformal to −dt² + U⁴|dx|², so null geodesics project to geodesics of the
  optical metric h = U⁴δ. With coordinate time t as the parameter, t is h-arclength:
  ẍ = (2/U)(|ẋ|²∇U − 2(∇U·ẋ)ẋ), with U⁴|ẋ|² = 1 conserved. [read: `majumdar-papapetrou.ts:4-9,86-95`]
- **Horizons.** Each horizon is the point x = pᵢ, at infinite optical distance. An infalling ray
  approaches it only as t → ∞, and r·t → m². [read: `majumdar-papapetrou.ts:11-12`;
  `CB/test/majumdar-papapetrou.test.ts:115-132` (fewer than 200 steps to t = 1600)]
- **The plane z = 0 is invariant, exactly in floating point.** Every planar picture uses it.
  [read: `majumdar-papapetrou.ts:14-17`; test `:104-113`]
- **One hot loop.** `kernel()` computes U and ∇U together, O(N) per evaluation.
  [read: `majumdar-papapetrou.ts:97-111`] This is GPU-friendly: about 15 flops per hole.
- **Affine parameter of the true metric** (`WithAffineParameter`): a 7th component with
  dλ/dt = (U(p)/U(x))². An infalling ray reaches the horizon at finite λ.
  [read: `CB/src/physics/affine-parameter.ts:1-16,45-50`]
- **Maupertuis form Q** (`Maupertuis`): x″ = 2U³∇U at zero energy, with time τ and dt/dτ = U⁴. The
  force depends on position only, so splitting methods (Forest–Ruth, SABA) are genuinely 4th order
  here. Q reaches the horizon at finite τ, and stiffness grows like r⁻⁵.
  [read: `CB/src/physics/maupertuis.ts:1-19`; `CB/docs/plans/upgrade.md:241-245`]
- **Known answers pinned by tests.** [read:
  `CB/test/majumdar-papapetrou.test.ts:134-157,193-213`; `CB/test/maupertuis.test.ts:63-94`]
  - Photon sphere at isotropic r = m, with period 8πm.
  - Lyapunov exponent 1/(4√2 m), fitted to 1e-4.
  - Radial infall: exact τ(r) and t(r).
  - Q reaches the horizon at the exact finite τ\* (to 6e-14).

### 1.2 Integrators (copied verbatim from ../choreographies)

- `Dop853`: Hairer's 8(5,3) with order-7 dense output, Kahan-compensated update, error control on
  `errorDimension` components. It returns statuses and never throws on failure.
  [read: `CB/src/integrate/dop853.ts:1-60`, `CB/src/integrate/types.ts:4-54`]
- `Rk4`: fixed step with Hermite dense output, kept for comparison. [read: `CB/src/integrate/rk4.ts:1-16`]
- `EventLocator`: finds roots of g(t, y) on dense output with the Illinois method, and detects
  double crossings within one step from slopes. [read: `CB/src/integrate/events.ts:1-12,84-99`]
- `sampleAt` and `traceTo`: drivers that never shorten steps. [read: `CB/src/integrate/sample.ts`, `trace.ts`]
- All of this is float64, adaptive, and heap-allocated (Float64Array buffers, 16 stages × state
  dimension).

### 1.3 Geodesic drivers

- **`Ray`.** Runs one ray to escape (|x| ≥ R) or capture (|x − pᵢ| ≤ 0.01 mᵢ). Both are one event
  function, found exactly on dense output. [read: `CB/src/geodesics/ray.ts:1-14,119-141`]
- **`sampleLightCone` and `sampleLightConeAffine`.** A fan of rays from one event, read at given t (or
  λ) on dense output. Rows that the λ-slice cannot reach are clipped and flagged.
  [read: `CB/src/geodesics/light-cone.ts:1-16,65-146`] A 2048-ray cone with 300 rows takes about 0.1 s
  in Node. [read: `CB/docs/plans/upgrade.md:108-109`]
- **`directions.ts`.** Direction generators (circle, fan). [read: `CB/src/geodesics/directions.ts`]

### 1.4 Diagnostics and trust

- **Time reversal** (`reversalError`): integrate back from the end state and compare with the start. A
  large error flags a sensitive ray. [read: `CB/src/diagnostics/time-reversal.ts:1-13`]
  - Lesson: reverse a captured ray from where it enters the strong field, not from its stop. Infall
    contracts going forward and expands going backward (1.4e-3 against 2.6e-8).
    [read: `CB/docs/plans/upgrade.md:249-254`]
- **Basin maps with trust.** This is a proposal, partly prototyped in ARCH. Each sample runs two
  independent formulations (P in t, Q in τ) at 1e-13, and trust is judged event by event on the
  deciding quantities. [read: `CB/docs/plans/basin-maps.md:89-122`]
  - **Precision horizon:** errors grow like e^{λt} near perpetual orbits, so each digit buys about
    (ln 10)/λ ≈ 13 m of trusted time. Double precision limits the trusted depth.
    [read: `basin-maps.md:133-136`]
- **Variational equations (Jacobi fields).** A proposal, not built in CB. The equations, the exact
  invariants (Gauss lemma, symplectic form) and validation are written out.
  [read: `CB/docs/plans/variational.md:3,21-60`] A version exists in ARCH
  (`ARCH/src/physics/variational.ts`). [read: `ARCH/README.md:1-30`]

### 1.5 Plane modules: closed geodesics, not two-point

- **`polygon.ts`** (Euclidean polygon tools) and **`optical.ts`**. `optical.ts` gives the discrete
  optical length Σ|Δq|U(mid)² with its analytic gradient. [read: `CB/src/plane/optical.ts:1-46`]
- **`homotopy.ts`.** The free homotopy class of a closed polygon in the plane minus n points, as a
  cyclically reduced word in loops round the holes (cuts to infinity).
  [read: `CB/src/plane/homotopy.ts:1-20`] **Planar only.** π₁ of R² minus n points is free; π₁ of R³
  minus n points is trivial. So there is no topological label for 3D images. [reasoning, standard topology]
- **`shorten.ts`.** Minimizes optical length within a class: L-BFGS (`optimize/lbfgs.ts`), a weak Wolfe
  line search (`optimize/line-search.ts`), moves along normals only, and a class-word check on every
  trial. [read: `CB/src/plane/shorten.ts:1-24`]
  - Cost: hundreds to tens of thousands of iterations on 200–300-vertex polygons. The trefoil takes 361
    iterations. The commutator abAB takes 9,969 to 28,860.
    [read: `CB/test/shorten.test.ts:47-75`]
- **Why it is well posed.** For holes in a plane, the optical metric is complete with strictly negative
  curvature, so each nontrivial class has exactly one closed geodesic.
  [read: `CB/docs/plans/closed-geodesics.md:12-17`, citing the owner's write-up]
- **Newton multiple shooting for periodic orbits.** Planned as piece 6. A prototype is archived
  (`ARCH/src/orbits/periodic.ts:1-21`: m nodes plus the period, Gauss–Newton with variational
  derivatives).
  - Lessons from it: the trefoil converges in 3 iterations, about 20 ms. Use about one node per 2 units
    of optical length, clamped to [8, 60]. Put error control on the state only.
    [read: `closed-geodesics.md:81-89`]
- **Status: CPU, float64, planar, for closed rays.** None of this is a point-to-point solver. The
  machinery that would transfer to a two-point solver on the CPU:
  - multiple shooting with variational derivatives;
  - shortening as a seed generator: a two-point version would shorten an open polyline with fixed
    ends, in a homotopy class rel endpoints, which exists only in the plane.

### 1.6 Old GPU code (`CB/code/`)

- **`code/pathtracer`.** A GLSL path tracer in the optical metric. [read:
  `CB/code/pathtracer/glsl/tracer/6Trace/pathTrace.glsl:8-67`, `stepForward.glsl:4-34`,
  `6Trace/geodesicMarch/_metricInfo.glsl`, `saba2-adaptive.glsl`, `forest-ruth.glsl`;
  `CB/code/pathtracer/glsl/tracer/1Setup/uniforms.glsl:38`]
  - No NEE: light is picked up only when a path hits the sky or an emitter.
  - The integrator is SABA2 or Forest–Ruth on the velocity-dependent equation, which is order 1 in
    practice. [read: `CB/docs/plans/upgrade.md:31-36`]
  - Tolerance 1e-2 world units, `maxMarchSteps = 2048`, capture at r_min < 0.01.
- **`code/horizontracer`.** Fixed-step RK4, `maxMarchSteps = 10000`, `maxDist = 200`.
  [read: `CB/code/horizontracer/glsl/tracer/3Trace/geodesics.glsl:64-100`, `1Setup/uniforms.glsl:38-39`]

---

## 2. What the code can do about the two-point problem: precisely

| Capability | Status | Where |
|---|---|---|
| Ray from (x, direction) to escape/capture, float64, adaptive, exact events | built | `src/geodesics/ray.ts` |
| All rays from x at fixed t or λ (the light cone): the forward map direction → position | built | `src/geodesics/light-cone.ts` |
| Derivative of that map (Jacobi fields), needed for Newton and for the pdf Jacobian | proposal (CB); prototype (ARCH) | `docs/plans/variational.md`; `ARCH/src/physics/variational.ts` |
| Solve for a direction at x whose ray hits y | **none** | — |
| Enumerate images (direct, once-around, …) | **none** for open paths. Closed planar loops are labelled by homotopy words. | `src/plane/homotopy.ts` |
| Robustness diagnostics for one ray | built: time reversal, invariant drift U⁴\|v\|² − 1, self-convergence. Planned: P/Q two-formulation trust. | `src/diagnostics/time-reversal.ts`, `light-cone.ts:46-47`, `basin-maps.md §4` |

### 2.1 Measured: a naive two-point solver built from CB's parts

To get real numbers I wrote a throwaway shooting solver. It is not repo code.

- **Method.** DOP853 at 1e-10 with an `EventLocator` on g = (x(t) − y)·v(t). The residual is the
  position at the first closest approach to y. Gauss–Newton over the 2 direction angles, with a
  finite-difference Jacobian (2 extra rays per iteration), backtracking, and a step cap of 0.3 rad.
- **Scene.** Binary holes at (±1, 0, 0) with mass M each. Observer x on |x| = 4, target y on
  |y| = 2.5, deterministic pseudo-random. [measured: `shoot.ts`]

| M | flat-direction guess converges | mean Newton iterations | rays per solve | rhs evals per solve | distinct images found from 200 seeds (20 pairs) |
|---|---|---|---|---|---|
| 0.1 | 197/200 (98.5%) | 4.1 | 13.6 | ≈2,900 | 1–3 |
| 0.5 | 196/200 (98%) | 5.3 | 13.8 | ≈2,000 | 1–5 |
| 1.0 | 189/200 (94.5%) | 6.0 | 15.1 | ≈2,200 | 1–4 |
| 2.0 | 177/200 (88.5%) | 6.6 | 16.2 | ≈2,500 | 2–4 |

Single forward rays in the same code [measured: `measure.ts`, a 400-ray fan from (0.1, 15, 0.2)]:

| Case | rhs evals per ray (mean) | max | wall time per ray (Node) |
|---|---|---|---|
| one hole, tol 1e-6 | 180 | 194 | 0.05 ms |
| one hole, tol 1e-10 | 394 | 419 | 0.06 ms |
| binary m = 2, tol 1e-6 | 239 | 432 | 0.04 ms |
| binary m = 2, tol 1e-10 | 565 | 1,087 | 0.08 ms |

What this shows [measured, then reasoning]:

- **Newton from the flat-space direction usually finds the primary image.** The failure rate (1.5% to
  11.5%) grows with mass. A failure is not an error the estimator can absorb.
- **Even in float64 with an adaptive 8th-order integrator, enumeration is seed-dependent and
  incomplete.** In reality every pair has infinitely many images: there are infinitely many perpetual
  orbits (Shipley–Dolan, `basin-maps.md:18-22`). The residual definition (first closest approach)
  already excludes some of them. Higher-order images need b within e^{−2πk}-type distances of
  critical, which 200 random seeds almost never hit.
- **One solve costs about 14–16 full rays.** A Jacobi-field version would cost about 5–7 rays of a
  3× heavier state.

---

## 3. What could run in a GLSL fragment shader (WebGL2, float32, no compute, no recursion)

Facts about the target:

- GLSL ES 3.00 allows loops with dynamic bounds. [memory]
- Registers are the only fast memory, and there is no per-thread scratch heap. [memory]
- A browser kills GPU work that runs long per draw. [memory] PTG already tiles renders.
- float32 has an epsilon of about 6e-8. [memory]

| Piece | Fits a fragment shader? | Why |
|---|---|---|
| U, ∇U kernel | yes | O(N) flops, already in PTG as the GRIN `ior_at` expression (`demos/blackholeScene.ts:35-38`) and in CB's old GLSL (`_metricInfo.glsl:22-42`) |
| An initial-value ray in the optical metric | yes: **built** in PTG | the GRIN walker: adaptive Verlet with limiters h·n ≤ 0.05 and h·\|∇n\| ≤ 0.05, capture at n > 50, roulette for long traversals (`grin.glsl:36-95`). PT's controller version takes about 180 steps per black-hole ray (`PT/docs/curved-light-blackhole.md:60-66`). |
| DOP853 | no (and should not) | the owner's own plan says "DOP853 does not belong in 32-bit GLSL" (`CB/docs/plans/upgrade.md:241-245`). 13 stages × 6 floats of registers, adaptive rejection loops cause warp divergence, and the tolerances it is used at (1e-10) are below float32 epsilon. |
| Event location on dense output | partially | a bisection on the last step is fine (PTG does 8 bisections at GRIN exits, `grin.glsl:58-60`). Illinois on order-7 dense output is not needed at float32. |
| Jacobi fields (6×2 extra floats) | yes in registers, about 3× the per-step cost | needed for any Newton solve and for an area→solid-angle Jacobian. They grow like e^{λt} near photon spheres (`variational.md:88-92`), which hurts in float32. |
| Newton shooting per path vertex | technically possible, **not reliable** | about 5–16 full marches per solve (§2.1). Iteration counts vary per pixel (divergence). A finite-difference Jacobian is impossible at float32 (h = 1e-6 would be below the noise), so Jacobi fields would be needed. Failures are not deterministic in a way the estimator can account for (§4). |
| Image enumeration (k-th image) | no for MP; yes for spherical symmetry | MP: there is no labelling (3D is simply connected) and the dynamics are chaotic. Spherical: the label is the swept azimuth Δφ = ψ + 2πk or 2π(k+1) − ψ [memory]. |
| Curve shortening and L-BFGS on 200–300-vertex polygons | no | hundreds to tens of thousands of iterations (`CB/test/shorten.test.ts`), arrays per thread, planar topology only |
| Homotopy words | no need | planar only |
| Two-formulation trust (P vs Q), time reversal | CPU only | these are validation tools. Their GPU role is to be the reference that GLSL marches are checked against (`upgrade.md:241-245`). |

---

## 4. Why "reliably" is the crux: what unbiased NEE actually needs [reasoning, not checked]

Suppose NEE samples a point y on a light by area. It then needs three things:

1. **The connecting geodesic(s).** These give the direction ω at x and the arrival direction at y.
2. **The Jacobian dA_y / dω_x.** This converts the pdf to solid angle, for MIS and for the
   contribution. In flat space it is cos θ_y / r². In curved space it is the inverse of a Jacobi-field
   determinant (the magnification of a thin bundle). This is exactly variational.md's derivative.
3. **A rule for which images NEE covers, that the BSDF side can evaluate.** Missing images is not by
   itself bias. MIS stays unbiased when:
   - (a) NEE is defined to cover only a set of image classes K, and
   - (b) a BSDF-sampled ray that hits a light can tell whether its own geodesic lies in K, and
   - (c) for every (x, y) and every class in K, the solver deterministically finds that class's
     geodesic, or deterministically reports that it does not exist.

   If the solver fails in a way that depends on its seed or on float32 noise, the NEE pdf of a path is
   unknown. Then the MIS weights do not sum to 1, which is bias. Avoiding this needs the BSDF side to
   re-run the same solver for every emitter hit, at full solve cost.

For **multi-hole MP**, (b) and (c) fail:

- There is no class label in 3D.
- Naive Newton failed on 1.5%–11.5% of pairs even in float64 (§2.1).
- The images accumulate on a Cantor-like set (`basin-maps.md:18-38`).

So exact NEE cannot be made unbiased at a reasonable cost. **Note and skip.**

For **a spherically symmetric hole** (Schwarzschild, or extremal RN = one MP hole):

- (a)–(c) can plausibly hold. The geodesic from x to y lies in the plane through x, y and the center
  [memory]. Image k satisfies Δφ(b; r_x, r_y) = ψ + 2πk or 2π(k+1) − ψ [memory]. On each branch this is
  a 1D root find for the impact parameter b, and Δφ is given by an elliptic integral [memory].
- The BSDF side can label its own geodesic by accumulating the swept azimuth during the march
  [reasoning].
- The Jacobian is closed-form from dΔφ/db and the out-of-plane factor sinΔφ / sinψ [memory+reasoning,
  not checked].
- float32 limits K. Image k needs (b − b_c)/b_c of about e^{−γk}:
  - The ratio between successive images is e^{2π} ≈ 535 for Schwarzschild [memory: Bozza's strong-
    deflection limit].
  - It is e^{√2π} ≈ 85 per orbit for extremal RN. [read: the photon-circle multiplier μ = e^{π√2}
    in `closed-geodesics.md:57`, consistent with λ = 1/(4√2 m) × period 8πm]
  - So K = 1, perhaps 2, is resolvable in float32. The remaining images carry a share below
    1/535 (Schwarzschild) or 1/85 (RN) of each image family and are left to BSDF sampling with MIS
    weight 1. [reasoning]
- **The shadow ray is still a full curved march.** Visibility must be tested along the bent geodesic
  through the scene's SDFs. So an exact NEE sample costs at least one march, the same as a BSDF ray.
- There is also an analytic-versus-marched mismatch: the analytic geodesic and the float32 marched ray
  differ by integration error. This is a consistent bias of the same order as the march error that
  every curved ray already carries. It would have to be declared. [reasoning]

**The simpler alternative, which needs none of (1)–(3) for area lights: forward aimed direction sampling.**

- At x, draw ω from a mixture of the BSDF lobe and a cone or lobe aimed at a *guess* of the light's
  apparent direction. Trace ω forward like any bounce, and weight by f / p_mix(ω).
- p_mix is known in closed form in solid angle at x. So the estimate is unbiased however bad the
  guess is; the guess only affects variance. No two-point solve, no Jacobian, no enumeration.
- The owner built exactly this in PT: "no shadow ray, no connection, so no two-point problem in curved
  space (the cone is just a worse guess there)". It measured 1.7–7.8× fewer samples on flat room
  scenes, and image energy matched to 0.1%. [read: `PT/docs/light-sampling-deferred.md:3-12`]
- Guesses:
  - **Schwarzschild or one hole:** the primary-image direction from the 1D root find (cheap: about 20
    iterations of an elliptic-integral evaluation, no march). [reasoning]
  - **Weak fields:** the flat-space direction.
  - **Multi-hole MP:** a CPU-precomputed per-light 3D table of first-arrival directions. CB's
    `sampleLightCone` from the light's center gives this by reversibility. At the measured 0.04–0.08 ms
    per ray in Node, 10⁵ rays take about 5–10 s [extrapolated, not measured]. A stale or coarse
    table only costs variance. [reasoning]
- **Limits:**
  - Delta lights cannot be hit by forward tracing. In curved regions they need an exact solve (feasible
    only with spherical symmetry) or must be declared unsupported.
  - A lensed light appears as a stretched arc, which a round lobe matches poorly. The cost is variance,
    not bias.

---

## 5. Things a black-hole occupant in PathTracerGLSL must get right (found while reading)

- **`ambient_direction_to(from, to)` assumes a unique connecting geodesic.** It is the seam's
  two-point call. [read: `PTG/src/components/ambient/README.md:10-14`] Black holes (and quotients)
  break uniqueness. The seam would need either a per-image interface or a rule that this space offers
  no connections, so NEE is disabled or aimed-forward only. [reasoning]
- **Radiometry is not the same in the glass analog and in the spacetime** [reasoning, not checked]:
  - In PTG the bent region is a dielectric: basic radiance L/n² is invariant (`impl-plan-grin-media.md`
    batch 1). In the spacetime, static observers see I_ν/ν³ invariant, with redshift 1/√(−g_tt).
  - **MP:** −g_tt = U⁻² and n = U², so the GR bolometric factor U⁴ equals n². The two agree.
  - **Schwarzschild in isotropic coordinates:** −g_tt = A², g_spatial = B²δ, n = B/A, with
    A = (1 − M/2r)/(1 + M/2r) and B = (1 + M/2r)². GR gives A⁻⁴, the analog gives B²/A², and
    AB = 1 − M²/4r² ≠ 1. The two **disagree**.
  - Spectral redshift also exists in GR and not in the analog.
  - So "Schwarzschild as GRIN" is the right ray geometry with the analog's radiometry, not the
    spacetime's. This should be declared, or the occupant should carry the redshift.
- **Schwarzschild as a GRIN field.** n = (1 + M/2r)³ / (1 − M/2r), horizon at r = M/2 (n → ∞),
  photon sphere at isotropic r = (1 + √3/2)M ≈ 1.866M. [memory, with the photon-sphere radius
  re-derived from R = r(1 + M/2r)² = 3M] The PTG walker's capture test (n > 50) and limiters would
  apply unchanged. The field is negative inside r < M/2, so capture must trigger first. [reasoning]
- **Validation.** CB's DOP853 rays are the natural reference for GLSL march error, as the owner
  planned (`upgrade.md:241-245`). PTG's TS twin already pins the MP field: Bouguer conserved through a
  flyby, and weak-field deflection 4M/b within 2%. [read: `PTG/src/components/transport/volume/grin/grin.md:105-109`]

## 6. Relation to quotients [reasoning, brief]

The two-point problem in a quotient of E³, S³ or H³ has the structure MP lacks:

- Images are indexed by group elements.
- Each image is a closed-form geodesic in the universal cover.
- The number of images within distance R grows polynomially in E³ and exponentially in H³.

Conditions (a)–(c) of §4 can therefore hold, with K = {group elements within a radius} and the BSDF
side labelling its ray by the deck transformations it accumulated. So quotients are a different and
much more tractable case than MP, and should not be judged by this note.

## 7. Open questions

1. Is a spherically symmetric hole worth an exact NEE (for delta lights), or is aimed forward sampling
   enough? An exact NEE would cost the 1D root find, the Jacobian and image labelling.
2. Should a black-hole scene in PTG be the glass analog (current) or the spacetime with redshift? This
   matters for Schwarzschild, not for MP.
3. Monotonicity of Δφ(b) on each branch for observer and source at arbitrary radii, including inside
   the photon sphere. I believe it holds; it is not checked.
4. How much variance does aimed sampling actually save near a strongly lensed light? This needs a
   measurement in PTG before anyone recommends it.
