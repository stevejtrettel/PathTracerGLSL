# Roadmap

Model-written for the owner, 2026-11-07, from the owner's decisions (decisions.md) and the design
documents. Nothing here is decided beyond what decisions.md records; the order is the owner's
(curved spaces, then the App, then photorealism).

**Goal.** A state-of-the-art photoreal unidirectional path tracer for meshes, algebraic surfaces and
SDFs in E³, S³, H³ and H²×R, including quotient spaces with light handled exactly. WebGL2 for good.
Black holes: research only (survey/blackhole-quotient-challenges.md).

## 0. Consolidate (next)

- Branch `integrate` (../PTG-integrate) holds all finished work; full vitest passes (5925 tests).
  Witnesses for the last merges were run on their own branches, not on `integrate`.
- Merge `integrate` into `claudeapp` after the owner commits or sets aside his own uncommitted edits
  (CHANGELOG.md and CLAUDE.md conflict otherwise): `git merge integrate` in the main checkout.

## 1. Curved spaces to parity

Design questions to settle with the owner first (each has a note in the session record; none decided):
1. Materials are space-independent by default (they act in the tangent frame through the seam); only
   a material that reads world position or uv declares itself Euclidean-only. Removes the per-material
   space listing.
2. What `p` means in material expressions and bump heights in curved spaces (object-local model point,
   or a chart such as exp coordinates), and uv charts for curved shapes. Unlocks checker, textures,
   expressions, bump.
3. Meshes in H³ and S³: Klein/gnomonic chart per object (reuses the BVH unchanged) or hyperboloid-native
   (one representation, a second traversal). The intersection math is the same projective linear algebra
   in both; decide after a float32-vs-float64 precision twin.
4. Isometric camera controls (part of the App redesign).

Then build: meshes; the torus and other marched shapes; emissive objects as lights; image-sky light
sampling in H³; many-object scenes (table dispatch); H²×R up to the H³ subset; the photoreal materials
in curved spaces once (1) and (2) are decided.

## 2. The App redesign

A conversation first, from app-analysis.md (decisions 1–17 restated there): structure, the parameter
system, the extension system. Nothing built before agreement.

## 3. Photorealism

Energy compensation for rough metals; roughness and normal maps (a tangent on `Hit`); the denoiser plan
(docs/claude-outputs-step7-plan.md); photographs with real metals.

## 4. Quotients

The Poincaré dodecahedral space and lens spaces (finite groups: light may be exact with no far clip);
copies of objects that cross a face; general hyperbolic manifolds from SnapPy; fog across cells.

## How to work

- Fewer, larger steps; at most one or two branches at a time; work in one context when that is faster.
- One full test run per step; reviews read code and test that checks can fail, without re-running suites.
- Untested idea: run the numeric witnesses on the M2 (they compare numbers, not exact pixels) and keep
  the software renderer for bit-exact frames only.
- Design questions are discussed with the owner before anything is built.
