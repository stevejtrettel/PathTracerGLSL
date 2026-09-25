# Transport & Medium-Tracking Verification

**Status:** Adversarial design verification of [fable-compiler-contracts.md](fable-compiler-contracts.md) §4.4 (medium stack) and §7.2 (transport event loop), performed *before implementation* on the reasoning that errors here are subtle, expensive, and hard to detect after the fact.
**Date:** July 2026
**Method:** Line-by-line traces of the pinned rules against scenarios chosen to break them. Every finding has been folded back into the contracts doc; this document records the traces so future readers can check the reasoning rather than re-derive it.

**Verdict up front:** the contracts survived in *shape* but two rules were wrong and one mechanism was unnecessary. Findings F1 (classification rule provably wrong for submerged objects) and F2 (the medium stack should not exist) are the important ones — F2 in particular *removes* the design's worst failure mode rather than mitigating it.

---

## Findings summary

| # | Severity | Finding | Contract change |
|---|----------|---------|-----------------|
| F1 | **Critical** | Deepest-inside-wins classification misidentifies regions for submerged objects — η ratios come out 1.0 (no refraction) and medium path lengths are wrong. The common case, not an edge case. | §2.7 rewritten: **innermost-wins**; V1-C5 refined to allow full containment |
| F2 | **Major (simplification)** | The medium stack is unnecessary for SDF scenes — the SDF *is* a containment oracle. A single `current_medium` variable, ground-truthed at every hit, is simpler AND self-healing. | §4.4 rewritten: stack deleted |
| F3 | **Gap** | Media-only regions (a fog cube) need **null interfaces** — without `surface: none`, every fog boundary gets a spurious BSDF. | §3 + §7.2: null surface + `LOBE_NULL` |
| F4 | **Correction** | V1-C1's "shadow rays through media need no marching" was overstated: transmittance is closed-form *per segment*, but segments still require boundary intersections along the shadow ray. | §1.1 V1-C1 wording |
| F5 | **Pins** | Bounce accounting and Russian-roulette placement were unspecified — exactly the kind of ambiguity that produces two integrators that disagree for undiagnosable reasons. | §7.2 pins added |

---

## Trace T1 — Water line in glass (multi-region cup)

**Scene:** multi-region object with shared bases: glass shell region `G`, water region `W` (interior, below waterline), air-gap region `A` (interior, above waterline). Exact shared boundaries by construction. Point light above.

**Trace (rules as amended):** camera ray in ambient (`current_medium = -1`) → outer glass wall: `region_from=-1, region_to=G`, boundary owner `G` → dielectric transmission → `current_medium = G`; Beer–Lambert from `medium_of(G)` → inner wall below waterline: **one hit knowing both sides** (`from=G, to=W`), η = `ior(W)/ior(G)` directly → `current_medium = W` → (murky water: medium events fire here) → bottom interior wall `W→G` → `G` → exit `G→−1` → ambient. An upward ray inside the water crosses `W→A` with η = `ior(A)/ior(W)`; TIR possible and handled as a reflection event (no medium change). ✓

**Against the OLD stack rules:** push `G`, then crossing `G|W` pushes `W` → stack `[G, W]` — which is a *lie*: the regions are disjoint siblings (shell vs interior); the path is in `W`, not in "`W` inside `G`." The traversal happened to unwind correctly (`W|G` pops `W`, exit pops `G`), i.e. the stack passed this test *by accident of symmetric traversal*, and any missed or duplicated boundary event (grazing double-hit) desyncs it permanently. This "correct by luck, fragile by construction" behavior is what motivated looking for F2.

## Trace T2 — Glass sphere submerged in a pool (the F1 killer)

**Scene:** water as a box solid (half-extent 5), glass sphere (r = 0.4) fully inside it, as *separate objects*.

