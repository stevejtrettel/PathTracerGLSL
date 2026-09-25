# fable-variable-ior.md — variable-IOR (gradient-index) media

> **Sep 25 2026 fix:** the walker's exit test compared a region id with the material id the
> dispatcher passes, so a GRIN region whose region and material ids differ rendered black
> (the four furnaces read ~0.30). It now tests the material at the point (`grin_inside`).
> All GRIN witnesses pass, including the furnaces; see tests/witnesses/README.md §A.

**STATUS: BUILT & GPU-verified Jul 21 2026** — the tracer's first curved-space feature.
**HARD-INTERFACE BATCH BUILT Jul 22 2026 — GPU-UNSWEPT** (`docs/impl-plan-grin-interface.md`):
the §7 "hard refractive interface" item is now built — `ior_of(int region, Point p)` (one ior
truth: a deflecting medium's formula IS the region's interface index, evaluated at the wall
point), the walker demoted to interior-only transport (inside-exit handoff with the 2·EPSILON
pull-back + the t_max straight-transmit guard; the wall's MATERIAL decides the interface —
'none' pass-through or dielectric Snell/Fresnel/TIR), and the interior L/n² basic-radiance
factor (`MediumSample.eta_scale`, mirrored into the §7.2 RR metric). Witnesses grin-glass twin
+ grin-furnace-hard AWAIT the owner's sweep; §2.1/§3/§5 below are amended in place.
Resolutions (forks §8): (a) **extend `MediumSample`** with a `deflected` outcome + exit ray
(the `medium_propagate` seam struck as over-purification); (b) small v1 scope; (c) `ior` a
formula field, **spectral-ready**; (d) **velocity Verlet (leapfrog)** — the ray equation is
Hamiltonian (`r'' = ∇(n²/2)`), so a symplectic integrator is the right default: one force eval
per step (4× fewer than RK4) AND it preserves `|T|=n`/etendue (RK4 was the initial pick, revised
when the structure was seen). `MAX_ODE_STEPS` budget.

**Two IORs, kept separate (owner-clarified):** glass = `ior_of(region)` read by VALUE at a
dielectric interface (Snell/Fresnel — unchanged); GRIN = `ior_at(med, p)` read by GRADIENT inside
a region (the ray bends by ∇n). The GRIN index is its OWN accessor, NOT a `MediumProperties` field
(that struct bundles the value-consumed σ_a/σ_s/ε) — a gradient-consumed field earns a gradient
accessor. Neither the glass path nor the fog value-fields change.

**Build record:** Stage 1 (data path) `MediumDescription.ior` (optional; σ_a also made optional)
→ `PlannedMedium.ior` (resolveMedium) → `MediaDesc.deflecting` (Planner) → `MediumProperties.ior`
field (core.ts) + emitted in `scene_medium_properties` (materials.ts, raw scalar, no clamp) +
`ior` slider minting + Validator (accept `ior` expr sans majorant, reject σ_s+ior). Stage 2/3:
`MediumSample` grew `deflected/exit_p/exit_dir` (every arm assigns `deflected`); the GRIN arm is a
compile-time dispatch inside `medium_sample` (`mediumIsDeflecting`); `components/transport/volume/
grin/grin.glsl` is the velocity-Verlet walker (Sharma 1982 — (r,T), ∇n central-diff,
`scene_region_at` exit, Beer–Lambert absorption, `MAX_ODE_STEPS` 256); the generated `pt.ts` walk
gained the `f.deflecting` branch (spawn the bent exit ray, recompute `current_medium`; the
traversal consumes a bounce — the budget that bounds trapped closed orbits). Entry via
the existing null-interface pass-through. **Post-review batch (Jul 21): THE GLASS RULE** — a
deflecting region is estimator-policy-wise a specular refractor: the deflection records as a
DELTA event (`kernel_record(…, true)` in the walk branch, so bent emitter hits score full weight
in nee/mis), and the region is **opaque to shadow rays** (`medium_transmittance` returns zero —
a straight ray reporting transmittance through a bending region is the model-bias class the
glass-shadows decision ruled out; rides the same declared `measurement.shadows` truncation).
Emission on a deflecting medium is **Validator-rejected** (the GRIN arm zeroes `ms.radiance`;
rejection beats a silent drop — per-step collection along the bent path is the small follow-up). Gates: tsc, **1274 vitest**, glslang (188 pairs incl.
`grin`), the `grinOde` TS twin (Bouguer's invariant conserved < 1e-3 + straight at const n —
the ODE is the correct equation), and a **GPU render of the Luneburg `grin` demo showing the
checker floor visibly bent** through the invisible lens. Deferred numeric gates: the render
witnesses of §6 (F-LUNEBURG focal-point, F-MIRAGE arc) as owner-gated sweeps.

