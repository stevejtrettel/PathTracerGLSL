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
