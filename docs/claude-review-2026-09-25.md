# Review of the Sep 24–25 work (33 commits, 8d04f34 … cdccd81)

**What this is.** A review of every commit from the overnight session and the Sep 25 session,
against the standards in CLAUDE.md (one answer per fact, comments describe the present, no
deferred work described as built, estimators agree). Nothing has been changed yet: every item
ends with a proposed fix for you to accept or reject.

**How it was done.** Five independent reviewers read the commits at HEAD (cdccd81), read-only:
this session's ten commits; the overnight transport/GLSL fixes; the overnight compiler and
scene-data work; the overnight app/runtime work; and the documents. I then checked their
findings against the code. Each item says how it is known:

- **Checked** — I read the code (or derived the arithmetic, or reproduced the run) myself.
- **Reviewer** — a reviewer verified it by reading or running; I did not repeat the check.
- **Suspected** — plausible from reading; not reproduced on a GPU or in a test.

Items are ordered by importance within each part. Part 7 proposes how to work through them.

---

## Part 1 — Correctness

**1.1 The GRIN hard stop drops real light, and six texts claim it cannot.** *Checked (math).*
A ray that survives the 199 roulette draws carries weight 0.9⁻¹⁹⁹ ≈ 1.3·10⁹, so the light lost
at the 200-round stop is probability × weight = the full contribution of every traversal
longer than 200 × 512 steps. The roulette changes cost, not what a fixed stop cuts off: the
bias is exactly that of a fixed 102,400-step cap, which taxonomy §4.1 now forbids. The claim
"reached with probability ≈ 8·10⁻¹⁰, so it never decides the picture" is in grin.glsl (header,
two exits), grin.md, fable-variable-ior.md, fable-strategy-taxonomy.md §4.1,
claude-improvements-2026-09.md and CHANGELOG. (The tracking cap is different: its weights are
bounded, so there the small probability does bound the bias.) For lenses the dropped
traversals are trapped orbits, which contribute little; for an ambient GRIN medium (1.3) every
ray to the sky is dropped.
*Fix:* correct the six texts now; how GRIN gives up without bias goes into the GRIN design
note (Part 7).