## 0. What this is, in one breath

A region of space where the refractive index `n(x)` varies continuously, so light **bends
along a curved path** through it (gradient-index / GRIN optics: mirages, Luneburg lenses,
atmospheric lensing). Built as the owner framed it: a **plug-and-play volumetric region
walker** — today a volume region says "scatter until you leave"; a variable-IOR region says
"integrate the ray ODE until you leave." Same enter → walk → exit slot, different inside
behavior. **The ambient space stays flat; only rays *inside* the region bend.**

This is deliberately the tracer's **first curved-space feature, in its gentlest form.** A GRIN
medium *is* a conformally-flat metric `g = n²(x)·δ` confined to a region — no coordinate
singularities, no horizons, and contained so the rest of the scene stays fast. It builds the
geodesic-integrator machinery that H³/Nil/Schwarzschild will reuse, sandboxed. (The global
`ambient_*` metric seam — trace-loop-contract §"the Riemannian metric" — stays untouched here;
the global generalization is the future non-Euclidean work this de-risks.)

## 1. The physics — transcribe, don't re-derive

Rays in `n(x)` follow geodesics of `n²·δ` — the eikonal/Fermat ray equation. The numerically
clean integrable form is **Sharma, Kumar & Ghatak 1982, "Tracing rays through graded-index
media" (Appl. Opt. 21(6))** — state `(r, T)` with `T = n·(unit tangent)`, stepped in a
parameter `t`:

```
dr/dt = T
dT/dt = n·∇n           (arc length ds = n·dt;  |T| = n is the conserved sanity check)
```

Rays bend toward higher `n` (a mirage bends light toward the cooler, denser air). `∇n` comes
from the authored `n(x)` formula by **central finite differences** — exactly how the SDF
marcher already takes gradients for normals (`scene_normal`, `raymarch.glsl`). The system is
Hamiltonian (`r'' = ∇(n²/2)`), so **velocity Verlet** integrates it (§5, fork d); the path is
**deterministic** given the entry ray + field.

## 2. Where it plugs in (grounded in the survey)

The medium machinery is a compiler-generated **seam layer** over static occupant `.glsl`
files; the transport walk is itself generated by `pt.ts`. GRIN mirrors the `delta_tracking` /
`analytic` occupants.

- **A GRIN region IS a medium** — an object whose material carries a `medium` block with an
  `ior` field. `material_has_medium(region)` is true, so the walk's medium branch fires
  (`pt.ts:145-194`). A compile-time flag marks the medium as **deflecting** (has `ior`).
- **Point-evaluated IOR, not the region table.** `ior_of(region)` (`intersection.ts:1082-1110`)
  is region-indexed with no shading point and *already rejects* spatial expressions — right
  for dielectric interfaces, wrong for GRIN. Variable `n` rides the point-of-entry that already
  exists for spatial medium data: **`scene_medium_properties(int mat, vec3 p)`**
  (`materials.ts:472-530`), extended with an `ior` field, authored as a `GlslExpression` over
  `p` via the existing `mediumPropertyExpr` (`materials.ts:458-470`). `∇n` = finite differences
  of that accessor.
- **The walker is an occupant** — `components/transport/volume/grin/grin.glsl`, providing the
  velocity-Verlet integrator. It reads `ior_at(med, p)` (the dedicated gradient-consumed accessor)
  and finite-differences it per step, advances the point in the Euclidean drift between kicks,
  and **detects exit itself** by watching `scene_region_at(p)` (`intersection.ts:833-896`) leave
  the region. A traversal is one event of `measurement.maxBounces` however long it is; long and
  trapped traversals end by the walker's own unbiased roulette (every `GRIN_ROUND_STEPS` = 512
  steps, survive with probability 0.9, survivors divided by it), with a hard stop at 200 rounds
  that a traversal reaches with probability ≈ 8·10⁻¹⁰ (grin.glsl header, taxonomy §4.1).
