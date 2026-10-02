# The GRIN spawn floor: remove it

**Date:** 2026-10-01
**Status:** Built 2026-10-01 (owner-approved after a fresh-agent review, §6). Results in §7 and
the CHANGELOG.

"Read" means read in the source, "measured" means run, and "expected" means a prediction.

## 1. The problem, with evidence

**Measured.** The `guides` witnesses (step 6 of the outputs plan) measure a medium's
transmittance to four digits through the albedo guide, which is the transport's own path
weight. A slab 0.015 thick with σ_a = (20, 40, 60):

| The scene | Effective thickness the light sees |
|---|---|
| the slab as a plain absorbing medium, no GRIN anywhere | 0.01498 (the fp spawn margin only) |
| the slab as a GRIN medium (n = 1) | **0.01400** |
| the slab as a plain medium, with a small GRIN box elsewhere in the scene | **0.01400** |

Exactly 0.001 of path is missing, in every channel, whenever the program contains a GRIN
medium, wherever that medium is.

**The cause (read).** `compiler/generate/features/intersection.ts:202-228`: in a program with a
deflecting medium, the spawn margin of every floating-point-accurate hit (analytic roots,
triangle tests) is floored at `GRIN_GRAD_EPS` = 0.001:

```glsl
float spawn_eps_fp(Point p) { return max(fp_uncertainty(p), GRIN_GRAD_EPS); }
```

`ray_spawn` (`glsl/core/ray.glsl:29`) moves every new ray `hit.eps` off its surface. So in a GRIN
program, every ray leaving every surface starts 0.001 away from it:
- **every medium segment after a crossing skips its first 0.001/|cos θ|** (the offset is along
  the geometric normal, `ray.glsl:30-31`, so oblique crossings skip more): its attenuation,
  scattering and emission. At normal incidence radiance is wrong by e^{σ_t·0.001} per
  crossing: invisible at σ ≈ 1 (0.1%), 6% at σ = 60;
- **every bounce off an opaque surface starts 0.001 off the surface.** That is the world-space
  offset class that biased `slab-albedo` 1–3% low before the epsilon discipline made margins
  fp-relative (the `slab-albedo-sparse` notes in `tests/witnesses/index.ts`).

## 2. Why the floor exists, and why it does not do its job

**The reason given (read)** in `intersection.ts:202-207` and
`docs/impl-plan-epsilon-discipline.md` ("GRIN floor policy"):
- the walker estimates ∇n by central differences reaching `GRIN_GRAD_EPS` from a point
  (`grin_grad_n`, `grin.glsl:106-113`);
- authored index formulas "need not be total outside their region";
- so the entry point is pushed 0.001 inside, keeping its stencil inside.

**What the walker actually does (read, `grin.glsl:180-284`):**
1. **The floor protects one point per traversal: the first.** Every later step evaluates the
   force at `r_next` (`F_next = grin_force(med, r_next, ray.wl)`) whenever `r_next` is inside,
   however close to the wall. So near every exit, the stencil already reaches up to 0.001
   outside the region. Formulas must therefore already be finite in that band, or exits would
   fail today.
2. **Segments up to one step long never evaluate ∇n:** the `t_max` guard flies them straight
   (`grin.glsl:193-200`). The floor buys them nothing, and costs them 0.001 of attenuation;
   that is the thin-slab measurement.
3. **The entry point's inside test is never consulted:** the exit test checks `r_next` and the
   bisection points, never `r` at entry. So an fp-scale entry offset changes no branch.

**Every GRIN formula in the suite is finite outside its region (read, all 11 distinct
formulas):** each square root is guarded with `max(…, 0)` (`grin`, `spectral-grin`,
`spectral-grin-furnace-emit`), and the rest are constants, linear, quadratic or rational with
positive denominators, or guarded `length`s (`maxwell`, `glassball`, `blackhole`, `accretion`,
the capture field).

So the floor's premise, that formulas need not be total near their region, is already false
in practice. The floor does not make it true: it protects one stencil per traversal and costs
0.001 of path at every surface in the scene.

## 3. The change

**Remove the floor.** GRIN programs use the same spawn margin as every other program:
`spawn_eps_fp(p) = fp_uncertainty(p)`.

