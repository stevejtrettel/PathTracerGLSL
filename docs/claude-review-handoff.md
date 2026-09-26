# Handoff — where the Sep 25 review stands, and what comes next

**Status:** current as of commit 6e528d6 (Sep 25, 2026). This page is for resuming work after
a context break. Update it or delete it when the review is done. Nothing here overrides
[claude-review-2026-09-25.md](claude-review-2026-09-25.md), which has the findings; this page
covers the state, the working rules and the next step.

**Starting a new session:**
1. Read this page, CLAUDE.md, and review Part 7.
2. Then write the batch 3 plan (§3) and ask the owner to approve it. Write no code before that.

The full Sep 24–25 conversation is at
`~/.claude/projects/-Users-stevetrettel-Code-PathTracerGLSL/82cdb188-a9ad-46c5-9cfb-c8888062efff.jsonl`,
if a detail is needed.

---

## 1. Where things stand

- **Batch 1 (documents) and batch 2 (contained correctness fixes) are done.** Batch 2's plan
  and its deviations are in [claude-review-batch2-plan.md](claude-review-batch2-plan.md), and
  the CHANGELOG entry is "review batch 2".
- **The working tree is clean.** 48 commits on `main` are **not pushed**. CI has never run on
  any of them, and the CI concurrency change (46cf2dc) is unverified until the first push.
- **`npx vitest run`:** 2902 passing. `npx tsc --noEmit` is clean.
- **Full witness sweep:** not run since c5f3543. Only targeted witnesses have run since then.
  Ask the owner before running the full sweep (45 min).
- **Review web page (the owner's copy):** https://claude.ai/artifact/HVH8Rs64ECjcEFCdso2iZY
  (version 3, batches 1–2 marked done). Its source is in the session scratchpad
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

## 3. Next step: batch 3, the shadow-ray aim (review 1.2)

**Nothing is written yet.** The next action is to **write the plan** as
`docs/claude-review-batch3-plan.md` and ask the owner to approve it. What follows is the
starting material, not an approved design.

**The problem (checked by reading and geometry, not rendered):**
- light.glsl:16–18 starts the shadow ray at the offset point (`ray_spawn(hit, ls.wi)`, offset
  along `ng`), but keeps the direction `ls.wi` computed from the un-offset `hit.p`.
  `light_p` is also computed from `hit.p`.
- For a receiver under a parallel emitter, the ray meets the emitter at d − ε/cosθ, but the
  search stops at ≈ d − ε·cosθ − `SHADOW_BACKOFF` (0.002, math.glsl:37). So the emitter
  blocks its own light when ε(1/cosθ − cosθ) > 0.002. This happens:
  - at cosθ < 0.4 for marched receivers (ε = 10⁻³);
  - at grazing angles for receivers far from the origin (|p| ≈ 100 at 45°).
- **Effect:** pt-nee and pt-mis read darker than pt. This affects emissive objects and mesh
  lights, not authored analytic lights.
- tests/components/epsilonCoupling.test.ts:69–74 models this shortfall without the 1/cosθ
  factor. Its premise is the bug.

**Candidate fix (pbrt's SpawnRayTo):** aim the shadow ray from its spawned origin at
`light_p`. Only the visibility ray changes. The BSDF, the cosine and the pdf keep `ls.wi` from
`hit.p`. **Questions the plan must settle with the owner:**
1. **Curved spaces.** Aiming "from o at p" needs a direction-to-point operation.
   - In Euclidean space it is `normalize(p − o)`; in H³ or Nil it is a log map.
   - Adding it (for example `ambient_direction_to`) extends the `ambient_*` seam. That is an
     interface change, so discuss it first.
2. **Infinitely distant lights** (directional, environment). Their `light_p` is at `MAX_DIST`.
   Re-aiming turns a delta direction by about ε/1000.
   - The candidate rule: keep `ls.wi` for lights at infinity, and re-aim only for lights at a
     finite distance. Decide this explicitly.
3. **The medium techniques.** light_medium.glsl:15 and equiangular.glsl:49 use
   `make_ray(p_evt, …)` with no offset. As read, the bug doesn't apply there. Confirm this in
   the plan.
4. **The null-interface shadow walker.** media.glsl:36 recomputes the remaining distance per
   segment, and :55 re-spawns at each crossing. Decide whether each segment also re-aims.

**Verification to write first:** a witness in which pt and pt-nee disagree today. For example,
an emissive surface at a grazing angle over a marched receiver with cosθ < 0.4, checked for
pt ≡ pt-nee. Run it on the old code and see it fail. Then fix the coupling test's model. Then
run the targeted light and emitter witnesses (mesh-light-*, cornell-*, the estimator-equality
set).

## 4. After batch 3 (order from review Part 7; each needs its own approved plan)

- **Batch 4 — one answer per fact (review Part 2).** Refactors only, with no behaviour
  change, proven by unchanged snapshots and witnesses. It includes:
  - the Validator's copy of the light census;
  - the emitter values derived twice (review 1.9);
  - "does this medium scatter", decided in five places;
  - env selection;
  - sphere-light power in app/sceneData.ts;
  - the equirect mapping;
  - `fail` / `stopInternal`;
  - the witness constants copied from GLSL;
  - the dead output (`CompiledScene.dataReads`, the always-empty `defines`). Propose this
    and ask; don't remove it as a matter of course (see the unused-code rule in §2).
- **Batch 5 — tests that can't fail (Part 3).** Replace them with tests that can.
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
- **The fp spawn margin** (review 1.11, suspected). It needs a measurement plan before any fix.
- `pages/scene-lab.ts` contains NUL bytes, so git treats it as binary (Part 6).
- **Pushing, and the first CI run:** the owner decides when.

## 5. Practical notes

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
- **Manager tests** use the fakes in tests/app/fakes.ts. `App` itself has no harness.
- On Apple silicon without Rosetta, the glslang tests fail with "could not be run". That is
  the tool, not the code (see CLAUDE.md).