- **Entry / exit via NULL interfaces** (`pt.ts:200-211`). With continuous `n` (§3), the region's
  boundary has no index jump, so it's the existing invisible-container wall (`model:'none'`): the
  ray passes through with no Fresnel, `current_medium` flips to the GRIN region, and the walk's
  next iteration sees a deflecting medium. The walker marches to the boundary and leaves the ray
  pointing in its **bent exit direction**; the null-interface crossing then updates
  `current_medium` back to outside. Reuses the bounded-fog machinery wholesale.

### 2.1 THE ONE CONTRACT CHANGE — extend `MediumSample` (fork §8a, RESOLVED)

`MediumSample` (`structs_media.glsl:12-18`) has **no direction field** — its two outcomes are
`scattered=true` (the walk's `kernel_phase` *samples* a new direction) or transmitted (ray
continues *straight*). GRIN is neither: it produces a **deterministic bent exit ray** (new
position AND direction). Crucially, why the existing outcomes can't carry it: scattering's event
*position* is recomputed by the walk as the straight-line point at `ms.t` (a scatter ray flies
straight *between* events), and its *direction* is sampled afterward by `kernel_phase`. GRIN's
exit position is on the **bent** path (not recomputable from a straight ray) and its direction is
the **deterministic ODE tangent** (not sampled). So both must ride back in the return value.

**Resolution: grow `MediumSample` a third outcome** (a distinct `medium_propagate` seam was
considered and struck — it carries the identical payload for more surface):
```glsl
struct MediumSample {
    bool     scattered;   bool deflected;   // deflected = GRIN exit (exit_p/exit_dir valid)
    float    t;           Spectrum weight;   Radiance radiance;
    Point    exit_p;      Direction exit_dir;   // NEW — valid iff deflected
};
```
The GRIN walker is just another arm inside the existing `medium_sample` **compile-time**
dispatch (a deflecting medium's arm IS the GRIN arm — no runtime deflecting-check). The generated
walk gains ONE branch, before the scatter/transmit handling — **amended by the hard-interface
batch (Jul 22)**: the walker returns the bent ray from just INSIDE the wall and the walk spawns
it WITHOUT flipping `current_medium` — the next iteration's `scene_intersect` hits the boundary
from inside and the wall's MATERIAL owns the crossing ('none' pass-through, or dielectric
Snell/Fresnel/TIR with the local n). The interior η² compression rides `ms.eta_scale` into the
§7.2 RR metric:
```glsl
s.throughput *= ms.weight;
if (ms.deflected) { kernel_record(s, 1.0, ms.exit_p, true);       // delta event (glass rule)
                    s.eta_scale *= ms.eta_scale;                   // interior L/n² (§7.2)
                    s.ray = make_ray(ms.exit_p, ms.exit_dir); continue; }   // consumes a bounce
```
`t_max` (the straight-line boundary from `scene_intersect`) is now **respected as a guard**: if
the wall is within one integration step, the arm returns a plain transmitted outcome (straight,
Beer–Lambert) so the walk falls through to the surface hit — this terminates the near-wall
handoff without relaunching the walker on sub-resolution segments. Entry needs nothing new
under either wall model: a 'none' wall is the null-interface pass-through (`pt.ts:200-211`); a
dielectric wall is an ordinary surface refraction whose `ior_of(region, hit.p)` reads the
medium's formula at the hit point. TIR at exit falls out free (the reflection branch sends the
ray back inside; the walker resumes; maxBounces bounds whispering-gallery orbits).

## 3. The boundary model — the wall's material decides (amended Jul 22)

Two wall models, both live; the walker is identical under both (interior-only transport):

- **`model: 'none'` — continuous `n`** (the v1 mode, unchanged): the author asserts `n → 1`
  (more precisely, → the ambient index) at the region's surface. No index discontinuity → no
  Fresnel, no Snell — the ray bends smoothly in and out through the null-interface
  pass-through. The mirage/atmosphere/Luneburg case. (The assertion is the author's — a
  formula that doesn't reach 1 at the wall now degrades gracefully: the interior L/n² factor
  is always applied, only the missing interface terms are approximated.)