**Under the old pins:** V1-C5 rejects this outright (overlapping solids) — meaning a fish tank is unbuildable in v1: far too restrictive. And without C5, §2.7's deepest-inside-wins breaks catastrophically: at a point inside the glass sphere, `box_sdf ≈ −5` but `sphere_sdf ≈ −0.4`, so deepest-wins classifies the *inside of the glass sphere as water*. Consequences compound: epsilon classification at the sphere's surface returns `region_to = water`, so the dielectric gets η = `ior(water)/ior(water)` = 1 → **no refraction at all** (the boundary-owner rule saves the BSDF *choice* but not the η ratio), and Beer–Lambert attributes the sphere-interior path length to water. Silent, visually-plausible, wrong.

**The fix — innermost-wins:** among regions *containing* p (sdf < 0), the **least negative** wins. For strict nesting A ⊂ B this is provably correct: for p ∈ A, every path from p to ∂B exits through ∂A first, so `dist(p, ∂A) ≤ dist(p, ∂B)`, i.e. A's sdf is less negative — the innermost region always wins, at every nesting depth (bubble-in-sphere-in-pool traces clean). Deepest-wins had exactly one thing going for it: the production "overlap the water slightly into the glass" trick — which V1-C5 excludes anyway and which a future priority system serves properly.

**V1-C5 refined:** *full containment* (bounds nested) is **allowed** — innermost-wins classifies it correctly with no carving, no declarations, no new machinery. *Partial overlap* (bounds intersect, neither contains) remains a Validator warning: inside a lens-shaped intersection, innermost-wins is deterministic but physically arbitrary — flag it, don't guess silently.

**Re-trace with the fix:** point inside sphere → containing = {box, sphere} → least-negative = sphere ✓. Sphere surface, far-side point: `region_to = G` ✓ → η = `ior(G)/ior(W)` ✓. Ray segment inside the sphere: `current_medium = G` (set at transmission), so water absorption correctly excludes it ✓. Exit: far-side contained only by box → `region_to = W` ✓.

## Trace T3 — The medium stack vs. the containment oracle (F2)

The stack exists in mesh-based renderers because meshes are *boundaries only* — there is no `inside(p)` test, so nesting must be reconstructed from traversal history, and a missed event corrupts that history forever. **SDF scenes have the oracle**: `scene_region_at(p)` answers containment authoritatively at any point. The stack was caching information the scene can always recompute — and a cache of a perfect oracle that can silently diverge from it is pure liability.

**Replacement (now pinned in §4.4):**

```glsl
int current_medium;   // region id; -1 = ambient
// at every LOBE_TRANSMISSION event:  current_medium = hit.region_to;
// at every reflection/TIR event:     unchanged;
```

