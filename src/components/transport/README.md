# transport/ — the estimator's anatomy

**Taxonomy:** estimator (integrators may ALSO declare measurement truncations — a
one-bounce renderer changes the integral and says so). This family is the §7
technique-centric carve (fable-components §7, owner-pinned; emitted GLSL shape per
fable-transport-glsl-target.md, owner-approved) — four kinds of parts:

| Part | Kind | What it owns |
|---|---|---|
| `techniques/` | **the one-file research axis** | one way of putting samples on a term of the integral |
| `combiner.ts` (root) | generated glue | every weighting line — the partition of unity between techniques; pt/pt-nee/pt-mis are configs of it |
| `math_mis.glsl` (root) | static shared math | the β=2 power heuristic — called only by combiner-emitted weights; included iff the estimator is `mis`, forward-declared via the `provides` seam |
| `integrators/` | pick-one | walk skeletons: path advance, state, termination; NO sampling — they compose techniques at event sites |
| `volume/`, `shadow/` | pick-one bodies | distance sampling (`medium_sample` seam) and shadow-query policies (`shadow_transmittance` seam) |

`flags.ts` (root): the decisions, read ONCE from `ProgramDescription` — no part
re-derives a decision.

## What a technique supplies

Static GLSL (the math — see any occupant) + a glue `.ts` declaring: where it samples
(surface/medium/per-segment sites), how it scores (locally, or deferred with carried
state — see `kernel/`'s record), the seams its emitted code calls, and its inclusion
condition. **The static-file rule** (target doc §1): technique GLSL may touch ONLY
`PathState`'s pinned core (`ray`, `throughput`, `radiance`); every program-dependent
field and every policy decision lives behind a generated function (`combiner_w_*`,
`kernel_record`, `roulette`). No `#ifdef`, no strategy branches — if a file wants two
shapes, that's two occupants.

Occupants: `kernel/` (T1 — the continuation draw IS a direct-light sample, scored one
vertex late; the deferred-scoring account is in fable-components §7.2-7.3),
`light/` (T2 — NEE, local scoring, surface + medium sites),
`equiangular/` (T2 placement variant, per-segment — see `equiangular/equiangular.md`).

## What an integrator supplies

A generated walk (TS emitter in `integrators/<name>/`) composing the roster. `pt/` is
the recursive walk. One-shot/Whitted/debug-probe renderers are new walks here reusing
the same technique functions — a probe walk is also how the §11.3 GPU harness lands.

## Invariants & witnesses

- Partition of unity: techniques covering the same term must have weights summing to 1
  — structural via the combiner; witnessed by §11.2 three-way convergence
  (cornell-area, X-GLASS, X-FOG, veach-mis, haze).
- Single-emitter rule: RR (`roulette`) and the MIS record (`kernel_record`) are ONE
  generated function each — agreement between sites by construction.
- Estimator axes here: `directLighting` (combiner config), `volumeSampling`
  (volume/ bodies), `mediumLightSampling` (technique placement, haze pair).