- **`model: 'dielectric'` — hard interface** (Jul 22): real Snell + Fresnel + TIR at the wall
  with the LOCAL index on each side — `ior_of(region, p)` evaluates the medium's formula at
  the hit point (physically exact: the discontinuity is normal to the wall, so tangential
  eikonal matching gives ordinary Snell with n⁻(x), n⁺(x)). Entry, exit, and TIR all ride the
  unchanged `dielectric_sample` (η² factor, delta bookkeeping, NEE guards included). **One ior
  truth**: a material carrying a deflecting medium may not ALSO author a surface `ior` row
  (Validator-rejected); the medium's formula is the interface index. The routing rule — a
  NUMBER is an interface property (region table, straight interior, no ODE code emitted); a
  FORMULA in the medium block is a field (same wall refraction + the deflecting mark).

## 4. Authoring

```ts
// A GRIN blob: an object whose (non-optical) material carries a deflecting medium.
{ type: 'sphere', parameters: { center: [...], radius: R }, material: 'lens' }
materials: {
  lens: { model: 'none', medium: {
    ior: { kind: 'glsl', source: 'sqrt(2.0 - dot(p,p)/(R*R))', params: [...] },  // Luneburg
    // optional colored absorption along the bent path:
    sigma_a: [0.0, 0.02, 0.05],
  } },
}
```

`ior` is a scalar `GlslExpression | number` over `p` (constant `n` ⇒ no bending, a valid
degenerate case). Presence of `ior` marks the medium deflecting. `sigma_s` (scattering) on a
deflecting medium is **rejected in v1** (§7).

