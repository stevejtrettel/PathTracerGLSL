# Gradient-index (GRIN) volume walker — what it computes and why

The deflecting volume arm (`fable-variable-ior.md`): a region whose refractive index `n(x)`
varies, so light does not travel straight — it follows a geodesic of the optical metric
`g = n²(x)·δ`. Instead of sampling a scatter/absorb event on a straight segment, this occupant
**integrates the ray ODE until the ray leaves the region** and hands back the bent exit ray.
It is the tracer's first curved-space walk, contained behind the `medium_sample` seam.

## The equation (Sharma, Kumar & Ghatak 1982 — transcribe, don't re-derive)

State `(r, T)` with `T = n·(unit tangent)` (so `|T| = n`):

```
dr/dt = T
dT/dt = n·∇n        arc length ds = n·dt
```

Rays bend toward higher `n` (a mirage bends light toward the cooler, denser air). `∇n` is
central finite differences of `ior_at(med, p)` — the same trick the SDF
marcher uses for normals. `|T| = n` is a conserved sanity check; for a spherically-symmetric
`n(r)`, **Bouguer's invariant** `|r × T| = n·r·sin φ` is conserved (the GRIN analog of angular
momentum) — `grin.test.ts` verifies it (the reference-free correctness gate) and that a
constant `n` gives a straight line.

## Integrator — velocity Verlet (leapfrog), symplectic

The force `n·∇n = ∇(n²/2)` depends only on POSITION, so the ODE is the Hamiltonian system
`r'' = ∇Φ` with potential `Φ = n²/2` — and the conserved energy `½(|T|²−n²) = 0` is exactly the
`|T| = n` invariant. Velocity Verlet is the natural integrator for it: **one force evaluation
per step** (half-kick → drift → half-kick, the end force reused as the next start), vs four for
RK4, and it's **symplectic** — `|T|=n` stays bounded and etendue/brightness stay honest over long
paths (RK4 drifts). The gradient itself is still central differences (6 `ior_at` calls), so a
step costs ~7 `ior_at` — a 4× cut from RK4's ~28. Analytic `∇n` (autodiff the `ior` formula) is
the further, exact refinement.

## `medium_sample_grin(med, ray, t_max, xi)` — the deflected arm

Each step: half-kick/drift/half-kick, accumulate per-step Beer–Lambert absorption `exp(−σ_a·ds)`
(σ_a colored, read by VALUE via `scene_medium_properties` — see the two-accessor note below),
and exit the moment `scene_region_at` leaves `med`. The exit (impl-plan-grin-interface): the
crossing drift segment is **bisected** (`GRIN_BISECT_ITERS`) to bracket the wall, then the
returned point is **pulled back `GRIN_EXIT_PULLBACK` along the drift** so it sits strictly
INSIDE the region — the pull-back is keyed to the WALKER'S OWN bisection residual and a
marched wall's acceptance band, never to fp (impl-plan-epsilon-discipline; coupling pinned in
epsilonCoupling.test.ts) — with the wall hit at t ≈ the pull-back in all
geometries including grazing (the pull-back is along the RAY, so the hit distance is
angle-independent to first order). The walk spawns the bent ray WITHOUT flipping
`current_medium`; the next iteration's surface hit owns the crossing — **the walker walks, the
wall's material decides the interface**. `t_max` is respected as a guard: a wall within one
step returns a plain straight-transmitted outcome (this terminates the near-wall handoff).
The walker also applies the **interior basic-radiance factor** `(n_in/n_out)²` (L/n² invariant
along the curved ray; `= (|T_in|/|T_out|)²`, free) and reports its inverse in `ms.eta_scale`
for the §7.2 RR metric. `xi` unused: no random choice — the path is **deterministic**, no
Monte-Carlo bias, only Verlet truncation bounded by `GRIN_STEP`.

## One ior, two accessors