**1.2 A shadow ray can be blocked by the emitter it is aimed at.** *Checked (geometry, not
rendered).* light.glsl launches the shadow ray from the offset point (`ray_spawn`, ε along
`ng`) but keeps the direction `ls.wi` computed from the unoffset hit point. For a receiver
under a parallel emitter the ray meets the emitter's surface at d − ε/cosθ while the search
ends at ≈ d − ε·cosθ − SHADOW_BACKOFF, so the emitter blocks NEE whenever
ε(1/cosθ − cosθ) > 0.002: at cosθ < 0.4 for marched receivers (ε = 10⁻³), and for fp-margin
receivers far from the origin at grazing angles (|p| ≈ 100 at 45°). NEE then returns 0 while
pt counts the emitter: pt-nee reads dark. Affects emissive objects and mesh lights, not
authored lights. The mechanism predates Sep 25; the mesh-margin change moved which scenes hit
it. The coupling test's comment models the shortfall without the 1/cosθ factor.
*Fix:* aim the shadow ray from its spawned origin at the light point (pbrt's SpawnRayTo);
first a witness at a grazing emitter angle that fails today.

**1.3 GRIN: the thin-edge pass skips the glass rule; an ambient GRIN medium is silently
wrong.** *Checked (read).* When the straight distance across a GRIN region is below one step,
the walker passes the ray straight through without the delta record the glass rule requires
(so nee and mis lose light that pt counts at lens rims and near-wall scatter events). An
ambient deflecting medium is out of scope by design (fable-variable-ior.md: "the ambient space
stays flat") but is not rejected; the walker has no far clip, so its rays never reach the sky.
*Fix:* GRIN design note (Part 7).

**1.4 Loading a session can bias environment sampling.** *Checked (read).*
`ParameterStore.restore` removes every key the session lacks, including `env.size`,
`env.totalWeight` and `env.sizeOct`, which the App measures when it loads the map. They fall
back to compiled defaults (a 1×1 table), so environment NEE's sampler and pdf are wrong with no
error. *Fix:* keep loader-measured values out of the session-owned set (or re-derive them after
a restore).

**1.5 Tiled rendering can break a production started after it; stopped jobs look like
successes.** *Checked (read).* `ProductionOrchestrator.renderTiles` skips clearing its pixel
offset and image size when a newer session exists, and `App.renderTiled`'s `finally` calls
`start()` unconditionally, tearing down whatever production is running. `renderTiled` also
swallows `RenderStoppedError` (callers cannot tell saved from stopped) and calls `stop()`
before checking whether a job is already running, so a second call kills the first. *Fix:*
clear the tile state unconditionally; restart interactive only if no newer session exists;
return a status; check for a running job first.

**1.6 Auto-export can save a cleared image.** *Checked (read).* After the render, auto-export
awaits the (now async) PNG encode before reading the HDR. Escape is accepted while locked, and
`stop()` resizes and clears the buffer, so the HDR (and AOVs) can be read from the cleared,
restored-size buffer and saved with a stamp. *Fix:* read every buffer and build the stamp
synchronously, then encode.

**1.7 Context restore: an unguarded window, swallowed failures, invisible frame errors.**
*Checked (read).* The restore pauses and then awaits repacking and the environment fetch;
`\` (pause/resume, accepted while locked), Space and the panel can restart rendering inside
that window, before the textures are re-registered. `_showErrorOverlay` shows nothing unless
the error carries a diagnostic bag, so frame errors (`RENDER_ERROR`) and restore failures are
never shown, although the CHANGELOG says they are. `loadEnvironmentHDR` records the new path
before the load succeeds, so a failed load poisons every later restore. A restore also leaves a
finished production offering export of an empty image (reviewer). *Fix:* a restoring gate that
start/resume respect; show plain errors; log restore failures; assign the path after the load.

**1.8 A second `initialize()` replaces the scene-data layout under loaded renderers.**
*Checked (read).* `RendererManager.initialize` compiles only the new strategies and replaces
the scene data; earlier renderers stay loaded with offsets baked against the old layout. The
witness runner's variance path does exactly this, and its comment says "nothing already loaded
is clobbered". The runner does not render the old renderers afterwards, so no witness number is
affected today. *Fix:* make `initialize` replace, or recompile the union; fix the comment.

**1.9 An emitter's light values and its surface are derived on two paths.** *Checked (read).*
The light roster folds each emissive object's radiance and placement itself (dataTenants.ts);
the Planner resolves the same object's material emission and placement separately. pt ≡ pt-nee
needs them equal; nothing but the GPU witnesses checks it, and the one vitest that compared
them was removed as a tautology. The reviewer found they agree for today's inputs. *Fix:* one
function for both, or a vitest pinning roster values against the planned object and material.

**1.10 The environment colour is never validated.** *Reviewer (ran it); I confirmed there is no
rule.* A negative colour or a nonsense blackbody compiles and silently feeds the env-selection
probability. Materials and lights have these checks. *Fix:* one shared spectrum check for all
three sites.

**1.11 Smaller or suspected correctness items.**
- rough_dielectric tests `eta == 1.0` on the quotient `n_i / n_t` (three places); real GPUs may
  not divide exactly, skipping the index-matched case. *Suspected* (SwiftShader divides
  exactly). *Fix:* compare `n_i == n_t`.
- Mesh-light sampling normalizes a zero cross product for a degenerate sliver (NaN passes
  `cos_l <= 0.0`). *Suspected.* *Fix:* `if (!(cos_l > 0.0))`.
- OBJ: a corner whose faces cancel still gets a (0,0,0) normal; the "area-weighted vertex
  normal" comment overstates what is computed. *Reviewer.*
- The fp spawn margin uses |p|, but `hit.p = o + t·d` carries error ≈ ε·max(|o|, t): a camera
  far from the geometry can exceed it. *Suspected* (premise shared by the analytic tier since
  August). *Fix:* measure first.
- `compileScene(scene, [])` throws a TypeError; `maxBounces` / `maxNullCrossings` above 2³¹
  produce invalid GLSL instead of a diagnostic. *Checked / Reviewer.*
- CI's concurrency group lets a push cancel the dispatched witness sweep; CI has never run
  (33 commits unpushed). *Checked (read).*
- The glslang harness reports a validator crash (killed by a signal) as "needs Rosetta".
  *Checked (read).*

---

## Part 2 — One answer per fact

Each of these is a decision made in two places that must agree.

| Where | What is duplicated | Known by |
|---|---|---|
| Validator `samplableObjectUses`, roster kinds (Validator.ts ~637, ~1511) | the light census — CLAUDE.md: "use it; don't re-derive it"; the copy lacks `regionLightKind` | Checked |
| Validator `placementProblem` / camera `wellShaped` | copies of `validateScale`/`validateRotation`; a second shape check without the finiteness rule | Reviewer |
| Planner `environmentSelectionLive` vs lighting.ts | whether the env-selection draw exists | Reviewer |
| app/sceneData.ts | sphere-light power Φ = π·4πr²·Le and the channel mean, duplicating the descriptor; silent 1e-8 fallback | Checked |
| materials.ts (five sites) | "does this medium scatter in this program" | Checked |
| Validator (two rules) | emission on a non-emitting model — two warnings for one mistake | Reviewer (ran) |
| environment.ts vs equirect.glsl | the equirect mapping; the wrap fix went into one | Reviewer |
| RenderCoordinator `fail` vs `stopInternal` | the stop sequence | Checked (read) |
| witness fixtures | `MAX_DIST`, `SHADOW_BACKOFF` and fog-sky's `exp(-1)` copied from GLSL without a pin | Reviewer |

Latent structure (no failure today, no guard either — *Reviewer*): the scene-data plan is built
from `plans[0]` on the unasserted premise that any plan serves; `compileScene` never asserts
that each program reads only what the layout holds; region→material ids are built without a
completeness check; the rule "a tabled object's residual must be expressible by its record" is
implicit. Dead output: `CompiledScene.dataReads` has no production reader; materials.ts builds a
`defines` object that is always empty (*Checked*).

---

## Part 3 — Tests and witnesses that do not test what they claim

- `mesh-light-smooth` says it gates the MIS pdf's normal; by the CHANGELOG's own numbers the
  pdf fix moved the error from 5% to 4.95%, far below its 2% tolerance, so it gates the spawn
  side only. *Checked (from the recorded numbers).*
- Tests that cannot fail: rough_dielectric's η = 1 test exercises the twin's own branch;
  lightCensus compares the roster with plan values built from the roster; cwbvh asserts
  `order.length`, which is always n. *Reviewer.*
- No witness checks the bounce budget inside media at small `maxBounces`; an off-by-one in the
  medium branch would pass everything. *Reviewer.*
- Tiled rendering is claimed "byte-identical" (CLAUDE.md, production-rendering.md): the files
  carry a date, so at most the pixels are, and no test or witness checks even that. *Checked.*
- `null-budget`'s pt tripwire was set at 1.2× the measured noise; the README's policy is ~1.5×.
  *Reviewer.*
- The procedural-environment validator test passes the wrong `params` shape behind `as any`; a
  `{param}` fov's slider range is not checked against (0, π); the PNG encoder's multi-batch
  path and the RGBE negative clamp are untested. *Reviewer.*

---

## Part 4 — Documents that are wrong

**4.1 Normative documents that would reintroduce fixed bugs if followed.** *Checked.*
fable-reference-implementations.md ("transcribe, don't re-derive") still has the shadow walker
bounded by `MAX_SHADOW_SEGMENTS` and the walk bounded by `bounce < MAX_BOUNCES`;
fable-compiler-contracts.md has the same loop, "1e20 for environment/directional" as the light
distance, and null crossings with a "safety counter". Both are listed in CLAUDE.md's design
authority table.

**4.2 Status claims that are false.** *Checked or Reviewer as marked.*
- CLAUDE.md: the "180 of 181" sweep predates the afternoon's transport changes, which had
  targeted runs only (*Checked*); the bias ledger omits `scattering: 'ignored'`; "six shared
  data textures" (there is a seventh, integer one); "the App derives nothing" (it still derives
  the environment tables); "byte-identical" tiling; "remaining audit items are in Part 1"
  (*Reviewer*).
- trace-loop-contract.md lists mesh/BVH and multiple backends as deferred — built work described
  as deferred (*Checked*); it also points at a file that no longer exists and says there is no
  local-frame BSDF (GGX has one) (*Reviewer*).
- fable-variable-ior.md still describes `MAX_ODE_STEPS`, "the traversal consumes a bounce — the
  budget that bounds trapped closed orbits", "conservative exhaustion", and an exit test by
  region rather than by material (*Checked*).
- fable-heterogeneous-media.md:282: "on budget exhaustion: conservative" (*Checked*).
- claude-improvements-2026-09.md Part 7 describes the reverted cap-1024 warning and fog box as
  current; other items are settled or wrong (the GPU-profiling default) (*Checked*).
- tests/witnesses/README.md lists witnesses added after the Sep 25 sweep as part of it
  (*Reviewer*).
- fable-data-rail.md, fable-light-bvh.md, fable-accel-cwbvh.md, fable-object-tables.md and many
  code comments still say the App calls the layout functions and that optional structures are
  always uploaded — both changed by the data-linkage commits (*Reviewer*).
- production-rendering.md: export examples without `await`, two events that do not exist, and a
  settings dialog listed as unbuilt (*Checked*, the dialog part *Reviewer*).
- docs/README.md: stale rows and an unindexed doc (*Reviewer*).

**4.3 CHANGELOG.** *Checked.* Today's collision-cap work is recorded three ways (fixed cap and
warning, fog box, derived bound) with two different correction conventions, and the budgets
entry still contains the false "constant media have no null collisions". Several numbers lack
their method (spp, salt, image size). "The eight GRIN witnesses" omits `rough-grin`, which also
runs the walker. There is no entry for the Sep 25 full sweep.

---

## Part 5 — History in comments

CLAUDE.md forbids dates, "until", "used to", batch codes and "Sep 25 audit" tags in comments;
the reviewers found several dozen in code and tests written or edited in these two days, e.g.
grin.glsl ("Until Sep 25 2026 …", "(Sep 25 2026, measured …)"), directional.glsl,
lights/sphere, geometry/sphere, materials.ts, Validator.ts, dataTenants.ts, ParameterStore.ts,
shader-uniform-utils.ts, ProductionOrchestrator.ts, cwbvh.ts, light_tree.glsl, worker.ts, and
test titles such as `describe('… Sep 25 audit')`. *Checked (grep, a sample of each file).*
Also stale present-tense comments: math.glsl (mesh hits "keep the 1e-3 magnitude"),
media.glsl ("closed-form Beer–Lambert over full σ_t"), the GRIN |T| comment (states as exact
what is an empirical choice), sphere.md's "exactly 2×".

---

## Part 6 — Hygiene

- `pages/scene-lab.ts` contains raw NUL/SOH bytes, so git treats it as binary and diffs of it
  are invisible. *Checked.*
- One data-linkage commit (bfc41cb) also changed the witness harness (history; noted only).
- The survey commit claimed "every loop bound" but missed the wide-BVH walk's fixed
  65,536-iteration guard, and called warn-at-build stacks "checked and unreachable". *Checked.*

---

## Part 7 — Proposed way through

Each batch below would get its own short written plan (problem, boundaries, verification) for
your approval before any code, and its own targeted witness run.

1. **Documents first (no code). Done Sep 25.** The normative documents (4.1), the status claims
   (4.2), today's CHANGELOG entries consolidated and corrected (4.3), and the six
   GRIN-hard-stop texts (1.1). Not done in this batch: stale *code comments* (Part 5, including
   the ones that still say the App calls the layout functions, and the ledger's "light tree —
   appended last"), which belong to batch 6.
2. **Contained correctness fixes. Done Sep 25** (claude-review-batch2-plan.md; CHANGELOG
   "review batch 2"). Each with a failing test or witness first where feasible:
   session restore (1.4), tiled teardown (1.5), auto-export (1.6), context restore (1.7),
   `initialize` (1.8), environment-colour validation (1.10), and the small items in 1.11.
3. **The shadow-ray aim (1.2)** — a transport change: its own plan and witness.
4. **One answer per fact (Part 2)** — refactors only, no behaviour change, each proven by
   unchanged snapshots and witnesses.
5. **Tests that do not test (Part 3)** — replace with ones that can fail.
6. **History in comments (Part 5)** — mechanical, in one commit.
7. **The GRIN design note** — the thin-edge pass, whether a traversal is a bounce, rejecting the
   ambient case, and giving up on long traversals without a fixed stop (1.1, 1.3).