**State the real contract instead,** where an author reads it: a deflecting medium's `ior`
formula must be **finite and smooth within about `GRIN_GRAD_EPS` (0.001) outside its region**,
because the ∇n stencil reaches there at the region's walls. "Smooth" matters: without the
floor the entry point's stencil straddles the wall on EVERY traversal (today only interior
steps that land near a wall do), so a kink or clamp exactly at the wall would bias every
first half-kick. None of the 11 suite formulas has one (the Luneburg `max(…, 0)` kink is at
r = √2·R). "About": a scattering-arm event can already sit up to the bisection bracket
(about 2e-4) outside the region (`grin.glsl:363, 368, 376`), unchanged here. The contract
goes in:
- `grin.glsl`'s `grin_grad_n` comment;
- the `ior` field's doc comment (`compiler/types.ts:452-457`), which is also stale and gets
  fixed while edited: "v1 requires n → 1 at the region boundary" and "rejects σ_s" were
  superseded by dielectric walls and the scattering arm;
- the GRIN occupant's math note (`grin.md`).

**Delete what existed only for the floor** (simple first, fewer parts):
- the TS constant `GRIN_GRAD_EPS` and the header define it emits (`intersection.ts:51-59,
  214-217`);
- grin.glsl's `#ifndef` fallback becomes its own plain `#define GRIN_GRAD_EPS 0.001`, the house
  pattern for an occupant's constant (HANDOFF-2026-07-22 §2). The file's other knobs keep their
  `#ifndef` guards; converting them is not part of this fix;
- the epsilonCoupling test case that pinned the two copies together
  (`tests/components/epsilonCoupling.test.ts:63-68`).

**Text that would contradict the change** (one answer per fact), all rewritten in the same
commit:
- `impl-plan-epsilon-discipline.md`: the floor at :5-6, the "GRIN floor policy" paragraph
  (:62-65) and addendum item 2 (:147-150) — rewritten in place to say the floor was removed
  and why;
- `intersection.ts:202-208`, the comment, goes with the code;
- `grin.glsl:243-244`, "authored formulas need not be total" outside, becomes: beyond the
  `GRIN_GRAD_EPS` band they need not be finite;
- `tests/witnesses/README.md:75-84`, the standing-failure note ("cause not yet found"), is
  replaced by the resolution;
- a CHANGELOG entry.

**Alternatives considered (not proposed):**
- *Floor only the spawn that enters a GRIN region.* It still skips 0.001 of every GRIN entry,
  and it needs the hit fill to know the next medium, which it does not.
- *Keep the floor and attenuate the skipped sliver.* It adds machinery to every crossing to
  compensate for a margin that protects nothing the exits do not already need.
- pbrt-v4 and Mitsuba 3 have no GRIN media, so they do not settle this. Their general rule,
  fp-relative spawn offsets, is the one this codebase already follows outside GRIN programs
  (`impl-plan-epsilon-discipline.md`).

## 4. Boundaries

- GRIN regions bounded by **marched** (SDF) walls keep `MARCH_CLEARANCE` (0.001), the marched
  tier's own margin, as every marched object does. Not changed here.
- The other GRIN item, several GRIN materials under NEE being extremely slow
  (tests/witnesses/README.md), is separate and not touched.
- No change to the walker's integration, exit pull-back, roulette or step sizes.

## 5. Verification, with the predictions written first

**Predictions:**
- **Digest:** programs WITHOUT a deflecting medium are identical (the floor and the define are
  gated on `media.deflecting`, `intersection.ts:215, 224`; grin.glsl is linked only for
  deflecting media). All 26 suite scenes with a GRIN medium differ (each emits the floored
  line; every GRIN region in the suite is an analytic sphere or box), and only by: the
  `spawn_eps_fp` line, the header define's removal, grin.glsl's own text (the define block
  and the rewritten comments), and source-map offsets. A script checks that no other line
  differs. The generated-GLSL snapshot has no GRIN program, so it does not change.
- **Frames:** every picture identical EXCEPT the `grin` case (`grin-furnace`,
  `tools/witness.mjs:768`), whose spawns all move. That case is re-recorded as the new
  baseline.
- **The two standing failures pass:** `guides-grin-substep` and `guides-grin-substep-scatter`
  read the exact geometric transmittance (0.01498-class effective thickness).
- **A new witness fails today and passes after:** `guides-grin-elsewhere`, a plain thin slab
  with a small GRIN box elsewhere in the scene, at the exact e^{−σ_a d}. Measured today:
  0.01400 effective.
- **The other GRIN witnesses still pass:** the 17 GRIN scenes with witnesses from before step 6
  (16 `grin-*`/`spectral-grin-*` scenes and `rough-grin`), plus the two zero-checks
  (`guides-grin-traversal`, `-capture`). Their readings may move by up to
  e^{σ·0.001} per crossing (0.1%-class at their densities): *expected* to stay within their
  tolerances, not certain. Any failure is reported with its numbers before anything else is
  done.

**Checks:**
1. `npx tsc --noEmit`; `npx vitest run`. The GLSL snapshot changes only in GRIN cases, by the
   two lines above.
