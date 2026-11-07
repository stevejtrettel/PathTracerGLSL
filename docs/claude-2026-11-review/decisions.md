# Owner decisions — November 2026 review

This file records only what the owner decided, with the date and the owner's words where
useful. Proposals by the model live in the plan documents next to this file and are never
copied here until the owner accepts them.

## 2026-11-06 (start of the review)

1. **Scope of the review.** A thorough review of the whole project, then plans to improve and
   simplify the App, its extension system, the parameter system and anything else that needs
   it, *without losing important functionality*. Unbuilt or unused pieces are usually
   in-progress work and are not to be deleted as "dead code".
2. **Changes and commits are allowed on this branch** (`claudeapp`): "you are allowed to make
   changes and commits to this branch: that's why i branched you off". Every action is planned
   before it is taken and every decision is documented.
3. **Goal of the project:** a state-of-the-art photorealistic *unidirectional* path tracer for
   meshes, algebraic surfaces and SDFs, working in Euclidean space, S³, H³ and product
   geometries (at least H²×R) — spaces where the two-point geodesic problem is solvable
   analytically and SDFs can be ray-marched analytically.
4. **Black holes.** The owner is "quite interested" in black-hole spacetimes — Schwarzschild
   and Majumdar–Papapetrou (implemented in `~/Code/charged-blackholes`) — but the two-point
   geodesic problem is the worry. If a way can be found that is reliably correct and efficient
   enough, pursue it; otherwise record the research and skip.
5. **Quotient manifolds.** Nothing is built for quotients yet. The owner would love to build
   them eventually "and really take good care of light". Could be a side project here if
   there is time and capability, or wait if the plate is full.
6. **WebGL2 for good.** This repo stays WebGL2. A feature that is very hard in WebGL2 but easy
   in WebGPU is noted and skipped here (it belongs in the owner's next tracer), even if that
   leaves out some spacetimes. Bidirectional methods are already out of scope.
7. **The App is open for redesign.** The previous AI plan was withdrawn because it was bad, not
   because the topic is closed. The owner's App decisions 1–17 (docs/claude-app-decisions.md
   history, and the goals in its current text) remain the owner's decisions.
8. **Priority order for the review's plans:** (b) curved-space architecture first, then (a) App,
   extension and parameter simplification, then (c) photorealism gaps (textures, normal mapping,
   layered materials, …). Owner: "yes b then a then c is a good move".
