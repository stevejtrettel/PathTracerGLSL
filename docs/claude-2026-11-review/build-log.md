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

## 2026-11-07 — curved spaces: H³ and S³ (branch `curved`, worktree ../PTG-curved)

Design: curved-spaces-design.md (revised after three reviews). Each step reviewed; fixes applied.

| commits | what | evidence (measured) |
|---|---|---|
| 802c25d | frame cases covering every respelled file | 30/30 bit-identical on repeat |
| 4935183, 6c92754 | Euclidean respelling of the ambient seam | digest: text only; frames 30/30 bit-identical |
| 76da042, 3a5498f | phase functions take the event point | frames bit-identical |
| e4f9bdd, c9f0a3d | space gate: GLSL keyed by space, `curvedLimitations`, support table | Validator tests |
| 0371782, 56e4d61 | H³: hyperboloid occupant, sphere/plane/disk, point and disk lights, mat4 isometries, camera frame | 6 witnesses, 17/17 exact checks (furnace 3.951424 under pinhole and fisheye; disk light 0.3233549; point lights under power and uniform; sky key; driven isometry; medium nee ≡ mis ≡ pt) |
| ec392a4, 6b6cd5e | S³: two-arc light sampling, long-arc shadows, radius domains (0, π) | 15/15 checks; blocker on the long arc reads exactly 0; two deliberate bugs caught |

Intended Euclidean change: HG phase sampling builds its basis with `ambient_frame`, so the 8 frame
pictures with HG media (medium, medium-mis, grin, rayleigh) are no longer bit-identical; their
witnesses (furnace-scatter, grin-furnace, slab-albedo-aniso, fog-area, haze) pass.

Measured finding: SwiftShader's sin/cos are off by up to 1.9e-4, which put S³ hits off the surface
by more than the spawn offset; S³ uses its own `spherical_cos_sin` (error ≤ 7e-8).

Open for the owner: `spherical_light_arc` (a light-sampling choice) lives in the S³ ambient
occupant; a reviewer suggests a lights-family helper. Transformed groups are an error in curved
spaces (flattenGroups does not compose isometries yet). App orbit/fly controls are not isometric.

## 2026-11-07 — photorealism (branches `photo-materials`, `photo-camera`, `photo-textures`)

Plans: photoreal/ (eight plans, their reviews, integration.md). Each step reviewed; fixes applied.

| branch | steps (commits) | notes |
|---|---|---|
| photo-materials | guards (fe1d428, 552d7f8); plastic (3581715); derived fields (e311c71); frames GGX/rough-glass cases (ada5a8f); energy compensation `measurement.microfacet` (5026bc1, ae1eed0); thin_dielectric (55deaf9, e83eb54); sheen (a2121a3 bug fix, 73ab929); GGX lobe extracted (0a5d531, 3b20506); conductor + rough_conductor with pbrt-v4 metal tables, 'optical' role, 'measured' kind (dafb913, e03b5be, 08ff27b); measured colors: ColorChecker, CIE A/D65/FL2/FL11/LED-B3 (268e241, 8a52887) | rough_conductor is single-scattering only (rejected under energy compensation until its F_avg gain is built); `{ measured: { table, scale? } }` spelling is provisional |
| photo-camera | Gaussian filter + thinLensFromPhoto (633cd0d, e1eac80); bladed aperture + white balance (094def8, 3a0aa84) | white balance source is Planck at every temperature (not pbrt's daylight locus above 4000 K) |
| photo-textures | Perlin (6dade9a); procedural bump (69ced33, 2552c8a); image textures, RGBA8 array (c82e49e); Poly Haven trial assets, offline glTF→OBJ (1f396e1, dc80497) | roughness/normal maps are fetched but unread (need per-hit derived rows and a tangent on Hit) |

Integration branch `integrate` (../PTG-integrate): quotient, photo-camera, photo-textures, and
photo-materials at e83eb54 merged; `npm run shoot` (real-GPU renders, b9a9a6a); six photographic
scenes (f6782f8), renders in renders/photo/ (gitignored). Materials after e83eb54 (sheen, metals,
measured colors) and branch `curved` are not merged there yet.