**Spectral-ready (owner, Jul 21):** the `ior` formula's input vocabulary is designed to gain a
wavelength `λ` the day the spectral axis exists — the accessor `scene_medium_properties(mat, p)`
gains a `float lambda` arg exactly as `uv` was threaded into `scene_material_properties`, and a
dispersion formula like `1.5 + 0.004/(λ*λ)` (Cauchy) then compiles. Nothing is built for this now
(RGB v1 has no `λ` in scope, so a `λ`-referencing formula simply won't compile); the point is the
design must not preclude it — and it doesn't (one-arg extension, same move `uv` used).

## 5. Correctness

- **No Monte-Carlo bias from bending** — the path is deterministic (like a mirror reflection).
  Verlet introduces *numerical* error (not estimator bias), bounded by step size; the estimator
  stays unbiased in expectation (MC only re-enters with scattering, deferred).
- **Absorption along the bent path** = per-step Beer–Lambert `throughput *= exp(-σ_a(p)·ds)`
  accumulated over the Verlet steps — deterministic, per-channel (colored).
- **The interior basic-radiance factor (Jul 22):** along a curved ray in varying n, **L/n² is
  invariant** (the continuous form of the interface η² law). Camera-path throughput over the
  interior carries `(n_in/n_out)² = (|T_in|/|T_out|)²` — free, since |T| = n is carried. The
  books close: enter (1/n_A)² · interior (n_A/n_B)² · exit (n_B/1)² = 1 for a lossless region.
  Verlet being symplectic is what makes this exact — the deterministic map preserves étendue,
  so the ratio is the ENTIRE Jacobian. Applied unconditionally (≡ 1 under the continuous n→1
  wall contract); mirrored into `eta_scale` so the RR metric divides the compression back out.
- **`|T| = n`** is the conserved invariant → a runtime sanity check / debug AOV.
- **Etendue / Liouville**: velocity Verlet is symplectic — it preserves the phase-space measure,
  so `|T| = n` stays bounded and etendue/brightness stay honest over long paths (RK4, the initial
  pick, drifts; revised at build when the Hamiltonian structure was seen — fork d).
- **Estimator policy — THE GLASS RULE (owner, Jul 21):** a deflecting region is a specular
  refractor to every estimator seam. The walk records the deflection as a DELTA event (bent
  emitter hits score full weight — NEE cannot sample a bent connection), and shadow rays see the
  region as OPAQUE (`medium_transmittance` = 0; straight transmittance through a bending region
  is model bias, per the glass-shadows decision). The two halves only work together: delta-flag
  alone double-counts against a fake straight NEE arm; opaque alone loses the paths NEE dropped.
  Direct light through a deflecting region therefore comes exclusively from the kernel arm —
  consistent across pt/pt-nee/pt-mis, under the declared `measurement.shadows` truncation.

## 6. Witnesses (the correctness gates — status Jul 21 post-review batch)

- **F-MIRAGE — BUILT (grin.test.ts), corrected closed form:** the original sketch claimed a
  linear `n(y)` gives circular arcs — it does not (no exact circle there). The exact closed form
  is **linear `n²`**: the force `∇(n²/2)` is then CONSTANT, the ray ODE is projectile motion,
  the path is an exact PARABOLA — and velocity Verlet reproduces constant-force motion exactly,
  so the TS twin asserts the whole trajectory against the closed form (gate 1e-5, limited only
  by the finite-difference ∇ of √). Sharper than the arc version would have been.
- **F-BOUGUER — BUILT (grin.test.ts):** spherically-symmetric `n(r)`, Bouguer's invariant
  `|r×T| = n·r·sin φ` conserved along the path (< 1e-3; reference-free).
- **constant-n ≡ vacuum — BUILT (witness `grin-vacuum` / `grin-vacuum-ref`):** an `ior:1` lens
  routes through the full GLSL walker (entry, ODE steps, refined exit, delta record,
  current_medium recompute) and must be transport-invisible vs the lens-free twin. The scene
  carries a constant absorbing fog box so the dispatcher's inline arm coexists with the GRIN arm
  (the `ms.deflected` bug config). pt/RMSE tripwire — provisional until calibrated at the pinned
  salt; converged equality is the owner's GPU check.
- **GRIN furnace — BUILT (witness `grin-furnace`):** F-BOX-M's scattering furnace + a real
  Luneburg lens; a weight-1 deflector preserves the 0.4/channel equilibrium EXACTLY. Catches
  weight/absorption/bounce-starvation/coexistence breaks; **deliberately blind to wrong bending**
  (any lossless field gives 0.4) — geometry is the TS twins' job.
- **Hard-interface glass twin — BUILT Jul 22 (witness `grin-glass` / `grin-glass-ref`), AWAITS
  sweep:** a constant-FORMULA `medium: { ior: 1.5 }` on a dielectric wall routes the full new
  pipeline (entry Fresnel via `ior_of(region, p)`, straight Verlet walk, t_max guard,
  inside-exit handoff, exit Fresnel/TIR, interior factor ≡ 1) and must converge to the plain
  `ior: 1.5` dielectric — the GPU-verified F-ETA-class machinery. rmse tripwire PROVISIONAL
  until salt-calibrated; converged equality is the owner's check.
- **Hard-interface furnace — BUILT Jul 22 (witness `grin-furnace-hard`), AWAITS sweep:** a
  dielectric-walled blob with a LINEAR field n(p) = 1.5 + 0.9·(y − c_y) in the furnace — real
  Fresnel at every wall point, TIR, genuine bending, and DIFFERENT n at each path's entry/exit,
  so 0.4/channel holds ONLY if the interior L/n² factor closes the η² books. The conservation
  gate grin-furnace (walls at n = 1) is blind to.
- **F-LUNEBURG — DEFERRED on probe checks:** `n(r)=√(2−(r/R)²)`: parallel rays focus to a single
  exact antipodal point. A frame-mean cannot assert a focal point; this wants the measurement
  bench's deferred PROBE checks (crop/peak). Until then the Luneburg demo render is the owner's
  converged geometric check (and the gorgeous one).

## 7. Deferred (declared)

- ~~Hard refractive interface (discontinuous `n`: Snell + Fresnel at the wall) + GRIN interior~~
  — **BUILT Jul 22 2026** (`docs/impl-plan-grin-interface.md`, §3 above).
- ~~Emission inside a GRIN region~~ — **BUILT Jul 22 2026** (`impl-plan-grin-media` batch 1):
  per-step collection in the Verlet loop (E1.5 closed form per step — telescopes exactly for
  constant coefficients) × the **(n₀/n)² basic-radiance source factor** (radiance inside index
  n is n²·L; witness `grin-furnace-emit` pins it via Kirchhoff ε = σ_a·L₀·n²). Expression ε on
  a deflecting medium is majorant-free (the carve: the walker paces by the ODE, not σ̄). Twin
  `grin-emit` ≡ the inline closed-form arm. Demo **`accretion`**: the disk-as-emissive-medium
  black hole — the lensed-disk image with no embedded geometry.
- ~~Scattering inside a GRIN region~~ — **BUILT Jul 22 2026** (batch 2, CONSTANT coefficients):
  the analytic arm's channel-MIS transcribed to ARC LENGTH (`medium_sample_grin_scatter` —
  draw up front, the walk finds where the arc lands; survive weight at the discovered exit).
  Came with the **event-ray seam completion**: every scattering arm now reports its event's
  position + incident direction on `exit_p`/`exit_dir` (a bent event is not recomputable from
  (origin, dir, t)) and the walk reads them — the straight-line recompute is gone. Equiangular
  × deflecting-scatterer Validator-rejected (straight placement is off the bent path). Twins
  `grin-scatter` ≡ analytic arm; `grin-furnace-scatter` (haze INSIDE the lens) holds 0.4.
  Still deferred: emissive scattering in one deflecting region, and the null-collision lottery
  along bent arcs (expression σ under bending).
