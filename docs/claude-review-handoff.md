# Handoff — where the Sep 25 review stands, and what comes next

**Status:** current as of the batch 5 records commit (Sep 26, 2026). This page is for resuming work after
a context break. Update it or delete it when the review is done. Nothing here overrides
[claude-review-2026-09-25.md](claude-review-2026-09-25.md), which has the findings; this page
covers the state, the working rules and the next step.

**Starting a new session:**
1. Read this page, CLAUDE.md, and review Part 7.
2. Then ask the owner about batch 5's open items (§4), and write the batch 6 plan for approval.

The full Sep 24–25 conversation is at
`~/.claude/projects/-Users-stevetrettel-Code-PathTracerGLSL/82cdb188-a9ad-46c5-9cfb-c8888062efff.jsonl`,
if a detail is needed.

---

## 1. Where things stand

- **Batches 1–5 are done** (batch 5 but for its paused and owner items). Batch 2: [claude-review-batch2-plan.md](claude-review-batch2-plan.md),
  CHANGELOG "review batch 2". Batch 3 (the shadow-ray aim, review 1.2):
  [claude-review-batch3-plan.md](claude-review-batch3-plan.md), CHANGELOG "review batch 3".
  Batch 4 (one answer per fact, review Part 2):
  [claude-review-batch4-plan.md](claude-review-batch4-plan.md), CHANGELOG "review batch 4".
  Batch 5 (tests that can fail, review Part 3; test-only, owner-approved in principle):
  [claude-review-batch5-plan.md](claude-review-batch5-plan.md), CHANGELOG "review batch 5".
- **The working tree is clean.** 77 commits on `main` are **not pushed**. CI has never run on
  any of them, and the CI concurrency change (46cf2dc) is unverified until the first push.
- **`npx vitest run`:** 2967 passing. `npx tsc --noEmit` is clean.
- **Full witness sweep:** not run since c5f3543. Only targeted witnesses have run since then.
  Ask the owner before running the full sweep (45 min).
