# Handoff — where the Sep 25 review stands, and what comes next

**Status:** current as of commit 6e528d6 (Sep 25, 2026). This page is for resuming work after
a context break. Update it or delete it when the review is done. Nothing here overrides
[claude-review-2026-09-25.md](claude-review-2026-09-25.md), which has the findings; this page
covers the state, the working rules and the next step.

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
  - the dead output (`CompiledScene.dataReads`, the always-empty `defines`).
- **Batch 5 — tests that can't fail (Part 3).** Replace them with tests that can.
- **Batch 6 — history in comments (Part 5).** Mechanical, one commit. It also covers the stale
  "App calls the layout functions" comments and the ledger's "light tree — appended last".
- **Batch 7 — the GRIN design note (review 1.1, 1.3). Open decisions:**
  - **A:** the thin-edge pass skips the glass rule's delta record.
  - **B:** whether a traversal is a bounce. The recommendation was "no bounce, like glass".
    **The owner has not decided.**
  - **C:** reject an ambient GRIN medium at validation. It is out of scope by design.
  - **D:** how to give up on long traversals without a fixed stop. Today GRIN_MAX_ROUNDS = 200
    drops traversals longer than 102,400 steps, and this is documented as a bias.

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