2. The digest against a before-baseline, with the line check.
3. The frames.
4. **A bent-path before/after comparison** (the floor's real risk: the walker has never run
   with fp-scale entry offsets, and the existing GRIN witnesses do not test bent paths — the
   furnaces read 0.4 whatever path a ray takes, the rest use constant n or equality only).
   Render `glassball` (a dielectric wall where n = 1.15 and |∇n| = 0.9) and `grin` (the
   Luneburg lens) before and after the change, same strategy, pinned salt, with the variance
   statistic on; compare the frame means and the per-pixel noise-normalized difference
   (χ²_red). **Prediction: no difference beyond noise** (χ²_red ≈ 1, frame means within 3σ).
   A one-off scratch measurement; its numbers go in the CHANGELOG.
5. The GRIN witnesses only (the 21 witnessed GRIN scenes in the registry, plus
   `guides-grin-elsewhere`), under `caffeinate -i`, with the
   owner's OK. Before running, time one sample of each new fixture with a readback (the step-6
   lesson).
6. A fresh-agent review of the diff.

## 6. Review record

**Fresh-agent review (2026-10-01).** It read the cited code, compiled every suite scene in
scratch scripts (deleted afterwards), and found **no blocker**. It confirmed claims (1)–(4) of §2
in both GRIN arms: the exit and stencil behavior, the t_max guard, no entry inside-test, and
the 11 formulas. It also confirmed that non-GRIN programs are untouched, that nothing else
reads `GRIN_GRAD_EPS`, and that removing the floor is the simplest correct fix.

Its findings, each checked and folded in:
1. **The frames prediction was wrong:** the frame cases include `grin-furnace`
   (`tools/witness.mjs:768`, read). §5 now predicts that case changes.
2. **The digest prediction was too narrow, and "an all-marched scene" does not exist**
   (measured by the reviewer): all 26 GRIN scenes change, and grin.glsl's text and the source
   maps change with them. §5 is corrected.
3. **Contradicting text** the plan left in place (grin.glsl:243-244, the witness README, three
   places in the epsilon doc, the intersection.ts comment, the stale `ior` doc): all now in §3.
4. **The contract must say "smooth", not only "finite":** without the floor, the entry stencil
   straddles the wall on every traversal. §3 now says it; no suite formula has a kink there.
5. **No witness tested the changed claim** (the floor was a guard from the August epsilon
   work, not a fix for a measured failure, so the walker has never run with fp-scale entries;
   history read in the epsilon doc and `git log -S`). Check 4 of §5 adds a bent-path
   before/after comparison on `glassball` and `grin`.
6. **Oblique crossings skip 0.001/|cos θ|:** §1 now says so.
7. **The other `#ifndef` knobs stay:** §3 now says so.
8. **Could an fp-scale entry put the walker outside its region?** Reasoned no, by the
   reviewer: a handoff behind the entry needs the first drift to leave within the 0.002
   pull-back while the chord exceeds one step, and the strongest outward suite field turns
   the ray by only about 0.009 rad. Not measured; check 4 would show it.

## 7. As built (2026-10-01)

The change is exactly §3. Results against §5:
- **Digest:** exactly the 26 GRIN scenes differ (plus the new `guides-grin-elsewhere`); the
  other 247 are identical. A line script over the kept text found ONLY the predicted lines in
  all 28 GRIN programs; `rest` differs only in source maps.
- **Frames:** 16 of 18 pictures identical; the 2 that differ are the `grin` case (radiance and
  its PNG), as predicted.
- **Tests:** `tsc` clean; vitest 114 files, 4229 tests, all pass.
- **The bent-path gate (§5 check 4).**
  - **Frame means held:** `glassball` within −0.4 to −0.6 standard errors, `grin` within −1.3
    to −1.9.
  - **The per-pixel χ² prediction failed, and the statistic was wrong for this question:** 190
    and 252,167, dominated by DETERMINISTIC pixels (all 256 samples equal, σ ≈ 1e-7) that
    moved by a fixed fraction. Noise normalization cannot judge those.
  - **The right check is exact:** a pixel seeing the constant sky through `grin`'s lossless
    Luneburg lens (n = 1 at its 'none' wall) must read exactly the sky. Over 1704 such
    pixel-channels the error went from **+0.293%** before to **−0.096%** after (largest
    0.337% → 0.133%). The fix is more accurate.
  - **The remaining −0.1% is a separate, existing item** (tests/witnesses/README.md),
    expected but not measured to be the exit-side n read from |T| inside the wall. The old
    floor's deeper entry had partly cancelled it.
- **Witnesses** (the 21 witnessed GRIN scenes plus `guides-grin-elsewhere`): 28 of 28 exact
  checks pass, including the three thin-slab checks at the exact geometric transmittance.
