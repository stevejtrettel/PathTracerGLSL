# impl-plan-grin-media.md — emission + scattering along the bent path

**Status: BATCHES 1–2 BUILT Jul 22 2026 — GPU-RENDER-CHECKED, sweep owner-gated.** Gates:
tsc clean; **1334 vitest** (204 glslang pairs — all new witnesses/demos compile; 4 new
validator-matrix tests; the two failures under full-suite load were the KNOWN equiangular
flake + an environmentBake load-flake, both green in isolation); generated-glsl snapshots
regoldened with the diff read (churn = the event-ray unification exactly: analytic signature
+ event fill in 10 scattering programs, the walk's `p_evt = ms.exit_p` in 10, struct
comments in 13). Headless GPU: **accretion** renders THE classic shot (shadow disk + photon
ring + the far disk lensed over/under, warm-graded by the blue-absorbing ball), **maxwell**
seamless-rim antipodal imaging, and the twins agree numerically at ~30 spp — grin-emit
0.3991 vs ref 0.3992, grin-scatter 0.5063 vs ref 0.5066. Witness sweep is the owner's.
Lifts the two v1 scope cuts of `fable-variable-ior.md` §7: a deflecting (GRIN) medium may now
EMIT (batch 1) and SCATTER (batch 2) along the curved ray. Design authority stays
fable-variable-ior.md; the medium-emission conventions ride impl-plan-medium-emission (ε = the
volume emission coefficient, B2's ladder); the scattering math is the analytic arm's pbrt-v3
channel-MIS (fable-volumetric-component §4) transcribed to ARC LENGTH.

## Batch 1 — emission along the bent path

**Physics.** Basic radiance L/n² is invariant, so radiance emitted at a point x with index
n(x) arrives at the segment start (index n₀) scaled by (n₀/n(x))² — the same |T| = n carried
invariant pays for it. Per Verlet step of coordinate length ds, the exact per-step closed form
(E1.5's shape, σ_a constant over the step, floored 1e-6 for pair consistency):

    ms.radiance += absorb · (n₀/n)² · ε(r) · (1 − e^{−σ_a·ds}) / σ_a
    absorb      *= e^{−σ_a·ds}

Collection happens in the capture spiral too (a ray plunging through glowing gas radiates its
sightline before dying), in the exit partial step, and in the t_max guard's micro-segment.
For CONSTANT coefficients the per-step sum TELESCOPES to the inline arm's exact closed form —
the twin witness is exact up to fp.

**Edits.** Validator: the emission+ior rejection is REPLACED by (a) deflecting ∧ σ_s ∧ ε →
reject (emissive scattering on bent arcs deferred — the tracking-arm route doesn't exist for
curves); (b) expression ε/σ_a on a DEFLECTING medium is exempt from the majorant requirement
(no ceiling is involved — the walker paces by the ODE, not σ̄; the D1 clamp never applies).
materials.ts: `medium_emission` (the generated zero-folding accessor) is emitted for
deflecting programs too, preceding grin.glsl. grin.glsl: the collection lines above.

**Witnesses.** `grin-emit`/`grin-emit-ref`: an `ior: 1` emissive absorbing medium routed
through the GRIN arm vs the same medium (sans ior) through the inline closed-form arm —
telescoping makes the twin exact. `grin-furnace-emit` (the KIRCHHOFF gate): an
absorbing+emitting Luneburg region in the furnace with ε(x) = σ_a·L_eq·n²(x) as an authored
formula — equilibrium holds at 0.4/channel ONLY with the (n₀/n)² source factor; both existing
furnaces are blind to it. **Demo `accretion`**: a single MP hole in a glass ball with a
glowing equatorial torus ε(x) — the lensed-disk image, no embedded geometry (the glow is
medium, not surface).

## Batch 2 — scattering along the bent path

**The seam completion — MediumSample carries the EVENT RAY.** The walk currently recomputes a
scatter event's position as the STRAIGHT point `ambient_geodesic(origin, dir, ms.t)` — wrong
on a bent path, and the same not-recomputable argument that put exit_p/exit_dir on the struct
for the deflected outcome (§2.1) applies verbatim to bent scatter events. Resolution: every
scattering arm fills `exit_p`/`exit_dir` (the event position + INCIDENT direction — straight
arms via `ambient_geodesic`, one line each), and the walk reads them instead of recomputing.
`analytic`'s signature gains the Ray it never needed before; `delta` already has it. NEE at a
bent event needs nothing: shadow rays from inside a deflecting region hit its own
`medium_transmittance = 0` (the glass rule) — bent connections stay unsampleable, pt-nee
converges through the kernel arm.

**The sampler** (`medium_sample_grin_scatter`, static math in grin.glsl; the dispatcher picks
it for deflecting ∧ scattering — policy generated): for CONSTANT σ_t the free-flight law in
ARC LENGTH is the same exponential, so the analytic arm transcribes exactly — draw channel +
target arc s* from xi up front, Verlet-walk accumulating Σds; event inside a step at the
linear fraction (position on the drift, tangent T_half); the analytic arm's own weights with
t → arc length (scatter: σ_s·tr/avg(σ_t·tr); survive-to-wall: tr/avg(tr) at the DISCOVERED
exit arc — the estimator is the same measure split), each × the interior (n₀/n)² factor with
its eta_scale mirror. Capture: zero-weight terminator, unchanged. v1 scope: coefficients
CONSTANT/{param} on a scattering deflecting medium (expression σ anything + σ_s + ior →
reject; the null-collision lottery along bent arcs is the declared sequel).

**Witnesses.** `grin-scatter`/`grin-scatter-ref`: `ior: 1` scattering medium through the GRIN
sampler vs the analytic arm (identical math, near-identical exit arc — rmse tripwire).
`grin-furnace-scatter`: the haze INSIDE a real Luneburg deflecting region in the furnace —
0.4/channel (lossless scattering × lossless bending), vs the existing grin-furnace where the
haze is ambient AROUND the lens.

## Also in this batch set (owner, mid-session)

- **Demo `fisheye`** — Maxwell's fisheye n = 2/(1 + r²/R²): n = 1 at the rim (continuous
  'none' wall), perfect antipodal imaging, the closed-photon-orbit field the walk's bounce
  budget was designed around.

## PLANNED (awaiting owner go) — per-region derived step knobs

The walker's knobs (`GRIN_STEP`/`GRIN_DS_MAX`/`GRIN_DTOL`, all `#ifndef`-guarded since the MP
batch) are global and scale-naive: a 0.05-radius lens marches at the same h as a 5-unit
atmosphere. The plan-time fix, in the precompute-the-HOW discipline:

1. Planner derives a per-region CHARACTERISTIC SCALE from what it already knows — the folded
   primitive parameters (sphere radius, box min half-extent; the bounds() the instancing
   batch already requires of prototypes).
2. `GRIN_STEP_r = scale/50`, `DS_MAX_r = scale/20` (today's 0.02/0.05 recovered exactly at
   scale = 1), DTOL stays dimensionless (it caps Δn per step, not a length).
3. Emission: the knobs become per-medium locals passed to the walker (one more arg each, or a
   small generated `grin_knobs(med)` accessor — the kernel/combiner pattern), NOT #defines —
   two deflecting regions of different scale must coexist in one program.
4. An authored override (`medium.stepScale`?) is NOT included — no customer yet; the door
   stays closed until a scene needs it.
5. Gate: byte-neutral for scale-1 regions (the derived values reproduce today's constants);
   the Luneburg witnesses re-run unchanged.

Cost: small (Planner rows + one accessor + walker arg). Risk: none identified — the values
are compile-time constants per medium. AWAITING the owner's go.

## Gates

Per batch: tsc + targeted vitest; full vitest + glslang; snapshot regolden with the diff read;
headless GPU renders (accretion, fisheye, a scatter scene). The witness sweep stays owner-run.
