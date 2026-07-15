# NOTE — GLSL/math layout cleanup

**Status:** BUILT (Jul 15 2026), with one owner-decided deviation from the sketch below:
`math_mis.glsl` went to the **transport family root** (its only callers are
combiner-emitted weights; conditional inclusion + the `power_heuristic` `provides` seam
moved into `contributeTransport`), NOT to `glsl/core/` — after the audit showed it was
one estimator's math misfiled in core. Also landed: `contributeTransport(plan)` narrowed
to `(program: ProgramDescription)` (it read only `plan.program`), so no component imports
`RenderPlan` anymore. The `src/math/` items below had already been resolved separately
(vector3 → `app/utils/`, dead RNG GLSL deleted). Proof: dump diff token-identical except
provenance strings + the interface-header forward declaration; 623 vitest green
(glslang on all pairs); snapshots re-goldened.

The original parked note, for provenance:

## What feels wrong

Fixed (non-swappable) GLSL is scattered and some is orphaned, and two different things
are both called "math":

1. **`src/math/`** (top-level TS folder)
   - `vector3.ts` — LIVE TS util (imported by KeyboardControls). Fine, but a TS math
     util living at top level is a bit ad hoc.
   - `random/rng-system.glsl` + `random/distributions.glsl` — **DEAD GLSL.** Zero
     importers (verified `grep` over src/tests/demos); `rng-system` still hashes on
     `frame`, the §2.11-dropped builtin. Pre-components RNG, superseded by
     `components/sampler/pcg4d/` (stream) + material/light/phase `sample()` warps
     (distributions). **Provably obsolete → deletion candidate** (offer to owner; the
     "don't over-cut" rule says confirm, don't auto-delete).

2. **`compiler/generate/glsl/`** — a second GLSL library buried inside the compiler's
   *generation logic* folder:
   - `core/` — the CONTRACT SPINE: `structs · math · ray · interaction` (+ media/mis).
     The pinned GLSL vocabulary everything is written against. (This `math.glsl` is the
     one `core.ts` imports — NOT `src/math/`. Name collision.)
   - root — SHARED PLUMBING: `fullscreen.vert`, `display.glsl` (safe_color + sRGB OETF),
     and `noise.glsl` (blue-noise accessor) is about to join.

## The idea (deferred)

Promote the fixed GLSL to a **top-level `src/glsl/`** (peer of `components/`), because it
is DATA the compiler assembles, not generation logic — same kind as a component's `.glsl`,
differing only in swappable-vs-fixed:

```
src/glsl/
  core/     ← contract spine (from compiler/generate/glsl/core/)
  shared/   ← fullscreen.vert · display · noise
src/components/   ← swappable occupants (unchanged)
src/compiler/     ← pure TS assembly logic (no .glsl)
```

Payoff: all GLSL is either `components/` (swappable) or `glsl/` (fixed) — nowhere else;
`compiler/generate/` becomes pure TS. Name is the one bikeshed (`glsl` / `kernel` /
`prelude` / `foundation`). This revises the `CLAUDE.md` "spine lives in generate/glsl/core"
line — an owner revising an earlier call now that more of the layout is built.

Mechanically it's the `film`-split shape: relocate `.glsl`, update `?raw` import paths,
re-golden provenance strings. No logic/contract-type changes, no component churn.

## Also fold in when we do this

- Sort out `src/math/` (TS): keep `vector3.ts` somewhere sane; delete the dead
  `random/*.glsl` (after the owner OKs).
- Blue-noise's `noise.glsl` (shared accessor) is being written into the CURRENT location
  (`compiler/generate/glsl/`) for now; it moves to `src/glsl/shared/` with this reorg.
- Resolve the `math` name collision (`src/math/` TS vs `glsl/core/math.glsl`).