with a **free self-healing invariant**: epsilon classification at each hit already computes `hit.region_from`, which *must equal* `current_medium`. On mismatch (boundary event missed by the marcher — thin-shell tunneling past `MARCH_EPSILON`/offset scale): resync `current_medium = hit.region_from`, optionally incrementing a debug counter (§11.4's desync view becomes a *repair count* view). Zero extra cost — the comparison operand was already computed.

What this deletes: push/pop rule edge cases, fixed-depth overflow, the last-entered-wins overlap rule, and — most importantly — desync as a *persistent* failure mode: a missed event under the stack corrupts the rest of the path; under oracle-tracking it corrupts exactly one segment and self-repairs at the next hit. What this costs: nothing in v1.

**Future note (refined in design review):** this trace originally concluded that mesh-bounded media would reintroduce history tracking. The owner's review improved on that: meshes *also define regions* — require media-bounding meshes to be watertight and supply a containment query (BVH ray-parity, or a baked SDF proxy that doubles as the step bound), and the oracle stays total. The stack never returns; `current_medium` is the universal interface. Pinned in contracts §4.4.

Nested-dielectric check: exiting the submerged glass sphere needs the *outside* medium for η — that's `hit.region_to` at the exit hit, supplied by classification, not by remembered history. ✓

## Trace T4 — NEE from a medium event, through boundaries

**Scene:** foggy Cornell box (`ambientMedium: 'fog'`), quad area light, plus a clear-air region (fog cube variant). A medium scattering event fires at `p` inside fog; NEE samples the quad light.

`shadow_transmittance(p, wi, dist)` must produce `exp(−σ_t · L_fog)` for the fog portion and 1 for clear portions. Implementation shape (v1, homogeneous): walk the shadow ray with `scene_intersect`, at each boundary crossing update the shadow-local medium via `region_to`, multiply the closed-form segment transmittance; opaque hit → 0; dielectric hit → 0 (v1 policy, §6.3). This works — but it exposed **F4**: V1-C1's claim "shadow rays through media need no marching at all" was half-true. Correct statement: no *stochastic* transmittance estimation (no null-collision loops, no ratio tracking) — segment transmittances are exact closed forms — but finding the segments still requires boundary intersections along the shadow ray. A few intersections per shadow ray, not a marching loop per sample; wording fixed in §1.1.

## Trace T5 — The fog cube needs a null interface (F3)

**Scene:** a fog *cube* (bounded region of scattering medium) in clear air. The fog material has a medium block and **no surface** — physically, its boundary is not an optical interface.

Under the contracts as previously written, every material implied a surface model, so the fog cube's boundary would receive a BSDF — a spurious Fresnel/Lambert shell around every volume. **Fix (now in §3 and §7.2):** materials may declare `surface: none`. The compiler classifies that region's boundaries as **null interfaces**; transport handles them as: update `current_medium = region_to`, continue in the *same direction* (a passthrough sample: `wi = −wo`… i.e. direction unchanged, `weight = 1`, flags `LOBE_TRANSMISSION | LOBE_DELTA | LOBE_NULL`), **no NEE at the vertex, no emission logic, and no bounce consumed** — with a crossing budget so a pathological scene can't loop forever (now the declared truncation `measurement.maxNullCrossings`, shared by a path and its shadow rays). This matches the standard "interface material" concept (PBRT's null BSDF) and is required for *any* bounded volume, so it belongs in v1, not the future list.

## Trace T6 — TIR inside absorbing glass + bounce/RR accounting (F5)

Camera → thick tinted-glass block → internal exit attempt → TIR (reflection sample, `LOBE_DELTA|LOBE_REFLECTION`) → medium unchanged ✓ → absorption keeps compounding → eventual Fresnel transmission exits. The trace is correct, but writing it exposed unpinned accounting that would make two integrators disagree for invisible reasons. Now pinned in §7.2:

- **Bounce budget:** surface scattering events and medium scattering events both count toward `maxBounces`; null crossings (T5) do not (they have their own safety counter). Rationale: medium events do the same work and cause the same variance as surface bounces; null crossings are bookkeeping.
- **Russian roulette:** applied once per loop iteration, *after* `throughput *= sample.weight`, using `spectrum_average(throughput)`, starting after `startDepth` *counted* events (nulls excluded). One defined place, not a per-integrator choice.

---

## What was NOT found (checked and passed)

- **Emission/NEE double-counting logic** (§6.2, `light_of` + delta-bounce rule): traced through NEE-only and MIS modes at camera hits, post-delta hits, and post-diffuse hits — consistent in all six combinations.
- **Boundary-owner shading rule** (§4.1): survives glass entry, glass exit, and shared internal boundaries (owner ambiguity at shared multi-region boundaries confirmed harmless: the dielectric interface BSDF is parameterized by both sides).
- **Reflection events and medium state:** no scenario produced a medium update on a reflection/TIR event. ✓
- **The geodesic stepper interaction:** medium tracking is per-segment and orthogonal to how segments are advanced; nothing in F1–F5 touches §5.

## Standing risks (accepted, monitored)

- **Thin-shell tunneling** past hit-detection epsilons remains possible (though §2.6's conservative bound prevents true SDF overshoot); it now costs one mistracked *segment* instead of a corrupted path, and §11.4 counts repairs so regressions are visible.
- **Partial-overlap classification** is deterministic-but-arbitrary; the Validator warning is the guard until a priority system exists (§10.2).
- These traces are paper verification. The §11 harnesses (furnace, cross-strategy convergence) are the runtime check that the *implementations* of these rules match; T1/T2/T4 should become actual test scenes when the volume integrator lands.