- **Embedded geometry inside a GRIN region** — a bent ray hitting a surface *within* the blob is
  the curved-ray-intersection problem (the contract's "BVH under non-straight geodesics"). v1
  GRIN blobs have geometry-free interiors; the bent ray only meets the region boundary.
- ~~Adaptive stepping~~ — **BUILT Jul 22 2026** (pulled by the Majumdar–Papapetrou demo;
  transcribed from the reference PathTracer's odeMarch, docs/curved-light-blackhole.md): the
  per-step `h = min(GRIN_STEP, GRIN_DS_MAX/n, GRIN_DTOL/|∇n|)` limiters (with `|T| = n` a fixed
  parameter step's COORDINATE jump `h·n` diverges near a black-hole point — concentric-ring
  artifacts), plus **capture** (`n > GRIN_CAPTURE` ≈ 50 ⇒ zero-weight terminator — for a single
  MP hole that is r < M/6, well inside the photon sphere at r = M, so exact for the image; the
  shadow is dynamics, not geometry). One force eval preserved; inert for weak fields (Luneburg
  peaks at √2). `MAX_ODE_STEPS` 512 (exit-bound). TS-twin gates: the MP flyby (Bouguer through
  the strong field + GR's weak-field deflection 4M/b within 2%). Demo `blackhole`: an MP BINARY
  — n = (1 + M/r₁ + M/r₂)², live `bh.mass` slider — in a dielectric glass block; headless GPU
  render shows both shadows + Einstein-ring lensing. Per-region scale-DERIVED defaults for the
  knobs stay the remaining plan-time polish.
- Spectral dispersion `n(λ)`; and the **global** curved-space generalization of `ambient_*`
  (H³/Schwarzschild) — which this feature de-risks but does not build.

## 8. Forks — ALL RESOLVED (owner, Jul 21 2026)

- **(a) Seam shape — RESOLVED: extend `MediumSample`** (deflected outcome + exit ray); the
  distinct `medium_propagate` seam is struck (§2.1).
- **(b) v1 scope — RESOLVED: small.** Bend + optional colored absorption; continuous-`n` null
  boundary; geometry-free interior; no scattering (§7).
- **(c) Authoring — RESOLVED: `ior` formula field on the `medium` block, spectral-ready** (§4).
- **(d) Integrator — RESOLVED: velocity Verlet** (symplectic; revised from the initial RK4 pick
  when the Hamiltonian structure was seen), `MAX_ODE_STEPS` budget, conservative exhaustion.

## 9. Build shape (if approved)

Staged, media-scale: (1) the `MediumProperties.ior` field + point accessor + `∇n`; (2) the seam
(fork a) + the generated walk branch; (3) the `grin.glsl` Verlet walker with exit detection; (4)
F-BOUGUER + F-MIRAGE (numeric, no reference image) then F-LUNEBURG; (5) absorption; (6) the
Luneburg demo. Loop/seam structure discussed and locked (fork a) before any body is filled.