- **Review web page (the owner's copy):** https://claude.ai/artifact/HVH8Rs64ECjcEFCdso2iZY
  (batches 1–5 marked done). Its source is in the session scratchpad
  (`sep25-review.html`), which does not survive a new session. To update the page, read it
  back with the Artifact tool's `read` action.

**Not proven by batch 2:**
- **Two shader fixes can't be made to fail on SwiftShader:** rough dielectric's `n_i == n_t`
  test, and the mesh-light `!(cos_l > 0.0)` guard. The only check was that 18 witness numbers
  are identical before and after.
- **One tiled case was never observed:** a production started while the finished tiled job is
  still writing its PNG. It didn't reproduce, even at 8K, so its guard is unproven.

## 2. How we work (owner's rules — follow exactly)

- **No code without a written plan the owner has approved.** Each plan states:
  - the problem, with evidence (file:line);
  - the rule being enforced;
  - the fix;
  - boundaries (which files it touches, and nothing else);
  - the verification, written before the code;
  - non-goals.
- **Failing test first** where one is possible, and see it fail. Where the fix is in `App`
  (no test harness), use a headless before/after probe and record it in the CHANGELOG.
- **One commit per item** on `main`, not pushed, ending with the co-author trailer. One
  CHANGELOG entry per batch. Mark the plan "done", with its deviations.
- **Targeted witnesses only.** Never start the 45-minute sweep without asking.
- **No fixed "big enough" numbers** that can change the picture. Bounds are derived, or they
  are declared truncations in the measurement.
- **Talk in plain, short language.** Offer few questions, and only real decisions.
- **Label predictions as predictions.** Read or measure before stating a fact. (Five false
  claims were made and corrected during the review.)
- **Discuss loop and interface changes with the owner before implementing.** Don't mix
  refactors with feature work.
- **"Unused" is not "broken".** Keep working alternatives (for example CWBVH). What is wrong
  is doing runtime work nothing reads. Fix or park broken code. Ask before deleting anything.
- **Don't run things for the sake of it.** Answer from what is known, and run a check only
  when a change needs verifying.
- **These rules replace the overnight mandate** of Sep 25 ("fix bugs yourself and report
  back"). They were set after that mandate produced implement-then-correct work.

**Earlier decisions recorded elsewhere:**
- **Renderers are chosen by key**, with no automatic switching, and every declared renderer
  is built up front. Debug images (AOVs) come in two kinds, scene and algorithm, and get a
  later design pass. All of this is in
  [claude-data-exact-linkage.md](claude-data-exact-linkage.md), "Decisions".
- **The owner plans normal and bump mapping.** That is why `Hit.ng` exists.

## 3. Batch 3 — done

The shadow ray is re-aimed at the light point (`ambient_direction_to`), at the surface and after
every null crossing in the media walker. The plan, its decisions and deviations are in
[claude-review-batch3-plan.md](claude-review-batch3-plan.md); the numbers are in the CHANGELOG.
Two things it left open are listed under "Also open" below.

## 4. Next: batches 6–7 (order from review Part 7; each needs its own approved plan)

Batches 4 and 5 are done (their plans record the deviations). Their open items are under "Also
open" below.

- **Batch 6 — history in comments (Part 5).** Mechanical, one commit. It also covers the stale
  "App calls the layout functions" comments and the ledger's "light tree — appended last".
- **Batch 7 — the GRIN design note (review 1.1, 1.3).** Start from `docs/fable-variable-ior.md`,
  which already settles:
  - the two wall models;
  - the glass rule: every pass through the region is recorded as delta, and shadow rays treat
    it as opaque;
  - that the ambient (whole-space) case is out of scope.

  **The owner's framing (Sep 25):** GRIN is used in two situations.
  - **Seamless:** an ambient space, or n drops to 1 before the boundary. There must be no
    visible edge. This is the `'none'` wall.
  - **Encased in an object** with n ≠ 1 at the boundary. It wants the option of refraction
    at the boundary. This is the `'dielectric'` wall.

  **Open items:**
  - **A: the thin-edge pass skips the delta record.** This is a bug against the existing glass
    rule. Plan: a witness (a GRIN slab thinner than one step) that shows pt ≠ nee today,
    measured before any fix.
  - **B: whether a traversal is a bounce. Undecided.**
    - At 18:19 the owner agreed that "one trip through GRIN is one event". That rule is built:
      it replaced the old charge of one bounce per 512 steps.
    - At 23:08 the owner asked how glass works, saying "I imagine this should work like
      glass". I proposed "no bounce": glass charges its wall hits, not its inside.
    - The owner then stopped the discussion to insist on plans first.
    - Treat the built rule as current until the owner decides. Before "no bounce" could be
      adopted, it must be shown that the path walk still always ends.
  - **C: whether the Validator rejects an ambient GRIN medium.** It is out of scope by design
    and misrenders silently. The owner's call.
  - **D: how to give up on long traversals without a fixed stop.** Today
    GRIN_MAX_ROUNDS = 200 drops traversals longer than 102,400 steps. This is documented as a
    bias.
  - **Separately, `eta_scale`:** an item that affects noise only, never the answer.

**Also open (not in any batch yet):**
- **From batch 5** (details in its plan):
  - rough glass is discontinuous at η = 1 (measured; a modelling question), and its η = 1 test
    still checks the twin against itself;
  - an automated tiled-render check (a runner feature);
  - a witness for the mesh light's MIS pdf normal (research).
- **From batch 4:**
  - The scene/program restructure: plan a scene's objects, lights and materials once, then each
    renderer's decisions against them. Today each renderer's plan repeats the scene part, and the
    scene data is built from `plans[0]`. Batch 4's item 2 option (b), deriving an emitter's light
    from its planned surface, waits for it. Owner to discuss.
  - A `{param}` emission on a model that cannot emit gets two warnings (predates batch 4).
- **The fp spawn margin** (review 1.11, suspected). It needs a measurement plan before any fix.
  Batch 3 measured two effects of the spawn offset itself in its witnesses: pt sees a light
  from the raised origin (reads 4/(4 + (0.25 − ε)²), exactly), and pt-mis reads +0.05% / +0.14%
  high at ε = 10⁻³ / 3·10⁻³ — a hypothesis, unchecked: the MIS weight converts the BSDF sample's
  density from the hit point, while its ray starts at the raised origin.
- **`SHADOW_BACKOFF` is a fixed 0.002.** After batch 3 its only job is the light's own rounding
  error, but NEE still ignores an occluder within 0.002 of the light point, which a BSDF ray
  sees. Deriving it (pbrt-v4 offsets the light point along its normal by its error bound) needs
  the light's normal in `LightSample`, an interface change. Needs its own plan.
- `pages/scene-lab.ts` contains NUL bytes, so git treats it as binary (Part 6).
- **Pushing, and the first CI run:** the owner decides when.

## 5. Practical notes

- **Keep the Mac awake during witness runs** (`caffeinate -i npm run witness -- …`). In idle
  sleep, renders make progress only during brief maintenance wakes, so they time out or the
  page reloads. On Sep 26 this looked like a 170× slowdown from the batch 3 change; it was sleep
  (`pmset -g log` has the times).
- **Targeted witnesses:** `npm run witness -- name1 name2`. In zsh, pass the names literally.
  An unquoted `$VAR` passes them as one argument, and the run silently renders nothing. Check
  that the logs are non-empty.
- **Headless probes:** Playwright scripts that import
  `/Users/stevetrettel/Code/PathTracerGLSL/node_modules/playwright/index.mjs`.
  - Launch with `--use-angle=swiftshader --enable-unsafe-swiftshader`.
  - Run them against `npm run dev` on :3000, opening `lab.html?scene=<id>`.
  - `window.app` is exposed.
  - Batch 2's probes (`probe-tiled.mjs` and others) are in the session scratchpad, which is
    lost in a new session.
  - To measure a witness's noise (batch 3), render one arm at several salts with the runner's
    steps (tools/witness.mjs `renderFrame`): `app.stop()`, `app.pinResetSalt(salt)`,
    `app.selectRendererByStrategy(id)`, `app.resize(w, h)`, `app.renderProduction(spp)`, then
    average `app.readExport('hdr')`.
- **Manager tests** use the fakes in tests/app/fakes.ts. `App` itself has no harness.
- On Apple silicon without Rosetta, the glslang tests fail with "could not be run". That is
  the tool, not the code (see CLAUDE.md).
