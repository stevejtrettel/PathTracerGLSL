# impl-plan-grin-interface.md — hard refractive interfaces for GRIN regions

**Status: BUILT Jul 22 2026 — GPU-UNSWEPT** (gates: tsc clean; **1304 vitest** incl. 191
glslang pairs + the 3 new validator rules; generated-glsl snapshots regoldened with the diff
read — churn is exactly the `ior_of(int region, vec3 p)` signature/call sites in 17
transmission programs and the `MediumSample.eta_scale` field/inits in 13 media programs.
Witnesses `grin-glass`/`grin-glass-ref`/`grin-furnace-hard` + demo `glassball` land ready;
the sweep is owner-gated). Builds the deferred
`fable-variable-ior.md` §7 item 1: a GRIN region behind a real Snell/Fresnel wall — refract in
with the local n(x) at the hit point, integrate the ray ODE inside, refract out (or TIR back in)
with the local n at the exit point. Closes the interior basic-radiance (L/n²) gap at the same
time. Design authority stays `docs/fable-variable-ior.md`; this doc is the build record.

## The shape (approved in discussion, Jul 22)

NOT a rebuild — the v1 skeleton (MediumSample.deflected seam, Verlet walker occupant, glass
rule, delta bookkeeping) survives intact. Three structural changes, each a simplification:

1. **One IOR concept** — `ior_of(int region)` grows a point: `ior_of(int region, Point p)`.
   Constant dielectric rows ignore `p` (fold away, near-byte-identical); a region whose material
   carries a deflecting medium emits the medium's `ior` formula evaluated at `p`. Snell/Fresnel
   at a curved-index wall is ordinary Snell with the LOCAL n⁻(x), n⁺(x) — the discontinuity is
   normal to the wall, tangential eikonal matching gives exactly this. `dielectric_sample` is
   otherwise unchanged; `ior_at(med, p)` stays as the gradient projection of the same one
   authored formula (material-indexed vs region-indexed — two generated views, one truth).

2. **The walker stops owning the boundary.** Both interfaces route through the surface
   machinery: authoring is `{ model: 'dielectric', medium: { ior: <formula> } }`. Entry is a
   plain surface hit (Fresnel/refract/η² with n at hit.p — nothing new). Exit: the walker
   returns the bent ray from just INSIDE the wall; the walk spawns it WITHOUT flipping
   `current_medium`; the next iteration's `scene_intersect` hits the wall from inside and the
   same dielectric handles exit Fresnel with n at the exit point. TIR falls out free (reflection
   branch → back into the region → walker resumes; whispering-gallery orbits bounded by
   maxBounces). The `model: 'none'` wall remains the declared continuous-n mode (v1 unchanged).

