# Build log — November 2026 review

What was built on branch `claudeapp`, with how each piece was verified. This is the input for a
CHANGELOG entry (the owner's CHANGELOG.md has uncommitted edits, so it is not touched here).

## 2026-11-07 — bug fixes from the survey

Each fix was made in its own worktree with a regression test that fails before the fix, then
reviewed independently; all seven reviews said merge (one with two small follow-ups, applied in
166cf7f).

| commit | fix | evidence |
|---|---|---|
| a5935d0 | KeyboardControls: ArrowUp moved backward, W pitched down, A yawed right; stale Q/E roll text | tests/app/keyboardControls.test.ts: 3 of 4 failed before, 4/4 after |
| b16ef59 | Parameter panel widgets follow store changes; a flush is one batched write (one reset) | tests/app/parameterPanel.test.ts |
| ef89535 | Stats panel 'hide' now hides | tests/app/statsPanelStyles.test.ts |
| 57ecfaa | BVH/CWBVH builders throw when a tree is deeper than the GLSL walk stack (was a console.warn and silently dropped subtrees) | tests/components/cwbvh.test.ts, degenerate deep input |
| 68c8404 | Unread material keys warn (constant or driven); four scenes' no-op `albedo` on dielectrics removed (images unchanged, digest) | tests/compiler/validator.test.ts; analyze+validate over all 274 suite scenes: no new warnings |
| ec589a0 | vec3 checks reject NaN/Infinity; shape checks run before coupled rules | tests/compiler/validator.test.ts |
| 20f19ea | scripts/ typechecks (14 errors fixed, types only); NUL bytes in pages/scene-lab.ts written as escapes | tsc; tests/sourceText.test.ts |

Not a bug: "light-tree weights frozen at defaults" — the Validator already rejects driven emission
under lightSelection 'bvh', and driven emissive objects never join the tree.

Glass tints: the four scenes that authored `albedo` on a dielectric probably meant
`transmittance` (glassLabScene's neighbor uses it). Adding a real tint changes their images —
the owner's call.

## 2026-11-07 — quotient spaces: the cube 3-torus (branch `quotient`, worktree ../PTG-quotient)

Built on curved commit 4935183 (the bit-identical Euclidean respelling). Plan:
quotients-plan.md (revised after review-0 and review-1; committed on the branch as cfb783e).
Every step was reviewed independently and the review fixes applied.

| commits | what | evidence (measured) |
|---|---|---|
| e358ddc | `measurement.farClip` over the ambient descriptor's default (Euclidean 1000, H³ 10) | digest vs base: only the moved MAX_DIST define; frames 30/30 bit-identical |
| d73ec55, b2a0069 | quotient family, torus occupant, Validator rules (world boxes for objects, meshes, instance batches) | quotientValidator.test.ts (13 tests); walk twin: cells ≤ 0.993 of bound, 0 of 448,845 image ids wrong |
| acfd743, 045a6de | generated cell walk; image-aware NEE/MIS (27 images, partition MIS); witnesses; demo `torus-room` | torus-crystal vs unrolled crystal Δmean 0.01%; pt = pt-nee = pt-mis (power and bvh) Δmean 0.38%, χ²ᵣ 1.19; vitest twin controls fail at −94.7σ / −21.6σ; two deliberate bugs make the witness fail (10.2%, 7.5%) |
| 420c60a, 43f05f0 | homogeneous fog in the torus (medium vertices reduced into D), declared per-pixel bound (N+1)²e^{−σR}Le_max | torus-fog 8/8 windows vs float64 twin (0–5 face crossings); crystal fog Δmean 0.00%; estimator equality in fog Δmean 0.33% at 1024 spp |
| 0c6a425, e08f9e3 | review fixes; equiangular sampling rejected in a quotient | full vitest 4,336 pass; digest 282/282 identical |

Open (untested): pt-nee read 2.8% low at GGX roughness 0.15 in torus-lights (the fixture now uses
0.45; heavy tails suspected, not proven; decisive check proposed: 4k/16k spp). Nothing yet
catches a dropped `quotient_reduce` at medium vertices (shown by a power check). The ε/σ glow term
in the fog bound is derived in the quotient README, thought through, not checked numerically.
Seifert–Weber (Q2) waits for H³.