Since the hard-interface batch there is ONE authored index — the medium's `ior` formula — with
two generated projections, consumed differently:
- **At the wall** — `ior_of(region, p)` (region table, point-evaluated), read by VALUE for
  Snell + Fresnel in `dielectric.glsl`: a deflecting region's row is the medium formula at p;
  a constant dielectric's row ignores p. One truth — authoring BOTH a surface `ior` row and
  `medium.ior` is Validator-rejected.
- **Inside** — `ior_at(med, p)` (this occupant's accessor), read by GRADIENT (the ray bends by
  `∇n`, sampled at many nearby points per step). It is NOT a `MediumProperties` field (that
  struct bundles the value-consumed σ_a/σ_s/ε) — a gradient-consumed field earns its own cheap
  accessor.

## Scope and knobs

- **The wall's material decides the boundary** (impl-plan-grin-interface): `model: 'none'` =
  continuous n (author asserts n → 1 at the wall; Fresnel-free pass-through — the v1 mode);
  `model: 'dielectric'` = hard interface (Snell/Fresnel/TIR with the local n at the hit point).
- **Emission** (impl-plan-grin-media batch 1): collected PER STEP in the Verlet loop — the
  E1.5 closed form each step (telescopes exactly for constants) × the **(n₀/n)² source
  factor** (radiance inside index n is n²·L — Kirchhoff; `grin-furnace-emit` pins it).
  Expression ε needs no majorant here (the walker paces by the ODE, not σ̄).
- **Scattering** (batch 2, CONSTANT coefficients): `medium_sample_grin_scatter` — the analytic
  arm's channel-MIS with t → ARC LENGTH (draw up front, the walk finds where the arc lands;
  survive weight at the discovered exit; every outcome × the interior (n₀/n)² factor). The
  scatter event's position + incident direction ride `exit_p`/`exit_dir` (the EVENT RAY —
  every scattering arm fills them; the walk no longer recomputes a straight-line point).
  Emissive scattering in one region and expression σ under bending stay rejected (declared).
- **Geometry-free interior** (a bent ray hitting embedded surfaces is the deferred
  curved-ray-intersection problem).
- **THE GLASS RULE** (estimator policy): the region is a specular refractor — the walk records
  the deflection as a DELTA event (bent emitter hits score full weight) and shadow rays see the
  region as OPAQUE (`medium_transmittance` = 0; NEE cannot sample bent connections — straight
  transmittance would be the model bias the glass-shadows decision ruled out).
- **The step is ADAPTIVE** (Jul 22, transcribed from the reference odeMarch — pulled by the
  Majumdar–Papapetrou black-hole demo): `h = min(GRIN_STEP, GRIN_DS_MAX/n, GRIN_DTOL/|∇n|)`,
  n from the carried `|T| = n` invariant, one force eval preserved. With a FIXED parameter
  step the coordinate jump `h·n` diverges near a black-hole point (n → ∞) — the ray leaps
  the strong field and renders concentric rings. Far from mass neither limiter binds and
  `h = GRIN_STEP` — smooth/weak media unchanged.
- **Capture**: `n > GRIN_CAPTURE` (≈ 50) returns a zero-weight terminator — the ray reached
  the horizon; for a single MP hole this is r < M/6, well inside the photon sphere at r = M,
  so terminating there is EXACT for the image. The shadow is dynamics, not drawn geometry.
  Inert for weak fields (Luneburg peaks at √2). The TS twin pins the MP field end to end
  (Bouguer through a strong-field flyby + GR's weak-field deflection 4M/b within 2%).
- Knobs: `MAX_ODE_STEPS` (512 — exit-bound budget; exhaustion = conservative pass-through),
  `GRIN_STEP` (the smooth-field step ceiling), `GRIN_DS_MAX`/`GRIN_DTOL` (the strong-field
  limiters), `GRIN_CAPTURE`, `GRIN_BISECT_ITERS` (exit refinement depth). All `#ifndef`-
  guarded; per-region scale-DERIVED defaults are the remaining plan-time polish.
- **Spectral-ready:** the `ior` formula gains a wavelength `λ` when the spectral axis lands
  (dispersion `n(λ)`), with nothing to change here now.