3. **The interior basic-radiance factor.** Along a curved ray in varying n, L/n² is invariant.
   Camera-path throughput over the interior carries (n_in/n_out)² = (|T_in|/|T_out|)² — free,
   |T| = n is carried by the walker. Books close: enter (1/n_A)² · interior (n_A/n_B)² · exit
   (n_B/1)² = 1 for a lossless region. Applied unconditionally (→ 1 under the v1 n→1-at-wall
   contract, so existing witnesses hold; also heals continuous fields that don't quite reach 1).
   Mirrored into `eta_scale` for the §7.2 RR metric, like the surface transmission site.

**The routing rule:** a NUMBER is an interface property (region table, straight interior, no ODE
code emitted); a FORMULA in the medium block is a field (same wall refraction, evaluated at the
hit point, PLUS the deflecting mark that conjures the walker). Compile-time fork; per-material
dispatch. A constant-formula medium ior deliberately routes through the walker (∇n = 0, straight
line) — that degenerate case is the sharpest witness (≡ plain glass).

## Mechanics pinned during the audit

- **Exit-spawn epsilon**: `EPSILON = 0.001` and primitives reject `t ≤ EPSILON`, but the v1
  bisection places the exit point within h/2⁸ ≈ 8e-5 of the wall — BELOW the floor, the wall hit
  would be missed. The exit convention therefore PULLS BACK: bisect the crossing as today (8
  iters, accurate bracket), then return the inside point 2·EPSILON of world distance BEHIND the
  bracketed crossing (fraction clamped ≥ 0). The straight micro-segment (~0.002 ≈ GRIN_STEP/10)
  is below integrator truncation; the wall hit lands at t ≈ 2·EPSILON > EPSILON robustly. Clamp
  hits 0 only under grazing-tangent crossings — the walker then returns the step start and
  simply retries next iteration (bounce-budget-bounded, never silent).
- **The t_max guard** (kills the near-wall relaunch loop): the GRIN arm now RESPECTS t_max — if
  the straight-line boundary is within one step (t_max ≤ n·GRIN_STEP), return a plain
  transmitted outcome (Beer–Lambert over t_max, no deflection); the walk falls through to the
  surface hit and the wall material fires. Sub-step segments fly straight — below the
  integrator's resolution anyway; declared, consistent truncation.
- **`MediumSample` grows `float eta_scale`** (RR-metric compensation for whatever η² compression
  the arm folded into `weight`; 1.0 in every non-GRIN arm — same every-arm-assigns rule that the
  `deflected` init bug taught; the generated dispatcher preamble initializes it, occupant arms
  assign it). The walk's deflected branch applies it under `f.transmission`.
- **Region-table rows for deflecting materials are emitted regardless of wall model** ('none'
  too): correct for the (deferred) nested case, ≈ 1.0 under the v1 wall contract, and exact
  linkage keeps `ior_of` out of programs with no transmission — zero churn for existing
  'none'-wall GRIN scenes.
- **Validator**: a material may not author BOTH a surface `ior` row and `medium.ior` — the
  interface index comes from the medium formula (one truth; the schema default 1.5 is
  superseded by the formula in the table generator, only an EXPLICIT authored row errors).
  Existing v1 rejections (σ_s+ior, emission+ior) unchanged.

## Tasks

- **T1 — ior unification.** `generateIorOf(...)` → `ior_of(int region, Point p)`; deflecting
  materials' rows emit the medium formula (medium.ior wins over the row value); call sites
  `dielectric.glsl` (`hit.p`) + the pt.ts eta_scale site; provides/requires signatures; the
  Validator one-truth rule + tests; snapshots regoldened (churn = signature + rows only,
  diff-verified).
- **T2 — interior factor.** `MediumSample.eta_scale`; grin arm: `weight ×(|T_in|/|T_out|)²`,
  `eta_scale = (|T_out|/|T_in|)²` on ALL exits (bisected, exhausted); every other arm assigns
  1.0 (dispatcher preamble + analytic/delta_tracking occupant constructors); walk branch
  `s.eta_scale *= ms.eta_scale` gated on `f.transmission`.
- **T3 — boundary demotion.** grin.glsl: the t_max guard; inside-exit with the 2·EPSILON
  pull-back; pt.ts deflected branch stops flipping `current_medium` (stays inside — the wall
  hit owns the crossing); comments updated (the walker walks, the wall's material decides).
- **T4 — witnesses + demo.** `grin-glass-twin`: constant-formula GRIN sphere vs plain
  dielectric sphere (same scene geometry, the full new pipeline vs the GPU-verified F-ETA-class
  machinery; rmse tripwire at the pinned salt, converged equality = owner's check).
  `grin-furnace-hard`: Fresnel-walled Luneburg ball in the F-BOX-M furnace holds 0.4/channel
  (lossless reciprocal wall + measure-preserving interior + the L/n² factor + TIR). Existing
  grin witnesses must stay green untouched. Demo: glass-walled Luneburg (visible Fresnel).
- **T5 — docs + memory.** fable-variable-ior.md §3/§7 status, grin.md, memory update.

## Gates

tsc + targeted vitest per task; full `npx vitest run` (incl. glslang static compile of the new
pairs) once at the end; snapshot re-golden with the diff read and stated. GPU witness sweep is
OWNER-GATED — witnesses land ready, unswept.

## Deferred (unchanged ledger)

Scattering/emission inside a deflecting region (bent-arc null-collision), embedded geometry
(curved-ray intersection), dispersion n(λ), adaptive/per-region step size, rough GRIN walls.
