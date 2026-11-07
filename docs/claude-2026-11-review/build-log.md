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

## 2026-11-07 (day) — Seifert–Weber, curved shapes, curved SDFs, H²×R; integration

Lean protocol from midday on (one full vitest per step, reviewers read and mutation-test, one
heavy job at a time through a lock). All counts below are measured on SwiftShader, targeted runs.

| branch (worktree) | what | evidence |
|---|---|---|
| `sw` (../PTG-sw): 861f175, 8f9ca2a, 3886843, ad0899e, c108153, efc5c34 | `curved` merged into `quotient`; Seifert–Weber in H³: group data (FACE_N, PAIRING), locked `Hit` gains `image` and `arrival`, the teleporting walk with renormalization, 13-image NEE/MIS, camera reduced into D, Validator rules; demo `seifert-weber-room` | windows witness 11/11 exact (0–3 crossings, misses); twist 1/10 bug fails 6/11 (two windows survive by a dodecahedral symmetry, so the plan's "every image moves" was wrong and is corrected); pt-nee = pt-mis Δ 0.00%, image-index bug caught at 2.58%; walk counter: 0 capped, drift ≤ 9.5e-6 |
| `cv-shapes` (../PTG-cv-shapes): 6ad0465…3317dc0 | H³/S³ box (geodesic planes), tube-about-a-geodesic cylinder with caps, quad, quad light (exact chart-uniform pdf); size domains in the Validator | 17/17 checks; windows equal fp64 twins to 4 digits; quad light 0.1750 vs 0.1749918 (H³), long-arc-only 0.3238 vs 0.3237615 (S³); pdf w³→w² bug fails as predicted |
| `cv-sdf` (../PTG-cv-sdf): 6d50b71…c165e63 | marching along geodesics in H³/S³: `defineSDF` with curved bodies (ball, plane, tube, smooth CSG), marched sphere, H³ Klein-chart door for Euclidean fields; demos `hyperbolic-sculpture`, `spherical-sculpture` | 18 checks pass; marched vs closed-form ball Δ 0.03%; furnaces exact; blends match fp64 twins; reviews caught two S³ interval bugs (fixed) |
| `cv-h2r` (../PTG-cv-h2r): 0335ce2…076dca1 | H²×R: occupant, falloff J = d²·sinh(D_H)/D_H (Jacobi fields), horizontal/vertical planes, horizontal disk, capped vertical cylinder, metric ball by convex Newton, point/disk lights; demo `h2xr` colonnade | 23/23 exact checks; isotropic d² falloff fails all 15 point-light checks; GPU runs found and fixed NaN far out and a furnace shortfall |
| `integrate` (../PTG-integrate): 801adb7…66029d5 | claudeapp + quotient + photo-camera + photo-textures + photo-materials (8a52887) + sw at 861f175; `npm run shoot`; six photographs (9012f94) | full vitest 4789 pass at af47ffc; 135/135 witness checks; frames bit-identical to every branch tip |

Open for the owner: the weak mutation in H²×R (`isometry_direction` without stripping the height
shift: 1 of 15 checks); under the pinned seed the χ² gate cannot see an MIS-weight bug between
pt-nee and pt-mis (only the 1% mean gate does) — likely true of the torus witnesses too, unchecked;
nine or more marched objects in a curved space need `objectDispatch: 'unrolled'`; new photoreal
materials and bump mapping are errors in curved spaces.
